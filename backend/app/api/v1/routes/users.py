from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import get_current_user, require_roles, hash_password
from app.models.all_models import User, UserRoleAssignment, UserRole, AuditLog, AuditAction
from app.schemas.api_schemas import UserCreate, UserOut, UserUpdate, PaginatedResponse
import math

router = APIRouter(prefix="/users", tags=["users"])


def _serialize_user(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=[r.role.value for r in user.roles],
        created_at=user.created_at,
    )


@router.get("", response_model=PaginatedResponse)
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("org_admin", "project_admin")),
):
    q = db.query(User).filter(User.deleted_at == None)
    total = q.count()
    users = q.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize_user(u) for u in users],
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size),
    )


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin")),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.flush()

    for role_str in payload.roles:
        try:
            role = UserRole(role_str)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid role: {role_str}")
        db.add(UserRoleAssignment(user_id=user.id, role=role))

    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.USER_CREATED,
        after_value={"email": payload.email, "roles": payload.roles},
    ))
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Users can read their own profile; admins can read anyone
    admin_roles = {"org_admin"}
    user_roles = {r.role.value for r in current_user.roles}
    if user_id != current_user.id and not user_roles.intersection(admin_roles):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    user = db.query(User).filter(User.id == user_id, User.deleted_at == None).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == user_id, User.deleted_at == None).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_roles = {r.role.value for r in current_user.roles}
    is_admin = "org_admin" in user_roles
    is_self = current_user.id == user_id

    if not is_admin and not is_self:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Non-admins may only change their own name/password — never roles or is_active.
    if not is_admin and (payload.roles is not None or payload.is_active is not None):
        raise HTTPException(status_code=403, detail="Only an org_admin can change roles or active status")

    before = {"roles": [r.role.value for r in user.roles], "is_active": user.is_active}

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.password is not None:
        user.hashed_password = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.roles is not None:
        for existing in user.roles:
            db.delete(existing)
        db.flush()
        for role_str in payload.roles:
            db.add(UserRoleAssignment(user_id=user.id, role=UserRole(role_str)))

    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.USER_ROLE_CHANGED,
        before_value=before,
        after_value={"roles": payload.roles, "is_active": payload.is_active},
    ))
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("org_admin")),
):
    """Soft-delete (deactivate) a user. Cannot delete yourself."""
    from datetime import datetime, timezone
    if user_id == current_user.id:
        raise HTTPException(status_code=422, detail="You cannot delete your own account")
    user = db.query(User).filter(User.id == user_id, User.deleted_at == None).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    user.deleted_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current_user.id,
        action=AuditAction.USER_ROLE_CHANGED,
        before_value={"email": user.email, "active": True},
        after_value={"deleted": True},
    ))
    db.commit()
