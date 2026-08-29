"""Add external-integration reference fields to sources — lets a Source be
linked back to an item pulled from an external system (Xtrium Catalog IQ
being the first). Nullable, so this has zero effect on sources created any
other way.

Revision ID: 017_external_integration_ref
Revises: 016_source_category
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '017_external_integration_ref'
down_revision = '016_source_category'


def _exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _exists("sources", "external_system"):
        op.add_column("sources", sa.Column("external_system", sa.String(100), nullable=True))
    if not _exists("sources", "external_ref_id"):
        op.add_column("sources", sa.Column("external_ref_id", sa.String(255), nullable=True))
        op.create_index("ix_sources_external_ref_id", "sources", ["external_ref_id"])
    if not _exists("sources", "external_synced_at"):
        op.add_column("sources", sa.Column("external_synced_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    pass
