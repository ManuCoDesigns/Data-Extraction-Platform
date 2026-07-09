"""Admin review, revision tracking, time columns

Revision ID: 008_admin_review_tracking
Revises: 007_perf_indexes
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '008_admin_review_tracking'
down_revision = '007_perf_indexes'


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
    # ── Extend enums ─────────────────────────────────────────────────────────
    if not _enum_has("reviewstatus", "pending_admin_review"):
        op.execute("ALTER TYPE reviewstatus ADD VALUE 'pending_admin_review'")

    if not _enum_has("auditaction", "record_admin_reviewed"):
        op.execute("ALTER TYPE auditaction ADD VALUE 'record_admin_reviewed'")
    if not _enum_has("auditaction", "record_returned_for_correction"):
        op.execute("ALTER TYPE auditaction ADD VALUE 'record_returned_for_correction'")
    if not _enum_has("auditaction", "record_revision_started"):
        op.execute("ALTER TYPE auditaction ADD VALUE 'record_revision_started'")
    if not _enum_has("auditaction", "record_sent_to_admin"):
        op.execute("ALTER TYPE auditaction ADD VALUE 'record_sent_to_admin'")

    # ── New columns on extracted_records ─────────────────────────────────────
    cols = [
        ("admin_review_note",       sa.Text(),                              None),
        ("admin_reviewed_by",       sa.String(36),                          None),
        ("admin_reviewed_at",       sa.DateTime(timezone=True),             None),
        ("revision_count",          sa.Integer(),                           "0"),
        ("correction_count",        sa.Integer(),                           "0"),
        ("extraction_started_at",   sa.DateTime(timezone=True),             None),
        ("review_started_at",       sa.DateTime(timezone=True),             None),
        ("admin_review_started_at", sa.DateTime(timezone=True),             None),
        ("reviewer_field_comments", sa.JSON(),                              "{}"),
    ]
    for col, typ, default in cols:
        if not _exists("extracted_records", col):
            op.add_column("extracted_records",
                sa.Column(col, typ, nullable=True,
                    server_default=default) if default else
                sa.Column(col, typ, nullable=True)
            )

    # FK for admin_reviewed_by
    try:
        op.create_foreign_key(
            "fk_records_admin_reviewer",
            "extracted_records", "users",
            ["admin_reviewed_by"], ["id"]
        )
    except Exception:
        pass

    # Index for admin review queue
    try:
        op.create_index("ix_records_admin_review",
            "extracted_records", ["review_status", "admin_reviewed_by"])
    except Exception:
        pass


def downgrade():
    pass  # enum values cannot be removed in Postgres
