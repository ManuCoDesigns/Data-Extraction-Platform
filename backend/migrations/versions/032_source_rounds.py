"""Kept copies of earlier extraction rounds, for comparing v1 with v2.

Revision ID: 032_source_rounds
Revises: 031_review_memory
"""
from alembic import op
import sqlalchemy as sa

revision = '032_source_rounds'
down_revision = '031_review_memory'


def upgrade():
    if sa.inspect(op.get_bind()).has_table("source_rounds"):
        return
    op.create_table(
        "source_rounds",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("round", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status_at", sa.String(30), nullable=True),
        sa.Column("extractor_id", sa.String(36), nullable=True),
        sa.Column("extractor_name", sa.String(255), nullable=True),
        sa.Column("reviewers", sa.JSON(), nullable=True),
        sa.Column("record_count", sa.Integer(), server_default="0"),
        sa.Column("records", sa.JSON(), nullable=True),
        sa.Column("audits", sa.JSON(), nullable=True),
        sa.Column("findings", sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_table("source_rounds")
