"""
Sources API — the Kanban-tracked dataset workflow.

A Source is one tracked dataset within a project: it has a schema, an
optional source website, an assigned extractor, an assigned reviewer, and
moves through a status pipeline as work happens (see SourceStatus enum).

Upload flow (synchronous, no Celery dependency):
  1. Extractor uploads a CSV/Excel/JSON file of already-extracted rows
  2. Each row is mapped onto the schema's fields and validated structurally
  3. Records are created with is_schema_valid + validation_errors set
  4. Source status moves to NEEDS_FIXES (if any invalid) or READY_FOR_REVIEW

Re-uploading replaces the source's current record set (simple, predictable —
no row-level merge/dedup in this version). Individual records can also be
fixed inline via PATCH without a full re-upload.
"""
import io, json, math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import pandas as pd

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.all_models import (
    Source, SourceStatus, Project, ProjectMember, User, Schema, SchemaVersion,
    ExtractionJob, ExtractedRecord, JobStatus, SourceType as FileSourceType,
    ExtractionConfidence, ReviewStatus, AuditLog, AuditAction, Notification,
)
from app.schemas.api_schemas import (
    SourceCreate, SourceUpdate, SourceOut, SourceUploadSummary,
    SourceRecordFix, SourceRecordReview, RecordOut, PaginatedResponse,
)
from app.services.schema_validator import validate_record, map_row_to_fields

router = APIRouter(prefix="/sources", tags=["sources"])

ALLOWED_UPLOAD_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".pdf", ".txt", ".zip"}
# Extensions that go through AI extraction (not mechanical row mapping)
AI_EXTRACTION_EXTENSIONS = {".pdf", ".txt"}


# ─── Permission helpers ──────────────────────────────────────────────────────

def _project_role(user: User, project: Project) -> str | None:
    user_roles = {r.role.value for r in user.roles}
    if "org_admin" in user_roles:
        return "org_admin"
    m = next((m for m in project.members if m.user_id == user.id), None)
    return m.role.value if m else None


def _is_org_admin(user: User) -> bool:
    return "org_admin" in {r.role.value for r in user.roles}


def _user_roles(user: User) -> set:
    return {r.role.value for r in user.roles}


def _can_access(user: User, project: Project) -> bool:
    if _is_org_admin(user):
        return True
    return _project_role(user, project) is not None


def _is_project_admin(user: User, project: Project) -> bool:
    if _is_org_admin(user):
        return True
    return _project_role(user, project) in ("org_admin", "project_admin")


def _can_manage_source(user: User, source: Source) -> bool:
    """Admin always wins. For non-admins, check project membership via project_id (no lazy-load)."""
    if _is_org_admin(user):
        return True
    # Check project role via project_id — avoids lazy-loading source.project
    roles = _user_roles(user)
    if "project_admin" in roles:
        return True
    return False


def _is_assigned_extractor(user: User, source: Source) -> bool:
    """Admin and project_admin can act as extractor on any source."""
    if _is_org_admin(user):
        return True
    roles = _user_roles(user)
    if "project_admin" in roles:
        return True
    return source.assigned_extractor_id == user.id


def _is_assigned_reviewer(user: User, source: Source) -> bool:
    """Admin, project_admin, and qa_lead can review any source."""
    if _is_org_admin(user):
        return True
    roles = _user_roles(user)
    if "project_admin" in roles or "qa_lead" in roles:
        return True
    return source.assigned_reviewer_id == user.id


# ─── Serialization ───────────────────────────────────────────────────────────

def _serialize_source(s: Source) -> SourceOut:
    return SourceOut(
        id=s.id, project_id=s.project_id, schema_id=s.schema_id,
        schema_name=s.schema.name if s.schema else None,
        name=s.name, description=s.description, website_url=s.website_url,
        status=s.status.value,
        assigned_extractor_id=s.assigned_extractor_id,
        assigned_extractor_name=s.extractor.full_name if s.extractor else None,
        assigned_reviewer_id=s.assigned_reviewer_id,
        assigned_reviewer_name=s.reviewer.full_name if s.reviewer else None,
        total_records=s.total_records or 0, valid_records=s.valid_records or 0,
        invalid_records=s.invalid_records or 0, approved_records=s.approved_records or 0,
        notes=s.notes, created_at=s.created_at, updated_at=s.updated_at,
        extraction_started_at=s.extraction_started_at,
        extraction_completed_at=s.extraction_completed_at,
        review_started_at=s.review_started_at, review_completed_at=s.review_completed_at,
        approved_at=s.approved_at, created_by=s.created_by,
    )


def _serialize_record(r: ExtractedRecord) -> RecordOut:
    return RecordOut(
        id=r.id, job_id=r.job_id, schema_version=r.schema_version,
        extraction_confidence=r.extraction_confidence.value,
        pipeline_warnings=r.pipeline_warnings or [],
        is_schema_valid=r.is_schema_valid, validation_errors=r.validation_errors or [],
        review_status=r.review_status.value, review_note=r.review_note,
        reviewed_by=r.reviewed_by, reviewed_at=r.reviewed_at,
        llm_verdict=r.llm_verdict.value if r.llm_verdict else None,
        llm_confidence=r.llm_confidence, llm_field_flags=r.llm_field_flags or [],
        llm_reason=r.llm_reason, llm_skipped=r.llm_skipped,
        web_verified=r.web_verified,
        web_check_flags=r.web_check_flags or [],
        web_check_summary=r.web_check_summary,
        extracted_fields=r.extracted_fields or {}, raw_text=r.raw_text or "",
        is_submitted=r.is_submitted, canonical_name=r.canonical_name,
        created_at=r.created_at,
    )


def _get_source_or_404(source_id: str, db: Session) -> Source:
    source = db.query(Source).filter(Source.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


def _recompute_counts(source: Source, db: Session):
    records = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractionJob.source_id == source.id
    ).all()
    source.total_records = len(records)
    source.valid_records = sum(1 for r in records if r.is_schema_valid)
    source.invalid_records = source.total_records - source.valid_records
    source.approved_records = sum(1 for r in records if r.review_status == ReviewStatus.APPROVED)


# ─── CRUD ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[SourceOut])
def list_sources(
    project_id: str = Query(None),
    status: str = Query(None),
    assigned_to_me: bool = Query(False, description="Only sources where I'm the extractor or reviewer"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    is_admin = "org_admin" in user_roles

    if project_id:
        project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not _can_access(current_user, project):
            raise HTTPException(status_code=403, detail="Access denied")
        q = db.query(Source).filter(Source.project_id == project_id)
    else:
        # No project specified — return sources across every project the user can access
        if is_admin:
            q = db.query(Source)
        else:
            accessible_project_ids = [
                m.project_id for m in db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).all()
            ]
            if not accessible_project_ids:
                return []
            q = db.query(Source).filter(Source.project_id.in_(accessible_project_ids))

    if status:
        try:
            q = q.filter(Source.status == SourceStatus(status))
        except ValueError:
            pass

    if assigned_to_me:
        q = q.filter(
            (Source.assigned_extractor_id == current_user.id) | (Source.assigned_reviewer_id == current_user.id)
        )

    sources = q.order_by(Source.updated_at.desc()).all()
    return [_serialize_source(s) for s in sources]


@router.post("", response_model=SourceOut, status_code=201)
def create_source(
    payload: SourceCreate,
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at == None).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _is_project_admin(current_user, project):
        raise HTTPException(status_code=403, detail="Only project admins can create sources")

    schema = db.query(Schema).filter(Schema.id == payload.schema_id, Schema.project_id == project_id).first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found in this project")
    if not db.query(SchemaVersion).filter(SchemaVersion.schema_id == schema.id).first():
        raise HTTPException(status_code=422, detail="Schema has no versions — add fields first")

    source = Source(
        project_id=project_id, schema_id=payload.schema_id, name=payload.name,
        description=payload.description, website_url=payload.website_url,
        assigned_extractor_id=payload.assigned_extractor_id,
        assigned_reviewer_id=payload.assigned_reviewer_id,
        status=SourceStatus.EXTRACTING if payload.assigned_extractor_id else SourceStatus.NOT_STARTED,
        created_by=current_user.id,
    )
    db.add(source)
    db.flush()
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.SOURCE_CREATED, after_value={"name": payload.name},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


@router.get("/{source_id}", response_model=SourceOut)
def get_source(source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    source = _get_source_or_404(source_id, db)
    if not _can_access(current_user, source.project):
        raise HTTPException(status_code=403, detail="Access denied")
    return _serialize_source(source)


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(
    source_id: str, payload: SourceUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _can_manage_source(current_user, source):
        raise HTTPException(status_code=403, detail="Only project admins can edit sources")

    before_status = source.status.value
    if payload.name is not None:
        source.name = payload.name
    if payload.description is not None:
        source.description = payload.description
    if payload.website_url is not None:
        source.website_url = payload.website_url
    if payload.notes is not None:
        source.notes = payload.notes

    if payload.assigned_extractor_id is not None:
        source.assigned_extractor_id = payload.assigned_extractor_id or None
        if source.status == SourceStatus.NOT_STARTED and source.assigned_extractor_id:
            source.status = SourceStatus.EXTRACTING
            source.extraction_started_at = datetime.now(timezone.utc)
    if payload.assigned_reviewer_id is not None:
        source.assigned_reviewer_id = payload.assigned_reviewer_id or None

    if payload.status is not None:
        try:
            new_status = SourceStatus(payload.status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {payload.status}")
        source.status = new_status
        if new_status == SourceStatus.IN_REVIEW and not source.review_started_at:
            source.review_started_at = datetime.now(timezone.utc)
        if new_status == SourceStatus.APPROVED:
            source.approved_at = datetime.now(timezone.utc)
            source.review_completed_at = source.review_completed_at or datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        before_value={"status": before_status}, after_value={"status": source.status.value},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


# ─── Upload + validate ───────────────────────────────────────────────────────

@router.post("/{source_id}/upload", response_model=SourceUploadSummary)
async def upload_to_source(
    source_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Two paths depending on file type:

    Structured (CSV / Excel / JSON):
      Rows are mapped mechanically onto schema fields and validated.
      Fast — no LLM call, results in seconds.

    Unstructured (PDF / TXT):
      Claude reads the document, understands the schema, and extracts
      every record it can find. Runs synchronously — no Celery needed.
      Takes 10–30 seconds depending on document size.
    """
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor, project admin, or org admin can upload to this source")

    import os as _os
    filename = file.filename or ""
    ext = _os.path.splitext(filename)[1].lower()
    # Fallback: if no extension from filename, check content-type
    if not ext:
        ct = (file.content_type or "").lower()
        if "pdf" in ct:
            ext = ".pdf"
        elif "text" in ct or "plain" in ct:
            ext = ".txt"
        elif "csv" in ct:
            ext = ".csv"
        elif "json" in ct:
            ext = ".json"
        elif "sheet" in ct or "excel" in ct or "spreadsheet" in ct:
            ext = ".xlsx"

    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type '{ext or file.content_type}'. Accepted: PDF, TXT, CSV, XLSX, JSON.")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()

    # Allow uploads even if schema has no field definitions.
    # Records will be stored as-is with no schema validation.
    schema_fields = []
    if schema_ver and schema_ver.definition:
        schema_fields = schema_ver.definition.get("fields", [])
    content = await file.read()

    # ── Route: AI extraction (PDF / TXT) ──────────────────────────────────────
    if ext in AI_EXTRACTION_EXTENSIONS:
        try:
            rows = await _extract_with_llm(content, ext, schema_ver.definition, source)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")
        if not rows:
            raise HTTPException(status_code=422, detail="AI extraction found no records in the document. Check that the document matches the schema and try again.")
        extraction_method = "llm"
        file_breakdown: list[dict] = []
        files_processed = 1

    # ── Route: ZIP archive with multiple JSON/CSV/Excel files ────────────────
    elif ext == ".zip":
        rows, file_breakdown = _parse_zip(content)
        if not rows:
            skipped = [f for f in file_breakdown if f.get("error")]
            detail = f"No records found in ZIP. {len(file_breakdown)} file(s) checked."
            if skipped:
                detail += f" Errors: {'; '.join(f['filename'] + ': ' + f['error'] for f in skipped[:3])}"
            raise HTTPException(status_code=422, detail=detail)
        extraction_method = "structured"
        files_processed = len([f for f in file_breakdown if not f.get("error")])

    else:
        # ── Route: mechanical row mapping (CSV / Excel / JSON) ─────────────────
        rows = _parse_rows(content, ext, file.filename or "")
        if not rows:
            raise HTTPException(status_code=422, detail="No rows found in the uploaded file.")
        extraction_method = "structured"
        file_breakdown = []
        files_processed = 1

    # Clear any previous records for this source (re-upload replaces everything)
    old_job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    if old_job_ids:
        db.query(ExtractedRecord).filter(ExtractedRecord.job_id.in_(old_job_ids)).delete(synchronize_session=False)
        db.query(ExtractionJob).filter(ExtractionJob.id.in_(old_job_ids)).delete(synchronize_session=False)

    file_ext_type = {
        ".csv": FileSourceType.CSV, ".xlsx": FileSourceType.EXCEL,
        ".xls": FileSourceType.EXCEL, ".json": FileSourceType.CSV,
        ".pdf": FileSourceType.PDF, ".txt": FileSourceType.CSV,
    }.get(ext, FileSourceType.CSV)

    job = ExtractionJob(
        project_id=source.project_id, source_id=source_id,
        schema_id=source.schema_id, schema_version=schema_ver.version,
        name=f"{source.name} — {extraction_method} upload {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        source_file_name=file.filename, source_file_size_bytes=len(content),
        source_type=file_ext_type, status=JobStatus.READY_FOR_REVIEW,
        total_raw_records=len(rows), total_extracted=len(rows),
        created_by=current_user.id,
    )
    db.add(job)
    db.flush()

    valid_count = 0
    for row in rows:
        if extraction_method == "llm":
            # LLM already returns schema-shaped dicts — just validate
            mapped = {k: v for k, v in row.items() if k != "_raw_text"}
            raw_text = row.get("_raw_text", json.dumps(row, ensure_ascii=False, default=str))
        elif ext in (".json", ".zip"):
            # JSON files are already structured — use fields as-is, don't remap.
            # Only apply fixed_value fields from the schema on top.
            mapped = {k: v for k, v in row.items()}
            for field_def in schema_fields:
                if "fixed_value" in field_def:
                    mapped[field_def["name"]] = field_def["fixed_value"]
            raw_text = json.dumps(row, ensure_ascii=False, default=str)
        else:
            # CSV / Excel — column headers may differ from schema field names,
            # so use map_row_to_fields to normalise them.
            mapped = map_row_to_fields(row, schema_fields)
            raw_text = json.dumps(row, ensure_ascii=False, default=str)

            # ── Post-mapping inference for computed fields ────────────────
            # Infer canonical_name from company_name if missing
            if not mapped.get("canonical_name") and mapped.get("company_name"):
                import unicodedata as _ud
                n = str(mapped["company_name"]).lower().strip()
                n = n.replace("&", "and")
                n = _ud.normalize("NFD", n)
                n = "".join(c for c in n if _ud.category(c) != "Mn")
                n = __import__("re").sub(r"[^\w\s-]", "", n)
                n = __import__("re").sub(r"\s+", "-", n.strip())
                n = __import__("re").sub(r"-{2,}", "-", n)
                mapped["canonical_name"] = n

            # Infer supply_chain_tier from type_description if missing
            if not mapped.get("supply_chain_tier") and mapped.get("type_description"):
                t = str(mapped["type_description"]).lower()
                tier = 1
                if any(x in t for x in ["refiner", "smelter", "recycler", "processor"]):
                    tier = 2
                elif "trader" in t or "distributor" in t:
                    tier = 3
                mapped["supply_chain_tier"] = tier

            # Infer industry_sector from products_raw if missing
            if not mapped.get("industry_sector"):
                src_text = " ".join(filter(None, [
                    str(mapped.get("products_raw") or ""),
                    str(mapped.get("type_description") or ""),
                    str(mapped.get("company_description") or ""),
                ])).lower()
                SECTOR_KW = [
                    ("recycl", "recycled aggregates"),
                    ("rare earth", "metals mining"), ("ree", "metals mining"),
                    ("lithium", "metals mining"), ("cobalt", "metals mining"),
                    ("nickel", "metals mining"), ("copper", "metals mining"),
                    ("zinc", "metals mining"), ("lead", "metals mining"),
                    ("tin", "metals mining"), ("aluminum", "metals mining"),
                    ("aluminium", "metals mining"), ("bauxite", "construction minerals"),
                    ("gold", "metals mining"), ("silver", "metals mining"),
                    ("platinum", "metals mining"), ("uranium", "metals mining"),
                    ("graphite", "industrial minerals"), ("silica", "industrial minerals"),
                    ("potash", "industrial minerals"), ("salt", "industrial minerals"),
                    ("coal", "coal"), ("oil", "oil and gas"), ("gas", "oil and gas"),
                ]
                sector = "metals mining"  # default for this dataset
                for kw, sec in SECTOR_KW:
                    if kw in src_text:
                        sector = sec
                        break
                mapped["industry_sector"] = sector

            # Set fixed values from schema
            for field_def in schema_fields:
                if "fixed_value" in field_def and field_def["name"] not in mapped:
                    mapped[field_def["name"]] = field_def["fixed_value"]
            # Always enforce is_verified=false
            mapped["is_verified"] = False

        is_valid, errors = validate_record(mapped, schema_fields)
        if is_valid:
            valid_count += 1
        record = ExtractedRecord(
            job_id=job.id, schema_version=schema_ver.version,
            extraction_confidence=ExtractionConfidence.HIGH if is_valid else ExtractionConfidence.FLAGGED,
            is_schema_valid=is_valid, validation_errors=errors,
            review_status=ReviewStatus.PENDING,
            extracted_fields=mapped, raw_text=raw_text,
            canonical_name=str(mapped.get("canonical_name") or mapped.get("company_name") or mapped.get("material_name") or mapped.get("name") or "")[:512] or None,
        )
        db.add(record)

    invalid_count = len(rows) - valid_count
    source.status = SourceStatus.NEEDS_FIXES if invalid_count > 0 else SourceStatus.READY_FOR_REVIEW
    if not source.extraction_started_at:
        source.extraction_started_at = datetime.now(timezone.utc)
    if invalid_count == 0:
        source.extraction_completed_at = datetime.now(timezone.utc)

    try:
        db.flush()
        _recompute_counts(source, db)
        db.add(AuditLog(
            user_id=current_user.id, project_id=source.project_id,
            action=AuditAction.SOURCE_DATA_UPLOADED,
            after_value={"file": file.filename, "method": extraction_method, "rows": len(rows), "valid": valid_count, "invalid": invalid_count},
        ))
        db.commit()
    except Exception as db_err:
        db.rollback()
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"DB error saving records: {type(db_err).__name__}: {str(db_err)[:500]}. "
                   f"This usually means a database migration hasn't run. "
                   f"Check /health/db for missing columns. Traceback: {traceback.format_exc()[-800:]}"
        )

    return SourceUploadSummary(
        total_rows=len(rows), valid_rows=valid_count,
        invalid_rows=invalid_count, job_id=job.id,
        extraction_method=extraction_method,
        files_processed=files_processed,
        file_breakdown=file_breakdown,
    )


async def _extract_with_llm(content: bytes, ext: str, schema_definition: dict, source: Source) -> list[dict]:
    """
    Uses Claude to extract structured records from a PDF or plain-text document.
    Returns a list of dicts matching the schema's field names.
    The model is told exactly what fields to extract, their types, and what
    the extraction instructions say — same instructions human extractors follow.
    """
    import anthropic, re
    from app.core.config import settings

    # Extract readable text from the document
    if ext == ".pdf":
        import pdfplumber, io as _io
        text_parts = []
        with pdfplumber.open(_io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        doc_text = "\n\n".join(text_parts)
    else:
        doc_text = content.decode("utf-8", errors="replace")

    if not doc_text.strip():
        raise ValueError("Could not extract any readable text from the document.")

    # Trim to ~60k chars to stay within context — for very large docs we take a representative sample
    MAX_CHARS = 60000
    if len(doc_text) > MAX_CHARS:
        doc_text = doc_text[:MAX_CHARS] + "\n\n[Document truncated — extract from the above portion only]"

    # Build a clean field spec for the prompt
    fields = schema_definition.get("fields", [])
    required_fields = [f for f in fields if f.get("required") and "fixed_value" not in f]
    optional_fields = [f for f in fields if not f.get("required") and "fixed_value" not in f]
    fixed_fields = {f["name"]: f["fixed_value"] for f in fields if "fixed_value" in f}

    def field_line(f: dict) -> str:
        parts = [f"- {f['name']} ({f.get('type','string')})"]
        if f.get("description"):
            parts.append(f": {f['description']}")
        if f.get("enum"):
            parts.append(f" — allowed values: {f['enum']}")
        return "".join(parts)

    extraction_instructions = schema_definition.get("extraction_instructions", "")
    grouping_key = schema_definition.get("grouping_key", "")

    system_prompt = f"""You are a precise data extraction specialist. You extract structured records from documents and return them as JSON.

SCHEMA: {schema_definition.get('name', 'Data Extraction Schema')}
{f'GROUPING: Each record represents one unique {grouping_key}.' if grouping_key else ''}
{f'EXTRACTION RULES:\\n{extraction_instructions}' if extraction_instructions else ''}

REQUIRED FIELDS (must be present in every record):
{chr(10).join(field_line(f) for f in required_fields) or '(none)'}

OPTIONAL FIELDS (include if present in the source):
{chr(10).join(field_line(f) for f in optional_fields) or '(none)'}

FIXED FIELDS (always set these exact values, do not extract from document):
{chr(10).join(f'- {k}: {v}' for k, v in fixed_fields.items()) or '(none)'}

CRITICAL — NESTED OBJECT STRUCTURE:
Array fields must contain OBJECTS, not plain strings. Use these exact structures:

manufacturing_sites must be an array of objects:
  {{"location": "Site Name (Grid Ref or Lat/Long)", "country": "Country name", "site_type": "mine|quarry|pit|refinery|smelter|processing plant|handling site|wharf|recycling facility|peat workings|exploration site|laboratory", "raw": "verbatim source text about this site — include ownership %, production figures, URLs"}}

products_offered must be an array of objects:
  {{"product_name": "Product Name", "grade": "Grade or variant e.g. Battery-grade", "product_id": "SITE_PRODUCT_GRADE", "category": "COMMODITY CATEGORY", "source_url": "{source.website_url or ''}", "datasheet_url": null, "cross_graph_material_id": null}}

sources must be an array of objects:
  {{"source_name": "Publication or page name", "source_url": "https://...", "doi": null, "tier": "tier1|tier2|tier3"}}

data_completeness_flags must be this exact object (never null):
  {{"review_score": "manual_only", "defect_rate_ppm": "manual_only", "on_time_delivery_rate": "manual_only", "pricing": "api_only", "inventory_levels": "api_only"}}

extras must be an array with ONE object containing any data that doesn't fit above fields:
  [{{"office_address_1": "...", "office_address_2": "...", "any_other_key": "value"}}]
  Use this for: multiple office addresses, contact details per region, licence numbers,
  JV ownership details, regulatory references — anything structured but not fitting BGS fields.

jv_stakes (if present) must be an array of objects:
  {{"site_name": "Site name", "ownership_pct": 44.0, "jv_partners": ["Partner Name"], "country": "Country", "commodity": "Commodity"}}

annual_production (if present) must be an array of objects:
  {{"commodity": "Copper", "volume": "1,058,100", "unit": "tonnes", "year": "2024", "notes": "own sourced"}}

RULES:
1. Extract EVERY record you can find — do not skip any.
2. If a field is not in the document, set it to null or [] (not a plain string).
3. Return ONLY a JSON array. No preamble, no explanation, no markdown code fences.
4. Each element of the array is one record with exactly the field names above.
5. NEVER put plain strings inside manufacturing_sites, products_offered, sources, or extras arrays.

Example of CORRECT manufacturing_sites:
"manufacturing_sites": [{{"location": "Kamoa-Kakula Copper Complex", "country": "Democratic Republic of Congo", "site_type": "mine", "raw": "Kamoa-Kakula, DRC. Ivanhoe 39.6% | Zijin 39.6% | DRC Govt 20%. Largest undeveloped high-grade copper deposit in the world."}}]

Example of WRONG manufacturing_sites (never do this):
"manufacturing_sites": ["Kamoa-Kakula, Democratic Republic of Congo"]"""

    user_message = f"""Extract all records from this document:

---
{doc_text}
---

Return a JSON array of all records found."""

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    raw_text = response.content[0].text if response.content else ""

    # Strip markdown fences if model added them despite instructions
    clean = raw_text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean)

    records = json.loads(clean.strip())
    if not isinstance(records, list):
        raise ValueError(f"Expected a JSON array, got {type(records).__name__}")

    # Add fixed field values and a raw_text pointer on every record
    for rec in records:
        for k, v in fixed_fields.items():
            rec[k] = v
        if "_raw_text" not in rec:
            rec["_raw_text"] = ""  # will be populated from the row itself

    return records


def _parse_rows(content: bytes, ext: str, filename: str) -> list[dict]:
    if ext == ".csv":
        df = pd.read_csv(io.BytesIO(content))
        return df.where(pd.notnull(df), None).to_dict("records")
    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(io.BytesIO(content))
        return df.where(pd.notnull(df), None).to_dict("records")
    if ext == ".json":
        data = json.loads(content.decode("utf-8"))
        if isinstance(data, list):
            return data
        for key in ("items", "records", "data", "rows", "suppliers", "materials"):
            if isinstance(data, dict) and key in data and isinstance(data[key], list):
                return data[key]
        if isinstance(data, dict):
            return [data]
    return []


def _parse_zip(content: bytes) -> tuple[list[dict], list[dict]]:
    """
    Parse a ZIP archive containing JSON files (or CSV/Excel files).
    Returns (rows, file_breakdown) where file_breakdown is a list of
    {filename, rows, skipped_reason} dicts for the UI summary.
    """
    import zipfile as zf_mod
    import os as _os

    all_rows: list[dict] = []
    breakdown: list[dict] = []
    SUPPORTED = {".json", ".csv", ".xlsx", ".xls"}
    SKIP_PREFIXES = ("__MACOSX", ".", "_")

    def is_skippable(name: str) -> bool:
        parts = name.split("/")
        return any(p.startswith(SKIP_PREFIXES) for p in parts if p)

    def parse_member(fname: str, data: bytes) -> tuple[list[dict], str | None]:
        ext = _os.path.splitext(fname)[1].lower()
        if ext not in SUPPORTED:
            return [], f"unsupported type {ext}"
        try:
            rows = _parse_rows(data, ext, fname)
            return rows, None
        except Exception as e:
            return [], str(e)[:120]

    with zf_mod.ZipFile(io.BytesIO(content)) as zf:
        names = [n for n in zf.namelist() if not is_skippable(n) and not n.endswith("/")]
        for name in names:
            fname = name.split("/")[-1]  # just the filename
            ext = _os.path.splitext(fname)[1].lower()
            if ext == ".zip":
                # One level of nesting — unzip inner ZIP and process its members
                inner_content = zf.read(name)
                try:
                    with zf_mod.ZipFile(io.BytesIO(inner_content)) as inner_zf:
                        for inner_name in inner_zf.namelist():
                            if is_skippable(inner_name) or inner_name.endswith("/"):
                                continue
                            inner_fname = inner_name.split("/")[-1]
                            rows, err = parse_member(inner_fname, inner_zf.read(inner_name))
                            breakdown.append({"filename": f"{fname}/{inner_fname}", "rows": len(rows), "error": err})
                            all_rows.extend(rows)
                except Exception as e:
                    breakdown.append({"filename": fname, "rows": 0, "error": f"inner ZIP error: {str(e)[:80]}"})
            elif ext in SUPPORTED:
                rows, err = parse_member(fname, zf.read(name))
                breakdown.append({"filename": fname, "rows": len(rows), "error": err})
                all_rows.extend(rows)
            # else: skip silently (images, READMEs, etc.)

    return all_rows, breakdown


# ─── Records (fix + review) ──────────────────────────────────────────────────

@router.get("/{source_id}/records", response_model=PaginatedResponse)
def list_source_records(
    source_id: str,
    validity: str = Query(None, description="valid | invalid"),
    review_status: str = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)

    # Role check without lazy-loading source.project
    user_roles = {r.role.value for r in current_user.roles}
    if "org_admin" not in user_roles:
        member = db.query(ProjectMember).filter(
            ProjectMember.project_id == source.project_id,
            ProjectMember.user_id == current_user.id,
        ).first()
        if not member:
            raise HTTPException(status_code=403, detail="Access denied")

    q = (
        db.query(ExtractedRecord)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(ExtractionJob.source_id == source_id)
    )
    if validity == "valid":
        q = q.filter(ExtractedRecord.is_schema_valid == True)
    elif validity == "invalid":
        q = q.filter(ExtractedRecord.is_schema_valid == False)
    if review_status:
        try:
            q = q.filter(ExtractedRecord.review_status == ReviewStatus(review_status))
        except ValueError:
            pass

    total = q.count()
    records = q.order_by(ExtractedRecord.created_at).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize_record(r) for r in records],
        total=total, page=page, page_size=page_size, pages=math.ceil(total / page_size) or 1,
    )


@router.patch("/{source_id}/records/{record_id}", response_model=RecordOut)
def fix_record(
    source_id: str, record_id: str, payload: SourceRecordFix,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor, project admin, or org admin can fix records")

    record = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractedRecord.id == record_id, ExtractionJob.source_id == source_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found in this source")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    schema_fields = schema_ver.definition.get("fields", []) if schema_ver else []

    before = dict(record.extracted_fields or {})
    record.extracted_fields = {**(record.extracted_fields or {}), **payload.extracted_fields}
    is_valid, errors = validate_record(record.extracted_fields, schema_fields)
    record.is_schema_valid = is_valid
    record.validation_errors = errors
    record.extraction_confidence = ExtractionConfidence.HIGH if is_valid else ExtractionConfidence.FLAGGED
    if record.review_status == ReviewStatus.REJECTED and is_valid:
        record.review_status = ReviewStatus.PENDING  # re-submit for review after a fix

    db.flush()
    _recompute_counts(source, db)
    if source.invalid_records == 0 and source.status == SourceStatus.NEEDS_FIXES:
        source.status = SourceStatus.READY_FOR_REVIEW
        source.extraction_completed_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_RECORD_FIXED,
        before_value={"fields": before}, after_value={"fields": record.extracted_fields},
    ))
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.post("/{source_id}/records/{record_id}/review", response_model=RecordOut)
def review_source_record(
    source_id: str, record_id: str, payload: SourceRecordReview,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    source = _get_source_or_404(source_id, db)

    if not _is_assigned_reviewer(current_user, source):
        raise HTTPException(status_code=403, detail="Only reviewers, QA leads, project admins, or org admins can review records")

    record = (
        db.query(ExtractedRecord)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(ExtractedRecord.id == record_id, ExtractionJob.source_id == source_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Record not found in this source")

    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="action must be 'approve' or 'reject'")

    record.review_status = ReviewStatus.APPROVED if payload.action == "approve" else ReviewStatus.REJECTED
    record.review_note = payload.note
    record.reviewed_by = current_user.id
    record.reviewed_at = datetime.now(timezone.utc)

    if source.status not in (SourceStatus.IN_REVIEW,):
        source.status = SourceStatus.IN_REVIEW
        source.review_started_at = source.review_started_at or datetime.now(timezone.utc)

    if payload.action == "reject":
        source.status = SourceStatus.CHANGES_REQUESTED
        if source.assigned_extractor_id:
            db.add(Notification(
                user_id=source.assigned_extractor_id,
                title=f"Record sent back in '{source.name}'",
                body=payload.note or "A reviewer sent a record back for fixes.",
                link=f"/sources/{source.id}",
            ))

    db.flush()
    _recompute_counts(source, db)
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.post("/{source_id}/approve", response_model=SourceOut)
def approve_source(
    source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Mark a source as fully approved. Warns if pending records remain but allows admins to override."""
    source = _get_source_or_404(source_id, db)

    if not _is_assigned_reviewer(current_user, source):
        raise HTTPException(status_code=403, detail="Only reviewers, QA leads, project admins, or org admins can approve a source")

    user_roles = _user_roles(current_user)
    is_admin = "org_admin" in user_roles or "project_admin" in user_roles

    # Count unapproved records
    pending_or_rejected = (
        db.query(ExtractedRecord)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(
            ExtractionJob.source_id == source_id,
            ExtractedRecord.review_status != ReviewStatus.APPROVED,
        ).count()
    )

    # Admins can approve even with pending records — reviewers cannot
    if pending_or_rejected > 0 and not is_admin:
        raise HTTPException(
            status_code=422,
            detail=f"{pending_or_rejected} record(s) not yet approved. Approve them first or ask an admin to override."
        )

    source.status = SourceStatus.APPROVED
    source.approved_at = datetime.now(timezone.utc)
    source.review_completed_at = source.review_completed_at or datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_APPROVED, after_value={"source_id": source_id},
    ))
    db.commit()
    db.refresh(source)
    return _serialize_source(source)


# ─── Export package ──────────────────────────────────────────────────────────

@router.get("/{source_id}/export")
def export_source(source_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_reviewer(current_user, source) and not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Access denied")
    if source.status != SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail="Source must be approved before export")

    # Fetch approved records through ExtractionJob
    records = (
        db.query(ExtractedRecord)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(
            ExtractionJob.source_id == source_id,
            ExtractedRecord.review_status == ReviewStatus.APPROVED,
        ).all()
    )
    data = [r.extracted_fields for r in records]

    duration = None
    if source.extraction_started_at and source.approved_at:
        delta = source.approved_at - source.extraction_started_at
        hours = delta.total_seconds() / 3600
        duration = f"{hours:.1f} hours" if hours < 48 else f"{delta.days} days"

    cover_sheet = f"""# {source.name} — Data Export Cover Sheet

## Source Information
- **Source name:** {source.name}
- **Description:** {source.description or '(none)'}
- **Website:** {source.website_url or '(none)'}
- **Schema:** {source.schema.name if source.schema else 'Unknown'}
- **Project:** {source.project.name if source.project else 'Unknown'}

## Extraction Summary
- **Total rows uploaded:** {source.total_records}
- **Passed schema validation:** {source.valid_records}
- **Failed validation (fixed before approval):** {source.invalid_records}
- **Final approved records:** {len(records)}

## Team
- **Extractor:** {source.extractor.full_name if source.extractor else 'Unassigned'}
- **Reviewer:** {source.reviewer.full_name if source.reviewer else 'Unassigned'}

## Timeline
- **Extraction started:** {source.extraction_started_at.strftime('%Y-%m-%d %H:%M UTC') if source.extraction_started_at else 'N/A'}
- **Extraction completed:** {source.extraction_completed_at.strftime('%Y-%m-%d %H:%M UTC') if source.extraction_completed_at else 'N/A'}
- **Review started:** {source.review_started_at.strftime('%Y-%m-%d %H:%M UTC') if source.review_started_at else 'N/A'}
- **Approved:** {source.approved_at.strftime('%Y-%m-%d %H:%M UTC') if source.approved_at else 'N/A'}
- **Total time, start to approval:** {duration or 'N/A'}

## Notes / Assumptions
{source.notes or '(none recorded)'}

---
Generated by Xtrium DataOps on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
"""

    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(data, indent=2, ensure_ascii=False, default=str))
        zf.writestr("COVER_SHEET.md", cover_sheet)

        # Include the most recent raw uploaded file, if retrievable
        latest_job = db.query(ExtractionJob).filter(
            ExtractionJob.source_id == source_id
        ).order_by(ExtractionJob.created_at.desc()).first()
        if latest_job and latest_job.source_file_url:
            try:
                from app.services.storage import storage
                raw_bytes = storage.read(latest_job.source_file_url)
                raw_name = latest_job.source_file_name or "raw_upload"
                zf.writestr(f"raw_{raw_name}", raw_bytes)
            except Exception:
                pass  # raw file not retrievable — JSON + cover sheet still included

    buf.seek(0)
    # Use canonical_name as the ZIP filename — SOP naming convention, never transform it
    cn = source.canonical_name or source.name
    cn = str(cn).strip().replace("/", "-").replace("\\", "-").replace(":", "-") or "source"
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{cn}.zip"'},
    )


# ─── Performance analytics ───────────────────────────────────────────────────

@router.get("/stats/performance")
def performance_stats(
    project_id: str = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    user_roles = {r.role.value for r in current_user.roles}
    if not user_roles.intersection({"org_admin", "project_admin", "qa_lead"}):
        raise HTTPException(status_code=403, detail="Admin or QA access required")

    q = db.query(Source)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    sources = q.all()

    by_extractor: dict[str, dict] = {}
    by_reviewer: dict[str, dict] = {}

    for s in sources:
        if s.assigned_extractor_id:
            stats = by_extractor.setdefault(s.assigned_extractor_id, {
                "user_id": s.assigned_extractor_id,
                "name": s.extractor.full_name if s.extractor else "Unknown",
                "sources_count": 0, "approved_count": 0, "total_hours": 0.0, "samples": 0,
            })
            stats["sources_count"] += 1
            if s.status == SourceStatus.APPROVED:
                stats["approved_count"] += 1
            if s.extraction_started_at and s.extraction_completed_at:
                hours = (s.extraction_completed_at - s.extraction_started_at).total_seconds() / 3600
                stats["total_hours"] += hours
                stats["samples"] += 1

        if s.assigned_reviewer_id:
            stats = by_reviewer.setdefault(s.assigned_reviewer_id, {
                "user_id": s.assigned_reviewer_id,
                "name": s.reviewer.full_name if s.reviewer else "Unknown",
                "sources_count": 0, "approved_count": 0, "total_hours": 0.0, "samples": 0,
            })
            stats["sources_count"] += 1
            if s.status == SourceStatus.APPROVED:
                stats["approved_count"] += 1
            if s.review_started_at and s.review_completed_at:
                hours = (s.review_completed_at - s.review_started_at).total_seconds() / 3600
                stats["total_hours"] += hours
                stats["samples"] += 1

    def finalize(d: dict) -> list[dict]:
        out = []
        for v in d.values():
            avg = v["total_hours"] / v["samples"] if v["samples"] else None
            out.append({**v, "avg_hours_per_source": round(avg, 1) if avg is not None else None})
        return out

    return {"extractors": finalize(by_extractor), "reviewers": finalize(by_reviewer)}


# ─── Delete source ────────────────────────────────────────────────────────────

@router.delete("/{source_id}", status_code=204)
def delete_source(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a source and all its jobs and records. Only admins can do this."""
    source = db.query(Source).filter(
        Source.id == source_id, Source.deleted_at == None
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    # Use current_user.roles directly — already loaded by the auth dependency
    user_roles = {r.role.value for r in current_user.roles}
    is_org_admin = "org_admin" in user_roles

    if not is_org_admin:
        from app.models.all_models import ProjectMember as PM
        member = db.query(PM).filter(
            PM.project_id == source.project_id,
            PM.user_id == current_user.id,
        ).first()
        if not member or member.role.value not in ("project_admin", "org_admin"):
            raise HTTPException(status_code=403, detail="Only admins can delete sources")

    if source.status == SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail="Approved sources cannot be deleted. Reset it first.")

    source_name = source.name
    source_status = source.status.value
    project_id = source.project_id

    # Delete all records and jobs first
    job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    if job_ids:
        db.query(ExtractedRecord).filter(ExtractedRecord.job_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(ExtractionJob).filter(ExtractionJob.id.in_(job_ids)).delete(synchronize_session=False)

    db.delete(source)
    db.add(AuditLog(
        user_id=current_user.id, project_id=project_id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        before_value={"name": source_name, "status": source_status},
        after_value={"deleted": True},
    ))
    db.commit()


@router.delete("/{source_id}/records/{record_id}", status_code=204)
def delete_source_record(
    source_id: str, record_id: str,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Delete a single record from a source. Extractor or admin only."""
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor or admin can delete records")
    record = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractedRecord.id == record_id, ExtractionJob.source_id == source_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found in this source")
    db.delete(record)
    db.flush()
    _recompute_counts(source, db)
    db.commit()


# ─── Capability 1: Scrape website → extract records via AI ──────────────────

@router.post("/{source_id}/scrape", response_model=SourceUploadSummary)
async def scrape_source_website(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Fetches the source's website_url, extracts readable text, then runs the
    same AI extraction pipeline as PDF/TXT uploads. Records are created and
    validated against the schema automatically.

    This is the 'auto-scrape' capability — point the source at a URL and let
    Claude pull the structured records directly.
    """
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_extractor(current_user, source):
        raise HTTPException(status_code=403, detail="Only the assigned extractor or admin can scrape this source")

    if not source.website_url:
        raise HTTPException(status_code=422, detail="This source has no website URL set. Edit the source to add one first.")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()
    if not schema_ver:
        raise HTTPException(status_code=422, detail="This source's schema has no field definitions yet.")

    # Fetch the website
    from app.services.web_scraper import fetch_url_text
    try:
        web_text, meta = await fetch_url_text(source.website_url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch {source.website_url}: {str(e)}")

    if not web_text.strip():
        raise HTTPException(status_code=422, detail="The page returned no readable text. It may require JavaScript or a login.")

    # Run AI extraction on the fetched text
    schema_fields = schema_ver.definition.get("fields", [])
    try:
        rows = await _extract_with_llm(web_text.encode("utf-8"), ".txt", schema_ver.definition, source)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")

    if not rows:
        raise HTTPException(status_code=422, detail="AI found no records matching the schema on this page. The page structure may not match the schema, or the content is behind a login.")

    # Clear previous records and create new job
    old_job_ids = [j.id for j in db.query(ExtractionJob).filter(ExtractionJob.source_id == source_id).all()]
    if old_job_ids:
        db.query(ExtractedRecord).filter(ExtractedRecord.job_id.in_(old_job_ids)).delete(synchronize_session=False)
        db.query(ExtractionJob).filter(ExtractionJob.id.in_(old_job_ids)).delete(synchronize_session=False)

    job = ExtractionJob(
        project_id=source.project_id, source_id=source_id,
        schema_id=source.schema_id, schema_version=schema_ver.version,
        name=f"{source.name} — web scrape {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        source_file_name=source.website_url[:255], source_file_size_bytes=len(web_text),
        source_type=FileSourceType.CSV, status=JobStatus.READY_FOR_REVIEW,
        total_raw_records=len(rows), total_extracted=len(rows),
        created_by=current_user.id,
    )
    db.add(job)
    db.flush()

    valid_count = 0
    for row in rows:
        mapped = {k: v for k, v in row.items() if k != "_raw_text"}
        is_valid, errors = validate_record(mapped, schema_fields)
        if is_valid:
            valid_count += 1
        record = ExtractedRecord(
            job_id=job.id, schema_version=schema_ver.version,
            extraction_confidence=ExtractionConfidence.HIGH if is_valid else ExtractionConfidence.FLAGGED,
            is_schema_valid=is_valid, validation_errors=errors,
            review_status=ReviewStatus.PENDING,
            extracted_fields=mapped,
            raw_text=f"[Scraped from {source.website_url}]\n\n{web_text[:2000]}",
            canonical_name=str(mapped.get("canonical_name") or mapped.get("company_name") or mapped.get("material_name") or "")[:512] or None,
        )
        db.add(record)

    invalid_count = len(rows) - valid_count
    source.status = SourceStatus.NEEDS_FIXES if invalid_count > 0 else SourceStatus.READY_FOR_REVIEW
    if not source.extraction_started_at:
        source.extraction_started_at = datetime.now(timezone.utc)
    if invalid_count == 0:
        source.extraction_completed_at = datetime.now(timezone.utc)

    db.flush()
    _recompute_counts(source, db)
    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_DATA_UPLOADED,
        after_value={"method": "web_scrape", "url": source.website_url, "rows": len(rows), "valid": valid_count},
    ))
    db.commit()

    return SourceUploadSummary(
        total_rows=len(rows), valid_rows=valid_count,
        invalid_rows=invalid_count, job_id=job.id,
        extraction_method="llm",
    )


# ─── Capability 2: LLM verification — cross-check records against live website ─

@router.post("/{source_id}/verify")
async def llm_verify_source(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Runs the LLM verification stage:
      1. Fetches the live source website
      2. Batches all extracted records (20 at a time)
      3. Claude cross-checks each record's field values against the actual page content
      4. Stores per-record web_check_flags with specific field issues and suggested corrections
      5. Returns a summary of what passed, what was flagged, and what to fix

    This is Raghu's 'LLM scrapes the source website and cross-checks' stage.
    After this, the reviewer can see exactly which field values are contested
    and what the website actually says.
    """
    source = _get_source_or_404(source_id, db)
    if not _is_assigned_reviewer(current_user, source):
        raise HTTPException(status_code=403, detail="Access denied")

    if not source.website_url:
        raise HTTPException(status_code=422, detail="No website URL — cannot verify without a source to check against.")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()

    records = db.query(ExtractedRecord).join(ExtractionJob).filter(
        ExtractionJob.source_id == source_id,
    ).all()

    if not records:
        raise HTTPException(status_code=422, detail="No records to verify.")

    # Fetch the live website
    from app.services.web_scraper import fetch_url_text
    try:
        web_text, meta = await fetch_url_text(source.website_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch source website: {str(e)}")

    if not web_text.strip():
        raise HTTPException(status_code=422, detail="The source website returned no readable text — may require JavaScript or login.")

    schema_definition = schema_ver.definition if schema_ver else {}
    fields_def = schema_definition.get("fields", [])
    field_context = [
        {
            "name": f["name"],
            "type": f.get("type", "string"),
            "required": f.get("required", False),
            "description": f.get("description", ""),
            "enum": f.get("enum", []),
        }
        for f in fields_def if "fixed_value" not in f
    ]
    extraction_instructions = schema_definition.get("extraction_instructions", "")

    # Process in batches of 20 to stay within Claude's context window
    import anthropic
    from app.core.config import settings
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    BATCH_SIZE = 20
    total = len(records)
    verified_count = 0
    flagged_count = 0
    error_count = 0

    system_prompt = f"""You are a data quality verifier for a structured data extraction system.

Your job: cross-check extracted records against the actual text from the source website and flag any discrepancies.

Schema: {schema_definition.get('name', 'Data Schema')}
{f'Extraction rules: {extraction_instructions}' if extraction_instructions else ''}

Schema fields to verify:
{json.dumps(field_context, indent=2)}

The source website text will be provided. For each record, check whether its field values are:
1. Supported by the website content (PASS)
2. Inconsistent or likely wrong (FLAG with specific correction)
3. Unverifiable from this page (SKIP - note it cannot be confirmed)

Respond ONLY with valid JSON. No markdown, no preamble.

Required format:
{{
  "results": [
    {{
      "record_id": "<id>",
      "verdict": "PASS" | "FLAG" | "SKIP",
      "summary": "<one sentence>",
      "flags": [
        {{
          "field": "<field_name>",
          "issue": "<what's wrong>",
          "suggested_value": "<what the website says it should be>",
          "confidence": 0.0-1.0
        }}
      ]
    }}
  ]
}}"""

    for batch_start in range(0, total, BATCH_SIZE):
        batch = records[batch_start: batch_start + BATCH_SIZE]

        records_payload = [
            {"record_id": r.id, "fields": r.extracted_fields}
            for r in batch
        ]

        user_content = json.dumps({
            "website_text": web_text[:50000],
            "records_to_verify": records_payload,
        }, ensure_ascii=False, default=str)

        try:
            response = client.messages.create(
                model=settings.LLM_MODEL,
                max_tokens=4000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
            raw = response.content[0].text if response.content else ""

            # Strip markdown fences if present
            import re as _re
            clean = raw.strip()
            if clean.startswith("```"):
                clean = _re.sub(r"^```(?:json)?\s*", "", clean)
                clean = _re.sub(r"\s*```$", "", clean)

            result = json.loads(clean.strip())
            batch_results = {r["record_id"]: r for r in result.get("results", [])}

        except Exception as e:
            # If a batch fails, mark those records as unverified
            for r in batch:
                r.web_verified = None
                r.web_check_summary = f"Verification error: {str(e)[:200]}"
            error_count += len(batch)
            db.flush()
            continue

        # Store results on each record
        for record in batch:
            rec_result = batch_results.get(record.id, {})
            verdict = rec_result.get("verdict", "SKIP")
            flags = rec_result.get("flags", [])
            summary = rec_result.get("summary", "")

            record.web_verified = (verdict == "PASS")
            record.web_check_flags = flags
            record.web_check_summary = summary

            if verdict == "PASS":
                verified_count += 1
            elif verdict == "FLAG":
                flagged_count += 1
            else:
                error_count += 1

        db.flush()

    # Advance source status to llm_verification to reflect this stage ran
    source.status = SourceStatus.LLM_VERIFICATION
    db.add(AuditLog(
        user_id=current_user.id, project_id=source.project_id,
        action=AuditAction.SOURCE_STATUS_CHANGED,
        before_value={}, after_value={"status": "llm_verification", "verified": verified_count, "flagged": flagged_count},
    ))
    db.commit()

    return {
        "total_records": total,
        "verified": verified_count,
        "flagged": flagged_count,
        "unverifiable": error_count,
        "website_url": source.website_url,
        "website_chars_read": meta.get("char_count", 0),
        "truncated": meta.get("truncated", False),
        "message": (
            f"Verification complete — {verified_count} records match the source website, "
            f"{flagged_count} have field-level issues to review."
        ),
    }


# ─── Capability 3: Schema definition endpoint (for review panel) ─────────────

@router.get("/{source_id}/schema")
def get_source_schema(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the full schema definition for this source — used by the review UI
    to show field descriptions, types, and allowed values alongside each record.
    """
    source = _get_source_or_404(source_id, db)
    if not _can_access(current_user, source.project):
        raise HTTPException(status_code=403, detail="Access denied")

    schema_ver = db.query(SchemaVersion).filter(
        SchemaVersion.schema_id == source.schema_id
    ).order_by(SchemaVersion.version.desc()).first()

    if not schema_ver:
        return {"fields": [], "name": "", "extraction_instructions": ""}

    defn = schema_ver.definition or {}
    fields = defn.get("fields", [])
    extras_fields = [f["name"] for f in fields if f.get("extras")]
    extras_source = next((f.get("extras_source") for f in fields if f.get("extras") and f.get("extras_source")), None)

    return {
        "name": source.schema.name if source.schema else "",
        "version": schema_ver.version,
        "definition": defn,
        "fields": fields,
        "extraction_instructions": defn.get("extraction_instructions", ""),
        "grouping_key": defn.get("grouping_key", ""),
        "source_website": defn.get("source_website", ""),
        "base_schema": defn.get("base_schema", ""),
        # Extras metadata for the UI
        "has_extras": len(extras_fields) > 0,
        "extras_fields": extras_fields,
        "extras_source": extras_source,
    }


# ─── Admin: Reset source status ───────────────────────────────────────────────

@router.post("/{source_id}/reset")
def reset_source(
    source_id: str,
    clear_records: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin-only: Reset a source back to 'not_started'.
    Optionally wipe all extracted records (default: True).
    Use this to recover from bad extractions or test data.
    """
    source = _get_source_or_404(source_id, db)

    # Check admin using current_user.roles (already loaded) — avoid lazy-load on source.project
    user_roles = {r.role.value for r in current_user.roles}
    if "org_admin" not in user_roles:
        from app.models.all_models import ProjectMember as PM
        member = db.query(PM).filter(PM.project_id == source.project_id, PM.user_id == current_user.id).first()
        if not member or member.role.value not in ("project_admin", "org_admin"):
            raise HTTPException(status_code=403, detail="Only admins can reset sources")

    if clear_records:
        # ExtractedRecord links to Source through ExtractionJob (no direct source_id)
        job_ids = [j.id for j in db.query(ExtractionJob).filter(
            ExtractionJob.source_id == source_id
        ).all()]
        if job_ids:
            db.query(ExtractedRecord).filter(
                ExtractedRecord.job_id.in_(job_ids)
            ).delete(synchronize_session=False)
        db.query(ExtractionJob).filter(
            ExtractionJob.source_id == source_id
        ).delete(synchronize_session=False)

    source.status = SourceStatus.NOT_STARTED
    source.total_records = 0
    source.valid_records = 0
    source.invalid_records = 0
    source.approved_records = 0
    source.extraction_started_at = None
    source.extraction_completed_at = None
    source.review_started_at = None
    source.approved_at = None
    source.web_verified = None
    source.web_check_summary = None
    db.commit()
    db.refresh(source)

    return {
        "message": f"Source reset to 'not_started' {'with records cleared' if clear_records else 'status only'}",
        "source_id": source_id,
        "status": source.status,
        "records_cleared": clear_records,
    }


# ─── Admin: Clear all records from a source (keep source, keep status) ────────

@router.delete("/{source_id}/records", status_code=200)
def clear_source_records(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin-only: Delete ALL records from a source without changing its status.
    Use this to wipe test data before a real extraction run.
    """
    source = _get_source_or_404(source_id, db)

    if not _can_manage_source(current_user, source):
        raise HTTPException(status_code=403, detail="Only admins can clear records")

    job_ids = [j.id for j in db.query(ExtractionJob).filter(
        ExtractionJob.source_id == source_id
    ).all()]

    deleted_records = 0
    if job_ids:
        deleted_records = db.query(ExtractedRecord).filter(
            ExtractedRecord.job_id.in_(job_ids)
        ).delete(synchronize_session=False)
        db.query(ExtractionJob).filter(
            ExtractionJob.id.in_(job_ids)
        ).delete(synchronize_session=False)

    # Reset counts
    source.total_records = 0
    source.valid_records = 0
    source.invalid_records = 0
    source.approved_records = 0
    source.web_verified = None
    source.web_check_summary = None
    db.commit()

    return {
        "message": f"Cleared {deleted_records} records from source",
        "records_deleted": deleted_records,
        "source_id": source_id,
    }


# ─── Admin: Dismiss a web check flag on a record ──────────────────────────────

@router.delete("/{source_id}/records/{record_id}/flags/{flag_index}")
def dismiss_flag(
    source_id: str,
    record_id: str,
    flag_index: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Dismiss one web-check flag by index. Available to reviewers and above.
    The flag is removed permanently from the record — use when the LLM flagged
    something that is actually correct.
    """
    record = db.query(ExtractedRecord).join(
        ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id
    ).filter(
        ExtractedRecord.id == record_id,
        ExtractionJob.source_id == source_id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    flags = list(record.web_check_flags or [])
    if flag_index < 0 or flag_index >= len(flags):
        raise HTTPException(status_code=400, detail=f"Flag index {flag_index} out of range")

    removed = flags.pop(flag_index)
    record.web_check_flags = flags
    if not flags:
        record.web_verified = True
        record.web_check_summary = "All flags dismissed by reviewer"

    db.commit()
    return {"dismissed": removed, "remaining_flags": len(flags)}
