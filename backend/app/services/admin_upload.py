"""Admin uploads that are never the extractor's final work.

An admin loading data (their own extraction, a cross-check, a fix) used to go through the normal upload: the source jumped to
Ready for review, the submitted clock was stamped and the reviewers were pointed at it. Now an admin chooses what the upload is:

- draft:     the records are saved as pending drafts and the source stays in extraction. No submitted time, nothing for the reviewers.
             The admin sends it for review when they decide it is ready (submit_draft).
- reference: the file is kept as a version next to the extractors' data, for a side-by-side compare. The records on the source
             are not touched, and nothing about the source changes.
- submit:    the old behaviour, for an admin who is working the source as its extractor.

Nobody but an admin can use these. A draft never counts as an extraction in the reports, because the source is not submitted.
Matching a whole batch zip to its sources is done by plan_batch.
"""
from __future__ import annotations

import io
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.all_models import AuditAction, AuditLog, SchemaVersion, SourceRound, SourceStatus, User
from app.services import record_locks as rl

MODES = ("draft", "reference", "submit")
NAME_KEYS = ("canonical_name", "company_name", "segment_name", "regulation_name", "product_name", "material_name", "name")


def resolve(user, mode: str | None) -> str | None:
    """The mode an upload runs in: None means the normal upload. A blank mode from an admin is a draft, so nothing becomes final by accident."""
    m = (mode or "").strip().lower()
    if m and m not in MODES:
        raise HTTPException(status_code=422, detail="Upload mode must be draft, reference or submit.")
    if not rl.is_admin(user):
        if m in ("draft", "reference"):
            raise HTTPException(status_code=403, detail="Only admins can save an upload as a draft or a reference copy.")
        return None
    return None if m == "submit" else (m or "draft")


def check(source, mode: str | None) -> None:
    if mode == "draft" and source.status == SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail="This source is approved. Save the file as a reference copy, or send the source back first.")


def _name(fields: dict) -> str:
    return str(next((fields.get(k) for k in NAME_KEYS if fields.get(k)), "") or "")


def map_rows(rows: list, ext: str, method: str, schema_fields: list) -> list[dict]:
    from app.api.v1.routes import sources as S
    out = []
    for row in rows:
        if method == "llm":
            m = {k: v for k, v in row.items() if k != "_raw_text"}
        elif ext in (".json", ".zip"):
            m = dict(row)
            for fd in schema_fields:
                if "fixed_value" in fd:
                    m[fd["name"]] = fd["fixed_value"]
        else:
            m = S.map_row_to_fields(row, schema_fields)
        out.append(m)
    return out


def store_reference(db: Session, source, user, rows: list, ext: str, method: str, file_breakdown: list, files_processed: int,
                    filename: str, schema_fields: list):
    """Keep the file as a version beside the live data. The records on the source are not changed."""
    from app.api.v1.routes import sources as S
    from app.schemas.api_schemas import SourceUploadSummary
    mapped = map_rows(rows, ext, method, schema_fields)
    valid = sum(1 for m in mapped if S.validate_record(m, schema_fields)[0])
    rn = (db.query(func.max(SourceRound.round)).filter(SourceRound.source_id == source.id).scalar() or 0) + 1
    ex = db.query(User).filter(User.id == source.assigned_extractor_id).first() if source.assigned_extractor_id else None
    rd = SourceRound(
        source_id=source.id, round=rn, created_by=user.id, reason=f"Reference copy: {filename}", status_at=source.status.value,
        extractor_id=source.assigned_extractor_id, extractor_name=ex.full_name if ex else None, record_count=len(mapped),
        reviewers=[], audits=[], findings=[],
        records=[{"id": None, "name": _name(m) or f"Record {i + 1}", "fields": m, "review_status": None, "comments": {}, "corrections": 0, "admin_note": None}
                 for i, m in enumerate(mapped)])
    db.add(rd)
    db.flush()
    db.add(AuditLog(user_id=user.id, project_id=source.project_id, source_id=source.id, action=AuditAction.SOURCE_DATA_UPLOADED,
                    after_value={"file": filename, "method": method, "rows": len(mapped), "valid": valid, "invalid": len(mapped) - valid,
                                 "admin_mode": "reference", "kept_as_version": rn}))
    db.commit()
    return SourceUploadSummary(total_rows=len(mapped), valid_rows=valid, invalid_rows=len(mapped) - valid, job_id=rd.id,
                               extraction_method=method, files_processed=files_processed, file_breakdown=file_breakdown, batch_warnings=[])


def draft_state(db: Session, source) -> dict:
    """Is the data on this source an admin draft that has not been sent for review?"""
    if source.status != SourceStatus.EXTRACTING:
        return {"draft": False}
    rows = (db.query(AuditLog).filter(AuditLog.source_id == source.id, AuditLog.action == AuditAction.SOURCE_DATA_UPLOADED)
            .order_by(AuditLog.timestamp.desc()).limit(8).all())
    last = next((r for r in rows if isinstance(r.after_value, dict) and "method" in r.after_value), None)
    if not last or last.after_value.get("admin_mode") != "draft":
        return {"draft": False}
    who = db.query(User).filter(User.id == last.user_id).first()
    return {"draft": True, "records": source.total_records or 0, "invalid": source.invalid_records or 0,
            "since": last.timestamp.isoformat() if last.timestamp else None, "by": who.full_name if who else None,
            "file": last.after_value.get("file")}


def submit_draft(db: Session, source, user) -> dict:
    st = draft_state(db, source)
    if not st["draft"]:
        raise HTTPException(status_code=409, detail="There is no admin draft on this source.")
    now = datetime.now(timezone.utc)
    invalid = source.invalid_records or 0
    source.status = SourceStatus.NEEDS_FIXES if invalid > 0 else SourceStatus.READY_FOR_REVIEW
    source.extraction_started_at = source.extraction_started_at or now
    source.extraction_completed_at = now if invalid == 0 else source.extraction_completed_at
    db.add(AuditLog(user_id=user.id, project_id=source.project_id, source_id=source.id, action=AuditAction.SOURCE_STATUS_CHANGED,
                    before_value={"status": "extracting"}, after_value={"status": source.status.value, "stage": "admin_draft_submitted", "records": st["records"], "invalid": invalid}))
    db.commit()
    return {"status": source.status.value, "records": st["records"], "invalid": invalid}


# ─── a whole batch zip ───────────────────────────────────────────────────────

def _key(v) -> str:
    s = unicodedata.normalize("NFKD", str(v).lower().strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("&", "and")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _score(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = set(a.split()), set(b.split())
    if a in b or b in a:
        return 0.85
    return round(len(ta & tb) / max(1, len(ta | tb)), 2)


def read_zip(content: bytes) -> list[dict]:
    """The record files in a batch zip: every .json (a list, or an object with a list under records/items/data), not notes or manifests."""
    from app.api.v1.routes import sources as S
    try:
        z = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="That is not a valid zip file.")
    out = []
    for info in z.infolist():
        base = info.filename.split("/")[-1]
        if info.is_dir() or not base.lower().endswith(".json") or base.startswith((".", "~")) or "__MACOSX" in info.filename:
            continue
        if re.search(r"manifest|checklist|review[_ -]?log|notes", base, re.I):
            continue
        raw = z.read(info)
        try:
            rows = S._parse_rows(raw.lstrip(b"\xef\xbb\xbf"), ".json", base)
        except Exception:
            out.append({"file": info.filename, "error": "Not readable as JSON", "rows": [], "raw": raw})
            continue
        rows = [r for r in rows if isinstance(r, dict)]
        if rows:
            out.append({"file": info.filename, "rows": rows, "raw": raw})
    if not out:
        raise HTTPException(status_code=422, detail="No record files (.json) found in that zip.")
    return out


def plan_batch(db: Session, files: list[dict], sources: list) -> list[dict]:
    plan = []
    for f in files:
        stem = _key(re.sub(r"\.json$", "", f["file"].split("/")[-1], flags=re.I))
        names = [_name(r) for r in f["rows"][:3]]
        scored = []
        for s in sources:
            sk = _key(s.name)
            best = max([_score(stem, sk)] + [_score(_key(n), sk) for n in names if n])
            if best >= 0.34:
                scored.append((best, s))
        scored.sort(key=lambda x: -x[0])
        top = scored[0] if scored else None
        ambiguous = bool(top and len(scored) > 1 and scored[1][0] >= top[0] - 0.05 and top[0] < 1.0)
        match = top[1] if top and top[0] >= 0.6 and not ambiguous else None
        have = 0
        if match:
            from app.services import versions as ver
            have = len(ver.current_records(db, match))
        sv = db.query(SchemaVersion).filter(SchemaVersion.schema_id == match.schema_id).order_by(SchemaVersion.version.desc()).first() if match and match.schema_id else None
        fields = sv.definition.get("fields", []) if sv and sv.definition else []
        valid, errs = 0, []
        if fields:
            from app.api.v1.routes import sources as S
            for m in map_rows(f["rows"], ".json", "structured", fields):
                ok, e = S.validate_record(m, fields)
                valid += 1 if ok else 0
                if not ok and len(errs) < 3:
                    errs.append(str(e)[:160])
        else:
            valid = len(f["rows"])
        plan.append({
            "file": f["file"], "error": f.get("error"), "records": len(f["rows"]), "names": [n for n in names if n],
            "source_id": match.id if match else None, "source_name": match.name if match else None,
            "status": match.status.value if match else None, "existing_records": have,
            "suggested_mode": "reference" if (have or (match and match.status == SourceStatus.APPROVED)) else "draft",
            "valid": valid, "invalid": len(f["rows"]) - valid, "errors": errs,
            "candidates": [{"id": s.id, "name": s.name, "status": s.status.value, "score": sc} for sc, s in scored[:5]],
        })
    return plan
