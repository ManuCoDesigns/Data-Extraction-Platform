"""Track source resets properly: preserve the extraction timer through a
reset, log the event with a real source_id link, and count how many times
a source has been reset (e.g. because the wrong file was uploaded).

Revision ID: 013_reset_tracking
Revises: 012_llm_stage_timing
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '013_reset_tracking'
down_revision = '012_llm_stage_timing'


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
    if not _exists("sources", "reset_count"):
        op.add_column("sources", sa.Column("reset_count", sa.Integer(), nullable=False, server_default="0"))

    if not _exists("audit_log", "source_id"):
        op.add_column("audit_log", sa.Column("source_id", sa.String(36), nullable=True))
        try:
            op.create_foreign_key(
                "fk_audit_log_source", "audit_log", "sources", ["source_id"], ["id"]
            )
        except Exception:
            pass
        try:
            op.create_index("ix_audit_log_source_id", "audit_log", ["source_id"])
        except Exception:
            pass

    if not _enum_has("auditaction", "source_reset"):
        op.execute("ALTER TYPE auditaction ADD VALUE 'source_reset'")


def downgrade():
    pass
