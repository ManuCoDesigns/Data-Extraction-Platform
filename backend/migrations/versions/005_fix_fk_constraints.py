"""Fix FK constraints on extraction_jobs child tables

Revision ID: 005_fix_fk_constraints
Revises: 004_web_verification
Create Date: 2026-06-28

Adds ON DELETE SET NULL to audit_log.job_id and
ON DELETE CASCADE to submission_batches.job_id and llm_call_log.job_id.
This means when an extraction_job is deleted, Postgres handles all
child rows automatically — no FK violations ever.
"""
from alembic import op
from sqlalchemy import text

revision = '005_fix_fk_constraints'
down_revision = '004_web_verification'
branch_labels = None
depends_on = None


def _constraint_exists(constraint_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE constraint_name = :name"
    ), {"name": constraint_name})
    return result.fetchone() is not None


def upgrade():
    # audit_log.job_id → ON DELETE SET NULL  (job deleted = preserve log, just null the ref)
    if _constraint_exists("audit_log_job_id_fkey"):
        op.drop_constraint("audit_log_job_id_fkey", "audit_log", type_="foreignkey")
    op.create_foreign_key(
        "audit_log_job_id_fkey",
        "audit_log", "extraction_jobs",
        ["job_id"], ["id"],
        ondelete="SET NULL",
    )

    # submission_batches.job_id → ON DELETE CASCADE  (job deleted = delete batch)
    if _constraint_exists("submission_batches_job_id_fkey"):
        op.drop_constraint("submission_batches_job_id_fkey", "submission_batches", type_="foreignkey")
    op.create_foreign_key(
        "submission_batches_job_id_fkey",
        "submission_batches", "extraction_jobs",
        ["job_id"], ["id"],
        ondelete="CASCADE",
    )

    # llm_call_log.job_id → ON DELETE CASCADE  (job deleted = delete log entries)
    if _constraint_exists("llm_call_log_job_id_fkey"):
        op.drop_constraint("llm_call_log_job_id_fkey", "llm_call_log", type_="foreignkey")
    op.create_foreign_key(
        "llm_call_log_job_id_fkey",
        "llm_call_log", "extraction_jobs",
        ["job_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade():
    # Restore original constraints (no ondelete)
    op.drop_constraint("audit_log_job_id_fkey", "audit_log", type_="foreignkey")
    op.create_foreign_key(
        "audit_log_job_id_fkey", "audit_log", "extraction_jobs",
        ["job_id"], ["id"],
    )
    op.drop_constraint("submission_batches_job_id_fkey", "submission_batches", type_="foreignkey")
    op.create_foreign_key(
        "submission_batches_job_id_fkey", "submission_batches", "extraction_jobs",
        ["job_id"], ["id"],
    )
    op.drop_constraint("llm_call_log_job_id_fkey", "llm_call_log", type_="foreignkey")
    op.create_foreign_key(
        "llm_call_log_job_id_fkey", "llm_call_log", "extraction_jobs",
        ["job_id"], ["id"],
    )
