"""Verdicts from a review package, turned into Final check decisions and send-back lists.

A review package is a zip with VERDICTS_all_sources.json (a list of {source, record, field, verdict, correct_value, evidence_url, note}).
Only the verdict file is read here. Nothing is recorded and nothing is sent back by this module; it only plans.

  admin_right, both_wrong  -> the extractor's value is wrong   -> decision "wrong"
  extractor_right          -> the extractor's value stands      -> decision "right"
  unverifiable             -> nobody can settle it from a page  -> no decision, the field stays held
"""
from __future__ import annotations

import io
import json
import re
import zipfile

from app.services import answer_key as ak

WRONG = {"admin_right", "both_wrong"}
RIGHT = {"extractor_right"}


def read_verdicts(filename: str, content: bytes) -> list[dict]:
    """The verdict list from the package zip, or from the verdict file itself."""
    raw = None
    if (filename or "").lower().endswith(".zip") or content[:2] == b"PK":
        try:
            z = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            raise ValueError("That is not a valid zip file.")
        names = [n for n in z.namelist() if re.search(r"(^|/)verdicts[^/]*\.json$", n, re.I)]
        if not names:
            raise ValueError("No VERDICTS file was found in that zip.")
        raw = z.read(names[0])
    else:
        raw = content
    try:
        data = json.loads(raw.lstrip(b"\xef\xbb\xbf").decode("utf-8"))
    except Exception:
        raise ValueError("The verdicts file could not be read.")
    if isinstance(data, dict):
        data = next((data[k] for k in ("verdicts", "items", "records") if isinstance(data.get(k), list)), None)
    rows = [v for v in (data or []) if isinstance(v, dict) and v.get("source") and v.get("field") is not None]
    if not rows:
        raise ValueError("No verdicts found in that file.")
    return rows


def _norm(s) -> str:
    return ak.norm(s)


def _find_record(recs: list, name: str):
    n = _norm(name)
    if not n:
        return None
    for r in recs:
        names = {_norm(r.canonical_name), _norm(ak.record_name(r.extracted_fields or {}, r.canonical_name))}
        if n in names:
            return r
    for r in recs:  # one name inside the other, as the Final check does
        for c in (_norm(r.canonical_name), _norm(ak.record_name(r.extracted_fields or {}, r.canonical_name))):
            if c and len(c) >= 4 and len(n) >= 4 and (c in n or n in c):
                return r
    return None


def _text(v) -> str:
    if v is None:
        return "(leave out)"
    if isinstance(v, (list, tuple)):
        return "; ".join(str(x) for x in v)
    return str(v)


def plan(sources: list, records_of, verdicts: list[dict]) -> dict:
    """sources: Source rows the admin can see. records_of(source_id) -> the records on the platform now."""
    by_name = {}
    for s in sources:
        by_name.setdefault(_norm(s.name), []).append(s)
    decisions: dict = {}
    per_source: dict = {}
    per_record: dict = {}
    unmatched: list = []
    for v in verdicts:
        cands = by_name.get(_norm(v["source"]), [])
        s = max(cands, key=lambda x: len(records_of(x.id))) if cands else None
        st = per_source.setdefault(v["source"], {"name": v["source"], "source_id": s.id if s else None, "verdicts": 0, "wrong": 0, "right": 0, "held": 0, "unmatched": 0})
        st["verdicts"] += 1
        verdict = v.get("verdict")
        if not s:
            st["unmatched"] += 1
            unmatched.append({"source": v["source"], "record": v.get("record"), "field": v.get("field"), "why": "Source not found"})
            continue
        field = str(v["field"])
        rec = _find_record(records_of(s.id), v.get("record") or "")
        if verdict in WRONG:
            st["wrong"] += 1
        elif verdict in RIGHT:
            st["right"] += 1
        else:
            st["held"] += 1
        if not rec:
            st["unmatched"] += 1
            unmatched.append({"source": v["source"], "record": v.get("record"), "field": field, "why": "Record not found on the platform"})
            continue
        if field.startswith("("):      # a record-level verdict, such as a hold: it has no field to decide
            continue
        if verdict in WRONG:
            decisions[f"{rec.id}|{field}"] = "wrong"
            slot = per_record.setdefault(rec.id, {"source_id": s.id, "source": s.name, "record_id": rec.id, "record": v.get("record"), "status": getattr(rec.review_status, "value", str(rec.review_status)),
                                                  "submitted": bool(rec.is_submitted), "items": []})
            fix = _text(v.get("correct_value"))
            slot["items"].append({"field": field, "should_be": fix, "url": v.get("evidence_url"), "note": (v.get("note") or "")[:240]})
        elif verdict in RIGHT:
            decisions[f"{rec.id}|{field}"] = "right"
    send_back = []
    for slot in per_record.values():
        parts = []
        for it in slot["items"]:
            line = f"{it['field']}: " + (f"should be {it['should_be']}" if it["should_be"] not in ("", "(hold)") else (it["note"] or "not supported by the source"))
            if it["url"]:
                line += f" ({it['url']})"
            parts.append(line)
        comment = "Please fix: " + " | ".join(parts)
        skip = None
        if slot["submitted"]:
            skip = "Already submitted to Xtrium"
        elif slot["status"] in ("rejected", "approved"):
            skip = "Already returned" if slot["status"] == "rejected" else "Already approved"
        send_back.append({**slot, "fields": [i["field"] for i in slot["items"]], "comment": comment[:1000], "skip": skip})
    send_back.sort(key=lambda x: (x["source"], x["record"] or ""))
    return {"decisions": decisions, "sources": list(per_source.values()), "send_back": send_back, "unmatched": unmatched,
            "totals": {"verdicts": len(verdicts), "wrong": sum(1 for d in decisions.values() if d == "wrong"), "right": sum(1 for d in decisions.values() if d == "right"),
                       "records_to_send_back": sum(1 for x in send_back if not x["skip"]), "records_skipped": sum(1 for x in send_back if x["skip"]), "unmatched": len(unmatched)}}
