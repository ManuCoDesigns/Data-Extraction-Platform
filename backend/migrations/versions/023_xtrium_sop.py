"""Add xtrium_sop to sources — a saved copy of the SOP Xtrium provides for the
item, so extractors can read it even when Xtrium is unreachable.

Revision ID: 023_xtrium_sop
Revises: 022_xtrium_submitted_at
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '023_xtrium_sop'
down_revision = '022_xtrium_submitted_at'


def _column_exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _column_exists("sources", "xtrium_sop"):
        op.add_column("sources", sa.Column("xtrium_sop", sa.JSON(), nullable=True))


def downgrade():
    pass
