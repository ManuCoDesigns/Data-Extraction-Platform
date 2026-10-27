"""Quality: log errors on records, let the system confirm what it can, check fields against the real source,
and score the process from those checks."""
import random
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
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


_MISSING = object()


def _pcts(compared: int, wrong: int) -> dict:
    return {"error_pct": round(100 * wrong / compared, 1) if compared else None, "accuracy_pct": round(100 - 100 * wrong / compared, 1) if compared else None}


def _same(a, b) -> bool:
    """Do two field values say the same thing? Spaces at the ends and empty versus missing do not count as a change."""
    def n(v):
        if v is None:
            return ""
        if isinstance(v, str):
            return v.strip()
        import json as _j
        return _j.dumps(v, sort_keys=True, default=str)
    return n(a) == n(b)


def _earlier_value(rec: ExtractedRecord, s: Source, uid: str | None, field: str):
    """What this person saw for the field: the record when they submitted their review, otherwise when it was last sent back."""
    if uid:
        row = next((p for p in s.peer_reviews if p.user_id == uid and p.snapshot), None)
        snap = (row.snapshot or {}).get(rec.id) if row else None
        if isinstance(snap, dict) and field in snap:
            return snap[field]
    back = rec.fields_at_return
    if isinstance(back, dict) and field in back:
        return back[field]
    return _MISSING


def _short(v, n: int = 60) -> str:
    t = "empty" if v in (None, "") else (v if isinstance(v, str) else str(v))
    t = t.strip().replace("\n", " ")
    return '"%s"' % (t if len(t) <= n else t[:n] + "…") if t != "empty" else "empty"


def _changed_since(rec: ExtractedRecord) -> list[str]:
    """Fields the extractor changed since the record was last sent back."""
    back = rec.fields_at_return
    if not isinstance(back, dict):
        return []
    now = rec.extracted_fields or {}
    keys = {k for k in set(back) | set(now) if not str(k).startswith("_")}
    return sorted(k for k in keys if not _same(back.get(k), now.get(k)))


def _record_source_id(db: Session, rec: ExtractedRecord) -> str:
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first()
    if not job or not job.source_id:
        raise HTTPException(status_code=404, detail="Record not found.")
    return job.source_id


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
    """The SOP as this source must follow it: the strict reader's enforced fields (required ones, allowed values), joined
    with Xtrium's structured list. Rules under another category's heading are not held against this source."""
    from app.api.v1.routes.integrations import _sop_requirements
    from app.services import sop_requirements as sr
    sr.follow_category(s)
    base = _sop_requirements(s)
    try:
        b = sr.build(s)
    except Exception:
        return {**base, "specs": {}, "entity": None, "category": getattr(s, "category", None), "warnings": []}
    specs = sr.field_specs(b)
    # base["required"] is Xtrium's flat list; the reader drops names that only exist inside a list such as facilities[] or products[]
    kept = set(b.get("required_fields") or [])
    required = list(dict.fromkeys([f for f in base["required"] if f in kept or not b.get("has_sop")] + [n for n, sp in specs.items() if sp.get("required")]))
    keys = set(b.get("template_keys") or []) | set(specs) | set(required)
    return {"known": base["known"], "sop_code": base["sop_code"] or b.get("sop_code"), "required": required, "specs": specs, "blocks": sr.block_specs(b),
            "allowed": keys if (b.get("template_keys") or len(specs) >= 3) else base["allowed"], "entity": b.get("entity"), "category": getattr(s, "category", None),
            "warnings": b.get("warnings") or [], "spec_version": b.get("spec_version"), "stale": b.get("stale"), "no_contract": b.get("no_contract")}


@router.get("/sources/{source_id}/sop-check")
def sop_check_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every record in the source checked against the SOP saved for it: is each required field filled in?"""
    _need_lead(user)
    s = _source(db, user, source_id)
    req = _sop_for(s)
    base = {"source_id": s.id, "source": s.name, "known": bool(req["known"] and req["required"]), "sop_code": req["sop_code"], "required": req["required"],
            "entity": req.get("entity"), "category": req.get("category"), "spec_version": req.get("spec_version"), "warnings": req.get("warnings") or []}
    if not base["known"]:
        return {**base, "records": 0, "compliant": 0, "rate": None, "by_field": [], "extra_fields": [], "failing": [], "failing_total": 0}
    recs = [(r.id, _label(r, i), r.extracted_fields or {}) for i, r in enumerate(_records(db, s.id))]
    return {**base, **q.sop_report(recs, req["required"], req["allowed"], req.get("specs"), req.get("blocks"))}


@router.get("/sop-overview")
def sop_overview(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One line per source: how many records follow the SOP's required fields."""
    _need_lead(user)
    out = []
    for s in _visible_sources(db, user, project_id).filter(Source.status != SourceStatus.NOT_STARTED).all():
        req = _sop_for(s)
        row = {"source_id": s.id, "name": s.name, "sop_code": req["sop_code"], "entity": req.get("entity"), "category": req.get("category"), "required_count": len(req["required"]),
               "warnings": len(req.get("warnings") or []), "stale": bool(req.get("stale")), "no_contract": bool(req.get("no_contract")), "known": bool(req["known"] and req["required"]), "records": 0, "compliant": 0, "rate": None}
        if row["known"]:
            recs = [(r.id, "", r.extracted_fields or {}) for r in _records(db, s.id)]
            rep = q.sop_report(recs, req["required"], req["allowed"], req.get("specs"), req.get("blocks"))
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
    produced: set = set()
    req = _sop_for(s)
    sop_on = bool(req["known"] and req["required"])
    for r in recs:
        hits = q.check_record(r.extracted_fields or {}, fields)
        if sop_on:
            sc = q.sop_check(r.extracted_fields or {}, req["required"], req["allowed"], req.get("specs"), req.get("blocks"))
            already = {h["field"] for h in hits if h["category"] == "missing_value"}
            code = req["sop_code"] or "the SOP"
            hits += [{"field": f, "category": "sop_rule", "rule": "sop_required", "severity": "major", "message": f"{code} requires this field and it is empty."} for f in sc["missing"] if f not in already]
            hits += [{"field": f, "category": "sop_rule", "rule": "sop_extra", "severity": "minor", "message": f"{code} does not list this field."} for f in sc["extra"]]
            hits += [{"field": x["field"], "category": "sop_rule", "rule": "sop_allowed_values", "severity": "major", "message": (f"{code} allows only: {', '.join(x['allowed'])}. This record has: {x['value']}." if x["allowed"] else f"{code}: {x['value']} is {x.get('reason')}.")} for x in sc["bad"] if not x.get("case_only")]
        for h in hits:
            key = (r.id, h["field"], h["rule"])
            produced.add(key)
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
    # A SOP check that the current SOP no longer makes (for example a field that turned out to be required only inside a list) is
    # withdrawn, so it stops counting against the extractor. Findings a person decided on are left alone.
    withdrawn = 0
    if sop_on:
        live = {r.id for r in recs}
        for f in db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.origin == "system", QualityFinding.status == "open",
                                                 QualityFinding.rule.in_(["sop_required", "sop_extra", "sop_allowed_values"])).all():
            if f.record_id in live and (f.record_id, f.field, f.rule) not in produced:
                f.status = "dismissed"
                f.auto_verdict = "not_reproduced"
                f.auto_note = "The current SOP no longer asks for this, so the check was withdrawn."
                withdrawn += 1
    db.commit()
    return {"created": created, "withdrawn": withdrawn, "records": len(recs), "sop_checked": sop_on}


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
        _v = rec.extracted_fields.get(body.field)
        a = FieldAudit(source_id=s.id, record_id=rec.id, field=body.field, verdict=body.verdict, first_verdict=body.verdict, first_value=_v, first_at=enh.now_utc(), times_checked=1)
        db.add(a)
    else:
        if not a.first_verdict:
            a.first_verdict, a.first_value, a.first_at = a.verdict, a.extracted_value, a.audited_at
        a.times_checked = (a.times_checked or 1) + 1
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
def quality_summary(project_id: str | None = None, source_id: str | None = None, days: int = Query(90, ge=0, le=3650),
                    date_from: str | None = None, date_to: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if source_id:
        srcs = [s for s in srcs if s.id == source_id]
    ids = [s.id for s in srcs]
    empty = q.compute_summary([], [], {}, {}, {})
    if not ids:
        return {**empty, "days": days}
    # Pick the window: exact dates (Nairobi days) win over "last N days"; 0 days with no dates means all time.
    lo, hi = _day_start(date_from), _day_start(date_to, plus=1)
    if days and not (date_from or date_to):
        lo = enh.now_utc() - timedelta(days=days)

    def _ok(dt):
        if not (lo or hi):
            return True
        if dt is None:
            return False
        t = enh_aware(dt)
        return (not lo or t >= lo) and (not hi or t < hi)
    # A check counts on the day it was first made, so a re-check later does not move it out of the period it belongs to.
    findings = [f for f in db.query(QualityFinding).filter(QualityFinding.source_id.in_(ids)).all() if _ok(f.created_at)]
    audits = [a for a in db.query(FieldAudit).filter(FieldAudit.source_id.in_(ids)).all() if _ok(a.first_at or a.audited_at)]
    recs: dict = {}
    for r, sid in (db.query(ExtractedRecord, ExtractionJob.source_id).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
                   .filter(ExtractionJob.source_id.in_(ids)).all()):
        recs.setdefault(sid, []).append(r)
    ext_of = {s.id: s.assigned_extractor_id for s in srcs}
    peers_of = {s.id: [p.user_id for p in s.peer_reviews] for s in srcs}
    uids = {f.raised_by for f in findings} | set(v for v in ext_of.values() if v) | {u for us in peers_of.values() for u in us}
    out = q.compute_summary(findings, audits, recs, ext_of, _names(db, uids), {s.id: s.name for s in srcs}, peers_of)
    out["days"] = days
    out["date_from"] = date_from
    out["date_to"] = date_to
    out["sources"] = len(ids)
    return out


def _day_start(day: str | None, plus: int = 0):
    """Midnight at the start of a YYYY-MM-DD day in Nairobi time (UTC+3), as UTC. plus=1 gives the end of that day."""
    if not day:
        return None
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates look like 2026-10-14")
    return (d + timedelta(days=plus)).replace(tzinfo=timezone(timedelta(hours=3))).astimezone(timezone.utc)


def _extractor_data(db: Session, user: User, project_id, source_id, user_id, days: int, date_from: str | None = None, date_to: str | None = None):
    srcs = _visible_sources(db, user, project_id).all()
    if source_id:
        srcs = [x for x in srcs if x.id == source_id]
    if user_id:
        srcs = [x for x in srcs if x.assigned_extractor_id == user_id]
    ids = [x.id for x in srcs]
    if not ids:
        return {"extractors": []}, [], srcs, {}
    findings = db.query(QualityFinding).filter(QualityFinding.source_id.in_(ids)).all()
    audits = db.query(FieldAudit).filter(FieldAudit.source_id.in_(ids)).all()
    # A check counts on the day it was first made, so a field you checked on the 14th still shows for the 14th after a later re-check.
    lo, hi = _day_start(date_from), _day_start(date_to, plus=1)
    if days and not lo:
        lo = enh.now_utc() - timedelta(days=days)
    if lo or hi:
        def _ok(dt):
            if dt is None:
                return False
            t = enh_aware(dt)
            return (not lo or t >= lo) and (not hi or t < hi)
        findings = [f for f in findings if _ok(f.created_at)]
        audits = [a for a in audits if _ok(a.first_at or a.audited_at)]
    recs: dict = {}
    for r, sid in (db.query(ExtractedRecord, ExtractionJob.source_id).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id).filter(ExtractionJob.source_id.in_(ids)).all()):
        recs.setdefault(sid, []).append(r)
    ext_of = {x.id: x.assigned_extractor_id for x in srcs}
    names = _names(db, {f.raised_by for f in findings if f.raised_by} | {v for v in ext_of.values() if v})
    report = q.extractor_report(findings, audits, recs, ext_of, names, {x.id: x.name for x in srcs})
    return report, (findings, audits, recs, ext_of, names), srcs, {x.id: x for x in srcs}


def _scorecard_data(db: Session, user: User, project_id, source_id, date_from, date_to, days: int = 0):
    """The same data every score uses: findings, ground-truth checks and records for the sources the person can see.
    No dates means everything ever recorded (the cumulative view)."""
    srcs = _visible_sources(db, user, project_id).filter(Source.status != SourceStatus.NOT_STARTED).all()
    if source_id:
        srcs = [x for x in srcs if x.id == source_id]
    ids = [x.id for x in srcs]
    if not ids:
        return {"batches": [], "pulls": [], "cumulative": q._finish({**{k: 0 for k in q._ZERO}, "sources": 0}), "extractors": [], "reviewers": []}, srcs
    findings = db.query(QualityFinding).filter(QualityFinding.source_id.in_(ids)).all()
    audits = db.query(FieldAudit).filter(FieldAudit.source_id.in_(ids)).all()
    lo, hi = _day_start(date_from), _day_start(date_to, plus=1)
    if days and not lo:
        lo = enh.now_utc() - timedelta(days=days)
    if lo or hi:
        def _ok(dt):
            if dt is None:
                return False
            t = enh_aware(dt)
            return (not lo or t >= lo) and (not hi or t < hi)
        findings = [f for f in findings if _ok(f.created_at)]
        audits = [a for a in audits if _ok(a.first_at or a.audited_at)]
    recs: dict = {}
    for r, sid in (db.query(ExtractedRecord, ExtractionJob.source_id).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id).filter(ExtractionJob.source_id.in_(ids)).all()):
        recs.setdefault(sid, []).append(r)
    ext_of = {x.id: x.assigned_extractor_id for x in srcs}
    peers_of = {x.id: [p.user_id for p in x.peer_reviews] for x in srcs}
    names = _names(db, {f.raised_by for f in findings if f.raised_by} | {v for v in ext_of.values() if v} | {u for us in peers_of.values() for u in us})
    sc = q.scorecard(findings, audits, recs, ext_of, names, {x.id: x.name for x in srcs}, peers_of, q.pull_batches(srcs))
    status = {x.id: getattr(x.status, "value", x.status) for x in srcs}
    for b in sc["batches"]:
        b["status"] = status.get(b["source_id"])
    return sc, srcs


@router.get("/process-report")
def process_report(project_id: str | None = None, source_id: str | None = None, date_from: str | None = None, date_to: str | None = None,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The whole process, every score from the same numbers: one row per source (batch), then the cumulative total across all sources,
    then each extractor and each peer reviewer. No dates means everything ever recorded."""
    _need_lead(user)
    sc, _ = _scorecard_data(db, user, project_id, source_id, date_from, date_to)
    return {"cumulative": sc["cumulative"], "pulls": sc.get("pulls", []), "batches": sc["batches"], "extractors": [{k: v for k, v in x.items() if k != "sources"} for x in sc["extractors"]],
            "reviewers": sc["reviewers"], "date_from": date_from, "date_to": date_to}


@router.get("/process-report/export")
def process_report_export(project_id: str | None = None, source_id: str | None = None, date_from: str | None = None, date_to: str | None = None,
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi.responses import Response
    from app.services import quality_export as qx
    _need_lead(user)
    sc, _ = _scorecard_data(db, user, project_id, source_id, date_from, date_to)
    if not sc["batches"]:
        raise HTTPException(status_code=404, detail="Nothing to report yet.")
    data = qx.process_workbook(sc, {"date_from": date_from, "date_to": date_to, "generated": enh.now_utc()})
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="process-report.xlsx"'})


@router.get("/extractor-report")
def extractor_report(project_id: str | None = None, source_id: str | None = None, user_id: str | None = None, days: int = Query(0, ge=0, le=3650),
                     date_from: str | None = None, date_to: str | None = None,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Accuracy and error rate per extractor, counting everything ever found. Errors the extractor fixed after a return stay in."""
    _need_lead(user)
    report, _, _, _ = _extractor_data(db, user, project_id, source_id, user_id, days, date_from, date_to)
    return {**report, "days": days, "date_from": date_from, "date_to": date_to}


@router.get("/extractor-report/export")
def extractor_report_export(project_id: str | None = None, source_id: str | None = None, user_id: str | None = None, days: int = Query(0, ge=0, le=3650), date_from: str | None = None, date_to: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi.responses import Response
    from app.services import quality_export as qx
    _need_lead(user)
    report, pack, srcs, by_id = _extractor_data(db, user, project_id, source_id, user_id, days, date_from, date_to)
    if not report["extractors"]:
        raise HTTPException(status_code=404, detail="Nothing to report yet.")
    findings, audits, recs, ext_of, names = pack
    labels = {r.id: _label(r, i) for rs in recs.values() for i, r in enumerate(rs)}
    rec_by = {r.id: r for rs in recs.values() for r in rs}
    uname = _names(db, {x for x in ext_of.values() if x})
    rows: dict = {}
    for f in findings:
        if f.status == "confirmed" and f.field and f.record_id in rec_by:
            r = rows.setdefault((f.record_id, f.field), {"extractor": uname.get(ext_of.get(f.source_id), ""), "source": by_id[f.source_id].name, "record": labels.get(f.record_id, ""), "field": f.field,
                                                         "was": f.extracted_value, "now": (rec_by[f.record_id].extracted_fields or {}).get(f.field), "truth": f.truth_value, "found_by": "", "caught_by": "",
                                                         "status": "Fixed before final review" if f.fixed_before_final else "Confirmed", "kind": q.CATEGORIES.get(f.category, f.category), "severity": f.severity, "note": f.note})
            r["found_by"] = (r["found_by"] + ", " if r["found_by"] else "") + ("System checks" if f.origin == "system" else (names.get(f.raised_by) or "Reviewer"))
            if f.origin == "reviewer":
                r["caught_by"] = (r["caught_by"] + ", " if r["caught_by"] else "") + (names.get(f.raised_by) or "Reviewer")
    for a in audits:
        r0 = rec_by.get(a.record_id)
        if not r0:
            continue
        first = a.first_verdict or a.verdict
        now = (r0.extracted_fields or {}).get(a.field)
        stale = not _same(a.extracted_value, now)
        if first == "incorrect" or (a.verdict == "incorrect" and not stale):
            r = rows.setdefault((a.record_id, a.field), {"extractor": uname.get(ext_of.get(a.source_id), ""), "source": by_id[a.source_id].name, "record": labels.get(a.record_id, ""), "field": a.field,
                                                         "was": a.first_value if a.first_verdict else a.extracted_value, "now": now, "truth": a.truth_value, "found_by": "Admin check", "caught_by": "",
                                                         "status": "", "kind": "", "severity": "", "note": a.note})
            if "Admin check" not in r["found_by"]:
                r["found_by"] = (r["found_by"] + ", " if r["found_by"] else "") + "Admin check"
            r["truth"] = r["truth"] or a.truth_value
            r["status"] = "Waiting for a re-check" if stale else ("Still wrong" if a.verdict == "incorrect" else "Fixed after it was found")
    rows_out = sorted(rows.values(), key=lambda x: (x["extractor"], x["source"], x["record"], x["field"]))
    stamp = enh.now_utc().strftime("%Y%m%d")
    body = qx.extractor_xlsx(report, rows_out, {"period": "all time" if not days else f"last {days} days", "generated": stamp})
    return Response(content=body, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="extractor_report_{stamp}.xlsx"'})


@router.get("/sources/{source_id}/feedback")
def source_feedback(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything reviewers and admins said about this source, kept for good. Each item says whether the field has been
    changed since, and whether an admin has checked it again. Extractors use it to work through the feedback, admins to recheck."""
    s = _source(db, user, source_id)
    lead = _lead(user)
    is_ext = user.id == s.assigned_extractor_id
    if not (lead or is_ext or user.id in _owner_ids(s)):
        raise HTTPException(status_code=403, detail="You are not on this source.")
    recs = _records(db, s.id)
    labels = {r.id: _label(r, i) for i, r in enumerate(recs)}
    findings = db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.origin == "reviewer").all()
    audits = {(a.record_id, a.field): a for a in db.query(FieldAudit).filter(FieldAudit.source_id == s.id).all()}
    emails = {e.get("user") for r in recs for lst in (r.reviewer_field_comments or {}).values() for e in (lst or []) if isinstance(e, dict)}
    ulookup = _email_ids(db, emails)
    names = _names(db, {f.raised_by for f in findings if f.raised_by})
    out, counts = [], {"waiting": 0, "changed": 0, "checked": 0}

    def state(field, was, now, rec, kind):
        a = audits.get((rec.id, field)) if field and field != "_general" else None
        live = bool(a and _same(a.extracted_value, now))
        if live and a.verdict == "correct":
            return "checked_ok"
        if live and a.verdict == "incorrect":
            return "still_wrong"
        if was is _MISSING:
            return "unknown"
        return "changed" if not _same(was, now) else "waiting"

    for rec in recs:
        ef = rec.extracted_fields or {}
        items = []
        for field, lst in (rec.reviewer_field_comments or {}).items():
            for e in (lst or []):
                if not isinstance(e, dict) or not e.get("comment"):
                    continue
                role = e.get("role") or "reviewer"
                u = ulookup.get(e.get("user"))
                who = (u.full_name if u else None) or e.get("user") or "Someone"
                mine = bool(u and u.id == user.id)
                if not (lead or is_ext or mine or role == "admin"):
                    continue
                kind = e.get("type") or ("note" if role == "admin" else "comment")
                if field == "_general":
                    st = "info"
                    was = _MISSING
                else:
                    was = e["value_at"] if "value_at" in e else (rec.fields_at_return.get(field, _MISSING) if isinstance(rec.fields_at_return, dict) and kind in ("correction", "rejection") else _MISSING)
                    st = state(field, was, ef.get(field), rec, kind)
                items.append({"kind": kind, "field": field if field != "_general" else None, "by": who, "role": role, "text": e["comment"], "ts": e.get("ts"), "sop_rule": e.get("sop_rule"),
                              "was": None if was is _MISSING else was, "now": ef.get(field) if field != "_general" else None, "state": st})
        for f in findings:
            if f.record_id != rec.id or not (lead or is_ext or f.raised_by == user.id):
                continue
            now = ef.get(f.field) if f.field else None
            st = "dismissed" if f.status == "dismissed" else ("checked_ok" if f.fixed_before_final else state(f.field, f.extracted_value, now, rec, "flag") if f.field else "info")
            if f.status == "confirmed" and f.field and st in ("waiting", "changed", "unknown"):
                st = "confirmed"
            items.append({"kind": "flag", "field": f.field, "by": names.get(f.raised_by) or "Reviewer", "role": "reviewer", "text": f.note or q.CATEGORIES.get(f.category, f.category), "ts": f.created_at.isoformat() if f.created_at else None,
                          "severity": f.severity, "was": f.extracted_value, "now": now, "state": st, "status": f.status, "finding_id": f.id})
        if not items:
            continue
        items.sort(key=lambda x: x.get("ts") or "")
        for it in items:
            if it["state"] in ("waiting", "confirmed", "still_wrong"):
                counts["waiting"] += 1
            elif it["state"] == "changed":
                counts["changed"] += 1
            elif it["state"] == "checked_ok":
                counts["checked"] += 1
        out.append({"record_id": rec.id, "record": labels[rec.id], "review_status": getattr(rec.review_status, "value", rec.review_status), "returned": rec.correction_count or 0,
                    "returned_at": rec.last_returned_at.isoformat() if rec.last_returned_at else None, "changed_since_return": _changed_since(rec), "items": items})
    return {"source_id": s.id, "records": out, "counts": counts}


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
        hits = q.check_record(ef, schema)
        order = [k for k in ef if k not in q.SKIP_FIELDS]
        # A field the extractor left out still gets a row, so it can be seen, commented on and marked.
        for extra in [f for f in (req["required"] if sop_on else [])] + [x.get("name") for x in schema] + [h["field"] for h in hits]:
            if extra and extra not in order and extra not in q.SKIP_FIELDS and not str(extra).startswith("_"):
                order.append(extra)
        sig: dict = {k: [] for k in order}
        for h in hits:
            sig.setdefault(h["field"], []).append({"kind": "system", "severity": h["severity"], "text": h["message"]})
        if sop_on:
            sc = q.sop_check(ef, req["required"], req["allowed"], req.get("specs"), req.get("blocks"))
            for x in [y for y in sc["bad"] if not y.get("case_only")]:
                sig.setdefault(x["field"], []).append({"kind": "sop", "severity": "major", "text": f"{req['sop_code'] or 'The SOP'} " + (f"allows only: {', '.join(x['allowed'])}." if x["allowed"] else f"says this value is {x.get('reason')}.")})
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
                if e.get("role") == "admin":
                    item["sop_rule"] = e.get("sop_rule")
                    if field == "_general":
                        general.append(item)
                    elif field in sig:
                        sig[field].append({"kind": "note", "severity": "minor", "text": e["comment"], "by": who, "by_id": item["by_id"], "role": "admin",
                                           "type": e.get("type"), "sop_rule": e.get("sop_rule"), "ts": e.get("ts"), "mine": bool(u and u.id == uid)})
                    continue
                if field == "_general":
                    general.append(item)
                    for m in q.mentioned_fields(e["comment"], list(sig.keys()), ef):
                        sig[m].append({"kind": "mention", "severity": "major", "text": e["comment"], "by": who, "by_id": item["by_id"]})
                elif field in sig:
                    sig[field].append({"kind": "comment", "severity": "major", "text": e["comment"], "by": who, "by_id": item["by_id"], "role": e.get("role")})
        for p in peers:
            if p["comment"]:
                for m in q.mentioned_fields(p["comment"], list(sig.keys()), ef):
                    sig[m].append({"kind": "mention", "severity": "major", "text": p["comment"], "by": p["name"], "by_id": p["id"]})
        fields_out = []
        for name in order:
            fl = by_rf.get((r.id, name), [])
            for f in fl:
                if f.status != "dismissed" and (full or f.raised_by == uid):
                    sig[name].append({"kind": "finding", "severity": f.severity, "text": f.note or f.rule or f.category, "by": names.get(f.raised_by) or "System checks", "by_id": f.raised_by, "status": f.status, "finding_id": f.id,
                                      "was": f.extracted_value, "fixed": bool(f.fixed_before_final)})
                # A reviewer flagged an earlier value and the extractor has changed it since: look again, and credit the catch.
                if f.origin == "reviewer" and f.status == "open" and (full or f.raised_by == uid) and f.extracted_value is not None and not _same(f.extracted_value, ef.get(name)):
                    sig[name].append({"kind": "recheck", "severity": "major", "by": names.get(f.raised_by) or "A reviewer", "by_id": f.raised_by, "was": f.extracted_value, "now": ef.get(name),
                                      "text": "Flagged earlier (it said %s). The extractor has changed it since." % _short(f.extracted_value)})
            if full:
                for e in ((r.reviewer_field_comments or {}).get(name) or []):
                    if isinstance(e, dict) and e.get("type") in ("correction", "rejection") and "value_at" in e and not _same(e["value_at"], ef.get(name)) \
                            and not any(x["kind"] == "recheck" for x in sig[name]):
                        sig[name].append({"kind": "recheck", "severity": "major", "by": e.get("user"), "was": e.get("value_at"), "now": ef.get(name),
                                          "text": "You asked for a fix (it said %s). The extractor has changed it since." % _short(e.get("value_at"))})
            a = audits.get((r.id, name)) if full else None
            stale = bool(a and not _same(a.extracted_value, ef.get(name)))
            prior = None
            if stale:
                prior = {"verdict": a.verdict, "truth_value": a.truth_value, "value": a.extracted_value, "at": a.audited_at.isoformat() if a.audited_at else None}
                sig[name].append({"kind": "recheck", "severity": "major", "by": "You", "was": a.extracted_value, "now": ef.get(name),
                                  "text": "You marked it %s when it said %s. It has changed since, so check it again." % ("wrong" if a.verdict == "incorrect" else "correct", _short(a.extracted_value))})
                a = None
            weight = sum(q.SIGNAL_WEIGHT.get(x["kind"], 1) for x in sig[name])
            fields_out.append({"name": name, "value": ef.get(name), "signals": sig[name], "weight": weight, "prior": prior,
                               "audit": {"id": a.id, "verdict": a.verdict, "truth_value": a.truth_value, "note": a.note, "first_verdict": a.first_verdict, "times_checked": a.times_checked} if a else None})
            tot["fields"] += 1
            tot["flagged"] += 1 if sig[name] else 0
            tot["audited"] += 1 if a else 0
            tot["comments"] += sum(1 for x in sig[name] if x["kind"] == "comment")
            tot["mentions"] += sum(1 for x in sig[name] if x["kind"] == "mention")
        risk = sum(f["weight"] for f in fields_out if not f["audit"])
        out.append({"record_id": r.id, "record": _label(r, i), "fields": fields_out, "general": general, "risk": risk, "raw": (r.raw_text or "")[:20000],
                    "todo": sum(1 for f in fields_out if f["signals"] and not f["audit"]), "audited": sum(1 for f in fields_out if f["audit"]),
                    "review_status": getattr(r.review_status, "value", r.review_status), "admin_note": r.admin_review_note, "corrections": r.correction_count or 0,
                    "returned_at": r.last_returned_at.isoformat() if r.last_returned_at else None, "changed_since_return": _changed_since(r)})
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
    tot["system_findings"] = sum(1 for f in findings if f.origin == "system")
    tot["open_findings"] = sum(1 for f in findings if f.status == "open")
    tot["sop_rate"] = q.pct(sum(1 for r in out if not any(x["kind"] == "sop" and "empty" in x["text"] for f in r["fields"] for x in f["signals"])), len(out)) if sop_on else None
    return {"source_id": s.id, "source": s.name, "project_id": s.project_id, "website": s.website_url, "sop_code": req["sop_code"] if sop_on else None,
            "sop_required": req["required"] if sop_on else [], "peers": [{"id": p["id"], "name": p["name"], "comment": p["comment"], "fields": sorted({m for x in recs for m in q.mentioned_fields(p["comment"], all_names, x.extracted_fields or {})}),
                       "why": _peer_why(p["comment"], all_names, recs),
                       "unknown": sorted({m for m in re.findall(r"`([A-Za-z][A-Za-z0-9_]{2,40})`", p["comment"] or "") if m not in all_names and "_" in m})} for p in peers], "peer_done": total > 0 and done == total,
            "totals": tot, "records": out,
            "status": getattr(s.status, "value", s.status), "approved_records": sum(1 for r in out if r["review_status"] == "approved"), "total_records": len(out),
            "edit_lock": __import__("app.services.record_locks", fromlist=["x"]).source_lock_reason(s)}  # edit_lock


def _peer_why(comment: str, names: list, recs: list) -> dict:
    """For each field a peer note points at: the sentence that did it and the reason, so a wrong credit can be spotted."""
    from app.services import peer_notes
    out: dict = {}
    for x in recs:
        for f, w in peer_notes.explain(comment or "", x.extracted_fields or {}, list(names)).items():
            if f not in out or w["score"] > out[f]["score"]:
                out[f] = w
    return out


class CommentBody(BaseModel):
    record_id: str
    field: str = "_general"
    comment: str
    sop_rule: str | None = None
    kind: str = "note"


@router.post("/review/comment")
def review_comment(body: CommentBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """An admin note on one field (or on the whole record). The extractor and peers see it on the source page."""
    _need_lead(user)
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == body.record_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found.")
    s = _source(db, user, _record_source_id(db, rec))
    text = (body.comment or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write the comment first.")
    if len(text) > 2000:
        raise HTTPException(status_code=422, detail="Keep the comment under 2000 characters.")
    field = body.field or "_general"
    if field != "_general" and field not in (rec.extracted_fields or {}) and field not in (_sop_for(s)["required"] or []):
        raise HTTPException(status_code=422, detail="That field is not on this record.")
    kind = body.kind if body.kind in ("note", "sop", "correction") else "note"
    now = datetime.now(timezone.utc)
    fc = {k: list(v or []) for k, v in (rec.reviewer_field_comments or {}).items()}
    fc.setdefault(field, []).append({"comment": text, "user": user.email, "role": "admin", "type": kind,
                                     "sop_rule": (body.sop_rule or "").strip()[:120] or None, "ts": now.isoformat()})
    rec.reviewer_field_comments = fc
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(rec, "reviewer_field_comments")
    db.commit()
    return {"ok": True, "ts": now.isoformat()}


@router.delete("/review/comment")
def review_comment_delete(record_id: str, field: str, ts: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == record_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found.")
    _source(db, user, _record_source_id(db, rec))
    fc = {k: list(v or []) for k, v in (rec.reviewer_field_comments or {}).items()}
    keep = [e for e in fc.get(field, []) if not (isinstance(e, dict) and e.get("ts") == ts and e.get("user") == user.email and e.get("role") == "admin")]
    if len(keep) == len(fc.get(field, [])):
        raise HTTPException(status_code=404, detail="Only your own comment can be removed.")
    fc[field] = keep
    rec.reviewer_field_comments = fc
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(rec, "reviewer_field_comments")
    db.commit()
    return {"ok": True}


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
    original_ok: bool = False   # the reviewer flagged an earlier value that was actually fine


def _commit_or_retry(db: Session, redo):
    """Two admins can mark the same field at the same moment. The loser of the race updates the row instead of failing."""
    from sqlalchemy.exc import IntegrityError
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        redo()
        db.commit()


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
        a = FieldAudit(source_id=s.id, record_id=rec.id, field=body.field, verdict=body.verdict, first_verdict=body.verdict, first_value=value, first_at=now, times_checked=1)
        db.add(a)
    else:
        if not a.first_verdict:
            a.first_verdict, a.first_value, a.first_at = a.verdict, a.extracted_value, a.audited_at
        a.times_checked = (a.times_checked or 1) + 1
    a.verdict, a.truth_value, a.note, a.extracted_value, a.audited_by, a.audited_at = body.verdict, truth, note, value, user.id, now
    try:
        db.flush()
    except Exception:
        db.rollback()
        a = db.query(FieldAudit).filter(FieldAudit.record_id == rec.id, FieldAudit.field == body.field).first()
        if not a:
            raise
        a.verdict, a.truth_value, a.note, a.extracted_value, a.audited_by, a.audited_at = body.verdict, truth, note, value, user.id, now
    # who commented on this field on this record
    ulookup = _email_ids(db, {e.get("user") for e in ((rec.reviewer_field_comments or {}).get(body.field) or []) if isinstance(e, dict) and e.get("role") != "admin"})
    commenters = {u.id: u for u in ulookup.values() if u.id in _owner_ids(s) and u.id != s.assigned_extractor_id}
    credit = set(commenters) | {c for c in body.credit if c in _owner_ids(s)}
    touched = 0
    existing = db.query(QualityFinding).filter(QualityFinding.record_id == rec.id, QualityFinding.field == body.field, QualityFinding.origin == "reviewer").all()
    fixed_credit = 0
    for f in existing:
        if f.status == "open":
            # The reviewer flagged an earlier value and the extractor has changed it since. The flag was a real catch.
            fixed = (not wrong) and not body.original_ok and f.extracted_value is not None and not _same(f.extracted_value, value)
            f.status = "confirmed" if (wrong or fixed) else "dismissed"
            f.fixed_before_final = bool(fixed)
            f.truth_value, f.resolved_by, f.resolved_at = truth, user.id, now
            f.resolve_note = "The reviewer was right. The extractor fixed it before the final review." if fixed else "Settled in the review workspace."
            touched += 1
            fixed_credit += 1 if fixed else 0
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
                earlier = _earlier_value(rec, s, uid, body.field)
                fixed = (not body.original_ok) and earlier is not _MISSING and not _same(earlier, value)
                db.add(QualityFinding(source_id=s.id, record_id=rec.id, field=body.field, category="wrong_value" if fixed else "other", severity="major" if fixed else "minor", origin="reviewer", raised_by=uid,
                                      note="A peer reviewer commented on this field.", extracted_value=earlier if fixed else value, status="confirmed" if fixed else "dismissed",
                                      auto_verdict="supported" if fixed else "needs_human", auto_note="Picked up from the reviewer's comment.", fixed_before_final=bool(fixed),
                                      truth_value=truth if fixed else None, resolved_by=user.id, resolved_at=now,
                                      resolve_note="The reviewer was right. The extractor fixed it before the final review." if fixed else "The source supports the value."))
                touched += 1
                fixed_credit += 1 if fixed else 0
    also = 0
    if body.same_value and value not in (None, ""):
        for r in _records(db, s.id):
            if r.id == rec.id or (r.extracted_fields or {}).get(body.field) != value:
                continue
            if db.query(FieldAudit.id).filter(FieldAudit.record_id == r.id, FieldAudit.field == body.field).first():
                continue
            db.add(FieldAudit(source_id=s.id, record_id=r.id, field=body.field, verdict=body.verdict, extracted_value=value, truth_value=truth, note=note, audited_by=user.id, audited_at=now,
                              first_verdict=body.verdict, first_value=value, first_at=now, times_checked=1))
            also += 1
    db.commit()
    return {"id": a.id, "verdict": a.verdict, "findings_settled": touched, "also_marked": also, "fixed_credit": fixed_credit}


# ─── Final records checked against the extractor and the reviewers ─────────────────

def _json_dumps(o) -> bytes:
    import json as _j
    return _j.dumps(o, ensure_ascii=False, indent=2, default=str).encode("utf-8")


@router.post("/answer-key")
async def answer_key(
    file: UploadFile = File(...), apply: bool = Form(False), project_id: str = Form(""), source_id: str = Form(""), ignore: str = Form("retrieved_at"), export: str = Form(""),
    decisions: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """The admin's final records against what the extractor delivered and what the reviewers flagged: error %, accuracy %, catches and false alarms.

    A field that differs is only a doubt until the admin decides it: "wrong" (the extractor made an error) or "right" (the extractor was right and the
    admin changed it). Undecided fields are held: they are not counted as errors and nothing is recorded for them. Without apply this only calculates.
    With apply it records each decided verdict as an audit (the same as marking the field in the review workspace). No record is ever edited."""
    _need_lead(user)
    import json as _json
    from app.services import answer_key as ak
    from app.services import record_locks as rl
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="That file is too large.")
    only = _source(db, user, source_id).name if source_id else None
    try:
        key = ak.load_key(file.filename or "", content, only)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read that file. Upload the zip, or the all-records JSON file.")
    if not key:
        raise HTTPException(status_code=422, detail="No records found in that file.")
    try:
        decs = {str(k): v for k, v in (_json.loads(decisions) if decisions else {}).items() if v in ("wrong", "right")}
    except Exception:
        raise HTTPException(status_code=422, detail="The decisions could not be read.")
    ignore_set = {x.strip() for x in (ignore or "").split(",") if x.strip()}

    sources = _visible_sources(db, user, project_id or None).all()
    by_norm: dict = {}
    for s in sources:
        by_norm.setdefault(ak.norm(s.name), []).append(s)

    all_users = {u.id: u for u in db.query(User).all()}
    by_email = {u.email: u for u in all_users.values()}
    uname = lambda uid: (all_users[uid].full_name if uid in all_users else "A reviewer")

    out_sources, unmatched_sources, notes = [], [], []
    ext_tot: dict = {}
    rev_tot: dict = {}
    todo: list = []  # (source, record, row, verdict to record)
    held = 0
    T = {"fields": 0, "correct": 0, "wrong": 0, "cosmetic": 0, "caught": 0, "escaped": 0, "false_alarms": 0, "fixed": 0, "pending": 0, "admin_changes": 0, "not_fixed": 0, "unmatched_fields": 0, "sop_failures": 0, "reviewer_flags": 0, "sources": 0, "records": 0}

    def reviewer(uid):
        return rev_tot.setdefault(uid, {"name": uname(uid), "flags": 0, "caught": 0, "false_alarms": 0, "errors_on_sources": 0, "sources": set()})

    for name, final_recs in key.items():
        cands = by_norm.get(ak.norm(name), [])
        if not cands:
            unmatched_sources.append(name)
            continue
        cands = sorted(cands, key=lambda s: -len(_records(db, s.id)))
        s = cands[0]
        if len(cands) > 1 and len(_records(db, cands[1].id)):
            notes.append(f"'{name}' matches {len(cands)} sources with records. Used the one in {s.project_id[:8]}…; pick a project to be sure.")
        recs = _records(db, s.id)
        ext_name = lambda r: ak.record_name(r.extracted_fields or {}, r.canonical_name)
        pairs, miss_final, miss_ext = ak.match_records(final_recs, recs, ext_name)

        peers = {p.user_id for p in s.peer_reviews if p.user_id}
        if s.assigned_reviewer_id:
            peers.add(s.assigned_reviewer_id)
        flags: dict = {}  # (record id, field) -> {reviewer id: the value they saw}
        for f in db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.status.in_(("open", "confirmed", "dismissed"))).all():
            if f.field and f.origin == "reviewer" and f.raised_by and (not peers or f.raised_by in peers):
                flags.setdefault((f.record_id, f.field), {}).setdefault(f.raised_by, f.extracted_value if f.extracted_value is not None else _MISSING)
        sysflag = {(f.record_id, f.field) for f in db.query(QualityFinding).filter(QualityFinding.source_id == s.id, QualityFinding.origin == "system", QualityFinding.status.in_(("open", "confirmed"))).all() if f.field}
        for r in recs:
            for field, lst in (r.reviewer_field_comments or {}).items():
                if field == "_general":
                    continue
                for e in (lst or []):
                    if isinstance(e, dict) and e.get("role") != "admin" and rl._flagged_by_comment(r, field, e):
                        u = by_email.get(e.get("user"))
                        if u and (not peers or u.id in peers):
                            flags.setdefault((r.id, field), {}).setdefault(u.id, _earlier_value(r, s, u.id, field))

        ex_name = uname(s.assigned_extractor_id) if s.assigned_extractor_id else "Unassigned"
        audits = {(x.record_id, x.field): x for x in db.query(FieldAudit).filter(FieldAudit.source_id == s.id).all()}
        try:
            req = _sop_for(s)
        except Exception:
            req = {"known": False, "required": [], "allowed": None, "specs": {}, "blocks": {}}
        sop_on = bool(req.get("known") and req.get("required"))
        required_set = set(req.get("required") or []) if sop_on else set()
        sd = {"source_id": s.id, "name": s.name, "extractor": ex_name, "reviewers": sorted(uname(u) for u in peers),
              "fields": 0, "correct": 0, "wrong": 0, "cosmetic": 0, "caught": 0, "escaped": 0, "false_alarms": 0, "fixed": 0, "pending": 0, "admin_changes": 0, "not_fixed": 0,
              "unmatched_fields": 0, "sop_failures": 0, "reviewer_flags": len(flags),
              "wrong_fields": [], "false_alarm_fields": [], "fixed_fields": [], "records": [], "unmatched_scored": [], "sop_failure_list": [],
              "key_records_unmatched": [ak.record_name(final_recs[i]) or f"record {i + 1}" for i in miss_final],
              "extractor_records_unmatched": [ak.record_name(recs[j].extracted_fields or {}, recs[j].canonical_name) or f"record {j + 1}" for j in miss_ext]}
        for i, j in pairs:
            r, fr = recs[j], final_recs[i]
            label = ak.record_name(r.extracted_fields or {}, r.canonical_name) or f"record {j + 1}"
            rows = ak.compare(r.extracted_fields or {}, fr, ignore_set)
            rec_wrong = 0
            if sop_on:   # the SOP applies to the final record, and is reported apart from extractor errors
                try:
                    sc = q.sop_check(fr, req["required"], req["allowed"], req.get("specs"), req.get("blocks"))
                    for f_ in sc["missing"]:
                        sd["sop_failure_list"].append({"record": label, "field": f_, "rule": "SOP rule", "why": "A required field is empty in the final record"})
                    for f_ in sc.get("extra") or []:
                        sd["sop_failure_list"].append({"record": label, "field": f_, "rule": "Schema", "why": "This field is not allowed by the SOP"})
                    for x in sc["bad"]:
                        if not x.get("case_only"):
                            sd["sop_failure_list"].append({"record": label, "field": x["field"], "rule": "SOP rule", "why": (f"Allowed: {', '.join(x['allowed'])}. Has: {x['value']}" if x.get("allowed") else f"{x['value']}: {x.get('reason')}")})
                except Exception:
                    pass
            for row in rows:
                field = row["field"]
                who = flags.get((r.id, field), {})
                cur = (r.extracted_fields or {}).get(field)
                key = f"{r.id}|{field}"
                aud = audits.get((r.id, field))
                aud_ok = bool(aud and _same(aud.extracted_value, cur))      # the verdict still describes the value that is there now
                sd["fields"] += 1
                sd["cosmetic"] += 1 if row["cosmetic"] else 0
                cls, why, not_fixed = "correct", "", False
                if row["verdict"] == "wrong":
                    kind_removed, kind_added = ak.empty(row["final_value"]), ak.empty(row["extractor_value"])
                    forced = decs.get(key)
                    if forced:
                        cls, why = ("error" if forced == "wrong" else "admin"), "Decided by you in the Final check"
                    elif aud_ok and aud.verdict == "incorrect":
                        cls, why = "error", "You marked the delivered value wrong in review"
                    elif aud_ok and aud.verdict == "correct":
                        cls, why = "admin", "You marked the delivered value correct in review, so the final value is your change"
                    elif kind_removed and not who and (r.id, field) not in sysflag:
                        cls, why = "admin", "Removed by the admin with no reason recorded and nobody flagged it"
                    elif kind_added and field in required_set:
                        cls, why = "error", "A required field the extractor left empty"
                    elif kind_added and not who:
                        cls, why = "admin", "An optional field the admin added"
                    else:
                        cls, why = "held", "The value differs and no verdict is recorded. Decide it, or record a verdict in Check against source"
                elif aud_ok and aud.verdict == "incorrect":
                    if decs.get(key) == "right":
                        cls, why = "admin", "You overruled your earlier Wrong verdict: the delivered value is right"
                    else:
                        cls, why, not_fixed = "error", "You marked it wrong in review and the final value is still the delivered value (not fixed)", True
                if cls == "correct":
                    sd["correct"] += 1
                else:
                    entry = {"key": key, "record": label, "field": field, "extractor_value": row["extractor_value"], "final_value": row["final_value"], "category": row["category"] or "wrong_value",
                             "decision": decs.get(key) or ("pending" if cls == "held" else None), "class": {"error": "extractor_error", "admin": "admin_change", "held": "held"}[cls], "reason": why,
                             "not_fixed": not_fixed, "flagged_by": sorted(uname(u) for u in who), "system_flagged": (r.id, field) in sysflag}
                    if cls == "held":
                        sd["pending"] += 1
                        entry["outcome"] = "to_confirm"
                        sd["wrong_fields"].append(entry)
                        held += 1
                        continue  # a doubt: nothing is recorded until the admin decides
                    if cls == "error":
                        rec_wrong += 1
                        sd["wrong"] += 1
                        sd["not_fixed"] += 1 if not_fixed else 0
                        for uid in who:
                            d = reviewer(uid); d["flags"] += 1; d["caught"] += 1; d["sources"].add(s.name)
                        entry["outcome"] = "caught" if who else "escaped"
                        sd["caught" if who else "escaped"] += 1
                        sd["wrong_fields"].append(entry)
                        if not not_fixed:
                            todo.append((s, r, row, "incorrect"))
                        continue
                    sd["admin_changes"] += 1       # the extractor's value stands and the admin changed it
                    entry["outcome"] = "admin_change"
                    sd["wrong_fields"].append(entry)
                for uid, earlier in who.items():
                    d = reviewer(uid); d["flags"] += 1; d["sources"].add(s.name)
                    if earlier is not _MISSING and not _same(earlier, cur):  # the reviewer flagged an earlier value that was fixed before the final check: a catch
                        d["caught"] += 1
                        sd["fixed"] += 1
                        sd["fixed_fields"].append({"record": label, "field": field, "was": earlier, "now": cur, "flagged_by": uname(uid)})
                    else:
                        d["false_alarms"] += 1
                        sd["false_alarms"] += 1
                        sd["false_alarm_fields"].append({"record": label, "field": field, "value": cur, "flagged_by": [uname(uid)]})
                todo.append((s, r, row, "correct"))
            sd["records"].append({"name": label, "matched_to": ak.record_name(fr) or label, "fields": len(rows), "wrong": rec_wrong})
        # a delivered record with no final record is the wrong entity or the wrong source: every one of its fields is scored as wrong (you can overrule it)
        for j in miss_ext:
            r = recs[j]
            names_ = [k for k, v in (r.extracted_fields or {}).items() if k not in ignore_set and not ak.empty(v)]
            if not names_:
                continue
            label = ak.record_name(r.extracted_fields or {}, r.canonical_name) or f"record {j + 1}"
            ok_ = decs.get(f"rec|{r.id}") == "right"
            sd["fields"] += len(names_)
            sd["unmatched_fields"] += len(names_)
            sd["admin_changes" if ok_ else "wrong"] += len(names_)
            sd["unmatched_scored"].append({"key": f"rec|{r.id}", "record": label, "fields": len(names_), "decision": "right" if ok_ else "wrong",
                                           "replaced_by": [ak.record_name(final_recs[i]) or f"record {i + 1}" for i in miss_final]})
            if not ok_:
                for f_ in names_:
                    todo.append((s, r, {"field": f_, "final_value": None, "category": "unsupported_value"}, "incorrect"))
        sd["sop_failures"] = len(sd["sop_failure_list"])
        sd.update(_pcts(sd["fields"], sd["wrong"]))
        sd["catch_rate"] = round(100 * (sd["caught"] + sd["fixed"]) / (sd["wrong"] + sd["fixed"]), 1) if (sd["wrong"] + sd["fixed"]) else None
        for uid in peers:
            d = reviewer(uid)
            d["errors_on_sources"] += sd["wrong"] + sd["fixed"]
            d["sources"].add(s.name)
        e = ext_tot.setdefault(s.assigned_extractor_id or "-", {"name": ex_name, "fields": 0, "correct": 0, "wrong": 0, "pending": 0, "admin_changes": 0, "fixed": 0, "not_fixed": 0, "sop_failures": 0, "sources": 0})
        for k in ("fields", "correct", "wrong", "pending", "admin_changes", "fixed", "not_fixed", "sop_failures"):
            e[k] += sd[k]
        e["sources"] += 1
        for k in ("fields", "correct", "wrong", "cosmetic", "caught", "escaped", "false_alarms", "fixed", "pending", "admin_changes", "not_fixed", "unmatched_fields", "sop_failures", "reviewer_flags"):
            T[k] += sd[k]
        T["sources"] += 1
        T["records"] += len(pairs)
        out_sources.append(sd)

    totals = {**T, **_pcts(T["fields"], T["wrong"]),
              "catch_rate": round(100 * (T["caught"] + T["fixed"]) / (T["wrong"] + T["fixed"]), 1) if (T["wrong"] + T["fixed"]) else None}
    extractors = sorted(({**e, **_pcts(e["fields"], e["wrong"])} for e in ext_tot.values()), key=lambda x: x["name"].lower())
    reviewers = sorted(({"name": d["name"], "sources": len(d["sources"]), "flags": d["flags"], "caught": d["caught"], "false_alarms": d["false_alarms"],
                         "errors_on_their_sources": d["errors_on_sources"], "missed": max(0, d["errors_on_sources"] - d["caught"]),
                         "catch_rate": round(100 * d["caught"] / d["errors_on_sources"], 1) if d["errors_on_sources"] else None,
                         "precision": round(100 * d["caught"] / d["flags"], 1) if d["flags"] else None} for d in rev_tot.values()), key=lambda x: x["name"].lower())
    result = {"mode": "preview", "totals": totals, "sources": sorted(out_sources, key=lambda x: x["name"].lower()), "extractors": extractors, "reviewers": reviewers,
              "unmatched_sources": unmatched_sources, "notes": notes, "ignored_fields": sorted(ignore_set)}

    if apply:
        written = already = 0
        skipped: list = []
        for s, r, row, verdict in todo:
            fv = row["final_value"]
            truth = None
            if verdict == "incorrect":
                truth = "(should not be there)" if ak.empty(fv) else (fv if isinstance(fv, str) else _json.dumps(fv, ensure_ascii=False))
            if verdict == "correct" and row["field"] not in (r.extracted_fields or {}):
                continue           # nothing delivered on this field, so there is nothing to mark correct
            a = db.query(FieldAudit).filter(FieldAudit.record_id == r.id, FieldAudit.field == row["field"]).first()
            if a and a.verdict == verdict and _same(a.extracted_value, (r.extracted_fields or {}).get(row["field"])) and (verdict == "correct" or _same(a.truth_value, truth)):
                already += 1
                continue
            try:
                review_mark(MarkBody(record_id=r.id, field=row["field"], verdict=verdict, truth_value=truth,
                                     note="Checked against the admin's final records." if verdict == "incorrect" else None,
                                     category=row["category"] or "wrong_value", severity="major"), db, user)
                written += 1
            except HTTPException as e:
                db.rollback()
                skipped.append({"source": s.name, "field": row["field"], "why": str(e.detail)})
        result["mode"] = "applied"
        result["applied"] = {"written": written, "already_recorded": already, "held": held, "skipped": skipped}
    if export in ("xlsx", "json"):
        from fastapi.responses import Response
        from app.services import quality_export as qx
        stamp = enh.now_utc().strftime("%Y%m%d")
        if export == "json":
            return Response(content=_json_dumps(result), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="final_check_{stamp}.json"'})
        return Response(content=qx.final_check_xlsx(result, {"generated": stamp}), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="final_check_{stamp}.xlsx"'})
    return result


@router.get("/rounds")
def rounds_report(project_id: str = "", source_id: str = "", ignore: str = "retrieved_at", export: str = "",
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What changed between the kept first round (v1) and the records now (v2), source by source and field by field."""
    _need_lead(user)
    from app.models.all_models import SourceRound
    from app.services import answer_key as ak
    ign = {x.strip() for x in (ignore or "").split(",") if x.strip()}
    srcs = {s.id: s for s in _visible_sources(db, user, project_id or None).all()}
    if source_id:
        srcs = {k: v for k, v in srcs.items() if k == source_id}
    rounds: dict = {}
    for r in db.query(SourceRound).filter(SourceRound.source_id.in_(list(srcs) or [""])).order_by(SourceRound.round).all():
        rounds[r.source_id] = r                      # the latest kept round is the one compared
    uname = {u.id: u.full_name for u in db.query(User).all()}
    T = {"sources": 0, "v1_records": 0, "v2_records": 0, "fields": 0, "same": 0, "wording": 0, "changed": 0, "added": 0, "removed": 0,
         "fixed": 0, "regressed": 0, "still_wrong": 0, "unchecked": 0, "records_dropped": 0, "records_new": 0, "v1_wrong": 0, "v1_checked": 0, "v2_wrong": 0, "v2_checked": 0}
    out = []
    for sid, rd in rounds.items():
        s = srcs[sid]
        v2 = _records(db, sid)
        v1 = list(rd.records or [])
        a1 = {(a["record_id"], a["field"]): a for a in (rd.audits or [])}
        a2 = {(a.record_id, a.field): a for a in db.query(FieldAudit).filter(FieldAudit.source_id == sid).all()}
        pairs, miss_v1, miss_v2 = ak.match_records([x.get("fields") or {} for x in v1], v2, lambda r: ak.record_name(r.extracted_fields or {}, r.canonical_name))
        sd = {"source_id": sid, "name": s.name, "round": rd.round, "kept_at": rd.created_at, "v1_extractor": rd.extractor_name or "Unknown",
              "v2_extractor": uname.get(s.assigned_extractor_id) or "Unassigned", "v1_reviewers": [x.get("name") for x in (rd.reviewers or []) if x.get("name")],
              "v2_reviewers": sorted(uname.get(p.user_id, "") for p in s.peer_reviews if p.user_id), "v1_records": len(v1), "v2_records": len(v2),
              "fields": 0, "same": 0, "wording": 0, "changed": 0, "added": 0, "removed": 0, "fixed": 0, "regressed": 0, "still_wrong": 0, "unchecked": 0,
              "v1_wrong": sum(1 for a in a1.values() if a["verdict"] == "incorrect"), "v1_checked": len(a1),
              "v2_wrong": sum(1 for a in a2.values() if a.verdict == "incorrect"), "v2_checked": len(a2),
              "changes": [], "dropped_records": [ak.record_name(v1[i].get("fields") or {}) or v1[i].get("name") or f"record {i + 1}" for i in miss_v1],
              "new_records": [ak.record_name(v2[j].extracted_fields or {}, v2[j].canonical_name) or f"record {j + 1}" for j in miss_v2]}
        for i, j in pairs:
            r1, r2 = v1[i], v2[j]
            label = ak.record_name(r2.extracted_fields or {}, r2.canonical_name) or r1.get("name") or f"record {j + 1}"
            for row in ak.compare(r2.extracted_fields or {}, r1.get("fields") or {}, ign):
                sd["fields"] += 1
                if row["verdict"] == "correct":
                    sd["wording" if row["cosmetic"] else "same"] += 1
                    continue
                v1v, v2v = row["final_value"], row["extractor_value"]
                kind = "added" if ak.empty(v1v) else "removed" if ak.empty(v2v) else "changed"
                sd[kind] += 1
                x1, x2 = a1.get((r1.get("id"), row["field"])), a2.get((r2.id, row["field"]))
                if x1 and x1["verdict"] == "incorrect" and ((x2 and x2.verdict == "correct") or (x2 is None and x1.get("truth_value") and ak.judge(v2v, x1["truth_value"])[0] == "correct")):
                    res = "fixed"
                elif x1 and x1["verdict"] == "correct" and x2 and x2.verdict == "incorrect":
                    res = "regressed"
                elif x1 and x1["verdict"] == "incorrect" and x2 and x2.verdict == "incorrect":
                    res = "still_wrong"
                else:
                    res = "unchecked"
                sd[res] += 1
                sd["changes"].append({"record": label, "field": row["field"], "kind": kind, "v1_value": v1v, "v2_value": v2v, "result": res})
        sd["records_dropped"], sd["records_new"] = len(miss_v1), len(miss_v2)
        sd["change_pct"] = round(100 * (sd["changed"] + sd["added"] + sd["removed"]) / sd["fields"], 1) if sd["fields"] else None
        T["sources"] += 1
        for k in ("fields", "same", "wording", "changed", "added", "removed", "fixed", "regressed", "still_wrong", "unchecked", "v1_wrong", "v1_checked", "v2_wrong", "v2_checked"):
            T[k] += sd[k]
        T["v1_records"] += sd["v1_records"]; T["v2_records"] += sd["v2_records"]; T["records_dropped"] += len(miss_v1); T["records_new"] += len(miss_v2)
        out.append(sd)
    T["change_pct"] = round(100 * (T["changed"] + T["added"] + T["removed"]) / T["fields"], 1) if T["fields"] else None
    T["v1_error_pct"] = round(100 * T["v1_wrong"] / T["v1_checked"], 1) if T["v1_checked"] else None
    T["v2_error_pct"] = round(100 * T["v2_wrong"] / T["v2_checked"], 1) if T["v2_checked"] else None
    ppl: dict = {}
    for sd in out:
        for who, key in ((sd["v1_extractor"], "v1_sources"), (sd["v2_extractor"], "v2_sources")):
            ppl.setdefault(who, {"name": who, "v1_sources": 0, "v2_sources": 0})[key] += 1
    result = {"totals": T, "sources": sorted(out, key=lambda x: x["name"].lower()), "people": sorted(ppl.values(), key=lambda x: x["name"].lower()), "ignored_fields": sorted(ign)}
    if export == "xlsx":
        from fastapi.responses import Response
        from app.services import quality_export as qx
        stamp = enh.now_utc().strftime("%Y%m%d")
        return Response(content=qx.rounds_xlsx(result, {"generated": stamp}), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="v1_vs_v2_{stamp}.xlsx"'})
    return result


@router.post("/answer-key/submit")
async def submit_final_records(
    file: UploadFile = File(...), apply: bool = Form(False), approve: bool = Form(False), project_id: str = Form(""), source_id: str = Form(""),
    ignore: str = Form("retrieved_at"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Put the admin's final records on the platform. Matched records take the final values, a final record with no match is added, and a delivered record
    that the final one replaced is removed. With approve, the records and the sources are approved too. Without apply this only says what would change.
    Everything is logged as an admin override, and the earlier values are kept in the audit trail."""
    if not (_lead(user) and ({r.role.value for r in user.roles} & {"org_admin", "project_admin"})):
        raise HTTPException(status_code=403, detail="Only admins can submit final records.")
    from datetime import datetime, timezone
    from app.models.all_models import AuditAction, AuditLog, ExtractionConfidence, JobStatus, ReviewStatus, SourceType
    from app.services import answer_key as ak
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="That file is too large.")
    only = _source(db, user, source_id).name if source_id else None
    try:
        key = ak.load_key(file.filename or "", content, only)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read that file. Upload the zip, or the all-records JSON file.")
    by_norm: dict = {}
    for s in _visible_sources(db, user, project_id or None).all():
        by_norm.setdefault(ak.norm(s.name), []).append(s)
    ign = {x.strip() for x in (ignore or "").split(",") if x.strip()}
    now = datetime.now(timezone.utc)
    out, unmatched = [], []
    for name, final_recs in key.items():
        cands = by_norm.get(ak.norm(name), [])
        if not cands:
            unmatched.append(name)
            continue
        s = sorted(cands, key=lambda x: -len(_records(db, x.id)))[0]
        recs = _records(db, s.id)
        pairs, miss_final, miss_ext = ak.match_records(final_recs, recs, lambda r: ak.record_name(r.extracted_fields or {}, r.canonical_name))
        row = {"source_id": s.id, "name": s.name, "status": s.status.value, "records_updated": 0, "fields_changed": 0, "records_unchanged": 0, "records_added": [], "records_removed": [],
               "records_left": [], "approved": False, "changed": []}
        for i, j in pairs:
            r, fr = recs[j], final_recs[i]
            diff = [d["field"] for d in ak.compare(r.extracted_fields or {}, fr, ign) if d["verdict"] == "wrong" or d["cosmetic"]]
            new_fields = dict(fr)
            for k in ign:                       # a timestamp is not a correction: keep the one the record has
                if k in (r.extracted_fields or {}):
                    new_fields[k] = r.extracted_fields[k]
                else:
                    new_fields.pop(k, None)
            if not diff and set(new_fields) == set(r.extracted_fields or {}):
                row["records_unchanged"] += 1
            else:
                row["records_updated"] += 1
                row["fields_changed"] += len(diff)
                row["changed"].append({"record": ak.record_name(fr) or r.canonical_name, "fields": diff})
                if apply:
                    before = dict(r.extracted_fields or {})
                    r.extracted_fields = new_fields
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(r, "extracted_fields")
                    r.canonical_name = ak.record_name(new_fields) or r.canonical_name
                    db.add(AuditLog(user_id=user.id, project_id=s.project_id, source_id=s.id, record_id=r.id, action=AuditAction.SOURCE_RECORD_FIXED,
                                    before_value={"extracted_fields": before}, after_value={"extracted_fields": new_fields, "final_records_submit": True, "lock_override": True, "fields": diff}))
        replaced = bool(miss_final)
        for i in miss_final:
            nm = ak.record_name(final_recs[i]) or f"record {i + 1}"
            row["records_added"].append(nm)
            if apply:
                job = db.query(ExtractionJob).filter(ExtractionJob.source_id == s.id).order_by(ExtractionJob.created_at.desc()).first()
                if not job:
                    job = ExtractionJob(project_id=s.project_id, source_id=s.id, name="Final records", source_type=SourceType.CSV, created_by=user.id)
                    db.add(job)
                    db.flush()
                nr = ExtractedRecord(job_id=job.id, extracted_fields=dict(final_recs[i]), raw_text="", extraction_confidence=ExtractionConfidence.HIGH, canonical_name=nm)
                db.add(nr)
                db.flush()
                recs.append(nr)
                db.add(AuditLog(user_id=user.id, project_id=s.project_id, source_id=s.id, record_id=nr.id, action=AuditAction.SOURCE_RECORD_FIXED,
                                after_value={"extracted_fields": final_recs[i], "final_records_submit": True, "lock_override": True, "added": True}))
        for j in miss_ext:
            nm = ak.record_name(recs[j].extracted_fields or {}, recs[j].canonical_name) or f"record {j + 1}"
            if replaced:                         # the final record replaces it
                row["records_removed"].append(nm)
                if apply:
                    r = recs[j]
                    db.add(AuditLog(user_id=user.id, project_id=s.project_id, source_id=s.id, action=AuditAction.SOURCE_RECORD_FIXED,
                                    before_value={"extracted_fields": r.extracted_fields, "name": nm}, after_value={"deleted": True, "final_records_submit": True, "lock_override": True}))
                    db.query(FieldAudit).filter(FieldAudit.record_id == r.id).delete(synchronize_session=False)
                    db.query(QualityFinding).filter(QualityFinding.record_id == r.id).delete(synchronize_session=False)
                    db.delete(r)
            else:
                row["records_left"].append(nm)    # no final record replaces it, so it is not removed
        if apply:
            db.flush()
            live = _records(db, s.id)
            s.total_records = len(live)
            if approve:
                for r in live:
                    r.review_status = ReviewStatus.APPROVED
                    r.reviewed_by, r.reviewed_at = user.id, now
                    r.review_note = r.review_note or "Approved with the admin's final records"
                s.approved_records = len(live)
                s.valid_records = len(live)
                s.invalid_records = 0
                s.status = SourceStatus.APPROVED
                s.approved_at = now
                s.review_completed_at = s.review_completed_at or now
                for job in db.query(ExtractionJob).filter(ExtractionJob.source_id == s.id).all():
                    job.status = JobStatus.VALIDATED
                    job.total_approved = len(live)
                db.add(AuditLog(user_id=user.id, project_id=s.project_id, source_id=s.id, action=AuditAction.SOURCE_APPROVED,
                                after_value={"source_id": s.id, "final_records_submit": True, "lock_override": True}))
                row["approved"] = True
        out.append(row)
    if apply:
        db.commit()
    tot = {k: sum((len(x[k]) if isinstance(x[k], list) else x[k]) for x in out) for k in ("records_updated", "fields_changed", "records_unchanged", "records_added", "records_removed", "records_left")}
    return {"mode": "applied" if apply else "preview", "approve": approve, "sources": sorted(out, key=lambda x: x["name"].lower()), "unmatched_sources": unmatched, "totals": tot}


# ─── Download of peer-reviewed sources ─────────────────────────────────────────

@router.get("/export")
def export_peer_reviewed(project_id: str | None = None, scope: str = Query("peer_done"), format: str = Query("xlsx"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One file with every peer-reviewed source (or all sources), the peers' comments beside the data, ready to hand to an AI model."""
    from fastapi.responses import Response
    from app.services import quality_export as qx
    _need_lead(user)
    if format not in ("xlsx", "json"):
        raise HTTPException(status_code=422, detail="Choose xlsx or json.")
    items = []
    for s in sorted(_visible_sources(db, user, project_id).filter(Source.status != SourceStatus.NOT_STARTED).all(), key=lambda x: x.name.lower()):
        total, done = _peer_state(s)
        if scope == "peer_done" and not (total > 0 and done == total):
            continue
        rv = _review_data(db, s, True, user.id)
        pr = db.query(Project).filter(Project.id == s.project_id).first()
        ex = db.query(User).filter(User.id == s.assigned_extractor_id).first() if s.assigned_extractor_id else None
        items.append({"source": s, "project": pr.name if pr else "", "extractor": ex.full_name if ex else "", "review": rv,
                      "peer_rows": [{"name": p.user.full_name if p.user else "Peer reviewer", "status": p.status, "comment": (p.comment or ""), "when": qx._fmt(p.submitted_at)} for p in s.peer_reviews]})
    if not items:
        raise HTTPException(status_code=404, detail="No peer-reviewed sources to download yet.")
    data = qx.collect(items)
    stamp = enh.now_utc().strftime("%Y%m%d")
    if format == "json":
        body, mt = qx.to_json(data, {"scope": scope, "sources": len(items), "generated": stamp}), "application/json"
    else:
        body, mt = qx.to_xlsx(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(content=body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="peer_reviewed_sources_{stamp}.{format}"'})


# ─── Nimble Extract: look for a record's values on the source website ─────────

@router.get("/nimble/status")
def nimble_status(user: User = Depends(get_current_user)):
    from app.services import nimble
    _need_lead(user)
    return {"configured": nimble.configured()}


SITE_CHECKS_PER_HOUR = 60
_SITE_HITS: dict = {}


def _site_budget(user_id: str) -> bool:
    """Nimble costs money per page. One person can read this many pages an hour."""
    import time
    now = time.time()
    hits = [t for t in _SITE_HITS.get(user_id, []) if now - t < 3600]
    if len(hits) >= SITE_CHECKS_PER_HOUR:
        _SITE_HITS[user_id] = hits
        return False
    hits.append(now)
    _SITE_HITS[user_id] = hits
    return True


class SiteCheckBody(BaseModel):
    record_id: str
    url: str | None = None
    render: bool = False


@router.post("/review/site-check")
def site_check(body: SiteCheckBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fetch the source website with Nimble Extract and say, field by field, whether the value appears on the page.
    This points the reviewer at what to look at. It never marks anything correct or wrong by itself."""
    from app.services import nimble
    _need_lead(user)
    rec = db.query(ExtractedRecord).filter(ExtractedRecord.id == body.record_id).first()
    job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first() if rec else None
    s = _source(db, user, job.source_id) if job and job.source_id else None
    if not s:
        raise HTTPException(status_code=404, detail="Record not found.")
    url = (body.url or "").strip() or s.website_url or ""
    if not url:
        return {"ok": False, "error": "This source has no website address. Type one to check against.", "url": "", "fields": {}}
    if not _site_budget(user.id):
        return {"ok": False, "error": f"That is {SITE_CHECKS_PER_HOUR} website checks in the last hour. Wait a little, or check the rest by hand.", "url": url, "fields": {}}
    res = nimble.extract(url, render=body.render)
    if not res["ok"]:
        return {"ok": False, "error": res["error"], "url": res["url"], "fields": {}}
    out = {k: q.site_state(k, q.find_in_text(v, res["text"])) for k, v in (rec.extracted_fields or {}).items() if k not in q.SKIP_FIELDS}
    return {"ok": True, "url": res["url"], "cached": bool(res.get("cached")), "fields": out, "text": res["text"][:80000]}


class SourceAuditBody(BaseModel):
    source_id: str
    render: bool = False


@router.post("/review/source-audit")
def source_audit(body: SourceAuditBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Check every field of every record in a source against the live pages it cites, using the SOP rules.
    Returns Correct / Wrong / Hold per field with a quoted proof. It changes nothing: the reviewer applies what they agree with."""
    from concurrent.futures import ThreadPoolExecutor
    from app.services import nimble, source_audit as sa
    _need_lead(user)
    s = _source(db, user, body.source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found.")
    if not nimble.configured():
        raise HTTPException(status_code=400, detail="Nimble is not set up. Add NIMBLE_API_KEY to the server settings to audit against the live site.")
    desk = _review_data(db, s, True, user.id)
    urls: list = []
    for r in desk["records"]:
        for f in r["fields"]:
            if f["name"] == "source_url" and isinstance(f["value"], str) and f["value"].strip() and f["value"].strip() not in urls:
                urls.append(f["value"].strip())
    if not urls and s.website_url:
        urls.append(s.website_url)
    urls = urls[:12]

    def grab(u):
        if not _site_budget(user.id):
            return u, {"ok": False, "error": f"the hourly limit of {SITE_CHECKS_PER_HOUR} website reads was reached", "text": ""}
        res = nimble.extract(u, render=body.render)
        return u, ({"ok": True, "text": res["text"], "final_url": res.get("final_url"), "error": None} if res["ok"] else {"ok": False, "error": res["error"], "text": ""})
    with ThreadPoolExecutor(max_workers=4) as ex:
        pages = dict(ex.map(grab, urls))
    ext = db.query(User).filter(User.id == s.assigned_extractor_id).first() if s.assigned_extractor_id else None
    from app.services import sop_requirements as sr
    sop = sr.build(s)
    out = sa.audit_source(desk, pages, s.name, s.website_url, ext.full_name if ext else None, sop=sop if sop.get("has_sop") else None)
    out["pages"] = [{"url": u, "ok": p["ok"], "error": p.get("error"), "final_url": p.get("final_url"), "chars": p.get("chars", 0)} for u, p in pages.items()]
    out["source_id"] = s.id
    out["sop_code"] = desk.get("sop_code")
    return out


async def _ensure_sops(db: Session, srcs: list, force: bool = False, max_fetch: int = 40) -> dict:
    """Make sure each source has its SOP from Xtrium saved on it. Gentle on Xtrium: sources that already have one are
    skipped (unless force), calls are one at a time, and the first rate-limit or refusal stops the run."""
    import asyncio
    from app.api.v1.routes.integrations import _load_sop
    info = {"fetched": 0, "already": 0, "changed": 0, "failed": [], "stopped": False, "origin": {}}
    done = 0
    from app.services import sop_requirements as _sr
    for s in srcs:
        if not s.external_ref_id:
            continue
        _sr.follow_category(s)  # the category follows the SOP Xtrium attached, no network call
        has = isinstance(s.xtrium_sop, dict) and bool((s.xtrium_sop.get("sop") or {}).get("markdown"))
        if has and not force:
            info["already"] += 1
            info["origin"][s.id] = {"origin": "saved", "live_error": None}
            continue
        if not force:
            # Screens read what was saved when the source was pulled. Xtrium is only called on an explicit refresh.
            info["origin"][s.id] = {"origin": "none", "live_error": None}
            continue
        if done >= max_fetch:
            info["stopped"] = True
            break
        got = await _load_sop(s, db, force=True, deep=force)
        done += 1
        _sr.follow_category(s)
        info["origin"][s.id] = {"origin": got["origin"], "live_error": got["live_error"]}
        if got["sop"]:
            info["fetched"] += 1
            info["changed"] += 1 if got["just_saved"] else 0
        else:
            info["failed"].append({"source": s.name, "error": got["live_error"]})
            if got["live_error"] and re.search(r"refus|403|429|rate|locked|not retrying", str(got["live_error"]), re.I):
                info["stopped"] = True
                break
        await asyncio.sleep(0.3)
    return info


@router.get("/sop-requirements")
async def sop_requirements_list(project_id: str | None = None, refresh: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What every source must follow, read from the SOP Xtrium attached to it: category, SOP code and version, required fields,
    rules and warnings. Sources with no saved SOP get theirs from Xtrium now. refresh=true asks Xtrium again for all of them."""
    from app.services import sop_requirements as sr
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    sync = await _ensure_sops(db, srcs, force=refresh)
    out = []
    for s in srcs:
        o = sync["origin"].get(s.id, {})
        r = sr.build(s, origin=o.get("origin"), live_error=o.get("live_error"))
        out.append({k: r[k] for k in ("source_id", "name", "category", "entity", "sop_code", "title", "spec_version", "has_sop", "has_markdown", "required_fields", "counts", "warnings", "origin", "saved_at", "from_xtrium", "stale", "no_contract")})
    out.sort(key=lambda x: (x["has_sop"], -len(x["warnings"]), x["name"].lower()))
    return {"items": out, "sync": {k: sync[k] for k in ("fetched", "already", "changed", "failed", "stopped")}}


@router.get("/sources/{source_id}/sop-requirements")
async def sop_requirements_source(source_id: str, refresh: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import sop_requirements as sr
    from app.api.v1.routes.integrations import _load_sop
    _need_lead(user)
    s = _source(db, user, source_id)
    if not refresh:
        has = isinstance(s.xtrium_sop, dict) and bool((s.xtrium_sop.get("sop") or {}).get("markdown"))
        out = sr.build(s, origin="saved" if has else "none", live_error=None)
        out["just_saved"] = False
        return out
    got = await _load_sop(s, db, force=True, deep=True)
    out = sr.build(s, origin=got["origin"], live_error=got["live_error"])
    out["just_saved"] = got["just_saved"]
    return out


@router.get("/sop-requirements/export")
async def sop_requirements_export(project_id: str | None = None, refresh: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi.responses import Response
    from app.services import quality_export as qx, sop_requirements as sr
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    sync = await _ensure_sops(db, srcs, force=refresh)
    items = [sr.build(s, origin=sync["origin"].get(s.id, {}).get("origin"), live_error=sync["origin"].get(s.id, {}).get("live_error")) for s in srcs]
    if not items:
        raise HTTPException(status_code=404, detail="No sources to report.")
    items.sort(key=lambda x: x["name"].lower())
    stamp = enh.now_utc().strftime("%Y%m%d")
    body = qx.sop_requirements_xlsx(items, {"generated": stamp})
    return Response(content=body, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="sop_requirements_{stamp}.xlsx"'})


# ─── Batch report: one page per Xtrium pull, built from live data ────────────

@router.get("/batch-report/list")
def batch_report_list(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import batch_report as br
    _need_lead(user)
    return {"batches": br.list_batches(_visible_sources(db, user, project_id).all())}


@router.get("/batch-report")
def batch_report(batch: str, project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything about the sources Xtrium gave on one day: progress, what is blocked and what we need, people, and accuracy."""
    from app.services import batch_report as br
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    try:
        sc, _ = _scorecard_data(db, user, project_id, None, None, None)
    except Exception:
        sc = None
    return br.assemble(db, user, srcs, batch, sc)


@router.get("/engagement-report")
def engagement_report(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The full engagement summary across every batch, from live data."""
    from app.services import batch_report as br
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if not srcs:
        raise HTTPException(status_code=404, detail="No sources yet.")
    try:
        sc, _ = _scorecard_data(db, user, project_id, None, None, None)
    except Exception:
        sc = None
    return br.engagement(db, user, srcs, sc)
