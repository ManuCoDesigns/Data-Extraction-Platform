"""
integrations.py — Xtrium Catalog IQ integration.

Xtrium Catalog IQ (Radnyi's system) is the master queue of link batches to
research. We pull assigned work, extract it through our own pipeline
(upload → schema validation → reviewer approval → admin approval), then
push the approved result back and periodically check for rework requests.

Four endpoints, each a thin wrapper around one Xtrium Catalog IQ call plus
the platform-side bookkeeping needed to make it fit our existing model:

  POST /integrations/xtrium/pull
      Pulls a batch of items and creates one Source per item.

  POST /integrations/xtrium/sources/{source_id}/submit
      Pushes an APPROVED source's data back as raw_payload.

  POST /integrations/xtrium/sources/{source_id}/fail
      Reports a scrape failure for an item.

  GET  /integrations/xtrium/sources/{source_id}/status
      Checks for rework/approval. A rework response is applied directly
      onto the source's record using the SAME mechanism as an internal
      reviewer rejection — it shows up in Escalations automatically,
      with no separate "external feedback" system needed.
"""
import copy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.all_models import (
    Source, SourceStatus, Project, User, ExtractionJob, ExtractedRecord,
    ReviewStatus, AuditLog, AuditAction,
)
from app.services.xtrium_client import xtrium_client, XtriumClientError

router = APIRouter(prefix="/integrations/xtrium", tags=["integrations"])


def _require_admin(current_user: User):
    roles = {r.role.value for r in current_user.roles}
    if not roles.intersection({"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can manage the Xtrium integration")


def _create_sources_from_xtrium_items(items: list[dict], project_id: str, current_user: User, db: Session) -> dict:
    """
    Shared by both pull_xtrium_batch (fetched live from Xtrium) and
    import_xtrium_items (fed raw item JSON directly, for recovering items
    claimed outside our normal pull flow). Identical creation logic either
    way, so the resulting Sources are indistinguishable regardless of path.
    """
    created, skipped = [], []
    for item in items:
        if item.get("id") is None:
            skipped.append({"item_id": None, "name": item.get("name"), "reason": "missing id"})
            continue
        item_id = str(item.get("id"))
        existing = db.query(Source).filter(
            Source.external_system == "xtrium_catalog_iq",
            Source.external_ref_id == item_id,
        ).first()
        if existing:
            skipped.append({"item_id": item_id, "name": item.get("name"), "existing_source_id": existing.id})
            continue
        description_parts = []
        if item.get("kg_node"):
            description_parts.append(f"KG Node: {item['kg_node']}")
        if item.get("type"):
            description_parts.append(f"Type: {item['type']}")
        if item.get("sub_type"):
            description_parts.append(f"Sub-type: {item['sub_type']}")
        if item.get("sub_products"):
            description_parts.append(f"Sub-products: {item['sub_products']}")
        if item.get("country_of_origin"):
            description_parts.append(f"Country of origin: {item['country_of_origin']}")
        if item.get("notes"):
            description_parts.append(f"Notes: {item['notes']}")
        description_parts.append(f"Xtrium item #{item_id}, priority {item.get('priority_rank', '—')}")
        source = Source(
            project_id=project_id,
            schema_id=None,
            name=item.get("name") or f"Xtrium item {item_id}",
            description=" | ".join(description_parts),
            website_url=item.get("resolved_link") or item.get("url"),
            category=item.get("category") or item.get("kg_node"),
            country=item.get("country_of_origin"),
            type=item.get("type"),
            status=SourceStatus.NOT_STARTED,
            created_by=current_user.id,
            external_system="xtrium_catalog_iq",
            external_ref_id=item_id,
            external_synced_at=datetime.now(timezone.utc),
        )
        db.add(source)
        db.flush()
        db.add(AuditLog(
            user_id=current_user.id, project_id=project_id, source_id=source.id,
            action=AuditAction.SOURCE_CREATED,
            after_value={"origin": "xtrium_catalog_iq_pull", "external_item_id": item_id},
        ))
        created.append({"item_id": item_id, "name": item.get("name"), "source_id": source.id})
    db.commit()
    return {
        "pulled": len(items),
        "created": len(created),
        "skipped_existing": len(skipped),
        "created_sources": created,
        "skipped_sources": skipped,
    }


# ─── Pull a batch, create Sources ────────────────────────────────────────────

class PullRequest(BaseModel):
    project_id: str
    batch_size: int = 50


@router.post("/pull")
async def pull_xtrium_batch(
    payload: PullRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pulls the next assigned batch from Xtrium Catalog IQ and creates one
    Source per item. Existing sources (matched by external_ref_id) are
    skipped, not duplicated, so this is safe to call repeatedly.

    No schema is assigned automatically — items span multiple KG node
    types (materials, suppliers, ...) and the right schema depends on
    what's actually found once someone opens the source. Flexible
    extraction until the extractor picks a schema, same as any other
    no-schema source on the platform.
    """
    _require_admin(current_user)

    project = db.query(Project).filter(Project.id == payload.project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        items = await xtrium_client.pull_batch(batch_size=payload.batch_size)
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return _create_sources_from_xtrium_items(items, payload.project_id, current_user, db)


# ─── Submit an approved source back to Xtrium ────────────────────────────────

class ImportXtriumItemsRequest(BaseModel):
    project_id: str
    items: list[dict]


@router.post("/import-items")
def import_xtrium_items(
    payload: ImportXtriumItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Creates Sources from raw Xtrium item JSON directly, without calling
    Xtrium's API at all. For recovering items that got claimed (moved to
    in_progress on their side) by something that bypassed our normal pull
    endpoint — e.g. a diagnostic script hitting their API directly — so
    that data isn't lost even though it never went through pull_xtrium_batch.
    Uses the exact same creation logic as a real pull, so the resulting
    Sources are indistinguishable from ones a normal pull would create.
    """
    _require_admin(current_user)
    project = db.query(Project).filter(Project.id == payload.project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _create_sources_from_xtrium_items(payload.items, payload.project_id, current_user, db)


class SubmitToXtriumRequest(BaseModel):
    notes: str = ""
    confirm_resubmit: bool = False


@router.post("/sources/{source_id}/submit")
async def submit_source_to_xtrium(
    source_id: str,
    payload: SubmitToXtriumRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pushes an approved source's extracted data back to Xtrium Catalog IQ
    as a single submission. Requires:
      - the source to have come from a pull (external_ref_id set)
      - the source to be fully APPROVED (our double-review is complete)

    Xtrium's model is one item = one JSON payload. A source with exactly
    one approved record sends that record as-is. A source with several
    approved records (e.g. a multi-file upload) automatically bundles all
    of them into one payload — {"records": [record, record, ...]}, in
    upload order — so the whole thing is still a single submission call,
    just carrying every record inside it. No flag or extra step needed;
    this is the only behaviour, so Submit stays genuinely one-click.
    """
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    if not source.external_ref_id:
        raise HTTPException(status_code=422, detail="This source wasn't pulled from Xtrium Catalog IQ — nothing to submit it back to.")

    if source.status != SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail=f"Source must be fully approved before submitting. Current status: {source.status.value}")

    job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    approved_records = db.query(ExtractedRecord).filter(
        ExtractedRecord.job_id.in_(job_ids),
        ExtractedRecord.review_status == ReviewStatus.APPROVED,
    ).order_by(ExtractedRecord.created_at).all() if job_ids else []

    if not approved_records:
        raise HTTPException(status_code=422, detail="No approved records found on this source.")

    # Block rapid accidental double-clicks outright. A genuine, later
    # resubmission (e.g. after Xtrium requested rework) is still allowed,
    # but requires explicit confirm_resubmit=true rather than silently
    # re-sending — the frontend prompts for this.
    if source.xtrium_submitted_at:
        seconds_since = (datetime.now(timezone.utc) - source.xtrium_submitted_at).total_seconds()
        if seconds_since < 60:
            raise HTTPException(
                status_code=429,
                detail="This source was just submitted moments ago. Please wait a moment before trying again.",
            )
        if not payload.confirm_resubmit:
            raise HTTPException(
                status_code=409,
                detail=f"This source was already submitted to Xtrium on {source.xtrium_submitted_at.isoformat()}. "
                       f"Re-send with confirm_resubmit=true if you intend to submit it again.",
            )

    def _clean(r: ExtractedRecord) -> dict:
        # Drop internal bookkeeping keys such as _source_file.
        return {k: v for k, v in (r.extracted_fields or {}).items() if not k.startswith("_")}

    if len(approved_records) > 1:
        raw_payload = {"records": [_clean(r) for r in approved_records]}
    else:
        raw_payload = _clean(approved_records[0])

    # Records that are not approved (an admin can approve a source with some
    # still pending) are NOT included, so log how many were left out.
    not_approved = db.query(ExtractedRecord).filter(
        ExtractedRecord.job_id.in_(job_ids),
        ExtractedRecord.review_status != ReviewStatus.APPROVED,
    ).count()

    try:
        result = await xtrium_client.submit_item(
            item_id=source.external_ref_id, raw_payload=raw_payload, notes=payload.notes,
        )
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    source.external_synced_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id, source_id=source.id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        after_value={
            "stage": "xtrium_submit", "response": result,
            "records_submitted": len(approved_records),
            "records_not_approved_excluded": not_approved,
            "bundled": len(approved_records) > 1,
        },
    ))
    db.commit()

    source.xtrium_submitted_at = datetime.now(timezone.utc)
    return {**result, "records_submitted": len(approved_records), "bundled": len(approved_records) > 1}


# ─── Report a scrape failure ─────────────────────────────────────────────────

class FailRequest(BaseModel):
    failure_reason: str
    notes: str = ""


@router.post("/sources/{source_id}/fail")
async def report_source_failure(
    source_id: str,
    payload: FailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reports that a link couldn't be scraped — 404, anti-bot, paywall, etc."""
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if not source.external_ref_id:
        raise HTTPException(status_code=422, detail="This source wasn't pulled from Xtrium Catalog IQ.")

    try:
        result = await xtrium_client.report_failure(
            item_id=source.external_ref_id, failure_reason=payload.failure_reason, notes=payload.notes,
        )
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    source.external_synced_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id, source_id=source.id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        after_value={"stage": "xtrium_fail_reported", "reason": payload.failure_reason, "response": result},
    ))
    db.commit()

    return result


# ─── Check status / pull in rework feedback ──────────────────────────────────

@router.get("/sources/{source_id}/status")
async def check_source_xtrium_status(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Checks Xtrium's review status for this item. If it comes back "Queued"
    with rework_notes, that's applied directly onto the source's approved
    record using the exact same mechanism as an internal reviewer
    rejection — it appears in the Escalations page automatically, with
    the note attributed to "xtrium_admin" so it's clear where it came from.

    Safe to call repeatedly — the same rework note is never applied twice
    (checked against the record's existing feedback history).
    """
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if not source.external_ref_id:
        raise HTTPException(status_code=422, detail="This source wasn't pulled from Xtrium Catalog IQ.")

    try:
        result = await xtrium_client.get_item_status(item_id=source.external_ref_id)
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    rework_notes = result.get("rework_notes")
    applied_rework = False
    xtrium_status = result.get("status")

    if xtrium_status == "Rejected":
        # Terminal state per their status lifecycle guide — no further
        # action expected on either side. Just record it so it's visible
        # in this source's own activity history.
        db.add(AuditLog(
            user_id=current_user.id, project_id=source.project_id, source_id=source.id,
            action=AuditAction.SOURCE_STATUS_CHANGED,
            after_value={
                "stage": "xtrium_rejected", "origin": "xtrium_catalog_iq",
                "reason": result.get("failure_reason") or result.get("notes") or "",
            },
        ))

    elif xtrium_status == "Queued" and rework_notes:
        job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
        record = (
            db.query(ExtractedRecord)
            .filter(ExtractedRecord.job_id.in_(job_ids), ExtractedRecord.review_status == ReviewStatus.APPROVED)
            .first()
        ) if job_ids else None

        if record:
            existing_comments = record.reviewer_field_comments or {}
            already_applied = any(
                e.get("comment") == rework_notes
                for e in existing_comments.get("_general", [])
            )
            if not already_applied:
                now = datetime.now(timezone.utc)
                fc = copy.deepcopy(record.reviewer_field_comments or {})
                fc.setdefault("_general", []).append({
                    "comment": rework_notes, "user": "xtrium_catalog_iq",
                    "role": "admin", "type": "rejection", "ts": now.isoformat(),
                })
                record.reviewer_field_comments = fc
                flag_modified(record, "reviewer_field_comments")
                record.review_status = ReviewStatus.PENDING
                record.correction_count = (record.correction_count or 0) + 1

                source.status = SourceStatus.CHANGES_REQUESTED

                db.add(AuditLog(
                    user_id=current_user.id, project_id=source.project_id,
                    source_id=source.id, record_id=record.id,
                    action=AuditAction.RECORD_RETURNED_FOR_CORRECTION,
                    after_value={"note": rework_notes, "origin": "xtrium_catalog_iq", "correction_count": record.correction_count},
                ))
                applied_rework = True

    source.external_synced_at = datetime.now(timezone.utc)
    db.commit()

    return {**result, "rework_applied_to_source": applied_rework}


@router.get("/stats")
async def get_xtrium_queue_stats(current_user: User = Depends(get_current_user)):
    """
    Live counts straight from Xtrium's own queue — how many items are
    currently available to pull, in progress, etc. Purely read-only, no
    side effects, unlike /pull which claims items the instant it's called.
    Lets the UI show real availability before anyone commits to a pull.
    """
    _require_admin(current_user)
    try:
        return await xtrium_client.get_stats()
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/items")
async def get_xtrium_items(
    status: str = "Queued,In Progress",
    limit: int = 50,
    current_user: User = Depends(get_current_user),
):
    """
    Read-only inspection of our Xtrium queue across statuses — including
    already-claimed/In Progress items — without claiming or mutating
    anything. Lets us see exactly what's stuck in a given state, e.g. to
    recover items claimed outside our normal pull flow via /import-items
    afterward, without needing to claim anything further first.
    """
    _require_admin(current_user)
    try:
        return await xtrium_client.get_items(status=status, limit=limit)
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/dashboard")
async def xtrium_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Everything the Xtrium Integration dashboard page needs in one call:
    status breakdown across all Xtrium-linked sources, the full source
    list, recent Xtrium-related activity pulled from the audit log, and
    live pull availability (best-effort — the dashboard still works if
    Xtrium's own API is briefly unreachable).
    """
    _require_admin(current_user)

    sources = (
        db.query(Source)
        .filter(Source.external_ref_id != None)
        .order_by(Source.updated_at.desc())
        .all()
    )

    # When each source was last submitted to Xtrium. Prefer the dedicated
    # column, but fall back to the audit log so submissions made before that
    # column existed still count as submitted (otherwise they would show as
    # "ready to submit" forever).
    submitted_at_by_source: dict = {}
    for s in sources:
        if s.xtrium_submitted_at is not None:
            submitted_at_by_source[s.id] = s.xtrium_submitted_at
    _missing_ids = [s.id for s in sources if s.id not in submitted_at_by_source]
    if _missing_ids:
        _submit_logs = (
            db.query(AuditLog)
            .filter(
                AuditLog.source_id.in_(_missing_ids),
                AuditLog.action == AuditAction.SOURCE_STATUS_CHANGED,
            )
            .order_by(AuditLog.timestamp.desc())
            .all()
        )
        for _log in _submit_logs:
            _av = _log.after_value or {}
            if _av.get("stage") == "xtrium_submit" and _log.source_id not in submitted_at_by_source:
                submitted_at_by_source[_log.source_id] = _log.timestamp

    by_status: dict = {}
    submitted_count = 0
    for s in sources:
        by_status[s.status.value] = by_status.get(s.status.value, 0) + 1
        if s.id in submitted_at_by_source:
            submitted_count += 1

    project_ids = {s.project_id for s in sources}
    projects_by_id = {
        p.id: p.name
        for p in db.query(Project).filter(Project.id.in_(project_ids)).all()
    } if project_ids else {}

    # Live item records straight from Xtrium (read-only /items — never claims
    # or changes anything), so the dashboard can show each item exactly as it
    # appears in Xtrium's own tool. Best-effort: the dashboard still loads if
    # Xtrium is unreachable. Tries the broadest status filter first, then
    # falls back, since the accepted status wording can differ between
    # versions of their API.
    xtrium_by_id: dict = {}
    xtrium_items_error = None
    for _status in ("all", "Queued,In Progress,Scraped,Ingested,Failed,Archived", "In Progress"):
        try:
            _items = await _cached_get_items(_status, 100)
        except Exception as e:
            xtrium_items_error = str(e)
            continue
        if isinstance(_items, list) and _items:
            xtrium_by_id = {str(i.get("id")): i for i in _items if isinstance(i, dict)}
            xtrium_items_error = None
            break
    # Latest audit-log entry per source = "last activity", so the dashboard can
    # show WHEN things changed (not just when a source was submitted).
    from sqlalchemy import func as _func
    last_activity_by_source: dict = {}
    if sources:
        for _sid, _ts in (
            db.query(AuditLog.source_id, _func.max(AuditLog.timestamp))
            .filter(AuditLog.source_id.in_([s.id for s in sources]))
            .group_by(AuditLog.source_id)
            .all()
        ):
            last_activity_by_source[_sid] = _ts

    # Most recent notice of ours per source: an escalation (e.g. "Link
    # inaccessible") or a failure report sent to Xtrium. Shown as a chip.
    notice_by_source: dict = {}
    if sources:
        _nids = [s.id for s in sources]
        for _rec, _sid in (
            db.query(ExtractedRecord, ExtractionJob.source_id)
            .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
            .filter(ExtractionJob.source_id.in_(_nids), ExtractedRecord.is_escalation_only == True)
            .order_by(ExtractedRecord.created_at.asc())
            .all()
        ):
            notice_by_source[_sid] = {
                "kind": "escalation",
                "reason": _rec.escalation_reason,
                "note": (_rec.raw_text or "")[:240] or None,
                "review_status": _rec.review_status.value if _rec.review_status else None,
                "at": _rec.created_at.isoformat() if _rec.created_at else None,
            }
        for _log in (
            db.query(AuditLog)
            .filter(AuditLog.source_id.in_(_nids), AuditLog.action == AuditAction.SOURCE_STATUS_CHANGED)
            .order_by(AuditLog.timestamp.asc())
            .limit(3000)
            .all()
        ):
            _av = _log.after_value if isinstance(_log.after_value, dict) else {}
            if _av.get("stage") != "xtrium_fail_reported":
                continue
            _prev = notice_by_source.get(_log.source_id)
            _at = _log.timestamp.isoformat() if _log.timestamp else None
            if _prev is None or (_at and (_prev.get("at") or "") <= _at):
                notice_by_source[_log.source_id] = {
                    "kind": "failure", "reason": _av.get("reason"), "note": None,
                    "review_status": None, "at": _at,
                }

    source_list = [{
        "id": s.id,
        "last_activity_at": last_activity_by_source[s.id].isoformat() if s.id in last_activity_by_source else None,
        "notice": notice_by_source.get(s.id),
        "sync_changes": _sync_changes(s, xtrium_by_id.get(str(s.external_ref_id))),
        "xtrium": xtrium_by_id.get(str(s.external_ref_id)),
        "name": s.name,
        "project_id": s.project_id,
        "project_name": projects_by_id.get(s.project_id),
        "status": s.status.value,
        "external_ref_id": s.external_ref_id,
        "country": getattr(s, "country", None),
        "type": getattr(s, "type", None),
        "total_records": s.total_records or 0,
        "approved_records": s.approved_records or 0,
        "xtrium_submitted_at": submitted_at_by_source[s.id].isoformat() if s.id in submitted_at_by_source else None,
        "external_synced_at": s.external_synced_at.isoformat() if s.external_synced_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    } for s in sources]

    # Recent activity — only audit log entries tagged with a recognisable
    # Xtrium stage/origin, across any of these sources.
    source_ids = [s.id for s in sources]
    sources_by_id = {s.id: s for s in sources}
    xtrium_tags = {
        "xtrium_catalog_iq_pull": "Pulled from Xtrium",
        "xtrium_submit": "Submitted to Xtrium",
        "xtrium_archived": "Archived by Xtrium",
        "xtrium_rejected": "Rejected by Xtrium",
        "escalated_no_data": "Escalated — no data found",
    }

    activity = []
    if source_ids:
        recent_logs = (
            db.query(AuditLog)
            .filter(AuditLog.source_id.in_(source_ids))
            .order_by(AuditLog.timestamp.desc())
            .limit(150)
            .all()
        )
        user_ids = {log.user_id for log in recent_logs if log.user_id}
        users_by_id = {
            u.id: u.full_name
            for u in db.query(User).filter(User.id.in_(user_ids)).all()
        } if user_ids else {}

        for log in recent_logs:
            av = log.after_value or {}
            tag = av.get("origin") or av.get("stage")
            if tag not in xtrium_tags:
                continue
            src = sources_by_id.get(log.source_id)
            activity.append({
                "id": log.id,
                "source_id": log.source_id,
                "source_name": src.name if src else None,
                "label": xtrium_tags[tag],
                "user_name": users_by_id.get(log.user_id) if log.user_id else None,
                "created_at": log.timestamp.isoformat() if log.timestamp else None,
            })
            if len(activity) >= 30:
                break

    try:
        live_availability = await xtrium_client.get_stats()
    except XtriumClientError:
        live_availability = None

    return {
        "by_status": by_status,
        "total_linked": len(sources),
        "submitted_count": submitted_count,
        "sources": source_list,
        "activity": activity,
        "live_availability": live_availability,
        "xtrium_items_error": xtrium_items_error,
    }


@router.get("/sources/{source_id}/payload-preview")
async def preview_submit_payload(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Shows the payload Submit would send for this source RIGHT NOW, without
    sending anything. Mirrors submit_source_to_xtrium's logic exactly: a
    single approved record is sent as-is; several are bundled into one
    payload as {"records": [...]}, in upload order. Built from the currently
    approved records, so for an already-submitted source it may differ from
    what was originally sent if records changed afterwards.
    """
    _require_admin(current_user)
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    approved_records = db.query(ExtractedRecord).filter(
        ExtractedRecord.job_id.in_(job_ids),
        ExtractedRecord.review_status == ReviewStatus.APPROVED,
    ).order_by(ExtractedRecord.created_at).all() if job_ids else []
    not_approved = db.query(ExtractedRecord).filter(
        ExtractedRecord.job_id.in_(job_ids),
        ExtractedRecord.review_status != ReviewStatus.APPROVED,
    ).count() if job_ids else 0

    def _clean(r: ExtractedRecord) -> dict:
        # Drop internal bookkeeping keys such as _source_file (same as Submit).
        return {k: v for k, v in (r.extracted_fields or {}).items() if not k.startswith("_")}

    if not approved_records:
        payload = None
    elif len(approved_records) > 1:
        payload = {"records": [_clean(r) for r in approved_records]}
    else:
        payload = _clean(approved_records[0])

    return {
        "external_ref_id": source.external_ref_id,
        "record_count": len(approved_records),
        "bundled": len(approved_records) > 1,
        "not_approved_excluded": not_approved,
        "payload": payload,
    }


@router.post("/verify")
async def verify_xtrium_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Read-only check of every Xtrium-linked source that hasn't been submitted:
    asks Xtrium about each item and reports which ones it no longer has
    (expired, released, or re-assigned elsewhere). Changes nothing — no rework
    is applied, no status is touched, nothing is written.
    """
    import asyncio

    _require_admin(current_user)

    sources = (
        db.query(Source)
        .filter(Source.external_ref_id != None, Source.xtrium_submitted_at == None)
        .order_by(Source.updated_at.desc())
        .limit(100)
        .all()
    )
    # Plain values only, so the concurrent tasks never touch the DB session.
    targets = [(s.id, s.external_ref_id) for s in sources]

    sem = asyncio.Semaphore(4)  # be gentle with Xtrium

    async def _check(source_id: str, ref_id: str) -> dict:
        async with sem:
            try:
                r = await xtrium_client.get_item_status(item_id=ref_id)
            except XtriumClientError as e:
                msg = str(e)
                low = msg.lower()
                # Only a *missing catalog item* counts as not-found; a bare 404
                # (wrong route/URL) must not mass-flag every item.
                state = "not_found" if ("404" in msg and "catalog item" in low and "not found" in low) else "error"
                return {"source_id": source_id, "external_ref_id": ref_id, "state": state, "detail": msg}
            except Exception as e:  # network hiccup etc. — one item never fails the whole run
                return {"source_id": source_id, "external_ref_id": ref_id, "state": "error", "detail": str(e)}
        status = r.get("status") if isinstance(r, dict) else None
        rework = bool(isinstance(r, dict) and status == "Queued" and r.get("rework_notes"))
        return {
            "source_id": source_id, "external_ref_id": ref_id, "state": "found",
            "xtrium_status": status, "rework_pending": rework,
        }

    results = list(await asyncio.gather(*[_check(sid, ref) for sid, ref in targets]))
    return {
        "checked": len(results),
        "found": sum(1 for r in results if r["state"] == "found"),
        "not_found": sum(1 for r in results if r["state"] == "not_found"),
        "errors": sum(1 for r in results if r["state"] == "error"),
        "results": results,
    }


# Friendly names for the audit "stage"/"origin" tags our own code writes.
_HISTORY_STAGE_LABELS = {
    "xtrium_catalog_iq_pull": "Pulled from Xtrium",
    "xtrium_submit": "Submitted to Xtrium",
    "xtrium_fail_reported": "Failure reported to Xtrium",
    "xtrium_rejected": "Rejected by Xtrium",
    "xtrium_archived": "Archived by Xtrium",
    "escalated_no_data": "Escalated — no data found",
}


@router.get("/sources/{source_id}/history")
async def source_xtrium_history(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A source's audit trail, newest first (latest 300 entries): what happened,
    when, and who did it, with from→to status values when the entry recorded
    them. Each entry is categorised as "xtrium" (pull/submit/rejection/
    escalation tags), "status" (anything that is or records a status change)
    or "other" (everything else), so the UI can default to the meaningful
    ones. Read-only.
    """
    _require_admin(current_user)
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    base = db.query(AuditLog).filter(AuditLog.source_id == source_id)
    total = base.count()
    logs = base.order_by(AuditLog.timestamp.desc()).limit(300).all()

    user_ids = {l.user_id for l in logs if l.user_id}
    users_by_id = {
        u.id: u.full_name
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    def _first(d: dict, keys) -> str | None:
        for k in keys:
            v = d.get(k)
            if v not in (None, ""):
                return str(v)
        return None

    def _humanize(t) -> str:
        t = str(t).replace("_", " ").strip().lower()
        return t[:1].upper() + t[1:] if t else "Activity"

    entries = []
    for log in logs:
        av = log.after_value if isinstance(log.after_value, dict) else {}
        bv = log.before_value if isinstance(log.before_value, dict) else {}
        action_name = getattr(log.action, "name", None) or str(log.action)
        stage = av.get("stage") or av.get("origin")

        to_status = _first(av, ("status", "new_status", "to_status", "to"))
        from_status = _first(bv, ("status", "old_status", "from_status", "from"))

        label = _HISTORY_STAGE_LABELS.get(stage) or (_humanize(stage) if stage else _humanize(action_name))
        is_xtrium = bool(stage and (stage in _HISTORY_STAGE_LABELS or str(stage).startswith("xtrium"))) \
            or "xtrium" in str(av.get("origin", "")).lower()
        is_status = "STATUS" in action_name.upper() or bool(from_status or to_status)
        category = "xtrium" if is_xtrium else ("status" if is_status else "other")

        note = _first(av, ("reason", "failure_reason", "note", "notes", "comment"))
        entries.append({
            "id": log.id,
            "at": log.timestamp.isoformat() if log.timestamp else None,
            "label": label,
            "category": category,
            "user_name": users_by_id.get(log.user_id) if log.user_id else None,
            "from_status": from_status,
            "to_status": to_status,
            "note": note[:240] if note else None,
        })

    return {
        "source_id": source_id,
        "total": total,
        "truncated": total > len(entries),
        "entries": entries,
    }


@router.get("/export")
async def export_xtrium_sources(
    project_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Excel export of the Xtrium-linked sources with everything Xtrium holds on
    each item (live from Xtrium) beside our own data. Sheets: Sources,
    Xtrium fields (every field, one per row) and Activity. Read-only.
    """
    import io
    import json
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    _require_admin(current_user)

    q = db.query(Source).filter(Source.external_ref_id != None)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    sources = q.order_by(Source.name.asc()).all()

    projects_by_id = {
        p.id: p.name
        for p in db.query(Project).filter(Project.id.in_({s.project_id for s in sources})).all()
    } if sources else {}
    user_ids = {u for s in sources for u in (s.assigned_extractor_id, s.assigned_reviewer_id) if u}
    users_by_id = {
        u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    # Live Xtrium data (same best-effort lookup the dashboard uses).
    xtrium_by_id: dict = {}
    xtrium_error = None
    for _status in ("all", "Queued,In Progress,Scraped,Ingested,Failed,Archived", "In Progress"):
        try:
            _items = await _cached_get_items(_status, 100)
        except Exception as e:
            xtrium_error = str(e)
            continue
        if isinstance(_items, list) and _items:
            xtrium_by_id = {str(i.get("id")): i for i in _items if isinstance(i, dict)}
            xtrium_error = None
            break

    def cell(v):
        """Excel-safe scalar: JSON for lists/dicts."""
        if v is None:
            return None
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False)
        if isinstance(v, bool):
            return "Yes" if v else "No"
        if isinstance(v, (int, float)):
            return v
        return str(v)

    def when(dt):
        return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else None

    XTRIUM_COLS = [
        ("id", "Xtrium Item ID"), ("name", "Xtrium Name"), ("url", "URL"),
        ("resolved_link", "Resolved Link"), ("category", "Category"), ("kg_node", "KG Node"),
        ("type", "Xtrium Type"), ("sub_type", "Sub-type"), ("sub_products", "Sub-products"),
        ("country_of_origin", "Country of Origin"), ("priority_rank", "Priority Rank"),
        ("status", "Xtrium Status"), ("claimed_at", "Claimed At"), ("notes", "Xtrium Notes"),
    ]
    OUR_COLS = [
        "Our Source", "Project", "Item #", "Xtrium data", "Our Status", "Website URL",
        "Description", "Our Notes", "Records", "Approved Records", "Extractor", "Reviewer",
        "Submitted to Xtrium", "Last Synced", "Source Created",
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = "Sources"
    headers = OUR_COLS[:4] + [label for _, label in XTRIUM_COLS] + OUR_COLS[4:]
    ws.append(headers)

    raw = wb.create_sheet("Xtrium fields")
    raw.append(["Item #", "Our Source", "Field", "Value"])

    for s in sources:
        item = xtrium_by_id.get(str(s.external_ref_id))
        row = [
            s.name, projects_by_id.get(s.project_id), s.external_ref_id,
            "Live from Xtrium" if item else (
                f"Xtrium could not be reached ({str(xtrium_error)[:80]})" if xtrium_error
                else "Not returned by Xtrium (outside the latest 100 items, or no longer there)"
            ),
        ]
        row += [item.get(k) if item else None for k, _ in XTRIUM_COLS]
        row += [
            s.status.value if s.status else None, s.website_url, s.description, s.notes,
            s.total_records or 0, s.approved_records or 0,
            users_by_id.get(s.assigned_extractor_id), users_by_id.get(s.assigned_reviewer_id),
            when(s.xtrium_submitted_at), when(s.external_synced_at), when(s.created_at),
        ]
        ws.append([cell(v) for v in row])
        if item:
            for k, v in item.items():
                raw.append([cell(s.external_ref_id), cell(s.name), k, cell(v)])

    act = wb.create_sheet("Activity")
    act.append(["When", "Our Source", "Item #", "Event", "By", "From status", "To status", "Note"])
    if sources:
        by_id = {s.id: s for s in sources}
        logs = (
            db.query(AuditLog).filter(AuditLog.source_id.in_(list(by_id)))
            .order_by(AuditLog.timestamp.desc()).limit(5000).all()
        )
        log_users = {l.user_id for l in logs if l.user_id}
        names = {
            u.id: u.full_name for u in db.query(User).filter(User.id.in_(log_users)).all()
        } if log_users else {}
        for l in logs:
            av = l.after_value if isinstance(l.after_value, dict) else {}
            bv = l.before_value if isinstance(l.before_value, dict) else {}
            stage = av.get("stage") or av.get("origin")
            action_name = getattr(l.action, "name", None) or str(l.action)
            label = _HISTORY_STAGE_LABELS.get(stage) or str(stage or action_name).replace("_", " ").capitalize()

            def first(d, keys):
                for k in keys:
                    if d.get(k) not in (None, ""):
                        return d.get(k)
                return None

            src = by_id.get(l.source_id)
            act.append([cell(v) for v in (
                when(l.timestamp), src.name if src else None, src.external_ref_id if src else None,
                label, names.get(l.user_id),
                first(bv, ("status", "old_status", "from_status", "from")),
                first(av, ("status", "new_status", "to_status", "to")),
                first(av, ("reason", "failure_reason", "note", "notes", "comment")),
            )])

    # Readable formatting: bold coloured header, frozen, filters, sane widths.
    for sheet in (ws, raw, act):
        # Text that merely starts with "=" must stay text, never become a formula.
        for r in sheet.iter_rows(min_row=2):
            for c in r:
                if isinstance(c.value, str) and c.value.startswith("="):
                    c.data_type = "s"
        for c in sheet[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="2563EB")
            c.alignment = Alignment(vertical="center")
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for idx in range(1, sheet.max_column + 1):
            longest = max(
                (len(str(r[idx - 1].value)) for r in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 200))
                 if r[idx - 1].value is not None),
                default=8,
            )
            sheet.column_dimensions[get_column_letter(idx)].width = min(max(longest + 2, 10), 60)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    scope = projects_by_id.get(project_id, "project") if project_id else "all"
    safe_scope = "".join(ch if ch.isalnum() else "_" for ch in str(scope))[:40]
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="Xtrium_sources_{safe_scope}_{stamp}.xlsx"',
        },
    )


@router.get("/sources/{source_id}/notices")
async def source_xtrium_notices(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Every notice tied to one source, newest first: escalations raised on it
    ("Escalate — No Data Found": reason + note), failure reports sent to
    Xtrium, and rework notes Xtrium sent back. Read-only.
    """
    _require_admin(current_user)
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    rows = (
        db.query(ExtractedRecord, ExtractionJob.created_by)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(ExtractionJob.source_id == source_id)
        .order_by(ExtractedRecord.created_at.desc())
        .all()
    )
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.source_id == source_id, AuditLog.action == AuditAction.SOURCE_STATUS_CHANGED)
        .order_by(AuditLog.timestamp.desc())
        .limit(500)
        .all()
    )

    user_ids = {uid for _, uid in rows if uid} | {l.user_id for l in logs if l.user_id}
    names = {
        u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    escalations = []
    xtrium_feedback = []
    for rec, creator_id in rows:
        if rec.is_escalation_only:
            escalations.append({
                "id": rec.id,
                "reason": rec.escalation_reason,
                "note": rec.raw_text or None,
                "review_status": rec.review_status.value if rec.review_status else None,
                "by": names.get(creator_id),
                "at": rec.created_at.isoformat() if rec.created_at else None,
            })
        comments = rec.reviewer_field_comments if isinstance(rec.reviewer_field_comments, dict) else {}
        for entry in comments.get("_general", []) or []:
            if isinstance(entry, dict) and entry.get("user") == "xtrium_catalog_iq" and entry.get("comment"):
                xtrium_feedback.append({
                    "comment": str(entry.get("comment"))[:1000],
                    "at": entry.get("ts"),
                })
    xtrium_feedback.sort(key=lambda e: e.get("at") or "", reverse=True)

    failures = []
    for l in logs:
        av = l.after_value if isinstance(l.after_value, dict) else {}
        if av.get("stage") != "xtrium_fail_reported":
            continue
        resp = av.get("response")
        if isinstance(resp, dict):
            resp = resp.get("message") or resp.get("detail") or resp.get("status")
        failures.append({
            "reason": av.get("reason"),
            "xtrium_reply": str(resp)[:240] if resp else None,
            "by": names.get(l.user_id) if l.user_id else None,
            "at": l.timestamp.isoformat() if l.timestamp else None,
        })

    return {
        "source_id": source_id,
        "escalations": escalations,
        "failures": failures,
        "xtrium_feedback": xtrium_feedback,
    }


# ─── Sync from Xtrium ────────────────────────────────────────────────────────
import asyncio as _asyncio
import re as _re
import time as _time

_LIVE_ITEMS_TTL_SECONDS = 45
_LIVE_ITEMS_COOLDOWN_SECONDS = 60
_live_items_cache: dict = {}
_live_items_lock = _asyncio.Lock()


async def _cached_get_items(status: str, limit: int, force: bool = False):
    """
    xtrium_client.get_items with a short shared cache. Xtrium's gateway locks a
    key out after bursts of calls, and the dashboard polls every 30s per open
    tab, so identical reads within 45s reuse one response (and concurrent
    callers share one in-flight request). Failed responses are not cached, but
    one failure pauses further calls for a minute (see below).
    """
    key = (status, limit)
    async with _live_items_lock:
        now = _time.monotonic()
        hit = _live_items_cache.get(key)
        if hit and not force and (now - hit[0]) < _LIVE_ITEMS_TTL_SECONDS:
            return hit[1]
        # After a failure (e.g. their 403 circuit breaker) stop hammering for a
        # minute — repeated attempts are what keep a key locked out.
        failed = _live_items_cache.get("_failed")
        if failed and not force and (now - failed[0]) < _LIVE_ITEMS_COOLDOWN_SECONDS:
            raise XtriumClientError(f"Xtrium refused the last request ({failed[1]}); not retrying for a minute")
        try:
            items = await xtrium_client.get_items(status=status, limit=limit)
            if status == "all" and isinstance(items, list):
                items = await _merge_in_progress(items, limit)
        except Exception as e:
            _live_items_cache["_failed"] = (now, str(e)[:160])
            raise
        _live_items_cache.pop("_failed", None)
        if isinstance(items, list):
            _live_items_cache[key] = (_time.monotonic(), items)
        return items


_SYNC_LABELS = {
    "name": "Name", "website_url": "Website link", "category": "Category",
    "country": "Country", "type": "Type", "description": "Description",
}


def _xtrium_description(item: dict) -> str:
    """Same text the pull writes (kept in step with _create_sources_from_xtrium_items)."""
    parts = []
    if item.get("kg_node"):
        parts.append(f"KG Node: {item['kg_node']}")
    if item.get("type"):
        parts.append(f"Type: {item['type']}")
    if item.get("sub_type"):
        parts.append(f"Sub-type: {item['sub_type']}")
    if item.get("sub_products"):
        parts.append(f"Sub-products: {item['sub_products']}")
    if item.get("country_of_origin"):
        parts.append(f"Country of origin: {item['country_of_origin']}")
    if item.get("notes"):
        parts.append(f"Notes: {item['notes']}")
    parts.append(f"Xtrium item #{item.get('id')}, priority {item.get('priority_rank', '—')}")
    return " | ".join(parts)


def _sync_changes(source, item) -> list:
    """Where our saved copy of `source` differs from Xtrium's live `item`."""
    if not isinstance(item, dict):
        return []
    wanted = {
        "name": item.get("name"),
        "website_url": item.get("resolved_link") or item.get("url"),
        "category": item.get("category") or item.get("kg_node"),
        "country": item.get("country_of_origin"),
        "type": item.get("type"),
    }
    # Only refresh the description while it is still the auto-generated one.
    if source.description and _re.search(r"Xtrium item #\d+, priority", source.description):
        wanted["description"] = _xtrium_description(item)
    changes = []
    for field, new in wanted.items():
        if new is None or str(new).strip() == "":
            continue  # never blank out our copy because Xtrium omitted a value
        old = getattr(source, field, None)
        if (str(old).strip() if old is not None else "") != str(new).strip():
            changes.append({
                "field": field, "label": _SYNC_LABELS[field],
                "old": old, "new": str(new).strip(),
            })
    return changes


_HISTORY_STAGE_LABELS["xtrium_synced"] = "Updated from Xtrium"


class SyncRequest(BaseModel):
    source_ids: list[str]


@router.post("/sync")
async def sync_sources_from_xtrium(
    payload: SyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Applies Xtrium's current values to the chosen sources' saved copy.
    Re-fetches live data and recomputes the differences here, so only what
    Xtrium really says right now is written. Each change is logged (old → new).
    """
    _require_admin(current_user)
    ids = list(dict.fromkeys(payload.source_ids))[:200]
    if not ids:
        raise HTTPException(status_code=422, detail="No sources selected")

    live: dict = {}
    last_error = None
    for _status in ("all", "Queued,In Progress,Scraped,Ingested,Failed,Archived", "In Progress"):
        try:
            _items = await _cached_get_items(_status, 100, force=True)
        except Exception as e:
            last_error = str(e)
            continue
        if isinstance(_items, list) and _items:
            live = {str(i.get("id")): i for i in _items if isinstance(i, dict)}
            last_error = None
            break
    if not live:
        raise HTTPException(status_code=502, detail=last_error or "Xtrium returned no items to sync from")

    sources = db.query(Source).filter(Source.id.in_(ids), Source.external_ref_id != None).all()
    results = []
    now = datetime.now(timezone.utc)
    for s in sources:
        item = live.get(str(s.external_ref_id))
        if item is None:
            results.append({"source_id": s.id, "state": "not_in_xtrium_list", "changed": []})
            continue
        changes = _sync_changes(s, item)
        if not changes:
            results.append({"source_id": s.id, "state": "up_to_date", "changed": []})
            continue
        for c in changes:
            setattr(s, c["field"], c["new"])
        s.external_synced_at = now
        db.add(AuditLog(
            user_id=current_user.id, project_id=s.project_id, source_id=s.id,
            action=AuditAction.SOURCE_STATUS_CHANGED,
            before_value={c["field"]: (str(c["old"])[:300] if c["old"] is not None else None) for c in changes},
            after_value={
                "stage": "xtrium_synced", "origin": "xtrium_catalog_iq",
                "reason": "Updated: " + ", ".join(c["label"] for c in changes),
                "changes": {c["field"]: c["new"][:300] for c in changes},
            },
        ))
        results.append({"source_id": s.id, "state": "updated", "changed": [c["label"] for c in changes]})
    db.commit()

    found = {s.id for s in sources}
    for sid in ids:
        if sid not in found:
            results.append({"source_id": sid, "state": "not_found", "changed": []})
    return {
        "updated": sum(1 for r in results if r["state"] == "updated"),
        "up_to_date": sum(1 for r in results if r["state"] == "up_to_date"),
        "skipped": sum(1 for r in results if r["state"] in ("not_in_xtrium_list", "not_found")),
        "results": results,
    }


async def _merge_in_progress(items: list, limit: int) -> list:
    """
    Items we have claimed are "In Progress" on Xtrium and may not be among the
    latest `limit` of "all". Add them, de-duplicated by id. A failure here never
    breaks the main result.
    """
    try:
        extra = await xtrium_client.get_items(status="In Progress", limit=limit)
    except Exception:
        return items
    if not isinstance(extra, list):
        return items
    seen = {str(i.get("id")) for i in items if isinstance(i, dict)}
    return items + [
        i for i in extra
        if isinstance(i, dict) and str(i.get("id")) not in seen
    ]
