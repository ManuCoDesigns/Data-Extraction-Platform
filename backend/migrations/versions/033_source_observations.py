"""Observations recorded by extractors and reviewers.

Revision ID: 033_source_observations
Revises: 032_source_rounds
"""
from alembic import op
import sqlalchemy as sa

revision = '033_source_observations'
down_revision = '032_source_rounds'


def upgrade():
    if sa.inspect(op.get_bind()).has_table("source_observations"):
        return
    op.create_table(
        "source_observations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("role", sa.String(12), nullable=False, server_default="extractor"),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("record_id", sa.String(36), sa.ForeignKey("extracted_records.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), index=True),
    )


def downgrade():
    op.drop_table("source_observations")
