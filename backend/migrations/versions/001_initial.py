"""Initial schema

Revision ID: 001_initial
Revises: 
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE userrole AS ENUM (
                'org_admin','project_admin','qa_lead',
                'pipeline_operator','reviewer','read_only'
            );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE projectstatus AS ENUM ('active','paused','archived','template');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE jobstatus AS ENUM (
                'queued','parsing','extracting','llm_review',
                'ready_for_review','in_review','validated',
                'submitted','archived','parse_failed',
                'extraction_failed','llm_failed','validation_failed','submission_failed'
            );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE sourcetype AS ENUM ('pdf','excel','csv');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE extractionconfidence AS ENUM ('high','medium','low','flagged');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE reviewstatus AS ENUM (
                'pending','approved','rejected','skipped','quarantined','escalated'
            );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE llmverdict AS ENUM ('PASS','REVIEW','REJECT');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE auditaction AS ENUM (
                'record_approved','record_rejected','field_overridden',
                'record_escalated','record_submitted','record_quarantine_released',
                'schema_created','schema_version_created','schema_locked','schema_archived',
                'job_created','job_retriggered','user_created','user_role_changed',
                'user_deactivated','project_created','project_status_changed',
                'destination_configured'
            );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)

    op.create_table('users',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_users_email', 'users', ['email'])

    op.create_table('user_roles',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('user_id', 'role'),
    )

    op.create_table('projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('status', sa.Text, default='active'),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('submission_destinations', sa.JSON, default=list),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table('project_members',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('project_id', 'user_id'),
    )

    op.create_table('schemas',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('current_version', sa.Integer, default=1),
        sa.Column('is_archived', sa.Boolean, default=False),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )

    op.create_table('schema_versions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('schema_id', sa.String(36), sa.ForeignKey('schemas.id'), nullable=False),
        sa.Column('version', sa.Integer, nullable=False),
        sa.Column('definition', sa.JSON, nullable=False),
        sa.Column('is_locked', sa.Boolean, default=False),
        sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('schema_id', 'version'),
    )

    op.create_table('extraction_jobs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('schema_id', sa.String(36), sa.ForeignKey('schemas.id'), nullable=False),
        sa.Column('schema_version', sa.Integer, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('source_file_url', sa.String(1024), nullable=True),
        sa.Column('source_file_name', sa.String(512), nullable=True),
        sa.Column('source_file_size_bytes', sa.Integer, nullable=True),
        sa.Column('source_type', sa.Text, nullable=False),
        sa.Column('status', sa.Text, default='queued'),
        sa.Column('total_raw_records', sa.Integer, nullable=True),
        sa.Column('total_extracted', sa.Integer, default=0),
        sa.Column('total_approved', sa.Integer, default=0),
        sa.Column('total_rejected', sa.Integer, default=0),
        sa.Column('total_submitted', sa.Integer, default=0),
        sa.Column('parse_warnings', sa.JSON, default=list),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_jobs_project_status', 'extraction_jobs', ['project_id', 'status'])

    op.create_table('job_state_history',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('state', sa.Text, nullable=False),
        sa.Column('entered_at', sa.DateTime(timezone=True)),
        sa.Column('exited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('triggered_by', sa.String(255), nullable=True),
        sa.Column('error', sa.Text, nullable=True),
    )

    op.create_table('job_reviewers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('job_id', 'user_id'),
    )

    op.create_table('extracted_records',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('schema_version', sa.Integer, nullable=False),
        sa.Column('extraction_confidence', sa.Text, nullable=False),
        sa.Column('pipeline_warnings', sa.JSON, default=list),
        sa.Column('review_status', sa.Text, default='pending'),
        sa.Column('review_note', sa.Text, nullable=True),
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('llm_verdict', sa.Text, nullable=True),
        sa.Column('llm_confidence', sa.Float, nullable=True),
        sa.Column('llm_field_flags', sa.JSON, default=list),
        sa.Column('llm_reason', sa.Text, nullable=True),
        sa.Column('llm_skipped', sa.Boolean, default=False),
        sa.Column('extracted_fields', sa.JSON, nullable=False),
        sa.Column('raw_text', sa.Text, nullable=False),
        sa.Column('is_submitted', sa.Boolean, default=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('canonical_name', sa.String(512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_records_job_review_status', 'extracted_records', ['job_id', 'review_status'])
    op.create_index('ix_records_canonical_name', 'extracted_records', ['canonical_name'])

    op.create_table('llm_call_log',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('extracted_records.id', ondelete='CASCADE'), nullable=False),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id'), nullable=False),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('input_tokens', sa.Integer, nullable=True),
        sa.Column('output_tokens', sa.Integer, nullable=True),
        sa.Column('latency_ms', sa.Integer, nullable=True),
        sa.Column('prompt_hash', sa.String(64), nullable=True),
        sa.Column('verdict', sa.Text, nullable=True),
        sa.Column('confidence', sa.Float, nullable=True),
        sa.Column('raw_response', sa.JSON, nullable=True),
        sa.Column('error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )

    op.create_table('validation_results',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('extracted_records.id', ondelete='CASCADE'), nullable=False),
        sa.Column('is_valid', sa.Boolean, nullable=False),
        sa.Column('violations', sa.JSON, default=list),
        sa.Column('validated_by', sa.String(100), nullable=False),
        sa.Column('validated_at', sa.DateTime(timezone=True)),
    )

    op.create_table('submission_batches',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id'), nullable=False),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('destination', sa.String(100), nullable=False),
        sa.Column('record_count', sa.Integer, nullable=False),
        sa.Column('schema_version', sa.Integer, nullable=False),
        sa.Column('payload_sha256', sa.String(64), nullable=True),
        sa.Column('file_url', sa.String(1024), nullable=True),
        sa.Column('status', sa.String(50), default='completed'),
        sa.Column('error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )

    op.create_table('notifications',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text, nullable=False),
        sa.Column('link', sa.String(512), nullable=True),
        sa.Column('is_read', sa.Boolean, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])

    op.create_table('audit_log',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=True),
        sa.Column('job_id', sa.String(36), sa.ForeignKey('extraction_jobs.id'), nullable=True),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('extracted_records.id'), nullable=True),
        sa.Column('action', sa.Text, nullable=False),
        sa.Column('before_value', sa.JSON, nullable=True),
        sa.Column('after_value', sa.JSON, nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.Text, nullable=True),
    )
    op.create_index('ix_audit_log_timestamp', 'audit_log', ['timestamp'])

    # Immutability rules for audit_log
    op.execute("""
        CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
        CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;
    """)


def downgrade():
    op.drop_table('audit_log')
    op.drop_table('notifications')
    op.drop_table('submission_batches')
    op.drop_table('validation_results')
    op.drop_table('llm_call_log')
    op.drop_table('extracted_records')
    op.drop_table('job_reviewers')
    op.drop_table('job_state_history')
    op.drop_table('extraction_jobs')
    op.drop_table('schema_versions')
    op.drop_table('schemas')
    op.drop_table('project_members')
    op.drop_table('projects')
    op.drop_table('user_roles')
    op.drop_table('users')
