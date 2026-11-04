"""Send checked fields back to the extractor. The admin's verdict is kept as it was; the extractor confirms it or disagrees with a finding,
an optional link and an optional SOP reference; an admin rules on a disagreement."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _can_chat, _lead, _need_lead, _visible_sources
from app.core.notify import ACTION, INFO, admin_user_ids, notify, src_link
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import AuditChallenge, ExtractedRecord, FieldAudit, Source, User
from app.services import enh

router = APIRouter(prefix="/audit-challenges", tags=["audit-challenges"])


def _status(c: AuditChallenge) -> str:
    if c.ruling:
        return "settled"
    return {"agree": "agreed", "disagree": "disputed"}.get(c.stance or "", "waiting")


def _src(db: Session, user: User, source_id: str) -> Source:
    s = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not s or not _can_chat(user, s):
        raise HTTPException(status_code=404, detail="Source not found.")
    return s


def _hint(s: Source, field: str, cache: dict) -> dict | None:
    """What the SOP says about this field, so the extractor can point at it."""
    try:
        if "sop" not in cache:
            from app.api.v1.routes.quality import _sop_for
            cache["sop"] = _sop_for(s)
        sop = cache["sop"]
        sp = (sop.get("specs") or {}).get(field) or (sop.get("specs") or {}).get(field.split(".")[-1])
        req = field in (sop.get("required") or [])
        if not sp and not req:
            return {"sop_code": sop.get("sop_code"), "required": False} if sop.get("sop_code") else None
        sp = sp or {}
        return {"sop_code": sop.get("sop_code"), "required": bool(req or sp.get("required")), "type": sp.get("type"), "allowed": sp.get("allowed"),
                "format": sp.get("format"), "rule": sp.get("rule"), "section": sp.get("section"), "quote": sp.get("quote")}
    except Exception:
        return None


def _row(c: AuditChallenge, labels: dict, names: dict, rec_vals: dict, hint, extra: dict | None = None) -> dict:
    cur = rec_vals.get(c.record_id)
    return {"id": c.id, "source_id": c.source_id, "record_id": c.record_id, "record": labels.get(c.record_id) or "(record removed)", "field": c.field,
            "status": _status(c), "extracted_value": c.extracted_value, "current_value": (cur or {}).get(c.field) if cur is not None else None,
            "admin_verdict": c.admin_verdict, "admin_truth": c.admin_truth, "admin_note": c.admin_note,
            "sent_at": c.sent_at, "sent_by": names.get(c.sent_by, ""), "sent_note": c.sent_note,
            "stance": c.stance, "finding": c.finding, "evidence_url": c.evidence_url, "sop_ref": c.sop_ref,
            "responded_at": c.responded_at, "responded_by": names.get(c.responded_by, ""),
            "ruling": c.ruling, "ruling_note": c.ruling_note, "ruled_at": c.ruled_at, "ruled_by": names.get(c.ruled_by, ""),
            "sop_hint": hint, **(extra or {})}


def _maps(db: Session, cs: list):
    from app.api.v1.routes.quality import _label
    uids = {x for c in cs for x in (c.sent_by, c.responded_by, c.ruled_by, c.extractor_id) if x}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    rids = {c.record_id for c in cs if c.record_id}
    recs = db.query(ExtractedRecord).filter(ExtractedRecord.id.in_(rids)).all() if rids else []
    labels = {r.id: _label(r) for r in recs}
    vals = {r.id: (r.extracted_fields or {}) for r in recs}
    return names, labels, vals


class SendBody(BaseModel):
    source_ids: list[str] | None = None
    project_id: str | None = None
    include_correct: bool = False
    note: str | None = None


@router.post("/send")
def send_back(body: SendBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One challenge per checked field. A field already sent is left alone, so pressing this twice is safe."""
    _need_lead(user)
    srcs = _visible_sources(db, user, body.project_id).all()
    if body.source_ids is not None:
        want = set(body.source_ids)
        srcs = [s for s in srcs if s.id in want]
    by = {s.id: s for s in srcs}
    if not by:
        raise HTTPException(status_code=404, detail="No sources to send back.")
    q = db.query(FieldAudit).filter(FieldAudit.source_id.in_(list(by)))
    if not body.include_correct:
        q = q.filter(FieldAudit.verdict == "incorrect")
    audits = q.all()
    have = {c.audit_id for c in db.query(AuditChallenge.audit_id).filter(AuditChallenge.audit_id.in_([a.id for a in audits])).all()} if audits else set()
    note = (body.note or "").strip() or None
    made, skipped_noext, per_src = 0, 0, {}
    for a in audits:
        if a.id in have:
            continue
        s = by[a.source_id]
        if not s.assigned_extractor_id:
            skipped_noext += 1
            continue
        db.add(AuditChallenge(audit_id=a.id, source_id=s.id, record_id=a.record_id, field=a.field, extractor_id=s.assigned_extractor_id, sent_by=user.id, sent_at=enh.now_utc(),
                              sent_note=note, admin_verdict=a.verdict, admin_truth=a.truth_value, admin_note=a.note, extracted_value=a.extracted_value))
        made += 1
        per_src[s.id] = per_src.get(s.id, 0) + 1
    for sid, n in per_src.items():
        s = by[sid]
        notify(db, s.assigned_extractor_id, f"Admin sent {n} checked field{'s' if n != 1 else ''} back to you: {s.name}",
               "Open the source and review each one. Confirm it if the admin is right, or give your finding (with a link and the SOP reference if you have them) if you disagree.",
               src_link(s), "audit_challenge", ACTION)
    db.commit()
    return {"created": made, "already_sent": len([a for a in audits if a.id in have]), "no_extractor": skipped_noext, "sources": len(per_src), "checked": len(audits)}


@router.get("/source/{source_id}")
def for_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _src(db, user, source_id)
    cs = db.query(AuditChallenge).filter(AuditChallenge.source_id == s.id).order_by(AuditChallenge.sent_at.asc(), AuditChallenge.field.asc()).all()
    names, labels, vals = _maps(db, cs)
    cache: dict = {}
    items = [_row(c, labels, names, vals, _hint(s, c.field, cache)) for c in cs]
    counts = {k: sum(1 for i in items if i["status"] == k) for k in ("waiting", "agreed", "disputed", "settled")}
    return {"source_id": s.id, "items": items, "counts": counts, "can_respond": s.assigned_extractor_id == user.id, "can_rule": _lead(user)}


@router.get("")
def overview(project_id: str | None = None, source_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if source_id:
        srcs = [s for s in srcs if s.id == source_id]
    by = {s.id: s for s in srcs}
    cs = db.query(AuditChallenge).filter(AuditChallenge.source_id.in_(list(by))).order_by(AuditChallenge.sent_at.desc()).limit(1500).all() if by else []
    names, labels, vals = _maps(db, cs)
    cache: dict = {}
    items = []
    for c in cs:
        s = by[c.source_id]
        items.append(_row(c, labels, names, vals, _hint(s, c.field, cache.setdefault(s.id, {})), {"source": s.name, "extractor": names.get(c.extractor_id, "")}))
    counts = {k: sum(1 for i in items if i["status"] == k) for k in ("waiting", "agreed", "disputed", "settled")}
    return {"items": items, "counts": counts, "total": len(items)}


class RespondBody(BaseModel):
    stance: str
    finding: str | None = None
    evidence_url: str | None = None
    sop_ref: str | None = None


@router.post("/{cid}/respond")
def respond(cid: str, body: RespondBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.query(AuditChallenge).filter(AuditChallenge.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found.")
    s = _src(db, user, c.source_id)
    if s.assigned_extractor_id != user.id:
        raise HTTPException(status_code=403, detail="Only the extractor on this source can answer.")
    if c.ruling:
        raise HTTPException(status_code=409, detail="An admin has already ruled on this one.")
    if body.stance not in ("agree", "disagree"):
        raise HTTPException(status_code=422, detail="Choose: the admin is right, or you disagree.")
    finding = (body.finding or "").strip() or None
    url = (body.evidence_url or "").strip() or None
    if body.stance == "disagree":
        if not finding or len(finding) < 5:
            raise HTTPException(status_code=422, detail="Say what you found: what the source really says and why your value is right.")
        if url and not url.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=422, detail="The link must start with http:// or https://.")
    else:
        url = None
    c.stance, c.finding, c.evidence_url = body.stance, finding, url
    c.sop_ref = (body.sop_ref or "").strip()[:300] or None
    c.responded_by, c.responded_at = user.id, enh.now_utc()
    if body.stance == "disagree":
        nm = (db.query(User.full_name).filter(User.id == user.id).scalar() or "The extractor")
        for uid in admin_user_ids(db, s.project_id):
            notify(db, uid, f"Extractor disagrees with a check: {s.name}", f"{nm} disagrees with the check on {c.field}. Open the source to read the finding and rule on it.",
                   src_link(s), "audit_challenge", ACTION)
    db.commit()
    return {"id": c.id, "status": _status(c)}


class RuleBody(BaseModel):
    ruling: str
    note: str | None = None


@router.post("/{cid}/rule")
def rule(cid: str, body: RuleBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """upheld = the admin check stands. overturned = the extractor was right, so the audit becomes correct (the original check stays on the challenge)."""
    _need_lead(user)
    c = db.query(AuditChallenge).filter(AuditChallenge.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found.")
    s = _src(db, user, c.source_id)
    if body.ruling not in ("upheld", "overturned"):
        raise HTTPException(status_code=422, detail="Rule: the check stands, or the extractor is right.")
    note = (body.note or "").strip() or None
    a = db.query(FieldAudit).filter(FieldAudit.id == c.audit_id).first()
    was = c.ruling
    if a and body.ruling == "overturned" and was != "overturned":
        a.verdict, a.first_verdict, a.truth_value = "correct", "correct", None
        a.note = ("Overturned after the extractor's finding. " + (note or "")).strip()
        a.audited_by, a.audited_at = user.id, enh.now_utc()
    elif a and body.ruling == "upheld" and was == "overturned":
        a.verdict, a.first_verdict, a.truth_value, a.note = c.admin_verdict, c.admin_verdict, c.admin_truth, c.admin_note
        a.audited_by, a.audited_at = user.id, enh.now_utc()
    c.ruling, c.ruling_note, c.ruled_by, c.ruled_at = body.ruling, note, user.id, enh.now_utc()
    notify(db, c.extractor_id, f"Admin ruled on your answer: {s.name}",
           ("The admin agreed with you on " if body.ruling == "overturned" else "The admin kept the check on ") + f"{c.field}." + (f" {note}" if note else ""),
           src_link(s), "audit_challenge", INFO)
    db.commit()
    return {"id": c.id, "status": _status(c), "ruling": c.ruling}


@router.delete("/{cid}")
def withdraw(cid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Take a field back from the extractor before they answer."""
    _need_lead(user)
    c = db.query(AuditChallenge).filter(AuditChallenge.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found.")
    _src(db, user, c.source_id)
    if c.stance or c.ruling:
        raise HTTPException(status_code=409, detail="The extractor has already answered this one.")
    db.delete(c)
    db.commit()
    return {"ok": True}
