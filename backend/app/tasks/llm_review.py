"""
LLM Review task — verifies extracted records against raw source text via Claude.
Non-blocking: if Claude fails, records are flagged llm_skipped and continue to review.

Phase 2: The system prompt is now schema-aware — it includes the schema name,
extraction_instructions from the schema definition, and field descriptions,
so Claude understands the domain context and what each field should contain.
"""
import json, hashlib, time
from app.tasks.celery_app import celery_app


@celery_app.task(bind=True, max_retries=3, name="app.tasks.llm_review.run_llm_review")
def run_llm_review(self, job_id: str, schema_id: str, schema_version: int):
    from app.db.session import SessionLocal
    from app.models.all_models import (
        ExtractionJob, ExtractedRecord, ReviewStatus, LLMVerdict,
        LLMCallLog, JobStatus, JobStateHistory, SchemaVersion,
    )
    from app.core.config import settings
    import anthropic
    from datetime import datetime, timezone

    db = SessionLocal()
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    try:
        job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
        if not job:
            return

        schema_ver = db.query(SchemaVersion).filter(
            SchemaVersion.schema_id == schema_id,
            SchemaVersion.version == schema_version,
        ).first()
        schema_definition = schema_ver.definition if schema_ver else {}

        records = db.query(ExtractedRecord).filter(
            ExtractedRecord.job_id == job_id,
            ExtractedRecord.review_status == ReviewStatus.PENDING,
        ).all()

        system_prompt = _build_system_prompt(schema_definition)

        for record in records:
            start_ms = int(time.time() * 1000)
            try:
                # Build field context with descriptions for the LLM
                field_context = []
                for f in schema_definition.get("fields", []):
                    if "fixed_value" not in f:
                        field_context.append({
                            "name": f["name"],
                            "required": f.get("required", False),
                            "type": f.get("type", "string"),
                            "description": f.get("description", ""),
                        })

                user_content = json.dumps({
                    "raw_source_text": record.raw_text[:4000],
                    "extracted_record": record.extracted_fields,
                    "schema_fields": field_context,
                }, ensure_ascii=False)

                prompt_hash = hashlib.sha256(user_content.encode()).hexdigest()[:16]

                response = client.messages.create(
                    model=settings.LLM_MODEL,
                    max_tokens=1500,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_content}],
                )

                latency_ms = int(time.time() * 1000) - start_ms
                raw_text = response.content[0].text if response.content else ""
                result = _parse_llm_response(raw_text)

                verdict_map = {
                    "PASS": LLMVerdict.PASS_,
                    "REVIEW": LLMVerdict.REVIEW,
                    "REJECT": LLMVerdict.REJECT,
                }
                verdict = verdict_map.get(result.get("verdict", "REVIEW"), LLMVerdict.REVIEW)

                record.llm_verdict = verdict
                record.llm_confidence = result.get("confidence", 0.5)
                record.llm_field_flags = result.get("field_flags", [])
                record.llm_reason = result.get("reason", "")
                record.llm_skipped = False

                if verdict == LLMVerdict.REJECT:
                    record.review_status = ReviewStatus.QUARANTINED

                db.add(LLMCallLog(
                    record_id=record.id, job_id=job_id,
                    model=settings.LLM_MODEL,
                    input_tokens=response.usage.input_tokens if response.usage else None,
                    output_tokens=response.usage.output_tokens if response.usage else None,
                    latency_ms=latency_ms, prompt_hash=prompt_hash,
                    verdict=verdict, confidence=record.llm_confidence,
                    raw_response=result,
                ))
                db.flush()

            except Exception as e:
                record.llm_skipped = True
                db.add(LLMCallLog(
                    record_id=record.id, job_id=job_id,
                    model=settings.LLM_MODEL, error=str(e),
                ))
                db.flush()

        # Transition → ready_for_review
        from datetime import datetime, timezone
        last = db.query(JobStateHistory).filter(
            JobStateHistory.job_id == job_id, JobStateHistory.exited_at == None
        ).first()
        if last:
            last.exited_at = datetime.now(timezone.utc)
        db.add(JobStateHistory(job_id=job_id, state=JobStatus.READY_FOR_REVIEW, triggered_by="system"))
        job.status = JobStatus.READY_FOR_REVIEW
        db.commit()

    except Exception as e:
        db.rollback()
        try:
            job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).first()
            if job:
                job.status = JobStatus.READY_FOR_REVIEW
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _build_system_prompt(schema_definition: dict) -> str:
    schema_name = schema_definition.get("name", "data extraction")
    instructions = schema_definition.get("extraction_instructions", "")
    grouping_key = schema_definition.get("grouping_key", "")

    # Build field description block for context
    fields = schema_definition.get("fields", [])
    field_descriptions = []
    for f in fields:
        if "fixed_value" not in f:
            desc = f.get("description", "")
            required = "REQUIRED" if f.get("required") else "optional"
            field_descriptions.append(f"  - {f['name']} ({f.get('type','string')}, {required}){': ' + desc if desc else ''}")
    fields_block = "\n".join(field_descriptions) if field_descriptions else "  (no field descriptions defined)"

    extraction_block = f"\nExtraction rules from this schema:\n{instructions}\n" if instructions else ""
    grouping_block = f"\nEach record represents one unique '{grouping_key}'.\n" if grouping_key else ""

    return f"""You are a data quality reviewer for the {schema_name} extraction pipeline.
{grouping_block}{extraction_block}
Schema fields:
{fields_block}

You will receive:
1. raw_source_text: verbatim text from the source document
2. extracted_record: the structured fields extracted from that text
3. schema_fields: field definitions with types and descriptions

For each non-fixed field, verify the extracted value is traceable to or derivable from the raw source.
Flag any field where the value appears incorrect, invented, inconsistent, or uncertain.

Respond ONLY with valid JSON. No preamble, no markdown, no text outside the JSON.

Required format:
{{
  "verdict": "PASS" | "REVIEW" | "REJECT",
  "confidence": <float 0.0–1.0>,
  "field_flags": [
    {{"field": "<field_name>", "issue": "<description>", "suggested_value": "<value or null>"}}
  ],
  "reason": "<one sentence summary>"
}}

Verdict rules:
- PASS: all required fields verified, confidence >= 0.85
- REVIEW: 1–2 fields uncertain or minor issues, rest verified
- REJECT: primary identity field incorrect, majority of fields unverifiable, or obvious extraction error"""


def _parse_llm_response(text: str) -> dict:
    try:
        clean = text.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1] if len(parts) > 1 else clean
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except Exception:
        return {
            "verdict": "REVIEW",
            "confidence": 0.5,
            "field_flags": [],
            "reason": "LLM response could not be parsed",
        }