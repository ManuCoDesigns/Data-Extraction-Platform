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
    ExtractedRecord, ExtractionJob, FieldAudit, Project, QualityFinding, SchemaVersion, Source, SourceStatus, User,
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
    for r in recs:
        for h in q.check_record(r.extracted_fields or {}, fields):
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
    return {"created": created, "records": len(recs)}


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
