"""Add xtrium_submitted_at to sources — distinct from external_synced_at,
set only on a successful submit so we can reliably warn on resubmission.

Revision ID: 022_xtrium_submitted_at
Revises: 021_escalation_only_records
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '022_xtrium_submitted_at'
down_revision = '021_escalation_only_records'


def _column_exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _column_exists("sources", "xtrium_submitted_at"):
        op.add_column("sources", sa.Column("xtrium_submitted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    pass
