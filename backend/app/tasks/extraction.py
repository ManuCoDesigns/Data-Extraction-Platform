"""
Extraction pipeline Celery task.
Parses source file → maps fields to schema → creates ExtractedRecord per entity.
"""
import os, re, hashlib
from typing import Any
from app.tasks.celery_app import celery_app


@celery_app.task(bind=True, max_retries=3, name="app.tasks.extraction.run_extraction")
def run_extraction(self, job_id: str, file_path: str, schema_id: str, schema_version: int):
    from app.db.session import SessionLocal
    from app.models.all_models import (
        ExtractionJob, JobStatus, JobStateHistory, ExtractedRecord,
        ExtractionConfidence, ReviewStatus, Schema, SchemaVersion
    )
    from app.parsers.pdf_parser import PDFParser
    from app.parsers.csv_parser import CSVParser
    import json
    from datetime import datetime, timezone

    db = SessionLocal()
    try:
        job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
        if not job:
            return

        def transition(status, error=None):
            last = db.query(JobStateHistory).filter(
                JobStateHistory.job_id == job_id, JobStateHistory.exited_at == None
            ).first()
            if last:
                last.exited_at = datetime.now(timezone.utc)
            db.add(JobStateHistory(job_id=job_id, state=status, triggered_by="system", error=error))
            job.status = status
            db.flush()

        # Transition to PARSING
        transition(JobStatus.PARSING)
        db.commit()

        # Load schema definition
        schema_ver = db.query(SchemaVersion).filter(
            SchemaVersion.schema_id == schema_id,
            SchemaVersion.version == schema_version,
        ).first()
        if not schema_ver:
            transition(JobStatus.EXTRACTION_FAILED, error="Schema version not found")
            db.commit()
            return

        definition = schema_ver.definition

        # Choose parser
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".pdf":
            parser = PDFParser()
        elif ext in (".csv",):
            parser = CSVParser()
        else:
            transition(JobStatus.EXTRACTION_FAILED, error=f"Unsupported file type: {ext}")
            db.commit()
            return

        # Parse
        try:
            raw_records = parser.parse(file_path)
        except Exception as e:
            transition(JobStatus.PARSE_FAILED, error=str(e))
            db.commit()
            raise self.retry(exc=e, countdown=30)

        job.total_raw_records = len(raw_records)
        db.flush()

        # Transition to EXTRACTING
        transition(JobStatus.EXTRACTING)
        db.commit()

        # Group and map records
        grouping_key = definition.get("grouping_key", "company_name")
        fields_def = definition.get("fields", [])
        transform_fns = definition.get("transformation_functions", {})

        entities: dict[str, dict] = {}
        warnings_by_entity: dict[str, list] = {}
        raw_by_entity: dict[str, str] = {}

        for raw in raw_records:
            entity_name = raw.get(grouping_key) or raw.get("name") or raw.get("company_name", "")
            if not entity_name:
                continue

            if entity_name not in entities:
                entities[entity_name] = {}
                warnings_by_entity[entity_name] = []
                raw_by_entity[entity_name] = ""

            raw_by_entity[entity_name] += "\n" + raw.get("_raw_text", "")

            # Map fields
            for field_def in fields_def:
                field_name = field_def["name"]
                if field_name in entities[entity_name]:
                    continue  # Already populated

                if "fixed_value" in field_def:
                    entities[entity_name][field_name] = field_def["fixed_value"]
                    continue

                source_field = field_def.get("source_field", field_name)
                value = raw.get(source_field) or raw.get(field_name)

                if value and field_def.get("transform"):
                    value = _apply_transform(value, field_def["transform"], transform_fns)

                if value is not None:
                    entities[entity_name][field_name] = value
                elif field_def.get("required"):
                    warnings_by_entity[entity_name].append(
                        {"field": field_name, "issue": "Required field missing from source"}
                    )

        # Build ExtractedRecord per entity
        for entity_name, fields in entities.items():
            warnings = warnings_by_entity.get(entity_name, [])
            required_fields = [f["name"] for f in fields_def if f.get("required") and "fixed_value" not in f]
            populated_required = [f for f in required_fields if fields.get(f)]

            if not warnings and len(populated_required) == len(required_fields):
                confidence = ExtractionConfidence.HIGH
            elif len(populated_required) == len(required_fields):
                confidence = ExtractionConfidence.MEDIUM
            else:
                confidence = ExtractionConfidence.LOW

            canonical = _canonical(fields.get("canonical_name") or entity_name)
            fields["canonical_name"] = canonical

            record = ExtractedRecord(
                job_id=job_id,
                schema_version=schema_version,
                extraction_confidence=confidence,
                pipeline_warnings=warnings,
                review_status=ReviewStatus.PENDING,
                extracted_fields=fields,
                raw_text=raw_by_entity.get(entity_name, "").strip(),
                canonical_name=canonical,
            )
            db.add(record)

        job.total_extracted = len(entities)
        transition(JobStatus.LLM_REVIEW)
        db.commit()

        # Kick off LLM review
        from app.tasks.llm_review import run_llm_review
        run_llm_review.delay(job_id, schema_id, schema_version)

    except Exception as e:
        db.rollback()
        job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
        if job:
            job.status = JobStatus.EXTRACTION_FAILED
            job.error_message = str(e)
            db.commit()
        raise
    finally:
        db.close()


def _canonical(name: str) -> str:
    """Convert company name to canonical slug."""
    if not name:
        return ""
    s = name.lower()
    s = s.replace("&", "and").replace("+", "and")
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _apply_transform(value: Any, transform_name: str, fns: dict) -> Any:
    """Apply a named transform to a value."""
    if transform_name == "canonical_name_transform":
        return _canonical(str(value))
    return value
