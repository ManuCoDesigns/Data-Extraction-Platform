from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import math
from app.db.session import get_db
from app.core.security import get_current_user, require_roles
from app.models.all_models import (
    Project, ProjectMember, UserRole, User, AuditLog, AuditAction, ProjectStatus
)
from app.schemas.api_schemas import ProjectCreate, ProjectOut, ProjectUpdate, ProjectMemberAdd, ProjectMemberOut, PaginatedResponse

router = APIRouter(prefix="/projects", tags=["projects"])


def _serialize(p: Project, db: Session) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        status=p.status.value,
        owner_id=p.owner_id,
        submission_destinations=p.submission_destinations or [],
        created_at=p.created_at,
        member_count=len(p.members),
        job_count=len(p.jobs),
    )


def _can_access(user: User, project: Project) -> bool:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return True
    return any(m.user_id == user.id for m in project.members)


@router.get("", response_model=PaginatedResponse)
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    q = db.query(Project).filter(Project.deleted_at == None)
    if "org_admin" not in user_roles:
        q = q.join(ProjectMember).filter(ProjectMember.user_id == current_user.id)
    total = q.count()
    projects = q.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize(p, db) for p in projects],
        total=total, page=page, page_size=page_size,
        pages=math.ceil(total / page_size),
    )


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    project = Project(
        name=payload.name,
        description=payload.description,
        submission_destinations=payload.submission_destinations,
        owner_id=current_user.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=current_user.id, role=UserRole.PROJECT_ADMIN))
    db.add(AuditLog(
        user_id=current_user.id, project_id=project.id,
        action=AuditAction.PROJECT_CREATED,
        after_value={"name": payload.name},
    ))
    db.commit()
    db.refresh(project)
    return _serialize(project, db)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")
    return _serialize(project, db)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    user_roles = {r.role.value for r in current_user.roles}
    is_project_admin = any(
        m.user_id == current_user.id and m.role in (UserRole.PROJECT_ADMIN,)
        for m in project.members
    )
    if "org_admin" not in user_roles and not is_project_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    before_status = project.status.value
    if payload.name: project.name = payload.name
    if payload.description is not None: project.description = payload.description
    if payload.submission_destinations is not None:
        project.submission_destinations = payload.submission_destinations
    if payload.status:
        project.status = ProjectStatus(payload.status)
        db.add(AuditLog(
            user_id=current_user.id, project_id=project.id,
            action=AuditAction.PROJECT_STATUS_CHANGED,
            before_value={"status": before_status},
            after_value={"status": payload.status},
        ))
    db.commit()
    db.refresh(project)
    return _serialize(project, db)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def list_members(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access(current_user, project):
        raise HTTPException(status_code=403, detail="Access denied")
    return [
        ProjectMemberOut(
            user_id=m.user_id, role=m.role.value,
            full_name=m.user.full_name, email=m.user.email,
            created_at=m.created_at,
        )
        for m in project.members
    ]


@router.post("/{project_id}/members", status_code=201)
def add_member(
    project_id: str,
    payload: ProjectMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == payload.user_id,
    ).first()
    if existing:
        existing.role = UserRole(payload.role)
    else:
        db.add(ProjectMember(project_id=project_id, user_id=payload.user_id, role=UserRole(payload.role)))
    db.commit()
    return {"message": "Member added"}


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(
    project_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin")),
):
    """Soft-delete a project. Only org admins can delete projects."""
    from datetime import datetime, timezone
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.deleted_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.PROJECT_DELETED,
        before_value={"name": project.name},
    ))
    db.commit()


@router.get("/{project_id}/export")
def export_project(
    project_id: str,
    status: str = "approved",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export all records from all sources in a project as a single ZIP file.
    Contains: records/ folder (one JSON per record), combined.json, README.md
    Defaults to approved records only; pass ?status=all for everything.
    """
    import io, zipfile, json as _json
    from datetime import datetime, timezone
    from fastapi.responses import StreamingResponse
    from app.models.all_models import Source, ExtractedRecord

    project = db.query(Project).filter(
        Project.id == project_id, Project.deleted_at == None
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Collect all sources in the project
    sources = db.query(Source).filter(
        Source.project_id == project_id,
        Source.deleted_at == None
    ).all()

    # Collect records
    all_records = []
    for source in sources:
        q = db.query(ExtractedRecord).filter(
            ExtractedRecord.source_id == source.id,
            ExtractedRecord.deleted_at == None
        )
        if status != "all":
            q = q.filter(ExtractedRecord.review_status == status)
        recs = q.all()
        for r in recs:
            record_data = r.extracted_fields or {}
            # Add Xtrium metadata
            record_data["_xtrium"] = {
                "record_id": str(r.id),
                "source_id": str(source.id),
                "source_name": source.name,
                "review_status": r.review_status,
                "is_schema_valid": r.is_schema_valid,
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }
            all_records.append(record_data)

    if not all_records:
        raise HTTPException(
            status_code=404,
            detail=f"No {status} records found in this project. "
                   f"Approve records first or use ?status=all to export everything."
        )

    # Build README
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    readme = f"""# {project.name} — Xtrium Export

Exported: {ts}
Records: {len(all_records)} ({status})
Sources: {len(sources)}

## Contents
- `records/` — one JSON file per record (named by canonical_name)
- `combined.json` — all records in one array (upload to any system)
- `README.md` — this file

## Record fields
Each record follows the BGS Supplier Graph Schema v1.0.
Non-BGS fields are in the `extras` array.
`_xtrium` contains export metadata (not part of the schema).

## Sources in this project
"""
    for s in sources:
        count = sum(1 for r in all_records if r.get("_xtrium",{}).get("source_id") == str(s.id))
        readme += f"- {s.name}: {count} records\n"

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", readme)
        zf.writestr("combined.json",
                     _json.dumps(all_records, indent=2, ensure_ascii=False, default=str))
        for record in all_records:
            cn = record.get("canonical_name") or record.get("company_name", "record")
            cn = str(cn).lower().replace(" ", "-")[:60]
            fname = f"records/{cn}.json"
            zf.writestr(fname, _json.dumps(record, indent=2, ensure_ascii=False, default=str))

    buf.seek(0)
    project_slug = re.sub(r"[^a-z0-9_]", "_", project.name.lower())[:40]
    filename = f"{project_slug}_export_{datetime.now().strftime('%Y%m%d')}.zip"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
