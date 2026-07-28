"""Add sources.category — groups sources into collapsible sub-folders
within a single project (e.g. "Government Agency", "Materials Database"),
matching the client's source-tracking sheet's own category column.

Revision ID: 016_source_category
Revises: 015_drop_audit_log_fks
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '016_source_category'
down_revision = '015_drop_audit_log_fks'


def _exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _exists("sources", "category"):
        op.add_column("sources", sa.Column("category", sa.String(255), nullable=True))
        op.create_index("ix_sources_category", "sources", ["category"])


def downgrade():
    pass
