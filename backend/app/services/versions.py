"""Versions of a source's data, so replacing it never loses anything.

Whenever the records on a source are replaced (a new upload, or restoring an older version) the records as they stood are kept
first, as a version: their fields, review status, reviewer comments and the peers' verdicts and flags. A version can be compared
with what is there now, downloaded as a JSON file that loads straight back in, or restored.

An extractor may replace the data of a source that is already with the peers, which used to need an admin. The rules:
- a reason is required, at least 10 characters. It is kept with the version and sent to the peers and the admins;
- the peer reviews go back to pending, because what they reviewed is no longer there. What they wrote is kept in the version;
- once a record has been approved or sent to an admin for sign-off, or the extractor has replaced the data 3 times already,
  an admin has to do it. Admins are never blocked.
"""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.notify import ACTION, INFO, admin_user_ids, notify, src_link
from app.models.all_models import (
    AuditAction, AuditLog, ExtractedRecord, ExtractionJob, FieldAudit, QualityFinding, ReviewStatus, SourceRound, User,
)
from fastapi import HTTPException

MIN_REASON = 10
MAX_SELF = 3
KEYS = ("canonical_name", "company_name", "segment_name", "regulation_name", "product_name", "name")


def current_records(db: Session, source) -> list:
    return (db.query(ExtractedRecord).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
            .filter(ExtractionJob.source_id == source.id, ExtractedRecord.is_escalation_only == False)  # noqa: E712
            .order_by(ExtractedRecord.created_at).all())


def self_replace_block(db: Session, source) -> str | None:
    """Why an extractor (not an admin) may not replace the data themselves, or None."""
    if any((getattr(r.review_status, "value", r.review_status) in (ReviewStatus.APPROVED.value, ReviewStatus.PENDING_ADMIN_REVIEW.value)) for r in current_records(db, source)):
        return ("Some records were already approved or are waiting for the admin's sign-off, so an admin has to replace the data. "
                "Ask an admin to send them back, or to upload the new file.")
    n = db.query(func.count(SourceRound.id)).filter(SourceRound.source_id == source.id, SourceRound.reason.like("Replaced%")).scalar() or 0
    if n >= MAX_SELF:
        return f"The data on this source was already replaced {n} times. An admin has to replace it again."
    return None


def gate(db: Session, source, user, reason: str | None) -> str | None:
    """Replaces the plain bulk-edit check on an upload. Returns the reason to log when a lock was overridden."""
    from app.services import record_locks as rl
    why = rl.bulk_lock_reason(source)
    reason = (reason or "").strip()
    if not why or not reason or rl.is_admin(user):
        return rl.assert_bulk_editable(source, user)
    if len(reason) < MIN_REASON:
        raise HTTPException(status_code=422, detail=f"Say why the data is being replaced, in at least {MIN_REASON} characters. It is kept with the old version and sent to the reviewers.")
    block = self_replace_block(db, source)
    if block:
        raise HTTPException(status_code=423, detail=block)
    return why


def _name(r) -> str:
    f = r.extracted_fields or {}
    return str(r.canonical_name or next((f.get(k) for k in KEYS if f.get(k)), "") or r.id)


def archive(db: Session, source, user, reason: str) -> SourceRound | None:
    """Keep the records as they are now. Returns the new version, or None when there was nothing to keep."""
    recs = current_records(db, source)
    if not recs:
        return None
    rids = [r.id for r in recs]
    rn = (db.query(func.max(SourceRound.round)).filter(SourceRound.source_id == source.id).scalar() or 0) + 1
    ids = {x for x in [source.assigned_extractor_id] + [p.user_id for p in source.peer_reviews] if x}
    who = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    rd = SourceRound(
        source_id=source.id, round=rn, created_by=user.id, reason=reason, status_at=source.status.value,
        extractor_id=source.assigned_extractor_id, extractor_name=who.get(source.assigned_extractor_id), record_count=len(recs),
        reviewers=[{"id": p.user_id, "name": who.get(p.user_id), "status": p.status, "comment": p.comment,
                    "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None} for p in source.peer_reviews],
        records=[{"id": r.id, "name": _name(r), "fields": r.extracted_fields, "review_status": r.review_status.value if r.review_status else None,
                  "comments": r.reviewer_field_comments or {}, "corrections": r.correction_count or 0, "admin_note": r.admin_review_note} for r in recs],
        audits=[{"record_id": a.record_id, "field": a.field, "verdict": a.verdict, "first_verdict": a.first_verdict, "extracted_value": a.extracted_value, "truth_value": a.truth_value}
                for a in db.query(FieldAudit).filter(FieldAudit.record_id.in_(rids)).all()],
        findings=[{"record_id": f.record_id, "field": f.field, "origin": f.origin, "status": f.status, "raised_by": f.raised_by, "fixed_before_final": bool(f.fixed_before_final)}
                  for f in db.query(QualityFinding).filter(QualityFinding.record_id.in_(rids)).all()])
    db.add(rd)
    db.flush()
    return rd


def prepare_replace(db: Session, source, user, reason: str | None, filename: str) -> int | None:
    """Called right before the records are replaced. Keeps them as a version, sends the peers back to pending and tells people."""
    reason = (reason or "").strip()
    label = reason if reason.startswith("Restored") else f"Replaced: {reason}" if reason else f"Replaced by a new upload ({filename})"
    rd = archive(db, source, user, label)
    if rd is None:
        return None
    reset = []
    for p in source.peer_reviews:
        if p.status != "pending" or p.comment or p.snapshot:
            reset.append(p.user_id)
        p.status, p.submitted_at, p.comment, p.snapshot = "pending", None, None, None
    db.add(AuditLog(user_id=user.id, project_id=source.project_id, source_id=source.id, action=AuditAction.SOURCE_DATA_UPLOADED,
                    before_value={"records": rd.record_count, "status": rd.status_at},
                    after_value={"replaced": True, "kept_as_version": rd.round, "reason": reason or None, "file": filename, "peer_reviews_reset": len(reset)}))
    link = src_link(source)
    for uid in {p.user_id for p in source.peer_reviews}:
        notify(db, uid, f"Data replaced on {source.name}", f"The extractor replaced the data{(': ' + reason) if reason else ''}. Your earlier review is kept as version {rd.round}. Please review the new data.",
               link, "data_replaced", ACTION)
    for uid in admin_user_ids(db, source.project_id) - {user.id}:
        notify(db, uid, f"Data replaced on {source.name}", f"{user.full_name} replaced {rd.record_count} records{(': ' + reason) if reason else ''}. The old data is kept as version {rd.round}.",
               link, "data_replaced", INFO)
    return rd.round


def _key(v) -> str:
    s = unicodedata.normalize("NFKD", str(v).lower().strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def compare(db: Session, source, rd: SourceRound) -> dict:
    """What differs between a kept version and the data on the source now, matching records by name."""
    now = {_key(_name(r)): r for r in current_records(db, source)}
    old = {_key(x.get("name")): x for x in (rd.records or [])}
    added = [_name(r) for k, r in now.items() if k not in old]
    removed = [x["name"] for k, x in old.items() if k not in now]
    changed, same = [], 0
    for k, x in old.items():
        r = now.get(k)
        if not r:
            continue
        a, b = x.get("fields") or {}, r.extracted_fields or {}
        diff = sorted(f for f in set(a) | set(b) if a.get(f) != b.get(f) and not (a.get(f) in (None, "", [], {}) and b.get(f) in (None, "", [], {})))
        if diff:
            changed.append({"name": x["name"], "fields": diff[:12], "more": max(0, len(diff) - 12)})
        else:
            same += 1
    return {"round": rd.round, "same": same, "added": added[:60], "removed": removed[:60], "changed": changed[:60],
            "counts": {"added": len(added), "removed": len(removed), "changed": len(changed), "same": same}}


def listing(db: Session, source) -> list[dict]:
    rows = db.query(SourceRound).filter(SourceRound.source_id == source.id).order_by(SourceRound.round.desc()).all()
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({r.created_by for r in rows if r.created_by})).all()} if rows else {}
    out = []
    for r in rows:
        kind = "replaced" if (r.reason or "").startswith("Replaced") else "restored" if (r.reason or "").startswith("Restored") else "round"
        out.append({"id": r.id, "round": r.round, "created_at": r.created_at.isoformat() if r.created_at else None, "by": names.get(r.created_by),
                    "reason": r.reason, "kind": kind, "records": r.record_count or 0, "status_at": r.status_at, "extractor": r.extractor_name,
                    "reviewers": [{"name": x.get("name"), "status": x.get("status"), "comment": x.get("comment")} for x in (r.reviewers or [])],
                    "findings": len(r.findings or [])})
    return out
