"""Quality: automatic checks on records, a verdict on reviewer-logged errors, and process scores.

The system can check what is structural: required fields, types, allowed values, formats, placeholder text,
duplicates. It cannot know what a source really says, so factual errors are confirmed by an admin and the
ground-truth field checks (audits) are what the process scores are measured against.
"""
import json
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


def _eq(a, b) -> bool:
    def n(v):
        if v is None:
            return ""
        return v.strip() if isinstance(v, str) else json.dumps(v, sort_keys=True, default=str)
    return n(a) == n(b)


def extractor_report(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict, source_names: dict | None = None) -> dict:
    """What each extractor delivered and how accurate it was, counting everything that was ever found.

    An error stays in the numbers after the extractor fixes it. Each error is one record and field, counted once,
    from a confirmed finding or from a first check an admin marked wrong. Fixing it lowers the delivered error rate
    (final accuracy) but not the first-pass numbers, so returns and rework are visible instead of hidden.
    """
    source_names = source_names or {}
    rec_by_id = {r.id: (sid, r) for sid, rs in records_by_source.items() for r in rs}
    errs: dict = {}      # (record, field) -> info
    for f in findings:
        if f.status == "confirmed" and f.field and f.record_id in rec_by_id:
            e = errs.setdefault((f.record_id, f.field), {"reviewer": False, "fixed": False, "first": False})
            e["reviewer"] = e["reviewer"] or f.origin == "reviewer"
            e["fixed"] = e["fixed"] or bool(getattr(f, "fixed_before_final", False))
    aud_final: dict = {}
    for a in audits:
        pair = rec_by_id.get(a.record_id)
        if not pair:
            continue
        sid, r = pair
        stale = not _eq(a.extracted_value, (r.extracted_fields or {}).get(a.field))
        first = getattr(a, "first_verdict", None) or a.verdict
        aud_final[(a.record_id, a.field)] = (a, stale, first)
        if first == "incorrect" or (a.verdict == "incorrect" and not stale):
            e = errs.setdefault((a.record_id, a.field), {"reviewer": False, "fixed": False, "first": False})
            e["first"] = e["first"] or first == "incorrect"
        if first == "incorrect" and (a.verdict == "correct" and not stale):
            errs[(a.record_id, a.field)]["fixed"] = True
    out: dict = {}

    def blank(sid):
        return {"source_id": sid, "source": source_names.get(sid, ""), "records": 0, "fields": 0, "returned_records": 0, "returns": 0, "audited": 0, "first_wrong": 0,
                "final_wrong": 0, "waiting_recheck": 0, "errors": 0, "caught": 0, "fixed": 0}
    per: dict = {}
    for sid, rs in records_by_source.items():
        d = per.setdefault(sid, blank(sid))
        for r in rs:
            d["records"] += 1
            d["fields"] += count_fields(r)
            c = getattr(r, "correction_count", 0) or 0
            d["returns"] += c
            d["returned_records"] += 1 if c else 0
    for (rid, fld), (a, stale, first) in aud_final.items():
        d = per[rec_by_id[rid][0]]
        d["audited"] += 1
        d["first_wrong"] += 1 if first == "incorrect" else 0
        if stale:
            d["waiting_recheck"] += 1
        elif a.verdict == "incorrect":
            d["final_wrong"] += 1
    for (rid, fld), e in errs.items():
        d = per[rec_by_id[rid][0]]
        d["errors"] += 1
        d["caught"] += 1 if e["reviewer"] else 0
        d["fixed"] += 1 if e["fixed"] else 0
    rows = []
    for sid, d in per.items():
        d["errors_per_100"] = round(100 * d["errors"] / d["fields"], 1) if d["fields"] else None
        d["first_pass_accuracy"] = pct(d["audited"] - d["first_wrong"], d["audited"])
        d["final_accuracy"] = pct(d["audited"] - d["waiting_recheck"] - d["final_wrong"], d["audited"] - d["waiting_recheck"])
        d["still_wrong"] = max(0, d["errors"] - d["fixed"])
        d["extractor_id"] = extractor_of.get(sid)
        rows.append(d)
    by_ext: dict = {}
    for d in rows:
        u = d["extractor_id"]
        if not u:
            continue
        x = by_ext.setdefault(u, {"user_id": u, "name": names.get(u, "Unknown"), **{k: 0 for k in ("records", "fields", "returned_records", "returns", "audited", "first_wrong", "final_wrong", "waiting_recheck", "errors", "caught", "fixed")}, "sources": []})
        for k in ("records", "fields", "returned_records", "returns", "audited", "first_wrong", "final_wrong", "waiting_recheck", "errors", "caught", "fixed"):
            x[k] += d[k]
        x["sources"].append(d)
    ext = []
    for x in by_ext.values():
        x["errors_per_100"] = round(100 * x["errors"] / x["fields"], 1) if x["fields"] else None
        x["first_pass_accuracy"] = pct(x["audited"] - x["first_wrong"], x["audited"])
        x["final_accuracy"] = pct(x["audited"] - x["waiting_recheck"] - x["final_wrong"], x["audited"] - x["waiting_recheck"])
        x["still_wrong"] = max(0, x["errors"] - x["fixed"])
        x["caught_rate"] = pct(x["caught"], x["errors"])
        x["rework_rate"] = pct(x["returned_records"], x["records"])
        x["confidence"] = "low" if x["audited"] < 30 else "ok"
        x["sources"].sort(key=lambda z: -(z["errors_per_100"] or 0))
        ext.append(x)
    ext.sort(key=lambda z: -(z["errors_per_100"] or 0))
    return {"extractors": ext}


def compute_summary(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict, source_names: dict | None = None) -> dict:
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
    rec_fields = {r.id: (r.extracted_fields or {}) for rs in records_by_source.values() for r in rs}
    # A check made on a value the extractor has since changed is out of date. It stops counting towards final accuracy
    # until the admin looks again, but an error it found stays in the error counts and in first-pass accuracy.
    stale = {a.id for a in audits if a.record_id in rec_fields and not _eq(a.extracted_value, rec_fields[a.record_id].get(a.field))}
    live = [a for a in audits if a.id not in stale]
    a_bad = [a for a in audits if (getattr(a, "first_verdict", None) or a.verdict) == "incorrect" or (a.verdict == "incorrect" and a.id not in stale)]
    live_bad = [a for a in live if a.verdict == "incorrect"]
    escaped = [a for a in a_bad if (a.record_id, a.field) not in caught_keys]
    confirmed_all = [f for f in findings if f.status == "confirmed"]

    final_acc = pct(len(live) - len(live_bad), len(live))
    catch = pct(len(r_conf), len(r_conf) + len(escaped)) if (r_conf or escaped) else None
    precision = pct(len(r_conf), len(r_conf) + len(r_dis))
    parts = [(final_acc, 0.5), (catch, 0.3), (precision, 0.2)]
    have = [(v, w) for v, w in parts if v is not None]
    score = round(sum(v * w for v, w in have) / sum(w for _, w in have), 1) if have else None

    by_cat = Counter(f.category for f in confirmed_all)
    by_sev = Counter(f.severity for f in confirmed_all)

    rep = extractor_report(findings, audits, records_by_source, extractor_of, names, source_names)
    extractors = [{**x, "errors_per_100": x["errors_per_100"], "audit_accuracy": x["final_accuracy"], "sources": len(x["sources"]), "source_rows": x["sources"]} for x in rep["extractors"]]
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
        "counts": {"fields": fields_total, "audited": len(audits), "audited_wrong": len(a_bad), "escaped": len(escaped), "waiting_recheck": len(stale), "fixed_before_final": sum(1 for f in findings if getattr(f, "fixed_before_final", False)),
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


def _nk(k) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k or "").lower())


def _lookup(fields: dict, name: str):
    """The record's value for an SOP field. Exact key first, then the same name ignoring case, spaces and underscores."""
    if name in fields:
        return name, fields[name]
    n = _nk(name)
    for k, v in fields.items():
        if _nk(k) == n:
            return k, v
    return None, None


def sop_check(fields: dict, required: list[str], allowed: set | None, specs: dict | None = None) -> dict:
    """Does one record follow the SOP? missing = required but empty or a placeholder like "N/A".
    bad = a value outside the SOP's allowed list. unmapped = SOP fields the record has no key for at all."""
    fields = fields or {}
    specs = specs or {}
    missing, bad, unmapped, used = [], [], [], set()
    for f in required:
        key, val = _lookup(fields, f)
        if key is None:
            unmapped.append(f)
        if key is not None:
            used.add(key)
        if not _present(val) or str(val).strip().lower() in PLACEHOLDERS:
            missing.append(f)
    for name, sp in specs.items():
        key, val = _lookup(fields, name)
        if key is not None:
            used.add(key)
        al = sp.get("allowed") or []
        if al and key is not None and _present(val) and str(val).strip().lower() not in PLACEHOLDERS:
            items = val if isinstance(val, list) else [val]
            off = [str(x).strip() for x in items if isinstance(x, (str, int, float)) and str(x).strip() not in al]
            if off:
                bad.append({"field": name, "value": ", ".join(off), "allowed": al, "case_only": all(x.lower() in {a.lower() for a in al} for x in off)})
    known = {_nk(k) for k in (allowed or set())} | {_nk(k) for k in specs}
    extra = sorted(k for k in fields if allowed is not None and _nk(k) not in known and k not in SKIP_FIELDS and not str(k).startswith("_") and _present(fields[k]))
    return {"missing": missing, "extra": extra, "bad": bad, "unmapped": unmapped}


def sop_report(records: list[tuple[str, str, dict]], required: list[str], allowed: set | None, specs: dict | None = None) -> dict:
    """records = (record_id, label, fields). Field-by-field and record-by-record view of SOP compliance."""
    specs = specs or {}
    names = list(dict.fromkeys(list(required) + [n for n, sp in specs.items() if sp.get("allowed")]))
    by_field = {f: {"field": f, "required": f in required, "filled": 0, "missing": 0, "bad": 0, "absent": 0, "allowed": (specs.get(f) or {}).get("allowed") or [], "section": (specs.get(f) or {}).get("section")} for f in names}
    extra_count: Counter = Counter()
    failing, ok = [], 0
    for rid, label, fields in records:
        r = sop_check(fields, required, allowed, specs)
        badf = {x["field"] for x in r["bad"]}
        for f in names:
            row = by_field[f]
            if f in r["missing"]:
                row["missing"] += 1
                if f in r["unmapped"]:
                    row["absent"] += 1
            elif f in {x["field"] for x in r["bad"] if not x.get("case_only")}:
                row["bad"] += 1
            else:
                row["filled"] += 1
        extra_count.update(r["extra"])
        real_bad = [x for x in r["bad"] if not x.get("case_only")]
        if r["missing"] or real_bad:
            failing.append({"record_id": rid, "record": label, "missing": r["missing"], "bad": real_bad, "extra": r["extra"]})
        else:
            ok += 1
    n = len(records)
    rows = [{**v, "pct": pct(v["filled"], n)} for v in by_field.values()]
    return {"records": n, "compliant": ok, "rate": pct(ok, n), "by_field": sorted(rows, key=lambda x: (x["pct"] if x["pct"] is not None else 101)),
            "extra_fields": [{"field": f, "count": c} for f, c in extra_count.most_common()], "failing": failing[:200], "failing_total": len(failing)}


def site_state(field: str, h: dict) -> dict:
    """What 'found on the site' means for this field. Filled-in provenance fields are not expected on the page, so missing is neutral.
    A segment name on the page only proves the text is there, not that it is a real market segment."""
    from app.services import peer_notes
    if peer_notes.neutral_provenance(field, h["state"]):
        return {**h, "state": "neutral", "note": "Filled in by the system, so it is not expected on the page."}
    if field == "segment_name" and h["state"] in ("found", "close"):
        return {**h, "state": "appears", "note": "The text is on the page. That does not show it is a real market segment (one commodity or trading category)."}
    return h


def mentioned_fields(text: str, names: list[str], record: dict | None = None) -> list[str]:
    """Which fields does a peer's note complain about? Clause by clause: links, acknowledgements and how-to instructions never count
    (docs/TRAINING_SPEC_peer_note_to_field.md). A field is credited by its name, by a topic cue ("platform", "trading category"),
    or by quoting its short delivered value."""
    from app.services import peer_notes
    return peer_notes.fields_for(text, record, list(names))


SIGNAL_WEIGHT = {"comment": 5, "finding": 4, "mention": 3, "sop": 3, "system": 2, "ai": 2, "web": 2, "note": 1, "recheck": 6}


def _norm(t: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).split())


def find_in_text(value, text: str) -> dict:
    """Is this field value on the page? state: found | close | missing | skip. Only a pointer, never a verdict."""
    if isinstance(value, (list, tuple)):
        parts = [find_in_text(v, text) for v in value if _present(v)]
        parts = [p for p in parts if p["state"] != "skip"]
        if not parts:
            return {"state": "skip", "snippet": None}
        n = sum(1 for p in parts if p["state"] == "found")
        return {"state": "found" if n == len(parts) else "close" if n or any(p["state"] == "close" for p in parts) else "missing", "snippet": next((p["snippet"] for p in parts if p["snippet"]), None)}
    if value is None or isinstance(value, (bool, dict)) or str(value).strip() == "":
        return {"state": "skip", "snippet": None}
    raw = str(value).strip()
    if URL_RE.match(raw) or EMAIL_RE.match(raw) or len(raw) < 3:
        return {"state": "skip", "snippet": None}
    page = _norm(text)
    v = _norm(raw)
    if not v:
        return {"state": "skip", "snippet": None}
    def snip(word: str):
        i = text.lower().find(word.lower())
        return text[max(0, i - 60): i + 100].replace("\n", " ").strip() if i >= 0 else None
    if f" {v} " in f" {page} ":
        return {"state": "found", "snippet": snip(raw.split()[0]) or snip(v.split()[0])}
    toks = [t for t in v.split() if len(t) >= 3]
    if len(toks) >= 2:
        hit = sum(1 for t in toks if f" {t} " in f" {page} ")
        if hit / len(toks) >= 0.8:
            return {"state": "close", "snippet": snip(toks[0])}
    return {"state": "missing", "snippet": None}
