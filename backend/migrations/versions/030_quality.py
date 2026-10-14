"""Quality: logged errors (findings) and ground-truth field checks (audits).

Revision ID: 030_quality
Revises: 029_message_threads
"""
from alembic import op
import sqlalchemy as sa

revision = '030_quality'
down_revision = '029_message_threads'


def _has_table(name):
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade():
    if not _has_table("quality_findings"):
        op.create_table(
            "quality_findings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("record_id", sa.String(36), sa.ForeignKey("extracted_records.id", ondelete="CASCADE"), nullable=False),
            sa.Column("field", sa.String(255), nullable=True),
            sa.Column("category", sa.String(24), nullable=False),
            sa.Column("severity", sa.String(10), nullable=False, server_default="major"),
            sa.Column("origin", sa.String(10), nullable=False, server_default="reviewer"),
            sa.Column("rule", sa.String(60), nullable=True),
            sa.Column("raised_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("extracted_value", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(10), nullable=False, server_default="open"),
            sa.Column("auto_verdict", sa.String(16), nullable=True),
            sa.Column("auto_note", sa.Text(), nullable=True),
            sa.Column("truth_value", sa.Text(), nullable=True),
            sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolve_note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_quality_findings_source_id", "quality_findings", ["source_id"])
        op.create_index("ix_quality_findings_record_id", "quality_findings", ["record_id"])
        op.create_index("ix_quality_findings_created_at", "quality_findings", ["created_at"])
    if not _has_table("field_audits"):
        op.create_table(
            "field_audits",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("record_id", sa.String(36), sa.ForeignKey("extracted_records.id", ondelete="CASCADE"), nullable=False),
            sa.Column("field", sa.String(255), nullable=False),
            sa.Column("verdict", sa.String(10), nullable=False),
            sa.Column("extracted_value", sa.JSON(), nullable=True),
            sa.Column("truth_value", sa.Text(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("audited_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("audited_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("record_id", "field", name="uq_field_audits_record_field"),
        )
        op.create_index("ix_field_audits_source_id", "field_audits", ["source_id"])
        op.create_index("ix_field_audits_record_id", "field_audits", ["record_id"])
        op.create_index("ix_field_audits_audited_at", "field_audits", ["audited_at"])


def downgrade():
    for t in ("field_audits", "quality_findings"):
        if _has_table(t):
            op.drop_table(t)
