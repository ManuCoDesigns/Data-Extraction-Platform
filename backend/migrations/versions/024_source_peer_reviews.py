"""Peer reviewers: several per source, each must submit a comment.

Revision ID: 024_source_peer_reviews
Revises: 023_xtrium_sop
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '024_source_peer_reviews'
down_revision = '023_xtrium_sop'


def _table_exists(name):
    conn = op.get_bind()
    return conn.execute(text("SELECT 1 FROM information_schema.tables WHERE table_name=:t"), {"t": name}).fetchone() is not None


def upgrade():
    if _table_exists("source_peer_reviews"):
        return
    op.create_table(
        "source_peer_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("source_id", "user_id", name="uq_source_peer_reviews_source_user"),
    )
    op.create_index("ix_source_peer_reviews_source_id", "source_peer_reviews", ["source_id"])
    op.create_index("ix_source_peer_reviews_user_id", "source_peer_reviews", ["user_id"])


def downgrade():
    pass
