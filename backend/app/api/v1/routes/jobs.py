"""
Jobs API — upload source files, trigger extraction, poll status.

File storage: uses app.services.storage (local disk in dev, S3/R2 in prod).
The storage_key (not a local path) is stored on the job and passed to Celery,
so the worker can retrieve the file regardless of which container it runs in.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
import math, os
from app.db.session import get_db
from app.core.security import get_current_user
from app.services.storage import storage, new_storage_key
from app.models.all_models import (
    ExtractionJob, JobStateHistory, JobStatus, SourceType, Project,
    ProjectMember, User, AuditLog, AuditAction, Schema, SchemaVersion
)
from app.schemas.api_schemas import JobOut, JobStateHistoryOut, PaginatedResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])

ALLOWED_EXTENSIONS = {".pdf", ".csv", ".xlsx", ".xls"}
SOURCE_TYPE_MAP = {".pdf": SourceType.PDF, ".csv": SourceType.CSV, ".xlsx": SourceType.EXCEL, ".xls": SourceType.EXCEL}


def _serialize(job: ExtractionJob) -> JobOut:
    return JobOut(
        id=job.id, project_id=job.project_id,
        schema_id=job.schema_id, schema_version=job.schema_version,
        name=job.name, source_file_name=job.source_file_name,
        source_file_size_bytes=job.source_file_size_bytes,
        source_type=job.source_type.value, status=job.status.value,
        total_raw_records=job.total_raw_records,
        total_extracted=job.total_extracted, total_approved=job.total_approved,
        total_rejected=job.total_rejected, total_submitted=job.total_submitted,
        parse_warnings=job.parse_warnings or [],
        error_message=job.error_message,
        created_at=job.created_at, updated_at=job.updated_at,
    )


def _can_access_project(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(m.user_id == user.id for m in project.members)


def _transition(job, new_status, db, triggered_by="system", error=None):
    from datetime import datetime, timezone
    last = db.query(JobStateHistory).filter(
        JobStateHistory.job_id == job.id, JobStateHistory.exited_at == None
    ).first()
    if last:
        last.exited_at = datetime.now(timezone.utc)
    db.add(JobStateHistory(job_id=job.id, state=new_status, triggered_by=triggered_by, error=error))
    job.status = new_status
    db.flush()


@router.get("", response_model=PaginatedResponse)
def list_jobs(
    project_id: str = Query(None),
    status: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    q = db.query(ExtractionJob)
    if "org_admin" not in user_roles:
        q = q.join(Project).join(ProjectMember).filter(ProjectMember.user_id == current_user.id)
    if project_id:
        q = q.filter(ExtractionJob.project_id == project_id)
    if status:
        try:
            q = q.filter(ExtractionJob.status == JobStatus(status))
        except ValueError:
            pass
    total = q.count()
    jobs = q.order_by(ExtractionJob.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize(j) for j in jobs],
        total=total, page=page, page_size=page_size,
        pages=math.ceil(total / page_size) or 1,
    )


@router.post("/{project_id}/upload", response_model=JobOut, status_code=201)
async def create_job_with_upload(
    project_id: str,
    file: UploadFile = File(...),
    job_name: str = Form(...),
    schema_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}. Allowed: PDF, CSV, XLSX, XLS")

    schema = db.query(Schema).filter(Schema.id == schema_id, Schema.project_id == project_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found in this project")

    latest_version = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    if not latest_version:
        raise HTTPException(status_code=422, detail="Schema has no versions — add fields to the schema first")

    # Read file and upload to storage (local in dev, S3/R2 in prod)
    content = await file.read()
    storage_key = new_storage_key(f"jobs/{project_id}/source", file.filename)
    try:
        storage.upload(content, storage_key, content_type=file.content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    job = ExtractionJob(
        project_id=project_id,
        schema_id=schema_id,
        schema_version=latest_version.version,
        name=job_name,
        source_file_name=file.filename,
        source_file_size_bytes=len(content),
        source_file_url=storage_key,  # Now a storage key, not a local path
        source_type=SOURCE_TYPE_MAP[ext],
        status=JobStatus.QUEUED,
        created_by=current_user.id,
    )
    db.add(job)
    db.flush()

    db.add(JobStateHistory(job_id=job.id, state=JobStatus.QUEUED, triggered_by=f"user:{current_user.id}"))
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id, job_id=job.id,
        action=AuditAction.JOB_CREATED,
        after_value={"name": job_name, "file": file.filename, "schema_id": schema_id, "storage_key": storage_key},
    ))
    db.commit()
    db.refresh(job)

    # Dispatch to Celery — pass storage_key (not a local path) so any worker can retrieve it
    try:
        from app.tasks.extraction import run_extraction
        run_extraction.delay(job.id, storage_key, schema_id, latest_version.version)
    except Exception as e:
        # Celery may not be running in dev — job stays QUEUED, can be retried
        job.error_message = f"Worker unavailable: {str(e)}"
        db.commit()

    return _serialize(job)


@router.post("/{job_id}/retry", response_model=JobOut)
def retry_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retry a failed job — re-dispatches the extraction task using the already-stored file."""
    job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    failed_states = {"parse_failed", "extraction_failed", "llm_failed", "queued"}
    if job.status.value not in failed_states:
        raise HTTPException(status_code=422, detail=f"Only failed or queued jobs can be retried (current status: {job.status.value})")

    if not job.source_file_url:
        raise HTTPException(status_code=422, detail="No source file stored — re-upload the file to create a new job")

    _transition(job, JobStatus.QUEUED, db, triggered_by=f"user:{current_user.id}")
    job.error_message = None
    job.total_extracted = 0
    job.total_approved = 0
    job.total_rejected = 0
    db.commit()

    try:
        from app.tasks.extraction import run_extraction
        run_extraction.delay(job.id, job.source_file_url, job.schema_id, job.schema_version)
    except Exception as e:
        job.error_message = f"Worker unavailable: {str(e)}"
        db.commit()

    db.refresh(job)
    return _serialize(job)


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize(job)


@router.get("/{job_id}/history", response_model=list[JobStateHistoryOut])
def get_job_history(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    history = db.query(JobStateHistory).filter(
        JobStateHistory.job_id == job_id
    ).order_by(JobStateHistory.entered_at).all()
    return [
        JobStateHistoryOut(
            id=h.id, state=h.state.value, entered_at=h.entered_at,
            exited_at=h.exited_at, triggered_by=h.triggered_by, error=h.error,
        ) for h in history
    ]


@router.delete("/{job_id}", status_code=204)
def delete_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a job and all its records. Only allowed when job is not actively processing."""
    from app.models.all_models import ExtractedRecord
    job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    user_roles = {r.role.value for r in current_user.roles}
    if "org_admin" not in user_roles:
        if not any(m.user_id == current_user.id for m in job.project.members):
            raise HTTPException(status_code=403, detail="Access denied")
    active = {"queued", "parsing", "extracting", "llm_review"}
    if job.status.value in active:
        raise HTTPException(status_code=422, detail=f"Cannot delete a job that is currently {job.status.value}")
    db.query(ExtractedRecord).filter(ExtractedRecord.job_id == job_id).delete()
    db.query(JobStateHistory).filter(JobStateHistory.job_id == job_id).delete()
    db.delete(job)
    db.commit()
