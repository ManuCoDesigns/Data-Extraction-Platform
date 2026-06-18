import os
from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import RedirectResponse, StreamingResponse
import io
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.services.storage import storage, new_storage_key
from app.models.all_models import (
    Project, ProjectMember, ProjectResource, ResourceType,
    User, AuditLog, AuditAction,
)
from app.schemas.api_schemas import ProjectResourceOut

router = APIRouter(prefix="/projects", tags=["project-resources"])

ALLOWED_RESOURCE_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
    ".png", ".jpg", ".jpeg", ".zip",
}


def _can_access_project(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(m.user_id == user.id for m in project.members)


def _is_project_admin(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(
        m.user_id == user.id and m.role.value == "project_admin"
        for m in project.members
    )


def _serialize(r: ProjectResource) -> ProjectResourceOut:
    return ProjectResourceOut(
        id=r.id, project_id=r.project_id, type=r.type.value, title=r.title,
        description=r.description, file_name=r.file_name,
        file_size_bytes=r.file_size_bytes, url=r.url, body=r.body,
        uploaded_by=r.uploaded_by, created_at=r.created_at,
    )


def _get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/resources", response_model=list[ProjectResourceOut])
def list_resources(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _can_access_project(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")
    resources = db.query(ProjectResource).filter(
        ProjectResource.project_id == project_id
    ).order_by(ProjectResource.created_at.desc()).all()
    return [_serialize(r) for r in resources]


@router.post("/{project_id}/resources", response_model=ProjectResourceOut, status_code=201)
async def add_resource(
    project_id: str,
    type: str = Form(...),
    title: str = Form(...),
    description: str = Form(None),
    url: str = Form(None),
    body: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _is_project_admin(current_user, project):
        raise HTTPException(status_code=403, detail="Only project admins can add resources")

    try:
        resource_type = ResourceType(type)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid resource type: {type}")

    storage_key = None
    file_name = None
    file_size_bytes = None

    if resource_type == ResourceType.FILE:
        if not file:
            raise HTTPException(status_code=422, detail="A file is required for type=file")
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_RESOURCE_EXTENSIONS:
            raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}")
        content = await file.read()
        storage_key = new_storage_key(f"projects/{project_id}/resources", file.filename)
        storage.upload(content, storage_key, content_type=file.content_type)
        file_name = file.filename
        file_size_bytes = len(content)
    elif resource_type == ResourceType.LINK and not url:
        raise HTTPException(status_code=422, detail="url is required for type=link")
    elif resource_type in (ResourceType.INSTRUCTION, ResourceType.SOP) and not body and not file:
        raise HTTPException(status_code=422, detail="body or file is required for instructions/SOPs")
    elif resource_type in (ResourceType.INSTRUCTION, ResourceType.SOP) and file:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_RESOURCE_EXTENSIONS:
            raise HTTPException(status_code=422, detail=f"Unsupported file type: {ext}")
        content = await file.read()
        storage_key = new_storage_key(f"projects/{project_id}/resources", file.filename)
        storage.upload(content, storage_key, content_type=file.content_type)
        file_name = file.filename
        file_size_bytes = len(content)

    resource = ProjectResource(
        project_id=project_id, type=resource_type, title=title, description=description,
        storage_key=storage_key, file_name=file_name, file_size_bytes=file_size_bytes,
        url=url, body=body, uploaded_by=current_user.id,
    )
    db.add(resource)
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.RESOURCE_ADDED,
        after_value={"title": title, "type": type},
    ))
    db.commit()
    db.refresh(resource)
    return _serialize(resource)


@router.delete("/{project_id}/resources/{resource_id}", status_code=204)
def delete_resource(
    project_id: str,
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _is_project_admin(current_user, project):
        raise HTTPException(status_code=403, detail="Only project admins can delete resources")

    resource = db.query(ProjectResource).filter(
        ProjectResource.id == resource_id, ProjectResource.project_id == project_id
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    if resource.storage_key:
        try:
            storage.delete(resource.storage_key)
        except Exception:
            pass  # don't block deletion of the DB row on a storage hiccup

    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.RESOURCE_DELETED,
        before_value={"title": resource.title, "type": resource.type.value},
    ))
    db.delete(resource)
    db.commit()


@router.get("/{project_id}/resources/{resource_id}/download")
def download_resource(
    project_id: str,
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, db)
    if not _can_access_project(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")

    resource = db.query(ProjectResource).filter(
        ProjectResource.id == resource_id, ProjectResource.project_id == project_id
    ).first()
    if not resource or not resource.storage_key:
        raise HTTPException(status_code=404, detail="No downloadable file on this resource")

    if settings.STORAGE_PROVIDER == "s3":
        url = storage.get_download_url(resource.storage_key, filename=resource.file_name)
        return RedirectResponse(url)

    # Local dev fallback — stream straight from disk
    content = storage.read(resource.storage_key)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{resource.file_name}"'},
    )