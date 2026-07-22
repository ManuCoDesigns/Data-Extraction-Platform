"""Make extraction_jobs.schema_id nullable — missed in earlier schema-optional migration

Revision ID: 010_job_schema_id_optional
Revises: 009_schema_version_optional
"""
from alembic import op
import sqlalchemy as sa

revision = '010_job_schema_id_optional'
down_revision = '009_schema_version_optional'


def upgrade():
    op.alter_column(
        "extraction_jobs", "schema_id",
        existing_type=sa.String(36),
        nullable=True,
    )


def downgrade():
    pass  # cannot safely downgrade if any rows have NULL schema_id
