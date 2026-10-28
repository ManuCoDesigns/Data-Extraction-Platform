"""Assign SOPs to sources that were not pulled from Xtrium (for example, sources uploaded from a sheet).
The platform suggests the SOP from the source's name, website, category and type; a lead confirms before anything is saved."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _need_lead, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import Source, User
from app.services import sop_library as lib

router = APIRouter(prefix="/sop-assign", tags=["sop-assign"])


@router.get("/library")
def library(user: User = Depends(get_current_user)):
    _need_lead(user)
    return {"version": lib.LIBRARY_VERSION, "sops": [{"code": c, "title": t, "use_when": u} for c, (t, u) in lib.SOPS.items()]}


def _row(s: Source) -> dict:
    saved = s.xtrium_sop
    cur = None
    if lib.has_own_sop(saved):
        meta = saved.get("meta") or {}
        cur = {"code": meta.get("sop_code") or saved["sop"].get("sop_code"), "origin": "library" if lib.is_library(saved) else "xtrium"}
    sug = lib.classify(s.name, s.website_url, s.category, s.type, s.description)
    return {"source_id": s.id, "project_id": s.project_id, "name": s.name, "url": s.website_url, "category": s.category, "type": s.type,
            "from_xtrium": bool(s.external_ref_id), "current": cur, "suggested": sug}


@router.get("/suggestions")
def suggestions(project_id: str | None = None, scope: str = "missing", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """scope=missing: sources with no SOP. scope=assigned: sources whose SOP came from this library (so it can be changed). scope=all: both."""
    _need_lead(user)
    rows = []
    for s in _visible_sources(db, user, project_id).order_by(Source.name).all():
        saved = s.xtrium_sop
        own = lib.has_own_sop(saved)
        if own and not lib.is_library(saved):
            continue  # Xtrium is the authority: its SOP is never replaced here
        if scope == "missing" and own:
            continue
        if scope == "assigned" and not own:
            continue
        rows.append(_row(s))
    by_conf = {"high": 0, "medium": 0, "low": 0}
    for r in rows:
        by_conf[r["suggested"]["confidence"]] += 1
    by_sop: dict = {}
    for r in rows:
        by_sop[r["suggested"]["code"]] = by_sop.get(r["suggested"]["code"], 0) + 1
    return {"items": rows, "total": len(rows), "by_confidence": by_conf,
            "by_sop": [{"code": c, "title": lib.SOPS[c][0], "count": n} for c, n in sorted(by_sop.items(), key=lambda x: -x[1])]}


class Pick(BaseModel):
    source_id: str
    sop_code: str


class ApplyBody(BaseModel):
    items: list[Pick]


@router.post("/apply")
def apply(body: ApplyBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    if not body.items:
        raise HTTPException(status_code=422, detail="Nothing selected.")
    ids = [i.source_id for i in body.items]
    srcs = {s.id: s for s in _visible_sources(db, user).filter(Source.id.in_(ids)).all()}
    done, skipped = 0, []
    for it in body.items:
        s = srcs.get(it.source_id)
        if not s:
            skipped.append({"source_id": it.source_id, "why": "Source not found."}); continue
        if it.sop_code not in lib.SOPS:
            skipped.append({"source_id": it.source_id, "why": f"Unknown SOP {it.sop_code}."}); continue
        if lib.has_own_sop(s.xtrium_sop) and not lib.is_library(s.xtrium_sop):
            skipped.append({"source_id": it.source_id, "name": s.name, "why": "Xtrium's own SOP is already saved on this source."}); continue
        sug = lib.classify(s.name, s.website_url, s.category, s.type, s.description)
        agrees = sug["code"] == it.sop_code
        s.xtrium_sop = lib.build_saved(it.sop_code, user.id, sug["confidence"] if agrees else "confirmed", sug["reason"] if agrees else "Chosen by a lead.")
        done += 1
    db.commit()
    return {"applied": done, "skipped": skipped}


@router.delete("/{source_id}")
def clear(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Remove a library-assigned SOP (never Xtrium's own)."""
    _need_lead(user)
    s = _visible_sources(db, user).filter(Source.id == source_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Source not found.")
    if not lib.is_library(s.xtrium_sop):
        raise HTTPException(status_code=409, detail="This SOP did not come from the library, so it is not removed here.")
    s.xtrium_sop = None
    db.commit()
    return {"ok": True}
