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
from app.services import enh, quality as q

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

    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({s.assigned_extractor_id for s in mine} | {p.user_id for s in mine for p in s.peer_reviews} | {s.assigned_reviewer_id for s in mine if s.assigned_reviewer_id})).all()}
    qrow = {r["source_id"]: r for r in (sc or {}).get("batches", [])}

    rows, stages = [], {k: 0 for k, _ in STAGES}
    for s in mine:
        stage = "blocked" if s.id in blocked else _stage(s)
        stages[stage] += 1
        n, ok = counts[s.id]
        qr = qrow.get(s.id) or {}
        end = s.approved_at if s.status == SourceStatus.APPROVED else now
        rows.append({
            "source_id": s.id, "project_id": s.project_id, "name": s.name, "item_no": s.external_ref_id, "url": s.website_url,
            "type": s.type or (s.schema.name if s.schema else None), "stage": stage, "status": getattr(s.status, "value", s.status),
            "records": n, "approved": ok, "extractor": names.get(s.assigned_extractor_id), "reviewers": [names.get(p.user_id, "?") for p in s.peer_reviews],
            "days": _days(s.created_at, end), "submitted_to_xtrium": bool(s.xtrium_submitted_at),
            "fields": qr.get("fields"), "errors": qr.get("errors"), "errors_per_100": qr.get("errors_per_100"),
            "first_pass_accuracy": qr.get("first_pass_accuracy"), "final_accuracy": qr.get("final_accuracy"),
        })
    rows.sort(key=lambda r: ([k for k, _ in STAGES].index(r["stage"]), r["name"].lower()))

    total = len(mine)
    delivered = stages["delivered"]
    recs_total = sum(c[0] for c in counts.values())
    recs_ok = sum(c[1] for c in counts.values())
    done_days = [r["days"] for r in rows if r["stage"] == "delivered" and r["days"] is not None]
    waiting = [r for r in rows if r["stage"] != "delivered" and r["days"] is not None]

    # blocked groups, each with what we need from the client or the team
    groups: dict = {}
    for s in mine:
        b = blocked.get(s.id)
        if b:
            need = {"link": "A corrected link, or OK to skip", "question": "An answer to the open questions"}.get(b["kind"], "Confirm there is nothing to extract, or a different source")
            g = groups.setdefault((b["kind"], b["reason"]), {"kind": b["kind"], "title": b["reason"], "need": need, "items": []})
            g["items"].append({"source_id": s.id, "project_id": s.project_id, "name": s.name, "item_no": s.external_ref_id, "detail": b["detail"]})
    blocked_groups = sorted(groups.values(), key=lambda g: -len(g["items"]))

    by_type: dict = {}
    for r in rows:
        t = by_type.setdefault(r["type"] or "Not set", {"type": r["type"] or "Not set", "total": 0, "delivered": 0})
        t["total"] += 1
        t["delivered"] += 1 if r["stage"] == "delivered" else 0

    people: dict = {}
    for r, s in zip(rows, [next(x for x in mine if x.id == r["source_id"]) for r in rows]):
        if s.assigned_extractor_id:
            p = people.setdefault(s.assigned_extractor_id, {"name": names.get(s.assigned_extractor_id), "extracting": 0, "extracting_done": 0, "reviewing": 0, "reviewing_done": 0})
            p["extracting"] += 1
            p["extracting_done"] += 1 if r["stage"] == "delivered" else 0
        for pr in s.peer_reviews:
            p = people.setdefault(pr.user_id, {"name": names.get(pr.user_id), "extracting": 0, "extracting_done": 0, "reviewing": 0, "reviewing_done": 0})
            p["reviewing"] += 1
            p["reviewing_done"] += 1 if pr.status == "submitted" else 0

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
    return {
        "key": key, "label": label, "date": date, "generated_at": now,
        "totals": {"sources": total, "delivered": delivered, "percent": pct, "records": recs_total, "records_approved": recs_ok,
                   "blocked": stages["blocked"], "in_progress": inflight, "submitted_to_xtrium": sum(1 for r in rows if r["submitted_to_xtrium"])},
        "stages": [{"key": k, "label": l, "count": stages[k]} for k, l in STAGES],
        "by_type": sorted(by_type.values(), key=lambda t: -t["total"]),
        "blocked": blocked_groups, "sources": rows, "people": sorted(people.values(), key=lambda p: -(p["extracting"] + p["reviewing"])),
        "quality": quality, "highlights": lines,
        "timing": {"avg_days_delivered": round(sum(done_days) / len(done_days), 1) if done_days else None,
                   "longest_waiting_days": max((r["days"] for r in waiting), default=None),
                   "pulled_at": min(pulled).isoformat() if pulled else None},
    }
