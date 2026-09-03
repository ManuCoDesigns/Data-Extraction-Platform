"""Add is_escalation_only/escalation_reason to extracted_records — supports
the "Escalate — No Data Found" feature, an extractor's declaration that a
source has nothing extractable, going through the same review pipeline as
a real record.

Revision ID: 021_escalation_only_records
Revises: 020_source_country_type
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '021_escalation_only_records'
down_revision = '020_source_country_type'


def _column_exists(table, column):
    conn = op.get_bind()
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade():
    if not _column_exists("extracted_records", "is_escalation_only"):
        op.add_column("extracted_records",
            sa.Column("is_escalation_only", sa.Boolean, nullable=False, server_default="false"))
    if not _column_exists("extracted_records", "escalation_reason"):
        op.add_column("extracted_records", sa.Column("escalation_reason", sa.String(255), nullable=True))


def downgrade():
    pass
