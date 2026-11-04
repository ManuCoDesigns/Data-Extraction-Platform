"""One page for the team lead: everything that needs attention today, read live from the platform."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.models.all_models import ClientQuestion, Project, Source, SourceLinkCheck, SourceStatus, User
from app.services import balance, enh, holds
from app.services.batch_report import LINK_WHY


def _item(s, text, days=None, who=None):
    return {"source_id": s.id, "project_id": s.project_id, "name": s.name, "text": text, "days": days, "who": who}


def _sec(key, title, level, items, hint):
    return {"key": key, "title": title, "level": level if items else "ok", "count": len(items), "hint": hint, "items": items[:25]}


def build(db: Session, srcs: list) -> dict:
    now = enh.now_utc()
    open_src = [s for s in srcs if s.status != SourceStatus.APPROVED]
    by_id = {s.id: s for s in srcs}
    rows = enh.waiting_items(db, open_src)
    held = holds.held_since(db, [s.id for s in open_src])

    overdue = sorted([r for r in rows if r["level"] != "ok"], key=lambda r: -r["days"])
    sec = []
    sec.append(_sec("overdue", "Waiting too long", "red" if any(r["level"] == "red" for r in overdue) else "amber",
                    [_item(by_id[r["source_id"]], f"{r['stage']}: {r['name']}", r["days"], r["name"]) for r in overdue if r["source_id"] in by_id],
                    "Three days or more in the same stage. Nudge the person or move the source."))
    adm = [r for r in rows if r["role"] == "admin"]
    sec.append(_sec("signoff", "Ready for your sign-off", "amber", [_item(by_id[r["source_id"]], r["stage"], r["days"]) for r in sorted(adm, key=lambda r: -r["days"])],
                    "Peer review is done or not needed. Only the admin decision is left."))
    una = [r for r in rows if r["role"] == "unassigned"]
    sec.append(_sec("unassigned", "Nobody assigned", "amber", [_item(by_id[r["source_id"]], "No extractor yet", r["days"]) for r in sorted(una, key=lambda r: -r["days"])],
                    "Share them across the team from Team workload."))
    peers = [r for r in rows if r["role"] == "peer reviewer" and r["stage"] == "Peer review"]
    sec.append(_sec("peers", "Peer reviews pending", "amber", [_item(by_id[r["source_id"]], "Peer review", r["days"], r["name"]) for r in sorted(peers, key=lambda r: -r["days"])],
                    "A reviewer has not submitted yet."))
    back = [s for s in open_src if s.status in (SourceStatus.CHANGES_REQUESTED, SourceStatus.NEEDS_FIXES) and s.id not in held]
    sec.append(_sec("corrections", "Sent back for corrections", "amber",
                    [_item(s, "Corrections requested", round((now - (enh.stage_since(s) or now)).total_seconds() / 86400, 1)) for s in back],
                    "The extractor has to fix these before review can continue."))

    ids = [s.id for s in open_src]
    bad = []
    if ids:
        for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_(ids)).all():
            if c.status in LINK_WHY and c.source_id in by_id:
                bad.append(_item(by_id[c.source_id], LINK_WHY[c.status]))
    asks = db.query(ClientQuestion).filter(ClientQuestion.status == "open", ClientQuestion.project_id.in_({s.project_id for s in srcs})).all() if srcs else []
    qitems = []
    for x in asks:
        s = by_id.get(x.source_id)
        age = round((now - enh.aware(x.created_at)).total_seconds() / 86400, 1) if x.created_at else None
        qitems.append({"source_id": x.source_id, "project_id": x.project_id, "name": s.name if s else "General", "text": x.question[:140], "days": age, "who": "Client"})
    sec.append(_sec("client", "Waiting on the client", "amber", bad + sorted(qitems, key=lambda i: -(i["days"] or 0)),
                    "Open questions and links we cannot open. Send them together."))
    done_unsent = [s for s in srcs if s.status == SourceStatus.APPROVED and not getattr(s, "xtrium_submitted_at", None)]
    sec.append(_sec("unsent", "Approved, not sent to Xtrium", "amber", [_item(s, "Approved, waiting to be sent") for s in done_unsent],
                    "Delivered work the client has not received yet."))
    sec.append(_sec("hold", "On hold", "info", [_item(by_id[i], "Clock stopped") for i in held if i in by_id], "Their clock is paused. Release them when the priority work is done."))

    # workload: who has too much, who is free
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({s.assigned_extractor_id for s in open_src if s.assigned_extractor_id})).all()} if open_src else {}
    load: dict = {}
    for s in open_src:
        if s.assigned_extractor_id and s.id not in held:
            load[s.assigned_extractor_id] = load.get(s.assigned_extractor_id, 0) + 1
    pids = {s.project_id for s in open_src}
    pool_ids = set()
    for pid in pids:
        try:
            pool_ids |= {u.id for u in balance.pool(db, pid)}
        except Exception:
            pass
    for uid in pool_ids:
        load.setdefault(uid, 0)
        names.setdefault(uid, (db.query(User).filter(User.id == uid).first() or User(full_name="")).full_name)
    people = sorted(({"user_id": uid, "name": names.get(uid), "open": n} for uid, n in load.items()), key=lambda p: -p["open"])
    avg = sum(p["open"] for p in people) / len(people) if people else 0
    heavy = [p for p in people if avg and p["open"] >= max(avg * 1.5, avg + 2)]
    free = [p for p in people if p["open"] == 0]

    counts = {s["key"]: s["count"] for s in sec}
    attention = sum(counts[k] for k in ("overdue", "signoff", "unassigned", "corrections", "client", "unsent"))
    heads = []
    if counts["overdue"]:
        heads.append(f"{counts['overdue']} {'item has' if counts['overdue'] == 1 else 'items have'} waited three days or more")
    if counts["signoff"]:
        heads.append(f"{counts['signoff']} {'source is' if counts['signoff'] == 1 else 'sources are'} ready for your sign-off")
    if counts["unassigned"]:
        heads.append(f"{counts['unassigned']} {'source has' if counts['unassigned'] == 1 else 'sources have'} nobody assigned")
    if counts["client"]:
        heads.append(f"{counts['client']} {'point is' if counts['client'] == 1 else 'points are'} waiting on the client")
    if counts["unsent"]:
        heads.append(f"{counts['unsent']} approved {'source has' if counts['unsent'] == 1 else 'sources have'} not gone to Xtrium")
    if heavy and free:
        heads.append(f"{heavy[0]['name']} has {heavy[0]['open']} open while {len(free)} {'person has' if len(free) == 1 else 'people have'} none")
    return {
        "generated_at": now.isoformat(),
        "totals": {"open": len(open_src), "delivered": len(srcs) - len(open_src), "attention": attention, "on_hold": counts["hold"]},
        "headline": heads or ["Nothing needs your attention right now."],
        "sections": sec, "people": people, "heavy": heavy, "free": free,
    }


def text(brief: dict) -> str:
    """Plain text for Slack or email."""
    lines = ["Team lead brief", ""] + [f"• {h}" for h in brief["headline"]] + [""]
    for s in brief["sections"]:
        if not s["count"]:
            continue
        lines.append(f"{s['title']} ({s['count']})")
        for i in s["items"][:8]:
            tail = f" · {i['days']} days" if i.get("days") is not None else ""
            lines.append(f"  - {i['name']}: {i['text']}{tail}")
        lines.append("")
    return "\n".join(lines).strip()


def run_month_notice(db: Session) -> int:
    """On the first tick of a month, tell the leads that last month's report is ready to open with one click."""
    from app.core.notify import ACTION, notify
    from app.models.all_models import ReminderLog, UserRole, UserRoleAssignment
    from app.services import quality as q
    from datetime import datetime, timezone as _tz
    nairobi = _tz(timedelta(hours=3))
    now = datetime.now(nairobi)
    y, m = (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
    prev = f"{y}-{m:02d}"
    key = f"report:ready:{now.strftime('%Y-%m')}"
    if db.query(ReminderLog.key).filter(ReminderLog.key == key).first():
        return 0
    db.add(ReminderLog(key=key))
    db.commit()
    srcs = db.query(Source).filter(Source.external_ref_id != None).all()  # noqa: E711
    pb = q.pull_batches(srcs)
    mine = [s for s in srcs if (pb.get(s.id) or {}).get("key", "").startswith(prev)]
    if not mine:
        return 0
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    done = sum(1 for s in mine if s.status == SourceStatus.APPROVED)
    ids = {a.user_id for a in db.query(UserRoleAssignment).filter(UserRoleAssignment.role.in_([UserRole.ORG_ADMIN, UserRole.PROJECT_ADMIN, UserRole.QA_LEAD])).all()}
    n = 0
    for u in db.query(User).filter(User.id.in_(ids), User.is_active == True).all():  # noqa: E712
        notify(db, u.id, f"Your {names[m - 1]} report is ready",
               f"{done} of {len(mine)} sources pulled in {names[m - 1]} are delivered. Open Batch report and press Generate.",
               link="/quality?tab=batch", kind="report_ready", priority=ACTION)
        n += 1
    db.commit()
    return n
