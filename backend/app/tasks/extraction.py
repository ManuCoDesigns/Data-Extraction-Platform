"""
Extraction pipeline Celery task — Phase 2.

Key change from Phase 1: the file_path parameter is now a STORAGE KEY,
not a local filesystem path. The task reads the file bytes from the storage
backend (local disk in dev, S3/R2 in prod) into a temp file, processes it,
then cleans up. This means the task runs correctly even when the Celery worker
is a separate Railway service with no shared filesystem.

Schema-driven extraction:
- definition.fields defines which fields to extract and how
- definition.grouping_key determines how raw rows are grouped into entities
- definition.extraction_instructions are injected into the LLM prompt
- definition.transformation_functions define canonical name transforms etc.
"""
import os, re, tempfile
from typing import Any
from app.tasks.celery_app import celery_app


@celery_app.task(bind=True, max_retries=3, name="app.tasks.extraction.run_extraction")
def run_extraction(self, job_id: str, storage_key: str, schema_id: str, schema_version: int):
    from app.db.session import SessionLocal
    from app.models.all_models import (
        ExtractionJob, JobStatus, JobStateHistory, ExtractedRecord,
        ExtractionConfidence, ReviewStatus, SchemaVersion,
    )
    from app.parsers.pdf_parser import PDFParser
    from app.parsers.csv_parser import CSVParser
    from app.services.storage import storage
    import json
    from datetime import datetime, timezone

    db = SessionLocal()
    tmp_path = None

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

        # Retrieve file from storage into a temp file so parsers can read it
        ext = os.path.splitext(storage_key)[1].lower()
        if not ext:
            # Fall back to extension from original filename
            ext = os.path.splitext(job.source_file_name or "")[1].lower()

        try:
            file_bytes = storage.read(storage_key)
        except Exception as e:
            transition(JobStatus.PARSE_FAILED, error=f"Could not read source file from storage: {str(e)}")
            db.commit()
            return

        # Write to temp file for parsers
        suffix = ext or ".tmp"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        # Choose parser
        if ext == ".pdf":
            parser = PDFParser()
        elif ext in (".csv",):
            parser = CSVParser()
        elif ext in (".xlsx", ".xls"):
            # Use CSV parser with pandas for Excel
            parser = CSVParser()
        else:
            transition(JobStatus.EXTRACTION_FAILED, error=f"Unsupported file type: {ext}")
            db.commit()
            return

        # Parse
        try:
            raw_records = parser.parse(tmp_path)
        except Exception as e:
            transition(JobStatus.PARSE_FAILED, error=f"Parse error: {str(e)}")
            db.commit()
            raise self.retry(exc=e, countdown=30)

        job.total_raw_records = len(raw_records)
        db.flush()

        transition(JobStatus.EXTRACTING)
        db.commit()

        # Schema-driven field mapping
        grouping_key = definition.get("grouping_key", "company_name")
        fields_def = definition.get("fields", [])
        transform_fns = definition.get("transformation_functions", {})
        source_type = definition.get("source_type", "generic")

        entities: dict[str, dict] = {}
        warnings_by_entity: dict[str, list] = {}
        raw_by_entity: dict[str, str] = {}

        for raw in raw_records:
            # Find the grouping key value
            entity_name = (
                raw.get(grouping_key) or
                raw.get("name") or
                raw.get("company_name") or
                raw.get("material_name") or
                raw.get("operator_name") or
                ""
            )
            if not entity_name:
                continue

            if entity_name not in entities:
                entities[entity_name] = {}
                warnings_by_entity[entity_name] = []
                raw_by_entity[entity_name] = ""

            raw_by_entity[entity_name] += "\n" + raw.get("_raw_text", "")

            # Map each schema field
            for field_def in fields_def:
                field_name = field_def["name"]
                if field_name in entities[entity_name]:
                    continue  # Already populated

                # Fixed values (e.g. is_verified = false)
                if "fixed_value" in field_def:
                    entities[entity_name][field_name] = field_def["fixed_value"]
                    continue

                # Source field mapping (e.g. source_field: "operator_name" → "company_name")
                source_field = field_def.get("source_field", field_name)
                value = raw.get(source_field) or raw.get(field_name)

                # Type coercion
                if value is not None:
                    value = _coerce_type(value, field_def.get("type", "string"))

                # Transform
                if value is not None and field_def.get("transform"):
                    value = _apply_transform(value, field_def["transform"], transform_fns)

                # Enum validation
                if value is not None and "enum" in field_def:
                    if value not in field_def["enum"]:
                        warnings_by_entity[entity_name].append({
                            "field": field_name,
                            "issue": f"Value '{value}' not in allowed enum {field_def['enum']}",
                        })

                if value is not None:
                    entities[entity_name][field_name] = value
                elif field_def.get("required"):
                    warnings_by_entity[entity_name].append({
                        "field": field_name,
                        "issue": "Required field missing from source",
                    })

        # Build ExtractedRecord per entity
        fields_def_names = [f["name"] for f in fields_def]
        required_fields = [f["name"] for f in fields_def if f.get("required") and "fixed_value" not in f]

        for entity_name, fields in entities.items():
            warnings = warnings_by_entity.get(entity_name, [])
            populated_required = [f for f in required_fields if fields.get(f)]

            # Confidence scoring
            if not warnings and len(populated_required) == len(required_fields):
                confidence = ExtractionConfidence.HIGH
            elif len(populated_required) == len(required_fields):
                confidence = ExtractionConfidence.MEDIUM
            elif len(populated_required) >= len(required_fields) * 0.7:
                confidence = ExtractionConfidence.LOW
            else:
                confidence = ExtractionConfidence.FLAGGED

            # Auto-derive canonical name if not present
            if "canonical_name" not in fields or not fields.get("canonical_name"):
                fields["canonical_name"] = _canonical(entity_name)

            record = ExtractedRecord(
                job_id=job_id,
                schema_version=schema_version,
                extraction_confidence=confidence,
                pipeline_warnings=warnings,
                review_status=ReviewStatus.PENDING,
                extracted_fields=fields,
                raw_text=raw_by_entity.get(entity_name, "").strip(),
                canonical_name=fields["canonical_name"],
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
            job.error_message = str(e)[:1000]
            db.commit()
        raise
    finally:
        # Clean up temp file
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        db.close()


def _canonical(name: str) -> str:
    """Convert a name to canonical slug per SOP-DS-002 §7.2."""
    if not name:
        return ""
    s = name.lower().strip()
    s = s.replace("&", "and").replace("+", "and")
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _coerce_type(value: Any, type_hint: str) -> Any:
    """Attempt type coercion based on schema field type."""
    try:
        if type_hint == "integer":
            return int(float(str(value).replace(",", "")))
        if type_hint == "float" or type_hint == "number":
            return float(str(value).replace(",", ""))
        if type_hint == "boolean":
            if isinstance(value, bool):
                return value
            return str(value).lower() in ("true", "yes", "1")
        return str(value).strip() if value is not None else None
    except (ValueError, TypeError):
        return str(value).strip() if value is not None else None


def _apply_transform(value: Any, transform_name: str, fns: dict) -> Any:
    """Apply named transform from the schema definition."""
    if transform_name == "canonical_name_transform":
        return _canonical(str(value))
    if transform_name == "lowercase":
        return str(value).lower()
    if transform_name == "uppercase":
        return str(value).upper()
    if transform_name == "strip":
        return str(value).strip()
    # Custom transform defined in schema.transformation_functions
    rule = fns.get(transform_name, "")
    if "lowercase" in rule:
        value = str(value).lower()
    if "hyphens" in rule or "spaces to hyphens" in rule:
        value = re.sub(r"\s+", "-", str(value))
    return value