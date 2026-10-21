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


def _collect(findings: list, audits: list, records_by_source: dict):
    """One place that decides what counts as an error, so every score uses the same numbers.

    An error is one (record, field), counted once however many people pointed at it. It exists when an admin confirmed a
    logged finding on it, or an admin's ground-truth check found it wrong the first time, or still wrong now.
    """
    rec_by_id = {r.id: (sid, r) for sid, rs in records_by_source.items() for r in rs}
    errs: dict = {}

    def err(key):
        return errs.setdefault(key, {"reviewers": set(), "system": False, "fixed": False, "first": False, "audit_wrong": False})
    false_alarms: dict = defaultdict(set)     # reviewer -> {(record, field)} an admin dismissed
    for f in findings:
        if not f.field or f.record_id not in rec_by_id:
            continue
        key = (f.record_id, f.field)
        if f.status == "confirmed":
            e = err(key)
            if f.origin == "reviewer" and f.raised_by:
                e["reviewers"].add(f.raised_by)
            elif f.origin == "reviewer":
                e["reviewers"].add("?")
            else:
                e["system"] = True
            e["fixed"] = e["fixed"] or bool(getattr(f, "fixed_before_final", False))
        elif f.status == "dismissed" and f.origin == "reviewer" and f.raised_by:
            false_alarms[f.raised_by].add(key)
    aud_final: dict = {}
    for a in audits:
        pair = rec_by_id.get(a.record_id)
        if not pair:
            continue
        r = pair[1]
        stale = not _eq(a.extracted_value, (r.extracted_fields or {}).get(a.field))
        first = getattr(a, "first_verdict", None) or a.verdict
        aud_final[(a.record_id, a.field)] = (a, stale, first)
        if first == "incorrect" or (a.verdict == "incorrect" and not stale):
            e = err((a.record_id, a.field))
            e["audit_wrong"] = True
            e["first"] = e["first"] or first == "incorrect"
        if first == "incorrect" and a.verdict == "correct" and not stale:
            err((a.record_id, a.field))["fixed"] = True
    return rec_by_id, errs, aud_final, false_alarms


_ZERO = ("records", "fields", "returned_records", "returns", "audited", "first_wrong", "final_wrong", "waiting_recheck", "errors", "caught", "fixed")


def _finish(d: dict) -> dict:
    """Rates from the counts of one scope (a source, an extractor, or everything)."""
    d["errors_per_100"] = round(100 * d["errors"] / d["fields"], 1) if d["fields"] else None
    d["first_pass_accuracy"] = pct(d["audited"] - d["first_wrong"], d["audited"])
    d["final_accuracy"] = pct(d["audited"] - d["waiting_recheck"] - d["final_wrong"], d["audited"] - d["waiting_recheck"])
    d["still_wrong"] = max(0, d["errors"] - d["fixed"])
    d["escaped"] = max(0, d["errors"] - d["caught"])
    d["caught_rate"] = pct(d["caught"], d["errors"])
    d["rework_rate"] = pct(d["returned_records"], d["records"])
    d["confidence"] = "low" if d["audited"] < 30 else "ok"
    return d


def scorecard(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict, source_names: dict | None = None, peers_of: dict | None = None) -> dict:
    """Every score the reports use, from one pass over the same data: per source (a batch), per extractor, per reviewer, and cumulative.

    Errors stay in the numbers after the extractor fixes them. Fixing lowers the delivered error rate (final accuracy) and
    leaves first-pass accuracy alone, so returns and rework stay visible.
    peers_of maps a source to the peer reviewers assigned to it. A reviewer's catch rate is the share of all known errors on
    their sources that they pointed at.
    """
    source_names = source_names or {}
    peers_of = peers_of or {}
    rec_by_id, errs, aud_final, false_alarms = _collect(findings, audits, records_by_source)
    per: dict = {}
    for sid, rs in records_by_source.items():
        d = per.setdefault(sid, {"source_id": sid, "source": source_names.get(sid, ""), **{k: 0 for k in _ZERO}})
        for r in rs:
            d["records"] += 1
            d["fields"] += count_fields(r)
            c = getattr(r, "correction_count", 0) or 0
            d["returns"] += c
            d["returned_records"] += 1 if c else 0
    for (rid, _fld), (a, stale, first) in aud_final.items():
        d = per[rec_by_id[rid][0]]
        d["audited"] += 1
        d["first_wrong"] += 1 if first == "incorrect" else 0
        if stale:
            d["waiting_recheck"] += 1
        elif a.verdict == "incorrect":
            d["final_wrong"] += 1
    for (rid, _fld), e in errs.items():
        d = per[rec_by_id[rid][0]]
        d["errors"] += 1
        d["caught"] += 1 if e["reviewers"] else 0
        d["fixed"] += 1 if e["fixed"] else 0
    rows = []
    for sid, d in per.items():
        d["extractor_id"] = extractor_of.get(sid)
        d["extractor"] = names.get(d["extractor_id"], "") if d["extractor_id"] else ""
        d["peers"] = [names.get(u, "Unknown") for u in peers_of.get(sid, [])]
        rows.append(_finish(d))
    total = {k: sum(d[k] for d in rows) for k in _ZERO}
    total["sources"] = len(rows)
    cumulative = _finish(total)
    by_ext: dict = {}
    for d in rows:
        u = d["extractor_id"]
        if not u:
            continue
        x = by_ext.setdefault(u, {"user_id": u, "name": names.get(u, "Unknown"), **{k: 0 for k in _ZERO}, "sources": []})
        for k in _ZERO:
            x[k] += d[k]
        x["sources"].append(d)
    ext = []
    for x in by_ext.values():
        _finish(x)
        x["sources"].sort(key=lambda z: -(z["errors_per_100"] or 0))
        ext.append(x)
    ext.sort(key=lambda z: -(z["errors_per_100"] or 0))
    # Reviewers. Catch rate needs the denominator: every known error on the sources they were assigned to.
    errs_on = defaultdict(set)
    for (rid, fld) in errs:
        errs_on[rec_by_id[rid][0]].add((rid, fld))
    open_by = Counter(f.raised_by for f in findings if f.origin == "reviewer" and f.status == "open" and f.raised_by)
    people = set(false_alarms) | {u for e in errs.values() for u in e["reviewers"] if u != "?"} | {u for us in peers_of.values() for u in us}
    rev = []
    for u in people:
        caught = {k for k, e in errs.items() if u in e["reviewers"]}
        fa = false_alarms.get(u, set()) - caught
        mine = [sid for sid, us in peers_of.items() if u in us]
        known = set().union(*[errs_on.get(sid, set()) for sid in mine]) if mine else set()
        missed = known - caught
        solo = sum(1 for k in caught if e_only(errs[k], u))
        rev.append({"user_id": u, "name": names.get(u, "Unknown"), "sources": len(mine), "raised": len(caught) + len(fa), "confirmed": len(caught), "dismissed": len(fa),
                    "open": open_by.get(u, 0), "caught": len(caught), "false_alarms": len(fa), "missed": len(missed), "known_errors": len(known), "only_one_to_catch": solo,
                    "precision": pct(len(caught), len(caught) + len(fa)), "catch_rate": pct(len(caught & known), len(known)) if known else None,
                    "confidence": "low" if len(known) < 10 else "ok"})
    rev.sort(key=lambda z: (-(z["caught"]), z["name"]))
    return {"batches": sorted(rows, key=lambda z: -(z["errors_per_100"] or 0)), "cumulative": cumulative, "extractors": ext, "reviewers": rev, "errors": errs, "false_alarms": false_alarms}


def e_only(e: dict, uid: str) -> bool:
    """True when this reviewer was the only person who pointed at the error."""
    return e["reviewers"] == {uid}


def extractor_report(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict, source_names: dict | None = None) -> dict:
    """What each extractor delivered and how accurate it was, counting everything that was ever found."""
    sc = scorecard(findings, audits, records_by_source, extractor_of, names, source_names)
    return {"extractors": sc["extractors"]}


def compute_summary(findings: list, audits: list, records_by_source: dict, extractor_of: dict, names: dict, source_names: dict | None = None, peers_of: dict | None = None) -> dict:
    """Process scores from logged findings and ground-truth audits.

    final accuracy     = audited fields that were right now / audited fields that were checked on their current value
    review catch rate  = known errors a peer pointed at / all known errors (each record and field counted once)
    reviewer precision = fields a peer flagged that were confirmed / (confirmed + dismissed)
    process score      = 50% final accuracy + 30% review catch rate + 20% reviewer precision (parts that cannot be measured yet are left out)
    """
    sc = scorecard(findings, audits, records_by_source, extractor_of, names, source_names, peers_of)
    cum = sc["cumulative"]
    reviewer = [f for f in findings if f.origin == "reviewer"]
    system = [f for f in findings if f.origin == "system"]
    r_conf = [f for f in reviewer if f.status == "confirmed"]
    r_dis = [f for f in reviewer if f.status == "dismissed"]
    s_conf = [f for f in system if f.status == "confirmed"]
    s_dis = [f for f in system if f.status == "dismissed"]
    confirmed_all = [f for f in findings if f.status == "confirmed"]
    fa = sum(len(v - {k for k, e in sc["errors"].items() if u in e["reviewers"]}) for u, v in sc["false_alarms"].items())
    caught_n = sum(1 for e in sc["errors"].values() if e["reviewers"])
    final_acc = cum["final_accuracy"]
    catch = cum["caught_rate"] if cum["errors"] else None
    precision = pct(caught_n, caught_n + fa) if (caught_n + fa) else None
    parts = [(final_acc, 0.5), (catch, 0.3), (precision, 0.2)]
    have = [(v, w) for v, w in parts if v is not None]
    score = round(sum(v * w for v, w in have) / sum(w for _, w in have), 1) if have else None
    by_cat = Counter(f.category for f in confirmed_all)
    by_sev = Counter(f.severity for f in confirmed_all)
    extractors = [{**x, "audit_accuracy": x["final_accuracy"], "sources": len(x["sources"]), "source_rows": x["sources"]} for x in sc["extractors"]]
    return {
        "scores": {"process": score, "final_accuracy": final_acc, "first_pass_accuracy": cum["first_pass_accuracy"], "review_catch_rate": catch, "reviewer_precision": precision},
        "counts": {"fields": cum["fields"], "audited": cum["audited"], "audited_wrong": cum["first_wrong"], "escaped": cum["escaped"], "waiting_recheck": cum["waiting_recheck"],
                   "errors": cum["errors"], "caught": cum["caught"], "fixed_before_final": sum(1 for f in findings if getattr(f, "fixed_before_final", False)),
                   "reviewer_findings": len(reviewer), "reviewer_confirmed": len(r_conf), "reviewer_dismissed": len(r_dis),
                   "reviewer_open": len(reviewer) - len(r_conf) - len(r_dis), "system_findings": len(system),
                   "system_confirmed": len(s_conf), "system_dismissed": len(s_dis), "open": sum(1 for f in findings if f.status == "open"),
                   "errors_per_100_fields": cum["errors_per_100"]},
        "system_precision": pct(len(s_conf), len(s_conf) + len(s_dis)),
        "by_category": [{"category": c, "label": CATEGORIES.get(c, c), "count": n} for c, n in by_cat.most_common()],
        "by_severity": {s: by_sev.get(s, 0) for s in SEVERITIES},
        "extractors": extractors, "reviewers": sc["reviewers"], "batches": sc["batches"], "cumulative": cum,
        "confidence": "low" if cum["audited"] < 30 else "ok",
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


_DT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_D = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RANGE = re.compile(r"range:\s*(-?[\d.]+|-?inf)\s*to\s*\+?(-?[\d.]+|\+?inf)", re.I)


def type_issue(spec: dict, val) -> str | None:
    """The SOP's declared type and range, applied exactly: dates as YYYY-MM-DD, timestamps as ...Z, numbers without unit text."""
    if not _present(val):
        return None
    t = str(spec.get("type") or "").lower()
    sv = str(val).strip()
    if t == "datetime" and not _DT.match(sv):
        return f"not an ISO 8601 UTC timestamp like 2026-01-31T12:00:00Z"
    if t == "date" and not _D.match(sv):
        return "not a date like 2026-01-31"
    if t in ("float", "number", "integer", "int"):
        if isinstance(val, bool):
            return "not a number"
        try:
            n = float(val) if not isinstance(val, (int, float)) else float(val)
        except Exception:
            return "not a plain number (no unit text inside the value)"
        m = _RANGE.search(spec.get("format") or "")
        if m:
            def num(x):
                return float("inf") if "inf" in x and not x.startswith("-") else (float("-inf") if "inf" in x else float(x))
            lo, hi = num(m.group(1)), num(m.group(2))
            if n < lo or n > hi:
                return f"outside the range {m.group(1)} to {m.group(2)}"
    if t in ("string", "") and not isinstance(val, (list, dict)) and re.search(r"alpha-?2|ISO ?3166-?1", " ".join(str(spec.get(k) or "") for k in ("format", "rule")), re.I) and not re.fullmatch(r"[A-Z]{2}", sv):
        return "not an ISO 3166-1 alpha-2 country code (two capital letters, for example KE), and a country name is not accepted"
    if t == "boolean" and not isinstance(val, bool) and sv.lower() not in ("true", "false"):
        return "not an explicit true or false"
    return None


def sop_check(fields: dict, required: list[str], allowed: set | None, specs: dict | None = None, blocks: dict | None = None) -> dict:
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
        ti = type_issue(sp, val) if key is not None and not (sp.get("allowed")) else None
        if ti:
            bad.append({"field": name, "value": str(val), "allowed": [], "reason": ti, "case_only": False})
        al = sp.get("allowed") or []
        if al and key is not None and _present(val) and str(val).strip().lower() not in PLACEHOLDERS:
            items = val if isinstance(val, list) else [val]
            off = [str(x).strip() for x in items if isinstance(x, (str, int, float)) and str(x).strip() not in al]
            if off:
                bad.append({"field": name, "value": ", ".join(off), "allowed": al, "case_only": all(x.lower() in {a.lower() for a in al} for x in off)})
    for block, bspecs in (blocks or {}).items():
        key, items = _lookup(fields, block)
        if key is not None:
            used.add(key)
        if not isinstance(items, list):
            continue
        for i, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            for fname, sp in bspecs.items():
                k2, v2 = _lookup(item, fname)
                label = f"{block}[{i}].{fname}"
                if sp.get("required") and (not _present(v2) or str(v2).strip().lower() in PLACEHOLDERS):
                    missing.append(label)
                    continue
                ti = type_issue(sp, v2) if not sp.get("allowed") else None
                if ti:
                    bad.append({"field": label, "value": str(v2), "allowed": [], "reason": ti, "case_only": False})
                al = sp.get("allowed") or []
                if al and _present(v2) and str(v2).strip() not in al:
                    bad.append({"field": label, "value": str(v2), "allowed": al, "case_only": str(v2).strip().lower() in {a.lower() for a in al}})
    known = {_nk(k) for k in (allowed or set())} | {_nk(k) for k in specs}
    extra = sorted(k for k in fields if allowed is not None and _nk(k) not in known and k not in SKIP_FIELDS and not str(k).startswith("_") and _present(fields[k]))
    return {"missing": missing, "extra": extra, "bad": bad, "unmapped": unmapped}


def sop_report(records: list[tuple[str, str, dict]], required: list[str], allowed: set | None, specs: dict | None = None, blocks: dict | None = None) -> dict:
    """records = (record_id, label, fields). Field-by-field and record-by-record view of SOP compliance."""
    specs = specs or {}
    names = list(dict.fromkeys(list(required) + [n for n, sp in specs.items() if sp.get("allowed") or sp.get("type") in ("datetime", "date", "float", "number", "integer")]))
    by_field = {f: {"field": f, "required": f in required, "filled": 0, "missing": 0, "bad": 0, "absent": 0, "allowed": (specs.get(f) or {}).get("allowed") or [], "section": (specs.get(f) or {}).get("section")} for f in names}
    extra_count: Counter = Counter()
    failing, ok = [], 0
    for rid, label, fields in records:
        r = sop_check(fields, required, allowed, specs, blocks)
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
