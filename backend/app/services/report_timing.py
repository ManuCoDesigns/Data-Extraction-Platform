"""Timing, validation and correction facts for a set of sources, for the reports.

Everything is read from the platform: the source clocks, peer review submissions, record review stamps and the audit trail.
Times are elapsed clock time (they include waiting and weekends), not hands-on effort; the report says so. Time a source spent
on hold is taken out.
"""
from __future__ import annotations

from datetime import datetime, timezone
from statistics import median

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.all_models import AuditAction, AuditLog, ExtractedRecord, ExtractionJob, Source, SourceStatus, User
from app.services import holds


def _aw(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _days(a, b):
    a, b = _aw(a), _aw(b)
    return round((b - a).total_seconds() / 86400, 1) if a and b and b >= a else None


def _hours(a, b):
    a, b = _aw(a), _aw(b)
    return round((b - a).total_seconds() / 3600, 1) if a and b and b >= a else None


def _spread(vals: list) -> dict | None:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"n": len(vals), "avg": round(sum(vals) / len(vals), 1), "median": round(median(vals), 1), "min": round(min(vals), 1), "max": round(max(vals), 1)}


def _iso(dt):
    return _aw(dt).isoformat() if dt else None


def build(db: Session, sources: list, not_delivered=None) -> dict:
    if not sources:
        return {"empty": True}
    ids = [s.id for s in sources]
    by_id = {s.id: s for s in sources}
    nd = set(not_delivered or ())      # escalated sources: pulled and worked on, but never approved or delivered
    dsrc = [s for s in sources if s.id not in nd]
    uids = {s.assigned_extractor_id for s in sources if s.assigned_extractor_id} | {p.user_id for s in sources for p in s.peer_reviews}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    held = holds.held_seconds(db, sources)

    recs = (db.query(ExtractionJob.source_id, ExtractedRecord)
            .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
            .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == False).all())  # noqa: E712
    rec_by_src: dict = {}
    for sid, r in recs:
        rec_by_src.setdefault(sid, []).append(r)
    rids = [r.id for rs in rec_by_src.values() for r in rs]

    log = (db.query(AuditLog).filter(or_(AuditLog.source_id.in_(ids), AuditLog.record_id.in_(rids)) if rids else AuditLog.source_id.in_(ids))
           .filter(AuditLog.action.in_([AuditAction.RECORD_SENT_TO_ADMIN, AuditAction.RECORD_ADMIN_REVIEWED, AuditAction.RECORD_RETURNED_FOR_CORRECTION, AuditAction.SOURCE_RESET]))
           .order_by(AuditLog.timestamp).all())
    rec_src = {r.id: sid for sid, rs in rec_by_src.items() for r in rs}
    ev: dict = {}
    for e in log:
        sid = e.source_id or rec_src.get(e.record_id)
        if sid in by_id:
            ev.setdefault(sid, []).append((_aw(e.timestamp), e.action))

    per_source, admin_h, corr_h, peer_d, llm_m = [], [], [], [], []
    returned_sources = returned_records = notes = resets = 0
    fields: dict = {}
    for s in sources:
        rs = rec_by_src.get(s.id, [])
        ext = _days(s.extraction_started_at, s.extraction_completed_at)
        if ext is not None and held.get(s.id):
            ext = max(0.0, round(ext - held[s.id] / 86400, 1))
        if ext is not None and ext < 0.05:
            ext = None     # a clock that started and stopped in the same moment was not timed: leave it out rather than report 0 days
        approved_at = max([_aw(r.admin_reviewed_at) for r in rs if r.admin_reviewed_at and r.review_status and r.review_status.value == "approved"] or [None]) or _aw(s.approved_at)
        # admin turnaround: each submission to the next decision; correction turnaround: each return to the next submission
        sent_at, ret_at = None, None
        returns = 0
        for ts, act in ev.get(s.id, []):
            if act == AuditAction.RECORD_SENT_TO_ADMIN:
                if ret_at:
                    corr_h.append(_hours(ret_at, ts))
                    ret_at = None
                sent_at = sent_at or ts
            elif act == AuditAction.RECORD_ADMIN_REVIEWED:
                if sent_at:
                    admin_h.append(_hours(sent_at, ts))
                    sent_at = None
            elif act == AuditAction.RECORD_RETURNED_FOR_CORRECTION:
                returns += 1
                if sent_at:
                    admin_h.append(_hours(sent_at, ts))
                    sent_at = None
                ret_at = ts
        n_ret = sum(1 for r in rs if (r.correction_count or 0) > 0)
        returned_records += n_ret
        if n_ret or returns:
            returned_sources += 1
        for r in rs:
            for field, entries in (r.reviewer_field_comments or {}).items() if isinstance(r.reviewer_field_comments, dict) else []:
                for en in entries or []:
                    notes += 1
                    if field != "_general" and en.get("type") in ("correction", "rejection", "note", None):
                        fields[field] = fields.get(field, 0) + 1
        for p in s.peer_reviews:
            if p.status == "submitted" and p.submitted_at and s.extraction_completed_at:
                peer_d.append(_days(s.extraction_completed_at, p.submitted_at))
        if s.llm_verification_started_at and s.llm_verification_completed_at:
            llm_m.append(round((_aw(s.llm_verification_completed_at) - _aw(s.llm_verification_started_at)).total_seconds() / 60, 1))
        resets_s = s.reset_count or 0
        resets += resets_s
        per_source.append({
            "source_id": s.id, "project_id": s.project_id, "name": s.name, "item_no": s.external_ref_id, "extractor": names.get(s.assigned_extractor_id),
            "records": len(rs), "extraction_days": ext, "review_days": _days(s.extraction_completed_at, approved_at) if s.status == SourceStatus.APPROVED and s.id not in nd else None,
            "total_days": _days(s.created_at, approved_at) if s.status == SourceStatus.APPROVED and s.id not in nd else None,
            "started_at": _iso(s.extraction_started_at), "submitted_at": _iso(s.extraction_completed_at), "approved_at": _iso(approved_at) if s.status == SourceStatus.APPROVED and s.id not in nd else None,
            "returns": max(returns, 1 if n_ret else 0), "resets": resets_s, "held_days": round(held.get(s.id, 0) / 86400, 1) or None,
            "peers_done": sum(1 for p in s.peer_reviews if p.status == "submitted"), "peers_total": len(s.peer_reviews), "status": s.status.value,
            "approved_together": False,
        })

    # sources approved within minutes of each other were signed off in one sitting: their review time says nothing about the work
    stamped = sorted(((datetime.fromisoformat(r["approved_at"]), r) for r in per_source if r["approved_at"]), key=lambda x: x[0])
    grp, groups = [], []
    for t_, r_ in stamped:
        if grp and (t_ - grp[-1][0]).total_seconds() > 600:
            groups.append(grp)
            grp = []
        grp.append((t_, r_))
    if grp:
        groups.append(grp)
    together = 0
    for g in groups:
        if len(g) >= 4:
            for _, r_ in g:
                r_["approved_together"], r_["review_days"], r_["total_days"] = True, None, None
                together += 1

    # per extractor and per reviewer
    people: dict = {}
    for row, s in zip(per_source, sources):
        uid = s.assigned_extractor_id
        if not uid:
            continue
        p = people.setdefault(uid, {"user_id": uid, "name": names.get(uid), "sources": 0, "records": 0, "days": [], "reviews_done": 0, "review_days": []})
        p["sources"] += 1
        p["records"] += row["records"]
        if row["extraction_days"] is not None:
            p["days"].append(row["extraction_days"])
    for s in sources:
        for pr in s.peer_reviews:
            if pr.status == "submitted":
                p = people.setdefault(pr.user_id, {"user_id": pr.user_id, "name": names.get(pr.user_id), "sources": 0, "records": 0, "days": [], "reviews_done": 0, "review_days": []})
                p["reviews_done"] += 1
                d = _days(s.extraction_completed_at, pr.submitted_at)
                if d is not None:
                    p["review_days"].append(d)
    plist = []
    for p in people.values():
        sp, rv = _spread(p["days"]), _spread(p["review_days"])
        plist.append({"user_id": p["user_id"], "name": p["name"], "sources": p["sources"], "records": p["records"], "reviews_done": p["reviews_done"],
                      "extraction": sp, "review": rv})
    plist.sort(key=lambda x: (-(x["sources"]), x["name"] or ""))

    # milestones
    starts = [_aw(s.extraction_started_at) for s in sources if s.extraction_started_at]
    subs = [_aw(s.extraction_completed_at) for s in sources if s.extraction_completed_at]
    pulls = [_aw(s.created_at) for s in sources if s.created_at]
    apps = [_aw(s.approved_at) for s in dsrc if s.approved_at and s.status == SourceStatus.APPROVED]
    first_adm = min([_aw(r.admin_reviewed_at) for rs in rec_by_src.values() for r in rs if r.admin_reviewed_at] or [None])
    peer_times = [_aw(p.submitted_at) for s in sources for p in s.peer_reviews if p.status == "submitted" and p.submitted_at]
    ret_times = [ts for evs in ev.values() for ts, a in evs if a == AuditAction.RECORD_RETURNED_FOR_CORRECTION]
    ms = []

    def add(key, label, at, detail, at2=None):
        if at:
            ms.append({"key": key, "label": label, "at": _iso(at), "at_end": _iso(at2) if at2 and _aw(at2).date() != _aw(at).date() else None, "detail": detail})

    add("pulled", "Pulled", min(pulls) if pulls else None, f"{len(sources)} sources arrive from Xtrium.", max(pulls) if pulls else None)
    add("started", "Extraction starts", min(starts) if starts else None, f"{len({s.assigned_extractor_id for s in sources if s.assigned_extractor_id})} extractors begin on their own sources.")
    add("first_sub", "First submission", min(subs) if subs else None, "The first source goes to review.")
    add("admin", "Admin review", first_adm, (f"First approvals. {returned_records or len(ret_times)} {'record' if (returned_records or len(ret_times)) == 1 else 'records'} returned for correction." if ret_times else "First approvals."), max(ret_times) if ret_times else None)
    add("peer", "Peer review", min(peer_times) if peer_times else None, f"{len(peer_times)} peer {'review' if len(peer_times) == 1 else 'reviews'} submitted.", max(peer_times) if peer_times else None)
    done = len(apps) == len(sources) and not nd
    add("approved", "Approved" if done else "Approved so far", max(apps) if apps else None, f"All {len(sources)} sources approved on the platform." if done else f"{len(apps)} of {len(sources)} sources approved" + (f"; {len(nd)} escalated to Xtrium for a decision." if nd else "."))
    sent = [(_aw(s.xtrium_submitted_at), int(getattr(s, "xtrium_submit_count", 0) or 0)) for s in dsrc if s.xtrium_submitted_at]
    twice = sum(1 for _, c_ in sent if c_ > 1)
    add("xtrium", "Reported to Xtrium", min(t_ for t_, _ in sent) if sent else None,
        f"{len(sent)} {'source' if len(sent) == 1 else 'sources'} sent back" + (f", {twice} of them a second time with corrected values." if twice else "."), max(t_ for t_, _ in sent) if sent else None)
    rng = lambda xs: [_iso(min(xs)), _iso(max(xs))] if xs else None
    sent_t = [t_ for t_, _ in sent]
    end_ = max(sent_t) if sent_t else (max(apps) if apps else None)
    dates = {"pulled": rng(pulls), "started": rng(starts), "submitted": rng(subs), "approved": rng(apps), "xtrium": rng(sent_t),
             "work_days": _days(min(pulls), max(subs)) if pulls and subs else None,            # pull to the last source sent for review
             "deliver_days": _days(min(pulls), end_) if pulls and end_ and (done or sent_t) else None}    # pull to the last source sent back or approved
    ms.sort(key=lambda m: m["at"])
    span = _days(min(pulls), max(apps)) if pulls and apps and done else None

    top_fields = sorted(({"field": k, "count": v} for k, v in fields.items()), key=lambda x: -x["count"])[:8]
    return {
        "empty": False, "milestones": ms, "span_days": span, "approved_together": together, "dates": dates,
        "extraction": _spread([r["extraction_days"] for r in per_source]), "per_source": per_source, "people": plist,
        "validation": {
            "llm": {"timed": len(llm_m), "avg_minutes": round(sum(llm_m) / len(llm_m), 1) if llm_m else None, "max_minutes": max(llm_m) if llm_m else None},
            "peer": {"submitted": len(peer_times), "first_at": _iso(min(peer_times)) if peer_times else None, "last_at": _iso(max(peer_times)) if peer_times else None, "turnaround_days": _spread(peer_d)},
            "admin": {"hours": _spread(admin_h)},
            "corrections": {"hours": _spread(corr_h)},
        },
        "corrections": {"sources_returned": returned_sources, "records_returned": returned_records, "notes": notes, "resets": resets, "top_fields": top_fields},
        "caveat": "Times are elapsed clock time from the platform, including waiting and weekends. They are not hands-on hours.",
    }
