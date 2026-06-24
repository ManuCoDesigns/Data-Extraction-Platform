"""Add Source workflow (Kanban-tracked datasets)

Revision ID: 003_sources
Revises: 002_resources_submissions
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = '003_sources'
down_revision = '002_resources_submissions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('schema_id', sa.String(36), sa.ForeignKey('schemas.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('website_url', sa.String(1024), nullable=True),
        sa.Column('status', sa.Text, nullable=False, server_default='not_started'),
        sa.Column('assigned_extractor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('assigned_reviewer_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('total_records', sa.Integer, server_default='0'),
        sa.Column('valid_records', sa.Integer, server_default='0'),
        sa.Column('invalid_records', sa.Integer, server_default='0'),
        sa.Column('approved_records', sa.Integer, server_default='0'),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.Column('extraction_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('extraction_completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
    )
    op.create_index('ix_sources_project_id', 'sources', ['project_id'])
    op.create_index('ix_sources_status', 'sources', ['status'])

    op.add_column('extraction_jobs', sa.Column('source_id', sa.String(36), sa.ForeignKey('sources.id', ondelete='CASCADE'), nullable=True))
    try:
        op.create_index('ix_extraction_jobs_source_id', 'extraction_jobs', ['source_id'])
    except Exception:
        pass

    conn = op.get_bind()
    from sqlalchemy import text

    def col_exists(table, col):
        r = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}' AND column_name='{col}'"))
        return r.fetchone() is not None

    if not col_exists('extracted_records', 'is_schema_valid'):
        op.add_column('extracted_records', sa.Column('is_schema_valid', sa.Boolean, server_default='true', nullable=False))
    if not col_exists('extracted_records', 'validation_errors'):
        op.add_column('extracted_records', sa.Column('validation_errors', sa.JSON, server_default='[]'))


def downgrade():
    op.drop_column('extracted_records', 'validation_errors')
    op.drop_column('extracted_records', 'is_schema_valid')
    op.drop_index('ix_extraction_jobs_source_id', table_name='extraction_jobs')
    op.drop_column('extraction_jobs', 'source_id')
    op.drop_table('sources')
