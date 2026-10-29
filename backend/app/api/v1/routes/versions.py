"""Versions of a source's data: list, compare, download and restore. Replacing data always keeps the old version first."""
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes import sources as S
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import SchemaVersion, SourceRound, User
from app.services import record_locks as rl
from app.services import versions as ver

router = APIRouter(prefix="/versions", tags=["versions"])


class RestoreBody(BaseModel):
    reason: str | None = None


def _round(db: Session, source, round_id: str) -> SourceRound:
    rd = db.query(SourceRound).filter(SourceRound.id == round_id, SourceRound.source_id == source.id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Version not found.")
    return rd


@router.get("/{source_id}")
def list_versions(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    source = S._get_source_or_404(source_id, db, user)
    locked = rl.bulk_lock_reason(source)
    admin = rl.is_admin(user)
    block = None if admin or not locked else ver.self_replace_block(db, source)
    return {"versions": ver.listing(db, source), "records": len(ver.current_records(db, source)),
            "can_edit": S._is_assigned_extractor(user, source),
            "replace": {"locked": bool(locked), "needs_reason": bool(locked) and not admin, "blocked": block, "min_reason": ver.MIN_REASON}}


@router.get("/{source_id}/{round_id}/compare")
def compare_version(source_id: str, round_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    source = S._get_source_or_404(source_id, db, user)
    return ver.compare(db, source, _round(db, source, round_id))


@router.get("/{source_id}/{round_id}/download")
def download_version(source_id: str, round_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The records of a version as a JSON array of their fields. The file loads straight back through Upload Data."""
    source = S._get_source_or_404(source_id, db, user)
    rd = _round(db, source, round_id)
    body = json.dumps([x.get("fields") or {} for x in (rd.records or [])], ensure_ascii=False, indent=2, default=str)
    name = "".join(c if c.isalnum() or c in "-_" else "_" for c in source.name)[:60] or "source"
    return Response(content=body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{name}_version{rd.round}.json"'})


@router.post("/{source_id}/{round_id}/restore")
def restore_version(source_id: str, round_id: str, body: RestoreBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Bring a version's records back. What is there now is kept as a new version first. Reviewer comments stay with the version they were written on."""
    source = S._get_source_or_404(source_id, db, user)
    if not S._is_assigned_extractor(user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor, project admin, or org admin can restore data on this source")
    rd = _round(db, source, round_id)
    rows = [dict(x.get("fields") or {}) for x in (rd.records or [])]
    if not rows:
        raise HTTPException(status_code=422, detail="That version holds no records.")
    reason = (body.reason or "").strip() or f"Restored version {rd.round}"
    ver.gate(db, source, user, reason if body.reason else None)
    sv = db.query(SchemaVersion).filter(SchemaVersion.schema_id == source.schema_id).order_by(SchemaVersion.version.desc()).first()
    fields = sv.definition.get("fields", []) if sv and sv.definition else []
    summary = S._finalize_upload(
        source=source, source_id=source.id, rows=rows, ext=".json", extraction_method="structured", file_breakdown=[], files_processed=1,
        display_filename=f"version {rd.round} restored", content_len=0, schema_ver=sv, schema_fields=fields, current_user=user, db=db, raw_entries=None,
        replace_reason=f"Restored version {rd.round}: {reason}" if body.reason else f"Restored version {rd.round}")
    return {"restored": rd.round, "total_rows": summary.total_rows, "invalid_rows": summary.invalid_rows}
