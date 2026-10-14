"""Quality: log errors on records, let the system confirm what it can, check fields against the real source,
and score the process from those checks."""
import random
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _can_chat, _lead, _need_lead, _owner_ids, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import (
    ExtractedRecord, ExtractionJob, FieldAudit, Project, QualityFinding, SchemaVersion, Source, SourcePeerReview, SourceStatus, User,
)
from app.services import enh, quality as q

router = APIRouter(prefix="/quality", tags=["quality"])


def _schema_fields(db: Session, s: Source) -> list[dict]:
    if not s.schema_id:
        return []
    v = db.query(SchemaVersion).filter(SchemaVersion.schema_id == s.schema_id).order_by(SchemaVersion.version.desc()).first()
    return (v.definition or {}).get("fields", []) if v else []


def _records(db: Session, source_id: str) -> list[ExtractedRecord]:
    return (db.query(ExtractedRecord).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
            .filter(ExtractionJob.source_id == source_id).order_by(ExtractedRecord.created_at.asc()).all())


def _source(db: Session, user: User, source_id: str) -> Source:
    s = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not s or not _can_chat(user, s):
        raise HTTPException(status_code=404, detail="Source not found.")
    return s


def _label(r: ExtractedRecord, i: int | None = None) -> str:
    return r.canonical_name or (r.extracted_fields or {}).get("name") or (r.extracted_fields or {}).get("company_name") or f"Record {i + 1 if i is not None else r.id[:6]}"


def _peer_done(s: Source, user: User) -> bool:
    return any(p.user_id == user.id and p.status == "submitted" for p in s.peer_reviews)


def _can_see(user: User, s: Source, f: QualityFinding) -> bool:
    """Peers log errors on their own before they see anyone else's, like their review comments."""
    if _lead(user) or user.id == s.assigned_extractor_id or f.origin == "system" or f.raised_by == user.id:
        return True
    return _peer_done(s, user)


def _out(f: QualityFinding, names: dict, labels: dict | None = None) -> dict:
    return {"id": f.id, "source_id": f.source_id, "record_id": f.record_id, "record": (labels or {}).get(f.record_id),
            "field": f.field, "category": f.category, "category_label": q.CATEGORIES.get(f.category, f.category), "severity": f.severity,
            "origin": f.origin, "rule": f.rule, "note": f.note, "extracted_value": f.extracted_value, "status": f.status,
            "auto_verdict": f.auto_verdict, "auto_note": f.auto_note, "truth_value": f.truth_value, "resolve_note": f.resolve_note,
            "raised_by": names.get(f.raised_by) if f.raised_by else ("System checks" if f.origin == "system" else None),
            "raised_by_id": f.raised_by, "created_at": f.created_at, "resolved_at": f.resolved_at, "resolved_by": names.get(f.resolved_by) if f.resolved_by else None}


def _names(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    return {u.id: u.full_name for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


class FindingBody(BaseModel):
    record_id: str
    field: str | None = None
    category: str
    severity: str = "major"
    note: str | None = None


@router.post("/findings")
def raise_finding(body: FindingBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == body.record_id).first()
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first() if rec else None
    s = _source(db, user, job.source_id) if job and job.source_id else None
    if not s:
        raise HTTPException(status_code=404, detail="Record not found.")
    if not (_lead(user) or user.id in _owner_ids(s)):
        raise HTTPException(status_code=403, detail="Only reviewers and admins can log errors.")
    if body.category not in q.CATEGORIES:
        raise HTTPException(status_code=422, detail="Pick what kind of error this is.")
    if body.severity not in q.SEVERITIES:
        raise HTTPException(status_code=422, detail="Pick how serious it is.")
    field = (body.field or "").strip() or None
    if field and field not in (rec.extracted_fields or {}) and field not in {f.get("name") for f in _schema_fields(db, s)}:
        raise HTTPException(status_code=422, detail="That field is not on this record.")
    note = (body.note or "").strip() or None
    if body.category in ("wrong_value", "unsupported_value", "other") and not note:
        raise HTTPException(status_code=422, detail="Say what is wrong, so an admin can check it against the source.")
    dup = (db.query(QualityFinding.id).filter(QualityFinding.record_id == rec.id, QualityFinding.field == field, QualityFinding.raised_by == user.id,
                                              QualityFinding.status == "open", QualityFinding.category == body.category).first())
    if dup:
        raise HTTPException(status_code=409, detail="You already logged this error and it is waiting for an admin.")
    verdict, vnote = q.auto_verify(rec, _schema_fields(db, s), field, body.category)
    f = QualityFinding(source_id=s.id, record_id=rec.id, field=field, category=body.category, severity=body.severity, origin="reviewer",
                       raised_by=user.id, note=note, extracted_value=(rec.extracted_fields or {}).get(field) if field else None,
                       auto_verdict=verdict, auto_note=vnote)
    db.add(f)
    db.commit()
    return _out(f, _names(db, {user.id}))


@router.get("/records/{record_id}/findings")
def record_findings(record_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == record_id).first()
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first() if rec else None
    s = _source(db, user, job.source_id) if job and job.source_id else None
    if not s:
        raise HTTPException(status_code=404, detail="Record not found.")
    rows = [f for f in db.query(QualityFinding).filter(QualityFinding.record_id == record_id).order_by(QualityFinding.created_at.asc()).all() if _can_see(user, s, f)]
    names = _names(db, {f.raised_by for f in rows} | {f.resolved_by for f in rows})
    return {"items": [_out(f, names) for f in rows], "fields": sorted((rec.extracted_fields or {}).keys()),
            "can_raise": _lead(user) or user.id in _owner_ids(s)}


@router.get("/sources/{source_id}/findings")
def source_findings(source_id: str, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _source(db, user, source_id)
    recs = _records(db, s.id)
    labels = {r.id: _label(r, i) for i, r in enumerate(recs)}
    qy = db.query(QualityFinding).filter(QualityFinding.source_id == s.id)
    if status:
        qy = qy.filter(QualityFinding.status == status)
    rows = [f for f in qy.order_by(QualityFinding.created_at.desc()).limit(500).all() if _can_see(user, s, f)]
    names = _names(db, {f.raised_by for f in rows} | {f.resolved_by for f in rows})
    return {"items": [_out(f, names, labels) for f in rows]}


class ResolveBody(BaseModel):
    status: str
    truth_value: str | None = None
    note: str | None = None


@router.post("/findings/{finding_id}/resolve")
def resolve_finding(finding_id: str, body: ResolveBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    f = db.query(QualityFinding).filter(QualityFinding.id == finding_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Finding not found.")
    _source(db, user, f.source_id)
    if body.status not in ("confirmed", "dismissed", "open"):
        raise HTTPException(status_code=422, detail="Choose confirm or dismiss.")
    f.status = body.status
    f.truth_value = (body.truth_value or "").strip() or None
    f.resolve_note = (body.note or "").strip() or None
    f.resolved_by = user.id if body.status != "open" else None
    f.resolved_at = enh.now_utc() if body.status != "open" else None
    db.commit()
    return _out(f, _names(db, {f.raised_by, f.resolved_by}))


def _sop_for(s: Source) -> dict:
    from app.api.v1.routes.integrations import _sop_requirements
    return _sop_requirements(s)


@router.get("/sources/{source_id}/sop-check")
def sop_check_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every record in the source checked against the SOP saved for it: is each required field filled in?"""
    _need_lead(user)
    s = _source(db, user, source_id)
    req = _sop_for(s)
    base = {"source_id": s.id, "source": s.name, "known": bool(req["known"] and req["required"]), "sop_code": req["sop_code"], "required": req["required"]}
    if not base["known"]:
        return {**base, "records": 0, "compliant": 0, "rate": None, "by_field": [], "extra_fields": [], "failing": [], "failing_total": 0}
    recs = [(r.id, _label(r, i), r.extracted_fields or {}) for i, r in enumerate(_records(db, s.id))]
    return {**base, **q.sop_report(recs, req["required"], req["allowed"])}


@router.get("/sop-overview")
def sop_overview(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One line per source: how many records follow the SOP's required fields."""
    _need_lead(user)
    out = []
    for s in _visible_sources(db, user, project_id).filter(Source.status != SourceStatus.NOT_STARTED).all():
        req = _sop_for(s)
        row = {"source_id": s.id, "name": s.name, "sop_code": req["sop_code"], "known": bool(req["known"] and req["required"]), "records": 0, "compliant": 0, "rate": None}
        if row["known"]:
            recs = [(r.id, "", r.extracted_fields or {}) for r in _records(db, s.id)]
            rep = q.sop_report(recs, req["required"], req["allowed"])
            row.update(records=rep["records"], compliant=rep["compliant"], rate=rep["rate"])
        out.append(row)
    return {"items": sorted(out, key=lambda x: (not x["known"], x["rate"] if x["rate"] is not None else 101, x["name"]))}


@router.post("/sources/{source_id}/scan")
def scan_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Run the automatic checks over every record in the source and log what they find."""
    _need_lead(user)
    s = _source(db, user, source_id)
    fields = _schema_fields(db, s)
    recs = _records(db, s.id)
    have = {(f.record_id, f.field, f.rule) for f in db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.origin == "system").all()}
    created = 0
    seen_names: dict = {}
    req = _sop_for(s)
    sop_on = bool(req["known"] and req["required"])
    for r in recs:
        hits = q.check_record(r.extracted_fields or {}, fields)
        if sop_on:
            sc = q.sop_check(r.extracted_fields or {}, req["required"], req["allowed"])
            already = {h["field"] for h in hits if h["category"] == "missing_value"}
            code = req["sop_code"] or "the SOP"
            hits += [{"field": f, "category": "sop_rule", "rule": "sop_required", "severity": "major", "message": f"{code} requires this field and it is empty."} for f in sc["missing"] if f not in already]
            hits += [{"field": f, "category": "sop_rule", "rule": "sop_extra", "severity": "minor", "message": f"{code} does not list this field."} for f in sc["extra"]]
        for h in hits:
            key = (r.id, h["field"], h["rule"])
            if key in have:
                continue
            have.add(key)
            db.add(QualityFinding(source_id=s.id, record_id=r.id, field=h["field"], category=h["category"], severity=h["severity"], origin="system",
                                  rule=h["rule"], note=h["message"], extracted_value=(r.extracted_fields or {}).get(h["field"]),
                                  auto_verdict="confirmed", auto_note="Found by the system's own checks."))
            created += 1
        nm = (r.canonical_name or "").strip().lower()
        if nm:
            if nm in seen_names and (r.id, None, "duplicate") not in have:
                have.add((r.id, None, "duplicate"))
                db.add(QualityFinding(source_id=s.id, record_id=r.id, field=None, category="duplicate", severity="major", origin="system", rule="duplicate",
                                      note="Another record in this source has the same name.", auto_verdict="confirmed", auto_note="Found by the system's own checks."))
                created += 1
            seen_names.setdefault(nm, r.id)
    db.commit()
    return {"created": created, "records": len(recs), "sop_checked": sop_on}


@router.get("/sources/{source_id}/sample")
def audit_sample(source_id: str, limit: int = Query(30, ge=5, le=100), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fields to check against the real source: ones already doubted first, then a random spread across records."""
    _need_lead(user)
    s = _source(db, user, source_id)
    recs = _records(db, s.id)
    audited = {(a.record_id, a.field): a for a in db.query(FieldAudit).filter(FieldAudit.source_id == s.id).all()}
    doubted = {(f.record_id, f.field) for f in db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.status != "dismissed").all() if f.field}
    rnd = random.Random(s.id)
    pool, first = [], []
    for i, r in enumerate(recs):
        for k, v in (r.extracted_fields or {}).items():
            if k in q.SKIP_FIELDS or not q._present(v):
                continue
            item = {"record_id": r.id, "record": _label(r, i), "field": k, "value": v, "reason": "doubted" if (r.id, k) in doubted else "random"}
            a = audited.get((r.id, k))
            if a:
                item.update(audit_id=a.id, verdict=a.verdict, truth_value=a.truth_value, note=a.note)
            (first if item["reason"] == "doubted" else pool).append(item)
    rnd.shuffle(pool)
    todo = [x for x in first if "audit_id" not in x] + [x for x in pool if "audit_id" not in x]
    done = [x for x in first + pool if "audit_id" in x]
    return {"items": todo[:limit], "done": done[-limit:], "audited": len(audited), "fields_total": len(first) + len(pool)}


class AuditBody(BaseModel):
    record_id: str
    field: str
    verdict: str
    truth_value: str | None = None
    note: str | None = None


@router.post("/audits")
def save_audit(body: AuditBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == body.record_id).first()
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first() if rec else None
    s = _source(db, user, job.source_id) if job and job.source_id else None
    if not s:
        raise HTTPException(status_code=404, detail="Record not found.")
    if body.verdict not in ("correct", "incorrect"):
        raise HTTPException(status_code=422, detail="Mark the field correct or incorrect.")
    if body.field not in (rec.extracted_fields or {}):
        raise HTTPException(status_code=422, detail="That field is not on this record.")
    truth = (body.truth_value or "").strip() or None
    if body.verdict == "incorrect" and not truth and not (body.note or "").strip():
        raise HTTPException(status_code=422, detail="Add what the source really says, or a short note.")
    a = db.query(FieldAudit).filter(FieldAudit.record_id == rec.id, FieldAudit.field == body.field).first()
    if not a:
        a = FieldAudit(source_id=s.id, record_id=rec.id, field=body.field, verdict=body.verdict)
        db.add(a)
    a.verdict, a.truth_value, a.note = body.verdict, truth, (body.note or "").strip() or None
    a.extracted_value, a.audited_by, a.audited_at = rec.extracted_fields.get(body.field), user.id, enh.now_utc()
    db.commit()
    return {"id": a.id, "verdict": a.verdict}


@router.delete("/audits/{audit_id}")
def delete_audit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    a = db.query(FieldAudit).filter(FieldAudit.id == audit_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Check not found.")
    _source(db, user, a.source_id)
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.get("/sources")
def quality_sources(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Sources to work on in the Quality page, with how much has been logged and checked."""
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).filter(Source.status != SourceStatus.NOT_STARTED).all()
    if not srcs:
        return {"items": []}
    ids = [s.id for s in srcs]
    from sqlalchemy import func
    fo = dict(db.query(QualityFinding.source_id, func.count(QualityFinding.id)).filter(QualityFinding.source_id.in_(ids), QualityFinding.status == "open").group_by(QualityFinding.source_id).all())
    ft = dict(db.query(QualityFinding.source_id, func.count(QualityFinding.id)).filter(QualityFinding.source_id.in_(ids)).group_by(QualityFinding.source_id).all())
    au = dict(db.query(FieldAudit.source_id, func.count(FieldAudit.id)).filter(FieldAudit.source_id.in_(ids)).group_by(FieldAudit.source_id).all())
    pn = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({s.project_id for s in srcs})).all()}
    return {"items": sorted(({"source_id": s.id, "project_id": s.project_id, "project": pn.get(s.project_id, ""), "name": s.name, "status": s.status.value,
                              "open_findings": int(fo.get(s.id, 0)), "findings": int(ft.get(s.id, 0)), "audited": int(au.get(s.id, 0))} for s in srcs),
                            key=lambda x: (-x["open_findings"], x["name"]))}


@router.get("/summary")
def quality_summary(project_id: str | None = None, source_id: str | None = None, days: int = Query(90, ge=1, le=730),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if source_id:
        srcs = [s for s in srcs if s.id == source_id]
    ids = [s.id for s in srcs]
    empty = q.compute_summary([], [], {}, {}, {})
    if not ids:
        return {**empty, "days": days}
    since = enh.now_utc() - timedelta(days=days)
    findings = [f for f in db.query(QualityFinding).filter(QualityFinding.source_id.in_(ids)).all() if enh_aware(f.created_at) >= since]
    audits = [a for a in db.query(FieldAudit).filter(FieldAudit.source_id.in_(ids)).all() if enh_aware(a.audited_at) >= since]
    recs: dict = {}
    for r, sid in (db.query(ExtractedRecord, ExtractionJob.source_id).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
                   .filter(ExtractionJob.source_id.in_(ids)).all()):
        recs.setdefault(sid, []).append(r)
    ext_of = {s.id: s.assigned_extractor_id for s in srcs}
    uids = {f.raised_by for f in findings} | set(v for v in ext_of.values() if v)
    out = q.compute_summary(findings, audits, recs, ext_of, _names(db, uids))
    out["days"] = days
    out["sources"] = len(ids)
    return out


def enh_aware(dt):
    from datetime import timezone
    if dt is None:
        return enh.now_utc()
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ─── Review workspace: one place for the automatic signals and the human check ─────────────

def _peer_state(s: Source) -> tuple[int, int]:
    prs = list(s.peer_reviews or [])
    return len(prs), sum(1 for p in prs if p.status == "submitted")


@router.get("/review/sources")
def review_sources(project_id: str | None = None, scope: str = Query("peer_done"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Sources to review, grouped by project. scope=peer_done lists only sources every peer reviewer has finished.
    `projects` always lists every project the person can see, with counts, even when none of its sources are ready."""
    _need_lead(user)
    from sqlalchemy import func
    allsrc = _visible_sources(db, user, None).all()
    pids = {s.project_id for s in allsrc}
    if "org_admin" in {r.role.value for r in user.roles}:
        pids |= {p.id for p in db.query(Project.id).all()}
    pn = {p.id: p.name for p in db.query(Project).filter(Project.id.in_(pids)).all()} if pids else {}
    ids = [s.id for s in allsrc]
    open_f = dict(db.query(QualityFinding.source_id, func.count(QualityFinding.id)).filter(QualityFinding.source_id.in_(ids or ["-"]), QualityFinding.status == "open").group_by(QualityFinding.source_id).all())
    aud = dict(db.query(FieldAudit.source_id, func.count(FieldAudit.id)).filter(FieldAudit.source_id.in_(ids or ["-"])).group_by(FieldAudit.source_id).all())
    rec_n = dict(db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id)).join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
                 .filter(ExtractionJob.source_id.in_(ids or ["-"])).group_by(ExtractionJob.source_id).all())
    proj = {k: {"id": k, "name": pn.get(k, ""), "sources": 0, "peer_done": 0, "checked": 0, "open": 0} for k in pids}
    rows = []
    for s in allsrc:
        total, done = _peer_state(s)
        peer_done = total > 0 and done == total
        pr = proj.setdefault(s.project_id, {"id": s.project_id, "name": pn.get(s.project_id, ""), "sources": 0, "peer_done": 0, "checked": 0, "open": 0})
        pr["sources"] += 1
        pr["peer_done"] += 1 if peer_done else 0
        pr["checked"] += int(aud.get(s.id, 0))
        pr["open"] += int(open_f.get(s.id, 0))
        if s.status == SourceStatus.NOT_STARTED or (project_id and s.project_id != project_id):
            continue
        if scope == "peer_done" and not peer_done:
            continue
        rows.append({"source_id": s.id, "project_id": s.project_id, "project": pn.get(s.project_id, ""), "name": s.name, "status": s.status.value,
                     "peers_total": total, "peers_done": done, "peer_done": peer_done, "records": int(rec_n.get(s.id, 0)),
                     "open_findings": int(open_f.get(s.id, 0)), "audited": int(aud.get(s.id, 0))})
    rows.sort(key=lambda x: (x["project"].lower(), -x["open_findings"], x["name"].lower()))
    return {"items": rows, "projects": sorted(proj.values(), key=lambda x: x["name"].lower())}


def _email_ids(db: Session, emails: set) -> dict:
    emails = {e for e in emails if e}
    return {u.email: u for u in db.query(User).filter(User.email.in_(emails)).all()} if emails else {}


@router.get("/review/sources/{source_id}")
def review_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every record in a source with each field's signals: peer comments, peer mentions, SOP gaps, system checks, AI and website flags."""
    _need_lead(user)
    s = _source(db, user, source_id)
    return _review_data(db, s, True, user.id)


@router.get("/sources/{source_id}/signals")
def source_signals(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The same signals for the source page. Admins see everything. Reviewers and extractors see only the automatic
    ones (SOP, system, AI, website) and their own logged errors, so peers stay independent of each other."""
    s = _source(db, user, source_id)
    full = _lead(user)
    if not full and user.id not in _owner_ids(s):
        raise HTTPException(status_code=403, detail="You are not on this source.")
    d = _review_data(db, s, full, user.id)
    sop_ok = sop_n = 0
    req = _sop_for(s)
    if req["known"] and req["required"]:
        for r in d["records"]:
            sop_n += 1
            sop_ok += 0 if any(x["kind"] == "sop" and "empty" in x["text"] for f in r["fields"] for x in f["signals"]) else 1
    d["sop_rate"] = q.pct(sop_ok, sop_n)
    d["full"] = full
    return d


def _review_data(db: Session, s: Source, full: bool, uid: str) -> dict:
    schema = _schema_fields(db, s)
    req = _sop_for(s)
    sop_on = bool(req["known"] and req["required"])
    recs = _records(db, s.id)
    findings = db.query(QualityFinding).filter(QualityFinding.source_id == s.id).all()
    audits = {(a.record_id, a.field): a for a in db.query(FieldAudit).filter(FieldAudit.source_id == s.id).all()}
    peers = [{"id": p.user_id, "name": (p.user.full_name if p.user else "Peer reviewer"), "comment": ((p.comment or "").strip() if full else "")} for p in s.peer_reviews]
    peer_ids = {p["id"] for p in peers}
    all_comments = [e for r in recs for lst in (r.reviewer_field_comments or {}).values() for e in (lst or []) if isinstance(e, dict)]
    ulookup = _email_ids(db, {e.get("user") for e in all_comments})
    names = _names(db, {f.raised_by for f in findings if f.raised_by})
    by_rf: dict = {}
    for f in findings:
        by_rf.setdefault((f.record_id, f.field), []).append(f)
    out, tot = [], {"fields": 0, "flagged": 0, "audited": 0, "comments": 0, "mentions": 0}
    for i, r in enumerate(recs):
        ef = r.extracted_fields or {}
        order = [k for k in ef if k not in q.SKIP_FIELDS] + [f for f in (req["required"] if sop_on else []) if f not in ef]
        sig: dict = {k: [] for k in order}
        hits = q.check_record(ef, schema)
        for h in hits:
            sig.setdefault(h["field"], []).append({"kind": "system", "severity": h["severity"], "text": h["message"]})
        if sop_on:
            sc = q.sop_check(ef, req["required"], req["allowed"])
            for f in sc["missing"]:
                sig.setdefault(f, []).append({"kind": "sop", "severity": "major", "text": f"{req['sop_code'] or 'The SOP'} requires this field and it is empty."})
            for f in sc["extra"]:
                sig.setdefault(f, []).append({"kind": "sop", "severity": "minor", "text": f"{req['sop_code'] or 'The SOP'} does not list this field."})
        for name in q._flag_fields(r):
            if name in sig:
                sig[name].append({"kind": "ai", "severity": "minor", "text": "Flagged by the automatic AI or website check."})
        general = []
        for field, lst in (r.reviewer_field_comments or {}).items():
            for e in (lst or []):
                if not isinstance(e, dict) or not e.get("comment"):
                    continue
                u = ulookup.get(e.get("user"))
                who = (u.full_name if u else None) or e.get("user") or "Someone"
                item = {"text": e["comment"], "by": who, "by_id": u.id if u else None, "role": e.get("role"), "type": e.get("type"), "ts": e.get("ts")}
                if not full:
                    continue
                if field == "_general":
                    general.append(item)
                    for m in q.mentioned_fields(e["comment"], list(sig.keys())):
                        sig[m].append({"kind": "mention", "severity": "major", "text": e["comment"], "by": who, "by_id": item["by_id"]})
                elif field in sig:
                    sig[field].append({"kind": "comment", "severity": "major", "text": e["comment"], "by": who, "by_id": item["by_id"], "role": e.get("role")})
        for p in peers:
            if p["comment"]:
                for m in q.mentioned_fields(p["comment"], list(sig.keys())):
                    sig[m].append({"kind": "mention", "severity": "major", "text": p["comment"], "by": p["name"], "by_id": p["id"]})
        fields_out = []
        for name in order:
            fl = by_rf.get((r.id, name), [])
            for f in fl:
                if f.status != "dismissed" and (full or f.raised_by == uid):
                    sig[name].append({"kind": "finding", "severity": f.severity, "text": f.note or f.rule or f.category, "by": names.get(f.raised_by) or "System checks", "by_id": f.raised_by, "status": f.status, "finding_id": f.id})
            a = audits.get((r.id, name)) if full else None
            weight = sum(q.SIGNAL_WEIGHT.get(x["kind"], 1) for x in sig[name])
            fields_out.append({"name": name, "value": ef.get(name), "signals": sig[name], "weight": weight,
                               "audit": {"id": a.id, "verdict": a.verdict, "truth_value": a.truth_value, "note": a.note} if a else None})
            tot["fields"] += 1
            tot["flagged"] += 1 if sig[name] else 0
            tot["audited"] += 1 if a else 0
            tot["comments"] += sum(1 for x in sig[name] if x["kind"] == "comment")
            tot["mentions"] += sum(1 for x in sig[name] if x["kind"] == "mention")
        risk = sum(f["weight"] for f in fields_out if not f["audit"])
        out.append({"record_id": r.id, "record": _label(r, i), "fields": fields_out, "general": general, "risk": risk,
                    "todo": sum(1 for f in fields_out if f["signals"] and not f["audit"]), "audited": sum(1 for f in fields_out if f["audit"])})
    if full:
        import json as _json
        tally: dict = {}
        for r in out:
            for f in r["fields"]:
                if f["value"] not in (None, "") and not f["audit"]:
                    tally.setdefault((f["name"], _json.dumps(f["value"], sort_keys=True, default=str)), 0)
                    tally[(f["name"], _json.dumps(f["value"], sort_keys=True, default=str))] += 1
        for r in out:
            for f in r["fields"]:
                n = tally.get((f["name"], _json.dumps(f["value"], sort_keys=True, default=str)), 0) if (f["value"] not in (None, "") and not f["audit"]) else 0
                f["same_count"] = max(0, n - 1)
    out.sort(key=lambda x: (-x["risk"], x["record"].lower()))
    all_names = sorted({f["name"] for r in out for f in r["fields"]})
    total, done = _peer_state(s)
    return {"source_id": s.id, "source": s.name, "project_id": s.project_id, "website": s.website_url, "sop_code": req["sop_code"] if sop_on else None,
            "peers": [{"id": p["id"], "name": p["name"], "comment": p["comment"], "fields": q.mentioned_fields(p["comment"], all_names)} for p in peers], "peer_done": total > 0 and done == total,
            "totals": tot, "records": out}


class MarkBody(BaseModel):
    record_id: str
    field: str
    verdict: str
    truth_value: str | None = None
    note: str | None = None
    category: str = "wrong_value"
    severity: str = "major"
    credit: list[str] = []
    same_value: bool = False


@router.post("/review/mark")
def review_mark(body: MarkBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Settle one field against the real source. Also settles what peers said about it:
    a wrong field confirms their comments (they caught it), a right field dismisses them (they were mistaken)."""
    _need_lead(user)
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == body.record_id).first()
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first() if rec else None
    s = _source(db, user, job.source_id) if job and job.source_id else None
    if not s:
        raise HTTPException(status_code=404, detail="Record not found.")
    if body.verdict not in ("correct", "incorrect"):
        raise HTTPException(status_code=422, detail="Mark the field correct or wrong.")
    schema_names = {f.get("name") for f in _schema_fields(db, s)} | set(_sop_for(s)["required"])
    if body.field not in (rec.extracted_fields or {}) and body.field not in schema_names:
        raise HTTPException(status_code=422, detail="That field is not on this record.")
    if body.category not in q.CATEGORIES or body.severity not in q.SEVERITIES:
        raise HTTPException(status_code=422, detail="Pick a valid kind and severity.")
    truth = (body.truth_value or "").strip() or None
    note = (body.note or "").strip() or None
    wrong = body.verdict == "incorrect"
    if wrong and not truth and not note:
        raise HTTPException(status_code=422, detail="Add what the source really says, or a short note.")
    now = enh.now_utc()
    value = (rec.extracted_fields or {}).get(body.field)
    a = db.query(FieldAudit).filter(FieldAudit.record_id == rec.id, FieldAudit.field == body.field).first()
    if not a:
        a = FieldAudit(source_id=s.id, record_id=rec.id, field=body.field, verdict=body.verdict)
        db.add(a)
    a.verdict, a.truth_value, a.note, a.extracted_value, a.audited_by, a.audited_at = body.verdict, truth, note, value, user.id, now
    # who commented on this field on this record
    ulookup = _email_ids(db, {e.get("user") for e in ((rec.reviewer_field_comments or {}).get(body.field) or []) if isinstance(e, dict)})
    commenters = {u.id: u for u in ulookup.values() if u.id in _owner_ids(s) and u.id != s.assigned_extractor_id}
    credit = set(commenters) | {c for c in body.credit if c in _owner_ids(s)}
    touched = 0
    existing = db.query(QualityFinding).filter(QualityFinding.record_id == rec.id, QualityFinding.field == body.field, QualityFinding.origin == "reviewer").all()
    for f in existing:
        if f.status == "open":
            f.status = "confirmed" if wrong else "dismissed"
            f.truth_value, f.resolved_by, f.resolved_at, f.resolve_note = truth, user.id, now, "Settled in the review workspace."
            touched += 1
    if wrong:
        have = {f.raised_by for f in existing}
        for uid in credit:
            if uid not in have:
                db.add(QualityFinding(source_id=s.id, record_id=rec.id, field=body.field, category=body.category, severity=body.severity, origin="reviewer", raised_by=uid,
                                      note="A peer reviewer pointed at this field.", extracted_value=value, status="confirmed", auto_verdict="supported",
                                      auto_note="Picked up from the reviewer's comment.", truth_value=truth, resolved_by=user.id, resolved_at=now, resolve_note="Confirmed against the source."))
                touched += 1
    else:
        have = {f.raised_by for f in existing}
        for uid in commenters:
            if uid not in have:
                db.add(QualityFinding(source_id=s.id, record_id=rec.id, field=body.field, category="other", severity="minor", origin="reviewer", raised_by=uid,
                                      note="A peer reviewer commented on this field.", extracted_value=value, status="dismissed", auto_verdict="needs_human",
                                      auto_note="Picked up from the reviewer's comment.", resolved_by=user.id, resolved_at=now, resolve_note="The source supports the value."))
                touched += 1
    also = 0
    if body.same_value and value not in (None, ""):
        for r in _records(db, s.id):
            if r.id == rec.id or (r.extracted_fields or {}).get(body.field) != value:
                continue
            if db.query(FieldAudit.id).filter(FieldAudit.record_id == r.id, FieldAudit.field == body.field).first():
                continue
            db.add(FieldAudit(source_id=s.id, record_id=r.id, field=body.field, verdict=body.verdict, extracted_value=value, truth_value=truth, note=note, audited_by=user.id, audited_at=now))
            also += 1
    db.commit()
    return {"id": a.id, "verdict": a.verdict, "findings_settled": touched, "also_marked": also}
