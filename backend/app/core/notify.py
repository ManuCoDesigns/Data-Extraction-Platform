"""Creating notifications: one place, so every event reads and behaves the same.

priority: "action" = this person has to do something (shown in red, with an "Open" button)
          "info"   = good to know
Repeats are suppressed: if the same person already has an unread notice with the same title,
a second one is not added (so returning 13 records at once makes one notice, not 13).
"""
from app.models.all_models import Notification, ProjectMember, UserRole, UserRoleAssignment

ACTION = "action"
INFO = "info"


def src_link(source) -> str:
    return f"/projects/{source.project_id}/sources/{source.id}"


def notify(db, user_id, title, body, link=None, kind="general", priority=INFO, dedupe=True):
    if not user_id:
        return None
    if dedupe:
        dup = (
            db.query(Notification.id)
            .filter(Notification.user_id == user_id, Notification.is_read == False,  # noqa: E712
                    Notification.title == title)
            .first()
        )
        if dup:
            return None
    n = Notification(user_id=user_id, title=title[:255], body=body, link=link, kind=kind, priority=priority)
    db.add(n)
    if priority == ACTION:
        try:
            from app.core.mailer import queue_email
            queue_email(db, user_id, title[:255], body, link, True)
        except Exception:
            pass
    return n


def admin_user_ids(db, project_id) -> set:
    """Org admins, plus the project's admins and QA leads: the people who sign work off."""
    ids = {a.user_id for a in db.query(UserRoleAssignment).filter(UserRoleAssignment.role == UserRole.ORG_ADMIN).all()}
    ids |= {m.user_id for m in db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.role.in_([UserRole.PROJECT_ADMIN, UserRole.QA_LEAD])).all()}
    return ids
