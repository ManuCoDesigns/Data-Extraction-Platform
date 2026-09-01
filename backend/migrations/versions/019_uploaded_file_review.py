"""Add review fields to uploaded_file_entries — a lightweight approve/reject/
note flow for raw files (manifests, QA checklists, review logs) that never
become ExtractedRecords and so previously had no review workflow at all.

review_status is a plain VARCHAR (not a Postgres native enum) — this matches
the codebase's established pattern for status-like columns elsewhere (e.g.
SubmissionBatch.status) and avoids the native-enum migration complications
this project has run into before.

Revision ID: 019_uploaded_file_review
Revises: 018_uploaded_file_entries
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '019_uploaded_file_review'
down_revision = '018_uploaded_file_entries'


def _column_exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _column_exists("uploaded_file_entries", "review_status"):
        op.add_column("uploaded_file_entries",
            sa.Column("review_status", sa.String(20), nullable=False, server_default="pending"))
    if not _column_exists("uploaded_file_entries", "review_note"):
        op.add_column("uploaded_file_entries", sa.Column("review_note", sa.Text, nullable=True))
    if not _column_exists("uploaded_file_entries", "reviewed_by"):
        op.add_column("uploaded_file_entries",
            sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True))
    if not _column_exists("uploaded_file_entries", "reviewed_at"):
        op.add_column("uploaded_file_entries", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    pass
