"""Email alerts. Off until SMTP_HOST is set. Messages are queued on the database session and only sent
after the change is committed, so nobody gets an email about something that was rolled back."""
import logging
import smtplib
import threading
from email.message import EmailMessage
from html import escape

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import settings

log = logging.getLogger("mailer")


def enabled() -> bool:
    return bool(settings.SMTP_HOST)


def _sender() -> str:
    return settings.SMTP_FROM or settings.SMTP_USER or "alerts@localhost"


def full_link(link: str | None) -> str | None:
    if not link:
        return None
    if link.startswith("http"):
        return link
    base = (settings.APP_BASE_URL or "").rstrip("/")
    return f"{base}{link}" if base else None


def render(title: str, body: str, link: str | None, action: bool) -> tuple[str, str]:
    url = full_link(link)
    text = f"{title}\n\n{body or ''}\n" + (f"\nOpen it: {url}\n" if url else "") + "\nYou get this because you are on the Data Extraction Platform."
    colour = "#dc2626" if action else "#4f46e5"
    button = (f'<p style="margin:20px 0 0"><a href="{escape(url)}" style="background:{colour};color:#fff;text-decoration:none;'
              f'padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Open in the platform</a></p>') if url else ""
    badge = ('<span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px">ACTION NEEDED</span>'
             if action else "")
    html = (f'<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">'
            f'{badge}<h2 style="font-size:18px;margin:10px 0 8px">{escape(title)}</h2>'
            f'<p style="font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;margin:0">{escape(body or "")}</p>{button}'
            f'<p style="font-size:12px;color:#94a3b8;margin-top:28px">Sent by the Data Extraction Platform. '
            f'You can turn email alerts off on your Profile page.</p></div>')
    return text, html


def send_now(to: str, subject: str, text: str, html: str | None = None) -> bool:
    if not enabled() or not to:
        return False
    try:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = _sender(), to, subject
        msg.set_content(text)
        if html:
            msg.add_alternative(html, subtype="html")
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            try:
                s.starttls()
            except smtplib.SMTPException:
                pass
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as e:  # never let a mail problem break the app
        log.warning("email to %s failed: %s", to, e)
        return False


def queue_email(db: Session, user_id: str, title: str, body: str, link: str | None, action: bool = True):
    if enabled() and user_id:
        db.info.setdefault("_emails", []).append((user_id, title, body, link, action))


def _deliver(items):
    try:
        from app.db.session import SessionLocal
        from app.models.all_models import User, UserSettings
        db = SessionLocal()
        try:
            for user_id, title, body, link, action in items:
                u = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
                if not u or not u.email:
                    continue
                st = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
                if st is not None and not st.email_alerts:
                    continue
                text, html = render(title, body, link, action)
                send_now(u.email, ("[Action needed] " if action else "") + title, text, html)
        finally:
            db.close()
    except Exception as e:
        log.warning("email delivery failed: %s", e)


@event.listens_for(Session, "after_commit")
def _send_after_commit(session):
    items = session.info.pop("_emails", None)
    if items:
        threading.Thread(target=_deliver, args=(items,), daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _drop_on_rollback(session):
    session.info.pop("_emails", None)
