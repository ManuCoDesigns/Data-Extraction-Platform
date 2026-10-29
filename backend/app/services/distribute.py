"""Hand freshly pulled sources to the team without assigning them one by one.

Sources nobody owns yet are dealt out so the extractor with the least remaining work gets the next one. Each source stays "not
started": the clock begins when the extractor opens it, not when it is handed over. Works for a whole project, one pull
(batch) or a list of sources, and can run on its own for a project (switch on in the Work balance panel).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.notify import ACTION, notify
from app.models.all_models import AuditAction, AuditLog, ReminderLog, Source, SourceRound, SourceStatus
from app.services import balance as bal
from app.services import holds
from app.services import quality as q


def _auto_key(pid: str) -> str:
    return f"dispatch:auto:{pid}"


def auto_on(db: Session, project_id: str) -> bool:
    return bool(db.query(ReminderLog.key).filter(ReminderLog.key == _auto_key(project_id)).first())


def set_auto(db: Session, project_id: str, on: bool) -> None:
    row = db.query(ReminderLog).filter(ReminderLog.key == _auto_key(project_id)).first()
    if on and not row:
        db.add(ReminderLog(key=_auto_key(project_id)))
    elif not on and row:
        db.delete(row)


def unassigned(db: Session, project_id: str) -> list:
    return (db.query(Source).filter(Source.project_id == project_id, Source.assigned_extractor_id == None,  # noqa: E711
                                    Source.status == SourceStatus.NOT_STARTED).order_by(Source.created_at, Source.name).all())


def waiting_summary(db: Session, project_id: str) -> dict:
    """What could be handed out, by pull."""
    rows = unassigned(db, project_id)
    pb = q.pull_batches(rows)
    groups: dict = {}
    for s in rows:
        b = pb.get(s.id) or {"key": "other", "label": "Other sources", "date": ""}
        g = groups.setdefault(b["key"], {"key": b["key"], "label": b["label"], "date": b["date"], "count": 0})
        g["count"] += 1
    return {"total": len(rows), "batches": sorted(groups.values(), key=lambda g: g["date"], reverse=True)}


def run_project(db: Session, project_id: str, batch_key: str | None = None, source_ids: list | None = None,
                by_user_id: str | None = None, commit: bool = True) -> dict:
    """Deal out unowned sources. Returns {assigned: [{source_id, name, to}], skipped: int, reason}."""
    result = {"assigned": [], "left": 0, "reason": None}
    people = bal.pool(db, project_id)
    rows = unassigned(db, project_id)
    if source_ids is not None:
        want = set(source_ids)
        rows = [s for s in rows if s.id in want]
    if batch_key:
        pb = q.pull_batches(rows)
        rows = [s for s in rows if (pb.get(s.id) or {}).get("key") == batch_key]
    if not rows:
        return result
    if not people:
        result["left"] = len(rows)
        result["reason"] = "No extractors on this project are available."
        return result

    snap = bal.snapshot(db, project_id)
    load = {u.id: snap.get(u.id, {}).get("load", 0) for u in people}
    names = {u.id: u.full_name for u in people}
    ids = [s.id for s in rows]
    peers = {s.id: {p.user_id for p in s.peer_reviews} for s in rows}
    earlier: dict = {}
    for sid, eid in db.query(SourceRound.source_id, SourceRound.extractor_id).filter(SourceRound.source_id.in_(ids)).all():
        earlier.setdefault(sid, set()).add(eid)
    on_hold = set(holds.held_since(db, ids))
    # sources on hold are the ones that can wait, so they go out last
    rows.sort(key=lambda s: (s.id in on_hold,))
    got: dict = {}
    for s in rows:
        pick = next((uid for uid in sorted(load, key=lambda u: (load[u], names[u]))
                     if uid not in peers.get(s.id, set()) and uid not in earlier.get(s.id, set())), None)
        if not pick:
            result["left"] += 1
            continue
        s.assigned_extractor_id = pick          # status and clock stay as they are: the extractor starts it
        load[pick] += 1
        got.setdefault(pick, []).append(s.name)
        result["assigned"].append({"source_id": s.id, "name": s.name, "to": names[pick], "to_id": pick})
        db.add(AuditLog(user_id=by_user_id, project_id=project_id, source_id=s.id, action=AuditAction.SOURCE_ASSIGNED,
                        before_value={"extractor_id": None}, after_value={"extractor_id": pick, "auto_distribute": True}))
    short = lambda l: ", ".join(l[:6]) + (f" and {len(l) - 6} more" if len(l) > 6 else "")  # noqa: E731
    for uid, l in got.items():
        notify(db, uid, f"{len(l)} new {'source' if len(l) == 1 else 'sources'} to extract",
               f"Shared out to you: {short(l)}. Open Link triage first and flag any link that will not work.", "/triage", "assigned", ACTION, dedupe=False)
    if commit:
        db.commit()
    return result


def run_all(db: Session) -> int:
    """Background loop: projects with automatic sharing switched on."""
    keys = db.query(ReminderLog.key).filter(ReminderLog.key.like("dispatch:auto:%")).all()
    n = 0
    for (k,) in keys:
        try:
            n += len(run_project(db, k[len("dispatch:auto:"):])["assigned"])
        except Exception:
            db.rollback()
    return n
