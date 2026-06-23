"""Add web verification columns to extracted_records

Revision ID: 004_web_verification
Revises: 003_sources
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = '004_web_verification'
down_revision = '003_sources'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('extracted_records',
        sa.Column('web_verified', sa.Boolean, nullable=True))
    op.add_column('extracted_records',
        sa.Column('web_check_flags', sa.JSON, server_default='[]'))
    op.add_column('extracted_records',
        sa.Column('web_check_summary', sa.Text, nullable=True))


def downgrade():
    op.drop_column('extracted_records', 'web_check_summary')
    op.drop_column('extracted_records', 'web_check_flags')
    op.drop_column('extracted_records', 'web_verified')
