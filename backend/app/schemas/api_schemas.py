"""
Pydantic v2 request/response schemas for the Xtrium DataOps Platform API.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, EmailStr, Field, model_validator


# ─── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# ─── User ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str = Field(min_length=8)
    roles: list[str] = []


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    is_active: bool
    roles: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = Field(None, min_length=8)
    roles: Optional[list[str]] = None
    is_active: Optional[bool] = None


# ─── Project ─────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    submission_destinations: list[str] = ["json_download"]


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    status: str
    owner_id: str
    submission_destinations: list[str]
    created_at: datetime
    member_count: Optional[int] = None
    job_count: Optional[int] = None

    model_config = {"from_attributes": True}


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    submission_destinations: Optional[list[str]] = None


class ProjectMemberAdd(BaseModel):
    user_id: str
    role: str


class ProjectMemberOut(BaseModel):
    user_id: str
    role: str
    full_name: str
    email: str
    created_at: datetime


# ─── Schema ──────────────────────────────────────────────────────────────────

class SchemaCreate(BaseModel):
    name: str
    definition: dict[str, Any]  # Full JSON schema definition


class SchemaOut(BaseModel):
    id: str
    project_id: str
    name: str
    current_version: int
    is_archived: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SchemaVersionOut(BaseModel):
    id: str
    schema_id: str
    version: int
    definition: dict[str, Any]
    is_locked: bool
    locked_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Job ─────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    name: str
    schema_id: str


class JobOut(BaseModel):
    id: str
    project_id: str
    schema_id: Optional[str] = None
    schema_version: Optional[int] = None
    name: str
    source_file_name: Optional[str]
    source_file_size_bytes: Optional[int]
    source_type: str
    status: str
    total_raw_records: Optional[int]
    total_extracted: int
    total_approved: int
    total_rejected: int
    total_submitted: int
    parse_warnings: list
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobStateHistoryOut(BaseModel):
    id: str
    state: str
    entered_at: datetime
    exited_at: Optional[datetime]
    triggered_by: Optional[str]
    error: Optional[str]

    model_config = {"from_attributes": True}


# ─── Extracted Record ────────────────────────────────────────────────────────

class RecordOut(BaseModel):
    id: str
    job_id: str
    schema_version: int
    extraction_confidence: str
    pipeline_warnings: list
    is_schema_valid: bool = True
    validation_errors: list = []
    review_status: str
    review_note: Optional[str]
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    llm_verdict: Optional[str]
    llm_confidence: Optional[float]
    llm_field_flags: list
    llm_reason: Optional[str]
    llm_skipped: bool
    web_verified: Optional[bool] = None
    web_check_flags: list = []
    web_check_summary: Optional[str] = None
    extracted_fields: dict[str, Any]
    raw_text: str
    is_submitted: bool
    canonical_name: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class RecordReviewAction(BaseModel):
    action: str  # approve | reject | skip | escalate
    note: Optional[str] = None
    field_overrides: Optional[dict[str, Any]] = None


class RecordBulkAction(BaseModel):
    record_ids: list[str]
    action: str  # approve | reject
    note: Optional[str] = None


# ─── Submission ──────────────────────────────────────────────────────────────

class SubmitRequest(BaseModel):
    record_ids: Optional[list[str]] = None  # None = all approved records in job
    destination: str = "json_download"


class SubmissionBatchOut(BaseModel):
    id: str
    job_id: str
    submitted_by: str
    destination: str
    record_count: int
    schema_version: int
    payload_sha256: Optional[str]
    file_url: Optional[str]
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Notification ────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: str
    title: str
    body: str
    link: Optional[str]
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Source (Kanban-tracked dataset) ────────────────────────────────────────

class SourceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    website_url: Optional[str] = None
    schema_id: Optional[str] = None  # None = no fixed schema (flexible extraction only)
    assigned_extractor_id: Optional[str] = None
    assigned_reviewer_id: Optional[str] = None


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    website_url: Optional[str] = None
    status: Optional[str] = None
    assigned_extractor_id: Optional[str] = None
    assigned_reviewer_id: Optional[str] = None
    notes: Optional[str] = None


class SourceOut(BaseModel):
    id: str
    project_id: str
    schema_id: Optional[str] = None
    schema_name: Optional[str] = None
    name: str
    description: Optional[str]
    website_url: Optional[str]
    status: str
    assigned_extractor_id: Optional[str]
    assigned_extractor_name: Optional[str] = None
    assigned_reviewer_id: Optional[str]
    assigned_reviewer_name: Optional[str] = None
    total_records: int
    valid_records: int
    invalid_records: int
    approved_records: int
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    extraction_started_at: Optional[datetime]
    extraction_completed_at: Optional[datetime]
    review_started_at: Optional[datetime]
    review_completed_at: Optional[datetime]
    approved_at: Optional[datetime]
    created_by: str

    model_config = {"from_attributes": True}


class SourceUploadSummary(BaseModel):
    total_rows: int
    valid_rows: int
    invalid_rows: int
    job_id: str
    extraction_method: str = "structured"  # "structured" | "llm"
    files_processed: int = 1              # how many files were found (> 1 for ZIP)
    file_breakdown: list = []             # [{filename, rows, valid, invalid}] for ZIP uploads


class SourceRecordFix(BaseModel):
    extracted_fields: dict


class SourceRecordReview(BaseModel):
    action: str  # approve | reject
    note: Optional[str] = None


# ─── Pagination ──────────────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int
    pages: int


# ─── Project Resource ───────────────────────────────────────────────────────

class ProjectResourceCreate(BaseModel):
    type: str  # file | link | instruction | sop
    title: str
    description: Optional[str] = None
    url: Optional[str] = None       # required when type == link
    body: Optional[str] = None      # required when type in (instruction, sop) and no file

    @model_validator(mode="after")
    def check_required_fields(self):
        if self.type == "link" and not self.url:
            raise ValueError("url is required for type=link")
        return self


class ProjectResourceOut(BaseModel):
    id: str
    project_id: str
    type: str
    title: str
    description: Optional[str]
    file_name: Optional[str]
    file_size_bytes: Optional[int]
    url: Optional[str]
    body: Optional[str]
    uploaded_by: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Project Submission (annotator work) ────────────────────────────────────

class ProjectSubmissionOut(BaseModel):
    id: str
    project_id: str
    user_id: str
    title: Optional[str]
    note: Optional[str]
    file_name: str
    file_size_bytes: Optional[int]
    status: str
    reviewer_id: Optional[str]
    review_notes: Optional[str]
    submitted_at: datetime
    reviewed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ProjectSubmissionReview(BaseModel):
    action: str  # approve | reject | needs_revision
    notes: Optional[str] = None
