"""Add admin review, revision tracking, time columns

Revision ID: 007_admin_review_tracking
Revises: 006_drop_audit_log_fk
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '007_admin_review_tracking'
down_revision = '006_drop_audit_log_fk'


def _exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def _enum_has(enum_type, value):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid "
        "WHERE t.typname=:n AND e.enumlabel=:v"
    ), {"n": enum_type, "v": value}).fetchone()
    return row is not None


def upgrade():
    # Extend enums
    if not _enum_has("reviewstatus", "pending_admin_review"):
        op.execute("ALTER TYPE reviewstatus ADD VALUE 'pending_admin_review'")

    for val in ["record_admin_reviewed", "record_returned_for_correction",
                "record_revision_started", "record_sent_to_admin"]:
        if not _enum_has("auditaction", val):
            op.execute(f"ALTER TYPE auditaction ADD VALUE '{val}'")

    # New columns on extracted_records
    cols = [
        ("admin_review_note",       sa.Text(),                  None),
        ("admin_reviewed_by",       sa.String(36),              None),
        ("admin_reviewed_at",       sa.DateTime(timezone=True), None),
        ("revision_count",          sa.Integer(),               "0"),
        ("correction_count",        sa.Integer(),               "0"),
        ("extraction_started_at",   sa.DateTime(timezone=True), None),
        ("review_started_at",       sa.DateTime(timezone=True), None),
        ("admin_review_started_at", sa.DateTime(timezone=True), None),
        ("reviewer_field_comments", sa.JSON(),                  "{}"),
    ]
    for col, typ, default in cols:
        if not _exists("extracted_records", col):
            op.add_column("extracted_records",
                sa.Column(col, typ, nullable=True, server_default=default)
                if default else
                sa.Column(col, typ, nullable=True)
            )


def downgrade():
    pass
