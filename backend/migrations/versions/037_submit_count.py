"""Count submissions to Xtrium per source.

Revision ID: 037_submit_count
Revises: 036_audit_challenges
"""
from alembic import op
import sqlalchemy as sa

revision = '037_submit_count'
down_revision = '036_audit_challenges'


def upgrade():
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("sources")]
    if "xtrium_submit_count" not in cols:
        op.add_column("sources", sa.Column("xtrium_submit_count", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE sources SET xtrium_submit_count = 1 WHERE xtrium_submitted_at IS NOT NULL AND xtrium_submit_count = 0")


def downgrade():
    op.drop_column("sources", "xtrium_submit_count")
