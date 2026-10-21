"""Map a peer comment to the field(s) it actually complains about.

Rule (docs/TRAINING_SPEC_peer_note_to_field.md): a field is credited only when a COMPLAINT clause is about it. Field names
inside instruction clauses (how to build the fix) and in acknowledgements never credit a peer. Links are stripped first.
Evidence for a field, strongest first: its name (0.9), the clause quotes the field's short delivered value (0.75), a topic cue (0.7).
Credit only at 0.7 or more.
"""
from __future__ import annotations

import re

CREDIT_AT = 0.7

# field -> (name patterns, topic cues). Topic cues let a note point at a field without naming it.
FIELDS = {
    "segment_name": ([r"segment_name", r"segment name"],
                     [r"market segment", r"trading category", r"platform", r"pre-?filled", r"not a (real )?segment", r"real segment", r"commodit"]),
    "company_name": ([r"company_name", r"company name"], [r"legal (entity )?name", r"entity name"]),
    "evidence": ([r"evidence"], [r"verbatim", r"word for word", r"snippet", r"quote[ds]? ", r"joined|dash|hyphen"]),
    "source_url": ([r"source_url", r"source url"], [r"wrong (page|link|url)", r"link (is )?(broken|wrong|dead)", r"does not open", r"redirect"]),
    "regions": ([r"regions?\b"], [r"country code", r"ISO"]),
    "retrieved_at": ([r"retrieved_at"], [r"timestamp"]),
    "data_origin": ([r"data_origin"], []),
    "method": ([r"\bmethod\b"], []),
}
VALUE_CUE_FIELDS = ("segment_name", "company_name", "regions")
INSTR_START = re.compile(r"^\s*(\d+[\).:]\s*)?(please\s+)?(remove|delete|open|create|use|using|skip|replace|add|change|set|fill|what to do|for each|then)\b", re.I)
INSTR_INLINE = re.compile(r"\b(using|use)\b[^.]{0,60}\b(as|for)\b\s+(source_url|evidence|company_name|segment_name)", re.I)
ACK = re.compile(r"^\s*(ok(ay)?|noted|done|thanks?|will do|sure)\W*$", re.I)


def clauses(text: str) -> list[str]:
    t = re.sub(r"https?://\S+", "<URL>", text or "")      # links are never evidence of a complaint
    t = re.sub(r"\s[-*]\s", "\n", t)                       # list bullets -> new clause
    parts = re.split(r"(?<=[.!?])\s+|\n+|(?=\b\d\.\s)", t)
    return [p.strip() for p in parts if p and p.strip()]


def kind(clause: str) -> str:
    if ACK.match(clause):
        return "ack"
    if INSTR_START.match(clause) or INSTR_INLINE.search(clause):
        return "instruction"
    return "complaint"


def _generic_name(clause: str, name: str) -> bool:
    """Any other field name (from the SOP or schema): written with underscores or spaces, or quoted / 'name:' / 'name field'."""
    spaced = name.replace("_", " ")
    edge = r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])"
    if "_" in name or " " in name:
        return bool(re.search(edge % re.escape(name), clause, re.I) or re.search(edge % re.escape(spaced), clause, re.I))
    w = re.escape(name)
    return bool(re.search(r"[`'\"*]%s[`'\"*]" % w, clause, re.I) or re.search(r"(?<![A-Za-z0-9_])%s\s*:" % w, clause, re.I)
                or re.search(r"(?<![A-Za-z0-9_])%s\s+(field|column)" % w, clause, re.I) or re.search(r"(field|column)\s+%s(?![A-Za-z0-9_])" % w, clause, re.I))


def match(note: str, record: dict | None = None, names: list[str] | None = None) -> dict[str, float]:
    """field -> confidence. `names` limits the answer to fields that exist on the record or source."""
    out: dict[str, float] = {}
    for c in clauses(note):
        if kind(c) != "complaint":
            continue
        for f, (pats, cues) in FIELDS.items():
            if names is not None and f not in names:
                continue
            if any(re.search(p, c, re.I) for p in pats):
                out[f] = max(out.get(f, 0), 0.9)
            elif any(re.search(q, c, re.I) for q in cues):
                out[f] = max(out.get(f, 0), 0.7)
        for f in (names or []):
            if f in FIELDS or not f or f.startswith("_"):
                continue
            if _generic_name(c, f):
                out[f] = max(out.get(f, 0), 0.9)
        for f, v in (record or {}).items():
            if names is not None and f not in names:
                continue
            if isinstance(v, str) and 4 <= len(v) <= 40 and f in VALUE_CUE_FIELDS and re.search(re.escape(v), c, re.I):
                out[f] = max(out.get(f, 0), 0.75)
    return out


def fields_for(note: str, record: dict | None = None, names: list[str] | None = None) -> list[str]:
    return sorted(f for f, s in match(note, record, names).items() if s >= CREDIT_AT)


PROVENANCE = ("data_origin", "retrieved_at", "method")


def neutral_provenance(field: str, state: str) -> bool:
    """data_origin / retrieved_at / method are auto-filled: 'not on the page' is neutral, never an error."""
    return field in PROVENANCE and state in ("not_on_page", "missing")


def score(cases: list[dict]) -> dict:
    """Credit precision and recall, overall and per field."""
    tp: dict = {}
    fp: dict = {}
    fn: dict = {}
    for c in cases:
        got = set(fields_for(c["note"], c.get("record")))
        want = set(c["fields"])
        for f in got & want:
            tp[f] = tp.get(f, 0) + 1
        for f in got - want:
            fp[f] = fp.get(f, 0) + 1
        for f in want - got:
            fn[f] = fn.get(f, 0) + 1
    def pr(a, b, c):
        return {"precision": (a / (a + b)) if (a + b) else None, "recall": (a / (a + c)) if (a + c) else None, "tp": a, "fp": b, "fn": c}
    per = {f: pr(tp.get(f, 0), fp.get(f, 0), fn.get(f, 0)) for f in sorted(set(tp) | set(fp) | set(fn))}
    return {"overall": pr(sum(tp.values()), sum(fp.values()), sum(fn.values())), "per_field": per, "cases": len(cases)}
