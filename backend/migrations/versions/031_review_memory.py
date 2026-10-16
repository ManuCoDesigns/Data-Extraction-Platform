"""Review memory: first verdicts, fixed-before-final findings and the record as it was when sent back.

Revision ID: 031_review_memory
Revises: 030_quality
"""
from alembic import op
import sqlalchemy as sa

revision = '031_review_memory'
down_revision = '030_quality'


def _cols(table):
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(table)} if insp.has_table(table) else set()


def _add(table, column):
    if column.name not in _cols(table):
        op.add_column(table, column)


def upgrade():
    _add("quality_findings", sa.Column("fixed_before_final", sa.Boolean(), nullable=False, server_default=sa.false()))
    _add("field_audits", sa.Column("first_verdict", sa.String(10), nullable=True))
    _add("field_audits", sa.Column("first_value", sa.JSON(), nullable=True))
    _add("field_audits", sa.Column("first_at", sa.DateTime(timezone=True), nullable=True))
    _add("field_audits", sa.Column("times_checked", sa.Integer(), nullable=False, server_default="1"))
    _add("source_peer_reviews", sa.Column("snapshot", sa.JSON(), nullable=True))
    _add("extracted_records", sa.Column("fields_at_return", sa.JSON(), nullable=True))
    _add("extracted_records", sa.Column("last_returned_at", sa.DateTime(timezone=True), nullable=True))
    # Existing checks: the verdict given so far is the first one we know of.
    op.execute("UPDATE field_audits SET first_verdict = verdict, first_value = extracted_value, first_at = audited_at WHERE first_verdict IS NULL")


def downgrade():
    for t, c in (("source_peer_reviews", "snapshot"), ("extracted_records", "last_returned_at"), ("extracted_records", "fields_at_return"), ("field_audits", "times_checked"),
                 ("field_audits", "first_at"), ("field_audits", "first_value"), ("field_audits", "first_verdict"), ("quality_findings", "fixed_before_final")):
        if c in _cols(t):
            op.drop_column(t, c)
