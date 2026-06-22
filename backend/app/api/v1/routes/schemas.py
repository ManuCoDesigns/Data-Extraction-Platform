from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import get_current_user, require_roles
from app.models.all_models import Schema, SchemaVersion, User, AuditLog, AuditAction
from app.schemas.api_schemas import SchemaCreate, SchemaOut, SchemaVersionOut

router = APIRouter(prefix="/schemas", tags=["schemas"])


@router.get("", response_model=list[SchemaOut])
def list_schemas(
    project_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Schema).filter(Schema.is_archived == False)
    if project_id:
        q = q.filter(Schema.project_id == project_id)
    return [SchemaOut(
        id=s.id, project_id=s.project_id, name=s.name,
        current_version=s.current_version, is_archived=s.is_archived,
        created_at=s.created_at,
    ) for s in q.all()]


@router.post("/{project_id}", response_model=SchemaOut, status_code=201)
def create_schema(
    project_id: str,
    payload: SchemaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    schema = Schema(project_id=project_id, name=payload.name, created_by=current_user.id)
    db.add(schema)
    db.flush()

    version = SchemaVersion(
        schema_id=schema.id, version=1, definition=payload.definition,
        created_by=current_user.id,
    )
    db.add(version)
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.SCHEMA_CREATED,
        after_value={"name": payload.name},
    ))
    db.commit()
    db.refresh(schema)
    return SchemaOut(
        id=schema.id, project_id=schema.project_id, name=schema.name,
        current_version=schema.current_version, is_archived=schema.is_archived,
        created_at=schema.created_at,
    )


@router.get("/{schema_id}/versions", response_model=list[SchemaVersionOut])
def get_versions(schema_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    versions = db.query(SchemaVersion).filter(SchemaVersion.schema_id == schema_id).order_by(SchemaVersion.version).all()
    return [SchemaVersionOut(
        id=v.id, schema_id=v.schema_id, version=v.version, definition=v.definition,
        is_locked=v.is_locked, locked_at=v.locked_at, created_at=v.created_at,
    ) for v in versions]


@router.post("/{schema_id}/versions", response_model=SchemaVersionOut, status_code=201)
def add_version(
    schema_id: str,
    payload: SchemaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    schema = db.query(Schema).filter(Schema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    new_version_num = schema.current_version + 1
    version = SchemaVersion(
        schema_id=schema_id, version=new_version_num,
        definition=payload.definition, created_by=current_user.id,
    )
    db.add(version)
    schema.current_version = new_version_num
    db.add(AuditLog(
        user_id=current_user.id, action=AuditAction.SCHEMA_VERSION_CREATED,
        after_value={"schema_id": schema_id, "version": new_version_num},
    ))
    db.commit()
    db.refresh(version)
    return SchemaVersionOut(
        id=version.id, schema_id=version.schema_id, version=version.version,
        definition=version.definition, is_locked=version.is_locked,
        locked_at=version.locked_at, created_at=version.created_at,
    )


@router.post("/{schema_id}/archive")
def archive_schema(
    schema_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    schema = db.query(Schema).filter(Schema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
    schema.is_archived = True
    db.add(AuditLog(user_id=current_user.id, action=AuditAction.SCHEMA_ARCHIVED, after_value={"schema_id": schema_id}))
    db.commit()
    return {"message": "Schema archived"}


@router.patch("/{schema_id}")
def update_schema(
    schema_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    schema = db.query(Schema).filter(Schema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
    if "name" in payload:
        schema.name = payload["name"]
    if "description" in payload:
        schema.description = payload.get("description")
    db.commit()
    return {"id": schema.id, "name": schema.name}


@router.delete("/{schema_id}", status_code=204)
def delete_schema(
    schema_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin", "project_admin")),
):
    """Hard-delete a schema. Blocked if any extraction jobs reference it."""
    from app.models.all_models import ExtractionJob
    schema = db.query(Schema).filter(Schema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
    job_count = db.query(ExtractionJob).filter(ExtractionJob.schema_id == schema_id).count()
    if job_count > 0:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot delete — {job_count} extraction job(s) reference this schema. Archive it instead."
        )
    db.query(SchemaVersion).filter(SchemaVersion.schema_id == schema_id).delete()
    db.delete(schema)
    db.commit()
