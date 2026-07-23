"""Root-cause fix for the recurring "referential integrity query gave
unexpected result" error on deletes touching extracted_records/extraction_jobs.

Timeline:
  - Before migration 014: audit_log.record_id/job_id had NO ondelete rule,
    so bulk deletes were silently BLOCKED by Postgres whenever any audit
    trail existed for the row — this is what caused the record-count
    accumulation bug (old + new records summed instead of replaced).
  - Migration 014 altered these constraints in place (DROP + ADD with
    ON DELETE SET NULL) to fix that. That ALTER is what introduced this
    new, much stranger error — a well-documented Postgres quirk where an
    in-place DROP+ADD of a FK constraint can leave its internal RI trigger
    in a corrupted state that persists no matter how many times it's
    re-altered afterwards.

The fix: stop enforcing these as database-level foreign keys at all.
audit_log is a logging table — it doesn't need referential integrity
enforced by Postgres; the application already nulls out references
correctly before deleting. Removing the constraint removes the corrupted
trigger along with it, permanently.

Revision ID: 015_drop_audit_log_fks
Revises: 014_fix_job_delete_fks
"""
from alembic import op
from sqlalchemy import text

revision = '015_drop_audit_log_fks'
down_revision = '014_fix_job_delete_fks'


def _fk_name(table, column):
    conn = op.get_bind()
    row = conn.execute(text("""
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = :t AND kcu.column_name = :c
          AND tc.constraint_type = 'FOREIGN KEY'
    """), {"t": table, "c": column}).fetchone()
    return row[0] if row else None


def upgrade():
    for column in ("record_id", "job_id", "source_id"):
        name = _fk_name("audit_log", column)
        if name:
            op.execute(f'ALTER TABLE audit_log DROP CONSTRAINT "{name}"')

    # llm_call_log.job_id was CASCADE (working fine, never implicated in the
    # errors) — leave it alone. Same for submission_batches.job_id.


def downgrade():
    pass
