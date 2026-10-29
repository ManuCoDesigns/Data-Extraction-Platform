"""Background loop: stalled-work reminders every 30 minutes and one digest email a day for admins."""
import asyncio
import logging
from datetime import datetime, timezone

from app.core.config import settings

log = logging.getLogger("scheduler")


def _tick():
    from app.db.session import SessionLocal
    from app.models.all_models import ReminderLog, User, UserRole, UserRoleAssignment, UserSettings
    from app.services import enh
    from app.core import mailer
    db = SessionLocal()
    try:
        enh.run_reminders(db)
        try:
            from app.services import balance, distribute
            distribute.run_all(db)
            balance.run_all(db)
        except Exception as e:
            log.warning("balance failed: %s", e)
            db.rollback()
        now = datetime.now(timezone.utc)
        key = f"digest:{now.strftime('%Y-%m-%d')}"
        if mailer.enabled() and now.hour >= settings.DIGEST_HOUR_UTC and not db.query(ReminderLog.key).filter(ReminderLog.key == key).first():
            db.add(ReminderLog(key=key))
            db.commit()
            lead_ids = {a.user_id for a in db.query(UserRoleAssignment).filter(
                UserRoleAssignment.role.in_([UserRole.ORG_ADMIN, UserRole.PROJECT_ADMIN, UserRole.QA_LEAD])).all()}
            for u in db.query(User).filter(User.id.in_(lead_ids), User.is_active == True).all():  # noqa: E712
                st = db.query(UserSettings).filter(UserSettings.user_id == u.id).first()
                if st is not None and not st.email_digest:
                    continue
                d = enh.build_digest(db, u)
                if d["totals"]["open"] == 0 and d["totals"]["approved_24h"] == 0:
                    continue
                text, html = enh.digest_text(d)
                mailer.send_now(u.email, "Daily digest: what is waiting on whom", text, html)
    except Exception as e:
        log.warning("scheduler tick failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


async def _loop():
    await asyncio.sleep(90)       # let the app finish starting
    while True:
        await asyncio.get_running_loop().run_in_executor(None, _tick)
        await asyncio.sleep(1800)


def start_scheduler():
    if not settings.REMINDERS_ENABLED:
        return None
    try:
        return asyncio.get_running_loop().create_task(_loop())
    except RuntimeError:
        return None
