"""Batch report: one page of facts for everything Xtrium gave us on one day, built from the platform's own data.

A batch is the group of sources pulled from Xtrium on the same day (Nairobi time), the same grouping the Process report uses.
Nothing here is typed in by hand: counts, blocked items, people and accuracy are all read when the report is opened."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.all_models import (
    ClientQuestion, ExtractedRecord, ExtractionJob, ReviewStatus, Source, SourceLinkCheck, SourceStatus, User,
)
from app.services import enh, observations as obs, quality as q

STAGES = [
    ("delivered", "Delivered"), ("signoff", "Ready for sign-off"), ("peer_review", "In peer review"),
    ("needs_fixes", "Needs fixes"), ("extracting", "Extracting"), ("not_started", "Not started"), ("blocked", "Blocked"),
]
LINK_WHY = {"dead": "The link no longer opens", "blocked": "The site blocks automated access", "login": "The page needs a sign-in"}


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _stage(s: Source) -> str:
    st = s.status
    if st == SourceStatus.APPROVED:
        return "delivered"
    if st == SourceStatus.NOT_STARTED:
        return "not_started"
    if st == SourceStatus.EXTRACTING:
        return "extracting"
    if st in (SourceStatus.NEEDS_FIXES, SourceStatus.CHANGES_REQUESTED):
        return "needs_fixes"
    peers = list(s.peer_reviews or [])
    if peers and all(p.status == "submitted" for p in peers):
        return "signoff"
    return "peer_review"


def list_batches(srcs: list) -> list[dict]:
    pb = q.pull_batches(srcs)
    groups: dict = {}
    for s in srcs:
        b = pb.get(s.id)
        if not b:
            continue
        g = groups.setdefault(b["key"], {"key": b["key"], "label": b["label"], "date": b["date"], "sources": 0, "delivered": 0})
        g["sources"] += 1
        g["delivered"] += 1 if s.status == SourceStatus.APPROVED else 0
    return sorted(groups.values(), key=lambda g: (g["key"] == "other", g["date"]), reverse=False)


def _days(a, b):
    a, b = _aware(a), _aware(b)
    return round((b - a).total_seconds() / 86400, 1) if a and b else None


def _net_days(days, held_seconds):
    """Days with the time spent on hold taken out."""
    if days is None:
        return None
    return max(0.0, round(days - (held_seconds or 0) / 86400, 1))


def assemble(db: Session, user: User, srcs: list, key: str, sc: dict | None) -> dict:
    pb = q.pull_batches(srcs)
    mine = [s for s in srcs if (pb.get(s.id) or {}).get("key") == key]
    if not mine:
        raise HTTPException(status_code=404, detail="That batch has no sources you can see.")
    label, date = pb[mine[0].id]["label"], pb[mine[0].id]["date"]
    ids = [s.id for s in mine]
    now = enh.now_utc()

    # records per source (escalation-only placeholders are not data records)
    counts = {sid: [0, 0] for sid in ids}
    for sid, n, ok in (db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id),
                                func.sum(case((ExtractedRecord.review_status == ReviewStatus.APPROVED, 1), else_=0)))
                       .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
                       .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == False)  # noqa: E712
                       .group_by(ExtractionJob.source_id).all()):
        counts[sid] = [int(n or 0), int(ok or 0)]

    # why a source is blocked
    blocked: dict = {}   # source_id -> {kind, reason}
    checks = {c.source_id: c for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_(ids)).all()}
    for s in mine:
        c = checks.get(s.id)
        if s.status != SourceStatus.APPROVED and c and c.status in LINK_WHY:
            blocked[s.id] = {"kind": "link", "reason": LINK_WHY[c.status], "detail": c.detail}
    for sid, reason in (db.query(ExtractionJob.source_id, ExtractedRecord.escalation_reason)
                        .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
                        .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == True,  # noqa: E712
                                ExtractedRecord.review_status != ReviewStatus.APPROVED).all()):
        src = next(x for x in mine if x.id == sid)
        if src.status != SourceStatus.APPROVED:
            blocked[sid] = {"kind": "nodata", "reason": (reason or "No extractable data").strip(), "detail": None}
    asks = {}
    for cq in db.query(ClientQuestion).filter(ClientQuestion.source_id.in_(ids), ClientQuestion.status == "open").all():
        asks.setdefault(cq.source_id, []).append(cq.question)

    for s in mine:
        if s.id in asks and s.id not in blocked and s.status != SourceStatus.APPROVED:
            blocked[s.id] = {"kind": "question", "reason": "Waiting on the client", "detail": " / ".join(asks[s.id])[:200]}

    # what extractors and reviewers recorded: issues that block a source join the blocked list too
    obs_rows = obs.rows_for(db, ids)
    by_src: dict = {}
    for o in obs_rows:
        if o.kind != "none":
            by_src.setdefault(o.source_id, []).append(o)
    for s in mine:
        if s.status == SourceStatus.APPROVED or s.id in blocked:
            continue
        hard = [o for o in by_src.get(s.id, []) if obs.KINDS.get(o.kind, ("", "", False))[2]]
        if hard:
            top = hard[0]
            blocked[s.id] = {"kind": "observed", "reason": obs.LABEL.get(top.kind, top.kind), "detail": (top.note or "")[:120] or None, "group": obs.KINDS[top.kind][1]}

    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({s.assigned_extractor_id for s in mine} | {p.user_id for s in mine for p in s.peer_reviews} | {s.assigned_reviewer_id for s in mine if s.assigned_reviewer_id})).all()}
    qrow = {r["source_id"]: r for r in (sc or {}).get("batches", [])}

    rows, stages = [], {k: 0 for k, _ in STAGES}
    from app.services import holds
    held_now = set(holds.held_since(db, ids))
    held_s = holds.held_seconds(db, mine)
    for s in mine:
        stage = "blocked" if s.id in blocked else _stage(s)
        stages[stage] += 1
        n, ok = counts[s.id]
        qr = qrow.get(s.id) or {}
        end = s.approved_at if s.status == SourceStatus.APPROVED else now
        rows.append({
            "source_id": s.id, "project_id": s.project_id, "name": s.name, "item_no": s.external_ref_id, "url": s.website_url,
            "type": s.type or (s.schema.name if s.schema else None), "sop": ((s.xtrium_sop or {}).get("meta") or {}).get("sop_code"),
            "project": s.project.name if s.project else None, "stage": stage, "status": getattr(s.status, "value", s.status),
            "records": n, "approved": ok, "peers_done": sum(1 for p in s.peer_reviews if p.status == "submitted"), "peers_total": len(s.peer_reviews),
            "days": _net_days(_days(s.created_at, end), held_s.get(s.id)), "on_hold": s.id in held_now and s.status != SourceStatus.APPROVED,
            "submitted_to_xtrium": bool(s.xtrium_submitted_at),
            "approved_at": s.approved_at.isoformat() if s.approved_at else None, "submitted_at": s.xtrium_submitted_at.isoformat() if s.xtrium_submitted_at else None,
            "fields": qr.get("fields"), "errors": qr.get("errors"), "errors_per_100": qr.get("errors_per_100"),
            "first_pass_accuracy": qr.get("first_pass_accuracy"), "final_accuracy": qr.get("final_accuracy"),
        })
    rows.sort(key=lambda r: ([k for k, _ in STAGES].index(r["stage"]), r["name"].lower()))

    total = len(mine)
    delivered = stages["delivered"]
    recs_total = sum(c[0] for c in counts.values())
    recs_ok = sum(c[1] for c in counts.values())
    done_days = [r["days"] for r in rows if r["stage"] == "delivered" and r["days"] is not None]
    waiting = [r for r in rows if r["stage"] != "delivered" and r["days"] is not None and not r.get("on_hold")]

    # blocked groups, each with what we need from the client or the team
    groups: dict = {}
    for s in mine:
        b = blocked.get(s.id)
        if b:
            need = {"link": "A corrected link, or OK to skip", "question": "An answer to the open questions", "observed": obs.NEED.get(b.get("group"), "A decision on this source")}.get(b["kind"], "Confirm there is nothing to extract, or a different source")
            g = groups.setdefault((b["kind"], b["reason"]), {"kind": b["kind"], "title": b["reason"], "need": need, "items": []})
            g["items"].append({"source_id": s.id, "project_id": s.project_id, "name": s.name, "item_no": s.external_ref_id, "detail": b["detail"]})
    blocked_groups = sorted(groups.values(), key=lambda g: -len(g["items"]))

    by_type: dict = {}
    for r in rows:
        t = by_type.setdefault(r["type"] or "Not set", {"type": r["type"] or "Not set", "total": 0, "delivered": 0})
        t["total"] += 1
        t["delivered"] += 1 if r["stage"] == "delivered" else 0

    team = {"extractors": len({s.assigned_extractor_id for s in mine if s.assigned_extractor_id}),
            "reviewers": len({pr.user_id for s in mine for pr in s.peer_reviews}),
            "peer_done": sum(1 for s in mine for pr in s.peer_reviews if pr.status == "submitted"),
            "peer_total": sum(len(s.peer_reviews) for s in mine)}

    pull = next((p for p in (sc or {}).get("pulls", []) if p["key"] == key), None)
    quality = None
    if pull and pull.get("fields"):
        quality = {k: pull.get(k) for k in ("fields", "errors", "errors_per_100", "first_pass_accuracy", "final_accuracy", "caught_rate", "rework_rate", "audited")}

    pct = round(100 * delivered / total) if total else 0
    lines = [f"{delivered} of {total} sources are delivered ({pct}%), with {recs_ok} approved records."]
    inflight = total - delivered - stages["blocked"]
    if inflight:
        lines.append(f"{inflight} {'source is' if inflight == 1 else 'sources are'} still moving through extraction and review.")
    if stages["blocked"]:
        lines.append(f"{stages['blocked']} {'source is' if stages['blocked'] == 1 else 'sources are'} blocked and need a decision.")
    if done_days:
        lines.append(f"Delivered sources took {round(sum(done_days) / len(done_days), 1)} days on average from the pull.")
    if quality and quality["final_accuracy"] is not None:
        lines.append(f"Delivered data is {round(quality['final_accuracy'], 1)}% accurate across {quality['fields']} checked fields.")

    pulled = [_aware(s.created_at) for s in mine if s.created_at]
    peers_all = [pr for s in mine for pr in s.peer_reviews]
    cards = []
    full_types = [x["type"] for x in by_type.values() if x["total"] and x["delivered"] == x["total"]]
    if total:
        cards.append({"title": f"{pct}% delivered", "text": f"{delivered} of {total} sources are approved and delivered, with {recs_ok} approved records."})
    if quality and quality["final_accuracy"] is not None:
        cards.append({"title": f"{round(quality['final_accuracy'], 1)}% accurate", "text": f"Final accuracy across {quality['fields']} fields checked against the real sources."})
    if len(by_type) > 1 and full_types:
        cards.append({"title": f"{len(full_types)} {'type' if len(full_types) == 1 else 'types'} at 100%", "text": ", ".join(full_types[:3]) + (" are" if len(full_types) > 1 else " is") + " fully delivered."})
    if delivered and any(r["submitted_to_xtrium"] for r in rows):
        n_sub = sum(1 for r in rows if r["submitted_to_xtrium"])
        cards.append({"title": f"{n_sub} sent to Xtrium", "text": f"{n_sub} of {delivered} delivered sources have been submitted back to Xtrium."})
    if peers_all:
        done = sum(1 for p in peers_all if p.status == "submitted")
        cards.append({"title": f"{done} of {len(peers_all)} peer reviews", "text": "Every source gets independent peer reviews before sign-off." if done == len(peers_all) else "Peer reviews submitted so far across this batch."})
    if done_days:
        cards.append({"title": f"{round(sum(done_days) / len(done_days), 1)} days average", "text": "From the pull to delivery, for the sources already delivered."})
    return {
        "key": key, "label": label, "date": date, "generated_at": now,
        "totals": {"sources": total, "delivered": delivered, "percent": pct, "records": recs_total, "records_approved": recs_ok,
                   "blocked": stages["blocked"], "on_hold": sum(1 for r in rows if r.get("on_hold")), "in_progress": inflight, "submitted_to_xtrium": sum(1 for r in rows if r["submitted_to_xtrium"])},
        "stages": [{"key": k, "label": l, "count": stages[k]} for k, l in STAGES],
        "by_type": sorted(by_type.values(), key=lambda t: -t["total"]),
        "blocked": blocked_groups, "sources": rows, "team": team,
        "observations": obs.counts(obs_rows), "observation_checks": {"done": sum(1 for s in mine for o in obs.who_owes(s, obs_rows) if o["done"]), "total": sum(len(obs.who_owes(s, obs_rows)) for s in mine)},
        "quality": quality, "highlights": lines, "cards": cards[:4], "projects": sorted({r["project"] for r in rows if r["project"]}),
        "sops": sorted({r["sop"] for r in rows if r["sop"]}),
        "timing": {"avg_days_delivered": round(sum(done_days) / len(done_days), 1) if done_days else None,
                   "longest_waiting_days": max((r["days"] for r in waiting), default=None),
                   "pulled_at": min(pulled).isoformat() if pulled else None},
    }


def engagement(db: Session, user: User, srcs: list, sc: dict | None) -> dict:
    """The whole engagement across every batch: one phase per pull, SOP coverage, recurring problems, the platform in numbers
    and the latest batch in detail. Everything is read from the platform when the report is opened."""
    batches = list_batches(srcs)
    reps = [assemble(db, user, srcs, b["key"], sc) for b in batches]
    pulled = [r for r in reps if r["key"] != "other"]
    phases = []
    for r in reps:
        tp = sorted(r["by_type"], key=lambda x: -x["total"])
        phases.append({"key": r["key"], "label": r["label"], "date": r["date"], "sources": r["totals"]["sources"], "delivered": r["totals"]["delivered"],
                       "records": r["totals"]["records_approved"], "percent": r["totals"]["percent"], "blocked": r["totals"]["blocked"],
                       "status": "covered" if r["totals"]["sources"] == r["totals"]["delivered"] else "in_progress",
                       "types": [x["type"] for x in tp[:3]], "accuracy": (r["quality"] or {}).get("final_accuracy")})
    ids = [s.id for s in srcs]
    sop_total: dict = {}
    latest = pulled[-1] if pulled else (reps[-1] if reps else None)
    latest_ids = {x["source_id"] for x in latest["sources"]} if latest else set()
    earlier_sops = {x["sop"] for r in pulled[:-1] for x in r["sources"] if x["sop"]}
    for r in reps:
        for x in r["sources"]:
            code = x["sop"] or "No SOP saved"
            d = sop_total.setdefault(code, {"code": code, "total": 0, "delivered": 0, "new": False})
            d["total"] += 1
            d["delivered"] += 1 if x["stage"] == "delivered" else 0
    for code, d in sop_total.items():
        d["new"] = bool(latest and len(pulled) > 1 and code not in earlier_sops and code != "No SOP saved")
    by_sop = sorted(sop_total.values(), key=lambda d: (d["code"] == "No SOP saved", d["code"]))

    all_obs = obs.rows_for(db, ids)
    stage_tot: dict = {}
    for r in reps:
        for st in r["stages"]:
            stage_tot[st["key"]] = stage_tot.get(st["key"], 0) + st["count"]
    stages_all = [{"key": k, "label": l, "count": stage_tot.get(k, 0)} for k, l in STAGES]
    kinds: dict = {}
    merged: dict = {}
    for r in reps:
        for g in r["blocked"]:
            k = kinds.setdefault(g["kind"], {"kind": g["kind"], "count": 0, "examples": [], "reasons": {}})
            k["count"] += len(g["items"])
            k["reasons"][g["title"]] = k["reasons"].get(g["title"], 0) + len(g["items"])
            k["examples"] += [i["name"] for i in g["items"]][: max(0, 3 - len(k["examples"]))]
            m = merged.setdefault((g["kind"], g["title"]), {"kind": g["kind"], "title": g["title"], "need": g["need"], "items": []})
            m["items"] += [{**i, "batch": r["label"]} for i in g["items"]]

    pids = {s.project_id for s in srcs}
    qs = db.query(ClientQuestion).filter(ClientQuestion.project_id.in_(pids)).order_by(ClientQuestion.created_at).all() if pids else []
    topics: dict = {}
    for x in qs:
        tp = topics.setdefault(x.topic or "General", {"topic": x.topic or "General", "asked": 0, "answered": 0})
        tp["asked"] += 1
        tp["answered"] += 1 if x.status == "answered" else 0
    qa = {"topics": sorted(topics.values(), key=lambda z: -z["asked"]),
          "items": [{"topic": x.topic or "General", "question": x.question, "answer": x.answer, "status": x.status} for x in qs],
          "open": sum(1 for x in qs if x.status == "open"), "answered": sum(1 for x in qs if x.status == "answered")}
    peers = [p for s in srcs for p in s.peer_reviews]
    cum = (sc or {}).get("cumulative") or {}
    tot_sources = sum(p["sources"] for p in phases)
    tot_deliv = sum(p["delivered"] for p in phases)
    totals = {
        "sources": tot_sources, "delivered": tot_deliv, "batches": len(pulled), "batches_covered": sum(1 for p in phases if p["status"] == "covered" and p["key"] != "other"),
        "batches_open": sum(1 for p in phases if p["status"] != "covered" and p["key"] != "other"), "sops": len([c for c in sop_total if c != "No SOP saved"]),
        "records_approved": sum(p["records"] for p in phases), "submitted": sum(r["totals"]["submitted_to_xtrium"] for r in reps),
        "blocked": sum(p["blocked"] for p in phases), "peer_done": sum(1 for p in peers if p.status == "submitted"), "peer_total": len(peers),
        "questions_asked": len(qs), "questions_answered": sum(1 for x in qs if x.status == "answered"),
        "fields": cum.get("fields"), "errors": cum.get("errors"), "final_accuracy": cum.get("final_accuracy"), "first_pass_accuracy": cum.get("first_pass_accuracy"),
        "errors_per_100": cum.get("errors_per_100"), "caught_rate": cum.get("caught_rate"),
    }
    firsts = [r["timing"]["pulled_at"] for r in pulled if r["timing"]["pulled_at"]]
    nxt = []
    open_sources = tot_sources - tot_deliv
    if latest and latest["totals"]["sources"] != latest["totals"]["delivered"]:
        nxt.append({"title": "Complete the current batch", "text": f"Finish the {latest['totals']['sources'] - latest['totals']['delivered']} remaining sources in {latest['label']}."})
    if totals["blocked"]:
        nxt.append({"title": "Clear what is blocked", "text": f"{totals['blocked']} sources need a decision from the client or the team: a corrected link, an answer, or confirmation to skip."})
    if totals["submitted"] < tot_deliv:
        nxt.append({"title": "Send delivered work to Xtrium", "text": f"{tot_deliv - totals['submitted']} approved sources have not been submitted back to Xtrium yet."})
    nxt.append({"title": "Keep the peer-review structure", "text": "Continue independent peer review and the sign-off step for every new assignment."})
    return {
        "generated_at": enh.now_utc(), "projects": sorted({p for r in reps for p in r["projects"]}), "period_from": min(firsts) if firsts else None,
        "stages": stages_all, "observations": obs.counts(all_obs), "qa": qa, "totals": totals, "phases": phases, "by_sop": by_sop, "challenges": sorted(kinds.values(), key=lambda k: -k["count"]),
        "blocked": sorted(merged.values(), key=lambda g: -len(g["items"])), "latest": latest, "next": nxt[:3], "open_sources": open_sources,
        "delivered_rows": sorted(({"name": x["name"], "project": x["project"], "item_no": x["item_no"], "records": x["approved"], "approved_at": x["approved_at"], "submitted_at": x["submitted_at"], "batch": r["label"]}
                                  for r in reps for x in r["sources"] if x["stage"] == "delivered"), key=lambda x: x["approved_at"] or "", reverse=True),
    }
