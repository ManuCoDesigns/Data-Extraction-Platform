"""Work balance: see how evenly extraction work is spread, switch the automatic balancing on or off, set people aside, and run it now."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _need_lead, _roles, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import Project, ProjectMember, ReminderLog, User, UserRole
from app.services import balance as bal

router = APIRouter(prefix="/balance", tags=["balance"])


def _project(db: Session, user: User, project_id: str) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()  # noqa: E711
    if not p or not _visible_sources(db, user, project_id).first() and not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


def _admin(user: User):
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can change work balancing.")


def _view(db: Session, p: Project) -> dict:
    snap = bal.snapshot(db, p.id)
    off = bal.skipped(db, p.id)
    members = (db.query(User).join(ProjectMember, ProjectMember.user_id == User.id)
               .filter(ProjectMember.project_id == p.id, ProjectMember.role == UserRole.PIPELINE_OPERATOR, User.is_active == True).order_by(User.full_name).all())  # noqa: E712
    people = [{**snap.get(u.id, {"user_id": u.id, "name": u.full_name, "load": 0, "started": 0, "movable": 0, "parked": 0}), "included": u.id not in off} for u in members]
    loads = [x["load"] for x in people if x["included"]]
    last = db.query(ReminderLog.created_at).filter(ReminderLog.key == f"balance:last:{p.id}").scalar()
    return {"project_id": p.id, "project": p.name, "enabled": bal.enabled(db, p.id), "people": people,
            "spread": (max(loads) - min(loads)) if loads else 0, "even": (not loads) or (max(loads) - min(loads) <= 1),
            "last_run": last, "moves": bal.recent_moves(db, p.id)}


@router.get("/{project_id}")
def get(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return _view(db, _project(db, user, project_id))


class SettingsBody(BaseModel):
    enabled: bool | None = None
    set_aside: list[str] | None = None      # people left out of balancing (on leave, for example)


@router.put("/{project_id}")
def update(project_id: str, body: SettingsBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _admin(user)
    p = _project(db, user, project_id)
    if body.enabled is not None:
        bal.set_enabled(db, p.id, body.enabled)
    if body.set_aside is not None:
        bal.set_skipped(db, p.id, body.set_aside)
    db.commit()
    return _view(db, p)


@router.post("/{project_id}/run")
def run(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _admin(user)
    p = _project(db, user, project_id)
    r = bal.run_project(db, p.id)
    return {"moved": len(r["moves"]), "view": _view(db, p)}
