"""Add web verification columns to extracted_records

Revision ID: 004_web_verification
Revises: 003_sources
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '004_web_verification'
down_revision = '003_sources'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    """Check if a column already exists — safe to call on any DB."""
    conn = op.get_bind()
    result = conn.execute(text(
        f"SELECT column_name FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}'"
    ))
    return result.fetchone() is not None


def upgrade():
    if not _column_exists('extracted_records', 'web_verified'):
        op.add_column('extracted_records',
            sa.Column('web_verified', sa.Boolean, nullable=True))

    if not _column_exists('extracted_records', 'web_check_flags'):
        op.add_column('extracted_records',
            sa.Column('web_check_flags', sa.JSON, server_default='[]'))

    if not _column_exists('extracted_records', 'web_check_summary'):
        op.add_column('extracted_records',
            sa.Column('web_check_summary', sa.Text, nullable=True))


def downgrade():
    try:
        op.drop_column('extracted_records', 'web_check_summary')
    except Exception:
        pass
    try:
        op.drop_column('extracted_records', 'web_check_flags')
    except Exception:
        pass
    try:
        op.drop_column('extracted_records', 'web_verified')
    except Exception:
        pass
