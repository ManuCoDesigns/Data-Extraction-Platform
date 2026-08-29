"""Add uploaded_file_entries — byte-for-byte preservation of every file (and,
for ZIP uploads, every empty directory entry) in a folder/ZIP upload,
independent of parsing. This is what lets the exact original structure be
browsed and re-downloaded later, regardless of what got turned into records.

Revision ID: 018_uploaded_file_entries
Revises: 017_external_integration_ref
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '018_uploaded_file_entries'
down_revision = '017_external_integration_ref'


def _table_exists(table):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.tables WHERE table_name=:t"
    ), {"t": table}).fetchone()
    return row is not None


def upgrade():
    if not _table_exists("uploaded_file_entries"):
        op.create_table(
            "uploaded_file_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("job_id", sa.String(36),
                      sa.ForeignKey("extraction_jobs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("relative_path", sa.String(2048), nullable=False),
            sa.Column("is_directory", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("content", sa.LargeBinary, nullable=True),
            sa.Column("size_bytes", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_uploaded_file_entries_job", "uploaded_file_entries", ["job_id"])


def downgrade():
    pass
