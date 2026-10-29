"""Hold the clock on sources, and share freshly pulled sources across the team without assigning them one by one."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _need_lead, _roles, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import Project, Source, SourceStatus, User
from app.services import distribute as dist
from app.services import reviewer_share as rev
from app.services import holds
from app.services import quality as q

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


def _project(db: Session, user: User, project_id: str) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()  # noqa: E711
    if not p or not _visible_sources(db, user, project_id).first() and not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


def _view(db: Session, user: User, p: Project) -> dict:
    srcs = _visible_sources(db, user, p.id).filter(Source.status != SourceStatus.APPROVED).all()
    held = holds.held_since(db, [s.id for s in srcs])
    pb = q.pull_batches(srcs)
    batches: dict = {}
    for s in srcs:
        b = pb.get(s.id) or {"key": "other", "label": "Other sources", "date": ""}
        g = batches.setdefault(b["key"], {"key": b["key"], "label": b["label"], "date": b["date"], "open": 0, "held": 0, "unstarted": 0, "unassigned": 0})
        g["open"] += 1
        g["held"] += 1 if s.id in held else 0
        g["unstarted"] += 1 if s.status == SourceStatus.NOT_STARTED else 0
        g["unassigned"] += 1 if (s.status == SourceStatus.NOT_STARTED and not s.assigned_extractor_id) else 0
    items = [{"source_id": s.id, "name": s.name, "item_no": s.external_ref_id, "since": held[s.id], "batch": (pb.get(s.id) or {}).get("label")}
             for s in srcs if s.id in held]
    items.sort(key=lambda x: x["since"])
    return {"project_id": p.id, "project": p.name, "batches": sorted(batches.values(), key=lambda g: (g["key"] == "other", g["date"]), reverse=True),
            "held": items, "held_count": len(items), "unassigned": dist.waiting_summary(db, p.id), "auto_share": dist.auto_on(db, p.id), "reviewers": rev.summary(db, p.id)}


@router.get("/{project_id}")
def get(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return _view(db, user, _project(db, user, project_id))


class HoldBody(BaseModel):
    hold: bool = True
    batch_key: str | None = None            # every open source of one pull
    source_ids: list[str] | None = None
    only_unstarted: bool = True             # when holding a whole pull, leave out sources someone is already extracting
    everything: bool = False                # release all in the project


@router.post("/{project_id}/hold")
def hold(project_id: str, body: HoldBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    p = _project(db, user, project_id)
    srcs = _visible_sources(db, user, p.id).filter(Source.status != SourceStatus.APPROVED).all()
    if body.source_ids is not None:
        want = set(body.source_ids)
        srcs = [s for s in srcs if s.id in want]
    elif body.batch_key:
        pb = q.pull_batches(srcs)
        srcs = [s for s in srcs if (pb.get(s.id) or {}).get("key") == body.batch_key]
    elif not (body.everything and not body.hold):
        raise HTTPException(status_code=400, detail="Choose a pull or some sources.")
    if body.hold and body.only_unstarted and body.source_ids is None:
        srcs = [s for s in srcs if s.status == SourceStatus.NOT_STARTED]
    n = holds.set_hold(db, srcs, body.hold)
    db.commit()
    return {"changed": n, "view": _view(db, user, p)}


class ShareBody(BaseModel):
    batch_key: str | None = None
    source_ids: list[str] | None = None


@router.post("/{project_id}/share")
def share(project_id: str, body: ShareBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    p = _project(db, user, project_id)
    r = dist.run_project(db, p.id, batch_key=body.batch_key, source_ids=body.source_ids, by_user_id=user.id)
    per: dict = {}
    for a in r["assigned"]:
        per[a["to"]] = per.get(a["to"], 0) + 1
    return {"assigned": len(r["assigned"]), "left": r["left"], "reason": r["reason"], "per_person": per, "view": _view(db, user, p)}


class AutoBody(BaseModel):
    auto_share: bool


@router.put("/{project_id}/auto")
def auto(project_id: str, body: AutoBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can switch this on.")
    p = _project(db, user, project_id)
    dist.set_auto(db, p.id, body.auto_share)
    db.commit()
    return _view(db, user, p)


class ReviewersBody(BaseModel):
    scope: str = "ready"                    # ready = extraction finished; all_open = every open source that has an extractor
    batch_key: str | None = None


@router.post("/{project_id}/reviewers")
def share_reviewers(project_id: str, body: ReviewersBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    p = _project(db, user, project_id)
    r = rev.run_project(db, p.id, scope="all_open" if body.scope == "all_open" else "ready", batch_key=body.batch_key, by_user_id=user.id)
    per: dict = {}
    for a in r["assigned"]:
        for n in a["reviewers"]:
            per[n] = per.get(n, 0) + 1
    return {"assigned": len(r["assigned"]), "left": r["left"], "reason": r["reason"], "per_person": per, "view": _view(db, user, p)}


class ReviewerSettings(BaseModel):
    auto: bool | None = None
    count: int | None = None


@router.put("/{project_id}/reviewers-auto")
def reviewers_auto(project_id: str, body: ReviewerSettings, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not (_roles(user) & {"org_admin", "project_admin"}):
        raise HTTPException(status_code=403, detail="Only admins can change this.")
    p = _project(db, user, project_id)
    rev.set_settings(db, p.id, auto=body.auto, count=body.count)
    db.commit()
    return _view(db, user, p)
