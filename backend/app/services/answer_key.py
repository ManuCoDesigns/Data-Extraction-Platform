"""The admin's final records, checked against what the extractor delivered and what the reviewers flagged.

The admin uploads the final (corrected) records. Each source is matched by name, each record by its name, and every field is compared:
the same value is correct, a different one is wrong. Wrong fields that a reviewer had flagged are catches; wrong fields nobody flagged
escaped; correct fields a reviewer flagged are false alarms. Error % is wrong fields over compared fields; accuracy % is the rest.
Nothing here edits a record. Applying only records the verdicts as audits.
"""
import io
import json
import re
import zipfile

NAME_KEYS = ("canonical_name", "company_name", "material_name", "segment_name", "supplier_name", "name", "title")
IGNORE_DEFAULT = ("retrieved_at",)  # a timestamp changes every time someone re-checks; it is not an accuracy error


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def empty(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def _strict(v):
    if isinstance(v, str):
        return v.strip()
    return json.dumps(v, sort_keys=True, default=str)


def _loose(v):
    if isinstance(v, str):
        return norm(v)
    if isinstance(v, list):
        return sorted(json.dumps(_loose(x), sort_keys=True, default=str) for x in v)
    if isinstance(v, dict):
        return {k: _loose(x) for k, x in v.items()}
    return v


def judge(extractor_value, final_value):
    """('correct'|'wrong', cosmetic). Wording that differs only in case, spacing or punctuation counts as correct."""
    if empty(extractor_value) and empty(final_value):
        return "correct", False
    if _strict(extractor_value) == _strict(final_value):
        return "correct", False
    if not empty(extractor_value) and not empty(final_value) and json.dumps(_loose(extractor_value), sort_keys=True, default=str) == json.dumps(_loose(final_value), sort_keys=True, default=str):
        return "correct", True
    return "wrong", False


def category_of(extractor_value, final_value) -> str:
    if empty(final_value) and not empty(extractor_value):
        return "unsupported_value"  # it should not be there
    if empty(extractor_value) and not empty(final_value):
        return "missing_value"
    return "wrong_value"


def record_name(fields: dict, canonical: str | None = None) -> str:
    for k in NAME_KEYS:
        v = (fields or {}).get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return (canonical or "").strip()


def load_key(filename: str, content: bytes, only_source: str | None = None) -> dict:
    """{source name: [records]} from a zip (all_records*.json, or one JSON file per source) or a single JSON file."""
    def parse(b: bytes):
        if b.startswith(b"\xef\xbb\xbf"):
            b = b[3:]
        return json.loads(b.decode("utf-8"))

    def as_list(x):
        return x if isinstance(x, list) else [x] if isinstance(x, dict) else []

    if filename.lower().endswith(".zip") or content[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(content))
        names = [n for n in z.namelist() if n.lower().endswith(".json") and not n.endswith("/")]
        allf = [n for n in names if re.search(r"(^|/)all_records[^/]*\.json$", n, re.I)]
        if allf:
            data = parse(z.read(allf[0]))
            if isinstance(data, dict):
                return {k: [r for r in as_list(v) if isinstance(r, dict)] for k, v in data.items()}
        out: dict = {}
        for n in names:
            base = re.sub(r"\.json$", "", n.split("/")[-1], flags=re.I).replace("_", " ")
            out[base] = [r for r in as_list(parse(z.read(n))) if isinstance(r, dict)]
        return out
    data = parse(content)
    if isinstance(data, dict) and not any(k in data for k in ("records", "items", "data", "rows")) and all(isinstance(v, (list, dict)) for v in data.values()) and data:
        return {k: [r for r in as_list(v) if isinstance(r, dict)] for k, v in data.items()}
    for k in ("records", "items", "data", "rows"):
        if isinstance(data, dict) and isinstance(data.get(k), list):
            data = data[k]
            break
    recs = [r for r in as_list(data) if isinstance(r, dict)]
    if not only_source:
        raise ValueError("A single list of records needs a source. Pick the source first, or upload the all-records file or the zip.")
    return {only_source: recs}


def match_records(final_recs: list, ext_recs: list, ext_name):
    """Pair each final record with the extractor's: same name, then one name inside the other, then by order when the counts are equal."""
    pairs, used_f, used_e = [], set(), set()
    fn = [norm(record_name(f)) for f in final_recs]
    en = [norm(ext_name(e)) for e in ext_recs]
    for i, a in enumerate(fn):
        for j, b in enumerate(en):
            if a and a == b and j not in used_e:
                pairs.append((i, j)); used_f.add(i); used_e.add(j); break
    for i, a in enumerate(fn):
        if i in used_f:
            continue
        for j, b in enumerate(en):
            if j in used_e or not a or not b or min(len(a), len(b)) < 4:
                continue
            if a in b or b in a:
                pairs.append((i, j)); used_f.add(i); used_e.add(j); break
    rest_f = [i for i in range(len(final_recs)) if i not in used_f]
    rest_e = [j for j in range(len(ext_recs)) if j not in used_e]
    if rest_f and len(rest_f) == len(rest_e) and not used_f:  # nothing matched by name and the counts line up
        pairs += list(zip(rest_f, rest_e)); used_f |= set(rest_f); used_e |= set(rest_e)
    return pairs, [i for i in range(len(final_recs)) if i not in used_f], [j for j in range(len(ext_recs)) if j not in used_e]


def compare(ext_fields: dict, final_fields: dict, ignore) -> list:
    """One row per field with a value on either side: its verdict, the two values and whether only the wording differs."""
    rows = []
    for k in sorted(set(ext_fields or {}) | set(final_fields or {})):
        if k in ignore:
            continue
        ev, fv = (ext_fields or {}).get(k), (final_fields or {}).get(k)
        if empty(ev) and empty(fv):
            continue
        verdict, cosmetic = judge(ev, fv)
        rows.append({"field": k, "verdict": verdict, "cosmetic": cosmetic, "extractor_value": ev, "final_value": fv,
                     "category": category_of(ev, fv) if verdict == "wrong" else None})
    return rows


def rates(compared: int, wrong: int) -> dict:
    return {"fields": compared, "wrong": wrong,
            "error_pct": round(100 * wrong / compared, 1) if compared else None,
            "accuracy_pct": round(100 - 100 * wrong / compared, 1) if compared else None}
