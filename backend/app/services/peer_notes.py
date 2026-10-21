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
                     [r"market segment", r"trading category", r"platform", r"pre-?filled", r"not a (real )?segment", r"real segment", r"commodit", r"\bsegments?\b"]),
    "company_name": ([r"company_name", r"company name"], [r"legal (entity )?name", r"entity name"]),
    "evidence": ([r"(?<![Nn]o )(?<!any )(?<!without )(?<!little )\bevidence\b(?!\s+(?:of|that|for|to)\b)"], [r"verbatim", r"word for word", r"snippet", r"quote[ds]? ", r"joined|dash|hyphen"]),
    "source_url": ([r"source_url", r"source url"], [r"wrong (page|link|url)", r"link (is )?(broken|wrong|dead)", r"does not open", r"redirect", r"\b(url|link)\b[^.]{0,60}\b(wrong|broken|dead|404|tracking|param\w*|login|home ?page|cookie|going to|goes to|lands?|not (the )?(article|page))", r"\b(fix|change|update|replace)\s+(the\s+)?(url|link)\b"]),
    "regions": ([r"regions?\b"], [r"country code", r"ISO", r"\bcountr(?:y|ies)\b"]),
    "headquarters_country": ([r"headquarters_country", r"headquarters country", r"\bhq country"], [r"\bcountry\b"]),
    "retrieved_at": ([r"retrieved_at", r"retrieved at"], [r"timestamp"]),
    "data_origin": ([r"data_origin", r"data origin"], [r"provenance (mismatch|pair|conflict|does not match|doesn't match)"]),
    "method": ([r"\bmethod\b"], [r"provenance (mismatch|pair|conflict|does not match|doesn't match)"]),
}
VALUE_CUE_FIELDS = ("segment_name", "company_name", "regions")
# Enum values that name their field. Underscore forms are unambiguous; plain words only count when the record carries that value.
ENUM_TOKENS = {"data_origin": ["ai_generated", "source_derived"], "method": ["llm_extraction", "rule_extraction", "er_deterministic", "er_llm_reviewed"]}
INSTR_START = re.compile(r"^\s*(\d+[\).:]\s*)?(please\s+)?(remove|delete|open|create|use|using|skip|replace|add|change|set|fill|what to do|for each|then|make sure|ensure|go to|click)\b", re.I)
INSTR_INLINE = re.compile(r"\b(using|use)\b[^.]{0,60}\b(as|for)\b\s+(source_url|evidence|company_name|segment_name)", re.I)
POSITIVE = re.compile(r"\b(?:passed|valid|ok|okay)\b[^.]{0,60}\b(?:ok|okay|valid|passed)\b|\b(look(s|ed)?|is|are|seems?|appears?|was|were|works?|working|matche?s?|checked out)(?:\s+(?:all|also|probably|still|mostly|quite|really|totally|definitely))*\s+(fine|correct|good|ok|okay|right|valid|accurate|verified|supported|matching|ok to go)\b|\b(ok|okay|fine|correct|good)\s*[.!]*\s*(,|;|$)|\bno (problems?|issues?|errors?|concerns?)\b|\bnothing (is )?wrong\b|\b(they|it|all|everything) (all )?match(es)?\b|\bworks\b", re.I)
STRONG_POSITIVE = re.compile(r"\bno (problems?|issues?|errors?|concerns?|duplicates?|missing( \w+)?|empty( \w+)?|mismatch\w*)\b|\bnothing (is )?wrong\b", re.I)
NEGATIVE = re.compile(r"\b(not|n't|wrong|incorrect|missing|broken|fails?|invalid|mismatch\w*|empty|bad|dead|duplicate[ds]?|should|must|needs?)\b|\bno\b", re.I)
SPLIT_CONTRAST = re.compile(r"\s*[,;]?\s*\b(?:but|however|although|though|yet|except|maybe|perhaps|apart from)\b[,:]?\s*", re.I)
UNVERIFIED = re.compile(r"\bnot (yet |been )?verified\b|\bunverified\b|\b(did not|didn't|haven't|have not|hasn't|has not) (verify|verified|check|checked|open|opened)\b|\b(could not|couldn't|cannot|can't|unable to|wasn't able to|was not able to)\s+(verify|check|open|access|load|reach|confirm)\b|\bbehind a (login|paywall|sign-?in)\b|\bpaywall(ed)?\b", re.I)
ACK = re.compile(r"^\s*(ok(ay)?|noted|done|thanks?|will do|sure)\W*$", re.I)


def clauses(text: str) -> list[str]:
    t = re.sub(r"https?://\S+", "<URL>", text or "")      # links are never evidence of a complaint
    # a dash inside a quoted snippet is part of the quote, not a list bullet
    t = re.sub(r'["\u201c][^"\u201d]*["\u201d]', lambda m: m.group(0).replace(" - ", " \u2013 ").replace(" * ", " \u00b7 "), t)
    t = re.sub(r"\s[-*]\s", "\n", t)                       # list bullets -> new clause
    parts = re.split(r"(?<=[.!?])\s+|\n+|(?=\b\d\.\s)", t)
    out: list[str] = []
    for p in parts:
        out.extend(x.strip() for x in SPLIT_CONTRAST.split(p) if x and x.strip(" .,;"))
    return [p.strip() for p in out if p and p.strip()]


def kind(clause: str) -> str:
    if ACK.match(clause):
        return "ack"
    if INSTR_START.match(clause) or INSTR_INLINE.search(clause):
        return "instruction"
    if UNVERIFIED.search(clause):
        return "unverified"
    if POSITIVE.search(clause) and not NEGATIVE.search(STRONG_POSITIVE.sub("", clause)):
        return "positive"
    return "complaint"


def _generic_name(clause: str, name: str) -> bool:
    """Any other field name (from the SOP or schema): written with underscores or spaces, or quoted / 'name:' / 'name field'."""
    spaced = name.replace("_", " ")
    edge = r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])"
    if "_" in name or " " in name:
        return bool(re.search(edge % re.escape(name), clause, re.I) or re.search(edge % re.escape(spaced), clause, re.I))
    w = re.escape(name)
    if (re.search(r"[`'\"*]%s[`'\"*]" % w, clause, re.I) or re.search(r"(?<![A-Za-z0-9_])%s\s*:" % w, clause, re.I)
            or re.search(r"(?<![A-Za-z0-9_])%s\s+(field|column|value)" % w, clause, re.I) or re.search(r"(field|column)\s+%s(?![A-Za-z0-9_])" % w, clause, re.I)):
        return True
    # as the subject of the clause: "Industry should be ...", "The confidence is too high", "name is empty"
    return bool(re.search(r"^\W*(?:the\s+|this\s+|its\s+)?%s\s+(?:(?:[\d.,%%]+|'[^']*'|\"[^\"]*\")\s+)?(?:is|are|was|should|must|needs?|has|have|shows?|says?|looks?|seems?|too|not|does|doesn't|isn't)\b" % w, clause, re.I))


def _scan(note: str, record: dict | None, names: list[str] | None):
    for c in clauses(note):
        if kind(c) != "complaint":
            continue
        for f, (pats, cues) in FIELDS.items():
            if names is not None and f not in names:
                continue
            if f == "headquarters_country" and names is not None and "regions" in names:
                cues = []          # "country" is ambiguous when the record also has regions; only the full name counts
            if any(re.search(p, c, re.I) for p in pats):
                yield f, 0.9, c, "names the field"
            elif any(re.search(q, c, re.I) for q in cues):
                yield f, 0.7, c, "topic cue: " + next(q for q in cues if re.search(q, c, re.I)).replace("\\b", "").replace("\\", "")[:30]
        for f in (names or []):
            if f in FIELDS or not f or f.startswith("_"):
                continue
            if _generic_name(c, f):
                yield f, 0.9, c, "names the field"
        for f, v in (record or {}).items():
            if names is not None and f not in names:
                continue
            # A value inside a longer quoted sentence (an evidence snippet being criticised) is not a complaint about the value itself.
            cq = re.sub(r"[\"\u201c\u2018][^\"\u201d\u2019]{%d,}[\"\u201d\u2019]" % (len(v) + 12), " ", c) if isinstance(v, str) else c
            if isinstance(v, str) and 4 <= len(v) <= 40 and f in VALUE_CUE_FIELDS and re.search(re.escape(v), cq, re.I):
                yield f, 0.75, c, f"quotes the delivered value '{v}'"
            elif isinstance(v, str) and f in ENUM_TOKENS and len(v) >= 4 and re.search(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(v), c, re.I):
                yield f, 0.75, c, f"quotes the delivered value '{v}'"
        for f, toks in ENUM_TOKENS.items():
            if (names is None or f in names) and any(re.search(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % t, c, re.I) for t in toks):
                yield f, 0.7, c, "names one of its allowed values"


def match(note: str, record: dict | None = None, names: list[str] | None = None) -> dict[str, float]:
    """field -> confidence. `names` limits the answer to fields that exist on the record or source."""
    out: dict[str, float] = {}
    for f, sc, _c, _w in _scan(note, record, names):
        out[f] = max(out.get(f, 0), sc)
    return out


def explain(note: str, record: dict | None = None, names: list[str] | None = None) -> dict[str, dict]:
    """field -> {score, clause, why} for every credited field: the sentence that pointed at it and the reason."""
    best: dict[str, dict] = {}
    for f, sc, c, w in _scan(note, record, names):
        if sc >= CREDIT_AT and sc > best.get(f, {}).get("score", 0):
            best[f] = {"score": sc, "clause": c, "why": w}
    return best


DEFAULT_NAMES = list(FIELDS) + ["industry", "confidence", "commodity_id", "name"]


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
        got = set(fields_for(c["note"], c.get("record"), c.get("names") or DEFAULT_NAMES))
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
