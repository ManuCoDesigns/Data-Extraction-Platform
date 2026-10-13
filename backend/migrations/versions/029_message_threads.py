"""Private threads: each reviewer talks with the extractor, not with the other reviewers.

Revision ID: 029_message_threads
Revises: 028_source_messages
"""
from alembic import op
import sqlalchemy as sa

revision = '029_message_threads'
down_revision = '028_source_messages'


def _has_column(table, col):
    insp = sa.inspect(op.get_bind())
    return insp.has_table(table) and col in {c["name"] for c in insp.get_columns(table)}


def upgrade():
    if not _has_column("source_messages", "thread_user_id"):
        op.add_column("source_messages", sa.Column("thread_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        op.create_index("ix_source_messages_thread_user_id", "source_messages", ["thread_user_id"])
        # Earlier messages belonged to whoever wrote them, or to the reviewer they were sent to.
        op.execute("UPDATE source_messages SET thread_user_id = user_id WHERE thread_user_id IS NULL AND user_id IS NOT NULL "
                   "AND user_id IN (SELECT user_id FROM source_peer_reviews WHERE source_peer_reviews.source_id = source_messages.source_id)")


def downgrade():
    if _has_column("source_messages", "thread_user_id"):
        op.drop_index("ix_source_messages_thread_user_id", table_name="source_messages")
        op.drop_column("source_messages", "thread_user_id")
