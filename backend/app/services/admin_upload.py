"""Admin uploads that are never the extractor's final work.

An admin loading data (their own extraction, a cross-check, a fix) used to go through the normal upload: the source jumped to
Ready for review, the submitted clock was stamped and the reviewers were pointed at it. Now an admin chooses what the upload is:

- draft:     the records are saved as pending drafts and the source stays in extraction. No submitted time, nothing for the reviewers.
             The admin sends it for review when they decide it is ready (submit_draft).
- reference: the file is saved as a private admin copy, for the admin's own checking and the final review. The records on the source
             are not touched, extractors and reviewers cannot see it, and it is kept by source name, so it survives a re-pull.
- submit:    the old behaviour, for an admin who is working the source as its extractor.

Nobody but an admin can use these. A draft never counts as an extraction in the reports, because the source is not submitted.
Matching a whole batch zip to its sources is done by plan_batch.
"""
from __future__ import annotations

import io
import json
import re
import unicodedata
import uuid
import zipfile
from types import SimpleNamespace
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.all_models import AdminCopy, AuditAction, AuditLog, ExtractedRecord, ExtractionJob, SchemaVersion, Source, SourceStatus, User
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


def name_key(name: str) -> str:
    return _key(name)


def store_reference(db: Session, source, user, rows: list, ext: str, method: str, file_breakdown: list, files_processed: int,
                    filename: str, schema_fields: list, batch_id: str | None = None, batch_label: str | None = None):
    """Save the file as a private admin copy. The records on the source are not changed, and only admins can see the copy."""
    from app.api.v1.routes import sources as S
    from app.schemas.api_schemas import SourceUploadSummary
    mapped = map_rows(rows, ext, method, schema_fields)
    valid = sum(1 for m in mapped if S.validate_record(m, schema_fields)[0])
    cp = AdminCopy(
        source_id=source.id, name_key=name_key(source.name), source_name=source.name, project_id=source.project_id,
        batch_id=batch_id or str(uuid.uuid4()), batch_label=(batch_label or filename)[:200], file=filename[:300],
        records=[{"name": _name(m) or f"Record {i + 1}", "fields": m} for i, m in enumerate(mapped)],
        record_count=len(mapped), valid_count=valid, created_by=user.id)
    db.add(cp)
    db.flush()
    db.add(AuditLog(user_id=user.id, project_id=source.project_id, source_id=source.id, action=AuditAction.SOURCE_DATA_UPLOADED,
                    after_value={"file": filename, "method": method, "rows": len(mapped), "valid": valid, "invalid": len(mapped) - valid,
                                 "admin_mode": "reference", "admin_copy": cp.id}))
    db.commit()
    return SourceUploadSummary(total_rows=len(mapped), valid_rows=valid, invalid_rows=len(mapped) - valid, job_id=cp.id,
                               extraction_method=method, files_processed=files_processed, file_breakdown=file_breakdown, batch_warnings=[])


def copies_for(db: Session, source) -> list:
    """The admin copies that belong to a source: saved against it, or saved against a source of the same name (a re-pull gets a new id)."""
    from sqlalchemy import or_
    return (db.query(AdminCopy).filter(or_(AdminCopy.source_id == source.id, AdminCopy.name_key == name_key(source.name)))
            .order_by(AdminCopy.created_at.desc()).all())


def copy_meta(c, present: bool | None = None) -> dict:
    d = {"id": c.id, "source_id": c.source_id, "source_name": c.source_name, "batch_id": c.batch_id, "batch_label": c.batch_label, "file": c.file,
         "records": c.record_count or 0, "valid": c.valid_count or 0, "invalid": (c.record_count or 0) - (c.valid_count or 0),
         "created_at": c.created_at.isoformat() if c.created_at else None, "applied_at": c.applied_at.isoformat() if c.applied_at else None}
    if present is not None:
        d["source_present"] = present
    return d


def compare_copy(db: Session, source, c) -> dict:
    from app.services import versions as ver
    return ver.compare(db, source, SimpleNamespace(records=c.records or [], round=0))


def _same(a, b) -> bool:
    empty = (None, "", [], {})
    if a in empty and b in empty:
        return True
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def record_diff(db: Session, source, record_id: str) -> dict:
    """The newest admin copy of this record next to what is on the source now: for the admin's final check."""
    from app.services import versions as ver
    rec = (db.query(ExtractedRecord).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
           .filter(ExtractedRecord.id == record_id, ExtractionJob.source_id == source.id).first())
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found.")
    live = rec.extracted_fields or {}
    want = ver._key(ver._name(rec))
    for c in copies_for(db, source):
        for r in (c.records or []):
            if ver._key(r.get("name")) == want:
                theirs = r.get("fields") or {}
                keys = sorted(set(live) | set(theirs))
                diff = [{"field": k, "live": live.get(k), "copy": theirs.get(k)} for k in keys if not _same(live.get(k), theirs.get(k))]
                return {"found": True, "copy": copy_meta(c), "differs": len(diff), "same": len([k for k in keys if _same(live.get(k), theirs.get(k))]), "diff": diff[:60]}
    return {"found": False, "copies": len(copies_for(db, source))}


def apply_copy(db: Session, source, user, c, mode: str) -> dict:
    """Load a saved copy as the data of a source. mode draft keeps it unsubmitted; submit is the normal upload."""
    from app.api.v1.routes import sources as S
    from app.services import versions as ver
    if mode not in ("draft", "submit"):
        raise HTTPException(status_code=422, detail="Mode must be draft or submit.")
    am = "draft" if mode == "draft" else None
    check(source, "draft" if mode == "draft" else None)
    if source.status == SourceStatus.APPROVED:
        raise HTTPException(status_code=422, detail="This source is approved. Send it back before loading new data.")
    ver.gate(db, source, user, None)
    rows = [dict(r.get("fields") or {}) for r in (c.records or [])]
    if not rows:
        raise HTTPException(status_code=422, detail="That copy holds no records.")
    sv = db.query(SchemaVersion).filter(SchemaVersion.schema_id == source.schema_id).order_by(SchemaVersion.version.desc()).first() if source.schema_id else None
    fields = sv.definition.get("fields", []) if sv and sv.definition else []
    summary = S._finalize_upload(source=source, source_id=source.id, rows=rows, ext=".json", extraction_method="structured", file_breakdown=[], files_processed=1,
                                 display_filename=f"admin copy {c.file or ''}".strip(), content_len=0, schema_ver=sv, schema_fields=fields, current_user=user, db=db,
                                 raw_entries=None, replace_reason=None, admin_mode=am)
    c.applied_at = datetime.now(timezone.utc)
    c.source_id = source.id
    db.commit()
    return {"records": summary.total_rows, "valid": summary.valid_rows, "invalid": summary.invalid_rows, "mode": mode}


def library(db: Session, sources: list, project_ids: set | None = None) -> list:
    """Every saved batch, newest first, with each file and whether its source exists now."""
    by_key = {name_key(s.name): s for s in sources}
    out: dict = {}
    for c in db.query(AdminCopy).order_by(AdminCopy.created_at.desc()).all():
        if project_ids is not None and c.project_id not in project_ids:
            continue
        s = by_key.get(c.name_key)
        b = out.setdefault(c.batch_id, {"batch_id": c.batch_id, "label": c.batch_label, "created_at": c.created_at.isoformat() if c.created_at else None, "copies": []})
        m = copy_meta(c, present=bool(s))
        m["current_source_id"] = s.id if s else None
        m["current_status"] = s.status.value if s else None
        b["copies"].append(m)
    return list(out.values())


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
            "suggested_mode": "reference", "saved_copies": db.query(AdminCopy).filter(AdminCopy.name_key == name_key(match.name)).count() if match else 0,
            "valid": valid, "invalid": len(f["rows"]) - valid, "errors": errs,
            "candidates": [{"id": s.id, "name": s.name, "status": s.status.value, "score": sc} for sc, s in scored[:5]],
        })
    return plan


# ─── the link with Quality → Final check ─────────────────────────────────────

def key_from_copies(db: Session, project_ids: set | None, batch_id: str) -> dict:
    """Saved copies as the answer key Final check reads: {source name: [records]}. batch_id 'latest' takes the newest copy of each source."""
    q = db.query(AdminCopy).order_by(AdminCopy.created_at.desc())
    if batch_id != "latest":
        q = q.filter(AdminCopy.batch_id == batch_id)
    out, seen = {}, set()
    for c in q.all():
        if project_ids is not None and c.project_id not in project_ids:
            continue
        if c.name_key in seen:
            continue
        seen.add(c.name_key)
        out[c.source_name] = [dict(r.get("fields") or {}) for r in (c.records or [])]
    return out


def save_key(db: Session, user, key: dict, label: str, sources: list) -> dict:
    """Keep the records of a Final check file as private admin copies, one per matching source. A file that is already saved is not saved twice."""
    from app.services import answer_key as ak
    by_norm: dict = {}
    for s in sources:
        by_norm.setdefault(ak.norm(s.name), s)
    batch_id = str(uuid.uuid4())
    saved, same, unmatched = 0, 0, []
    for name, recs in key.items():
        s = by_norm.get(ak.norm(name))
        if not s:
            unmatched.append(name)
            continue
        fields = [dict(r) for r in recs if isinstance(r, dict)]
        last = db.query(AdminCopy).filter(AdminCopy.name_key == name_key(s.name)).order_by(AdminCopy.created_at.desc()).first()
        if last and json.dumps([r.get("fields") for r in (last.records or [])], sort_keys=True, default=str) == json.dumps(fields, sort_keys=True, default=str):
            same += 1
            continue
        db.add(AdminCopy(source_id=s.id, name_key=name_key(s.name), source_name=s.name, project_id=s.project_id, batch_id=batch_id, batch_label=label[:200], file=label[:300],
                         records=[{"name": ak.record_name(f) or f"Record {i + 1}", "fields": f} for i, f in enumerate(fields)],
                         record_count=len(fields), valid_count=len(fields), created_by=user.id))
        saved += 1
    db.commit()
    return {"saved": saved, "unchanged": same, "unmatched": unmatched, "batch_id": batch_id if saved else None}
