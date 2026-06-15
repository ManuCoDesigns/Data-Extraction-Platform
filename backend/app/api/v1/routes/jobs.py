from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
import math, os, hashlib
from app.db.session import get_db
from app.core.security import get_current_user, require_roles
from app.models.all_models import (
    ExtractionJob, JobStateHistory, JobStatus, SourceType, Project,
    ProjectMember, User, AuditLog, AuditAction, Schema, SchemaVersion
)
from app.schemas.api_schemas import JobOut, JobStateHistoryOut, PaginatedResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])

ALLOWED_EXTENSIONS = {".pdf", ".csv", ".xlsx", ".xls"}


def _serialize(job: ExtractionJob) -> JobOut:
    return JobOut(
        id=job.id,
        project_id=job.project_id,
        schema_id=job.schema_id,
        schema_version=job.schema_version,
        name=job.name,
        source_file_name=job.source_file_name,
        source_file_size_bytes=job.source_file_size_bytes,
        source_type=job.source_type.value,
        status=job.status.value,
        total_raw_records=job.total_raw_records,
        total_extracted=job.total_extracted,
        total_approved=job.total_approved,
        total_rejected=job.total_rejected,
        total_submitted=job.total_submitted,
        parse_warnings=job.parse_warnings or [],
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _can_access_project(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(m.user_id == user.id for m in project.members)


def _transition(job: ExtractionJob, new_status: JobStatus, db: Session, triggered_by: str = "system", error: str = None):
    last = db.query(JobStateHistory).filter(
        JobStateHistory.job_id == job.id,
        JobStateHistory.exited_at == None,
    ).first()
    if last:
        from datetime import datetime, timezone
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
        pages=math.ceil(total / page_size),
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
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}")

    source_type_map = {".pdf": SourceType.PDF, ".csv": SourceType.CSV, ".xlsx": SourceType.EXCEL, ".xls": SourceType.EXCEL}
    source_type = source_type_map[ext]

    schema = db.query(Schema).filter(Schema.id == schema_id, Schema.project_id == project_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found in this project")

    latest_version = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    if not latest_version:
        raise HTTPException(status_code=422, detail="Schema has no versions defined")

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Save to local temp storage (in production, push to S3)
    upload_dir = "/tmp/xtrium_uploads"
    os.makedirs(upload_dir, exist_ok=True)
    file_hash = hashlib.md5(content).hexdigest()[:8]
    saved_path = f"{upload_dir}/{file_hash}_{file.filename}"
    with open(saved_path, "wb") as f:
        f.write(content)

    job = ExtractionJob(
        project_id=project_id,
        schema_id=schema_id,
        schema_version=latest_version.version,
        name=job_name,
        source_file_name=file.filename,
        source_file_size_bytes=file_size,
        source_file_url=saved_path,
        source_type=source_type,
        status=JobStatus.QUEUED,
        created_by=current_user.id,
    )
    db.add(job)
    db.flush()

    db.add(JobStateHistory(job_id=job.id, state=JobStatus.QUEUED, triggered_by=f"user:{current_user.id}"))
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id, job_id=job.id,
        action=AuditAction.JOB_CREATED,
        after_value={"name": job_name, "file": file.filename, "schema_id": schema_id},
    ))
    db.commit()
    db.refresh(job)

    # Trigger async extraction
    try:
        from app.tasks.extraction import run_extraction
        run_extraction.delay(job.id, saved_path, schema_id, latest_version.version)
    except Exception:
        pass  # Celery may not be running in dev

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
