"""Audit challenges: checked fields sent back to the extractor to confirm or dispute.

Revision ID: 036_audit_challenges
Revises: 035_admin_copies
"""
from alembic import op
import sqlalchemy as sa

revision = '036_audit_challenges'
down_revision = '035_admin_copies'


def upgrade():
    if sa.inspect(op.get_bind()).has_table("audit_challenges"):
        return
    op.create_table(
        "audit_challenges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("audit_id", sa.String(36), sa.ForeignKey("field_audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("record_id", sa.String(36), nullable=True),
        sa.Column("field", sa.String(255), nullable=False),
        sa.Column("extractor_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sent_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_note", sa.Text(), nullable=True),
        sa.Column("admin_verdict", sa.String(10), nullable=False),
        sa.Column("admin_truth", sa.Text(), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("extracted_value", sa.JSON(), nullable=True),
        sa.Column("stance", sa.String(10), nullable=True),
        sa.Column("finding", sa.Text(), nullable=True),
        sa.Column("evidence_url", sa.String(1000), nullable=True),
        sa.Column("sop_ref", sa.String(300), nullable=True),
        sa.Column("responded_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ruling", sa.String(12), nullable=True),
        sa.Column("ruling_note", sa.Text(), nullable=True),
        sa.Column("ruled_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ruled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_audit_challenges_audit_id", "audit_challenges", ["audit_id"], unique=True)
    for c in ("source_id", "extractor_id", "sent_at"):
        op.create_index(f"ix_audit_challenges_{c}", "audit_challenges", [c])


def downgrade():
    op.drop_table("audit_challenges")
