"""Per-user display preferences (timezone, date and time format).

Revision ID: 027_user_prefs
Revises: 026_enhancements
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '027_user_prefs'
down_revision = '026_enhancements'


def _has_column(table, col):
    return op.get_bind().execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"),
        {"t": table, "c": col}).fetchone() is not None


def upgrade():
    if not _has_column("user_settings", "prefs"):
        op.add_column("user_settings", sa.Column("prefs", sa.JSON(), nullable=True))


def downgrade():
    if _has_column("user_settings", "prefs"):
        op.drop_column("user_settings", "prefs")
