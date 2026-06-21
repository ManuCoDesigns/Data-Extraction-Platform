from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import math
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.all_models import (
    ExtractedRecord, ReviewStatus, User, AuditLog, AuditAction,
    ExtractionJob
)
from app.schemas.api_schemas import RecordOut, RecordReviewAction, RecordBulkAction, PaginatedResponse

router = APIRouter(prefix="/records", tags=["records"])


def _serialize(r: ExtractedRecord) -> RecordOut:
    return RecordOut(
        id=r.id,
        job_id=r.job_id,
        schema_version=r.schema_version,
        extraction_confidence=r.extraction_confidence.value,
        pipeline_warnings=r.pipeline_warnings or [],
        is_schema_valid=r.is_schema_valid if r.is_schema_valid is not None else True,
        validation_errors=r.validation_errors or [],
        review_status=r.review_status.value,
        review_note=r.review_note,
        reviewed_by=r.reviewed_by,
        reviewed_at=r.reviewed_at,
        llm_verdict=r.llm_verdict.value if r.llm_verdict else None,
        llm_confidence=r.llm_confidence,
        llm_field_flags=r.llm_field_flags or [],
        llm_reason=r.llm_reason,
        llm_skipped=r.llm_skipped,
        extracted_fields=r.extracted_fields or {},
        raw_text=r.raw_text,
        is_submitted=r.is_submitted,
        canonical_name=r.canonical_name,
        created_at=r.created_at,
    )


@router.get("", response_model=PaginatedResponse)
def list_records(
    job_id: str = Query(...),
    review_status: str = Query(None),
    llm_verdict: str = Query(None),
    confidence: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ExtractedRecord).filter(ExtractedRecord.job_id == job_id)
    if review_status:
        try:
            q = q.filter(ExtractedRecord.review_status == ReviewStatus(review_status))
        except ValueError:
            pass
    if llm_verdict:
        q = q.filter(ExtractedRecord.llm_verdict == llm_verdict)
    if confidence:
        q = q.filter(ExtractedRecord.extraction_confidence == confidence)

    total = q.count()
    records = q.order_by(ExtractedRecord.created_at).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=[_serialize(r) for r in records],
        total=total, page=page, page_size=page_size,
        pages=math.ceil(total / page_size),
    )


@router.get("/{record_id}", response_model=RecordOut)
def get_record(record_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(ExtractedRecord).filter(ExtractedRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    return _serialize(r)


@router.post("/{record_id}/review", response_model=RecordOut)
def review_record(
    record_id: str,
    payload: RecordReviewAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    r = db.query(ExtractedRecord).filter(ExtractedRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    if r.is_submitted:
        raise HTTPException(status_code=409, detail="Record already submitted — cannot modify")

    action_map = {
        "approve": ReviewStatus.APPROVED,
        "reject": ReviewStatus.REJECTED,
        "skip": ReviewStatus.SKIPPED,
        "escalate": ReviewStatus.ESCALATED,
        "quarantine": ReviewStatus.QUARANTINED,
    }
    if payload.action not in action_map:
        raise HTTPException(status_code=422, detail=f"Unknown action: {payload.action}")

    # Apply field overrides before setting review status
    if payload.field_overrides:
        for field_name, new_value in payload.field_overrides.items():
            old_value = r.extracted_fields.get(field_name)
            r.extracted_fields[field_name] = new_value
            db.add(AuditLog(
                user_id=current_user.id, job_id=r.job_id, record_id=r.id,
                action=AuditAction.FIELD_OVERRIDDEN,
                before_value={"field": field_name, "value": old_value},
                after_value={"field": field_name, "value": new_value},
            ))
        # Force SQLAlchemy to detect JSON mutation
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(r, "extracted_fields")

    old_status = r.review_status.value
    r.review_status = action_map[payload.action]
    r.review_note = payload.note
    r.reviewed_by = current_user.id
    r.reviewed_at = datetime.now(timezone.utc)

    audit_action_map = {
        "approve": AuditAction.RECORD_APPROVED,
        "reject": AuditAction.RECORD_REJECTED,
        "escalate": AuditAction.RECORD_ESCALATED,
        "quarantine": AuditAction.RECORD_ESCALATED,
        "skip": AuditAction.RECORD_APPROVED,  # reuse; skip isn't a distinct audit type yet
    }
    db.add(AuditLog(
        user_id=current_user.id, job_id=r.job_id, record_id=r.id,
        action=audit_action_map[payload.action],
        before_value={"review_status": old_status},
        after_value={"review_status": r.review_status.value, "note": payload.note},
    ))

    # Update job counters
    job = db.query(ExtractionJob).filter(ExtractionJob.id == r.job_id).first()
    if job:
        if payload.action == "approve":
            job.total_approved = (job.total_approved or 0) + 1
        elif payload.action == "reject":
            job.total_rejected = (job.total_rejected or 0) + 1

    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.post("/bulk-review", response_model=dict)
def bulk_review(
    payload: RecordBulkAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="Bulk action must be approve or reject")

    status_map = {"approve": ReviewStatus.APPROVED, "reject": ReviewStatus.REJECTED}
    audit_map = {"approve": AuditAction.RECORD_APPROVED, "reject": AuditAction.RECORD_REJECTED}

    records = db.query(ExtractedRecord).filter(
        ExtractedRecord.id.in_(payload.record_ids),
        ExtractedRecord.is_submitted == False,
    ).all()

    now = datetime.now(timezone.utc)
    updated = 0
    for r in records:
        r.review_status = status_map[payload.action]
        r.review_note = payload.note
        r.reviewed_by = current_user.id
        r.reviewed_at = now
        db.add(AuditLog(
            user_id=current_user.id, job_id=r.job_id, record_id=r.id,
            action=audit_map[payload.action],
            after_value={"note": payload.note},
        ))
        updated += 1

    db.commit()
    return {"updated": updated, "action": payload.action}
