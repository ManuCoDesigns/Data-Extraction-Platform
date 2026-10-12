from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import (
    verify_password, create_access_token, create_refresh_token, decode_token, get_current_user
)
from app.models.all_models import User, AuditLog, AuditAction, ExtractedRecord, Project, ProjectStatus, ReviewStatus, Source, SourceStatus
from app.schemas.api_schemas import LoginRequest, TokenResponse, RefreshRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


_PUBLIC_CACHE: dict = {"at": 0.0, "data": None}


@router.get("/public-stats")
def public_stats(db: Session = Depends(get_db)):
    """Three headline numbers for the sign-in page. Counts only, no names or content, so it is safe without a login.
    Cached for a minute so the login page cannot be used to hammer the database."""
    import time
    from sqlalchemy import func, case
    now = time.time()
    if _PUBLIC_CACHE["data"] is not None and now - _PUBLIC_CACHE["at"] < 60:
        return _PUBLIC_CACHE["data"]
    try:
        total = db.query(func.count(ExtractedRecord.id)).scalar() or 0
        approved, clean, rejected = db.query(
            func.coalesce(func.sum(case((ExtractedRecord.review_status == ReviewStatus.APPROVED, 1), else_=0)), 0),
            func.coalesce(func.sum(case((
                (ExtractedRecord.review_status == ReviewStatus.APPROVED) & (func.coalesce(ExtractedRecord.correction_count, 0) == 0), 1), else_=0)), 0),
            func.coalesce(func.sum(case((ExtractedRecord.review_status == ReviewStatus.REJECTED, 1), else_=0)), 0),
        ).one()
        reviewed = int(approved) + int(rejected)
        projects = db.query(func.count(Project.id)).filter(Project.status == ProjectStatus.ACTIVE).scalar() or 0
        delivered = db.query(func.count(Source.id)).filter(Source.status == SourceStatus.APPROVED).scalar() or 0
        last = db.query(func.max(ExtractedRecord.updated_at)).scalar()
        if last is not None and last.tzinfo is None:
            from datetime import timezone as _tz
            last = last.replace(tzinfo=_tz.utc)
        data = {
            "sources_delivered": int(delivered),
            "last_activity_at": last.isoformat() if last else None,
            "records_processed": int(total),
            # share of reviewed records that were approved exactly as extracted, no corrections
            "accuracy_percent": round(100.0 * int(clean) / reviewed, 1) if reviewed else None,
            "active_projects": int(projects),
        }
    except Exception:
        db.rollback()
        data = {"records_processed": None, "accuracy_percent": None, "active_projects": None, "sources_delivered": None, "last_activity_at": None}
    _PUBLIC_CACHE.update(at=now, data=data)
    return data


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    from datetime import datetime, timedelta, timezone
    from app.core.config import settings as _cfg
    from app.models.all_models import UserSettings
    from app.services import enh as _enh
    user = db.query(User).filter(User.email == payload.email, User.is_active == True).first()
    st = None
    if user:
        st = db.query(UserSettings).filter(UserSettings.user_id == user.id).first()
        if st and st.locked_until:
            until = st.locked_until if st.locked_until.tzinfo else st.locked_until.replace(tzinfo=timezone.utc)
            if until > datetime.now(timezone.utc):
                mins = max(1, int((until - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
                raise HTTPException(status_code=429, detail=f"Too many wrong attempts. Try again in {mins} minute{'s' if mins != 1 else ''}, or ask an admin to unlock you.")
    if not user or not verify_password(payload.password, user.hashed_password):
        if user:
            if not st:
                st = UserSettings(user_id=user.id, email_alerts=True, email_digest=True, totp_enabled=False, failed_logins=0)
                db.add(st)
            st.failed_logins = (st.failed_logins or 0) + 1
            if st.failed_logins >= _cfg.MAX_FAILED_LOGINS:
                st.locked_until = datetime.now(timezone.utc) + timedelta(minutes=_cfg.LOCKOUT_MINUTES)
                st.failed_logins = 0
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if st and st.totp_enabled:
        if not (payload.code or "").strip():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="TWO_STEP_REQUIRED")
        if not _enh.verify_totp(st.totp_secret or "", payload.code):
            st.failed_logins = (st.failed_logins or 0) + 1
            if st.failed_logins >= _cfg.MAX_FAILED_LOGINS:
                st.locked_until = datetime.now(timezone.utc) + timedelta(minutes=_cfg.LOCKOUT_MINUTES)
                st.failed_logins = 0
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That code isn't right")
    if st and (st.failed_logins or st.locked_until):
        st.failed_logins, st.locked_until = 0, None
        db.commit()

    roles = [r.role.value for r in user.roles]
    token_data = {"sub": user.id, "email": user.email, "roles": roles}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    decoded = decode_token(payload.refresh_token)
    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user = db.query(User).filter(User.id == decoded["sub"], User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    roles = [r.role.value for r in user.roles]
    token_data = {"sub": user.id, "email": user.email, "roles": roles}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return _user_out(current_user)


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=[r.role.value for r in user.roles],
        created_at=user.created_at,
    )
