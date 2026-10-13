"""Chat messages on a source, and per-person read markers.

Revision ID: 028_source_messages
Revises: 027_user_prefs
"""
from alembic import op
import sqlalchemy as sa

revision = '028_source_messages'
down_revision = '027_user_prefs'


def _has_table(name):
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade():
    if not _has_table("source_messages"):
        op.create_table(
            "source_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_source_messages_source_id", "source_messages", ["source_id"])
        op.create_index("ix_source_messages_created_at", "source_messages", ["created_at"])
    if not _has_table("source_message_reads"):
        op.create_table(
            "source_message_reads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("source_id", "user_id", name="uq_source_message_reads_source_user"),
        )
        op.create_index("ix_source_message_reads_source_id", "source_message_reads", ["source_id"])
        op.create_index("ix_source_message_reads_user_id", "source_message_reads", ["user_id"])


def downgrade():
    if _has_table("source_message_reads"):
        op.drop_table("source_message_reads")
    if _has_table("source_messages"):
        op.drop_table("source_messages")
