"""Plain-language analysis of the delivery trace: how long each batch took and where the time went, what we waited on Xtrium for, and what in the data still needs checking."""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.services import source_timeline as st, trace as tr

DAY = 86400.0


def _dt(iso):
    return tr.aw(datetime.fromisoformat(iso)) if iso else None


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def _overlap_days(a0, a1, b0, b1) -> float:
    lo, hi = max(a0, b0), min(a1, b1)
    return max(0.0, (hi - lo).total_seconds() / DAY)


def build(db: Session, sources: list, batches: dict, t: dict) -> dict:
    now = tr.now()
    tl = st.build(db, sources, False)
    by_id = {s.id: s for s in sources}
    esc = t["escalations"]["items"]
    blockers: dict = {}
    for r in esc:
        if r["source_id"] and r["blocks_clock"]:
            blockers.setdefault(r["source_id"], []).append(r)
    clock = {b["key"]: b for b in t["clock"]}

    rows = []
    for key in sorted({(batches.get(s.id) or {}).get("key") for s in sources} - {None, "other"}):
        group = [s for s in sources if (batches.get(s.id) or {}).get("key") == key]
        label = batches[group[0].id]["label"]
        flagged = [s for s in group if getattr(s, "trace_flag", None)]
        real = [s for s in group if not getattr(s, "trace_flag", None)]
        done = []
        for s in real:
            sm = (tl.get(s.id) or {}).get("summary") or {}
            if sm.get("approved") and not sm.get("escalated"):
                pulled, appr = _dt(sm["pulled"]), _dt(sm["approved"])
                if pulled and appr and appr > pulled:
                    wait = sum(_overlap_days(pulled, appr, tr.aw(b["raised_at"]), tr.aw(b["answered_at"]) or now) for b in blockers.get(s.id, []))
                    done.append({"id": s.id, "name": s.name, "total": sm["total_days"], "start": sm["days_to_start"], "extract": sm["extraction_days"], "review": sm["review_days"],
                                 "wd": round(tr.wd_between(pulled, appr), 1), "returns": sm.get("returns") or 0, "waited": round(wait, 1)})
        c = clock.get(key) or {}
        rows.append({
            "key": key, "label": label, "pulled": (tr._iso(min(tr.aw(s.created_at) for s in group))), "sources": len(group), "counted": c.get("counted", len(real)),
            "set_aside": c.get("set_aside", 0), "flagged": len(flagged), "flag": (flagged[0].trace_flag if flagged and len(flagged) == len(group) else None),
            "delivered": len(done), "on_time": c.get("on_time", 0), "late": c.get("late", 0), "status": c.get("status", ""),
            "avg_total_days": _avg(d["total"] for d in done), "avg_working_days": _avg(d["wd"] for d in done),
            "avg_queue_days": _avg(d["start"] for d in done), "avg_extraction_days": _avg(d["extract"] for d in done), "avg_review_days": _avg(d["review"] for d in done),
            "linked_wait_sources": sum(1 for d in done if d["waited"] > 0), "avg_linked_wait_days": _avg(d["waited"] for d in done if d["waited"] > 0),
            "returned_records": sum(d["returns"] for d in done),
        })

    # waits on Xtrium, chart-ready, and by topic
    waits = [{"label": (f"#{r['item_no']} " if r["item_no"] else "") + (r["question"][:48] + ("…" if len(r["question"]) > 48 else "")), "days": r["waited_days"], "raised": tr._iso(r["raised_at"]),
              "open": r["status"] == "open", "topic": r["topic"] or "Other", "timed": r["timing_recorded"]} for r in esc if r["timing_recorded"]]
    topics: dict = {}
    for w in waits:
        topics.setdefault(w["topic"], []).append(w["days"] or 0)
    by_topic = sorted(({"topic": k, "count": len(v), "avg_days": round(sum(v) / len(v), 1), "longest_days": round(max(v), 1)} for k, v in topics.items()), key=lambda x: -x["avg_days"])

    S = t["escalations"]["summary"]
    findings, warnings = [], []
    prod = [r for r in rows if r["delivered"] > 0]
    if prod:
        last = prod[-1]
        inside = last["on_time"]
        findings.append({"tone": "good" if last["late"] == 0 else "info", "title": f"{last['label']}: {last['delivered']} delivered in about {last['avg_working_days']} working days",
                         "text": f"On average {last['avg_total_days']} calendar days from pull to approval ({last['avg_working_days']} working days) against a {tr.WINDOW_WD}-working-day window. "
                                 f"{inside} of {last['counted']} counted sources were submitted inside the window{', and ' + str(last['late']) + ' late' if last['late'] else ''}."})
    if len(prod) >= 2 and prod[0]["avg_total_days"] and prod[-1]["avg_total_days"]:
        a, b = prod[0], prod[-1]
        d = round(a["avg_total_days"] - b["avg_total_days"], 1)
        findings.append({"tone": "good" if d > 0 else "info", "title": "Turnaround across batches",
                         "text": f"{a['label']} took {a['avg_total_days']} days on average from pull to approval; {b['label']} took {b['avg_total_days']}. "
                                 + (f"That is {d} days faster." if d > 0 else "It has not got faster yet.")})
    big = max(prod, key=lambda r: r["delivered"], default=None)
    if big and big["avg_extraction_days"] is not None and big["avg_review_days"] is not None:
        parts = {"waiting to start": big["avg_queue_days"] or 0, "extraction": big["avg_extraction_days"], "review": big["avg_review_days"]}
        top = max(parts, key=parts.get)
        txt = (f"In {big['label']} ({big['delivered']} delivered source{'s' if big['delivered'] != 1 else ''}) the average source spent {parts['waiting to start']} days before extraction started, {parts['extraction']} days in extraction and "
               f"{parts['review']} days in review. The longest stage was {top}. ")
        if big["linked_wait_sources"]:
            txt += f"{big['linked_wait_sources']} of those sources were also held by an Xtrium question tied to them, for about {big['avg_linked_wait_days']} days each. "
        else:
            txt += "No Xtrium question is tied directly to these sources, so the time is not explained by waiting on answers; escalations not tied to a source cannot be attributed. "
        txt += "Extraction runs on the source websites, so its days include time before an extractor reached the source."
        findings.append({"tone": "info", "title": "Where the time went", "text": txt})
    if S["answered"]:
        share = round(100 * S["within_2d"] / max(1, S["within_2d"] + S["longer_than_2d"]))
        findings.append({"tone": "info", "title": f"{S['total']} escalations: {S['answered']} answered, {S['open']} open",
                         "text": f"{share}% of the answered ones were answered within 2 days (median {S['median_days']} days, longest {S['longest_days']} days). "
                                 + (f"The longest still open has waited {S['longest_open_days']} days." if S["open"] else "None are open.")})
    ret = sum(r["returned_records"] for r in rows)
    if ret:
        findings.append({"tone": "good", "title": "Review is catching errors", "text": f"{ret} records were sent back for correction during review across delivered sources, before anything went to Xtrium."})
    if by_topic and by_topic[0]["count"] >= 2:
        findings.append({"tone": "info", "title": f"Slowest topic: {by_topic[0]['topic']}", "text": f"{by_topic[0]['count']} escalations on this topic waited {by_topic[0]['avg_days']} days on average (longest {by_topic[0]['longest_days']})."})

    if S.get("untimed"):
        warnings.append({"title": "Some waits were never recorded", "text": f"{S['untimed']} question{'s' if S['untimed'] != 1 else ''} on the Questions page were answered later in one go, so their waits are left out of every figure."})
    for r in rows:
        if r["delivered"] == 0 and r["sources"] >= 3 and not r["flag"] and r["pulled"] and (now - datetime.strptime(r["pulled"], "%Y-%m-%d %H:%M").replace(tzinfo=tr.NAIROBI)).days > 14:
            warnings.append({"title": f"{r['label']} has {r['sources']} sources and none delivered", "text": "If these were test sources or were covered earlier through Google Drive, mark the batch so the clock leaves it out."})
    odd = sum(1 for s in sources if s.status.value == "approved" and not s.xtrium_submitted_at and ((tl.get(s.id) or {}).get("summary") or {}).get("sent_to_xtrium"))
    if odd:
        warnings.append({"title": f"{odd} approved source{'s' if odd != 1 else ''} not marked delivered", "text": "The activity log shows a send to Xtrium but the source was never marked as submitted. They show as 'not yet sent' until that is checked."})
    loose = sum(1 for r in esc if not r["source_id"])
    if loose:
        warnings.append({"title": f"{loose} escalations are not tied to a source", "text": "They count in the wait figures but cannot be tied to a batch or pause its clock."})
    warnings.append({"title": "Hours are not measured", "text": "Extraction happens on the source websites, outside the platform, so only days are reliable. Logged hours cover uploading and review only."})

    return {"batches": rows, "waits": waits, "by_topic": by_topic, "findings": findings, "warnings": warnings, "window_working_days": tr.WINDOW_WD,
            "kpis": {"batches": len(rows), "delivered": sum(r["delivered"] for r in rows), "escalations": S["total"], "open": S["open"], "median_wait_days": S["median_days"],
                     "latest_working_days": prod[-1]["avg_working_days"] if prod else None}}
