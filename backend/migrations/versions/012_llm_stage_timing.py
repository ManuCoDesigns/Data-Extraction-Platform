"""Add llm_verification_started_at / completed_at to sources — tracks the
LLM verification pipeline stage explicitly so it shows up in Team Workload
and the client timesheet export like every other stage.

Revision ID: 012_llm_stage_timing
Revises: 011_restore_admin_review
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '012_llm_stage_timing'
down_revision = '011_restore_admin_review'


def _exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    for col in ["llm_verification_started_at", "llm_verification_completed_at"]:
        if not _exists("sources", col):
            op.add_column("sources", sa.Column(col, sa.DateTime(timezone=True), nullable=True))


def downgrade():
    pass
