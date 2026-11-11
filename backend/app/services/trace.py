"""Trace everything we ask for and wait on, and how long delivery really takes.

Four read-outs, all from the platform's own records:
  escalations   every question and escalation to Xtrium: when it was raised, first reply, answered, days waited
  batch clock   5 working days from the day a batch is pulled to submission to Xtrium, per source, with blocked sources set aside
  active days   the days a source really had work done on it, split into extraction and review, by size of source
  waits         stretches where nobody could work (no links, a decision, access)

Days are Nairobi days. Working days are Monday to Friday.
"""
from __future__ import annotations

import io
import math
import statistics
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.all_models import (
    AuditAction, AuditLog, ClientQuestion, ExtractedRecord, ExtractionJob, SourcePeerReview, SourceStatus, WaitPeriod,
)

NAIROBI = timezone(timedelta(hours=3))
WINDOW_WD = 5                       # working days from the day a batch is pulled to submission
SMALL, MEDIUM = 5, 50               # records: up to 5 small, up to 50 medium, above that large

# Audit entries that mean somebody worked on the source, by side
EXTRACT_ACTIONS = {AuditAction.SOURCE_DATA_UPLOADED, AuditAction.RECORD_REVISION_STARTED, AuditAction.SOURCE_RECORD_FIXED,
                   AuditAction.RECORD_ESCALATED, AuditAction.FIELD_OVERRIDDEN, AuditAction.RECORD_SENT_TO_ADMIN, AuditAction.JOB_CREATED}
REVIEW_ACTIONS = {AuditAction.RECORD_APPROVED, AuditAction.RECORD_ADMIN_REVIEWED, AuditAction.RECORD_RETURNED_FOR_CORRECTION,
                  AuditAction.RECORD_REJECTED, AuditAction.SOURCE_APPROVED, AuditAction.WORK_REVIEWED}


def aw(d):
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def now() -> datetime:
    return datetime.now(timezone.utc)


def day_of(d) -> date | None:
    d = aw(d)
    return d.astimezone(NAIROBI).date() if d else None


def is_wd(d: date) -> bool:
    return d.weekday() < 5


def add_wd(d: date, n: int) -> date:
    """The date n working days after d (d itself is day 0)."""
    cur, left = d, int(n)
    while left > 0:
        cur += timedelta(days=1)
        if is_wd(cur):
            left -= 1
    return cur


def wd_between(a, b) -> float:
    """Working days (as a fraction) that fall between two moments."""
    a, b = aw(a), aw(b)
    if not a or not b or b <= a:
        return 0.0
    a, b = a.astimezone(NAIROBI), b.astimezone(NAIROBI)
    total, cur = 0.0, a.date()
    for _ in range(800):
        if cur > b.date():
            break
        if is_wd(cur):
            lo = max(a, datetime.combine(cur, datetime.min.time(), NAIROBI))
            hi = min(b, datetime.combine(cur + timedelta(days=1), datetime.min.time(), NAIROBI))
            total += max(0.0, (hi - lo).total_seconds() / 86400)
        cur += timedelta(days=1)
    return total


def _days(a, b):
    a, b = aw(a), aw(b)
    return round((b - a).total_seconds() / 86400, 1) if a and b else None


def _iso(d):
    d = aw(d)
    return d.astimezone(NAIROBI).strftime("%Y-%m-%d %H:%M") if d else None


def _size(n: int) -> str:
    return "Small" if n <= SMALL else ("Medium" if n <= MEDIUM else "Large")


# ─── Escalations and questions ───────────────────────────────────────────────

def raised_at(q):
    return aw(q.asked_at or q.sent_to_client_at or q.created_at)


def escalation_rows(db: Session, project_ids: set, project_id: str | None = None) -> list:
    qs = db.query(ClientQuestion).filter(ClientQuestion.project_id.in_(project_ids))
    if project_id:
        qs = qs.filter(ClientQuestion.project_id == project_id)
    t = now()
    out = []
    for q in qs.all():
        start = raised_at(q)
        if not start:
            continue
        end = aw(q.answered_at) if q.status == "answered" and q.answered_at else t
        s = q.source
        ans_at = aw(q.answered_at)
        # an answer stamped within two minutes of the question, with no chat time given, was filled in later in one go: the wait was never recorded
        untimed = q.asked_at is None and q.status == "answered" and ans_at is not None and abs((ans_at - start).total_seconds()) < 120
        out.append({"timing_recorded": not untimed,
            "id": q.id, "project_id": q.project_id, "source_id": q.source_id, "source": s.name if s else None,
            "item_no": s.external_ref_id if s else None, "kind": q.kind or "question", "topic": q.topic,
            "question": q.question, "answer": q.answer, "status": "answered" if q.status == "answered" else "open",
            "blocks_clock": bool(q.blocks_clock), "raised_at": start, "first_reply_at": aw(q.first_reply_at), "answered_at": aw(q.answered_at),
            "first_reply_hours": round((aw(q.first_reply_at) - start).total_seconds() / 3600, 1) if q.first_reply_at else None,
            "waited_days": _days(start, end), "waited_working_days": round(wd_between(start, end), 1),
        })
    return sorted(out, key=lambda r: r["raised_at"])


def escalation_summary(rows: list, questions_logged: int = 0, untimed: int = 0) -> dict:
    ans = [r for r in rows if r["status"] == "answered" and r.get("timing_recorded", True)]
    opn = [r for r in rows if r["status"] == "open"]
    hrs = sorted((aw(r["answered_at"]) - r["raised_at"]).total_seconds() / 3600 for r in ans if r["answered_at"])
    return {
        "total": len(rows), "answered": len([r for r in rows if r["status"] == "answered"]), "open": len(opn), "questions_logged": questions_logged, "untimed": untimed,
        "within_2h": sum(1 for h in hrs if h < 2), "within_2d": sum(1 for h in hrs if h < 48), "longer_than_2d": sum(1 for h in hrs if h >= 48),
        "median_days": round(statistics.median(hrs) / 24, 1) if hrs else None,
        "longest_days": round(max(hrs) / 24, 1) if hrs else None,
        "longest_open_days": max((r["waited_days"] or 0 for r in opn), default=None),
    }


# ─── Waiting periods ─────────────────────────────────────────────────────────

def wait_rows(db: Session, project_ids: set, project_id: str | None = None) -> list:
    q = db.query(WaitPeriod).filter(WaitPeriod.project_id.in_(project_ids))
    if project_id:
        q = q.filter(WaitPeriod.project_id == project_id)
    t = now()
    out = []
    for w in q.order_by(WaitPeriod.started_at).all():
        end = aw(w.ended_at) or t
        out.append({"id": w.id, "project_id": w.project_id, "kind": w.kind, "reason": w.reason, "started_at": aw(w.started_at),
                    "ended_at": aw(w.ended_at), "open": w.ended_at is None,
                    "days": _days(w.started_at, end), "working_days": round(wd_between(w.started_at, end), 1)})
    return out


# ─── Batch clock ─────────────────────────────────────────────────────────────

_FLAG_WHY = {"test": "Test source, used while linking the tool to Xtrium", "covered": "Delivered earlier through Google Drive, before the tool"}


def _escalated_only(db: Session, ids: list) -> set:
    if not ids:
        return set()
    esc = {sid for (sid,) in db.query(ExtractionJob.source_id).join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
           .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == True).distinct().all()}  # noqa: E712
    real = {sid for (sid,) in db.query(ExtractionJob.source_id).join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
            .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == False).distinct().all()}  # noqa: E712
    return esc - real


def batch_clock(db: Session, sources: list, rows: list, batches: dict) -> list:
    """Per batch: the day it was pulled, the due day, and for each source on time, late, still open or set aside (blocked)."""
    by_src: dict = {}
    for r in rows:
        if r["source_id"] and r["blocks_clock"]:
            by_src.setdefault(r["source_id"], []).append(r)
    esc_only = _escalated_only(db, [s.id for s in sources])
    t = now()
    today = day_of(t)
    groups: dict = {}
    for s in sources:
        b = batches.get(s.id)
        if not b or b["key"] == "other":
            continue
        groups.setdefault(b["key"], {"label": b["label"], "items": []})["items"].append(s)
    out = []
    for key in sorted(groups):
        g = groups[key]
        pulled = min(aw(s.created_at) for s in g["items"])
        start = day_of(pulled)
        base_due = add_wd(start, WINDOW_WD)
        srcs, counted_due = [], []
        for s in g["items"]:
            sub = aw(s.xtrium_submitted_at)
            blocks = by_src.get(s.id, [])
            open_block = next((x for x in blocks if x["status"] == "open"), None)
            paused = sum(x["waited_working_days"] for x in blocks if x["status"] == "answered")
            due = add_wd(start, WINDOW_WD + math.ceil(paused))
            row = {"source_id": s.id, "name": s.name, "item_no": s.external_ref_id, "paused_working_days": round(paused, 1),
                   "due": due.isoformat(), "submitted_at": sub}
            flag = getattr(s, "trace_flag", None)
            if flag:
                row.update(state="set_aside", reason=_FLAG_WHY.get(flag, "Not counted"), flagged=flag)
            elif not sub and s.id in esc_only:
                row.update(state="set_aside", reason="Escalated: nothing to extract at the source")
            elif not sub and open_block:
                row.update(state="set_aside", reason=f"Waiting on Xtrium: {open_block['question'][:140]}")
            elif sub:
                sd = day_of(sub)
                late = max(0, sum(1 for i in range(1, 400) if (due + timedelta(days=i)) <= sd and is_wd(due + timedelta(days=i))))
                row.update(state="on_time" if sd <= due else "late", late_working_days=late)
                counted_due.append(due)
            else:
                row.update(state="overdue" if today > due else "open", working_days_left=max(0, sum(1 for i in range(1, 400) if (today + timedelta(days=i)) <= due and is_wd(today + timedelta(days=i)))))
                counted_due.append(due)
            srcs.append(row)
        counted = [r for r in srcs if r["state"] != "set_aside"]
        submitted = [r for r in counted if r["submitted_at"]]
        delivered_at = max((r["submitted_at"] for r in submitted), default=None) if counted and len(submitted) == len(counted) else None
        late_n = sum(1 for r in counted if r["state"] in ("late", "overdue"))
        if counted and len(submitted) == len(counted):
            status = "Delivered on time" if late_n == 0 else f"Delivered, {late_n} source{'s' if late_n != 1 else ''} late"
        elif not counted and any(r.get("flagged") for r in srcs):
            status = "Not counted: test or earlier-covered sources"
        elif not counted:
            status = "Nothing to deliver yet"
        elif any(r["state"] == "overdue" for r in counted):
            status = "Overdue"
        else:
            status = "In progress"
        out.append({"key": key, "label": g["label"], "pulled": _iso(pulled), "due": base_due.isoformat(), "latest_due": max(counted_due).isoformat() if counted_due else base_due.isoformat(),
                    "window_working_days": WINDOW_WD, "sources": len(srcs), "counted": len(counted), "set_aside": len(srcs) - len(counted),
                    "submitted": len(submitted), "on_time": sum(1 for r in counted if r["state"] == "on_time"),
                    "late": late_n, "delivered_at": delivered_at, "status": status, "items": srcs})
    return out


# ─── Active days ─────────────────────────────────────────────────────────────

SESSION_GAP_MIN = 30
SESSION_LEAD_MIN = 5


def logged_minutes(times: list) -> float:
    """Minutes of logged work: actions less than SESSION_GAP_MIN apart form one session; each session counts its length plus a short lead-in."""
    ts = sorted(t for t in times if t)
    if not ts:
        return 0.0
    total, start, prev = 0.0, ts[0], ts[0]
    for t in ts[1:]:
        if (t - prev).total_seconds() > SESSION_GAP_MIN * 60:
            total += (prev - start).total_seconds() / 60 + SESSION_LEAD_MIN
            start = t
        prev = t
    return total + (prev - start).total_seconds() / 60 + SESSION_LEAD_MIN


def active_days(db: Session, sources: list, batches: dict) -> dict:
    """Days a source really had work done on it (Nairobi days), from the audit log and the record, review and peer timestamps."""
    ids = [s.id for s in sources]
    ext: dict = {i: set() for i in ids}
    rev: dict = {i: set() for i in ids}
    ev: dict = {}

    def note(sid, kind, who, t):
        if t:
            ev.setdefault((sid, kind, who), []).append(aw(t))
    if ids:
        for sid, ts, act, uid in db.query(AuditLog.source_id, AuditLog.timestamp, AuditLog.action, AuditLog.user_id).filter(AuditLog.source_id.in_(ids)).all():
            d = day_of(ts)
            if d and act in EXTRACT_ACTIONS:
                ext[sid].add(d)
                note(sid, "x", uid, ts)
            elif d and act in REVIEW_ACTIONS:
                rev[sid].add(d)
                note(sid, "r", uid, ts)
        q = db.query(ExtractionJob.source_id, ExtractedRecord.created_at, ExtractedRecord.review_started_at, ExtractedRecord.reviewed_at,
                     ExtractedRecord.admin_review_started_at, ExtractedRecord.admin_reviewed_at).join(
            ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id).filter(ExtractionJob.source_id.in_(ids))
        for sid, c, rs, ra, ars, ara in q.all():
            if day_of(c):
                ext[sid].add(day_of(c))
                note(sid, "x", "rec", c)
            for x in (rs, ra, ars, ara):
                if day_of(x):
                    rev[sid].add(day_of(x))
                    note(sid, "r", "rec", x)
        for sid, sub in db.query(SourcePeerReview.source_id, SourcePeerReview.submitted_at).filter(SourcePeerReview.source_id.in_(ids)).all():
            if day_of(sub):
                rev[sid].add(day_of(sub))
                note(sid, "r", "peer", sub)
    mins: dict = {}
    for (sid, kind, _who), times in ev.items():
        m = mins.setdefault(sid, {"x": 0.0, "r": 0.0})
        m[kind] += logged_minutes(times)
    rows = []
    for s in sources:
        if getattr(s, "trace_flag", None):
            continue
        e, r = ext[s.id], rev[s.id]
        allp = e | r
        if not allp:
            continue
        first, last = min(allp), max(allp)
        span_wd = sum(1 for i in range((last - first).days + 1) if is_wd(first + timedelta(days=i)))
        act_wd = sum(1 for d in allp if is_wd(d))
        n = int(s.total_records or 0)
        b = batches.get(s.id) or {}
        done = bool(s.xtrium_submitted_at) or s.status == SourceStatus.APPROVED
        m = mins.get(s.id, {"x": 0.0, "r": 0.0})
        rows.append({"logged_hours_extraction": round(m["x"] / 60, 1), "logged_hours_review": round(m["r"] / 60, 1), "logged_hours": round((m["x"] + m["r"]) / 60, 1), "source_id": s.id, "name": s.name, "item_no": s.external_ref_id, "batch": b.get("label"), "records": n, "size": _size(n), "done": done,
                     "extraction_days": len(e), "review_days": len(r), "active_days": len(allp), "weekend_days": len(allp) - act_wd,
                     "first": first.isoformat(), "last": last.isoformat(), "span_working_days": span_wd, "idle_working_days": max(0, span_wd - act_wd)})
    by_size = []
    for name in ("Small", "Medium", "Large"):
        g = [r for r in rows if r["size"] == name and r["done"]]
        if not g:
            continue
        a = sorted(r["active_days"] for r in g)
        by_size.append({"size": name, "records": {"Small": f"1 to {SMALL}", "Medium": f"{SMALL + 1} to {MEDIUM}", "Large": f"over {MEDIUM}"}[name], "sources": len(g),
                        "avg_active_days": round(sum(a) / len(a), 1), "median_active_days": round(statistics.median(a), 1), "max_active_days": max(a),
                        "avg_logged_hours": round(sum(r["logged_hours"] for r in g) / len(g), 1),
                        "avg_idle_working_days": round(sum(r["idle_working_days"] for r in g) / len(g), 1),
                        "avg_span_working_days": round(sum(r["span_working_days"] for r in g) / len(g), 1)})
    done = [r for r in rows if r["done"]]
    return {"sources": sorted(rows, key=lambda r: (r["batch"] or "", r["first"])), "by_size": by_size,
            "all": {"sources": len(done), "avg_active_days": round(sum(r["active_days"] for r in done) / len(done), 1) if done else None,
                    "avg_idle_working_days": round(sum(r["idle_working_days"] for r in done) / len(done), 1) if done else None},
            "caveat": "Active days are days with logged work on the source. Idle days are working days between the first and last work day when nothing was logged, which is waiting. Logged hours add up work sessions (logged actions less than 30 minutes apart, plus 5 minutes per session) per person. Extraction itself happens on the source websites, outside the platform, so logged hours mostly show uploading and review and are far below the real effort. They are not a timesheet."}


# ─── Everything together ─────────────────────────────────────────────────────

def build(db: Session, sources: list, batches: dict, project_ids: set, project_id: str | None = None) -> dict:
    allrows = escalation_rows(db, project_ids, project_id)
    rows = [r for r in allrows if r["kind"] in ("escalation", "blocker")]
    others = [r for r in allrows if r["kind"] not in ("escalation", "blocker")]
    waits = wait_rows(db, project_ids, project_id)
    return {"as_of": _iso(now()), "escalations": {"summary": escalation_summary(rows, len(others), sum(1 for r in others if not r["timing_recorded"])), "items": rows},
            "questions": others,
            "clock": batch_clock(db, sources, rows, batches), "active": active_days(db, sources, batches),
            "waits": {"items": waits, "working_days": round(sum(w["working_days"] for w in waits), 1), "open": sum(1 for w in waits if w["open"])}}


def workbook(t: dict, label: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment

    wb = Workbook()
    bold = Font(bold=True)

    def sheet(ws, head, data, widths):
        ws.append(head)
        for c in ws[1]:
            c.font = bold
        for r in data:
            ws.append(r)
        for i, w in enumerate(widths):
            ws.column_dimensions[chr(65 + i)].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "A2"

    ws = wb.active
    ws.title = "Escalations"
    sheet(ws, ["Item", "Source", "Type", "What was asked", "Raised", "First reply", "Answered", "Status", "Days waited", "Working days", "Blocks the clock"],
          [[f"#{r['item_no']}" if r["item_no"] else "", r["source"] or "", r["kind"], r["question"], _iso(r["raised_at"]), _iso(r["first_reply_at"]) or "",
            _iso(r["answered_at"]) or "No answer yet", r["status"], r["waited_days"], r["waited_working_days"], "yes" if r["blocks_clock"] else ""] for r in t["escalations"]["items"]],
          [9, 26, 12, 60, 17, 17, 17, 10, 11, 12, 14])
    ws = wb.create_sheet("Questions in the tool")
    sheet(ws, ["Item", "Source", "What was asked", "Raised", "Answered", "Status", "Wait recorded"],
          [[f"#{r['item_no']}" if r["item_no"] else "", r["source"] or "", r["question"], _iso(r["raised_at"]), _iso(r["answered_at"]) or "No answer yet", r["status"],
            "yes" if r["timing_recorded"] else "no: answered later in one go"] for r in t.get("questions", [])], [9, 26, 70, 17, 17, 10, 26])
    ws = wb.create_sheet("Batch clock")
    data = []
    for b in t["clock"]:
        for r in b["items"]:
            data.append([b["label"], b["pulled"], b["due"], f"#{r['item_no']}" if r["item_no"] else "", r["name"], r["state"].replace("_", " "), _iso(r["submitted_at"]) or "",
                         r["due"], r["paused_working_days"], r.get("reason", "")])
    sheet(ws, ["Batch", "Pulled", "Due (5 working days)", "Item", "Source", "State", "Submitted to Xtrium", "Due for this source", "Paused working days", "Set aside because"], data,
          [22, 17, 18, 9, 30, 12, 19, 18, 14, 50])
    ws = wb.create_sheet("Active days")
    sheet(ws, ["Batch", "Item", "Source", "Records", "Size", "Done", "Extraction days", "Review days", "Active days", "Weekend days", "First work", "Last work", "Working days from first to last", "Idle working days", "Logged hours (extraction)", "Logged hours (review)", "Logged hours (total)"],
          [[r["batch"] or "", f"#{r['item_no']}" if r["item_no"] else "", r["name"], r["records"], r["size"], "yes" if r["done"] else "no", r["extraction_days"], r["review_days"],
            r["active_days"], r["weekend_days"], r["first"], r["last"], r["span_working_days"], r["idle_working_days"], r["logged_hours_extraction"], r["logged_hours_review"], r["logged_hours"]] for r in t["active"]["sources"]],
          [22, 9, 30, 9, 9, 7, 10, 10, 10, 10, 12, 12, 14, 10, 12, 12, 12])
    ws = wb.create_sheet("By size")
    sheet(ws, ["Size", "Records", "Sources done", "Average active days", "Median active days", "Most active days", "Average idle working days", "Average working days first to last", "Average logged hours"],
          [[r["size"], r["records"], r["sources"], r["avg_active_days"], r["median_active_days"], r["max_active_days"], r["avg_idle_working_days"], r["avg_span_working_days"], r["avg_logged_hours"]] for r in t["active"]["by_size"]],
          [10, 12, 12, 14, 14, 12, 16, 20, 14])
    ws = wb.create_sheet("Waiting")
    sheet(ws, ["Kind", "Reason", "From", "To", "Days", "Working days"],
          [[w["kind"], w["reason"], _iso(w["started_at"]), _iso(w["ended_at"]) or "Still waiting", w["days"], w["working_days"]] for w in t["waits"]["items"]], [12, 60, 17, 17, 8, 12])
    ws = wb.create_sheet("Read me")
    for line in [f"Delivery trace, {label}. As of {t['as_of']} (Nairobi time).",
                 "Escalations: raised is the real time it was asked in the chat when it was entered, otherwise the time it was entered. Days are elapsed clock days.",
                 f"Batch clock: {WINDOW_WD} working days (Monday to Friday) from the day the batch was pulled to submission to Xtrium. Sources waiting on an open Xtrium answer, or escalated with nothing to extract, are set aside. A source whose blocking question was answered gets those working days added.",
                 t["active"]["caveat"],
                 "Waiting: stretches logged by the team where work could not move (no links assigned, a decision, access)."]:
        ws.append([line])
    ws.column_dimensions["A"].width = 140
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
