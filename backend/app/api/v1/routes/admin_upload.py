"""Admin uploads: draft and reference copies, sending a draft for review, and loading a whole batch zip at once."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.v1.routes import sources as S
from app.api.v1.routes.enhancements import _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import SchemaVersion, Source, SourceStatus, User
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
