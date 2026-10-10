"""
Who may see which source.

Rule: extractors and reviewers see only the sources assigned to them (as the
extractor or as the reviewer). Org admins, project admins, QA leads and
read-only members see every source in the projects they belong to. Nobody sees
a project they are not a member of (org admins excepted).

Everything here is enforced on the server; hiding things in the UI is only a
convenience on top of it.
"""
from fastapi import HTTPException
from sqlalchemy import and_, false, or_

from app.models.all_models import ExtractionJob, ProjectMember, Source

# Global roles that see every source in the projects they can open.
_GLOBAL_FULL = {"org_admin", "project_admin", "qa_lead"}
# Project-level roles that see every source in that project.
_PROJECT_FULL = {"org_admin", "project_admin", "qa_lead", "read_only"}


def _global_roles(user) -> set:
    return {r.role.value for r in user.roles}


def is_org_admin(user) -> bool:
    return "org_admin" in _global_roles(user)


def _memberships(user, db) -> dict:
    return {m.project_id: m.role.value for m in db.query(ProjectMember).filter(ProjectMember.user_id == user.id).all()}


def project_scopes(user, db) -> tuple[set, set]:
    """(project ids where the user sees every source, project ids where only assigned ones)."""
    member_of = _memberships(user, db)
    if _global_roles(user) & _GLOBAL_FULL:
        return set(member_of), set()
    full = {pid for pid, role in member_of.items() if role in _PROJECT_FULL}
    return full, set(member_of) - full


def restrict_sources_query(q, user, db):
    """
    Narrows a query that involves the Source table to the sources this user may
    see. Org admins are unchanged. Everyone else is limited to their projects,
    and extractors/reviewers further to the sources assigned to them.
    """
    if is_org_admin(user):
        return q
    full, restricted = project_scopes(user, db)
    mine = or_(Source.assigned_extractor_id == user.id, Source.assigned_reviewer_id == user.id)
    clauses = []
    if full:
        clauses.append(Source.project_id.in_(full))
    if restricted:
        clauses.append(and_(Source.project_id.in_(restricted), mine))
    return q.filter(or_(*clauses)) if clauses else q.filter(false())


def can_view_source(user, source, db) -> bool:
    if is_org_admin(user):
        return True
    full, restricted = project_scopes(user, db)
    if source.project_id in full:
        return True
    return source.project_id in restricted and user.id in (source.assigned_extractor_id, source.assigned_reviewer_id)


def assert_can_view_source(user, source, db) -> None:
    if not can_view_source(user, source, db):
        raise HTTPException(status_code=403, detail="This source isn't assigned to you.")


def can_view_job(user, job, db) -> bool:
    """A job is visible with its source; a job with no source needs full access to its project."""
    if is_org_admin(user):
        return True
    if job.source_id:
        src = db.query(Source).filter(Source.id == job.source_id).first()
        return bool(src) and can_view_source(user, src, db)
    full, _ = project_scopes(user, db)
    return job.project_id in full


def assert_can_view_job(user, job, db) -> None:
    if not can_view_job(user, job, db):
        raise HTTPException(status_code=403, detail="This item isn't assigned to you.")


def restrict_jobs_query(q, user, db):
    """Same idea for a query on ExtractionJob."""
    if is_org_admin(user):
        return q
    full, _ = project_scopes(user, db)
    visible = restrict_sources_query(db.query(Source.id), user, db).subquery()
    clauses = [ExtractionJob.source_id.in_(visible)]
    if full:
        clauses.append(and_(ExtractionJob.source_id == None, ExtractionJob.project_id.in_(full)))  # noqa: E711
    return q.filter(or_(*clauses))


# Whole-project downloads hand over every source's data, so they are for the
# people who manage the project, not for extractors/reviewers.
_EXPORT_ROLES = {"org_admin", "project_admin", "qa_lead"}


def assert_project_export_access(user, project_id, db) -> None:
    if is_org_admin(user):
        return
    role = _memberships(user, db).get(project_id)
    if role is not None and (role in _EXPORT_ROLES or _global_roles(user) & {"project_admin", "qa_lead"}):
        return
    raise HTTPException(status_code=403, detail="Only project admins and QA leads can download whole-project data.")
