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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
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


@router.post("/sources/{source_id}/submit")
async def submit_source_to_xtrium(
    source_id: str,
    payload: SubmitToXtriumRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pushes an approved source's extracted data back to Xtrium Catalog IQ
    as raw_payload. Requires:
      - the source to have come from a pull (external_ref_id set)
      - the source to be fully APPROVED (our double-review is complete)
      - exactly one approved record — Xtrium's model is one item = one
        JSON payload, so multi-record sources need to be consolidated by
        the extractor before submitting (same as they already would for
        a nested-object schema like materials with a properties[] array).
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
    ).all() if job_ids else []

    if not approved_records:
        raise HTTPException(status_code=422, detail="No approved records found on this source.")
    if len(approved_records) > 1:
        raise HTTPException(
            status_code=422,
            detail=f"This source has {len(approved_records)} approved records, but Xtrium expects one JSON "
                   f"payload per item. Consolidate into a single record before submitting.",
        )

    record = approved_records[0]
    raw_payload = {k: v for k, v in (record.extracted_fields or {}).items() if not k.startswith("_")}

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
        after_value={"stage": "xtrium_submit", "response": result},
    ))
    db.commit()

    return result


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

@router.get("/stats")
async def get_xtrium_stats(current_user: User = Depends(get_current_user)):
    """
    Real-time workload metrics from Xtrium Catalog IQ's side — how many
    items are assigned, in progress, awaiting their review, approved,
    failed, rejected, or sent back for rework. Straight passthrough; a
    natural candidate for a small widget on our own Team Workload page
    later, once this integration is in regular use.
    """
    _require_admin(current_user)
    try:
        return await xtrium_client.get_stats()
    except XtriumClientError as e:
        raise HTTPException(status_code=502, detail=str(e))


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
                fc = record.reviewer_field_comments or {}
                fc.setdefault("_general", []).append({
                    "comment": rework_notes, "user": "xtrium_catalog_iq",
                    "role": "admin", "type": "rejection", "ts": now.isoformat(),
                })
                record.reviewer_field_comments = fc
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
