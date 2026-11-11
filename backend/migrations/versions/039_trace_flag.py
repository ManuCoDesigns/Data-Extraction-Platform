"""Let a source be marked as a test source or as covered earlier, so the delivery clock leaves it out.

Revision ID: 039_trace_flag
Revises: 038_trace
"""
from alembic import op
import sqlalchemy as sa

revision = '039_trace_flag'
down_revision = '038_trace'


def upgrade():
    insp = sa.inspect(op.get_bind())
    if "trace_flag" not in [c["name"] for c in insp.get_columns("sources")]:
        op.add_column("sources", sa.Column("trace_flag", sa.String(12), nullable=True))


def downgrade():
    op.drop_column("sources", "trace_flag")
