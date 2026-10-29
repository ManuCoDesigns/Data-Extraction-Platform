"""Hold a source's clock.

When a lead puts sources on hold, the time they sit there stops counting: they are not shown as overdue, nobody is reminded about them,
they are left out of the digest and work balancing, and the days shown in reports leave the held time out. Releasing starts the
clock again from where it stopped. Nothing else changes: the sources keep their status, extractor and records.

Stored in the reminder log so no migration is needed:
  hold:{source_id}                      -> held right now (created_at = when it was held)
  held:{source_id}:{from_ts}:{to_ts}    -> one finished hold (epoch seconds)
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.all_models import ReminderLog, SourceStatus

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def _aw(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def held_since(db: Session, source_ids: list | None = None) -> dict:
    """{source_id: when it was put on hold} for sources on hold right now."""
    q = db.query(ReminderLog).filter(ReminderLog.key.like("hold:%"))
    if source_ids is not None:
        if not source_ids:
            return {}
        q = q.filter(ReminderLog.key.in_([f"hold:{i}" for i in source_ids]))
    return {r.key[5:]: _aw(r.created_at) for r in q.all()}


def held_seconds(db: Session, sources: list) -> dict:
    """{source_id: seconds spent on hold}, finished holds plus the one running now (up to approval when it was approved while held)."""
    ids = [s.id for s in sources]
    if not ids:
        return {}
    out = {i: 0.0 for i in ids}
    done = db.query(ReminderLog.key).filter(ReminderLog.key.like("held:%")).all()
    want = set(ids)
    for (k,) in done:
        parts = k.split(":")
        if len(parts) == 4 and parts[1] in want:
            try:
                out[parts[1]] += max(0, int(parts[3]) - int(parts[2]))
            except ValueError:
                pass
    now = NOW()
    by = {s.id: s for s in sources}
    for sid, since in held_since(db, ids).items():
        s = by[sid]
        end = _aw(s.approved_at) if s.status == SourceStatus.APPROVED and s.approved_at else now
        out[sid] += max(0.0, (end - since).total_seconds())
    return out


def set_hold(db: Session, sources: list, on: bool) -> int:
    """Put sources on hold or release them. Returns how many changed. Delivered sources cannot be held."""
    now = NOW()
    changed = 0
    current = held_since(db, [s.id for s in sources])
    for s in sources:
        row = db.query(ReminderLog).filter(ReminderLog.key == f"hold:{s.id}").first()
        if on:
            if row or s.status == SourceStatus.APPROVED:
                continue
            db.add(ReminderLog(key=f"hold:{s.id}", created_at=now))
            changed += 1
        elif row:
            start = current.get(s.id) or _aw(row.created_at) or now
            db.add(ReminderLog(key=f"held:{s.id}:{int(start.timestamp())}:{int(now.timestamp())}"))
            db.delete(row)
            changed += 1
    db.flush()
    return changed
