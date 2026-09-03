"""Add country/type columns to sources — previously these lived only inside
the free-text description blob, unavailable for structured display,
filtering, or grouping. Matches how category already works.

Revision ID: 020_source_country_type
Revises: 019_uploaded_file_review
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '020_source_country_type'
down_revision = '019_uploaded_file_review'


def _column_exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _column_exists("sources", "country"):
        op.add_column("sources", sa.Column("country", sa.String(255), nullable=True))
        op.create_index("ix_sources_country", "sources", ["country"])
    if not _column_exists("sources", "type"):
        op.add_column("sources", sa.Column("type", sa.String(255), nullable=True))
        op.create_index("ix_sources_type", "sources", ["type"])


def downgrade():
    pass
