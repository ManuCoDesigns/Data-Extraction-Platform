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
"""
from fastapi import HTTPException

from app.models.all_models import ReviewStatus, SourceStatus

WITH_PEERS = (SourceStatus.READY_FOR_REVIEW, SourceStatus.IN_REVIEW)


def _has_peers(source) -> bool:
    return bool(getattr(source, "peer_reviews", None))


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
    if _has_peers(source) and source.status in WITH_PEERS + (SourceStatus.CHANGES_REQUESTED,):
        return ("Records on this source have been in peer review, so they cannot be replaced or removed in bulk. "
                "Fix the records that were sent back one by one instead.")
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
