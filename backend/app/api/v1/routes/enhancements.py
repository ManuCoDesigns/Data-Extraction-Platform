"""Extra tools: link health, duplicates, client questions, digest and reminders, audit trail,
people stats, bulk actions, and account settings (email alerts, two-step sign-in)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.mailer import enabled as mail_enabled, send_now
from app.core.notify import notify, admin_user_ids, src_link, ACTION, INFO
from app.core.security import get_current_user, verify_password
from app.core.source_access import project_scopes, restrict_sources_query, is_org_admin
from app.db.session import get_db
from app.models.all_models import (
    AuditAction, AuditLog, ClientQuestion, ExtractedRecord, ExtractionJob, Project, ProjectMember, ReviewStatus, Source, SourceLinkCheck,
    Notification, SourceMessage, SourceMessageRead, SourcePeerReview, SourceStatus, User, UserSettings,
)
from app.services import enh

router = APIRouter(prefix="/enh", tags=["enhancements"])

LEAD_ROLES = {"org_admin", "project_admin", "qa_lead"}
PEER_ROLES = {"pipeline_operator", "reviewer"}


def _roles(u: User) -> set:
    return {r.role.value for r in u.roles}


def _lead(u: User) -> bool:
    return bool(_roles(u) & LEAD_ROLES)


def _need_lead(u: User):
    if not _lead(u):
        raise HTTPException(status_code=403, detail="This is for admins and QA leads.")


def _settings(db: Session, uid: str) -> UserSettings:
    s = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
    if not s:
        s = UserSettings(user_id=uid, email_alerts=True, email_digest=True, totp_enabled=False, failed_logins=0)
        db.add(s)
        db.flush()
    return s


def _visible_sources(db, user, project_id=None):
    q = restrict_sources_query(db.query(Source), user, db)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    return q


# ─── Link health ─────────────────────────────────────────────────────────────

@router.get("/links")
def list_links(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sources = _visible_sources(db, user, project_id).order_by(Source.name).all()
    checks = {c.source_id: c for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_([s.id for s in sources])).all()} if sources else {}
    projects = {p.id: p.name for p in db.query(Project).all()}
    items, summary = [], {"ok": 0, "login": 0, "blocked": 0, "dead": 0, "error": 0, "unchecked": 0, "none": 0}
    for s in sources:
        c = checks.get(s.id)
        if not (s.website_url or "").strip():
            status = "none"
        elif c and c.url == s.website_url:
            status = c.status
        else:
            status = "unchecked"
        summary[status] = summary.get(status, 0) + 1
        items.append({
            "source_id": s.id, "source_name": s.name, "project_id": s.project_id, "project_name": projects.get(s.project_id, ""),
            "url": s.website_url, "status": status, "http_code": c.http_code if c else None, "detail": c.detail if c and status not in ("none", "unchecked") else None,
            "final_url": c.final_url if c else None, "manual": bool(c.manual) if c else False,
            "checked_at": c.checked_at.isoformat() if c and c.checked_at else None,
            "extractor": s.extractor.full_name if s.extractor else None, "source_status": s.status.value,
        })
    return {"items": items, "summary": summary}


class LinkCheckBody(BaseModel):
    project_id: str | None = None
    source_ids: list[str] | None = None
    only_unchecked: bool = False
    force: bool = False
    limit: int = 24


@router.post("/links/check")
def check_links(body: LinkCheckBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Checks one batch (default 24) and says how many are left, so the page can keep going and show progress."""
    _need_lead(user)
    q = _visible_sources(db, user, body.project_id).filter(Source.website_url != None, Source.website_url != "")  # noqa: E711
    if body.source_ids:
        q = q.filter(Source.id.in_(body.source_ids))
    sources = q.all()
    checks = {c.source_id: c for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_([s.id for s in sources])).all()} if sources else {}
    if body.only_unchecked:
        sources = [s for s in sources if not (checks.get(s.id) and checks[s.id].url == s.website_url)]
    else:
        # oldest check first so repeated batches walk through everything
        sources.sort(key=lambda s: (checks[s.id].checked_at.timestamp() if s.id in checks and checks[s.id].checked_at else 0))
    if body.source_ids is None and not body.force and not body.only_unchecked:
        pass
    batch = sources[: max(1, min(body.limit, 40))]
    done = enh.run_link_checks(db, batch, user.id, force=body.force)
    return {"checked": len(done), "remaining": max(0, len(sources) - len(batch)), "results": done}


class LinkMark(BaseModel):
    status: str
    note: str | None = None


@router.put("/links/{source_id}")
def mark_link(source_id: str, body: LinkMark, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Set the link status by hand (the checker can't see everything, a person opened it in a browser)."""
    s = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    if not (_lead(user) or s.assigned_extractor_id == user.id):
        raise HTTPException(status_code=403, detail="Only the extractor or an admin can mark a link.")
    if body.status not in ("ok", "login", "blocked", "dead"):
        raise HTTPException(status_code=422, detail="Status must be ok, login, blocked or dead.")
    row = db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id == source_id).first() or SourceLinkCheck(source_id=source_id)
    row.url, row.status, row.manual = s.website_url, body.status, True
    row.detail = (body.note or "Marked by " + user.full_name)[:500]
    row.checked_at, row.checked_by = enh.now_utc(), user.id
    db.add(row)
    db.commit()
    return {"ok": True}


@router.get("/duplicates")
def duplicates(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    groups = enh.find_duplicates(db, user, project_id)
    return {"groups": groups, "total": len(groups)}


@router.get("/duplicates/sources")
def duplicate_sources(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    groups = enh.find_duplicate_sources(db, user, project_id)
    return {"groups": groups, "total": len(groups)}


@router.get("/counts")
def nav_counts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Small numbers for the sidebar: open client questions, and websites we could not open."""
    pids = _project_ids_for(db, user)
    open_q = db.query(func.count(ClientQuestion.id)).filter(ClientQuestion.project_id.in_(pids), ClientQuestion.status == "open").scalar() if pids else 0
    vis = _visible_sources(db, user).filter(Source.status != SourceStatus.APPROVED).with_entities(Source.id)
    bad = (db.query(func.count(SourceLinkCheck.source_id))
           .filter(SourceLinkCheck.source_id.in_(vis), SourceLinkCheck.status.in_(("login", "blocked", "dead"))).scalar())
    unread = sum(t["unread"] for _, t in _inbox_rows(db, user))
    return {"open_questions": int(open_q or 0), "link_problems": int(bad or 0), "unread_messages": int(unread)}


# ─── Delivery summary (for the client conversation) ─────────────────────────

@router.get("/delivery")
def delivery_summary(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One page of facts for a status call with the client: what is delivered, what is moving,
    what we are waiting on them for, and which websites we could not open."""
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    ids = [s.id for s in srcs]
    pnames = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({s.project_id for s in srcs})).all()} if srcs else {}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({s.assigned_extractor_id for s in srcs if s.assigned_extractor_id})).all()} if srcs else {}

    stage_of = {
        SourceStatus.NOT_STARTED: "not_started", SourceStatus.EXTRACTING: "extraction", SourceStatus.NEEDS_FIXES: "extraction",
        SourceStatus.CHANGES_REQUESTED: "extraction", SourceStatus.READY_FOR_REVIEW: "review", SourceStatus.IN_REVIEW: "review",
        SourceStatus.LLM_VERIFICATION: "review", SourceStatus.APPROVED: "delivered",
    }
    stages = {"not_started": 0, "extraction": 0, "review": 0, "delivered": 0}
    done_ids = [s.id for s in srcs if s.status == SourceStatus.APPROVED]
    live = dict(db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id))
                .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
                .filter(ExtractionJob.source_id.in_(done_ids), ExtractedRecord.review_status == ReviewStatus.APPROVED)
                .group_by(ExtractionJob.source_id).all()) if done_ids else {}   # counted now, not the cached column
    delivered, records_total = [], 0
    for s in srcs:
        st = stage_of.get(s.status, "extraction")
        stages[st] += 1
        if s.status == SourceStatus.APPROVED:
            n_rec = live.get(s.id, s.approved_records or 0)
            records_total += n_rec
            delivered.append({
                "source_id": s.id, "project_id": s.project_id, "name": s.name, "project": pnames.get(s.project_id),
                "approved_at": s.approved_at, "records": n_rec, "item_no": s.external_ref_id,
                "extractor": names.get(s.assigned_extractor_id), "submitted_at": s.xtrium_submitted_at,
            })
    delivered.sort(key=lambda d: str(d["approved_at"] or ""), reverse=True)

    qs = db.query(ClientQuestion).filter(ClientQuestion.project_id.in_({s.project_id for s in srcs} or {""})).order_by(ClientQuestion.created_at.desc()).all()
    waiting = [{"id": q.id, "question": q.question, "source_name": q.source.name if q.source else None, "project_id": q.project_id,
                "source_id": q.source_id, "created_at": q.created_at, "sent_to_client_at": q.sent_to_client_at}
               for q in qs if q.status == "open"]

    checks = {c.source_id: c for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_(ids)).all()} if ids else {}
    cant_open = []
    for s in srcs:
        c = checks.get(s.id)
        if c and c.status in ("login", "blocked", "dead") and s.status != SourceStatus.APPROVED:
            cant_open.append({"source_id": s.id, "project_id": s.project_id, "name": s.name, "url": c.url or s.website_url,
                              "status": c.status, "detail": c.detail})
    cant_open.sort(key=lambda r: (r["status"], r["name"].lower()))

    total = len(srcs)
    week = enh.now_utc() - timedelta(days=7)
    return {
        "generated_at": enh.now_utc(), "project_id": project_id,
        "totals": {"sources": total, "delivered": stages["delivered"], "records_delivered": records_total,
                   "percent": round(100 * stages["delivered"] / total) if total else 0,
                   "delivered_this_week": sum(1 for d in delivered if d["approved_at"] and enh.aware(d["approved_at"]) >= week)},
        "stages": stages, "delivered": delivered[:300], "delivered_count": len(delivered),
        "waiting_on_client": waiting, "cant_open": cant_open,
    }


# ─── Workflow monitor (whole project at a glance) ────────────────────────────

MONITOR_STAGES = ["not_started", "extracting", "needs_fixes", "peer_review", "signoff", "delivered"]


def _monitor_stage(s: Source, peers_done: int, peers_total: int) -> str:
    st = s.status
    if st == SourceStatus.APPROVED:
        return "delivered"
    if st == SourceStatus.NOT_STARTED:
        return "not_started"
    if st == SourceStatus.EXTRACTING:
        return "extracting"
    if st in (SourceStatus.NEEDS_FIXES, SourceStatus.CHANGES_REQUESTED):
        return "needs_fixes"
    if peers_total and peers_done >= peers_total:
        return "signoff"
    return "peer_review"


@router.get("/monitor")
def workflow_monitor(project_id: str | None = None, days: int = Query(30, ge=1, le=365),
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Where every source in the chosen project (or all projects) is in the workflow, who has it,
    how much was extracted, reviewed, sent back and delivered, and how activity moved over time."""
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    now = enh.now_utc()
    since = now - timedelta(days=days)
    empty = {"generated_at": now, "days": days, "project_id": project_id, "stages": {k: 0 for k in MONITOR_STAGES},
             "totals": {}, "series": {"buckets": [], "extracted": [], "peer_submitted": [], "sent_back": [], "delivered": []},
             "projects": [], "sources": []}
    if not srcs:
        return empty
    ids = [s.id for s in srcs]
    pnames = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({s.project_id for s in srcs})).all()}
    uids = {s.assigned_extractor_id for s in srcs if s.assigned_extractor_id}
    unames = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}

    # Records per source: total, valid, approved, sent back at least once.
    rec = {}
    for sid, total, valid, approved, returned in (
        db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id),
                 func.coalesce(func.sum(case((ExtractedRecord.is_schema_valid == True, 1), else_=0)), 0),  # noqa: E712
                 func.coalesce(func.sum(case((ExtractedRecord.review_status == ReviewStatus.APPROVED, 1), else_=0)), 0),
                 func.coalesce(func.sum(case((ExtractedRecord.correction_count > 0, 1), else_=0)), 0))
        .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == False)  # noqa: E712
        .group_by(ExtractionJob.source_id).all()
    ):
        rec[sid] = (int(total), int(valid), int(approved), int(returned))

    stages = {k: 0 for k in MONITOR_STAGES}
    rows, by_project = [], {}
    for s in srcs:
        pr = list(s.peer_reviews)
        done = sum(1 for p in pr if p.status == "submitted")
        stage = _monitor_stage(s, done, len(pr))
        stages[stage] += 1
        total, valid, approved, returned = rec.get(s.id, (0, 0, 0, 0))
        upd = enh.aware(s.updated_at) if s.updated_at else None
        rows.append({
            "source_id": s.id, "project_id": s.project_id, "project": pnames.get(s.project_id), "name": s.name,
            "item_no": s.external_ref_id, "stage": stage, "extractor": unames.get(s.assigned_extractor_id),
            "peers_done": done, "peers_total": len(pr), "records": total, "valid": valid, "approved": approved, "sent_back": returned,
            "days_in_stage": max(0, (now - upd).days) if upd else None, "updated_at": s.updated_at,
            "submitted_to_client": bool(getattr(s, "xtrium_submitted_at", None)),
        })
        pj = by_project.setdefault(s.project_id, {"project_id": s.project_id, "name": pnames.get(s.project_id), "sources": 0,
                                                  "stages": {k: 0 for k in MONITOR_STAGES}, "records": 0, "approved": 0, "sent_back": 0,
                                                  "peers_done": 0, "peers_total": 0, "last_activity": None})
        pj["sources"] += 1; pj["stages"][stage] += 1; pj["records"] += total; pj["approved"] += approved; pj["sent_back"] += returned
        pj["peers_done"] += done; pj["peers_total"] += len(pr)
        if upd and (pj["last_activity"] is None or upd > pj["last_activity"]):
            pj["last_activity"] = upd
    rows.sort(key=lambda r: (MONITOR_STAGES.index(r["stage"]) == len(MONITOR_STAGES) - 1, -(r["days_in_stage"] or 0)))

    # Activity per day (per week for a year view).
    step = 1 if days <= 90 else 7
    first = (since.replace(hour=0, minute=0, second=0, microsecond=0))
    n = (days // step) + 1
    buckets = [first + timedelta(days=step * i) for i in range(n)]
    def idx(ts):
        ts = enh.aware(ts)
        if ts is None or ts < first:
            return None
        i = int((ts - first).days // step)
        return i if 0 <= i < n else None
    series = {k: [0] * n for k in ("extracted", "peer_submitted", "sent_back", "delivered")}
    for (ts,) in (db.query(ExtractedRecord.created_at).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
                  .filter(ExtractionJob.source_id.in_(ids), ExtractedRecord.is_escalation_only == False,  # noqa: E712
                          ExtractedRecord.created_at >= first).all()):
        i = idx(ts)
        if i is not None: series["extracted"][i] += 1
    for (ts,) in db.query(SourcePeerReview.submitted_at).filter(SourcePeerReview.source_id.in_(ids), SourcePeerReview.submitted_at >= first).all():
        i = idx(ts)
        if i is not None: series["peer_submitted"][i] += 1
    for (ts,) in (db.query(AuditLog.timestamp).join(ExtractedRecord, AuditLog.record_id == ExtractedRecord.id)
                  .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
                  .filter(ExtractionJob.source_id.in_(ids), AuditLog.action == AuditAction.RECORD_REJECTED, AuditLog.timestamp >= first).all()):
        i = idx(ts)
        if i is not None: series["sent_back"][i] += 1
    for s in srcs:
        if s.status == SourceStatus.APPROVED and s.approved_at:
            i = idx(s.approved_at)
            if i is not None: series["delivered"][i] += 1

    tot_rec = sum(v[0] for v in rec.values()); tot_app = sum(v[2] for v in rec.values()); tot_ret = sum(v[3] for v in rec.values())
    peers_total = sum(r["peers_total"] for r in rows); peers_done = sum(r["peers_done"] for r in rows)
    stuck = sum(1 for r in rows if r["stage"] != "delivered" and (r["days_in_stage"] or 0) >= 7)
    return {
        "generated_at": now, "days": days, "project_id": project_id, "stages": stages,
        "totals": {"sources": len(srcs), "delivered": stages["delivered"], "percent": round(100 * stages["delivered"] / len(srcs)),
                   "records": tot_rec, "records_approved": tot_app, "records_sent_back": tot_ret,
                   "peers_done": peers_done, "peers_total": peers_total, "stuck": stuck,
                   "submitted_to_client": sum(1 for r in rows if r["submitted_to_client"])},
        "series": {"buckets": [b.date().isoformat() for b in buckets], "step_days": step, **series},
        "projects": sorted(by_project.values(), key=lambda p: (p["name"] or "").lower()),
        "sources": rows[:600],
    }


# ─── Client questions ────────────────────────────────────────────────────────

def _q_out(q: ClientQuestion) -> dict:
    return {
        "id": q.id, "project_id": q.project_id, "source_id": q.source_id, "source_name": q.source.name if q.source else None,
        "question": q.question, "answer": q.answer, "status": q.status,
        "asked_by": q.asker.full_name if q.asker else None, "asked_by_id": q.asked_by,
        "answered_by": q.answerer.full_name if q.answerer else None,
        "sent_to_client_at": q.sent_to_client_at, "created_at": q.created_at, "answered_at": q.answered_at,
    }


def _project_ids_for(db, user) -> set:
    if is_org_admin(user):
        return {p.id for p in db.query(Project.id).all()}
    full, restricted = project_scopes(user, db)
    return full | restricted


class QuestionIn(BaseModel):
    project_id: str
    source_id: str | None = None
    question: str


class AnswerIn(BaseModel):
    answer: str


@router.get("/questions")
def list_questions(project_id: str | None = None, source_id: str | None = None, status: str | None = None,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pids = _project_ids_for(db, user)
    q = db.query(ClientQuestion).filter(ClientQuestion.project_id.in_(pids))
    if project_id:
        q = q.filter(ClientQuestion.project_id == project_id)
    if source_id:
        q = q.filter(ClientQuestion.source_id == source_id)
    if status in ("open", "answered"):
        q = q.filter(ClientQuestion.status == status)
    items = q.order_by(ClientQuestion.created_at.desc()).limit(500).all()
    counts = dict(db.query(ClientQuestion.status, func.count(ClientQuestion.id)).filter(ClientQuestion.project_id.in_(pids)).group_by(ClientQuestion.status).all())
    return {"items": [_q_out(i) for i in items], "open": counts.get("open", 0), "answered": counts.get("answered", 0)}


@router.post("/questions", status_code=201)
def ask_question(body: QuestionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.project_id not in _project_ids_for(db, user):
        raise HTTPException(status_code=403, detail="You are not on this project.")
    text = (body.question or "").strip()
    if len(text) < 5:
        raise HTTPException(status_code=422, detail="Write the question so the client can answer it.")
    src = None
    if body.source_id:
        src = _visible_sources(db, user).filter(Source.id == body.source_id, Source.project_id == body.project_id).first()
        if not src:
            raise HTTPException(status_code=404, detail="Source not found in this project.")
    q = ClientQuestion(project_id=body.project_id, source_id=body.source_id, question=text, asked_by=user.id, status="open")
    db.add(q)
    db.flush()
    link = "/client-questions"
    for uid in admin_user_ids(db, body.project_id):
        if uid != user.id:
            notify(db, uid, "New question for the client", f"{user.full_name}: {text[:180]}", link, "client_question", ACTION, dedupe=False)
    db.commit()
    db.refresh(q)
    return _q_out(q)


@router.patch("/questions/{qid}")
def answer_question(qid: str, body: AnswerIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    q = db.query(ClientQuestion).filter(ClientQuestion.id == qid, ClientQuestion.project_id.in_(_project_ids_for(db, user))).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    ans = (body.answer or "").strip()
    if not ans:
        raise HTTPException(status_code=422, detail="Write the client's answer first.")
    q.answer, q.status, q.answered_by, q.answered_at = ans, "answered", user.id, enh.now_utc()
    if q.asked_by and q.asked_by != user.id:
        notify(db, q.asked_by, "The client answered your question", f"{q.question[:120]}\n\nAnswer: {ans[:240]}",
               (f"/projects/{q.project_id}/sources/{q.source_id}" if q.source_id else "/client-questions"), "client_answer", INFO, dedupe=False)
    db.commit()
    db.refresh(q)
    return _q_out(q)


@router.post("/questions/{qid}/reopen")
def reopen_question(qid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    q = db.query(ClientQuestion).filter(ClientQuestion.id == qid, ClientQuestion.project_id.in_(_project_ids_for(db, user))).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    q.status, q.answer, q.answered_at, q.answered_by = "open", None, None, None
    db.commit()
    return _q_out(q)


class SentBody(BaseModel):
    ids: list[str]


@router.post("/questions/mark-sent")
def mark_sent(body: SentBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    n = 0
    for q in db.query(ClientQuestion).filter(ClientQuestion.id.in_(body.ids), ClientQuestion.project_id.in_(_project_ids_for(db, user))).all():
        q.sent_to_client_at = enh.now_utc()
        n += 1
    db.commit()
    return {"marked": n}


@router.delete("/questions/{qid}", status_code=204)
def delete_question(qid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(ClientQuestion).filter(ClientQuestion.id == qid, ClientQuestion.project_id.in_(_project_ids_for(db, user))).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if not (_lead(user) or (q.asked_by == user.id and q.status == "open")):
        raise HTTPException(status_code=403, detail="You can only remove your own open questions.")
    db.delete(q)
    db.commit()


# ─── Digest and reminders ────────────────────────────────────────────────────

@router.get("/digest")
def digest(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return enh.build_digest(db, user, project_id)


@router.post("/digest/email-me")
def email_digest(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    if not mail_enabled():
        raise HTTPException(status_code=422, detail="Email isn't set up yet. Add the SMTP settings on the server first.")
    text, html = enh.digest_text(enh.build_digest(db, user))
    if not send_now(user.email, "Daily digest: what is waiting on whom", text, html):
        raise HTTPException(status_code=502, detail="The mail server did not accept the message. Check the SMTP settings.")
    return {"sent_to": user.email}


@router.post("/reminders/run")
def run_reminders_now(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return enh.run_reminders(db)


# ─── Audit trail ─────────────────────────────────────────────────────────────

ACTION_LABELS = {
    "record_approved": "Approved a record", "record_admin_reviewed": "Admin reviewed a record",
    "record_returned_for_correction": "Sent a record back for correction", "record_rejected": "Rejected a record",
    "field_overridden": "Changed a field value", "record_escalated": "Escalated a record", "record_submitted": "Submitted a record",
    "source_reset": "Reset the source", "source_created": "Created the source", "source_status_changed": "Changed the status",
    "source_assigned": "Changed who is assigned", "source_data_uploaded": "Uploaded data", "source_record_fixed": "Fixed a record",
    "source_approved": "Approved the source", "member_added": "Added a member", "member_removed": "Removed a member",
    "user_created": "Created a user", "user_role_changed": "Changed a role", "user_deactivated": "Deactivated a user",
    "work_submitted": "Submitted work", "work_reviewed": "Reviewed work",
}


def _detail(v) -> str:
    if not isinstance(v, dict):
        return "" if v is None else str(v)[:160]
    parts = []
    for k, val in list(v.items())[:4]:
        if isinstance(val, (str, int, float, bool)) or val is None:
            parts.append(f"{k.replace('_', ' ')}: {val}")
    return "; ".join(parts)[:240]


@router.get("/audit")
def audit(project_id: str | None = None, source_id: str | None = None, user_id: str | None = None, action: str | None = None,
          days: int = Query(30, ge=1, le=365), before: str | None = None, limit: int = Query(60, ge=10, le=200),
          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    q = db.query(AuditLog).filter(AuditLog.timestamp >= enh.now_utc() - timedelta(days=days))
    if not is_org_admin(user):
        full, _ = project_scopes(user, db)
        q = q.filter(AuditLog.project_id.in_(full))
    if project_id:
        q = q.filter(AuditLog.project_id == project_id)
    if source_id:
        q = q.filter(AuditLog.source_id == source_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if before:
        try:
            q = q.filter(AuditLog.timestamp < datetime.fromisoformat(before))
        except ValueError:
            pass
    rows = q.order_by(AuditLog.timestamp.desc()).limit(limit + 1).all()
    more = len(rows) > limit
    rows = rows[:limit]
    uids = {r.user_id for r in rows if r.user_id}
    sids = {r.source_id for r in rows if r.source_id}
    users = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    srcs = {s.id: (s.name, s.project_id) for s in db.query(Source).filter(Source.id.in_(sids)).all()} if sids else {}
    items = []
    for r in rows:
        a = r.action.value if hasattr(r.action, "value") else str(r.action)
        sname, spid = srcs.get(r.source_id, (None, None))
        items.append({
            "id": r.id, "at": r.timestamp.isoformat() if r.timestamp else None, "user": users.get(r.user_id, "System"), "user_id": r.user_id,
            "action": a, "label": ACTION_LABELS.get(a, a.replace("_", " ").capitalize()),
            "source_id": r.source_id, "source_name": sname, "project_id": r.project_id or spid,
            "before": _detail(r.before_value), "after": _detail(r.after_value),
        })
    return {"items": items, "next_before": items[-1]["at"] if more and items else None,
            "actions": [{"value": k, "label": v} for k, v in sorted(ACTION_LABELS.items(), key=lambda kv: kv[1])]}


# ─── People stats ────────────────────────────────────────────────────────────

@router.get("/stats/people")
def stats_people(days: int = Query(30, ge=1, le=365), project_id: str | None = None,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    since = enh.now_utc() - timedelta(days=days)
    return {"days": days, "people": enh.people_stats(db, since, project_id, viewer=user)}


@router.get("/stats/me")
def stats_me(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    since = enh.now_utc() - timedelta(days=days)
    rows = enh.people_stats(db, since, None, only_user=user.id, viewer=user)
    mine = rows[0] if rows else None
    return {"days": days, "me": mine}


# ─── Bulk actions ────────────────────────────────────────────────────────────

class BulkBody(BaseModel):
    source_ids: list[str]
    action: str                      # assign_extractor | unassign_extractor | add_peers | remove_peers | send_back | approve
    user_id: str | None = None
    user_ids: list[str] | None = None
    note: str | None = None          # required for send_back: the extractor sees it


REVIEW_STAGES = {SourceStatus.READY_FOR_REVIEW, SourceStatus.IN_REVIEW, SourceStatus.LLM_VERIFICATION}


def _eligible(db, source: Source, u: User) -> str | None:
    m = db.query(ProjectMember).filter(ProjectMember.project_id == source.project_id, ProjectMember.user_id == u.id).first()
    if not m:
        return f"{u.full_name} is not on the '{source.project.name if source.project else 'project'}' project"
    return None


UNDOABLE = {"assign_extractor", "unassign_extractor", "add_peers", "remove_peers"}


def _snapshot(s: Source) -> dict:
    return {"source_id": s.id, "extractor_id": s.assigned_extractor_id, "reviewer_id": s.assigned_reviewer_id,
            "peers": [{"user_id": p.user_id, "status": p.status, "comment": p.comment, "assigned_by": p.assigned_by,
                       "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None} for p in s.peer_reviews]}


@router.post("/sources/bulk")
def bulk(body: BulkBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can change several sources at once.")
    if not body.source_ids:
        raise HTTPException(status_code=422, detail="Choose at least one source.")
    if len(body.source_ids) > 200:
        raise HTTPException(status_code=422, detail="Choose 200 sources or fewer at a time.")
    sources = _visible_sources(db, user).filter(Source.id.in_(body.source_ids)).all()
    found = {s.id for s in sources}
    results = [{"source_id": i, "ok": False, "reason": "Not found, or you can't see it"} for i in body.source_ids if i not in found]

    target = None
    ids = [i for i in dict.fromkeys(body.user_ids or []) if i]
    if body.action == "assign_extractor":
        target = db.query(User).filter(User.id == body.user_id, User.is_active == True).first()  # noqa: E712
        if not target:
            raise HTTPException(status_code=422, detail="Choose who should extract.")
    elif body.action in ("add_peers", "remove_peers"):
        if not ids:
            raise HTTPException(status_code=422, detail="Choose at least one person.")
    elif body.action == "send_back":
        if len((body.note or "").strip()) < 3:
            raise HTTPException(status_code=422, detail="Write a short note so the extractor knows what to fix.")
    elif body.action not in ("unassign_extractor", "approve"):
        raise HTTPException(status_code=422, detail="Unknown action.")
    people = {u.id: u for u in db.query(User).filter(User.id.in_(ids), User.is_active == True).all()} if ids else {}  # noqa: E712

    snaps: dict[str, dict] = {}
    for s in sources:
        if s.status == SourceStatus.APPROVED:
            results.append({"source_id": s.id, "ok": False, "reason": "Already approved"})
            continue
        if body.action in UNDOABLE:
            snaps[s.id] = _snapshot(s)
        if body.action == "send_back":
            if s.status not in REVIEW_STAGES:
                results.append({"source_id": s.id, "ok": False, "reason": "Only work that has been delivered for review can be sent back"})
                continue
            from app.api.v1.routes.sources import _reset_peer_reviews
            s.status = SourceStatus.CHANGES_REQUESTED
            _reset_peer_reviews(s)
            if s.assigned_extractor_id:
                notify(db, s.assigned_extractor_id, f"Sent back for fixes: '{s.name}'", body.note.strip(), src_link(s), "sent_back", ACTION)
            db.add(AuditLog(user_id=user.id, project_id=s.project_id, action=AuditAction.SOURCE_STATUS_CHANGED,
                            after_value={"source_id": s.id, "to": "changes_requested", "note": body.note.strip(), "bulk": True}))
            results.append({"source_id": s.id, "ok": True})
            continue
        if body.action == "approve":
            from app.api.v1.routes.sources import approve_source
            if s.status not in REVIEW_STAGES:
                results.append({"source_id": s.id, "ok": False, "reason": "Not at the review stage yet"})
                continue
            waiting = [r for r in s.peer_reviews if r.status != "submitted"]
            if waiting:
                results.append({"source_id": s.id, "ok": False, "reason": f"Waiting for {len(waiting)} peer review{'s' if len(waiting) > 1 else ''}"})
                continue
            open_recs = (db.query(ExtractedRecord).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
                         .filter(ExtractionJob.source_id == s.id, ExtractedRecord.review_status != ReviewStatus.APPROVED).count())
            if open_recs:
                results.append({"source_id": s.id, "ok": False, "reason": f"{open_recs} record{'s' if open_recs > 1 else ''} not approved yet. Open it to approve or override"})
                continue
            try:
                approve_source(s.id, db, user)     # same rules and audit trail as approving one source
                results.append({"source_id": s.id, "ok": True})
            except HTTPException as e:
                db.rollback()
                results.append({"source_id": s.id, "ok": False, "reason": str(e.detail)})
            continue
        if body.action == "assign_extractor":
            bad = _eligible(db, s, target)
            if bad:
                results.append({"source_id": s.id, "ok": False, "reason": bad})
                continue
            if any(p.user_id == target.id for p in s.peer_reviews):
                results.append({"source_id": s.id, "ok": False, "reason": f"{target.full_name} is a peer reviewer on it"})
                continue
            s.assigned_extractor_id = target.id
            results.append({"source_id": s.id, "ok": True})
        elif body.action == "unassign_extractor":
            s.assigned_extractor_id = None
            results.append({"source_id": s.id, "ok": True})
        elif body.action == "add_peers":
            have = {p.user_id for p in s.peer_reviews}
            added, why = [], None
            for uid in ids:
                u = people.get(uid)
                if not u:
                    why = "Someone you picked isn't active"
                    continue
                if uid == s.assigned_extractor_id:
                    why = f"{u.full_name} is the extractor"
                    continue
                bad = _eligible(db, s, u)
                if bad:
                    why = bad
                    continue
                if uid not in have:
                    s.peer_reviews.append(SourcePeerReview(user_id=uid, status="pending", assigned_by=user.id))
                    added.append(uid)
            if added and not s.assigned_reviewer_id:
                s.assigned_reviewer_id = added[0]
            for uid in added:
                notify(db, uid, f"Peer review requested: '{s.name}'",
                       "You've been asked to peer review this source. Check the records, then submit your review with a comment.",
                       src_link(s), "peer_requested", ACTION)
            results.append({"source_id": s.id, "ok": bool(added) or not why, "reason": None if added else (why or "Already on the list")})
        elif body.action == "remove_peers":
            gone = [p for p in list(s.peer_reviews) if p.user_id in ids]
            for p in gone:
                s.peer_reviews.remove(p)
            rest = [p for p in s.peer_reviews]
            s.assigned_reviewer_id = rest[0].user_id if rest else None
            results.append({"source_id": s.id, "ok": bool(gone), "reason": None if gone else "They were not on it"})
    db.commit()
    undo = [snaps[r["source_id"]] for r in results if r["ok"] and r["source_id"] in snaps]
    return {"results": results, "done": sum(1 for r in results if r["ok"]), "skipped": sum(1 for r in results if not r["ok"]),
            "undo": undo if body.action in UNDOABLE else []}


class UndoBody(BaseModel):
    snapshots: list[dict]


@router.post("/sources/bulk/undo")
def bulk_undo(body: UndoBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Put the extractor and peer reviewers back the way they were before a bulk assignment."""
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can change several sources at once.")
    if len(body.snapshots) > 200:
        raise HTTPException(status_code=422, detail="Too many sources to undo at once.")
    by_id = {str(x.get("source_id")): x for x in body.snapshots}
    sources = _visible_sources(db, user).filter(Source.id.in_(list(by_id))).all()
    restored, skipped = 0, len(by_id) - len(sources)
    for s in sources:
        snap = by_id[s.id]
        if s.status == SourceStatus.APPROVED:
            skipped += 1
            continue
        s.assigned_extractor_id = snap.get("extractor_id")
        s.assigned_reviewer_id = snap.get("reviewer_id")
        keep = {p["user_id"] for p in snap.get("peers", [])}
        for p in list(s.peer_reviews):
            if p.user_id not in keep:
                s.peer_reviews.remove(p)
        have = {p.user_id for p in s.peer_reviews}
        for p in snap.get("peers", []):
            if p["user_id"] not in have:
                sub = None
                if p.get("submitted_at"):
                    try:
                        sub = datetime.fromisoformat(p["submitted_at"])
                    except ValueError:
                        sub = None
                s.peer_reviews.append(SourcePeerReview(user_id=p["user_id"], status=p.get("status") or "pending",
                                                       comment=p.get("comment"), submitted_at=sub, assigned_by=p.get("assigned_by")))
        restored += 1
    db.commit()
    return {"restored": restored, "skipped": skipped}


@router.get("/people")
def people(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who can be picked as extractor or peer reviewer (project members with those roles)."""
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Admins only.")
    q = db.query(ProjectMember)
    if project_id:
        q = q.filter(ProjectMember.project_id == project_id)
    seen, out = set(), []
    for m in q.all():
        u = m.user
        if not u or not u.is_active or u.id in seen:
            continue
        if m.role.value in PEER_ROLES or (_roles(u) & PEER_ROLES):
            seen.add(u.id)
            out.append({"user_id": u.id, "name": u.full_name, "email": u.email, "role": m.role.value})
    out.sort(key=lambda p: (p["name"] or "").lower())
    return {"people": out}


# ─── My settings and two-step sign-in ────────────────────────────────────────

DEFAULT_PREFS = {"timezone": "Africa/Nairobi", "date_format": "DMY", "time_format": "24h"}
DATE_FORMATS = {"DMY", "MDY", "YMD"}
TIME_FORMATS = {"12h", "24h"}


def _settings_out(db, user):
    s = _settings(db, user.id)
    return {"email_alerts": s.email_alerts, "email_digest": s.email_digest, "totp_enabled": s.totp_enabled,
            "email_configured": mail_enabled(), "is_lead": _lead(user), "email": user.email,
            "prefs": {**DEFAULT_PREFS, **(s.prefs or {})}}


@router.get("/me/settings")
def my_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = _settings_out(db, user)
    db.commit()
    return out


class SettingsIn(BaseModel):
    email_alerts: bool | None = None
    email_digest: bool | None = None
    prefs: dict | None = None


def _clean_prefs(raw: dict, current: dict) -> dict:
    out = {**DEFAULT_PREFS, **(current or {})}
    if "timezone" in raw:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(str(raw["timezone"]))
        except Exception:
            raise HTTPException(status_code=422, detail="That timezone isn't recognised.")
        out["timezone"] = str(raw["timezone"])
    if "date_format" in raw:
        if raw["date_format"] not in DATE_FORMATS:
            raise HTTPException(status_code=422, detail="Pick a date format from the list.")
        out["date_format"] = raw["date_format"]
    if "time_format" in raw:
        if raw["time_format"] not in TIME_FORMATS:
            raise HTTPException(status_code=422, detail="Pick 12-hour or 24-hour time.")
        out["time_format"] = raw["time_format"]
    return out


@router.put("/me/settings")
def update_settings(body: SettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user.id)
    if body.email_alerts is not None:
        s.email_alerts = body.email_alerts
    if body.email_digest is not None:
        s.email_digest = body.email_digest
    if body.prefs is not None:
        s.prefs = _clean_prefs(body.prefs, s.prefs)
    db.commit()
    return _settings_out(db, user)


@router.post("/2fa/setup")
def totp_setup(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user.id)
    if s.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-step sign-in is already on. Turn it off first to set it up again.")
    s.totp_secret = enh.new_totp_secret()
    db.commit()
    uri = enh.totp_uri(s.totp_secret, user.email)
    return {"secret": s.totp_secret, "uri": uri, "qr": enh.qr_svg_data_uri(uri)}


class CodeIn(BaseModel):
    code: str
    password: str | None = None


@router.post("/2fa/enable")
def totp_enable(body: CodeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user.id)
    if not s.totp_secret:
        raise HTTPException(status_code=422, detail="Start the setup first.")
    if not enh.verify_totp(s.totp_secret, body.code):
        raise HTTPException(status_code=422, detail="That code isn't right. Check the app and try the next code.")
    s.totp_enabled = True
    db.commit()
    return _settings_out(db, user)


@router.post("/2fa/disable")
def totp_disable(body: CodeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user.id)
    if not s.totp_enabled:
        return _settings_out(db, user)
    if not (body.password and verify_password(body.password, user.hashed_password)):
        raise HTTPException(status_code=422, detail="Enter your password to turn this off.")
    if not enh.verify_totp(s.totp_secret or "", body.code):
        raise HTTPException(status_code=422, detail="That code isn't right.")
    s.totp_enabled, s.totp_secret = False, None
    db.commit()
    return _settings_out(db, user)


@router.post("/users/{uid}/2fa/reset")
def totp_admin_reset(uid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """For someone who lost their phone: an org admin clears their two-step sign-in and unlocks the account."""
    if not is_org_admin(user):
        raise HTTPException(status_code=403, detail="Only org admins can do this.")
    s = _settings(db, uid)
    s.totp_enabled, s.totp_secret, s.failed_logins, s.locked_until = False, None, 0, None
    db.commit()
    return {"ok": True}


# ─── Reminders for stuck sources ─────────────────────────────────────────────

class NudgeBody(BaseModel):
    source_ids: list[str]


@router.post("/nudge")
def nudge_sources(body: NudgeBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Remind whoever is holding each source: the extractor, the peers who have not submitted,
    or the admins when it only needs sign-off. One reminder per person per source per day."""
    _need_lead(user)
    ids = list(dict.fromkeys(str(i) for i in body.source_ids))[:100]
    if not ids:
        raise HTTPException(status_code=422, detail="Pick at least one source.")
    sources = _visible_sources(db, user).filter(Source.id.in_(ids)).all()
    found = {s.id for s in sources}
    skipped = [{"source_id": i, "reason": "Not found"} for i in ids if i not in found]
    now = enh.now_utc()
    day_ago = now - timedelta(hours=24)
    sent = 0
    for s in sources:
        peers = list(s.peer_reviews)
        done = sum(1 for p in peers if p.status == "submitted")
        stage = _monitor_stage(s, done, len(peers))
        if stage == "delivered":
            skipped.append({"source_id": s.id, "reason": "Already delivered"}); continue
        if stage in ("not_started", "extracting", "needs_fixes"):
            who = [s.assigned_extractor_id] if s.assigned_extractor_id else []
            what = "Please send this source back for review." if stage != "needs_fixes" else "A reviewer sent changes back. Please fix and resubmit."
            if stage == "not_started":
                what = "This source is waiting for you to start."
            if not who:
                skipped.append({"source_id": s.id, "reason": "No extractor assigned"}); continue
        elif stage == "peer_review":
            who = [p.user_id for p in peers if p.status != "submitted"]
            what = "Your peer review is still waiting."
        else:
            who = list(admin_user_ids(db, s.project_id))
            what = "All peer reviews are in. It is ready for your sign-off."
        link = src_link(s)
        n_for_src = 0
        for uid in who:
            if uid == user.id:
                continue
            recent = (db.query(Notification.id).filter(Notification.user_id == uid, Notification.kind == "nudge",
                                                       Notification.link == link, Notification.created_at >= day_ago).first())
            if recent:
                continue
            title = f"Reminder: {s.name}"
            if notify(db, uid, title, f"{user.full_name} is checking in. {what}", link, kind="nudge", priority=ACTION, dedupe=False):
                n_for_src += 1
        if n_for_src:
            sent += n_for_src
        else:
            skipped.append({"source_id": s.id, "reason": "Reminded in the last 24 hours" if who else "Nobody to remind"})
    db.commit()
    return {"sent": sent, "skipped": skipped}


# ─── Activity on one source ──────────────────────────────────────────────────

_ACTIVITY = {
    "source_created": ("added this source", "gray"),
    "source_assigned": ("changed who is assigned", "blue"),
    "source_data_uploaded": ("uploaded data", "blue"),
    "source_record_fixed": ("fixed a record", "amber"),
    "source_status_changed": ("moved the source", "purple"),
    "source_approved": ("approved the source", "green"),
    "source_reset": ("reset the source", "red"),
    "record_rejected": ("sent a record back", "amber"),
    "record_approved": ("approved a record", "green"),
    "record_admin_reviewed": ("signed off a record", "green"),
    "record_returned_for_correction": ("returned a record for correction", "amber"),
    "record_sent_to_admin": ("sent a record to the admin", "purple"),
    "record_revision_started": ("started revising a record", "blue"),
    "record_escalated": ("escalated a record", "red"),
    "record_submitted": ("submitted a record", "green"),
    "field_overridden": ("changed a field", "amber"),
}


def _activity_detail(action: str, after: dict | None) -> str | None:
    a = after or {}
    if action == "source_data_uploaded":
        bits = [a.get("file"), f"{a['rows']} rows" if a.get("rows") is not None else None]
        return ", ".join(str(b) for b in bits if b) or None
    if action in ("record_rejected", "record_returned_for_correction", "record_escalated"):
        return (a.get("note") or a.get("reason") or None)
    if action == "source_status_changed" and (a.get("from") or a.get("to")):
        return f"{str(a.get('from') or '').replace('_', ' ')} to {str(a.get('to') or '').replace('_', ' ')}".strip()
    if action == "source_assigned":
        return a.get("peer_reviewers") or None
    if action == "source_approved" and a.get("records") is not None:
        return f"{a['records']} records"
    return None


@router.get("/sources/{source_id}/activity")
def source_activity(source_id: str, limit: int = Query(40, ge=1, le=200),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What happened to one source, newest first. Anyone who can open the source can read it."""
    src = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Source not found.")
    rows = (db.query(AuditLog).filter(AuditLog.source_id == source_id)
            .order_by(AuditLog.timestamp.desc()).limit(limit + 1).all())
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({r.user_id for r in rows if r.user_id})).all()} if rows else {}
    items = []
    for r in rows[:limit]:
        key = r.action.value if hasattr(r.action, "value") else str(r.action)
        text, tone = _ACTIVITY.get(key, (key.replace("_", " "), "gray"))
        items.append({"id": r.id, "at": r.timestamp, "who": names.get(r.user_id) or "System", "text": text, "tone": tone,
                      "detail": _activity_detail(key, r.after_value if isinstance(r.after_value, dict) else None)})
    return {"items": items, "more": len(rows) > limit}


# ─── Conversations on a source ───────────────────────────────────────────────

MSG_MAX = 2000


def _participant_ids(s: Source) -> set:
    ids = {p.user_id for p in s.peer_reviews}
    for x in (s.assigned_extractor_id, s.assigned_reviewer_id):
        if x:
            ids.add(x)
    return ids


def _can_chat(user: User, s: Source) -> bool:
    """Admins and QA leads can join any conversation they can see. Everyone else needs to be on the source."""
    return _lead(user) or user.id in _participant_ids(s)


def _chat_source(db: Session, user: User, source_id: str) -> Source:
    s = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not s or not _can_chat(user, s):
        raise HTTPException(status_code=404, detail="Source not found.")
    return s


def _sender_role(db: Session, s: Source, uid: str | None, roles_by_user: dict) -> str:
    if uid and uid == s.assigned_extractor_id:
        return "Extractor"
    if uid and any(p.user_id == uid for p in s.peer_reviews):
        return "Peer reviewer"
    if uid and uid == s.assigned_reviewer_id:
        return "Reviewer"
    r = roles_by_user.get(uid, set())
    if "org_admin" in r:
        return "Admin"
    if r & LEAD_ROLES:
        return "Lead"
    return "Team"


def _roles_map(db: Session, uids: set) -> dict:
    out: dict = {}
    if not uids:
        return out
    from app.models.all_models import UserRoleAssignment
    for ra in db.query(UserRoleAssignment).filter(UserRoleAssignment.user_id.in_(uids)).all():
        out.setdefault(ra.user_id, set()).add(ra.role.value)
    return out


def _last_read(db: Session, source_id: str, uid: str):
    r = db.query(SourceMessageRead.last_read_at).filter(SourceMessageRead.source_id == source_id, SourceMessageRead.user_id == uid).first()
    return r[0] if r else None


def _aware(dt):
    return dt if (dt is None or dt.tzinfo) else dt.replace(tzinfo=timezone.utc)


@router.get("/sources/{source_id}/messages")
def source_messages(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _chat_source(db, user, source_id)
    rows = db.query(SourceMessage).filter(SourceMessage.source_id == s.id).order_by(SourceMessage.created_at.asc()).limit(300).all()
    uids = {m.user_id for m in rows if m.user_id}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    rmap = _roles_map(db, uids)
    seen = _aware(_last_read(db, s.id, user.id))
    items = [{"id": m.id, "who": names.get(m.user_id) or "Former member", "role": _sender_role(db, s, m.user_id, rmap), "body": m.body,
              "at": m.created_at, "mine": m.user_id == user.id,
              "new": bool(m.user_id != user.id and (seen is None or _aware(m.created_at) > seen))} for m in rows]
    pids = _participant_ids(s)
    people = []
    if pids:
        pn = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(pids)).all()}
        prm = _roles_map(db, set(pids))
        people = [{"name": pn.get(i, "Member"), "role": _sender_role(db, s, i, prm)} for i in pids if i in pn]
    can_post = "read_only" not in _roles(user) or _lead(user)
    return {"items": items, "people": people, "can_post": can_post, "closed": s.status == SourceStatus.APPROVED}


@router.post("/sources/{source_id}/messages/read")
def source_messages_read(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _chat_source(db, user, source_id)
    row = db.query(SourceMessageRead).filter(SourceMessageRead.source_id == s.id, SourceMessageRead.user_id == user.id).first()
    now = enh.now_utc()
    if row:
        row.last_read_at = now
    else:
        db.add(SourceMessageRead(source_id=s.id, user_id=user.id, last_read_at=now))
    # Their chat notice for this source is answered by reading it.
    link = src_link(s)
    for n in db.query(Notification).filter(Notification.user_id == user.id, Notification.kind == "message", Notification.link == link,
                                           Notification.is_read == False).all():  # noqa: E712
        n.is_read = True
    db.commit()
    return {"ok": True}


class MessageBody(BaseModel):
    body: str


@router.post("/sources/{source_id}/messages")
def post_source_message(source_id: str, body: MessageBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _chat_source(db, user, source_id)
    if "read_only" in _roles(user) and not _lead(user):
        raise HTTPException(status_code=403, detail="Your role can read but not write.")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a message first.")
    if len(text) > MSG_MAX:
        raise HTTPException(status_code=422, detail=f"Keep messages under {MSG_MAX} characters.")
    m = SourceMessage(source_id=s.id, user_id=user.id, body=text)
    db.add(m)
    db.flush()
    # Posting counts as having read everything so far.
    row = db.query(SourceMessageRead).filter(SourceMessageRead.source_id == s.id, SourceMessageRead.user_id == user.id).first()
    now = enh.now_utc()
    if row:
        row.last_read_at = now
    else:
        db.add(SourceMessageRead(source_id=s.id, user_id=user.id, last_read_at=now))
    snippet = text if len(text) <= 140 else text[:137] + "..."
    for uid in _participant_ids(s) - {user.id}:
        notify(db, uid, f"New message: {s.name}", f"{user.full_name}: {snippet}", src_link(s), kind="message", priority=INFO)
    db.commit()
    return {"id": m.id, "at": m.created_at}


@router.delete("/messages/{message_id}")
def delete_source_message(message_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    m = db.query(SourceMessage).filter(SourceMessage.id == message_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Message not found.")
    s = _chat_source(db, user, m.source_id)
    if m.user_id != user.id and not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")
    db.delete(m)
    db.commit()
    return {"ok": True}


def _inbox_rows(db: Session, user: User, limit: int = 100):
    """One row per source conversation the person can open, newest first, with how many messages are new for them."""
    vis = {s.id: s for s in _visible_sources(db, user).all()}
    if not vis:
        return []
    ids = list(vis)
    msgs = db.query(SourceMessage).filter(SourceMessage.source_id.in_(ids)).order_by(SourceMessage.created_at.desc()).all()
    reads = {r.source_id: _aware(r.last_read_at) for r in db.query(SourceMessageRead).filter(SourceMessageRead.user_id == user.id, SourceMessageRead.source_id.in_(ids)).all()}
    by: dict = {}
    for m in msgs:
        s = vis[m.source_id]
        if not _can_chat(user, s):
            continue
        t = by.setdefault(m.source_id, {"last": m, "count": 0, "unread": 0})
        t["count"] += 1
        seen = reads.get(m.source_id)
        if m.user_id != user.id and (seen is None or _aware(m.created_at) > seen):
            t["unread"] += 1
    rows = sorted(by.items(), key=lambda kv: kv[1]["last"].created_at, reverse=True)[:limit]
    return [(vis[sid], t) for sid, t in rows]


@router.get("/messages/inbox")
def messages_inbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = _inbox_rows(db, user)
    uids = {t["last"].user_id for _, t in rows if t["last"].user_id}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    pnames = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({s.project_id for s, _ in rows})).all()} if rows else {}
    return {"threads": [{"source_id": s.id, "project_id": s.project_id, "source": s.name, "project": pnames.get(s.project_id, ""),
                         "last_body": t["last"].body[:160], "last_who": names.get(t["last"].user_id) or "Former member",
                         "last_at": t["last"].created_at, "count": t["count"], "unread": t["unread"], "stage": s.status.value} for s, t in rows],
            "unread": sum(t["unread"] for _, t in rows)}
