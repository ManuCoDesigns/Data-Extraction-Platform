import hashlib, json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import io
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.all_models import (
    ExtractedRecord, ReviewStatus, SubmissionBatch, ExtractionJob,
    User, AuditLog, AuditAction, JobStatus, Project, ProjectMember
)
from app.schemas.api_schemas import SubmitRequest, SubmissionBatchOut

router = APIRouter(tags=["submission"])
stats_router = APIRouter(prefix="/stats", tags=["stats"])
notifications_router = APIRouter(prefix="/notifications", tags=["notifications"])


# ─── Submission ──────────────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/submit")
def submit_job(
    job_id: str,
    payload: SubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    q = db.query(ExtractedRecord).filter(
        ExtractedRecord.job_id == job_id,
        ExtractedRecord.review_status == ReviewStatus.APPROVED,
        ExtractedRecord.is_submitted == False,
    )
    if payload.record_ids:
        q = q.filter(ExtractedRecord.id.in_(payload.record_ids))

    records = q.all()
    if not records:
        # Check WHY — give a clear, accurate error
        already_submitted = db.query(ExtractedRecord).filter(
            ExtractedRecord.job_id == job_id,
            ExtractedRecord.is_submitted == True,
        ).count()
        total_approved = db.query(ExtractedRecord).filter(
            ExtractedRecord.job_id == job_id,
            ExtractedRecord.review_status == ReviewStatus.APPROVED,
        ).count()
        if already_submitted > 0 and already_submitted >= total_approved:
            raise HTTPException(
                status_code=422,
                detail=f"All {already_submitted} record(s) in this job have already been submitted. Use Unlock Records on the source if you need to re-submit."
            )
        raise HTTPException(
            status_code=422,
            detail="No approved records found. Approve records in the source before submitting."
        )

    # Build payload
    output = {
        "meta": {
            "job_id": job_id,
            "job_name": job.name,
            "schema_version": job.schema_version,
            "submitted_by": current_user.email,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "record_count": len(records),
        },
        "records": [r.extracted_fields for r in records],
    }

    payload_bytes = json.dumps(output, indent=2, default=str).encode()
    payload_hash = hashlib.sha256(payload_bytes).hexdigest()

    # Mark records submitted
    now = datetime.now(timezone.utc)
    for r in records:
        r.is_submitted = True
        r.submitted_at = now

    batch = SubmissionBatch(
        job_id=job_id,
        submitted_by=current_user.id,
        destination="json_download",
        record_count=len(records),
        schema_version=job.schema_version,
        payload_sha256=payload_hash,
        status="completed",
    )
    db.add(batch)

    job.total_submitted = (job.total_submitted or 0) + len(records)
    job.status = JobStatus.SUBMITTED

    db.add(AuditLog(
        user_id=current_user.id, job_id=job_id,
        action=AuditAction.RECORD_SUBMITTED,
        after_value={"record_count": len(records), "payload_sha256": payload_hash},
    ))
    db.commit()
    db.refresh(batch)

    return StreamingResponse(
        io.BytesIO(payload_bytes),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="xtrium_{job_id[:8]}_submission.json"',
            "X-Batch-Id": batch.id,
            "X-Payload-SHA256": payload_hash,
        },
    )


@router.get("/jobs/{job_id}/submissions", response_model=list[SubmissionBatchOut])
def list_submissions(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    batches = db.query(SubmissionBatch).filter(SubmissionBatch.job_id == job_id).all()
    return [SubmissionBatchOut(
        id=b.id, job_id=b.job_id, submitted_by=b.submitted_by,
        destination=b.destination, record_count=b.record_count,
        schema_version=b.schema_version, payload_sha256=b.payload_sha256,
        file_url=b.file_url, status=b.status, created_at=b.created_at,
    ) for b in batches]


# ─── Stats dashboard ─────────────────────────────────────────────────────────

@stats_router.get("/dashboard")
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    is_admin = "org_admin" in user_roles

    job_q = db.query(ExtractionJob)
    if not is_admin:
        job_q = job_q.join(Project).join(ProjectMember).filter(ProjectMember.user_id == current_user.id)

    active_jobs = job_q.filter(ExtractionJob.status.in_([
        JobStatus.QUEUED, JobStatus.PARSING, JobStatus.EXTRACTING,
        JobStatus.LLM_REVIEW, JobStatus.READY_FOR_REVIEW, JobStatus.IN_REVIEW,
    ])).count()

    total_jobs = job_q.count()
    submitted_jobs = job_q.filter(ExtractionJob.status == JobStatus.SUBMITTED).count()

    record_q = db.query(ExtractedRecord).join(ExtractionJob)
    if not is_admin:
        record_q = record_q.join(Project).join(ProjectMember).filter(ProjectMember.user_id == current_user.id)

    pending_review = record_q.filter(ExtractedRecord.review_status == ReviewStatus.PENDING).count()
    total_records = record_q.count()
    approved_records = record_q.filter(ExtractedRecord.review_status == ReviewStatus.APPROVED).count()
    rejected_records = record_q.filter(ExtractedRecord.review_status == ReviewStatus.REJECTED).count()
    submitted_records = record_q.filter(ExtractedRecord.is_submitted == True).count()

    approval_rate = round(approved_records / max(total_records, 1) * 100, 1)

    # Recent jobs
    recent_jobs = job_q.order_by(ExtractionJob.created_at.desc()).limit(5).all()

    return {
        "active_jobs": active_jobs,
        "total_jobs": total_jobs,
        "submitted_jobs": submitted_jobs,
        "pending_review": pending_review,
        "total_records": total_records,
        "approved_records": approved_records,
        "rejected_records": rejected_records,
        "submitted_records": submitted_records,
        "approval_rate": approval_rate,
        "recent_jobs": [
            {
                "id": j.id,
                "name": j.name,
                "status": j.status.value,
                "total_extracted": j.total_extracted,
                "total_approved": j.total_approved,
                "created_at": j.created_at.isoformat(),
            }
            for j in recent_jobs
        ],
    }


# ─── Notifications ────────────────────────────────────────────────────────────

@notifications_router.get("")
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.all_models import Notification
    notes = db.query(Notification).filter(
        Notification.user_id == current_user.id
    ).order_by(Notification.created_at.desc()).limit(50).all()
    return [
        {"id": n.id, "title": n.title, "body": n.body, "link": n.link, "is_read": n.is_read, "created_at": n.created_at}
        for n in notes
    ]


@notifications_router.post("/{notification_id}/read")
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.all_models import Notification
    n = db.query(Notification).filter(
        Notification.id == notification_id, Notification.user_id == current_user.id
    ).first()
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}


@stats_router.get("/sources-summary")
def sources_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns source counts by status + recent activity for the dashboard.
    Scoped by role: org_admins see everything, others see their accessible projects.
    """
    from app.models.all_models import Source, SourceStatus, ProjectMember
    from sqlalchemy import func

    user_roles = {r.role.value for r in current_user.roles}
    is_admin = "org_admin" in user_roles

    q = db.query(Source)
    if not is_admin:
        accessible = [m.project_id for m in db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).all()]
        if not accessible:
            return {"by_status": {}, "total": 0, "approved_this_week": 0, "recent": []}
        q = q.filter(Source.project_id.in_(accessible))

    sources = q.all()
    total = len(sources)

    by_status: dict[str, int] = {}
    for s in sources:
        key = s.status.value
        by_status[key] = by_status.get(key, 0) + 1

    from datetime import datetime, timezone, timedelta
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    approved_this_week = sum(
        1 for s in sources
        if s.status == SourceStatus.APPROVED and s.approved_at and s.approved_at >= week_ago
    )

    def _src(s: Source) -> dict:
        pending = max(0, (s.total_records or 0) - (s.approved_records or 0))
        return {
            "id": s.id, "name": s.name, "project_id": s.project_id,
            "status": s.status.value, "total_records": s.total_records or 0,
            "valid_records": s.valid_records or 0, "invalid_records": s.invalid_records or 0,
            "approved_records": s.approved_records or 0,
            "pending_records": pending,
            "updated_at": s.updated_at,
        }

    # Dual-role support: show ALL sources where user is extractor OR reviewer
    # my_extracting — any source where this user is the extractor (needs their action)
    my_extracting = [
        s for s in sources
        if s.assigned_extractor_id == current_user.id
        and s.status.value not in ("approved",)
    ]
    # my_reviewing — ALL sources assigned to this user as reviewer, with pending work
    # Includes ready_for_review, in_review, changes_requested — anything not yet approved
    my_reviewing = [
        s for s in sources
        if s.assigned_reviewer_id == current_user.id
        and s.status.value not in ("approved", "not_started")
    ]
    # Also include approved sources with pending records (still need final approval)
    my_review_queue = sorted(my_reviewing, key=lambda s: s.updated_at or s.created_at, reverse=True)

    # Recent activity = last 10 updated sources
    recent = sorted(sources, key=lambda s: s.updated_at or s.created_at, reverse=True)[:10]

    return {
        "by_status": by_status,
        "total": total,
        "approved_this_week": approved_this_week,
        "my_extracting": [_src(s) for s in my_extracting],
        "my_reviewing": [_src(s) for s in my_review_queue],
        "recent": [_src(s) for s in recent],
    }


@notifications_router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.all_models import Notification
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}
