"""One-click reports and the team lead brief, all read live from the platform."""
import csv
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _need_lead, _project_ids_for, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import ClientQuestion, Source, User, WaitPeriod
from app.services import batch_report as br
from app.services import lead_brief as lb
from app.services import source_timeline as stl
from app.services import trace as tr
from app.services import quality as qsvc

router = APIRouter(prefix="/briefs", tags=["briefs"])

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _month_label(m: str) -> str:
    return f"{MONTHS[int(m[5:7]) - 1]} {m[:4]}"


def _now_month() -> str:
    return datetime.now(timezone(timedelta(hours=3))).strftime("%Y-%m")


def _prev(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


def _periods(srcs: list) -> dict:
    batches = [b for b in br.list_batches(srcs) if b["key"] != "other"]
    months: dict = {}
    for b in batches:
        m = months.setdefault(b["key"][:7], {"value": b["key"][:7], "label": _month_label(b["key"][:7]), "sources": 0, "delivered": 0, "batches": 0})
        m["sources"] += b["sources"]
        m["delivered"] += b["delivered"]
        m["batches"] += 1
    return {"months": sorted(months.values(), key=lambda m: m["value"], reverse=True), "batches": list(reversed(batches)), "this_month": _now_month(), "last_month": _prev(_now_month())}


def _scope(srcs: list, scope: str, value: str | None) -> tuple[list | None, dict]:
    p = _periods(srcs)
    have = {b["key"] for b in p["batches"]}
    if scope == "all":
        return None, {"kind": "all", "label": "Whole engagement"}
    if scope in ("month", "this_month", "last_month"):
        m = value if scope == "month" else (p["this_month"] if scope == "this_month" else p["last_month"])
        keys = [k for k in have if k.startswith(m or "~")]
        if not keys:
            raise HTTPException(status_code=404, detail=f"Nothing was pulled in {_month_label(m) if m else 'that month'}.")
        return keys, {"kind": "month", "value": m, "label": _month_label(m)}
    if scope == "latest":
        if not p["batches"]:
            raise HTTPException(status_code=404, detail="No pulls yet.")
        b = p["batches"][0]
        return [b["key"]], {"kind": "batch", "value": b["key"], "label": b["label"]}
    if scope == "batch":
        b = next((x for x in p["batches"] if x["key"] == value), None)
        if not b:
            raise HTTPException(status_code=404, detail="That batch has no sources you can see.")
        return [b["key"]], {"kind": "batch", "value": b["key"], "label": b["label"]}
    raise HTTPException(status_code=400, detail="Unknown report period.")


def _report(db: Session, user: User, project_id, scope: str, value) -> dict:
    from app.api.v1.routes.quality import _scorecard_data
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if not srcs:
        raise HTTPException(status_code=404, detail="No sources yet.")
    keys, sc_info = _scope(srcs, scope, value)
    try:
        sc, _ = _scorecard_data(db, user, project_id, None, None, None)
    except Exception:
        sc = None
    return br.engagement(db, user, srcs, sc, keys=keys, scope=sc_info)


def _fmt(v, unit=" days"):
    return f"{v}{unit}" if v is not None else "n/a"


def summary_text(r: dict) -> str:
    t, tm = r["totals"], r.get("timing") or {}
    out = [f"*{r['scope']['label']}: delivery summary*", f"• {t['delivered']} of {t['sources']} sources delivered ({t['records_approved']} records approved)"]
    if t.get("final_accuracy") is not None:
        out.append(f"• Final accuracy {t['final_accuracy']}% across {t['fields']} checked fields")
    if tm.get("extraction"):
        e = tm["extraction"]
        out.append(f"• Extraction took {e['avg']} days on average (fastest {e['min']}, slowest {e['max']})")
    v = (tm.get("validation") or {})
    if (v.get("peer") or {}).get("submitted"):
        out.append(f"• {v['peer']['submitted']} peer reviews submitted; admin sign-off on every source")
    c = tm.get("corrections") or {}
    if c:
        out.append(f"• {c.get('records_returned', 0)} records came back for correction across {c.get('sources_returned', 0)} sources")
    if t.get("blocked"):
        out.append(f"• {t['blocked']} sources are blocked and need a decision")
    out.append("_Times are elapsed clock time from the platform, not hands-on hours._")
    return "\n".join(out)


class SubmitBody(BaseModel):
    scope: str = "all"
    value: str | None = None
    count: int = 1
    project_id: str | None = None


@router.post("/submissions")
def set_submissions(body: SubmitBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Record how many times the sources in a report period were submitted to Xtrium (for work submitted again before this was counted)."""
    from app.services import quality as _q
    _need_lead(user)
    srcs = _visible_sources(db, user, body.project_id).all()
    keys, _info = _scope(srcs, body.scope, body.value)
    pb = _q.pull_batches(srcs)
    n = 0
    for s in srcs:
        if s.xtrium_submitted_at and (keys is None or (pb.get(s.id) or {}).get("key") in keys):
            s.xtrium_submit_count = max(1, min(5, int(body.count)))
            n += 1
    db.commit()
    return {"updated": n}


@router.get("/periods")
def periods(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return _periods(_visible_sources(db, user, project_id).all())


@router.get("/report")
def report(scope: str = "latest", value: str | None = None, project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _report(db, user, project_id, scope, value)
    r["summary_text"] = summary_text(r)
    return r


@router.get("/report.csv")
def report_csv(scope: str = "latest", value: str | None = None, project_id: str | None = None, anon: bool = False,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _report(db, user, project_id, scope, value)
    tm = r.get("timing") or {}
    alias: dict = {}

    def who(n):
        if not n:
            return ""
        if not anon:
            return n
        return alias.setdefault(n, f"Person {len(alias) + 1}")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Item", "Source", "Extractor", "Records", "Submitted", "Approved", "Extraction days", "Review days", "Total days", "Returned", "Peer reviews done", "Peer reviews assigned", "Days on hold"])
    for x in tm.get("per_source", []):
        w.writerow([x["item_no"] or "", x["name"], who(x["extractor"]), x["records"], x["submitted_at"] or "", x["approved_at"] or "", x["extraction_days"] if x["extraction_days"] is not None else "",
                    x["review_days"] if x["review_days"] is not None else "", x["total_days"] if x["total_days"] is not None else "", x["returns"], x["peers_done"], x["peers_total"], x["held_days"] or ""])
    w.writerow([])
    w.writerow(["Person", "Sources", "Records", "Avg extraction days", "Slowest", "Peer reviews done", "Avg peer review days"])
    for p in tm.get("people", []):
        e, v = p.get("extraction") or {}, p.get("review") or {}
        w.writerow([who(p["name"]), p["sources"], p["records"], e.get("avg", ""), e.get("max", ""), p["reviews_done"], v.get("avg", "")])
    w.writerow([])
    w.writerow([tm.get("caveat", "")])
    name = f"report_{(r['scope'].get('value') or 'all').replace(' ', '_')}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _timelines(db: Session, user: User, project_id, scope: str, value, anon: bool):
    r = _report(db, user, project_id, scope, value)
    srcs = {s.id: s for s in _visible_sources(db, user, project_id).all()}
    return r, stl.batches_for(db, r, srcs, anon)


@router.get("/timelines")
def timelines(scope: str = "latest", value: str | None = None, project_id: str | None = None, anon: bool = False,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every dated step of every source in the report, grouped by batch."""
    r, b = _timelines(db, user, project_id, scope, value, anon)
    return {"scope": r["scope"], "batches": b}


@router.get("/timelines.xlsx")
def timelines_xlsx(scope: str = "latest", value: str | None = None, project_id: str | None = None, anon: bool = False,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r, b = _timelines(db, user, project_id, scope, value, anon)
    data = stl.workbook(b, r["scope"].get("label") or "Whole engagement")
    name = f"source_timelines_{(r['scope'].get('value') or 'all').replace(' ', '_')}.xlsx"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/lead")
def lead(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    b = lb.build(db, srcs)
    b["text"] = lb.text(b)
    return b


# ─── Delivery trace: escalations, batch clock, active days, waiting periods ──

def _trace(db: Session, user: User, project_id, scope: str, value):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if not srcs:
        raise HTTPException(status_code=404, detail="No sources yet.")
    keys, sc_info = _scope(srcs, scope, value)
    batches = qsvc.pull_batches(srcs)
    pick = [s for s in srcs if keys is None or (batches.get(s.id) or {}).get("key") in keys]
    return sc_info, tr.build(db, pick, batches, _project_ids_for(db, user), project_id)


@router.get("/trace")
def trace(scope: str = "latest", value: str | None = None, project_id: str | None = None,
          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What we asked and waited on, the 5-working-day batch clock, and the days work really happened, from the platform's own records."""
    sc, t = _trace(db, user, project_id, scope, value)
    t["scope"] = sc
    return t


@router.get("/trace.xlsx")
def trace_xlsx(scope: str = "latest", value: str | None = None, project_id: str | None = None,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sc, t = _trace(db, user, project_id, scope, value)
    data = tr.workbook(t, sc.get("label") or "Whole engagement")
    name = f"delivery_trace_{(sc.get('value') or 'all').replace(' ', '_')}.xlsx"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _when(v: datetime | None):
    """A time typed in the form has no zone: it is Nairobi time."""
    if v is None:
        return None
    return v.replace(tzinfo=tr.NAIROBI) if v.tzinfo is None else v


class EscIn(BaseModel):
    project_id: str
    source_id: str | None = None
    question: str
    kind: str = "escalation"
    blocks_clock: bool = False
    topic: str | None = None
    raised_at: datetime | None = None
    first_reply_at: datetime | None = None
    answered_at: datetime | None = None
    answer: str | None = None


class EscPatch(BaseModel):
    question: str | None = None
    kind: str | None = None
    blocks_clock: bool | None = None
    topic: str | None = None
    raised_at: datetime | None = None
    first_reply_at: datetime | None = None
    answered_at: datetime | None = None
    answer: str | None = None
    reopen: bool = False
    answered_now: bool = False


def _own_q(db: Session, user: User, qid: str) -> ClientQuestion:
    q = db.query(ClientQuestion).filter(ClientQuestion.id == qid, ClientQuestion.project_id.in_(_project_ids_for(db, user))).first()
    if not q:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return q


def _kind(k: str | None) -> str:
    if k not in ("question", "escalation", "blocker"):
        raise HTTPException(status_code=422, detail="Type must be question, escalation or blocker.")
    return k


class FlagIn(BaseModel):
    project_id: str | None = None
    batch_key: str | None = None
    source_ids: list[str] | None = None
    flag: str = ""


@router.post("/trace/flag")
def flag_sources(body: FlagIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Mark a whole pulled batch (or chosen sources) as test sources or as covered earlier, so the delivery clock and active days leave them out. An empty flag clears it."""
    _need_lead(user)
    if body.flag not in ("", "test", "covered"):
        raise HTTPException(status_code=422, detail="Flag must be test, covered, or empty to clear.")
    srcs = _visible_sources(db, user, body.project_id).all()
    batches = qsvc.pull_batches(srcs)
    pick = [s for s in srcs if (body.batch_key and (batches.get(s.id) or {}).get("key") == body.batch_key and body.batch_key != "other") or (body.source_ids and s.id in body.source_ids)]
    if not pick:
        raise HTTPException(status_code=404, detail="No matching sources.")
    for s in pick:
        s.trace_flag = body.flag or None
    db.commit()
    return {"updated": len(pick)}


class SlackIn(BaseModel):
    project_id: str


@router.post("/escalations/import-slack")
def import_slack(body: SlackIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Load the escalations raised with Xtrium in the project chat, with their real Slack times. Repeating it adds nothing twice."""
    _need_lead(user)
    if body.project_id not in _project_ids_for(db, user):
        raise HTTPException(status_code=403, detail="You are not on this project.")
    from app.services import slack_escalations as se
    return se.load(db, body.project_id, user.id)


@router.post("/escalations", status_code=201)
def add_escalation(body: EscIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Log an escalation or question with its real times (from the chat), so the days waited are right."""
    _need_lead(user)
    if body.project_id not in _project_ids_for(db, user):
        raise HTTPException(status_code=403, detail="You are not on this project.")
    text = (body.question or "").strip()
    if len(text) < 5:
        raise HTTPException(status_code=422, detail="Write what was asked.")
    if body.source_id and not db.query(Source.id).filter(Source.id == body.source_id, Source.project_id == body.project_id).first():
        raise HTTPException(status_code=404, detail="Source not found in this project.")
    q = ClientQuestion(project_id=body.project_id, source_id=body.source_id, question=text, asked_by=user.id, status="open", kind=_kind(body.kind),
                       blocks_clock=body.blocks_clock, topic=body.topic, asked_at=_when(body.raised_at) or tr.now(), first_reply_at=_when(body.first_reply_at))
    q.sent_to_client_at = q.asked_at
    if body.answered_at or (body.answer or "").strip():
        q.status, q.answered_at, q.answered_by = "answered", _when(body.answered_at) or tr.now(), user.id
        q.answer = (body.answer or "").strip() or "Answered in the chat."
    db.add(q)
    db.commit()
    return {"id": q.id}


@router.patch("/escalations/{qid}")
def edit_escalation(qid: str, body: EscPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    q = _own_q(db, user, qid)
    if body.question is not None and len(body.question.strip()) >= 5:
        q.question = body.question.strip()
    if body.kind is not None:
        q.kind = _kind(body.kind)
    if body.blocks_clock is not None:
        q.blocks_clock = body.blocks_clock
    if body.topic is not None:
        q.topic = body.topic or None
    if body.raised_at is not None:
        q.asked_at = _when(body.raised_at)
        q.sent_to_client_at = q.asked_at
    if body.first_reply_at is not None:
        q.first_reply_at = _when(body.first_reply_at)
    if body.reopen:
        q.status, q.answered_at, q.answer, q.answered_by = "open", None, None, None
    elif body.answered_now or body.answered_at is not None:
        q.status, q.answered_by = "answered", user.id
        q.answered_at = _when(body.answered_at) if body.answered_at is not None else tr.now()
        q.answer = (body.answer or "").strip() or q.answer or "Answered in the chat."
    elif body.answer is not None and q.status == "answered":
        q.answer = body.answer.strip() or q.answer
    db.commit()
    return {"id": q.id, "status": q.status}


class WaitIn(BaseModel):
    project_id: str
    kind: str = "links"
    reason: str
    started_at: datetime
    ended_at: datetime | None = None


class WaitPatch(BaseModel):
    reason: str | None = None
    kind: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    end_now: bool = False
    reopen: bool = False


def _own_w(db: Session, user: User, wid: str) -> WaitPeriod:
    w = db.query(WaitPeriod).filter(WaitPeriod.id == wid, WaitPeriod.project_id.in_(_project_ids_for(db, user))).first()
    if not w:
        raise HTTPException(status_code=404, detail="Waiting period not found")
    return w


def _wkind(k: str | None) -> str:
    if k not in ("links", "decision", "access", "other"):
        raise HTTPException(status_code=422, detail="Kind must be links, decision, access or other.")
    return k


@router.post("/waits", status_code=201)
def add_wait(body: WaitIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Log a stretch where the team could not work, for example no links assigned."""
    _need_lead(user)
    if body.project_id not in _project_ids_for(db, user):
        raise HTTPException(status_code=403, detail="You are not on this project.")
    if len((body.reason or "").strip()) < 3:
        raise HTTPException(status_code=422, detail="Say what we were waiting for.")
    start, end = _when(body.started_at), _when(body.ended_at)
    if end and end <= start:
        raise HTTPException(status_code=422, detail="The end must be after the start.")
    w = WaitPeriod(project_id=body.project_id, kind=_wkind(body.kind), reason=body.reason.strip(), started_at=start, ended_at=end, created_by=user.id)
    db.add(w)
    db.commit()
    return {"id": w.id}


@router.patch("/waits/{wid}")
def edit_wait(wid: str, body: WaitPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    w = _own_w(db, user, wid)
    if body.reason is not None and len(body.reason.strip()) >= 3:
        w.reason = body.reason.strip()
    if body.kind is not None:
        w.kind = _wkind(body.kind)
    if body.started_at is not None:
        w.started_at = _when(body.started_at)
    if body.reopen:
        w.ended_at = None
    elif body.end_now:
        w.ended_at = tr.now()
    elif body.ended_at is not None:
        w.ended_at = _when(body.ended_at)
    if w.ended_at and tr.aw(w.ended_at) <= tr.aw(w.started_at):
        raise HTTPException(status_code=422, detail="The end must be after the start.")
    db.commit()
    return {"id": w.id}


@router.delete("/waits/{wid}", status_code=204)
def delete_wait(wid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    db.delete(_own_w(db, user, wid))
    db.commit()
