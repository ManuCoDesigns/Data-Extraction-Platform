"""Quality: automatic checks on records, a verdict on reviewer-logged errors, and process scores.

The system can check what is structural: required fields, types, allowed values, formats, placeholder text,
duplicates. It cannot know what a source really says, so factual errors are confirmed by an admin and the
ground-truth field checks (audits) are what the process scores are measured against.
"""
import re
from collections import Counter, defaultdict

from app.services.schema_validator import validate_record

CATEGORIES = {
    "wrong_value": "Wrong value", "missing_value": "Missing value", "unsupported_value": "Not in the source",
    "format": "Format", "sop_rule": "SOP rule", "schema": "Schema", "duplicate": "Duplicate", "other": "Other",
}
SEVERITIES = ("minor", "major", "critical")
STRUCTURAL = {"format", "schema", "missing_value", "sop_rule", "duplicate"}
PLACEHOLDERS = {"n/a", "na", "tbd", "unknown", "none", "null", "-", "--", "?", "todo", "not available", "not found", "nil"}
URL_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*\.[^\s]{2,}$", re.I)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
ISO_DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
SKIP_FIELDS = {"is_verified"}


def _present(v) -> bool:
    return not (v is None or v == "" or v == {} or v == [])


def check_record(fields: dict, schema_fields: list[dict]) -> list[dict]:
    """Rule checks on one record. Each item: field, category, rule, severity, message."""
    out: list[dict] = []
    fields = fields or {}
    _, errs = validate_record(fields, schema_fields or [])
    for e in errs:
        required = "Required" in e["error"]
        out.append({"field": e["field"], "category": "missing_value" if required else "schema",
                    "rule": "required" if required else ("allowed_values" if "allowed values" in e["error"] else "type"),
                    "severity": "major", "message": e["error"]})
    for fd in schema_fields or []:
        name = fd.get("name")
        if not name or "fixed_value" in fd or name in SKIP_FIELDS:
            continue
        v = fields.get(name)
        if not _present(v) or not isinstance(v, str):
            continue
        low = name.lower()
        t = str(fd.get("type", "")).lower()
        if v != v.strip():
            out.append({"field": name, "category": "format", "rule": "whitespace", "severity": "minor", "message": "Has extra spaces at the start or end."})
        if v.strip().lower() in PLACEHOLDERS:
            out.append({"field": name, "category": "missing_value", "rule": "placeholder", "severity": "major",
                        "message": f"Says '{v.strip()}' instead of a real value. Leave it empty or find the value."})
            continue
        if t == "url" or "url" in low or "website" in low or low.endswith("_link"):
            if not URL_RE.match(v.strip()):
                out.append({"field": name, "category": "format", "rule": "url", "severity": "major", "message": "Is not a full web address (it should start with https://)."})
        elif "email" in low and not EMAIL_RE.match(v.strip()):
            out.append({"field": name, "category": "format", "rule": "email", "severity": "major", "message": "Is not a valid email address."})
        elif t == "date" and not ISO_DATE_RE.match(v.strip()):
            out.append({"field": name, "category": "format", "rule": "date", "severity": "major", "message": "Dates should look like 2024-05-31 (or just the year or month)."})
        pat = fd.get("pattern")
        if pat:
            try:
                if not re.fullmatch(pat, v.strip()):
                    out.append({"field": name, "category": "sop_rule", "rule": "pattern", "severity": "major", "message": f"Does not match the required pattern {pat}."})
            except re.error:
                pass
        if fd.get("min_length") and len(v.strip()) < int(fd["min_length"]):
            out.append({"field": name, "category": "sop_rule", "rule": "min_length", "severity": "minor", "message": f"Is shorter than the {fd['min_length']} characters the schema asks for."})
        if fd.get("max_length") and len(v.strip()) > int(fd["max_length"]):
            out.append({"field": name, "category": "sop_rule", "rule": "max_length", "severity": "minor", "message": f"Is longer than the {fd['max_length']} characters the schema allows."})
    return out


def _flag_fields(record) -> set:
    names: set = set()
    for src in (getattr(record, "web_check_flags", None) or [], getattr(record, "llm_field_flags", None) or []):
        for f in src:
            if isinstance(f, str):
                names.add(f)
            elif isinstance(f, dict):
                n = f.get("field") or f.get("name")
                if n:
                    names.add(str(n))
    return names


def auto_verify(record, schema_fields: list[dict], field: str | None, category: str) -> tuple[str, str]:
    """Does the system agree with a reviewer's finding? Returns (verdict, plain-language note)."""
    hits = [h for h in check_record(record.extracted_fields or {}, schema_fields)
            if not field or field == "_record" or h["field"] == field]
    if category in STRUCTURAL:
        if hits:
            return "confirmed", f"The system found the same problem: {hits[0]['message']}"
        return "not_reproduced", "The record passes the schema and format checks for this field, so this needs an admin to check it against the source."
    if field and field in _flag_fields(record):
        return "supported", "The automatic website or AI check also flagged this field."
    if hits:
        return "supported", f"The system also sees a problem here: {hits[0]['message']}"
    return "needs_human", "Only the source can settle this. Check it there and mark the field in the ground-truth check."


def count_fields(record) -> int:
    return sum(1 for k, v in (record.extracted_fields or {}).items() if k not in SKIP_FIELDS and _present(v))


def pct(a, b):
    return round(100 * a / b, 1) if b else None


def compute_summary(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict) -> dict:
    """Process scores from logged findings and ground-truth audits.

    final accuracy   = audited fields that were right / audited fields (what was actually delivered)
    review catch     = errors reviewers found and an admin confirmed / (those + errors the audit found afterwards)
    reviewer precision = confirmed / (confirmed + dismissed) among reviewer findings an admin has settled
    """
    fields_total = sum(count_fields(r) for rs in records_by_source.values() for r in rs)
    reviewer = [f for f in findings if f.origin == "reviewer"]
    system = [f for f in findings if f.origin == "system"]
    r_conf = [f for f in reviewer if f.status == "confirmed"]
    r_dis = [f for f in reviewer if f.status == "dismissed"]
    s_conf = [f for f in system if f.status == "confirmed"]
    s_dis = [f for f in system if f.status == "dismissed"]
    caught_keys = {(f.record_id, f.field) for f in r_conf}
    a_bad = [a for a in audits if a.verdict == "incorrect"]
    escaped = [a for a in a_bad if (a.record_id, a.field) not in caught_keys]
    confirmed_all = [f for f in findings if f.status == "confirmed"]

    final_acc = pct(len(audits) - len(a_bad), len(audits))
    catch = pct(len(r_conf), len(r_conf) + len(escaped)) if (r_conf or escaped) else None
    precision = pct(len(r_conf), len(r_conf) + len(r_dis))
    parts = [(final_acc, 0.5), (catch, 0.3), (precision, 0.2)]
    have = [(v, w) for v, w in parts if v is not None]
    score = round(sum(v * w for v, w in have) / sum(w for _, w in have), 1) if have else None

    by_cat = Counter(f.category for f in confirmed_all)
    by_sev = Counter(f.severity for f in confirmed_all)

    ext = defaultdict(lambda: {"fields": 0, "errors": 0, "audited": 0, "audit_wrong": 0, "sources": set()})
    for sid, rs in records_by_source.items():
        e = extractor_of.get(sid)
        if not e:
            continue
        ext[e]["fields"] += sum(count_fields(r) for r in rs)
        ext[e]["sources"].add(sid)
    for f in confirmed_all:
        e = extractor_of.get(f.source_id)
        if e:
            ext[e]["errors"] += 1
    for a in audits:
        e = extractor_of.get(a.source_id)
        if e:
            ext[e]["audited"] += 1
            ext[e]["audit_wrong"] += 1 if a.verdict == "incorrect" else 0
    extractors = sorted(({"user_id": u, "name": names.get(u, "Unknown"), "sources": len(d["sources"]), "fields": d["fields"], "errors": d["errors"],
                          "errors_per_100": round(100 * d["errors"] / d["fields"], 1) if d["fields"] else None,
                          "audited": d["audited"], "audit_accuracy": pct(d["audited"] - d["audit_wrong"], d["audited"])} for u, d in ext.items()),
                        key=lambda x: -(x["errors_per_100"] or 0))
    rev = defaultdict(lambda: {"raised": 0, "confirmed": 0, "dismissed": 0, "open": 0})
    for f in reviewer:
        if not f.raised_by:
            continue
        d = rev[f.raised_by]
        d["raised"] += 1
        d[{"confirmed": "confirmed", "dismissed": "dismissed"}.get(f.status, "open")] += 1
    reviewers = sorted(({"user_id": u, "name": names.get(u, "Unknown"), **d,
                         "precision": pct(d["confirmed"], d["confirmed"] + d["dismissed"])} for u, d in rev.items()), key=lambda x: -x["raised"])

    return {
        "scores": {"process": score, "final_accuracy": final_acc, "review_catch_rate": catch, "reviewer_precision": precision},
        "counts": {"fields": fields_total, "audited": len(audits), "audited_wrong": len(a_bad), "escaped": len(escaped),
                   "reviewer_findings": len(reviewer), "reviewer_confirmed": len(r_conf), "reviewer_dismissed": len(r_dis),
                   "reviewer_open": len(reviewer) - len(r_conf) - len(r_dis), "system_findings": len(system),
                   "system_confirmed": len(s_conf), "system_dismissed": len(s_dis), "open": sum(1 for f in findings if f.status == "open"),
                   "errors_per_100_fields": round(100 * len(confirmed_all) / fields_total, 1) if fields_total else None},
        "system_precision": pct(len(s_conf), len(s_conf) + len(s_dis)),
        "by_category": [{"category": c, "label": CATEGORIES.get(c, c), "count": n} for c, n in by_cat.most_common()],
        "by_severity": {s: by_sev.get(s, 0) for s in SEVERITIES},
        "extractors": extractors, "reviewers": reviewers,
        "confidence": "low" if len(audits) < 30 else "ok",
    }
