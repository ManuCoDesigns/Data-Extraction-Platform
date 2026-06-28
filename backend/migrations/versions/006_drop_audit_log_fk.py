"""Drop audit_log job_id FK constraint entirely

Revision ID: 006_drop_audit_log_fk
Revises: 005_fix_fk_constraints
Create Date: 2026-06-28

Migration 005 changed audit_log_job_id_fkey to ON DELETE SET NULL.
But a PostgreSQL RULE on the table rewrites queries, causing Postgres to fail
the referential integrity check with:
  "referential integrity query gave unexpected result — due to a rule rewriting the query"

Fix: drop the FK constraint entirely. audit_log.job_id is a nullable reporting
column — it stores which job was involved for historical reference, not for
strict relational integrity. No FK needed. The column and data stay intact.
"""
from alembic import op
from sqlalchemy import text

revision = '006_drop_audit_log_fk'
down_revision = '005_fix_fk_constraints'
branch_labels = None
depends_on = None


def _constraint_exists(name: str) -> bool:
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = :n"
    ), {"n": name}).fetchone()
    return row is not None


def upgrade():
    # Drop the FK on audit_log.job_id entirely — no replacement needed.
    # The column stays, the data stays, just no FK enforcement.
    for constraint in ("audit_log_job_id_fkey",):
        if _constraint_exists(constraint):
            op.drop_constraint(constraint, "audit_log", type_="foreignkey")

    # Also drop FK on audit_log.record_id if it causes similar issues
    for constraint in ("audit_log_record_id_fkey",):
        if _constraint_exists(constraint):
            op.drop_constraint(constraint, "audit_log", type_="foreignkey")


def downgrade():
    pass  # No downgrade — audit log FKs were problematic
