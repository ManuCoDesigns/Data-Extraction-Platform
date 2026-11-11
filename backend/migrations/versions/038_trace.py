"""Trace what we asked, what blocked us and when: escalation times, clock-blocking flag, and waiting periods.

Revision ID: 038_trace
Revises: 037_submit_count
"""
from alembic import op
import sqlalchemy as sa

revision = '038_trace'
down_revision = '037_submit_count'


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("client_questions")]
    if "kind" not in cols:
        op.add_column("client_questions", sa.Column("kind", sa.String(16), nullable=False, server_default="question"))
    if "blocks_clock" not in cols:
        op.add_column("client_questions", sa.Column("blocks_clock", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    if "asked_at" not in cols:
        op.add_column("client_questions", sa.Column("asked_at", sa.DateTime(timezone=True), nullable=True))
    if "first_reply_at" not in cols:
        op.add_column("client_questions", sa.Column("first_reply_at", sa.DateTime(timezone=True), nullable=True))
    if "wait_periods" not in insp.get_table_names():
        op.create_table(
            "wait_periods",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("kind", sa.String(16), nullable=False, server_default="links"),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    op.drop_table("wait_periods")
    for c in ("first_reply_at", "asked_at", "blocks_clock", "kind"):
        op.drop_column("client_questions", c)
