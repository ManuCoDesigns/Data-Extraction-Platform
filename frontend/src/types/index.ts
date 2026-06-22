// ─── Auth ────────────────────────────────────────────────────────────────────
export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

// ─── User ────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  full_name: string
  is_active: boolean
  roles: string[]
  created_at: string
}

// ─── Project ─────────────────────────────────────────────────────────────────
export interface Project {
  id: string
  name: string
  description?: string
  status: 'active' | 'paused' | 'archived' | 'template'
  owner_id: string
  submission_destinations: string[]
  created_at: string
  updated_at: string
  member_count?: number
  job_count?: number
}

export interface ProjectMember {
  user_id: string
  role: string
  full_name: string
  email: string
  created_at: string
}

// ─── Schema ──────────────────────────────────────────────────────────────────
export interface Schema {
  id: string
  project_id: string
  name: string
  description?: string
  current_version: number
  is_archived: boolean
  created_at: string
  updated_at?: string
}

export interface SchemaVersion {
  id: string
  schema_id: string
  version: number
  definition: Record<string, unknown>
  is_locked: boolean
  locked_at?: string
  created_at: string
}

// ─── Job ─────────────────────────────────────────────────────────────────────
export type JobStatus =
  | 'queued' | 'parsing' | 'extracting' | 'llm_review'
  | 'ready_for_review' | 'in_review' | 'validated'
  | 'submitted' | 'archived'
  | 'parse_failed' | 'extraction_failed' | 'llm_failed'
  | 'validation_failed' | 'submission_failed'

export interface Job {
  id: string
  project_id: string
  schema_id: string
  schema_version: number
  name: string
  source_file_name?: string
  source_file_size_bytes?: number
  source_type: 'pdf' | 'excel' | 'csv'
  status: JobStatus
  total_raw_records?: number
  total_extracted: number
  total_approved: number
  total_rejected: number
  total_submitted: number
  parse_warnings: unknown[]
  error_message?: string
  created_at: string
  updated_at: string
}

export interface JobStateHistory {
  id: string
  state: JobStatus
  entered_at: string
  exited_at?: string
  triggered_by?: string
  error?: string
}

// ─── Record ──────────────────────────────────────────────────────────────────
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'quarantined' | 'escalated'
export type LLMVerdict = 'PASS' | 'REVIEW' | 'REJECT'
export type ExtractionConfidence = 'high' | 'medium' | 'low' | 'flagged'

export interface LLMFieldFlag {
  field: string
  issue: string
  suggested_value?: string
}

export interface ExtractedRecord {
  id: string
  job_id: string
  schema_version: number
  extraction_confidence: ExtractionConfidence
  pipeline_warnings: unknown[]
  review_status: ReviewStatus
  review_note?: string
  reviewed_by?: string
  reviewed_at?: string
  llm_verdict?: LLMVerdict
  llm_confidence?: number
  llm_field_flags: LLMFieldFlag[]
  llm_reason?: string
  llm_skipped: boolean
  extracted_fields: Record<string, unknown>
  raw_text: string
  is_submitted: boolean
  canonical_name?: string
  created_at: string
}

// ─── Submission ──────────────────────────────────────────────────────────────
export interface SubmissionBatch {
  id: string
  job_id: string
  submitted_by: string
  destination: string
  record_count: number
  schema_version: number
  payload_sha256?: string
  status: string
  created_at: string
}

// ─── Stats ───────────────────────────────────────────────────────────────────
export interface DashboardStats {
  active_jobs: number
  total_jobs: number
  submitted_jobs: number
  pending_review: number
  total_records: number
  approved_records: number
  rejected_records: number
  submitted_records: number
  approval_rate: number
  recent_jobs: RecentJob[]
}

export interface RecentJob {
  id: string
  name: string
  status: JobStatus
  total_extracted: number
  total_approved: number
  created_at: string
}

// ─── Pagination ──────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

// ─── Notification ────────────────────────────────────────────────────────────
export interface Notification {
  id: string
  title: string
  body: string
  link?: string
  is_read: boolean
  created_at: string
}

// ─── Project Resource ───────────────────────────────────────────────────────
export type ResourceType = 'file' | 'link' | 'instruction' | 'sop'

export interface ProjectResource {
  id: string
  project_id: string
  type: ResourceType
  title: string
  description?: string
  file_name?: string
  file_size_bytes?: number
  url?: string
  body?: string
  uploaded_by: string
  created_at: string
}

// ─── Project Submission (annotator work) ───────────────────────────────────
export type WorkSubmissionStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'needs_revision'

export interface ProjectSubmission {
  id: string
  project_id: string
  user_id: string
  title?: string
  note?: string
  file_name: string
  file_size_bytes?: number
  status: WorkSubmissionStatus
  reviewer_id?: string
  review_notes?: string
  submitted_at: string
  reviewed_at?: string
}

// ─── Source (Kanban-tracked dataset) ───────────────────────────────────────
export type SourceStatus =
  | 'not_started' | 'extracting' | 'needs_fixes' | 'ready_for_review'
  | 'in_review' | 'changes_requested' | 'llm_verification' | 'approved'

export interface Source {
  id: string
  project_id: string
  schema_id: string
  schema_name?: string
  name: string
  description?: string
  website_url?: string
  status: SourceStatus
  assigned_extractor_id?: string
  assigned_extractor_name?: string
  assigned_reviewer_id?: string
  assigned_reviewer_name?: string
  total_records: number
  valid_records: number
  invalid_records: number
  approved_records: number
  notes?: string
  created_at: string
  updated_at: string
  extraction_started_at?: string
  extraction_completed_at?: string
  review_started_at?: string
  review_completed_at?: string
  approved_at?: string
  created_by: string
}

export interface SourceUploadSummary {
  total_rows: number
  valid_rows: number
  invalid_rows: number
  job_id: string
}

export interface PerformanceStatRow {
  user_id: string
  name: string
  sources_count: number
  approved_count: number
  total_hours: number
  samples: number
  avg_hours_per_source: number | null
}

export interface PerformanceStats {
  extractors: PerformanceStatRow[]
  reviewers: PerformanceStatRow[]
}
