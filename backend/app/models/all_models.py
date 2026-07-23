"""
All database models for the Xtrium DataOps Platform.
Single file for clarity — split by domain if it grows past ~600 lines.
"""
import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Column, String, Boolean, Integer, Float, DateTime, Text,
    ForeignKey, Enum as SAEnum, JSON, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import relationship
from app.db.session import Base


def now_utc():
    return datetime.now(timezone.utc)


def new_uuid():
    return str(uuid.uuid4())


# ─── Enums ──────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    ORG_ADMIN = "org_admin"
    PROJECT_ADMIN = "project_admin"
    QA_LEAD = "qa_lead"
    PIPELINE_OPERATOR = "pipeline_operator"
    REVIEWER = "reviewer"
    READ_ONLY = "read_only"


class ProjectStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"
    TEMPLATE = "template"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    LLM_REVIEW = "llm_review"
    READY_FOR_REVIEW = "ready_for_review"
    IN_REVIEW = "in_review"
    VALIDATED = "validated"
    SUBMITTED = "submitted"
    ARCHIVED = "archived"
    PARSE_FAILED = "parse_failed"
    EXTRACTION_FAILED = "extraction_failed"
    LLM_FAILED = "llm_failed"
    VALIDATION_FAILED = "validation_failed"
    SUBMISSION_FAILED = "submission_failed"


class SourceType(str, enum.Enum):
    PDF = "pdf"
    EXCEL = "excel"
    CSV = "csv"


class ExtractionConfidence(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    FLAGGED = "flagged"


class ReviewStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SKIPPED = "skipped"
    QUARANTINED = "quarantined"
    ESCALATED = "escalated"
    PENDING_ADMIN_REVIEW = "pending_admin_review"   # reviewer approved; awaiting admin sign-off


class LLMVerdict(str, enum.Enum):
    PASS_ = "PASS"
    REVIEW = "REVIEW"
    REJECT = "REJECT"


class AuditAction(str, enum.Enum):
    RECORD_APPROVED = "record_approved"
    RECORD_ADMIN_REVIEWED = "record_admin_reviewed"
    RECORD_RETURNED_FOR_CORRECTION = "record_returned_for_correction"
    RECORD_REVISION_STARTED = "record_revision_started"
    RECORD_SENT_TO_ADMIN = "record_sent_to_admin"
    SOURCE_RESET = "source_reset"
    RECORD_REJECTED = "record_rejected"
    FIELD_OVERRIDDEN = "field_overridden"
    RECORD_ESCALATED = "record_escalated"
    RECORD_SUBMITTED = "record_submitted"
    RECORD_QUARANTINE_RELEASED = "record_quarantine_released"
    SCHEMA_CREATED = "schema_created"
    SCHEMA_VERSION_CREATED = "schema_version_created"
    SCHEMA_LOCKED = "schema_locked"
    SCHEMA_ARCHIVED = "schema_archived"
    JOB_CREATED = "job_created"
    JOB_RETRIGGERED = "job_retriggered"
    USER_CREATED = "user_created"
    USER_ROLE_CHANGED = "user_role_changed"
    USER_DEACTIVATED = "user_deactivated"
    PROJECT_CREATED = "project_created"
    PROJECT_DELETED = "project_deleted"
    PROJECT_STATUS_CHANGED = "project_status_changed"
    DESTINATION_CONFIGURED = "destination_configured"
    MEMBER_ADDED = "member_added"
    MEMBER_REMOVED = "member_removed"
    RESOURCE_ADDED = "resource_added"
    RESOURCE_DELETED = "resource_deleted"
    WORK_SUBMITTED = "work_submitted"
    WORK_REVIEWED = "work_reviewed"
    SOURCE_CREATED = "source_created"
    SOURCE_STATUS_CHANGED = "source_status_changed"
    SOURCE_ASSIGNED = "source_assigned"
    SOURCE_DATA_UPLOADED = "source_data_uploaded"
    SOURCE_RECORD_FIXED = "source_record_fixed"
    SOURCE_APPROVED = "source_approved"


class SourceStatus(str, enum.Enum):
    NOT_STARTED = "not_started"
    EXTRACTING = "extracting"
    NEEDS_FIXES = "needs_fixes"
    READY_FOR_REVIEW = "ready_for_review"
    IN_REVIEW = "in_review"
    CHANGES_REQUESTED = "changes_requested"
    LLM_VERIFICATION = "llm_verification"  # reserved for fast-follow — not yet auto-routed
    APPROVED = "approved"


class ResourceType(str, enum.Enum):
    FILE = "file"
    LINK = "link"
    INSTRUCTION = "instruction"
    SOP = "sop"


class SubmissionStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    NEEDS_REVISION = "needs_revision"


# ─── User ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=new_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    roles = relationship("UserRoleAssignment", back_populates="user", cascade="all, delete-orphan")
    project_memberships = relationship("ProjectMember", back_populates="user")
    audit_entries = relationship("AuditLog", back_populates="user")


class UserRoleAssignment(Base):
    __tablename__ = "user_roles"

    id = Column(String(36), primary_key=True, default=new_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    user = relationship("User", back_populates="roles")
    __table_args__ = (UniqueConstraint("user_id", "role"),)


# ─── Project ─────────────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id = Column(String(36), primary_key=True, default=new_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(SAEnum(ProjectStatus), default=ProjectStatus.ACTIVE, nullable=False)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    submission_destinations = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    schemas = relationship("Schema", back_populates="project")
    jobs = relationship("ExtractionJob", back_populates="project")
    resources = relationship("ProjectResource", back_populates="project", cascade="all, delete-orphan")
    work_submissions = relationship("ProjectSubmission", back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="project_memberships")
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)


# ─── Project Resource (admin-attached guidelines / SOPs / files / links) ─────

class ProjectResource(Base):
    __tablename__ = "project_resources"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(SAEnum(ResourceType), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # For type=file: storage_key points into the storage backend (local disk or S3/R2).
    # For type=link: url holds the external link.
    # For type=instruction/sop: body holds the written text.
    storage_key = Column(String(1024), nullable=True)
    file_name = Column(String(512), nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    url = Column(String(1024), nullable=True)
    body = Column(Text, nullable=True)
    uploaded_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    project = relationship("Project", back_populates="resources")
    uploader = relationship("User", foreign_keys=[uploaded_by])


# ─── Project Submission (annotator-submitted work, reviewed by a reviewer) ───

class ProjectSubmission(Base):
    __tablename__ = "project_submissions"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    note = Column(Text, nullable=True)
    storage_key = Column(String(1024), nullable=False)
    file_name = Column(String(512), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    status = Column(SAEnum(SubmissionStatus), default=SubmissionStatus.SUBMITTED, nullable=False, index=True)
    reviewer_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)
    submitted_at = Column(DateTime(timezone=True), default=now_utc)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    project = relationship("Project", back_populates="work_submissions")
    submitter = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])

    __table_args__ = (
        Index("ix_submissions_project_status", "project_id", "status"),
    )


# ─── Schema ──────────────────────────────────────────────────────────────────

class Schema(Base):
    __tablename__ = "schemas"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    current_version = Column(Integer, default=1, nullable=False)
    is_archived = Column(Boolean, default=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    project = relationship("Project", back_populates="schemas")
    versions = relationship("SchemaVersion", back_populates="schema", order_by="SchemaVersion.version")
    jobs = relationship("ExtractionJob", back_populates="schema")


class SchemaVersion(Base):
    __tablename__ = "schema_versions"

    id = Column(String(36), primary_key=True, default=new_uuid)
    schema_id = Column(String(36), ForeignKey("schemas.id"), nullable=True)  # nullable: some sources have no fixed schema
    version = Column(Integer, nullable=False)
    definition = Column(JSON, nullable=False)  # Full JSON schema definition
    is_locked = Column(Boolean, default=False)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    schema = relationship("Schema", back_populates="versions")
    __table_args__ = (UniqueConstraint("schema_id", "version"),)


# ─── Extraction Job ──────────────────────────────────────────────────────────

class Source(Base):
    """
    A tracked dataset within a project — the Kanban-card-level entity.
    One Source has one schema, one (optional) website, one assigned extractor,
    one assigned reviewer, and moves through a status pipeline as work happens.
    A Source can have multiple upload batches (ExtractionJob rows) underneath it —
    e.g. an initial upload plus re-uploads to fix validation errors.
    """
    __tablename__ = "sources"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    schema_id = Column(String(36), ForeignKey("schemas.id"), nullable=True)  # nullable: some sources have no fixed schema
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    website_url = Column(String(1024), nullable=True)
    status = Column(SAEnum(SourceStatus), default=SourceStatus.NOT_STARTED, nullable=False, index=True)

    assigned_extractor_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    assigned_reviewer_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    total_records = Column(Integer, default=0)
    valid_records = Column(Integer, default=0)
    invalid_records = Column(Integer, default=0)
    approved_records = Column(Integer, default=0)

    notes = Column(Text, nullable=True)  # assumptions / free-text notes for the cover sheet

    # Timestamps for performance analytics
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    extraction_started_at = Column(DateTime(timezone=True), nullable=True)
    extraction_completed_at = Column(DateTime(timezone=True), nullable=True)
    llm_verification_started_at = Column(DateTime(timezone=True), nullable=True)
    llm_verification_completed_at = Column(DateTime(timezone=True), nullable=True)
    review_started_at = Column(DateTime(timezone=True), nullable=True)
    review_completed_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    reset_count = Column(Integer, default=0, server_default="0", nullable=False)

    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)

    project = relationship("Project", foreign_keys=[project_id])
    schema = relationship("Schema", foreign_keys=[schema_id])
    extractor = relationship("User", foreign_keys=[assigned_extractor_id])
    reviewer = relationship("User", foreign_keys=[assigned_reviewer_id])
    creator = relationship("User", foreign_keys=[created_by])
    jobs = relationship("ExtractionJob", back_populates="source")


class ExtractionJob(Base):
    __tablename__ = "extraction_jobs"

    id = Column(String(36), primary_key=True, default=new_uuid)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    source_id = Column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=True, index=True)
    schema_id = Column(String(36), ForeignKey("schemas.id"), nullable=True)  # nullable: some sources have no fixed schema
    schema_version = Column(Integer, nullable=True)  # nullable: no schema means no version
    name = Column(String(255), nullable=False)
    source_file_url = Column(String(1024), nullable=True)
    source_file_name = Column(String(512), nullable=True)
    source_file_size_bytes = Column(Integer, nullable=True)
    source_type = Column(SAEnum(SourceType), nullable=False)
    status = Column(SAEnum(JobStatus), default=JobStatus.QUEUED, nullable=False, index=True)
    total_raw_records = Column(Integer, nullable=True)
    total_extracted = Column(Integer, default=0)
    total_approved = Column(Integer, default=0)
    total_rejected = Column(Integer, default=0)
    total_submitted = Column(Integer, default=0)
    parse_warnings = Column(JSON, default=list)
    error_message = Column(Text, nullable=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    project = relationship("Project", back_populates="jobs")
    source = relationship("Source", back_populates="jobs")
    schema = relationship("Schema", back_populates="jobs")
    creator = relationship("User", foreign_keys=[created_by])
    records = relationship("ExtractedRecord", back_populates="job", cascade="all, delete-orphan")
    state_history = relationship("JobStateHistory", back_populates="job", order_by="JobStateHistory.entered_at")
    assigned_reviewers = relationship("JobReviewer", back_populates="job")

    __table_args__ = (
        Index("ix_jobs_project_status", "project_id", "status"),
    )


class JobStateHistory(Base):
    __tablename__ = "job_state_history"

    id = Column(String(36), primary_key=True, default=new_uuid)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id", ondelete="CASCADE"), nullable=False)
    state = Column(SAEnum(JobStatus), nullable=False)
    entered_at = Column(DateTime(timezone=True), default=now_utc)
    exited_at = Column(DateTime(timezone=True), nullable=True)
    triggered_by = Column(String(255), nullable=True)
    error = Column(Text, nullable=True)

    job = relationship("ExtractionJob", back_populates="state_history")


class JobReviewer(Base):
    __tablename__ = "job_reviewers"

    id = Column(String(36), primary_key=True, default=new_uuid)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime(timezone=True), default=now_utc)

    job = relationship("ExtractionJob", back_populates="assigned_reviewers")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("job_id", "user_id"),)


# ─── Extracted Record ────────────────────────────────────────────────────────

class ExtractedRecord(Base):
    __tablename__ = "extracted_records"

    id = Column(String(36), primary_key=True, default=new_uuid)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    schema_version = Column(Integer, nullable=True)  # nullable: no schema means no version
    extraction_confidence = Column(SAEnum(ExtractionConfidence), nullable=False)
    pipeline_warnings = Column(JSON, default=list)
    # Schema validation — structural conformance, separate from LLM content checks
    is_schema_valid = Column(Boolean, server_default='true', default=True, nullable=False)
    validation_errors = Column(JSON, server_default='[]', default=list)
    review_status = Column(SAEnum(ReviewStatus), default=ReviewStatus.PENDING, nullable=False)
    review_note = Column(Text, nullable=True)
    reviewed_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    llm_verdict = Column(SAEnum(LLMVerdict), nullable=True)
    llm_confidence = Column(Float, nullable=True)
    llm_field_flags = Column(JSON, default=list)
    llm_reason = Column(Text, nullable=True)
    llm_skipped = Column(Boolean, default=False)
    # Web verification — cross-check against live source website (Phase 3 LLM stage)
    web_verified = Column(Boolean, nullable=True)
    web_check_flags = Column(JSON, server_default='[]', default=list)
    web_check_summary = Column(Text, nullable=True)
    extracted_fields = Column(JSON, nullable=False, default=dict)
    raw_text = Column(Text, nullable=False)
    is_submitted = Column(Boolean, default=False)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    canonical_name = Column(String(512), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    # Admin final review (double-review workflow: reviewer approve -> admin approve)
    admin_review_note       = Column(Text, nullable=True)
    admin_reviewed_by       = Column(String(36), ForeignKey("users.id"), nullable=True)
    admin_reviewed_at       = Column(DateTime(timezone=True), nullable=True)
    # Revision / correction cycle tracking
    revision_count          = Column(Integer, default=0, server_default="0", nullable=False)
    correction_count        = Column(Integer, default=0, server_default="0", nullable=False)
    # Time tracking per stage
    extraction_started_at   = Column(DateTime(timezone=True), nullable=True)
    review_started_at       = Column(DateTime(timezone=True), nullable=True)
    admin_review_started_at = Column(DateTime(timezone=True), nullable=True)
    # Per-field reviewer/admin comments: {field_name: [{comment,user,role,ts,type}]}
    reviewer_field_comments = Column(JSON, default=dict, server_default="{}")

    job = relationship("ExtractionJob", back_populates="records")
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    admin_reviewer = relationship("User", foreign_keys=[admin_reviewed_by])
    llm_reviews = relationship("LLMCallLog", back_populates="record")
    validation_results = relationship("ValidationResult", back_populates="record")

    __table_args__ = (
        Index("ix_records_job_review_status", "job_id", "review_status"),
    )


# ─── LLM Call Log ────────────────────────────────────────────────────────────

class LLMCallLog(Base):
    __tablename__ = "llm_call_log"

    id = Column(String(36), primary_key=True, default=new_uuid)
    record_id = Column(String(36), ForeignKey("extracted_records.id", ondelete="CASCADE"), nullable=False)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id"), nullable=False)
    model = Column(String(100), nullable=False)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    prompt_hash = Column(String(64), nullable=True)
    verdict = Column(SAEnum(LLMVerdict), nullable=True)
    confidence = Column(Float, nullable=True)
    raw_response = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    record = relationship("ExtractedRecord", back_populates="llm_reviews")


# ─── Validation Result ───────────────────────────────────────────────────────

class ValidationResult(Base):
    __tablename__ = "validation_results"

    id = Column(String(36), primary_key=True, default=new_uuid)
    record_id = Column(String(36), ForeignKey("extracted_records.id", ondelete="CASCADE"), nullable=False)
    is_valid = Column(Boolean, nullable=False)
    violations = Column(JSON, default=list)
    validated_by = Column(String(100), nullable=False)  # "system" or user_id
    validated_at = Column(DateTime(timezone=True), default=now_utc)

    record = relationship("ExtractedRecord", back_populates="validation_results")


# ─── Submission ──────────────────────────────────────────────────────────────

class SubmissionBatch(Base):
    __tablename__ = "submission_batches"

    id = Column(String(36), primary_key=True, default=new_uuid)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id"), nullable=False)
    submitted_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    destination = Column(String(100), nullable=False)
    record_count = Column(Integer, nullable=False)
    schema_version = Column(Integer, nullable=True)  # nullable: no schema means no version
    payload_sha256 = Column(String(64), nullable=True)
    file_url = Column(String(1024), nullable=True)
    status = Column(String(50), default="completed")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    job = relationship("ExtractionJob")
    submitter = relationship("User", foreign_keys=[submitted_by])


# ─── Notification ────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=new_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    link = Column(String(512), nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    user = relationship("User")


# ─── Audit Log ───────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=new_uuid)
    timestamp = Column(DateTime(timezone=True), default=now_utc, nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=True)
    source_id = Column(String(36), ForeignKey("sources.id"), nullable=True, index=True)
    job_id = Column(String(36), ForeignKey("extraction_jobs.id"), nullable=True)
    record_id = Column(String(36), ForeignKey("extracted_records.id"), nullable=True)
    action = Column(SAEnum(AuditAction), nullable=False)
    before_value = Column(JSON, nullable=True)
    after_value = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)

    user = relationship("User", back_populates="audit_entries")