"""Fix the record-count-accumulation bug: audit_log.record_id, audit_log.job_id,
llm_call_log.job_id, and submission_batches.job_id had no ON DELETE rule, so
Postgres silently blocked deletion of old ExtractionJobs/ExtractedRecords on
re-upload (any review activity creates audit log rows referencing them).
Old data was never actually cleared — new uploads just added on top of it,
which is why record counts kept climbing (e.g. 430 old + 200 new = 630).

Revision ID: 014_fix_job_delete_fks
Revises: 013_reset_tracking
"""
from alembic import op
from sqlalchemy import text

revision = '014_fix_job_delete_fks'
down_revision = '013_reset_tracking'


def _fk_name(table, column):
    """Find the actual constraint name Postgres assigned, since it may not
    match our guess (Alembic/SQLAlchemy naming conventions vary by version)."""
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


def _drop_and_recreate(table, column, ref_table, on_delete):
    name = _fk_name(table, column)
    if name:
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
    op.execute(
        f'ALTER TABLE {table} ADD CONSTRAINT fk_{table}_{column} '
        f'FOREIGN KEY ({column}) REFERENCES {ref_table}(id) ON DELETE {on_delete}'
    )


def upgrade():
    # Preserve audit/history rows — just detach them from the deleted parent
    _drop_and_recreate("audit_log", "record_id", "extracted_records", "SET NULL")
    _drop_and_recreate("audit_log", "job_id", "extraction_jobs", "SET NULL")
    if _fk_name("audit_log", "source_id"):
        _drop_and_recreate("audit_log", "source_id", "sources", "SET NULL")

    # LLM call logs are disposable once their record is gone
    _drop_and_recreate("llm_call_log", "job_id", "extraction_jobs", "CASCADE")

    # Submission batches are delivery history — preserve, just detach
    op.execute("ALTER TABLE submission_batches ALTER COLUMN job_id DROP NOT NULL")
    _drop_and_recreate("submission_batches", "job_id", "extraction_jobs", "SET NULL")


def downgrade():
    pass
