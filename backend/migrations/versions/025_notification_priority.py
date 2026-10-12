"""Notifications get a kind and a priority (action needed vs good to know).

Revision ID: 025_notification_priority
Revises: 024_source_peer_reviews
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '025_notification_priority'
down_revision = '024_source_peer_reviews'


def _column_exists(table, column):
    conn = op.get_bind()
    return conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone() is not None


def upgrade():
    if not _column_exists("notifications", "kind"):
        op.add_column("notifications", sa.Column("kind", sa.String(40), nullable=True))
    if not _column_exists("notifications", "priority"):
        op.add_column("notifications", sa.Column("priority", sa.String(10), nullable=False, server_default="info"))


def downgrade():
    pass
