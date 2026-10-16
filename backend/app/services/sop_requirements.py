"""Read a source's saved SOP and list, strictly and with quotes, what that source must follow.

Nothing here is guessed. Every rule, field and allowed value comes from the SOP text itself and carries the section
it came from and the exact sentence. Anything the SOP does not settle is reported as a warning, not filled in.
The SOP is whatever Xtrium sent and the platform saved on the source (markdown, required_fields, deliverable_template).
"""
from __future__ import annotations

import ast
import json
import re

MUST_RE = re.compile(r"\b(must|shall|required|mandatory|always|never|only|exactly|do not|don't|must not|cannot|forbidden|prohibited|not allowed|not permitted|at least|at most|no more than|minimum|maximum|one record per|one per)\b", re.I)
SHOULD_RE = re.compile(r"\b(should|recommended|prefer|preferred|avoid|ideally|try to)\b", re.I)
FORBID_RE = re.compile(r"\b(do not|don't|must not|never|cannot|forbidden|prohibited|not allowed|not permitted|avoid|pitfall|reject|wrong|error)\b", re.I)
FORMAT_RE = re.compile(r"(YYYY|ISO ?8601|ISO ?3166|regex|pattern|format|\bUTC\b|T\d\d:\d\d|snake_case|lowercase|uppercase|https?://|trailing slash|no more than \d+|at most \d+|max(imum)? \d+|\d+ characters)", re.I)
ENUM_RE = [
    re.compile(r"(?:one of|allowed values?|accepted values?|valid values?|permitted values?|choose from|either|enum(?:eration)?)\s*[:\-]?\s*(.+)", re.I),
]
COUNT_RE = re.compile(r"\b(at least|at most|exactly|minimum|maximum|no more than|one record per|one per|\d+\s*(?:records?|items?|entries|sentences?))\b", re.I)
PROV_RE = re.compile(r"\b(data_origin|method|curated|manual|ai_generated|llm_extraction|provenance)\b", re.I)
TICK = {"yes", "y", "true", "required", "mandatory", "must", "x", "✓", "✔", "✅", "req", "r"}
UNTICK = {"no", "n", "false", "optional", "-", "—", "✗", "❌", "opt", "o", ""}
SOP_CODE_RE = re.compile(r"SOP[-_ ]?DS[-_ ]?\d{3}", re.I)
FIELD_TICK_RE = re.compile(r"`([A-Za-z_][A-Za-z0-9_\.\[\]]{1,60})`")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _clean(s: str) -> str:
    s = re.sub(r"\*\*|__|`", "", s or "")
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_template(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        for loader in (json.loads, ast.literal_eval):
            try:
                out = loader(value)
                if isinstance(out, dict):
                    return out
            except Exception:
                continue
    return None


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def split_sections(md: str) -> list[dict]:
    """Headings split the SOP into sections. path is the chain of headings, so 'Entity > Fields' is kept together."""
    sections, stack = [], []
    cur = {"id": 0, "level": 0, "title": "Start of the SOP", "path": [], "lines": []}
    in_code = False
    for line in (md or "").replace("\r\n", "\n").split("\n"):
        if line.strip().startswith("```"):
            in_code = not in_code
            cur["lines"].append(line)
            continue
        m = None if in_code else re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            sections.append(cur)
            lvl, title = len(m.group(1)), _clean(m.group(2))
            stack = [(l, t) for l, t in stack if l < lvl] + [(lvl, title)]
            cur = {"id": len(sections), "level": lvl, "title": title, "path": [t for _, t in stack], "lines": []}
        else:
            cur["lines"].append(line)
    sections.append(cur)
    return [s for s in sections if any(l.strip() for l in s["lines"]) or s["level"]]


def _enum_from(text: str) -> list[str]:
    t = text or ""
    ticks = FIELD_TICK_RE.findall(t)
    for rx in ENUM_RE:
        m = rx.search(t)
        if m:
            tail = m.group(1)
            vals = FIELD_TICK_RE.findall(tail)
            if not vals:
                vals = [v.strip(" .;\"'") for v in re.split(r"\s*(?:,|\||/|;|\bor\b)\s*", _clean(tail)) if 0 < len(v.strip(" .;\"'")) <= 40]
            vals = [v for v in vals if v and not v.lower().startswith(("the ", "a ", "an "))]
            if 1 < len(vals) <= 25:
                return vals
    if len(ticks) >= 2 and re.search(r"\b(or|either|one of)\b", t, re.I) and len(t) < 240 and not re.search(r"\b(and then|because)\b", t, re.I):
        return ticks
    return []


def _kind(text: str) -> str:
    if PROV_RE.search(text):
        return "provenance"
    if FORBID_RE.search(text):
        return "forbidden"
    if _enum_from(text):
        return "allowed values"
    if FORMAT_RE.search(text):
        return "format"
    if COUNT_RE.search(text):
        return "count"
    if re.search(r"\b(required|mandatory|must (?:be )?(?:present|filled|include|contain))\b", text, re.I):
        return "required"
    return "rule"


def _rules_in(section: dict) -> tuple[list[dict], list[dict]]:
    """Returns (rules, field specs) found in one section."""
    rules, fields = [], []
    lines = section["lines"]
    i, in_code = 0, False
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        if s.startswith("```"):
            in_code = not in_code
            i += 1
            continue
        if in_code or not s:
            i += 1
            continue
        # table
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]):
            head = [h.lower() for h in _split_row(s)]
            rows = []
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_split_row(lines[i]))
                i += 1
            col = lambda *keys: next((j for j, h in enumerate(head) if any(k in h for k in keys)), None)
            cf, cr, ct, ca, cfm, cd = col("field", "key", "attribute", "column", "property", "name"), col("required", "mandatory", "req", "optional"), col("type"), col("allowed", "values", "enum", "options"), col("format", "pattern"), col("description", "rule", "notes", "note", "meaning", "constraint")
            for row in rows:
                cell = lambda j: _clean(row[j]) if j is not None and j < len(row) else ""
                if cf is not None and cell(cf):
                    name = cell(cf).split()[0].strip("`,:;")
                    if not re.match(r"^[A-Za-z_][A-Za-z0-9_\.\[\]]{0,60}$", name):
                        pass
                    else:
                        req_txt = cell(cr).lower()
                        optional_col = cr is not None and "optional" in head[cr] and "required" not in head[cr]
                        req = (req_txt in TICK) if cr is not None and not optional_col else ((req_txt in UNTICK) and req_txt != "") if optional_col else None
                        quote = " | ".join(_clean(c) for c in row)
                        allowed = [v.strip() for v in re.split(r"\s*[,|/]\s*", cell(ca)) if v.strip()] if ca is not None and cell(ca) else _enum_from(cell(cd))
                        fields.append({"name": name, "required": req, "type": cell(ct) or None, "allowed": allowed, "format": cell(cfm) or None, "rule": cell(cd) or None, "section": section["title"], "quote": quote})
                        if req is True or allowed or cell(cfm):
                            rules.append({"text": quote, "strength": "MUST" if req is True or MUST_RE.search(quote) else "INFO", "kind": "required" if req is True else ("allowed values" if allowed else "format"), "fields": [name], "quote": quote})
                else:
                    quote = " | ".join(_clean(c) for c in row)
                    if MUST_RE.search(quote) or SHOULD_RE.search(quote):
                        rules.append({"text": quote, "strength": "MUST" if MUST_RE.search(quote) else "SHOULD", "kind": _kind(quote), "fields": FIELD_TICK_RE.findall(" ".join(row)), "quote": quote})
            continue
        # bullet or paragraph line
        text = _clean(re.sub(r"^([-*+]|\d+[.)])\s+", "", s))
        m = re.match(r"^`?([A-Za-z_][A-Za-z0-9_\.]{1,60})`?\s*(?:\(([^)]*)\))?\s*[:\-–—]\s*(.+)$", re.sub(r"^([-*+]|\d+[.)])\s+", "", s).replace("**", ""))
        if m and "_" in m.group(1) or (m and FIELD_TICK_RE.match(re.sub(r"^([-*+]|\d+[.)])\s+", "", s).replace("**", ""))):
            nm, tag, rest = m.group(1), (m.group(2) or ""), m.group(3)
            req = True if re.search(r"\brequired\b|\bmandatory\b|\bmust\b", tag + " " + rest, re.I) else (False if re.search(r"\boptional\b", tag + " " + rest, re.I) else None)
            allowed = _enum_from(rest)
            fields.append({"name": nm, "required": req, "type": None, "allowed": allowed, "format": None, "rule": _clean(rest), "section": section["title"], "quote": text})
        if len(text) >= 12 and (MUST_RE.search(text) or SHOULD_RE.search(text)):
            for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z`*])", text):
                sent = sent.strip()
                if len(sent) >= 12 and (MUST_RE.search(sent) or SHOULD_RE.search(sent)):
                    rules.append({"text": sent, "strength": "MUST" if MUST_RE.search(sent) else "SHOULD", "kind": _kind(sent), "fields": FIELD_TICK_RE.findall(sent), "quote": sent})
        i += 1
    return rules, fields


def _template_keys(md: str) -> list[str]:
    """JSON code blocks in the SOP: the keys of a deliverable skeleton."""
    out = []
    for blk in re.findall(r"```(?:json)?\s*\n(.*?)```", md or "", flags=re.S):
        try:
            j = json.loads(blk)
        except Exception:
            continue
        stack = [j]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                for k, v in x.items():
                    if k not in out:
                        out.append(k)
                    stack.append(v)
            elif isinstance(x, list):
                stack.extend(x[:3])
    return out


def build(source) -> dict:
    """The full requirement set for one source. `source` is a Source row (needs name, category, xtrium_sop)."""
    saved = source.xtrium_sop if isinstance(getattr(source, "xtrium_sop", None), dict) else {}
    sop = saved.get("sop") if isinstance(saved.get("sop"), dict) else {}
    meta = saved.get("meta") if isinstance(saved.get("meta"), dict) else {}
    md = sop.get("markdown") or ""
    entity = sop.get("entity") or meta.get("target_entity") or sop.get("target_entity") or None
    category = (getattr(source, "category", None) or "").strip() or None
    code = sop.get("sop_code") or meta.get("sop_code")
    required = [f for f in (sop.get("required_fields") or meta.get("required_fields") or []) if isinstance(f, str) and f.strip()]
    tmpl = parse_template(sop.get("deliverable_template"))
    derived = [f for f in (sop.get("derived_fields") or []) if isinstance(f, str)]
    md_keys = _template_keys(md)
    out = {"source_id": source.id, "name": source.name, "category": category, "entity": entity, "sop_code": code, "title": sop.get("title"), "spec_version": sop.get("spec_version"),
           "has_sop": bool(sop or meta), "has_markdown": bool(md), "required_fields": required, "template_keys": list(dict.fromkeys((list(tmpl) if tmpl else []) + md_keys)), "derived_fields": derived,
           "fields": [], "sections": [], "warnings": [], "counts": {}}
    w = out["warnings"]
    if not (sop or meta):
        w.append("No SOP is saved for this source, so nothing can be checked against it. Open the source and fetch its SOP from Xtrium.")
        return out
    if not md:
        w.append("The saved SOP has no text (markdown), only the summary. The rules below come from the required-field list alone.")
    if not required:
        w.append("The SOP lists no required fields.")
    if not category:
        w.append("This source has no category, so sections cannot be matched to it. Set the category on the source.")
    if not entity:
        w.append("The SOP does not say which entity it describes (for example MarketSegment or Regulation).")
    if not out["spec_version"]:
        w.append("No SOP version is saved, so a version difference between delivery and review cannot be detected.")
    keys = [k for k in {_norm(category or ""), _norm(entity or "")} if k]
    # also the singular and spaced forms of the words in the category
    words = [_norm(x) for x in re.split(r"[\s/,&>_-]+", (category or "") + " " + (entity or "")) if len(x) >= 4]
    secs = split_sections(md) if md else []
    all_fields: dict = {}
    must_total = 0
    for sec in secs:
        rules, fields = _rules_in(sec)
        # The document title (the single top heading) names the whole SOP, so it must not make every section "match".
        own = sec["path"][1:] if sec["path"] and sec["level"] > 1 and secs and secs[0]["level"] in (0, 1) and len({x["path"][0] for x in secs if x["path"]}) == 1 else sec["path"]
        text_norm = _norm(" ".join(own))
        matches = bool(keys and any(k in text_norm for k in keys)) or bool(words and any(x in text_norm for x in words))
        if rules or fields:
            out["sections"].append({"id": sec["id"], "title": sec["title"], "path": sec["path"], "level": sec["level"], "matches": matches, "rules": rules})
            must_total += sum(1 for r in rules if r["strength"] == "MUST")
        for f in fields:
            f["matches"] = matches
            cur = all_fields.get(f["name"])
            if not cur or (matches and not cur.get("matches")) or (f["required"] and not cur.get("required")):
                if cur:
                    f["allowed"] = f["allowed"] or cur["allowed"]
                    f["rule"] = f["rule"] or cur["rule"]
                    f["type"] = f["type"] or cur["type"]
                    f["format"] = f["format"] or cur["format"]
                all_fields[f["name"]] = f
    # A rule is enforced strictly when it belongs to this source's section, to a general section, to the structured
    # required list, or when the SOP has no section for this category at all. A rule that sits only under another
    # category's heading is shown but not enforced on this source.
    general_like = re.compile(r"general|global|common|all (sources|records|entities)|every record|appendix|provenance|format|shared|universal|overview|conventions?", re.I)
    any_match = any(sx["matches"] for sx in out["sections"])
    title_of = {sx["title"]: sx for sx in out["sections"]}
    for f in all_fields.values():
        f["enforce"] = bool(f.get("matches") or not any_match or general_like.search(f.get("section") or "") or f["name"] in required)
    # the structured required list always wins for "required"
    for n in required:
        f = all_fields.setdefault(n, {"name": n, "required": True, "type": None, "allowed": [], "format": None, "rule": None, "section": None, "quote": "Listed in the SOP's required fields", "matches": True, "enforce": True})
        f["required"] = True
    for n in (tmpl or {}):
        all_fields.setdefault(n, {"name": n, "required": n in required, "type": None, "allowed": [], "format": None, "rule": None, "section": None, "quote": "Listed in the SOP's deliverable template", "matches": True, "enforce": True})
    out["fields"] = sorted(all_fields.values(), key=lambda f: (not f["required"], f["name"]))
    if md and keys and not any(s["matches"] for s in out["sections"]):
        w.append(f"No section of this SOP names '{category or entity}'. Only the general rules are listed. Confirm with Xtrium which section applies before judging this source strictly.")
    if code and md:
        found = {re.sub(r"[ _]", "-", c.upper()) for c in SOP_CODE_RE.findall(md)}
        want = re.sub(r"[ _]", "-", str(code).upper())
        other = sorted(c for c in found if c != want)
        if other and want not in found:
            w.append(f"The saved code is {code} but the SOP text names {', '.join(other)}. The wrong SOP may be attached.")
        elif other:
            out["related_sops"] = other
    if md and required:
        in_md = {n for n in required if re.search(rf"\b{re.escape(n)}\b", md)}
        gone = [n for n in required if n not in in_md]
        if gone:
            w.append(f"Required by the field list but never explained in the SOP text: {', '.join(gone)}.")
    if tmpl and required:
        notin = [n for n in required if n not in tmpl]
        if notin:
            w.append(f"Required but missing from the deliverable template: {', '.join(notin)}.")
    for f in out["fields"]:
        if f["allowed"] and f["format"]:
            pass
    out["counts"] = {"sections": len(out["sections"]), "matching_sections": sum(1 for s in out["sections"] if s["matches"]), "rules": sum(len(s["rules"]) for s in out["sections"]), "must_rules": must_total,
                     "fields": len(out["fields"]), "required_fields": sum(1 for f in out["fields"] if f["required"]), "fields_with_allowed_values": sum(1 for f in out["fields"] if f["allowed"]),
                     "warnings": len(w)}
    return out


def field_specs(req: dict) -> dict:
    """name -> spec, for the audit's strict checks."""
    return {f["name"]: f for f in req.get("fields", []) if f.get("enforce", True)}
