import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File, Query
from fastapi.responses import RedirectResponse, StreamingResponse
import io
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.services.storage import storage, new_storage_key
from app.models.all_models import (
    Project, ProjectMember, ProjectSubmission, SubmissionStatus,
    User, AuditLog, AuditAction, Notification,
)
from app.schemas.api_schemas import ProjectSubmissionOut, ProjectSubmissionReview

router = APIRouter(tags=["work-submissions"])

ALLOWED_SUBMISSION_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".json", ".txt", ".zip",
}


def _can_access_project(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(m.user_id == user.id for m in project.members)


def _can_submit_work(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(
        m.user_id == user.id and m.role.value != "read_only"
        for m in project.members
    )


def _can_review(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if user_roles.intersection({"org_admin", "qa_lead"}):
        return True
    return any(
        m.user_id == user.id and m.role.value in ("project_admin", "reviewer")
        for m in project.members
    )


def _serialize(s: ProjectSubmission) -> ProjectSubmissionOut:
    return ProjectSubmissionOut(
        id=s.id, project_id=s.project_id, user_id=s.user_id, title=s.title,
        note=s.note, file_name=s.file_name, file_size_bytes=s.file_size_bytes,
        status=s.status.value, reviewer_id=s.reviewer_id, review_notes=s.review_notes,
        submitted_at=s.submitted_at, reviewed_at=s.reviewed_at,
    )


def _get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/projects/{project_id}/submissions", response_model=list[ProjectSubmissionOut])
def list_submissions(
    project_id: str,
    status: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _can_access_project(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(ProjectSubmission).filter(ProjectSubmission.project_id == project_id)
    # Reviewers/admins see everyone's submissions; everyone else sees only their own.
    if not _can_review(current_user, project):
        q = q.filter(ProjectSubmission.user_id == current_user.id)
    if status:
        try:
            q = q.filter(ProjectSubmission.status == SubmissionStatus(status))
        except ValueError:
            pass
    submissions = q.order_by(ProjectSubmission.submitted_at.desc()).all()
    return [_serialize(s) for s in submissions]


@router.get("/submissions/me", response_model=list[ProjectSubmissionOut])
def list_my_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Personal submission history across all projects, for progress tracking."""
    submissions = db.query(ProjectSubmission).filter(
        ProjectSubmission.user_id == current_user.id
    ).order_by(ProjectSubmission.submitted_at.desc()).all()
    return [_serialize(s) for s in submissions]


@router.post("/projects/{project_id}/submissions", response_model=ProjectSubmissionOut, status_code=201)
async def create_submission(
    project_id: str,
    title: str = Form(None),
    note: str = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _can_submit_work(current_user, project):
        raise HTTPException(status_code=403, detail="You don't have permission to submit work to this project")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_SUBMISSION_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}")

    content = await file.read()
    storage_key = new_storage_key(f"projects/{project_id}/submissions/{current_user.id}", file.filename)
    storage.upload(content, storage_key, content_type=file.content_type)

    submission = ProjectSubmission(
        project_id=project_id, user_id=current_user.id, title=title, note=note,
        storage_key=storage_key, file_name=file.filename, file_size_bytes=len(content),
        status=SubmissionStatus.SUBMITTED,
    )
    db.add(submission)
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.WORK_SUBMITTED,
        after_value={"file_name": file.filename, "title": title},
    ))
    db.commit()
    db.refresh(submission)
    return _serialize(submission)


@router.get("/submissions/{submission_id}/download")
def download_submission(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(ProjectSubmission).filter(ProjectSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    project = _get_project_or_404(submission.project_id, db)

    is_owner = submission.user_id == current_user.id
    if not is_owner and not _can_review(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")

    if settings.STORAGE_PROVIDER == "s3":
        url = storage.get_download_url(submission.storage_key, filename=submission.file_name)
        return RedirectResponse(url)

    content = storage.read(submission.storage_key)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{submission.file_name}"'},
    )


@router.post("/submissions/{submission_id}/review", response_model=ProjectSubmissionOut)
def review_submission(
    submission_id: str,
    payload: ProjectSubmissionReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = db.query(ProjectSubmission).filter(ProjectSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    project = _get_project_or_404(submission.project_id, db)

    if not _can_review(current_user, project):
        raise HTTPException(status_code=403, detail="Only reviewers and admins can review submissions")

    action_map = {
        "approve": SubmissionStatus.APPROVED,
        "reject": SubmissionStatus.REJECTED,
        "needs_revision": SubmissionStatus.NEEDS_REVISION,
    }
    if payload.action not in action_map:
        raise HTTPException(status_code=422, detail=f"Unknown action: {payload.action}")

    submission.status = action_map[payload.action]
    submission.review_notes = payload.notes
    submission.reviewer_id = current_user.id
    submission.reviewed_at = datetime.now(timezone.utc)

    status_label = {
        "approve": "approved", "reject": "rejected", "needs_revision": "sent back for revision",
    }[payload.action]
    db.add(Notification(
        user_id=submission.user_id,
        title=f"Your submission was {status_label}",
        body=payload.notes or f"Your submission to {project.name} was {status_label}.",
        link=f"/projects/{project.id}",
    ))
    db.add(AuditLog(
        user_id=current_user.id, project_id=project.id,
        action=AuditAction.WORK_REVIEWED,
        after_value={"submission_id": submission_id, "action": payload.action},
    ))
    db.commit()
    db.refresh(submission)
    return _serialize(submission)