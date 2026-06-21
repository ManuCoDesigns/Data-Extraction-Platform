"""
Sources API — the Kanban-tracked dataset workflow.

A Source is one tracked dataset within a project: it has a schema, an
optional source website, an assigned extractor, an assigned reviewer, and
moves through a status pipeline as work happens (see SourceStatus enum).

Upload flow (synchronous, no Celery dependency):
  1. Extractor uploads a CSV/Excel/JSON file of already-extracted rows
  2. Each row is mapped onto the schema's fields and validated structurally
  3. Records are created with is_schema_valid + validation_errors set
  4. Source status moves to NEEDS_FIXES (if any invalid) or READY_FOR_REVIEW

Re-uploading replaces the source's current record set (simple, predictable —
no row-level merge/dedup in this version). Individual records can also be
fixed inline via PATCH without a full re-upload.
"""
import io, json, math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import pandas as pd

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.all_models import (
    Source, SourceStatus, Project, ProjectMember, User, Schema, SchemaVersion,
    ExtractionJob, ExtractedRecord, JobStatus, SourceType as FileSourceType,
    ExtractionConfidence, ReviewStatus, AuditLog, AuditAction, Notification,
)
from app.schemas.api_schemas import (
    SourceCreate, SourceUpdate, SourceOut, SourceUploadSummary,
    SourceRecordFix, SourceRecordReview, RecordOut, PaginatedResponse,
)
from app.services.schema_validator import validate_record, map_row_to_fields

router = APIRouter(prefix="/sources", tags=["sources"])

ALLOWED_UPLOAD_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json"}


# ─── Permission helpers ──────────────────────────────────────────────────────

def _project_role(user: User, project: Project) -> str | None:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return "org_admin"
    m = next((m for m in project.members if m.user_id == user.id), None)
    return m.role.value if m else None


def _can_access(user: User, project: Project) -> bool:
    return _project_role(user, project) is not None


def _is_project_admin(user: User, project: Project) -> bool:
    return _project_role(user, project) in ("org_admin", "project_admin")


def _can_manage_source(user: User, source: Source) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return _is_project_admin(user, source.project)


def _is_assigned_extractor(user: User, source: Source) -> bool:
    return source.assigned_extractor_id == user.id or _can_manage_source(user, source)


def _is_assigned_reviewer(user: User, source: Source) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "qa_lead" in user_roles:
        return True
    return source.assigned_reviewer_id == user.id or _can_manage_source(user, source)


# ─── Serialization ───────────────────────────────────────────────────────────

def _serialize_source(s: Source) -> SourceOut:
    return SourceOut(
        id=s.id, project_id=s.project_id, schema_id=s.schema_id,
        schema_name=s.schema.name if s.schema else None,
        name=s.name, description=s.description, website_url=s.website_url,
        status=s.status.value,
        assigned_extractor_id=s.assigned_extractor_id,
        assigned_extractor_name=s.extractor.full_name if s.extractor else None,
        assigned_reviewer_id=s.assigned_reviewer_id,
        assigned_reviewer_name=s.reviewer.full_name if s.reviewer else None,
        total_records=s.total_records or 0, valid_records=s.valid_records or 0,
        invalid_records=s.invalid_records or 0, approved_records=s.approved_records or 0,
        notes=s.notes, created_at=s.created_at, updated_at=s.updated_at,
        extraction_started_at=s.extraction_started_at,
        extraction_completed_at=s.extraction_completed_at,
        review_started_at=s.review_started_at, review_completed_at=s.review_completed_at,
        approved_at=s.approved_at, created_by=s.created_by,
    )


def _serialize_record(r: ExtractedRecord) -> RecordOut:
    return RecordOut(
        id=r.id, job_id=r.job_id, schema_version=r.schema_version,
        extraction_confidence=r.extraction_confidence.value,
        pipeline_warnings=r.pipeline_warnings or [],
        is_schema_valid=r.is_schema_valid, validation_errors=r.validation_errors or [],
        review_status=r.review_status.value, review_note=r.review_note,
        reviewed_by=r.reviewed_by, reviewed_at=r.reviewed_at,
        llm_verdict=r.llm_verdict.value if r.llm_verdict else None,
        llm_confidence=r.llm_confidence, llm_field_flags=r.llm_field_flags or [],
        llm_reason=r.llm_reason, llm_skipped=r.llm_skipped,
        extracted_fields=r.extracted_fields or {}, raw_text=r.raw_text or "",
        is_submitted=r.is_submitted, canonical_name=r.canonical_name,
        created_at=r.created_at,
    )


def _get_source_or_404(source_id: str, db: Session) -> Source:
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


def _recompute_counts(source: Source, db: Session):
    records = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractionJob.source_id == source.id
    ).all()
    source.total_records = len(records)
    source.valid_records = sum(1 for r in records if r.is_schema_valid)
    source.invalid_records = source.total_records - source.valid_records
    source.approved_records = sum(1 for r in records if r.review_status == ReviewStatus.APPROVED)


# ─── CRUD ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[SourceOut])
def list_sources(
    project_id: str = Query(...),
    status: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(Source).filter(Source.project_id == project_id)
    if status:
        try:
            q = q.filter(Source.status == SourceStatus(status))
        except ValueError:
            pass
    sources = q.order_by(Source.created_at.desc()).all()
    return [_serialize_source(s) for s in sources]


@router.post("", response_model=SourceOut, status_code=201)
def create_source(
    payload: SourceCreate,
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _is_project_admin(current_user, project):
        raise HTTPException(status_code=403, detail="Only project admins can create sources")

    schema = db.query(Schema).filter(Schema.id == payload.schema_id, Schema.project_id == project_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found in this project")
    if not db.query(SchemaVersion).filter(SchemaVersion.schema_id == schema.id).first():
        raise HTTPException(status_code=422, detail="Schema has no versions — add fields first")

    source = Source(
        project_id=project_id, schema_id=payload.schema_id, name=payload.name,
        description=payload.description, website_url=payload.website_url,
        assigned_extractor_id=payload.assigned_extractor_id,
        assigned_reviewer_id=payload.assigned_reviewer_id,
        status=SourceStatus.EXTRACTING if payload.assigned_extractor_id else SourceStatus.NOT_STARTED,
        created_by=current_user.id,
    )
    db.add(source)
    db.flush()
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.SOURCE_CREATED, after_value={"name": payload.name},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


@router.get("/{source_id}", response_model=SourceOut)
def get_source(source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    source = _get_source_or_404(source_id, db)
    if not _can_access(current_user, source.project):
        raise HTTPException(status_code=403, detail="Access denied")
    return _serialize_source(source)


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(
    source_id: str, payload: SourceUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _can_manage_source(current_user, source):
        raise HTTPException(status_code=403, detail="Only project admins can edit sources")

    before_status = source.status.value
    if payload.name is not None:
        source.name = payload.name
    if payload.description is not None:
        source.description = payload.description
    if payload.website_url is not None:
        source.website_url = payload.website_url
    if payload.notes is not None:
        source.notes = payload.notes

    if payload.assigned_extractor_id is not None:
        source.assigned_extractor_id = payload.assigned_extractor_id or None
        if source.status == SourceStatus.NOT_STARTED and source.assigned_extractor_id:
            source.status = SourceStatus.EXTRACTING
            source.extraction_started_at = datetime.now(timezone.utc)
    if payload.assigned_reviewer_id is not None:
        source.assigned_reviewer_id = payload.assigned_reviewer_id or None

    if payload.status is not None:
        try:
            new_status = SourceStatus(payload.status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {payload.status}")
        source.status = new_status
        if new_status == SourceStatus.IN_REVIEW and not source.review_started_at:
            source.review_started_at = datetime.now(timezone.utc)
        if new_status == SourceStatus.APPROVED:
            source.approved_at = datetime.now(timezone.utc)
            source.review_completed_at = source.review_completed_at or datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        before_value={"status": before_status}, after_value={"status": source.status.value},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


# ─── Upload + validate ───────────────────────────────────────────────────────

@router.post("/{source_id}/upload", response_model=SourceUploadSummary)
async def upload_to_source(
    source_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor or a project admin can upload to this source")

    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}. Use CSV, XLSX, or JSON.")

    content = await file.read()
    rows = _parse_rows(content, ext, file.filename)
    if not rows:
        raise HTTPException(status_code=422, detail="No rows found in the uploaded file")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    if not schema_ver:
        raise HTTPException(status_code=422, detail="This source's schema has no versions defined")

    schema_fields = schema_ver.definition.get("fields", [])

    # Re-upload replaces the current record set for this source
    old_job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    if old_job_ids:
        db.query(ExtractedRecord).filter(ExtractedRecord.job_id.in_(old_job_ids)).delete(synchronize_session=False)

    file_ext_type = {".csv": FileSourceType.CSV, ".xlsx": FileSourceType.EXCEL,
                      ".xls": FileSourceType.EXCEL, ".json": FileSourceType.CSV}[ext]

    job = ExtractionJob(
        project_id=source.project_id, source_id=source_id,
        schema_id=source.schema_id, schema_version=schema_ver.version,
        name=f"{source.name} — upload {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        source_file_name=file.filename, source_file_size_bytes=len(content),
        source_type=file_ext_type, status=JobStatus.READY_FOR_REVIEW,
        total_raw_records=len(rows), total_extracted=len(rows),
        created_by=current_user.id,
    )
    db.add(job)
    db.flush()

    valid_count = 0
    for row in rows:
        mapped = map_row_to_fields(row, schema_fields)
        is_valid, errors = validate_record(mapped, schema_fields)
        if is_valid:
            valid_count += 1
        confidence = ExtractionConfidence.HIGH if is_valid else ExtractionConfidence.FLAGGED
        record = ExtractedRecord(
            job_id=job.id, schema_version=schema_ver.version,
            extraction_confidence=confidence, is_schema_valid=is_valid,
            validation_errors=errors, review_status=ReviewStatus.PENDING,
            extracted_fields=mapped, raw_text=json.dumps(row, ensure_ascii=False, default=str),
            canonical_name=str(mapped.get("canonical_name") or mapped.get("name") or "")[:512] or None,
        )
        db.add(record)

    invalid_count = len(rows) - valid_count
    source.status = SourceStatus.NEEDS_FIXES if invalid_count > 0 else SourceStatus.READY_FOR_REVIEW
    if not source.extraction_started_at:
        source.extraction_started_at = datetime.now(timezone.utc)
    if invalid_count == 0:
        source.extraction_completed_at = datetime.now(timezone.utc)

    db.flush()
    _recompute_counts(source, db)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_DATA_UPLOADED,
        after_value={"file": file.filename, "rows": len(rows), "valid": valid_count, "invalid": invalid_count},
    ))
    db.commit()

    return SourceUploadSummary(total_rows=len(rows), valid_rows=valid_count, invalid_rows=invalid_count, job_id=job.id)


def _parse_rows(content: bytes, ext: str, filename: str) -> list[dict]:
    if ext == ".csv":
        df = pd.read_csv(io.BytesIO(content))
        return df.where(pd.notnull(df), None).to_dict("records")
    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(io.BytesIO(content))
        return df.where(pd.notnull(df), None).to_dict("records")
    if ext == ".json":
        data = json.loads(content.decode("utf-8"))
        if isinstance(data, list):
            return data
        for key in ("items", "records", "data", "rows"):
            if isinstance(data, dict) and key in data and isinstance(data[key], list):
                return data[key]
        if isinstance(data, dict):
            return [data]
    return []


# ─── Records (fix + review) ──────────────────────────────────────────────────

@router.get("/{source_id}/records", response_model=PaginatedResponse)
def list_source_records(
    source_id: str,
    validity: str = Query(None, description="valid | invalid"),
    review_status: str = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _can_access(current_user, source.project):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(ExtractedRecord).join(ExtractionJob).filter(ExtractionJob.source_id == source_id)
    if validity == "valid":
        q = q.filter(ExtractedRecord.is_schema_valid == True)
    elif validity == "invalid":
        q = q.filter(ExtractedRecord.is_schema_valid == False)
    if review_status:
        try:
            q = q.filter(ExtractedRecord.review_status == ReviewStatus(review_status))
        except ValueError:
            pass

    total = q.count()
    records = q.order_by(ExtractedRecord.created_at).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize_record(r) for r in records],
        total=total, page=page, page_size=page_size, pages=math.ceil(total / page_size) or 1,
    )


@router.patch("/{source_id}/records/{record_id}", response_model=RecordOut)
def fix_record(
    source_id: str, record_id: str, payload: SourceRecordFix,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor or a project admin can fix records")

    record = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractedRecord.id == record_id, ExtractionJob.source_id == source_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found in this source")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    schema_fields = schema_ver.definition.get("fields", []) if schema_ver else []

    before = dict(record.extracted_fields or {})
    record.extracted_fields = {**(record.extracted_fields or {}), **payload.extracted_fields}
    is_valid, errors = validate_record(record.extracted_fields, schema_fields)
    record.is_schema_valid = is_valid
    record.validation_errors = errors
    record.extraction_confidence = ExtractionConfidence.HIGH if is_valid else ExtractionConfidence.FLAGGED
    if record.review_status == ReviewStatus.REJECTED and is_valid:
        record.review_status = ReviewStatus.PENDING  # re-submit for review after a fix

    db.flush()
    _recompute_counts(source, db)
    if source.invalid_records == 0 and source.status == SourceStatus.NEEDS_FIXES:
        source.status = SourceStatus.READY_FOR_REVIEW
        source.extraction_completed_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_RECORD_FIXED,
        before_value={"fields": before}, after_value={"fields": record.extracted_fields},
    ))
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.post("/{source_id}/records/{record_id}/review", response_model=RecordOut)
def review_source_record(
    source_id: str, record_id: str, payload: SourceRecordReview,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_reviewer(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned reviewer or a project admin can review records")

    record = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractedRecord.id == record_id, ExtractionJob.source_id == source_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found in this source")

    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="action must be 'approve' or 'reject'")

    record.review_status = ReviewStatus.APPROVED if payload.action == "approve" else ReviewStatus.REJECTED
    record.review_note = payload.note
    record.reviewed_by = current_user.id
    record.reviewed_at = datetime.now(timezone.utc)

    if source.status not in (SourceStatus.IN_REVIEW,):
        source.status = SourceStatus.IN_REVIEW
        source.review_started_at = source.review_started_at or datetime.now(timezone.utc)

    if payload.action == "reject":
        source.status = SourceStatus.CHANGES_REQUESTED
        if source.assigned_extractor_id:
            db.add(Notification(
                user_id=source.assigned_extractor_id,
                title=f"Record sent back in '{source.name}'",
                body=payload.note or "A reviewer sent a record back for fixes.",
                link=f"/sources/{source.id}",
            ))

    db.flush()
    _recompute_counts(source, db)
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.post("/{source_id}/approve", response_model=SourceOut)
def approve_source(
    source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Final approval — all records must be approved first. Skips the (fast-follow) LLM verification stage for now."""
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_reviewer(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned reviewer or a project admin can approve a source")

    pending_or_rejected = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractionJob.source_id == source_id,
        ExtractedRecord.review_status != ReviewStatus.APPROVED,
    ).count()
    if pending_or_rejected > 0:
        raise HTTPException(status_code=422, detail=f"{pending_or_rejected} record(s) are not yet approved")

    source.status = SourceStatus.APPROVED
    source.approved_at = datetime.now(timezone.utc)
    source.review_completed_at = source.review_completed_at or datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_APPROVED, after_value={"source_id": source_id},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


# ─── Export package ──────────────────────────────────────────────────────────

@router.get("/{source_id}/export")
def export_source(source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    source = _get_source_or_404(source_id, db)
    if not _can_manage_source(current_user, source):
        raise HTTPException(status_code=403, detail="Only project admins can export a source")
    if source.status != SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail="Source must be approved before export")

    records = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractionJob.source_id == source_id, ExtractedRecord.review_status == ReviewStatus.APPROVED
    ).all()
    data = [r.extracted_fields for r in records]

    duration = None
    if source.extraction_started_at and source.approved_at:
        delta = source.approved_at - source.extraction_started_at
        hours = delta.total_seconds() / 3600
        duration = f"{hours:.1f} hours" if hours < 48 else f"{delta.days} days"

    cover_sheet = f"""# {source.name} — Data Export Cover Sheet

## Source Information
- **Source name:** {source.name}
- **Description:** {source.description or '(none)'}
- **Website:** {source.website_url or '(none)'}
- **Schema:** {source.schema.name if source.schema else 'Unknown'}
- **Project:** {source.project.name if source.project else 'Unknown'}

## Extraction Summary
- **Total rows uploaded:** {source.total_records}
- **Passed schema validation:** {source.valid_records}
- **Failed validation (fixed before approval):** {source.invalid_records}
- **Final approved records:** {len(records)}

## Team
- **Extractor:** {source.extractor.full_name if source.extractor else 'Unassigned'}
- **Reviewer:** {source.reviewer.full_name if source.reviewer else 'Unassigned'}

## Timeline
- **Extraction started:** {source.extraction_started_at.strftime('%Y-%m-%d %H:%M UTC') if source.extraction_started_at else 'N/A'}
- **Extraction completed:** {source.extraction_completed_at.strftime('%Y-%m-%d %H:%M UTC') if source.extraction_completed_at else 'N/A'}
- **Review started:** {source.review_started_at.strftime('%Y-%m-%d %H:%M UTC') if source.review_started_at else 'N/A'}
- **Approved:** {source.approved_at.strftime('%Y-%m-%d %H:%M UTC') if source.approved_at else 'N/A'}
- **Total time, start to approval:** {duration or 'N/A'}

## Notes / Assumptions
{source.notes or '(none recorded)'}

---
Generated by Xtrium DataOps on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
"""

    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(data, indent=2, ensure_ascii=False, default=str))
        zf.writestr("COVER_SHEET.md", cover_sheet)

        # Include the most recent raw uploaded file, if retrievable
        latest_job = db.query(ExtractionJob).filter(
            ExtractionJob.source_id == source_id
        ).order_by(ExtractionJob.created_at.desc()).first()
        if latest_job and latest_job.source_file_url:
            try:
                from app.services.storage import storage
                raw_bytes = storage.read(latest_job.source_file_url)
                raw_name = latest_job.source_file_name or "raw_upload"
                zf.writestr(f"raw_{raw_name}", raw_bytes)
            except Exception:
                pass  # raw file not retrievable — JSON + cover sheet still included

    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in source.name)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_export.zip"'},
    )


# ─── Performance analytics ───────────────────────────────────────────────────

@router.get("/stats/performance")
def performance_stats(
    project_id: str = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    if not user_roles.intersection({"org_admin", "project_admin", "qa_lead"}):
        raise HTTPException(status_code=403, detail="Admin or QA access required")

    q = db.query(Source)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    sources = q.all()

    by_extractor: dict[str, dict] = {}
    by_reviewer: dict[str, dict] = {}

    for s in sources:
        if s.assigned_extractor_id:
            stats = by_extractor.setdefault(s.assigned_extractor_id, {
                "user_id": s.assigned_extractor_id,
                "name": s.extractor.full_name if s.extractor else "Unknown",
                "sources_count": 0, "approved_count": 0, "total_hours": 0.0, "samples": 0,
            })
            stats["sources_count"] += 1
            if s.status == SourceStatus.APPROVED:
                stats["approved_count"] += 1
            if s.extraction_started_at and s.extraction_completed_at:
                hours = (s.extraction_completed_at - s.extraction_started_at).total_seconds() / 3600
                stats["total_hours"] += hours
                stats["samples"] += 1

        if s.assigned_reviewer_id:
            stats = by_reviewer.setdefault(s.assigned_reviewer_id, {
                "user_id": s.assigned_reviewer_id,
                "name": s.reviewer.full_name if s.reviewer else "Unknown",
                "sources_count": 0, "approved_count": 0, "total_hours": 0.0, "samples": 0,
            })
            stats["sources_count"] += 1
            if s.status == SourceStatus.APPROVED:
                stats["approved_count"] += 1
            if s.review_started_at and s.review_completed_at:
                hours = (s.review_completed_at - s.review_started_at).total_seconds() / 3600
                stats["total_hours"] += hours
                stats["samples"] += 1

    def finalize(d: dict) -> list[dict]:
        out = []
        for v in d.values():
            avg = v["total_hours"] / v["samples"] if v["samples"] else None
            out.append({**v, "avg_hours_per_source": round(avg, 1) if avg is not None else None})
        return out

    return {"extractors": finalize(by_extractor), "reviewers": finalize(by_reviewer)}
