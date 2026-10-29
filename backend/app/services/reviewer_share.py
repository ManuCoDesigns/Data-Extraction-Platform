"""Give sources a peer reviewer without picking one by hand.

Each source that has no peer reviewer gets the people with the fewest reviews waiting on them. Never the source's own extractor or
anyone who extracted it in an earlier round, and never someone who is set aside (away) in Work balance. Sources that already have
a reviewer are never touched. Can run on its own for a project, and handles one reviewer or up to three per source.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.notify import ACTION, notify
from app.models.all_models import (
    AuditAction, AuditLog, ProjectMember, ReminderLog, Source, SourcePeerReview, SourceRound, SourceStatus, User, UserRole,
)
from app.services import balance as bal

READY = (SourceStatus.READY_FOR_REVIEW, SourceStatus.IN_REVIEW, SourceStatus.LLM_VERIFICATION)
OPEN = (SourceStatus.NOT_STARTED, SourceStatus.EXTRACTING, SourceStatus.NEEDS_FIXES, SourceStatus.CHANGES_REQUESTED) + READY
ROLES = (UserRole.PIPELINE_OPERATOR, UserRole.REVIEWER)


def _auto_key(pid: str) -> str:
    return f"dispatch:revauto:{pid}"


def _count_prefix(pid: str) -> str:
    return f"dispatch:revn:{pid}:"


def auto_on(db: Session, pid: str) -> bool:
    return bool(db.query(ReminderLog.key).filter(ReminderLog.key == _auto_key(pid)).first())


def per_source(db: Session, pid: str) -> int:
    row = db.query(ReminderLog.key).filter(ReminderLog.key.like(_count_prefix(pid) + "%")).first()
    try:
        return min(3, max(1, int(row[0].rsplit(":", 1)[1]))) if row else 1
    except ValueError:
        return 1


def set_settings(db: Session, pid: str, auto: bool | None = None, count: int | None = None) -> None:
    if auto is not None:
        row = db.query(ReminderLog).filter(ReminderLog.key == _auto_key(pid)).first()
        if auto and not row:
            db.add(ReminderLog(key=_auto_key(pid)))
        elif not auto and row:
            db.delete(row)
    if count is not None:
        db.query(ReminderLog).filter(ReminderLog.key.like(_count_prefix(pid) + "%")).delete(synchronize_session=False)
        db.add(ReminderLog(key=_count_prefix(pid) + str(min(3, max(1, count)))))


def pool(db: Session, pid: str) -> list:
    away = bal.skipped(db, pid)
    rows = (db.query(User).join(ProjectMember, ProjectMember.user_id == User.id)
            .filter(ProjectMember.project_id == pid, ProjectMember.role.in_(ROLES), User.is_active == True)  # noqa: E712
            .order_by(User.full_name).all())
    seen, out = set(), []
    for u in rows:
        if u.id not in away and u.id not in seen:
            seen.add(u.id)
            out.append(u)
    return out


def pending_load(db: Session, pid: str) -> dict:
    """{user_id: reviews waiting on them} on open sources of this project."""
    rows = (db.query(SourcePeerReview.user_id).join(Source, Source.id == SourcePeerReview.source_id)
            .filter(Source.project_id == pid, Source.status != SourceStatus.APPROVED, SourcePeerReview.status != "submitted").all())
    out: dict = {}
    for (uid,) in rows:
        out[uid] = out.get(uid, 0) + 1
    return out


def needing(db: Session, pid: str, scope: str = "ready") -> list:
    st = READY if scope == "ready" else OPEN
    return [s for s in db.query(Source).filter(Source.project_id == pid, Source.status.in_(st)).order_by(Source.created_at, Source.name).all()
            if not s.peer_reviews and not s.assigned_reviewer_id and s.assigned_extractor_id]


def run_project(db: Session, pid: str, scope: str = "ready", batch_key: str | None = None, by_user_id: str | None = None, commit: bool = True) -> dict:
    result = {"assigned": [], "left": 0, "reason": None}
    rows = needing(db, pid, scope)
    if batch_key:
        from app.services import quality as q
        pb = q.pull_batches(rows)
        rows = [s for s in rows if (pb.get(s.id) or {}).get("key") == batch_key]
    if not rows:
        return result
    people = pool(db, pid)
    if not people:
        result["left"], result["reason"] = len(rows), "Nobody on this project can review right now."
        return result
    n = per_source(db, pid)
    load = {u.id: 0 for u in people}
    load.update({k: v for k, v in pending_load(db, pid).items() if k in load})
    names = {u.id: u.full_name for u in people}
    earlier: dict = {}
    for sid, eid in db.query(SourceRound.source_id, SourceRound.extractor_id).filter(SourceRound.source_id.in_([s.id for s in rows])).all():
        earlier.setdefault(sid, set()).add(eid)
    got: dict = {}
    for s in rows:
        ok = [u for u in sorted(load, key=lambda x: (load[x], names[x])) if u != s.assigned_extractor_id and u not in earlier.get(s.id, set())]
        pick = ok[:n]
        if not pick:
            result["left"] += 1
            continue
        for uid in pick:
            s.peer_reviews.append(SourcePeerReview(user_id=uid, status="pending", assigned_by=by_user_id))
            load[uid] += 1
            got.setdefault(uid, []).append(s.name)
        s.assigned_reviewer_id = pick[0]
        result["assigned"].append({"source_id": s.id, "name": s.name, "reviewers": [names[u] for u in pick]})
        db.add(AuditLog(user_id=by_user_id, project_id=pid, source_id=s.id, action=AuditAction.SOURCE_ASSIGNED,
                        before_value={"reviewer_ids": []}, after_value={"reviewer_ids": pick, "auto_distribute": True}))
    short = lambda l: ", ".join(l[:6]) + (f" and {len(l) - 6} more" if len(l) > 6 else "")  # noqa: E731
    for uid, l in got.items():
        notify(db, uid, f"{len(l)} {'review' if len(l) == 1 else 'reviews'} to do",
               f"Peer reviews shared out to you: {short(l)}. You can start once the extractor has finished each one.", "/", "peer_requested", ACTION, dedupe=False)
    if commit:
        db.commit()
    return result


def run_all(db: Session) -> int:
    keys = db.query(ReminderLog.key).filter(ReminderLog.key.like("dispatch:revauto:%")).all()
    n = 0
    for (k,) in keys:
        try:
            n += len(run_project(db, k[len("dispatch:revauto:"):])["assigned"])
        except Exception:
            db.rollback()
    return n


def summary(db: Session, pid: str) -> dict:
    load = pending_load(db, pid)
    return {"waiting": len(needing(db, pid, "ready")), "waiting_all": len(needing(db, pid, "all_open")), "auto": auto_on(db, pid), "count": per_source(db, pid),
            "people": [{"user_id": u.id, "name": u.full_name, "pending": load.get(u.id, 0)} for u in pool(db, pid)]}
