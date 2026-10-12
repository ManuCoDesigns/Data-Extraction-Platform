"""Link checks, client questions, reminder log and user settings.

Revision ID: 026_enhancements
Revises: 025_notification_priority
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '026_enhancements'
down_revision = '025_notification_priority'


def _table_exists(name):
    return op.get_bind().execute(text(
        "SELECT 1 FROM information_schema.tables WHERE table_name=:t"), {"t": name}).fetchone() is not None


def upgrade():
    if not _table_exists("source_link_checks"):
        op.create_table(
            "source_link_checks",
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("url", sa.String(1024)),
            sa.Column("status", sa.String(20), nullable=False, server_default="unchecked"),
            sa.Column("http_code", sa.Integer),
            sa.Column("detail", sa.String(500)),
            sa.Column("final_url", sa.String(1024)),
            sa.Column("manual", sa.Boolean, nullable=False, server_default="false"),
            sa.Column("checked_at", sa.DateTime(timezone=True)),
            sa.Column("checked_by", sa.String(36)),
        )
    if not _table_exists("client_questions"):
        op.create_table(
            "client_questions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="SET NULL"), index=True),
            sa.Column("question", sa.Text, nullable=False),
            sa.Column("answer", sa.Text),
            sa.Column("status", sa.String(12), nullable=False, server_default="open"),
            sa.Column("asked_by", sa.String(36), sa.ForeignKey("users.id")),
            sa.Column("answered_by", sa.String(36), sa.ForeignKey("users.id")),
            sa.Column("sent_to_client_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True)),
            sa.Column("answered_at", sa.DateTime(timezone=True)),
        )
    if not _table_exists("reminder_log"):
        op.create_table(
            "reminder_log",
            sa.Column("key", sa.String(200), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True)),
        )
    if not _table_exists("user_settings"):
        op.create_table(
            "user_settings",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("email_alerts", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("email_digest", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("totp_secret", sa.String(64)),
            sa.Column("totp_enabled", sa.Boolean, nullable=False, server_default="false"),
            sa.Column("failed_logins", sa.Integer, nullable=False, server_default="0"),
            sa.Column("locked_until", sa.DateTime(timezone=True)),
        )


def downgrade():
    pass
