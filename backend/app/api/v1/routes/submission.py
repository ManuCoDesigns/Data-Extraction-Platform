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
        raise HTTPException(status_code=422, detail="No approved records to submit")

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
            "Content-Disposition": f'attachment; filename="_{job_id[:8]}_submission.json"',
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


@stats_router.get("/productivity")
def productivity_stats(
    project_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Per-person productivity metrics for admin dashboard.
    Shows extraction speed, review speed, quality rates, and fast-review flags.
    """
    try:
        from app.models.all_models import (
            ExtractedRecord, ExtractionJob, Source, User as UserModel,
            UserRoleAssignment, ReviewStatus,
        )
        from sqlalchemy import func, case
        from datetime import datetime, timezone, timedelta

        # Base query — filter by project if provided
        job_q = db.query(ExtractionJob)
        if project_id:
            job_q = job_q.filter(ExtractionJob.project_id == project_id)
        job_ids = [j.id for j in job_q.all()]

        if not job_ids:
            return {"extractors": [], "reviewers": [], "generated_at": datetime.now(timezone.utc).isoformat()}

        records = db.query(ExtractedRecord).filter(
            ExtractedRecord.job_id.in_(job_ids)
        ).all()

        # ── Per-extractor stats ───────────────────────────────────────────
        extractor_map: dict = {}
        for rec in records:
            job = db.query(ExtractionJob).filter(ExtractionJob.id == rec.job_id).first()
            if not job or not job.created_by: continue
            uid = str(job.created_by)
            if uid not in extractor_map:
                user = db.query(UserModel).filter(UserModel.id == uid).first()
                extractor_map[uid] = {
                    "user_id": uid,
                    "name":    user.full_name if user else uid[:8],
                    "email":   user.email if user else "",
                    "total_records":    0,
                    "valid_records":    0,
                    "invalid_records":  0,
                    "approved_records": 0,
                    "sources_worked":   set(),
                }
            e = extractor_map[uid]
            e["total_records"]    += 1
            e["sources_worked"].add(job.source_id)
            if rec.is_schema_valid:    e["valid_records"]    += 1
            else:                      e["invalid_records"]  += 1
            if rec.review_status.value == "approved": e["approved_records"] += 1

        extractors = []
        for e in extractor_map.values():
            t = e["total_records"]
            extractors.append({
                "user_id":        e["user_id"],
                "name":           e["name"],
                "email":          e["email"],
                "total_records":  t,
                "valid_records":  e["valid_records"],
                "invalid_records": e["invalid_records"],
                "approved_records": e["approved_records"],
                "sources_worked": len(e["sources_worked"]),
                "error_rate_pct": round((e["invalid_records"] / t * 100) if t else 0, 1),
                "approval_rate_pct": round((e["approved_records"] / t * 100) if t else 0, 1),
            })
        extractors.sort(key=lambda x: -x["total_records"])

        # ── Per-reviewer stats ────────────────────────────────────────────
        reviewer_map: dict = {}
        for rec in records:
            if not rec.reviewed_by: continue
            uid = str(rec.reviewed_by)
            if uid not in reviewer_map:
                user = db.query(UserModel).filter(UserModel.id == uid).first()
                reviewer_map[uid] = {
                    "user_id": uid,
                    "name":    user.full_name if user else uid[:8],
                    "email":   user.email if user else "",
                    "total_reviewed":   0,
                    "approved":         0,
                    "rejected":         0,
                    "fast_reviews":     0,
                    "review_times_secs": [],
                }
            r = reviewer_map[uid]
            r["total_reviewed"] += 1
            if rec.review_status.value in ("approved", "pending_admin_review"):
                r["approved"] += 1
            elif rec.review_status.value == "rejected":
                r["rejected"] += 1
            # Fast review check
            if rec.pipeline_warnings:
                for w in rec.pipeline_warnings:
                    if isinstance(w, dict) and w.get("type") == "fast_review" and w.get("reviewer") == reviewer_map[uid]["email"]:
                        r["fast_reviews"] += 1
            # Review time
            if rec.review_started_at and rec.reviewed_at:
                secs = int((rec.reviewed_at - rec.review_started_at).total_seconds())
                if 0 < secs < 86400:  # sanity: under 24 hours
                    r["review_times_secs"].append(secs)

        reviewers = []
        for r in reviewer_map.values():
            t   = r["total_reviewed"]
            avg = int(sum(r["review_times_secs"]) / len(r["review_times_secs"])) if r["review_times_secs"] else None
            reviewers.append({
                "user_id":          r["user_id"],
                "name":             r["name"],
                "email":            r["email"],
                "total_reviewed":   t,
                "approved":         r["approved"],
                "rejected":         r["rejected"],
                "fast_reviews":     r["fast_reviews"],
                "avg_review_secs":  avg,
                "avg_review_label": (
                    f"{avg}s" if avg and avg < 60 else
                    f"{avg//60}m {avg%60}s" if avg and avg < 3600 else
                    f"{avg//3600}h {(avg%3600)//60}m" if avg else "—"
                ),
                "approval_rate_pct": round((r["approved"] / t * 100) if t else 0, 1),
                "flagged": r["fast_reviews"] > 0,
            })
        reviewers.sort(key=lambda x: -x["total_reviewed"])

        return {
            "extractors":    extractors,
            "reviewers":     reviewers,
            "total_records": len(records),
            "generated_at":  datetime.now(timezone.utc).isoformat(),
        }

    except Exception as exc:
        import traceback, logging
        logging.getLogger(__name__).error("productivity error: %s", traceback.format_exc())
        return {"extractors": [], "reviewers": [], "error": str(exc)}

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

    # My assigned sources (needs action)
    my_extracting = [s for s in sources if s.assigned_extractor_id == current_user.id and s.status.value in ("extracting", "needs_fixes", "changes_requested")]
    my_reviewing = [s for s in sources if s.assigned_reviewer_id == current_user.id and s.status.value in ("ready_for_review", "in_review")]

    def _src(s: Source) -> dict:
        return {
            "id": s.id, "name": s.name, "project_id": s.project_id,
            "status": s.status.value, "total_records": s.total_records,
            "valid_records": s.valid_records, "invalid_records": s.invalid_records,
            "approved_records": s.approved_records, "updated_at": s.updated_at,
        }

    # Recent activity = last 10 updated sources
    recent = sorted(sources, key=lambda s: s.updated_at or s.created_at, reverse=True)[:10]

    # Per-project breakdown for admin dashboard
    def _per_project(srcs):
        from collections import defaultdict
        pp = {}
        for s in srcs:
            pid = str(s.project_id)
            if pid not in pp:
                pp[pid] = {"project_id": pid, "total": 0, "approved": 0,
                           "in_progress": 0, "not_started": 0}
            pp[pid]["total"] += 1
            st = s.status.value if hasattr(s.status, "value") else str(s.status)
            if st == "approved":      pp[pid]["approved"]     += 1
            elif st == "not_started": pp[pid]["not_started"]  += 1
            else:                     pp[pid]["in_progress"]  += 1
        return list(pp.values())

    # Pending admin review — records where reviewer approved but admin hasn't yet
    from app.models.all_models import ExtractedRecord, ExtractionJob
    pending_admin_sources = []
    for s in sources:
        has_pending = db.query(ExtractedRecord)            .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)            .filter(ExtractionJob.source_id == s.id,
                    ExtractedRecord.review_status == "pending_admin_review")            .first()
        if has_pending:
            pending_admin_sources.append(_src(s))

    return {
        "by_status": by_status,
        "total": total,
        "approved_this_week": approved_this_week,
        "my_extracting": [_src(s) for s in my_extracting[:5]],
        "my_reviewing":  [_src(s) for s in my_reviewing[:5]],
        "recent":        [_src(s) for s in recent],
        "per_project":   _per_project(sources),
        "pending_admin_review": pending_admin_sources[:20],
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
