"""Make schema_version nullable on extraction_jobs, extracted_records, submission_batches

Revision ID: 009_schema_version_optional
Revises: 008_source_schema_optional
"""
from alembic import op
import sqlalchemy as sa

revision = '009_schema_version_optional'
down_revision = '008_source_schema_optional'


def upgrade():
    op.alter_column(
        "extraction_jobs", "schema_version",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.alter_column(
        "extracted_records", "schema_version",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.alter_column(
        "submission_batches", "schema_version",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade():
    pass  # cannot safely downgrade if any rows have NULL schema_version
