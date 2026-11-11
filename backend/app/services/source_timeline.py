"""Source timelines: every dated step of every source, in order, read from the platform's own records.

Sources of each event: the source clocks (pulled, extraction start and finish, approval, last send to Xtrium), the peer review
rows, and the audit trail (assignments, sends to admin, returns, admin decisions, resets, escalations, sends to Xtrium).
Times are elapsed clock time. Where the audit trail and a source clock say the same thing within two minutes, one event is kept.
Runs of the same event within ten minutes (a reviewer deciding 20 records in one sitting) are folded into one line with a count.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.all_models import AuditAction, AuditLog, ExtractedRecord, ExtractionJob, Source, SourceStatus, User

A = AuditAction
_AUDIT = {
    A.SOURCE_ASSIGNED: ("assigned", "Assigned to an extractor"),
    A.RECORD_SENT_TO_ADMIN: ("sent_review", "Sent for review"),
    A.RECORD_ADMIN_REVIEWED: ("admin_reviewed", "Admin reviewed"),
    A.RECORD_RETURNED_FOR_CORRECTION: ("returned", "Returned for correction"),
    A.RECORD_REVISION_STARTED: ("revision", "Correction started"),
    A.SOURCE_RESET: ("reset", "Reset to start again"),
    A.RECORD_ESCALATED: ("escalated", "Escalated"),
    A.SOURCE_APPROVED: ("approved", "Approved"),
    A.RECORD_APPROVED: ("record_approved", "Record approved"),
    A.SOURCE_DATA_UPLOADED: ("uploaded", "Data uploaded"),
    A.SOURCE_RECORD_FIXED: ("fixed", "Record fixed"),
}
_STAGE = {
    "xtrium_submit": ("sent_xtrium", "Sent to Xtrium"),
    "xtrium_fail_reported": ("xtrium_failed", "Reported to Xtrium as not extractable"),
    "escalated_no_data": ("escalated", "Escalated: nothing found to extract"),
    "llm_verification": ("llm", "Automatic check started"),
    "llm_verification_complete": ("llm_done", "Automatic check finished"),
    "xtrium_cleared": ("cleared", "Cleared from the platform"),
}
FOLD = {"admin_reviewed", "returned", "record_approved", "fixed", "revision", "sent_review", "peer_assigned"}
_SAME = {"sent_review": "submitted"}      # the first send for review is the same fact as the extractor finishing


def _aw(d):
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d):
    return _aw(d).isoformat() if d else None


def _days(a, b):
    return round((_aw(b) - _aw(a)).total_seconds() / 86400, 1) if a and b else None


def _hours(a, b):
    return round((_aw(b) - _aw(a)).total_seconds() / 3600, 1)


def _note(v, n=140):
    s = " ".join(str(v or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def build(db: Session, sources: list, anon: bool = False) -> dict:
    """{source_id: {events: [...], summary: {...}}}. With anon, people are shown as Person 1, Person 2."""
    if not sources:
        return {}
    ids = [s.id for s in sources]
    by_id = {s.id: s for s in sources}
    uids = {s.assigned_extractor_id for s in sources if s.assigned_extractor_id} | {p.user_id for s in sources for p in s.peer_reviews}
    log_rows = None

    recs = (db.query(ExtractionJob.source_id, ExtractedRecord.id)
            .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id).filter(ExtractionJob.source_id.in_(ids)).all())
    rec_src = {rid: sid for sid, rid in recs}
    rids = list(rec_src)
    q = db.query(AuditLog)
    q = q.filter(or_(AuditLog.source_id.in_(ids), AuditLog.record_id.in_(rids))) if rids else q.filter(AuditLog.source_id.in_(ids))
    log_rows = q.order_by(AuditLog.timestamp).all()
    uids |= {e.user_id for e in log_rows if e.user_id}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    alias: dict = {}

    def who(uid):
        n = names.get(uid) if uid else None
        if not n:
            return ""
        return alias.setdefault(n, f"Person {len(alias) + 1}") if anon else n

    raw: dict = {sid: [] for sid in ids}

    def add(sid, at, kind, label, detail="", by="", src="clock"):
        if at is not None:
            raw[sid].append({"at": _aw(at), "kind": kind, "label": label, "detail": detail, "by": by, "src": src})

    for e in log_rows:
        sid = e.source_id or rec_src.get(e.record_id)
        if sid not in by_id:
            continue
        av = e.after_value if isinstance(e.after_value, dict) else {}
        bv = e.before_value if isinstance(e.before_value, dict) else {}
        if e.action == A.SOURCE_STATUS_CHANGED:
            hit = _STAGE.get(av.get("stage"))
            if not hit:
                continue
            kind, label = hit
            det = ""
            if kind == "sent_xtrium":
                n = av.get("records_submitted")
                det = f"{n} records" if n is not None else ""
            elif kind in ("xtrium_failed", "escalated"):
                det = _note(av.get("reason"))
            add(sid, e.timestamp, kind, label, det, who(e.user_id), "audit")
        elif e.action in _AUDIT:
            kind, label = _AUDIT[e.action]
            det = ""
            if kind == "returned":
                det = _note(av.get("note"))
            elif kind == "escalated":
                det = _note(av.get("reason") or av.get("note"))
            elif kind == "assigned":
                nm = names.get(av.get("extractor_id"))
                if nm:
                    det = f"to {alias.setdefault(nm, f'Person {len(alias) + 1}') if anon else nm}"
                elif av.get("auto_distribute"):
                    det = "shared out automatically"
            add(sid, e.timestamp, kind, label, det, who(e.user_id), "audit")

    for s in sources:
        sid = s.id
        pulled = bool(s.external_ref_id or s.external_system)
        add(sid, s.created_at, "pulled", "Pulled from Xtrium" if pulled else "Added to the platform", f"item #{s.external_ref_id}" if s.external_ref_id else "")
        add(sid, s.extraction_started_at, "started", "Extraction started", "", who(s.assigned_extractor_id))
        add(sid, s.extraction_completed_at, "submitted", "Extraction finished and submitted", "", who(s.assigned_extractor_id))
        add(sid, s.llm_verification_started_at, "llm", "Automatic check started")
        add(sid, s.llm_verification_completed_at, "llm_done", "Automatic check finished")
        add(sid, s.review_started_at, "review_started", "Admin review started")
        for p in s.peer_reviews:
            add(sid, p.created_at, "peer_assigned", "Peer reviewer assigned", "", who(p.user_id))
            if p.status == "submitted":
                add(sid, p.submitted_at, "peer_done", "Peer review submitted", "", who(p.user_id))
        if s.status == SourceStatus.APPROVED:
            add(sid, s.approved_at, "approved", "Approved")
        add(sid, s.xtrium_submitted_at, "sent_xtrium", "Sent to Xtrium", f"{s.xtrium_submit_count or 1} times in total" if (s.xtrium_submit_count or 0) > 1 else "")

    out = {}
    for s in sources:
        evs = sorted(raw[s.id], key=lambda x: (x["at"], 0 if x["src"] == "audit" else 1))
        # the same fact from a clock and from the audit trail: keep the audit one (it says who and why)
        kept: list = []
        for ev in evs:
            nk = _SAME.get(ev["kind"], ev["kind"])
            dup = next((k for k in kept if _SAME.get(k["kind"], k["kind"]) == nk and k["src"] != ev["src"] and abs((k["at"] - ev["at"]).total_seconds()) <= 120), None)
            if dup:
                dup["by"] = dup["by"] or ev["by"]
                dup["detail"] = dup["detail"] or ev["detail"]
                if nk == "submitted":
                    dup["kind"], dup["label"] = "submitted", "Extraction finished, sent for review"
                continue
            kept.append(dict(ev))
        # a reviewer deciding many records in one sitting is one line, not twenty
        folded: list = []
        for ev in kept:
            last = next((f for f in reversed(folded) if _SAME.get(f["kind"], f["kind"]) == _SAME.get(ev["kind"], ev["kind"])), None)
            if (ev["kind"] in FOLD or ev["kind"] == "submitted") and last and (ev["at"] - last["end"]).total_seconds() <= 600:
                last["count"] += 1
                last["end"] = ev["at"]
                last["detail"] = last["detail"] or ev["detail"]
                continue
            folded.append({**ev, "count": 1, "end": ev["at"]})
        prev = None
        final = []
        for ev in folded:
            n = ev["count"]
            final.append({
                "at": _iso(ev["at"]), "kind": ev["kind"], "by": ev["by"],
                "label": ev["label"] + (f" ({n} records)" if n > 1 else ""), "detail": ev["detail"],
                "since_previous_hours": _hours(prev, ev["at"]) if prev else None,
            })
            prev = ev["at"]
        k = {}
        for ev in folded:
            k.setdefault(ev["kind"], []).append(ev)
        first = lambda name: (k.get(name) or [{}])[0].get("at")  # noqa: E731
        lastat = lambda name: (k.get(name) or [{}])[-1].get("at")  # noqa: E731
        pulled_at, started, submitted, approved, sent = first("pulled"), first("started"), first("submitted"), lastat("approved"), lastat("sent_xtrium")
        returns = sum(e["count"] for e in k.get("returned", []))
        summary = {
            "pulled": _iso(pulled_at), "started": _iso(started), "submitted": _iso(submitted), "approved": _iso(approved), "sent_to_xtrium": _iso(sent),
            "days_to_start": _days(pulled_at, started), "extraction_days": _days(started, submitted),
            "review_days": _days(submitted, approved), "total_days": _days(pulled_at, approved),
            "pull_to_xtrium_days": _days(pulled_at, sent),
            "returns": returns, "resets": len(k.get("reset", [])), "escalated": bool(k.get("escalated") or k.get("xtrium_failed")),
            "peer_reviews": len(k.get("peer_done", [])), "sends_to_xtrium": max(s.xtrium_submit_count or 0, len(k.get("sent_xtrium", []))),
            "events": len(final),
        }
        out[s.id] = {"events": final, "summary": summary}
    return out


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
_STAGE_LABEL = {"delivered": "Delivered", "ready_to_send": "Approved, not yet sent to Xtrium", "blocked": "Needs a decision", "signoff": "Ready for sign-off",
                "peer_review": "In peer review", "needs_fixes": "Needs fixes", "extracting": "Extracting", "not_started": "Not started"}


def batches_for(db: Session, r: dict, sources: dict, anon: bool = False) -> list:
    """Timelines grouped the way the report groups them: 'October batch 1', 'October batch 2'. r is the engagement report."""
    rows = [x for b in r["batches"] for x in b["sources"]]
    objs = [sources[x["source_id"]] for x in rows if x["source_id"] in sources]
    tl = build(db, objs, anon)
    per_month: dict = {}
    out = []
    for b in r["batches"]:
        label = b["label"]
        if b.get("ordinal") and (b.get("date") or "")[:7]:
            m = int(b["date"][5:7])
            per_month[m] = per_month.get(m, 0) + 1
            label = f"{MONTHS[m - 1]} batch {per_month[m]}"
        items = []
        for x in b["sources"]:
            t = tl.get(x["source_id"])
            if not t:
                continue
            sm = dict(t["summary"])
            if x["stage"] == "blocked" or x.get("escalated"):
                sm["approved"] = sm["review_days"] = sm["total_days"] = None      # escalated: not delivered, so it has no approval and no delivery clock
            sm["escalated"] = bool(sm["escalated"] or x.get("escalated"))
            status = _STAGE_LABEL.get(x["stage"], x["stage"])
            if x["stage"] == "ready_to_send" and sm.get("sent_to_xtrium"):
                status = "Approved; a send to Xtrium is in the activity log but it was not marked delivered"
            items.append({"source_id": x["source_id"], "name": x["name"], "item_no": x.get("item_no"), "stage": x["stage"], "status": status,
                          "extractor": x.get("extractor") if not anon else None, "events": t["events"], "summary": sm})
        items.sort(key=lambda i: (i["summary"]["pulled"] or "", i["item_no"] or ""))
        avg = lambda k: (round(sum(i["summary"][k] for i in items if i["summary"][k] is not None) / n, 1) if (n := sum(1 for i in items if i["summary"][k] is not None)) else None)  # noqa: E731
        out.append({"key": b["key"], "label": label, "sources": items,
                    "totals": {"sources": len(items), "delivered": sum(1 for i in items if i["stage"] == "delivered"), "returns": sum(i["summary"]["returns"] for i in items),
                               "avg_days_to_start": avg("days_to_start"), "avg_extraction_days": avg("extraction_days"), "avg_review_days": avg("review_days"), "avg_total_days": avg("total_days"),
                               "first_pull": min((i["summary"]["pulled"] for i in items if i["summary"]["pulled"]), default=None),
                               "last_delivery": max((i["summary"]["approved"] for i in items if i["summary"]["approved"]), default=None)}})
    return out


def _nairobi(iso):
    if not iso:
        return None
    from datetime import timedelta
    return datetime.fromisoformat(iso).astimezone(timezone(timedelta(hours=3))).replace(tzinfo=None, microsecond=0, second=0)


def workbook(batches: list, scope_label: str) -> bytes:
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head = PatternFill("solid", fgColor="0F3D91")

    def sheet(ws, header, rows, widths, dt_cols=()):
        ws.append(header)
        for c in ws[1]:
            c.font, c.fill, c.alignment = Font(bold=True, color="FFFFFF"), head, Alignment(vertical="center", wrap_text=True)
        for r in rows:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for col in dt_cols:
            for c in ws[get_column_letter(col)][1:]:
                c.number_format = "yyyy-mm-dd hh:mm"
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    ws = wb.active
    ws.title = "Summary"
    rows = []
    for b in batches:
        for i in b["sources"]:
            s = i["summary"]
            rows.append([b["label"], i["item_no"], i["name"], i["status"], _nairobi(s["pulled"]), _nairobi(s["started"]), _nairobi(s["submitted"]), _nairobi(s["approved"]), _nairobi(s["sent_to_xtrium"]),
                         s["days_to_start"], s["extraction_days"], s["review_days"], s["total_days"], s["returns"], s["resets"], s["peer_reviews"], s["sends_to_xtrium"], "Yes" if s["escalated"] else ""])
    sheet(ws, ["Batch", "Xtrium item", "Source", "Where it stands", "Pulled", "Extraction started", "Submitted for review", "Approved", "Sent to Xtrium", "Days to start", "Extraction days",
               "Review days", "Days pull to approval", "Returned for correction", "Resets", "Peer reviews", "Times sent to Xtrium", "Escalated"], rows,
          [18, 11, 38, 26, 17, 17, 17, 17, 17, 9, 11, 9, 12, 11, 8, 9, 11, 10], dt_cols=(5, 6, 7, 8, 9))

    ev = wb.create_sheet("Events")
    rows = []
    for b in batches:
        for i in b["sources"]:
            for e in i["events"]:
                rows.append([b["label"], i["item_no"], i["name"], _nairobi(e["at"]), e["label"], e["detail"], e["by"], e["since_previous_hours"], round(e["since_previous_hours"] / 24, 1) if e["since_previous_hours"] is not None else None])
    sheet(ev, ["Batch", "Xtrium item", "Source", "When", "Step", "Detail", "By", "Hours since the previous step", "Days since the previous step"], rows, [18, 11, 38, 17, 44, 44, 18, 14, 14], dt_cols=(4,))

    bt = wb.create_sheet("Batches")
    rows = []
    for b in batches:
        t = b["totals"]
        rows.append([b["label"], t["sources"], t["delivered"], _nairobi(t["first_pull"]), _nairobi(t["last_delivery"]), t["avg_days_to_start"], t["avg_extraction_days"], t["avg_review_days"], t["avg_total_days"], t["returns"]])
    sheet(bt, ["Batch", "Sources", "Delivered", "First pull", "Last approval", "Avg days to start", "Avg extraction days", "Avg review days", "Avg days pull to approval", "Returned for correction"], rows,
          [20, 9, 10, 17, 17, 12, 12, 12, 14, 12], dt_cols=(4, 5))

    nt = wb.create_sheet("Read me")
    for line in [f"Source timelines: {scope_label}", "",
                 "All times are Nairobi time (UTC+3) and come from the platform's own records: source clocks, peer reviews and the activity log.",
                 "Days are elapsed clock time. They include waiting, nights and weekends, not hands-on effort.",
                 "A step with no time was never recorded, or happened before that step was logged.",
                 "Escalated sources are not counted as delivered: they have no approval or delivery time.",
                 "Several records decided in one sitting are one line with a count.",
                 "The platform keeps the latest send to Xtrium and how many times it was sent, not the date of each earlier send."]:
        nt.append([line])
    nt.column_dimensions["A"].width = 120
    nt["A1"].font = Font(bold=True, size=13)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
