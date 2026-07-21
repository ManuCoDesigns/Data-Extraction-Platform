"""Make sources.schema_id nullable — allow sources with no fixed schema

Revision ID: 008_source_schema_optional
Revises: 007_admin_review_tracking
"""
from alembic import op
import sqlalchemy as sa

revision = '008_source_schema_optional'
down_revision = '007_admin_review_tracking'


def upgrade():
    op.alter_column(
        "sources", "schema_id",
        existing_type=sa.String(36),
        nullable=True,
    )


def downgrade():
    # Cannot safely downgrade if any rows have NULL schema_id
    pass
