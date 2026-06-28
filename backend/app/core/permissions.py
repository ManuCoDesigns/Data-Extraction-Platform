"""
Capability-based permissions layer.

Role checks scattered as `require_roles("org_admin", "project_admin")` get
brittle as new roles are added, since every new role means re-checking every
call site that cares about that capability. This module defines what each
GLOBAL role can do once; routes check capabilities, not role names.

Note: this only models global roles (UserRoleAssignment / user.roles). Project-
scoped checks ("is this user a reviewer on THIS specific project") still need
the per-project logic in project_resources.py / work_submissions.py, since a
user's project-level role (ProjectMember.role) is a separate dimension from
their global role — a user can be globally "reviewer" but locally
"project_admin" on one specific project, or vice versa. Use this module for
global, not-project-scoped checks (e.g. "can manage users platform-wide").

New routes use this where the check is global-only. Existing routes
(projects, users, jobs, schemas) still use the original `require_roles`
dependency in app/core/security.py — migrate them here incrementally, since
swapping every working endpoint in one pass is needless risk.
"""
from enum import Enum
from fastapi import Depends, HTTPException, status
from app.core.security import get_current_user


class Capability(str, Enum):
    MANAGE_USERS = "manage_users"
    MANAGE_PROJECTS = "manage_projects"
    MANAGE_PROJECT_MEMBERS = "manage_project_members"
    MANAGE_PROJECT_RESOURCES = "manage_project_resources"
    MANAGE_SCHEMAS = "manage_schemas"
    UPLOAD_EXTRACTION_JOBS = "upload_extraction_jobs"
    SUBMIT_WORK = "submit_work"
    REVIEW_SUBMISSIONS = "review_submissions"
    REVIEW_RECORDS = "review_records"
    VIEW_ALL_PROJECTS = "view_all_projects"


# Add a new role to this platform? Define its capability set here — nowhere else.
ROLE_CAPABILITIES: dict[str, set] = {
    "org_admin": set(Capability),  # everything
    "project_admin": {
        Capability.MANAGE_PROJECT_MEMBERS,
        Capability.MANAGE_PROJECT_RESOURCES,
        Capability.MANAGE_SCHEMAS,
        Capability.UPLOAD_EXTRACTION_JOBS,
        Capability.REVIEW_SUBMISSIONS,
        Capability.REVIEW_RECORDS,
        Capability.SUBMIT_WORK,
        Capability.VIEW_ALL_PROJECTS,
    },
    "qa_lead": {
        Capability.REVIEW_SUBMISSIONS,
        Capability.REVIEW_RECORDS,
        Capability.SUBMIT_WORK,
        Capability.UPLOAD_EXTRACTION_JOBS,
    },
    "pipeline_operator": {
        Capability.UPLOAD_EXTRACTION_JOBS,
        Capability.SUBMIT_WORK,
    },
    "reviewer": {
        Capability.REVIEW_SUBMISSIONS,
        Capability.REVIEW_RECORDS,
    },
    "read_only": set(),
}


def user_capabilities(user) -> set:
    caps: set = set()
    for r in user.roles:
        caps |= ROLE_CAPABILITIES.get(r.role.value, set())
    return caps


def has_capability(user, capability: Capability) -> bool:
    return capability in user_capabilities(user)


def require_capability(*capabilities: Capability):
    """Dependency factory — require at least one of the given capabilities, globally."""
    async def _checker(current_user=Depends(get_current_user)):
        if not user_capabilities(current_user).intersection(set(capabilities)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Requires one of: {[c.value for c in capabilities]}",
            )
        return current_user
    return _checker