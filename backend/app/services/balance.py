"""Keeps extraction work even across the team, automatically.

Every extractor should have about the same amount of work left. When someone's count drops (they flagged broken links, finished
faster, or were removed), sources that nobody has started yet are moved to the people with the least left. A source that an
extractor has begun is never taken from them. Runs on its own: when a link is flagged, and every time the background loop ticks.

Load = sources the extractor still has to extract: not started, extracting, or sent back for fixes. Sources already in review or
approved are not load. Sources parked by a blocking observation (a link that will not open, no data...) are not load either,
because they cannot be worked until a lead decides.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.notify import ACTION, INFO, notify
from app.models.all_models import (
    AuditAction, AuditLog, ExtractionJob, Project, ProjectMember, ReminderLog, Source, SourceObservation, SourceRound, SourceStatus, User, UserRole,
)
from app.services import observations as ob

WORKING = (SourceStatus.NOT_STARTED, SourceStatus.EXTRACTING, SourceStatus.NEEDS_FIXES, SourceStatus.CHANGES_REQUESTED)
MAX_MOVES = 300


def _off_key(pid: str) -> str:
    return f"balance:off:{pid}"


def _skip_key(pid: str, uid: str) -> str:
    return f"balance:skip:{pid}:{uid}"


def enabled(db: Session, project_id: str) -> bool:
    return not db.query(ReminderLog.key).filter(ReminderLog.key == _off_key(project_id)).first()


def set_enabled(db: Session, project_id: str, on: bool) -> None:
    row = db.query(ReminderLog).filter(ReminderLog.key == _off_key(project_id)).first()
    if on and row:
        db.delete(row)
    elif not on and not row:
        db.add(ReminderLog(key=_off_key(project_id)))


def skipped(db: Session, project_id: str) -> set:
    pre = f"balance:skip:{project_id}:"
    return {r.key[len(pre):] for r in db.query(ReminderLog.key).filter(ReminderLog.key.like(pre + "%")).all()}


def set_skipped(db: Session, project_id: str, user_ids: list[str]) -> None:
    want = set(user_ids)
    have = skipped(db, project_id)
    for uid in have - want:
        db.query(ReminderLog).filter(ReminderLog.key == _skip_key(project_id, uid)).delete(synchronize_session=False)
    for uid in want - have:
        db.add(ReminderLog(key=_skip_key(project_id, uid)))


def pool(db: Session, project_id: str) -> list[User]:
    """People who can be given work: active extractors on the project who are not set aside."""
    off = skipped(db, project_id)
    rows = (db.query(User).join(ProjectMember, ProjectMember.user_id == User.id)
            .filter(ProjectMember.project_id == project_id, ProjectMember.role == UserRole.PIPELINE_OPERATOR, User.is_active == True)  # noqa: E712
            .order_by(User.full_name).all())
    return [u for u in rows if u.id not in off]


def _state(db: Session, project_id: str):
    srcs = db.query(Source).filter(Source.project_id == project_id, Source.assigned_extractor_id != None, Source.status.in_(WORKING)).all()  # noqa: E711
    ids = [s.id for s in srcs]
    obs: dict = {}
    for r in ob.rows_for(db, ids):
        obs.setdefault(r.source_id, []).append(r)
    jobs = {j[0] for j in db.query(ExtractionJob.source_id).filter(ExtractionJob.source_id.in_(ids)).all()} if ids else set()
    parked, touched = set(), set()
    for s in srcs:
        for r in obs.get(s.id, []):
            if r.kind in ob.KINDS and ob.KINDS[r.kind][2]:
                parked.add(s.id)
            if r.user_id == s.assigned_extractor_id:
                touched.add(s.id)
    return srcs, parked, touched, jobs


def _movable(s: Source, touched: set, jobs: set) -> bool:
    return (s.status == SourceStatus.NOT_STARTED and not (s.total_records or 0) and s.id not in jobs
            and s.extraction_started_at is None and s.id not in touched)


def snapshot(db: Session, project_id: str) -> dict:
    """Per-person counts, for the screen."""
    srcs, parked, touched, jobs = _state(db, project_id)
    people = pool(db, project_id)
    out = {u.id: {"user_id": u.id, "name": u.full_name, "load": 0, "started": 0, "movable": 0, "parked": 0} for u in people}
    for s in srcs:
        row = out.get(s.assigned_extractor_id)
        if not row:
            continue
        if s.id in parked:
            row["parked"] += 1
            continue
        row["load"] += 1
        if _movable(s, touched, jobs):
            row["movable"] += 1
        else:
            row["started"] += 1
    return out


def run_project(db: Session, project_id: str, commit: bool = True) -> dict:
    """Even out one project. Returns {moves: [...], before: {uid: load}, after: {uid: load}}."""
    result = {"moves": [], "before": {}, "after": {}}
    if not enabled(db, project_id):
        return result
    people = pool(db, project_id)
    if len(people) < 2:
        return result
    srcs, parked, touched, jobs = _state(db, project_id)
    by_id = {u.id: u for u in people}
    load = {u.id: 0 for u in people}
    mine: dict = {u.id: [] for u in people}
    orphans: list = []          # unstarted sources held by someone who is no longer in the pool
    for s in srcs:
        if s.id in parked:
            continue
        uid = s.assigned_extractor_id
        if uid in load:
            load[uid] += 1
            if _movable(s, touched, jobs):
                mine[uid].append(s)
        elif _movable(s, touched, jobs):
            orphans.append(s)
    result["before"] = dict(load)
    peers = {s.id: {p.user_id for p in s.peer_reviews} for s in srcs}
    earlier: dict = {}
    for r in db.query(SourceRound.source_id, SourceRound.extractor_id).filter(SourceRound.source_id.in_(list(peers))).all() if peers else []:
        earlier.setdefault(r[0], set()).add(r[1])

    def ok_for(s: Source, uid: str) -> bool:
        return uid not in peers.get(s.id, set()) and uid not in earlier.get(s.id, set()) and uid != s.assigned_extractor_id

    def move(s: Source, to: str, why: str):
        frm = s.assigned_extractor_id
        s.assigned_extractor_id = to
        result["moves"].append({"source_id": s.id, "name": s.name, "from": frm, "to": to, "why": why})
        db.add(AuditLog(user_id=None, project_id=s.project_id, source_id=s.id, action=AuditAction.SOURCE_ASSIGNED,
                        before_value={"extractor_id": frm}, after_value={"extractor_id": to, "auto_balance": True, "reason": why}))

    # 1. sources held by people who are no longer on the team go to whoever has the least
    for s in orphans:
        for uid in sorted(load, key=lambda u: load[u]):
            if ok_for(s, uid):
                move(s, uid, "Previous extractor is no longer on the team")
                load[uid] += 1
                mine[uid].append(s)
                break
    # 2. move unstarted sources from the busiest to the least busy until everyone is within one of each other
    for _ in range(MAX_MOVES):
        order = sorted(load, key=lambda u: load[u])
        done = False
        for lo in order:
            for hi in reversed(order):
                if load[hi] - load[lo] < 2:
                    break
                cand = next((s for s in reversed(mine[hi]) if ok_for(s, lo)), None)
                if cand:
                    move(cand, lo, "Keeps everyone's remaining work even")
                    mine[hi].remove(cand)
                    mine[lo].append(cand)
                    load[hi] -= 1
                    load[lo] += 1
                    done = True
                    break
            if done:
                break
        if not done:
            break
    result["after"] = dict(load)
    key = f"balance:last:{project_id}"
    row = db.query(ReminderLog).filter(ReminderLog.key == key).first()
    if row:
        row.created_at = datetime.now(timezone.utc)
    else:
        db.add(ReminderLog(key=key))
    if result["moves"]:
        _tell(db, project_id, result["moves"], by_id)
    if commit:
        db.commit()
    return result


def _tell(db: Session, project_id: str, moves: list, people: dict) -> None:
    got: dict = {}
    lost: dict = {}
    for m in moves:
        got.setdefault(m["to"], []).append(m["name"])
        if m["from"]:
            lost.setdefault(m["from"], []).append(m["name"])
    names = lambda l: ", ".join(l[:6]) + (f" and {len(l) - 6} more" if len(l) > 6 else "")  # noqa: E731
    for uid, l in got.items():
        notify(db, uid, f"{len(l)} new {'source' if len(l) == 1 else 'sources'} to extract",
               f"To keep everyone's work even, these were moved to you: {names(l)}. None of them had been started.", "/triage", "assigned", ACTION, dedupe=False)
    for uid, l in lost.items():
        notify(db, uid, f"{len(l)} unstarted {'source was' if len(l) == 1 else 'sources were'} moved to a teammate",
               f"To keep everyone's work even: {names(l)}. Nothing you had started was touched.", None, "reassigned", INFO, dedupe=False)
    owner = db.query(Project.owner_id).filter(Project.id == project_id).scalar()
    if owner:
        notify(db, owner, f"Work rebalanced: {len(moves)} {'source' if len(moves) == 1 else 'sources'} moved",
               "Moved automatically so every extractor has about the same amount left. See Work balance for the list.", "/balance", "rebalanced", INFO, dedupe=False)


def run_all(db: Session) -> int:
    """Called by the background loop."""
    n = 0
    for p in db.query(Project).filter(Project.deleted_at == None).all():  # noqa: E711
        try:
            n += len(run_project(db, p.id)["moves"])
        except Exception:
            db.rollback()
    return n


def recent_moves(db: Session, project_id: str, limit: int = 40) -> list:
    rows = (db.query(AuditLog).filter(AuditLog.project_id == project_id, AuditLog.action == AuditAction.SOURCE_ASSIGNED, AuditLog.user_id == None)  # noqa: E711
            .order_by(AuditLog.timestamp.desc()).limit(limit).all())
    rows = [r for r in rows if isinstance(r.after_value, dict) and r.after_value.get("auto_balance")]
    uids = {r.after_value.get("extractor_id") for r in rows} | {(r.before_value or {}).get("extractor_id") for r in rows}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_([x for x in uids if x])).all()} if uids else {}
    srcs = {s.id: s.name for s in db.query(Source).filter(Source.id.in_([r.source_id for r in rows if r.source_id])).all()} if rows else {}
    return [{"at": r.timestamp, "source_id": r.source_id, "source": srcs.get(r.source_id), "from": names.get((r.before_value or {}).get("extractor_id")),
             "to": names.get(r.after_value.get("extractor_id")), "why": r.after_value.get("reason")} for r in rows]
