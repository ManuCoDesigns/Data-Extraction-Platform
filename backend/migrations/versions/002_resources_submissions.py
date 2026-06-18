"""Add project resources and project submissions

Revision ID: 002_resources_submissions
Revises: 001_initial
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = '002_resources_submissions'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('project_resources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.Text, nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('storage_key', sa.String(1024), nullable=True),
        sa.Column('file_name', sa.String(512), nullable=True),
        sa.Column('file_size_bytes', sa.Integer, nullable=True),
        sa.Column('url', sa.String(1024), nullable=True),
        sa.Column('body', sa.Text, nullable=True),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_project_resources_project_id', 'project_resources', ['project_id'])

    op.create_table('project_submissions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('storage_key', sa.String(1024), nullable=False),
        sa.Column('file_name', sa.String(512), nullable=False),
        sa.Column('file_size_bytes', sa.Integer, nullable=True),
        sa.Column('status', sa.Text, default='submitted'),
        sa.Column('reviewer_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('review_notes', sa.Text, nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True)),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_project_submissions_project_id', 'project_submissions', ['project_id'])
    op.create_index('ix_project_submissions_user_id', 'project_submissions', ['user_id'])
    op.create_index('ix_submissions_project_status', 'project_submissions', ['project_id', 'status'])


def downgrade():
    op.drop_table('project_submissions')
    op.drop_table('project_resources')