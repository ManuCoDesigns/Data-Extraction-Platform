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


NOT_FIELD_SECTIONS = re.compile(r"normali[sz]ation|convention|strict value|quality rules?|acceptance|pitfall|modality|pre-?filled|evidence from|guidance|scope|how to extract|typical sources", re.I)
NESTED_RE = re.compile(r"^`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\((?:array|list|object|nested)\b", re.I)
RANGE_RE = re.compile(r"range:\s*(-?[\d.]+|-?inf)\s*to\s*\+?(-?[\d.]+|\+?inf)", re.I)


def split_allowed(cell: str) -> tuple[list[str], str | None]:
    """The 'Allowed values / format' cell: an enum only when it is a 'one of' list (or a plain list of single tokens).
    Anything else (ranges, ISO formats, units) is a format, never a list of allowed values."""
    t = _clean(cell or "")
    if not t:
        return [], None
    m = re.match(r"^(?:one of|allowed values?|accepted values?|valid values?|enum(?:eration)?)\s*[:\-]?\s*(.+)$", t, re.I)
    if m:
        vals = [v.strip(" .;\"'`") for v in re.split(r"\s*[,|;]\s*", m.group(1)) if v.strip(" .;\"'`")]
        if vals:
            return vals, None
    parts = [v.strip(" .;\"'`") for v in re.split(r"\s*[,|]\s*", t)]
    if len(parts) >= 2 and all(re.fullmatch(r"[A-Za-z0-9_\-\.]{1,40}", v) for v in parts) and not re.search(r"(YYYY|ISO|range|unit)", t, re.I):
        return parts, None
    return [], t


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
            cf, cr, ct, ca, cfm, cd = col("field", "key", "attribute", "column", "property", "name"), col("required", "mandatory", "req", "optional", "need"), col("type"), col("allowed", "values", "enum", "options"), col("format", "pattern"), col("description", "rule", "notes", "note", "meaning", "constraint")
            for row in rows:
                cell = lambda j: _clean(row[j]) if j is not None and j < len(row) else ""
                if cf is not None and cell(cf):
                    name = cell(cf).split()[0].strip("`,:;")
                    if not re.match(r"^[A-Za-z_][A-Za-z0-9_\.\[\]]{0,60}$", name):
                        pass
                    else:
                        req_txt = cell(cr).lower()
                        optional_col = cr is not None and "optional" in head[cr] and "required" not in head[cr]
                        need_col = cr is not None and "need" in head[cr]
                        req = (req_txt in TICK) if cr is not None and not optional_col else ((req_txt in UNTICK) and req_txt != "") if optional_col else None
                        if need_col:
                            req = req_txt == "required"
                        quote = " | ".join(_clean(c) for c in row)
                        if ca is not None and cell(ca):
                            allowed, fmt_txt = split_allowed(cell(ca))
                        else:
                            allowed, fmt_txt = _enum_from(cell(cd)), None
                        fmt_txt = cell(cfm) or fmt_txt
                        mnest = NESTED_RE.match(section["title"] or "")
                        nm_full = f"{mnest.group(1)}[].{name}" if mnest else name
                        fields.append({"name": nm_full, "field": name, "block": mnest.group(1) if mnest else None, "nested": bool(mnest), "need": req_txt if need_col else None,
                                       "required": req, "type": cell(ct) or None, "allowed": allowed, "format": fmt_txt or None, "rule": cell(cd) or None, "section": section["title"], "quote": quote})
                        if req is True or allowed or fmt_txt:
                            rules.append({"text": quote, "strength": "MUST" if req is True or MUST_RE.search(quote) else "INFO", "kind": "required" if req is True else ("allowed values" if allowed else "format"), "fields": [name], "quote": quote})
                else:
                    quote = " | ".join(_clean(c) for c in row)
                    if MUST_RE.search(quote) or SHOULD_RE.search(quote):
                        rules.append({"text": quote, "strength": "MUST" if MUST_RE.search(quote) else "SHOULD", "kind": _kind(quote), "fields": FIELD_TICK_RE.findall(" ".join(row)), "quote": quote})
            continue
        # bullet or paragraph line
        text = _clean(re.sub(r"^([-*+]|\d+[.)])\s+", "", s))
        m = re.match(r"^`?([A-Za-z_][A-Za-z0-9_\.]{1,60})`?\s*(?:\(([^)]*)\))?\s*[:\-–—]\s*(.+)$", re.sub(r"^([-*+]|\d+[.)])\s+", "", s).replace("**", ""))
        if not NOT_FIELD_SECTIONS.search(section["title"] or "") and (m and "_" in m.group(1) or (m and FIELD_TICK_RE.match(re.sub(r"^([-*+]|\d+[.)])\s+", "", s).replace("**", "")))):
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


def _template_shape(md: str, extra=None) -> tuple[list[str], dict]:
    """JSON skeletons in the SOP: (top-level keys, {list-of-objects key: its inner keys}). Keys that only exist inside a
    list such as facilities[] or products[] are not top-level fields of the record."""
    top: list[str] = []
    blocks: dict = {}
    docs = []
    for blk in re.findall(r"```(?:json)?\s*\n(.*?)```", md or "", flags=re.S):
        try:
            docs.append(json.loads(blk))
        except Exception:
            continue
    if isinstance(extra, dict):
        docs.append(extra)
    for j in docs:
        if not isinstance(j, dict):
            continue
        for k, v in j.items():
            if k not in top:
                top.append(k)
            inner = v[0] if isinstance(v, list) and v and isinstance(v[0], dict) else (v if isinstance(v, dict) and v else None)
            if inner is not None:
                blocks.setdefault(k, set()).update(inner.keys())
    return top, blocks


def _template_keys(md: str) -> list[str]:
    """The keys of a deliverable skeleton: the top level, plus the names of its lists (not the keys inside them)."""
    return _template_shape(md)[0]


def build(source, origin: str | None = None, live_error: str | None = None) -> dict:
    """The full requirement set for one source. `source` is a Source row (needs name, category, xtrium_sop)."""
    saved = source.xtrium_sop if isinstance(getattr(source, "xtrium_sop", None), dict) else {}
    sop = saved.get("sop") if isinstance(saved.get("sop"), dict) else {}
    meta = saved.get("meta") if isinstance(saved.get("meta"), dict) else {}
    md = sop.get("markdown") or ""
    entity = sop.get("entity") or meta.get("target_entity") or sop.get("target_entity") or None
    if not entity and md:
        me = re.search(r"(?:target\s+)?entity\s*[:\-]\s*`?([A-Za-z][A-Za-z0-9_]+)", md, re.I) or re.search(r"SOP-KG-([A-Z0-9]+)-DS\d{3}", md)
        entity = me.group(1) if me else None
    spec_v = sop.get("spec_version") or meta.get("spec_version")
    if not spec_v and md:
        mv = re.search(r"spec(?:ification)?\s+version\s*[:\-]?\s*v?(\d+(?:\.\d+)+)", md, re.I)
        spec_v = mv.group(1) if mv else None
    category = (getattr(source, "category", None) or "").strip() or None
    code = sop.get("sop_code") or meta.get("sop_code")
    required = [f for f in (sop.get("required_fields") or meta.get("required_fields") or []) if isinstance(f, str) and f.strip()]
    tmpl = parse_template(sop.get("deliverable_template"))
    derived = [f for f in (sop.get("derived_fields") or []) if isinstance(f, str)]
    md_keys = _template_keys(md)
    # Keys that exist only inside a list (facilities[].name, products[].product_name) are not required on the record itself,
    # even when a sub-heading or Xtrium's flat list names them.
    top_keys, tblocks = _template_shape(md, tmpl if isinstance(tmpl, dict) else None)
    inner_of: dict = {}
    for bk, ks in tblocks.items():
        for k in ks:
            if k not in top_keys:
                inner_of.setdefault(k, bk)
    if inner_of:
        required = [f for f in required if f not in inner_of]
    out = {"source_id": source.id, "name": source.name, "category": category, "entity": entity, "sop_code": code, "title": sop.get("title"), "spec_version": spec_v,
           "has_sop": bool(sop or meta), "has_markdown": bool(md), "required_fields": required, "template_keys": list(dict.fromkeys((list(tmpl) if tmpl else []) + md_keys)), "derived_fields": derived,
           "fields": [], "sections": [], "warnings": [], "counts": {},
           "origin": origin or ("saved" if sop else "none"), "saved_at": saved.get("saved_at"), "live_error": live_error, "from_xtrium": bool(getattr(source, "external_ref_id", None))}
    w = out["warnings"]
    if not (sop or meta):
        if not out["from_xtrium"]:
            w.append("This source was not pulled from Xtrium, so it has no Xtrium SOP to check against.")
        elif live_error:
            w.append(f"No SOP could be loaded from Xtrium for this source ({live_error}). Try Refresh from Xtrium in a minute.")
        else:
            w.append("No SOP was saved on this source when it was pulled from Xtrium. Use Refresh from Xtrium once to fetch it. After that it is kept here.")
        return out
    if live_error and out["origin"] == "saved":
        w.append(f"Xtrium could not be reached ({live_error}). This is the copy saved on {str(out['saved_at'] or 'an earlier date')[:16].replace('T', ' ')}. It may be out of date.")
    out["stale"] = False
    out["no_contract"] = False
    # A source that was reclassified (for example MarketSegment to Organization) but still carries the old SOP, or a SOP whose code
    # and text disagree on the version, was probably saved before a sync changed it. Checks against it would be wrong.
    if category and entity and re.fullmatch(r"[A-Z][A-Za-z0-9]+", category.strip()) and _norm(category) != _norm(entity):
        out["stale"] = True
        w.append(f"The source is classified {category}, but the saved SOP is for {entity}. It was probably saved before the source was reclassified. Use Refresh from Xtrium, then run the checks again.")
    cv = re.search(r"-v(\d+(?:\.\d+)+)\s*$", str(code or ""))
    if cv and spec_v and cv.group(1).strip() != str(spec_v).strip().lstrip("v"):
        out["stale"] = True
        w.append(f"The SOP code says v{cv.group(1)} but its text says version {spec_v}. The saved copy and its code are from different versions. Use Refresh from Xtrium.")
    if (entity and _norm(entity) == "unclassified") or (not entity and category and _norm(category) == "unclassified") or re.search(r"no\s+(deliverable\s+)?(schema\s+)?contract", md or "", re.I):
        out["no_contract"] = True
        w.append("This source is Unclassified: no deliverable contract applies, so there are no required fields and no schema checks. Do not mark fields Wrong on schema grounds. Ask the lead which entity type the records should follow.")
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
    for nm in [n for n in list(all_fields) if n in inner_of and not all_fields[n].get("nested")]:
        f = all_fields.pop(nm)
        bk = inner_of[nm]
        f.update({"name": f"{bk}[].{nm}", "field": nm, "block": bk, "nested": True})
        all_fields.setdefault(f["name"], f)
    out["fields"] = sorted(all_fields.values(), key=lambda f: (not f["required"], f["name"]))
    if md and keys and not any(s["matches"] for s in out["sections"]):
        w.append(f"No section of this SOP names '{category or entity}'. Only the general rules are listed. Confirm with Xtrium which section applies before judging this source strictly.")
    if code and md:
        found = {re.sub(r"[ _]", "-", c.upper()) for c in SOP_CODE_RE.findall(md)}
        want = re.sub(r"[ _]", "-", str(code).upper())
        ds = re.search(r"DS[-_ ]?(\d{3})", want)
        domain = f"SOP-DS-{ds.group(1)}" if ds else None
        other = sorted(c for c in found if c != want and c != domain and not want.startswith(c))
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
    om = re.search(r"omit these:\s*([A-Za-z0-9_,\s]+?)\.", md or "", re.I)
    out["omit_fields"] = [x.strip() for x in om.group(1).split(",") if x.strip()] if om else []
    out["counts"] = {"sections": len(out["sections"]), "matching_sections": sum(1 for s in out["sections"] if s["matches"]), "rules": sum(len(s["rules"]) for s in out["sections"]), "must_rules": must_total,
                     "fields": len(out["fields"]), "required_fields": sum(1 for f in out["fields"] if f["required"] and not f.get("nested")), "fields_with_allowed_values": sum(1 for f in out["fields"] if f["allowed"]),
                     "warnings": len(w)}
    return out


def field_specs(req: dict) -> dict:
    """name -> spec, for the audit's strict checks."""
    return {f["name"]: f for f in req.get("fields", []) if f.get("enforce", True) and not f.get("nested")}


def block_specs(req: dict) -> dict:
    """block -> {field: spec} for nested arrays such as price_points. Only checked when the record has that block."""
    out: dict = {}
    for f in req.get("fields", []):
        if f.get("nested") and f.get("enforce", True) and f.get("block"):
            out.setdefault(f["block"], {})[f["field"]] = f
    return out


_ENTITY = re.compile(r"[A-Z][A-Za-z0-9]+")


def follow_category(source, commit: bool = True) -> str | None:
    """The SOP Xtrium attached is the authority on what a source is. When the saved SOP is for a real entity and the
    source's category is empty, Unclassified or another entity name, the category follows the SOP, so nobody has to
    re-classify sources by hand after Xtrium does. Free-text categories (for example "Critical minerals") are left alone.
    Returns the old category when it changed, else None. No network call is made."""
    saved = getattr(source, "xtrium_sop", None)
    sop = saved.get("sop") if isinstance(saved, dict) else None
    if not isinstance(sop, dict):
        return None
    meta = saved.get("meta") if isinstance(saved.get("meta"), dict) else {}
    entity = str(sop.get("entity") or meta.get("target_entity") or "").strip()
    if not entity or not _ENTITY.fullmatch(entity) or _norm(entity) == "unclassified":
        return None
    cur = (getattr(source, "category", None) or "").strip()
    if cur and _norm(cur) == _norm(entity):
        return None
    if cur and _norm(cur) != "unclassified" and not _ENTITY.fullmatch(cur):
        return None
    old = cur or None
    source.category = entity
    if commit:
        try:
            from sqlalchemy.orm import object_session
            db = object_session(source)
            if db is not None:
                db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            source.category = old
            return None
    return old or ""

