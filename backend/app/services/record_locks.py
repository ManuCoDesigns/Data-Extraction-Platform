"""When a record may be edited.

Peer reviewers are scored on what they caught. If the extractor can change a record after the peers have looked at it,
a field a peer approved can turn wrong, or a field a peer flagged can quietly disappear, and the peer's rating moves for
something they did not do. So:

- Admins are never blocked. Their edit is allowed and logged with the reason it overrode, so scores can be re-run without it.
- With the peers (source ready for review or in review, and peers assigned): nothing on the source can be edited.
- Reviewed records (approved, or waiting for the admin's sign-off): not editable. An admin has to return them first.
- After an admin returns a record, the source goes to "changes requested". Only the records that were sent back can be
  edited. Everything the peers already reviewed stays frozen.
- Handing the source back to the peers (status ready for review) locks it again.
- On a record that was sent back, only the fields that were flagged can be changed (open_fields below). Fields the reviewers
  passed stay as they were. If nothing specific was flagged (only a general note), every field stays open.
"""
from fastapi import HTTPException

from app.models.all_models import ReviewStatus, SourceStatus

WITH_PEERS = (SourceStatus.READY_FOR_REVIEW, SourceStatus.IN_REVIEW)


def _has_peers(source) -> bool:
    return bool(getattr(source, "peer_reviews", None))


def _has_records(source) -> bool:
    """True when the source holds at least one record. Counts the rows themselves, not the cached total."""
    try:
        from sqlalchemy.orm import object_session
        from app.models.all_models import ExtractedRecord, ExtractionJob
        db = object_session(source)
        if db is not None:
            return db.query(ExtractedRecord.id).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id) \
                .filter(ExtractionJob.source_id == source.id).first() is not None
    except Exception:
        pass
    return bool(getattr(source, "total_records", None) or 0)  # no session to look at: fall back to the cached total


def source_lock_reason(source) -> str | None:
    """Why the whole source is frozen right now, or None."""
    if _has_peers(source) and source.status in WITH_PEERS:
        return ("This source is with the peer reviewers, so editing is locked. That keeps their catches intact. "
                "An admin can send a record back for correction to reopen it.")
    return None


def record_lock_reason(source, record) -> str | None:
    """Why this record cannot be edited right now, or None."""
    why = source_lock_reason(source)
    if why:
        return why
    st = getattr(record.review_status, "value", record.review_status)
    if st in (ReviewStatus.APPROVED.value, ReviewStatus.PENDING_ADMIN_REVIEW.value):
        return "This record has already been reviewed. An admin has to send it back for correction before it can be edited."
    if _has_peers(source) and source.status == SourceStatus.CHANGES_REQUESTED:
        sent_back = (record.correction_count or 0) > 0 or st == ReviewStatus.REJECTED.value
        if not sent_back:
            return "Only the records that were sent back for correction can be edited. This one was already reviewed by the peers."
    return None


def bulk_lock_reason(source) -> str | None:
    """Replacing or removing records in bulk (upload, scrape, clear) once peers have been involved."""
    if not _has_records(source):
        return None  # nothing left to protect: an empty source can always be filled (a deleted record must not leave it stuck)
    if _has_peers(source) and source.status in WITH_PEERS + (SourceStatus.CHANGES_REQUESTED,):
        return ("Records on this source have been in peer review, so they cannot be replaced or removed in bulk. "
                "Fix the records that were sent back one by one instead.")
    return None


def delete_lock_reason(source) -> str | None:
    """Removing a record once peers have been involved. Deleting takes the peers' comments with it, so only an admin may."""
    if _has_peers(source) and source.status in WITH_PEERS + (SourceStatus.CHANGES_REQUESTED,):
        return ("This record has been in peer review, so it cannot be deleted. Edit the fields that need fixing instead "
                "(Edit on the record, or Upload Data, then Apply as corrections). An admin can delete it if it must go.")
    return None


def is_admin(user) -> bool:
    """Admins are never blocked. Their edit goes through and is logged as an override."""
    try:
        roles = {getattr(r.role, "value", r.role) for r in (user.roles or [])}
    except Exception:
        return False
    return bool(roles & {"org_admin", "project_admin"})


def assert_record_editable(source, record, user=None) -> str | None:
    """Raises 423 for everyone except admins. For an admin it returns the reason that was overridden (to log), or None."""
    why = record_lock_reason(source, record)
    if why and user is not None and is_admin(user):
        return why
    if why:
        raise HTTPException(status_code=423, detail=why)
    return None


def assert_bulk_editable(source, user=None) -> str | None:
    why = bulk_lock_reason(source)
    if why and user is not None and is_admin(user):
        return why
    if why:
        raise HTTPException(status_code=423, detail=why)
    return None


def assert_record_deletable(source, record, user=None) -> str | None:
    """Delete follows the edit rules, and on top of that is admin-only once peers have been involved."""
    why = delete_lock_reason(source) or record_lock_reason(source, record)
    if why and user is not None and is_admin(user):
        return why
    if why:
        raise HTTPException(status_code=423, detail=why)
    return None


FLAG_TYPES = ("correction", "sop", "rejection")


def _flagged_by_comment(record, field: str, e) -> bool:
    """A field comment that asks for a change, about the value the record was sent back with."""
    if not isinstance(e, dict):
        return False
    kind = e.get("type")
    if kind == "note":
        return False
    if kind is None and e.get("role") == "admin":
        return False  # a plain admin sign-off note is not a flag
    if kind is not None and kind not in FLAG_TYPES:
        return False
    sent = getattr(record, "fields_at_return", None) or {}
    if "value_at" in e and field in sent and e.get("value_at") != sent.get(field):
        return False  # it was about an older value that has since been fixed and sent again
    return True


def open_fields(db, source, record):
    """The fields an extractor may change on this record. None means every field is open (no field-level limit applies)."""
    if not (_has_peers(source) and source.status == SourceStatus.CHANGES_REQUESTED):
        return None
    st = getattr(record.review_status, "value", record.review_status)
    if (record.correction_count or 0) == 0 and st != ReviewStatus.REJECTED.value:
        return None
    flagged: set = set()
    for field, lst in (getattr(record, "reviewer_field_comments", None) or {}).items():
        if field == "_general":
            continue
        if any(_flagged_by_comment(record, field, e) for e in (lst or [])):
            flagged.add(field)
    try:
        from app.models.all_models import QualityFinding
        for f in db.query(QualityFinding).filter(QualityFinding.record_id == record.id, QualityFinding.status.in_(("open", "confirmed"))).all():
            if f.field:
                flagged.add(f.field)
    except Exception:
        pass
    return flagged or None


def _empty(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def changed_keys(before: dict, after: dict) -> list:
    """Keys whose value differs. Adding or dropping an empty value is not a change to anything a reviewer passed."""
    return sorted(k for k in set(before) | set(after)
                  if before.get(k) != after.get(k) and not (_empty(before.get(k)) and _empty(after.get(k))))


def fields_blocked(db, source, record, user, changed) -> list:
    """Which of the changed fields this user may not change. Admins are never blocked."""
    if user is not None and is_admin(user):
        return []
    allowed = open_fields(db, source, record)
    if allowed is None:
        return []
    return sorted(k for k in changed if k not in allowed)


def blocked_message(blocked, allowed) -> str:
    return ("Only the fields the reviewers flagged can be changed on this record: " + ", ".join(sorted(allowed)) +
            ". These were passed as correct and are locked: " + ", ".join(blocked) + ".")
