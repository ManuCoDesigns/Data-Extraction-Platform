"""Admin copies: data an admin keeps for their own checking, hidden from extractors and reviewers.

Revision ID: 035_admin_copies
Revises: 034_question_topics
"""
from alembic import op
import sqlalchemy as sa

revision = '035_admin_copies'
down_revision = '034_question_topics'


def upgrade():
    if sa.inspect(op.get_bind()).has_table("admin_copies"):
        return
    op.create_table(
        "admin_copies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name_key", sa.String(300), nullable=False),
        sa.Column("source_name", sa.String(512), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=True),
        sa.Column("batch_id", sa.String(36), nullable=False),
        sa.Column("batch_label", sa.String(200), nullable=True),
        sa.Column("file", sa.String(300), nullable=True),
        sa.Column("records", sa.JSON(), nullable=False),
        sa.Column("record_count", sa.Integer(), nullable=True),
        sa.Column("valid_count", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    for c in ("source_id", "name_key", "project_id", "batch_id", "created_at"):
        op.create_index(f"ix_admin_copies_{c}", "admin_copies", [c])


def downgrade():
    op.drop_table("admin_copies")
