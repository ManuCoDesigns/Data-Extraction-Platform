"""Admin uploads: draft and reference copies, sending a draft for review, and loading a whole batch zip at once."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes import sources as S
from app.api.v1.routes.enhancements import _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import AdminCopy, SchemaVersion, Source, SourceStatus, User
from app.services import admin_upload as au
from app.services import record_locks as rl
from app.services import versions as ver

router = APIRouter(prefix="/admin-upload", tags=["admin-upload"])


def _admin(user):
    if not rl.is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can load a batch.")


@router.post("/batch/preview")
async def batch_preview(file: UploadFile = File(...), project_id: str | None = Form(None),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Match each record file in a zip to a source, and say what loading it would do. Nothing is saved."""
    _admin(user)
    files = au.read_zip(await file.read())
    sources = _visible_sources(db, user, project_id).order_by(Source.name).all()
    return {"files": au.plan_batch(db, files, sources), "sources": [{"id": s.id, "name": s.name, "status": s.status.value} for s in sources]}


@router.post("/batch/apply")
async def batch_apply(file: UploadFile = File(...), plan: str = Form(...), project_id: str | None = Form(None),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Load the chosen files. plan is a JSON list of {file, source_id, mode} where mode is draft or reference. Nothing here becomes final."""
    _admin(user)
    try:
        chosen = json.loads(plan)
    except Exception:
        raise HTTPException(status_code=422, detail="The plan is not valid JSON.")
    files = {f["file"]: f for f in au.read_zip(await file.read())}
    visible = {s.id: s for s in _visible_sources(db, user, project_id).all()}
    batch_id, label = str(uuid.uuid4()), f"{file.filename or 'batch'}"
    results = []
    for c in chosen:
        name, sid, mode = c.get("file"), c.get("source_id"), (c.get("mode") or "draft").lower()
        res = {"file": name, "source_id": sid, "mode": mode, "ok": False}
        results.append(res)
        f, s = files.get(name), visible.get(sid)
        if not f or f.get("error"):
            res["error"] = "That file is not in the zip or could not be read."
            continue
        if not s:
            res["error"] = "Choose a source you can see."
            continue
        if mode not in ("draft", "reference"):
            res["error"] = "Mode must be draft or reference."
            continue
        res["source_name"] = s.name
        try:
            au.check(s, mode)
            if mode == "draft":
                ver.gate(db, s, user, None)            # admins are never blocked; the override is logged by the upload
            sv = db.query(SchemaVersion).filter(SchemaVersion.schema_id == s.schema_id).order_by(SchemaVersion.version.desc()).first() if s.schema_id else None
            fields = sv.definition.get("fields", []) if sv and sv.definition else []
            if mode == "reference":
                summary = au.store_reference(db, s, user, f["rows"], ".json", "structured", [], 1, name.split("/")[-1], fields, batch_id=batch_id, batch_label=label)
            else:
                summary = S._finalize_upload(
                    source=s, source_id=s.id, rows=f["rows"], ext=".json", extraction_method="structured", file_breakdown=[], files_processed=1,
                    display_filename=name.split("/")[-1], content_len=len(f["raw"]), schema_ver=sv, schema_fields=fields, current_user=user, db=db,
                    raw_entries=[{"relative_path": name.split("/")[-1], "is_directory": False, "content": f["raw"]}],
                    replace_reason=None, admin_mode=mode)
            res.update(ok=True, records=summary.total_rows, valid=summary.valid_rows, invalid=summary.invalid_rows)
        except HTTPException as e:
            db.rollback()
            res["error"] = str(e.detail)
        except Exception as e:  # one bad file must not stop the rest
            db.rollback()
            res["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return {"results": results, "done": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"])}


def _copy(db, user, copy_id) -> AdminCopy:
    _admin(user)
    c = db.query(AdminCopy).filter(AdminCopy.id == copy_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Saved copy not found.")
    if c.project_id and c.project_id not in {s.project_id for s in _visible_sources(db, user).all()}:
        raise HTTPException(status_code=404, detail="Saved copy not found.")
    return c


class ApplyBody(BaseModel):
    mode: str = "draft"
    source_id: str | None = None


@router.get("/library")
def library(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every saved admin batch. Only admins can see this."""
    _admin(user)
    srcs = _visible_sources(db, user).all()
    return {"batches": au.library(db, srcs, {s.project_id for s in srcs})}


@router.post("/library/{batch_id}/apply")
def apply_batch(batch_id: str, body: ApplyBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Load a saved batch into the sources that exist now (matched by name), as drafts. Nothing is submitted unless mode is submit."""
    _admin(user)
    srcs = _visible_sources(db, user).all()
    by_key = {au.name_key(s.name): s for s in srcs}
    out = []
    for c in db.query(AdminCopy).filter(AdminCopy.batch_id == batch_id).all():
        s = by_key.get(c.name_key)
        res = {"copy_id": c.id, "source_name": c.source_name, "ok": False}
        out.append(res)
        if not s:
            res["error"] = "No source with this name exists now."
            continue
        try:
            res.update(au.apply_copy(db, s, user, c, body.mode), ok=True, source_id=s.id)
        except HTTPException as e:
            db.rollback()
            res["error"] = str(e.detail)
    return {"results": out, "done": sum(1 for r in out if r["ok"]), "failed": sum(1 for r in out if not r["ok"])}


@router.delete("/library/{batch_id}")
def delete_batch(batch_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _admin(user)
    n = 0
    for c in db.query(AdminCopy).filter(AdminCopy.batch_id == batch_id).all():
        _copy(db, user, c.id)
        db.delete(c)
        n += 1
    db.commit()
    return {"deleted": n}


@router.get("/copy/{copy_id}/compare")
def compare_copy(copy_id: str, source_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _copy(db, user, copy_id)
    s = S._get_source_or_404(source_id or c.source_id or "", db, user) if (source_id or c.source_id) else None
    if not s:
        raise HTTPException(status_code=404, detail="That source no longer exists.")
    return au.compare_copy(db, s, c)


@router.get("/copy/{copy_id}/download")
def download_copy(copy_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _copy(db, user, copy_id)
    body = json.dumps([r.get("fields") or {} for r in (c.records or [])], ensure_ascii=False, indent=2, default=str)
    name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in c.source_name)[:60] or "copy"
    return Response(content=body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{name}_admin_copy.json"'})


@router.post("/copy/{copy_id}/apply")
def apply_one(copy_id: str, body: ApplyBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _copy(db, user, copy_id)
    sid = body.source_id or c.source_id
    if not sid:                                  # the source was deleted and pulled again: find it by name
        sid = next((x.id for x in _visible_sources(db, user).all() if au.name_key(x.name) == c.name_key), None)
    s = S._get_source_or_404(sid, db, user) if sid else None
    if not s:
        raise HTTPException(status_code=404, detail="Choose a source to load it into.")
    return au.apply_copy(db, s, user, c, body.mode)


@router.delete("/copy/{copy_id}")
def delete_copy(copy_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _copy(db, user, copy_id)
    db.delete(c)
    db.commit()
    return {"deleted": 1}


@router.get("/source/{source_id}/copies")
def source_copies(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The saved admin copies for this source. Admin only: extractors and reviewers get nothing."""
    source = S._get_source_or_404(source_id, db, user)
    _admin(user)
    return {"copies": [au.copy_meta(c) for c in au.copies_for(db, source)]}


@router.get("/source/{source_id}/record/{record_id}")
def record_compare(source_id: str, record_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """For the final check: the admin's saved copy of this record next to what is on the source."""
    source = S._get_source_or_404(source_id, db, user)
    _admin(user)
    return au.record_diff(db, source, record_id)


@router.get("/{source_id}")
def state(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    source = S._get_source_or_404(source_id, db, user)
    return {**au.draft_state(db, source), "can_submit": S._is_assigned_extractor(user, source)}


@router.post("/{source_id}/submit")
def submit(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Send an admin draft for review. Only now does the source count as submitted."""
    source = S._get_source_or_404(source_id, db, user)
    if not S._is_assigned_extractor(user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor, project admin, or org admin can submit this source.")
    return au.submit_draft(db, source, user)
