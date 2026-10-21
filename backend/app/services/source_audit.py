"""Source audit: check every field of a source's records against the live pages, using the SOP rules.

This is the written audit algorithm (Nimble-based QA of MarketSegment / Regulation records) as code. It is deterministic:
no model decides a verdict. Each field gets CORRECT, WRONG or HOLD with a quoted proof.

Hard rules kept here
- WRONG always carries a "source_says" value and a quoted proof, and never comes from a failed fetch (that is HOLD).
- Anything that depends on an SOP version we do not hold, or is only a weak match, is HOLD, never WRONG.
- What could not be scanned is reported as a gap, never as "clean".
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.services import quality as q

CORRECT, WRONG, HOLD = "CORRECT", "WRONG", "HOLD"
PAIRS = {"curated": "manual", "ai_generated": "llm_extraction"}
SKIP = set(q.SKIP_FIELDS) | {"evidence_sentence"}
HANDLED = {"evidence", "segment_name", "data_origin", "method", "retrieved_at", "source_url", "regions"}
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MORE_RE = re.compile(r"\b(view more|show more|load more|see more|read more|subscribe to (read|continue)|sign in to (view|continue)|log in to (view|continue))\b", re.I)
JOINER_RE = re.compile(r"\s[–—-]\s|:\s+|\s\|\s")
SERVICE_RE = re.compile(r"\b(management|platform|software|solutions?|services?|consulting|analytics|intelligence|monitoring|database|marketplace|compliance|tools?|supply chain risk)\b", re.I)
PRODUCT_RE = re.compile(r"\b(inverters?|chips?|modules?|panels?|vehicles?|engines?|laptops?|phones?|turbines?|chargers?|sensors?)\b", re.I)
SECTORS = {"energy", "mining", "metals", "minerals", "industrials", "materials", "technology", "manufacturing", "chemicals", "automotive", "agriculture", "healthcare", "finance", "transport", "construction", "electronics", "semiconductors"}
KNOWN_PLATFORMS = {"panjiva", "pubmed", "the lens", "lens", "resilinc", "ecovadis", "google patents", "orbis", "bloomberg", "refinitiv", "sayari", "dun & bradstreet", "d&b", "everstream", "sphera", "interos"}
COMMODITIES = [
    "lithium", "cobalt", "nickel", "copper", "aluminum", "aluminium", "zinc", "tungsten", "titanium", "titanium sponge", "vanadium", "manganese", "chromium", "graphite", "silicon",
    "gallium", "germanium", "indium", "antimony", "bismuth", "tellurium", "selenium", "arsenic", "beryllium", "magnesium", "molybdenum", "niobium", "tantalum", "zirconium", "hafnium",
    "rare earth", "rare earths", "neodymium", "dysprosium", "terbium", "praseodymium", "yttrium", "scandium", "cerium", "lanthanum", "platinum", "palladium", "rhodium", "iridium", "ruthenium",
    "silver", "gold", "iron ore", "steel", "bauxite", "alumina", "uranium", "fluorspar", "phosphate", "potash", "helium", "coking coal", "cobalt sulfate", "lithium carbonate", "lithium hydroxide",
]
SERVICE_WORD_RE = SERVICE_RE


# ---------------------------------------------------------------- text helpers
def clean_page(t: str) -> str:
    """Drop scripts, styles, JSON-LD and link markup, then collapse whitespace. Dashes and quotes stay as printed."""
    t = t or ""
    t = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", " ", t, flags=re.S | re.I)
    t = re.sub(r"\{\s*\"@context\".*?\}\s*(?=\n|$)", " ", t, flags=re.S)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()


def flat(t: str) -> str:
    return re.sub(r"\s+", " ", t or "").strip()


def fold(t: str) -> str:
    """Only for explaining a near match: en and em dashes become hyphens, curly quotes become straight."""
    t = flat(t).replace("–", "-").replace("—", "-").replace("‑", "-").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace(" ", " ")
    return t.lower()


def sentences(text: str) -> list[str]:
    out = []
    for chunk in re.split(r"\n+", text or ""):
        for s in re.split(r"(?<=[.!?])\s+", chunk):
            s = flat(s)
            if len(s) >= 25:
                out.append(s)
    return out


def best_sentence(value: str, text: str) -> str | None:
    """The sentence on the page that shares the most words with the value. Used as the proof for a miss."""
    toks = {w for w in re.findall(r"[a-z0-9]{4,}", fold(value))}
    if not toks:
        return None
    best, score = None, 0
    for s in sentences(text):
        n = len(toks & set(re.findall(r"[a-z0-9]{4,}", fold(s))))
        if n > score:
            best, score = s, n
    return best[:400] if best and score >= max(2, len(toks) // 3) else None


def quote_around(text: str, needle: str, width: int = 140) -> str | None:
    i = flat(text).lower().find(flat(needle).lower())
    if i < 0:
        return None
    f = flat(text)
    return f[max(0, i - 40): i + len(needle) + width].strip()


def norm_url(u: str) -> str:
    p = urlparse((u or "").strip())
    host = (p.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    return f"{host}{p.path.rstrip('/')}" + (f"?{p.query}" if p.query else "")


def _is_midnight(v) -> bool:
    return isinstance(v, str) and v.endswith("T00:00:00Z")


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _region_names(v) -> list[str]:
    out = []
    for x in (v if isinstance(v, list) else [v] if v else []):
        if isinstance(x, dict):
            n = x.get("name") or x.get("region")
            if n:
                out.append(str(n))
        elif x not in (None, ""):
            out.append(str(x))
    return out


# ---------------------------------------------------------------- verdict builder
def _v(field, delivered, verdict, kind=None, source_says=None, comment="", proof=None, pattern="", sop_rule=None):
    return {"field": field, "delivered": delivered, "verdict": verdict, "error_kind": kind if verdict == WRONG else None, "source_says": source_says, "comment": comment,
            "proof": proof, "pattern": pattern, "sop_rule": sop_rule}


def _unavailable(field, delivered, why):
    return _v(field, delivered, HOLD, comment=f"Could not verify: {why}", pattern="no_page")


# ---------------------------------------------------------------- field checks
def check_evidence(val, url, pages, other_pages) -> dict:
    ev = flat(_s(val))
    pg = pages.get(url)
    if not ev:
        return _v("evidence", val, HOLD, comment="Evidence is empty. Nothing to check.", pattern="empty")
    if not pg or not pg["ok"]:
        return _unavailable("evidence", val, (pg or {}).get("error") or "the cited page was not fetched.")
    page = flat(pg["clean"])
    if ev in page:
        return _v("evidence", val, CORRECT, comment="The sentence is on the cited page word for word.", proof={"url": url, "quote": quote_around(page, ev, 0) or ev})
    if fold(ev) in fold(page):
        return _v("evidence", val, CORRECT, comment="Only dashes or quote marks differ from the page. Worth a comment, not an error.", proof={"url": url, "quote": ev}, pattern="char_diff")
    parts = [flat(p) for p in JOINER_RE.split(ev) if len(flat(p)) >= 12]
    if len(parts) >= 2 and all(p in page or fold(p) in fold(page) for p in parts):
        first = next((x for x in sentences(pg["clean"]) if fold(parts[0]) in fold(x)), None) or quote_around(page, parts[0], 120) or parts[0]
        return _v("evidence", val, WRONG, "sop_rule", source_says=first, pattern="evidence_joiner", sop_rule="evidence is one verbatim sentence from the page",
                  comment="The evidence glues two separate pieces of the page together with a joiner that is not printed there. Use one real sentence, as printed.",
                  proof={"url": url, "quote": " … ".join(quote_around(page, p, 60) or p for p in parts[:2])})
    for u, o in other_pages.items():
        if u != url and o["ok"] and ev in flat(o["clean"]):
            near = best_sentence(ev, pg["clean"])
            return _v("evidence", val, WRONG, "unsupported_value", source_says=near or "No sentence on the cited page supports this.", pattern="evidence_other_page",
                      comment=f"This sentence is real, but it is on a different page: {u}. The cited page does not say it.", proof={"url": u, "quote": quote_around(o["clean"], ev, 0) or ev})
    if MORE_RE.search(page) or len(page) < 400:
        return _v("evidence", val, HOLD, comment="The page looks incomplete (a View more, a sign-in wall, or very little text), so the sentence could not be proven or disproven. Open the page and expand it.", pattern="truncated")
    near = best_sentence(ev, pg["clean"])
    return _v("evidence", val, WRONG, "unsupported_value", source_says=near or "No sentence on the cited page supports this value.", pattern="evidence_missing",
              comment="This sentence is not on the cited page, and it was not found on the other pages that were read.", proof={"url": url, "quote": near or "(no close sentence on the page)"})


KIND_COMPLAINT = re.compile(r"platform|market segment|trading category|real segment|not a (real )?segment|pre-?filled|trade[- ]intelligence", re.I)


def check_segment(val, rec_fields, source_name, website, pages, url, dup_count) -> dict:
    name = flat(_s(val))
    rule = "a MarketSegment is a commodity or industrial market trading category, not a platform, service or finished product"
    if not name:
        return _v("segment_name", val, HOLD, comment="segment_name is empty.", pattern="empty")
    low = name.lower()
    stem = (urlparse(website or "").hostname or "").lower().replace("www.", "").split(".")[0]
    src = (source_name or "").lower()
    if low in KNOWN_PLATFORMS or (stem and low == stem) or (src and (low == src or low in src.split())):
        return _v("segment_name", val, WRONG, "sop_rule", source_says=f"'{name}' is the name of a platform or company, not a commodity or market segment.", pattern="segment_platform", sop_rule=rule,
                  comment=f"SOP: {rule}. Replace it with the commodities the site actually names.", proof={"url": url, "quote": f"{name} is the name of the platform or company"})
    if SERVICE_RE.search(name):
        return _v("segment_name", val, WRONG, "sop_rule", source_says=f"'{name}' is a service or product the site sells, not a commodity.", pattern="segment_service", sop_rule=rule,
                  comment=f"SOP: {rule}. Replace it with commodity records named on the site.", proof={"url": url, "quote": f"{name}: a service, not a traded commodity"})
    if low in SECTORS:
        return _v("segment_name", val, HOLD, comment="This is a broad sector, and it may overlap the commodity records. Ask whether a sector is allowed as a parent segment before calling it wrong.", pattern="segment_broad")
    if PRODUCT_RE.search(name):
        return _v("segment_name", val, HOLD, comment="This looks like a finished product or component, not a commodity. Check the SOP wording before calling it wrong.", pattern="segment_product")
    if dup_count >= 2:
        return _v("segment_name", val, WRONG, "duplicate", source_says=f"'{name}' appears on {dup_count} records of this source. One record per segment.", pattern="segment_duplicate", sop_rule="one record per distinct segment",
                  comment="The same segment is split into several records. Keep one record per segment.", proof={"url": url, "quote": f"{dup_count} records named {name}"})
    pg = pages.get(url)
    if not pg or not pg["ok"]:
        return _unavailable("segment_name", val, (pg or {}).get("error") or "the cited page was not fetched.")
    hit = q.find_in_text(name, pg["clean"])
    if hit["state"] in ("found", "close"):
        return _v("segment_name", val, CORRECT, comment="The name is on the cited page, and it passed the kind checks (not a platform, service, product, duplicate or broad sector). Being on the page only proves the text is there.", proof={"url": url, "quote": hit["snippet"] or name}, pattern="segment_on_page")
    allt = " ".join(p["clean"] for p in pages.values() if p["ok"])
    if q.find_in_text(name, allt)["state"] in ("found", "close"):
        return _v("segment_name", val, HOLD, comment="It is named on another page of the site but not on the cited page. Fix the cited page or the evidence.", pattern="segment_other_page")
    if MORE_RE.search(pg["clean"]) or len(pg["clean"]) < 400:
        return _v("segment_name", val, HOLD, comment="The page looks incomplete, so the segment could not be proven. Open the page and expand it.", pattern="truncated")
    return _v("segment_name", val, WRONG, "unsupported_value", source_says="The segment is not named on the cited page.", pattern="segment_missing", comment="The value is not on the cited page.",
              proof={"url": url, "quote": best_sentence(name, pg["clean"]) or "(not on the page)"})


def check_provenance(rf) -> list[dict]:
    o, m = _s(rf.get("data_origin")), _s(rf.get("method"))
    if not o and not m:
        return []
    if o in PAIRS and m in PAIRS.values():
        ok = PAIRS[o] == m
    else:
        ok = None
    out = []
    for f, v in (("data_origin", o), ("method", m)):
        if f not in rf:
            continue
        if ok is True:
            out.append(_v(f, rf.get(f), CORRECT, comment=f"{o} goes with {m}. The pair is consistent."))
        elif ok is False:
            want = PAIRS[o] if f == "method" else next((k for k, vv in PAIRS.items() if vv == m), "curated")
            out.append(_v(f, rf.get(f), WRONG, "sop_rule", source_says=f"Pair rule: curated goes with manual, ai_generated goes with llm_extraction. Here {o} is paired with {m}.", pattern="provenance_pair",
                          sop_rule="data_origin and method must be a matching pair", comment=f"data_origin and method disagree. Expected {want} here, or change the other field to match.",
                          proof={"url": None, "quote": f"data_origin={o}, method={m}"}))
        else:
            out.append(_v(f, rf.get(f), HOLD, comment="Not one of the known values (curated, manual, ai_generated, llm_extraction). Check the SOP version in force.", pattern="provenance_unknown"))
    return out


def check_retrieved(val, all_vals, now) -> dict:
    v = _s(val)
    if not v:
        return _v("retrieved_at", val, HOLD, comment="retrieved_at is empty.", pattern="empty")
    fmt = "YYYY-MM-DDTHH:MM:SSZ"
    if not TS_RE.match(v):
        return _v("retrieved_at", val, WRONG, "format", source_says=f"Must look like {fmt}, with the real retrieval time.", pattern="ts_shape", sop_rule=f"retrieved_at uses {fmt}",
                  comment=f"Not in the required shape ({fmt}). A date only, a missing Z or another shape is not accepted.", proof={"url": None, "quote": v})
    try:
        t = datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return _v("retrieved_at", val, WRONG, "format", source_says="That is not a real date and time.", pattern="ts_shape", comment="Not a valid date or time.", proof={"url": None, "quote": v})
    if t > now:
        return _v("retrieved_at", val, WRONG, "format", source_says="A retrieval time cannot be in the future.", pattern="ts_future", comment="This time is in the future.", proof={"url": None, "quote": v})
    same = sum(1 for x in all_vals if x == v)
    if _is_midnight(v) and (len(all_vals) >= 2 and all(_is_midnight(x) for x in all_vals if x)):
        return _v("retrieved_at", val, HOLD, comment="Every record of this source has T00:00:00Z. It is a valid timestamp, so this is not an SOP error, but it may be a placeholder. Worth a comment: ask for the real retrieval time.", pattern="ts_placeholder")
    if len(all_vals) >= 3 and same == len(all_vals):
        return _v("retrieved_at", val, HOLD, comment="Every record has the identical time. It may be a placeholder. Compare with the work log.", pattern="ts_identical")
    return _v("retrieved_at", val, CORRECT, comment="Right shape and not in the future. Compare with the work log if you need more.")


def check_source_url(val, pages, other_note=None) -> dict:
    u = _s(val)
    if not re.match(r"^https?://\S+\.\S+", u):
        return _v("source_url", val, WRONG, "format", source_says="A full web address that starts with https://", pattern="url_shape", comment="Not a usable web address.", proof={"url": None, "quote": u or "(empty)"})
    pg = pages.get(u)
    if not pg or not pg["ok"]:
        return _unavailable("source_url", val, (pg or {}).get("error") or "the page was not fetched.")
    fin = pg.get("final_url")
    if fin and norm_url(fin) != norm_url(u):
        return _v("source_url", val, WRONG, "format", source_says=fin, pattern="url_redirect", sop_rule="source_url is the page the evidence came from",
                  comment="The cited address redirects to a different page. Use the final address.", proof={"url": fin, "quote": f"{u} redirected to {fin}"})
    return _v("source_url", val, CORRECT, comment="The page opens." + ("" if fin else " (Redirects could not be checked: the final address was not reported.)"), proof={"url": u, "quote": f"{pg['chars']} characters read"})


def check_regions(val, pages, url) -> dict:
    names = _region_names(val)
    if not names:
        return _v("regions", val, HOLD, comment="regions is empty.", pattern="empty")
    pg = pages.get(url)
    if not pg or not pg["ok"]:
        return _unavailable("regions", val, (pg or {}).get("error") or "the cited page was not fetched.")
    allt = " ".join(p["clean"] for p in pages.values() if p["ok"])
    miss = [n for n in names if q.find_in_text(n, pg["clean"])["state"] == "missing" and q.find_in_text(n, allt)["state"] == "missing"]
    extra = sorted({k for x in (val if isinstance(val, list) else []) if isinstance(x, dict) for k in x if k not in ("name", "region")})
    if miss and (MORE_RE.search(pg["clean"])):
        return _v("regions", val, HOLD, comment=f"Not seen on the visible page: {', '.join(miss)}. The page has a View more, so the rest may be hidden. Expand it and look.", pattern="truncated")
    if miss:
        return _v("regions", val, WRONG, "unsupported_value", source_says=f"Not on the cited page: {', '.join(miss)}.", pattern="regions_missing", comment="These regions do not appear on the cited page.",
                  proof={"url": url, "quote": best_sentence(" ".join(miss), pg["clean"]) or "(none of them on the page)"})
    if extra:
        return _v("regions", val, HOLD, comment=f"Extra key(s) {', '.join(extra)} on each region are not in the SOP skeleton regions[{{name}}]. Hold until the SOP version in force is confirmed. Do not delete data.", pattern="regions_extra_keys")
    return _v("regions", val, CORRECT, comment="Every region is named on the page.", proof={"url": url, "quote": q.find_in_text(names[0], pg["clean"])["snippet"] or names[0]})


def check_text(field, val, pages, url) -> dict:
    pg = pages.get(url)
    if not pg or not pg["ok"]:
        return _unavailable(field, val, (pg or {}).get("error") or "the cited page was not fetched.")
    h = q.find_in_text(val, pg["clean"])
    if h["state"] == "skip":
        return None
    if h["state"] == "found":
        return _v(field, val, CORRECT, comment="Found on the cited page.", proof={"url": url, "quote": h["snippet"]})
    if h["state"] == "close":
        return _v(field, val, CORRECT, comment="Close match on the cited page.", proof={"url": url, "quote": h["snippet"]}, pattern="close")
    allt = " ".join(p["clean"] for p in pages.values() if p["ok"])
    if q.find_in_text(val, allt)["state"] != "missing":
        return _v(field, val, HOLD, comment="Not on the cited page, but on another page that was read. Check which page it should come from.", pattern="other_page")
    return _v(field, val, HOLD, comment="Not found on the cited page. A weak or missing match is a question, not an error. Check by hand.", pattern="not_found")


# ---------------------------------------------------------------- flags, commodities, decision
def _flag_status(v, signals, peers) -> tuple[str, list[str], bool]:
    """Returns (status text, peer ids that pointed at this field, flagged at all)."""
    peer_ids = {p["id"] for p in peers}
    by_name = {p["name"]: p["id"] for p in peers}
    caught, any_flag, vague, recheck = [], False, False, False
    for s in signals or []:
        k = s.get("kind")
        uid = s.get("by_id") or by_name.get(s.get("by"))
        if k in ("comment", "finding") and uid in peer_ids:
            caught.append(uid); any_flag = True
        elif k in ("sop", "system", "finding", "ai", "web", "comment"):
            any_flag = True
        elif k == "mention":
            vague = True
        elif k == "recheck":
            recheck = True
    caught = sorted(set(caught))
    if v == WRONG:
        if caught:
            return "VALID", caught, True
        if any_flag:
            return "VALID (system or admin flag)", [], True
        if vague:
            return "VAGUE", [], True
        return "NOT FLAGGED", [], False
    if v == CORRECT and any_flag:
        return ("STALE (changed since it was flagged)" if recheck else "FALSE POSITIVE"), [], True
    if v == CORRECT and recheck:
        return "STALE (changed since it was flagged)", [], True
    return "", [], any_flag


def find_missing(pages, recorded, now_iso) -> list[dict]:
    have = " ".join(x.lower() for x in recorded)
    out, seen = [], set()
    for url, pg in pages.items():
        if not pg["ok"]:
            continue
        for s in sentences(pg["clean"]):
            low = s.lower()
            for term in COMMODITIES:
                if re.search(rf"\b{re.escape(term)}\b", low) and term not in seen and term not in have and not SERVICE_RE.search(term):
                    seen.add(term)
                    if len(s) <= 400:
                        out.append({"segment_name": term.title(), "data_origin": "curated", "method": "manual", "source_url": url, "evidence": s, "retrieved_at": now_iso})
        if len(out) >= 15:
            break
    return out[:15]


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v)


def apply_sop(vs: list[dict], rf: dict, specs: dict, template_keys: list[str], other_sections: set | frozenset = frozenset()) -> list[dict]:
    """Strict SOP rules on top of the page checks: a required field that is empty, a value outside the SOP's allowed
    list, and keys the SOP does not list. A rule from the SOP always names its section and quote."""
    by = {v["field"]: v for v in vs}
    out = list(vs)

    def put(field, new):
        if field in by:
            old = by[field]
            if old["verdict"] == WRONG and new.get("error_kind") == "schema":
                # A field outside the SOP is a schema error first; the page finding is kept as a second note.
                keep = old["comment"]
                old.update({k: v for k, v in new.items() if k not in ("comment",)})
                old["comment"] = (new["comment"] + " Also: " + keep).strip()
                return
            if old["verdict"] == WRONG:
                old["comment"] = (old["comment"] + " Also: " + new["comment"]).strip()
                return
            out[out.index(old)] = new
        else:
            out.append(new)
        by[field] = new
    for name, sp in specs.items():
        val = rf.get(name)
        where = f"SOP section '{sp.get('section')}'" if sp.get("section") else "the SOP"
        quote = {"url": None, "quote": sp.get("quote")}
        if sp.get("required") and _blank(val):
            put(name, _v(name, val, WRONG, "missing_value", source_says=f"{name} is required by {where} and cannot be empty.", pattern="sop_required", sop_rule=sp.get("quote"),
                         comment=f"The SOP requires {name}, and it is empty.", proof=quote))
            continue
        allowed = sp.get("allowed") or []
        if allowed and not _blank(val):
            items = val if isinstance(val, list) else [val]
            bad = [x for x in items if isinstance(x, (str, int, float)) and str(x).strip() not in allowed]
            if bad:
                case_only = all(str(x).strip().lower() in {a.lower() for a in allowed} for x in bad)
                if case_only:
                    put(name, _v(name, val, HOLD, comment=f"Only the letter case differs from the SOP's list. The SOP accepts case differences, but the canonical value is one of: {', '.join(allowed)}.", pattern="sop_case_only",
                                 sop_rule=sp.get("quote"), proof=quote))
                    continue
                put(name, _v(name, val, WRONG, "sop_rule", source_says=f"Allowed by {where}: {', '.join(allowed)}.", pattern="sop_allowed_values", sop_rule=sp.get("quote"),
                             comment=f"{', '.join(map(str, bad))} is not one of the SOP's allowed values" + (" (only the letter case differs)." if case_only else "."), proof=quote))
        if not allowed and not _blank(val) and by.get(name, {}).get("verdict") != WRONG:
            from app.services.quality import type_issue
            ti = type_issue(sp, val)
            if ti:
                put(name, _v(name, val, WRONG, "sop_rule", source_says=f"The SOP declares {name} as {sp.get('type')}" + (f" ({sp.get('format')})" if sp.get("format") else "") + ".", pattern="sop_type", sop_rule=sp.get("quote"),
                             comment=f"{val} is {ti}.", proof=quote))
    known = set(template_keys) | set(specs)
    if len(known) >= 3:
        for k, val in rf.items():
            if k in known or k in SKIP or k.startswith("_") or _blank(val):
                continue
            if k in other_sections:
                put(k, _v(k, val, HOLD, comment=f"{k} is only named under another category's section of the SOP, not this source's. Check which section applies before calling it wrong.", pattern="sop_other_section"))
            else:
                put(k, _v(k, val, WRONG, "schema", source_says=f"{k} is not a field of the SOP saved on this source.", pattern="sop_unlisted_field", sop_rule="Only the fields the SOP lists may be sent",
                              comment=f"{k} is outside the SOP saved on this source, so it should not be delivered. If the SOP was edited on Xtrium, use Refresh from Xtrium first and run the audit again.",
                              proof={"url": None, "quote": f"Fields the SOP lists: {', '.join(sorted(known))[:300]}"}))
    return out


def audit_source(desk: dict, pages: dict, source_name: str, website: str | None, extractor: str | None, now: datetime | None = None, sop: dict | None = None) -> dict:
    """desk is the review desk data (records with fields, signals, peers). pages maps a cited url to
    {ok, error, clean, final_url, chars}. Returns every verdict, the missing records, the decision and attribution."""
    now = now or datetime.now(timezone.utc)
    peers = desk.get("peers") or []
    recs = desk.get("records") or []
    for p in pages.values():
        p.setdefault("clean", clean_page(p.get("text", "")))
        p.setdefault("chars", len(p["clean"]))
    values = [{f["name"]: f["value"] for f in r["fields"]} for r in recs]
    seg_counts: dict = {}
    for v in values:
        k = flat(_s(v.get("segment_name"))).lower()
        if k:
            seg_counts[k] = seg_counts.get(k, 0) + 1
    ts_all = [_s(v.get("retrieved_at")) for v in values if _s(v.get("retrieved_at"))]
    rows = []
    for r, rf in zip(recs, values):
        sigs = {f["name"]: f["signals"] for f in r["fields"]}
        url = _s(rf.get("source_url")) or (website or "")
        others = {u: p for u, p in pages.items() if u != url}
        vs = []
        if "evidence" in rf:
            vs.append(check_evidence(rf["evidence"], url, pages, others))
        if "segment_name" in rf:
            vs.append(check_segment(rf["segment_name"], rf, source_name, website, pages, url, seg_counts.get(flat(_s(rf["segment_name"])).lower(), 0)))
        vs += check_provenance(rf)
        if "retrieved_at" in rf:
            vs.append(check_retrieved(rf["retrieved_at"], ts_all, now))
        if "source_url" in rf:
            vs.append(check_source_url(rf["source_url"], pages))
        if "regions" in rf:
            vs.append(check_regions(rf["regions"], pages, url))
        for k, val in rf.items():
            if k in HANDLED or k in SKIP or k in ("data_origin", "retrieved_at", "method") or val in (None, "", [], {}) or not isinstance(val, (str, list)):
                continue
            c = check_text(k, val, pages, url)
            if c:
                vs.append(c)
        if sop:
            from app.services import sop_requirements as sr
            vs = apply_sop(vs, rf, sr.field_specs(sop), sop.get("template_keys") or [], {f["name"] for f in sop.get("fields", []) if not f.get("enforce", True) and not f.get("nested")})
        specs_all = {}
        if sop:
            from app.services import sop_requirements as _sr
            specs_all = _sr.field_specs(sop)
        for v in vs:
            # A verdict that contradicts its own quoted list is a tool defect, not an error to blame on the extractor.
            if v.get("pattern") == "sop_allowed_values":
                al = (specs_all.get(v["field"]) or {}).get("allowed") or []
                if al and str(v["delivered"]).strip() in al:
                    v.update(verdict=CORRECT, error_kind=None, source_says=None, pattern="tool_defect_fixed", comment="The delivered value is in the SOP's allowed list.")
            # "On the page" proves the text is there, not that it is the right kind of value.
            if v.get("pattern") == "segment_on_page" and any(x.get("kind") in ("comment", "mention", "finding") and KIND_COMPLAINT.search(x.get("text") or "") for x in (sigs.get(v["field"]) or [])):
                v.update(verdict=HOLD, comment="The name appears on the page, but a peer or check has questioned this field. Appearing on the page does not show it is a real market segment (one commodity or trading category). Judge the kind of value against the SOP.")
        for v in vs:
            st, caught, flagged = _flag_status(v["verdict"], sigs.get(v["field"]), peers)
            v.update({"record_id": r["record_id"], "record": r["record"], "source": source_name, "flag_status": st, "flagged": flagged,
                      "caught_by_ids": caught, "caught_by": [p["name"] for p in peers if p["id"] in caught],
                      "missed_by": [p["name"] for p in peers if p["id"] not in caught] if v["verdict"] == WRONG else [], "extractor": extractor})
            rows.append(v)
    wrong = [x for x in rows if x["verdict"] == WRONG]
    hold = [x for x in rows if x["verdict"] == HOLD]
    recorded = [flat(_s(v.get("segment_name"))) for v in values]
    suggestions = find_missing(pages, recorded, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    bad_seg = [x for x in wrong if x["field"] == "segment_name" and x["pattern"] in ("segment_platform", "segment_service", "segment_duplicate")]
    remove = sorted({x["record_id"] for x in bad_seg}) if not suggestions else []
    if wrong:
        decision = "SEND BACK"
    elif hold:
        decision = "HOLD"
    else:
        decision = "APPROVE"
    patterns: dict = {}
    for x in wrong:
        patterns.setdefault((x["field"], x["pattern"]), []).append(x["record"])
    gaps = ["The site map was not scanned. Only the pages the records cite were read, so records that may be missing are suggestions from those pages only, not a full scan."]
    gaps += [f"{u}: {p.get('error') or 'could not be read'} (these fields are on HOLD, not wrong)." for u, p in pages.items() if not p["ok"]]
    if any(p["ok"] and not p.get("final_url") for p in pages.values()):
        gaps.append("Nimble did not report the final address of some pages, so redirects were not checked there.")
    false_flags: dict = {}
    for x in rows:
        if x["flag_status"].startswith("FALSE POSITIVE"):
            false_flags[x["field"]] = false_flags.get(x["field"], 0) + 1
    return {
        "decision": decision, "rows": rows, "suggested_records": suggestions, "remove_records": remove, "gaps": gaps,
        "counts": {"fields": len(rows), "correct": len(rows) - len(wrong) - len(hold), "wrong": len(wrong), "hold": len(hold), "not_flagged": sum(1 for x in wrong if x["flag_status"] == "NOT FLAGGED"),
                   "false_positive": sum(1 for x in rows if x["flag_status"].startswith("FALSE POSITIVE")), "stale": sum(1 for x in rows if x["flag_status"].startswith("STALE"))},
        "patterns": [{"field": f, "pattern": p, "records": rs, "count": len(rs)} for (f, p), rs in sorted(patterns.items(), key=lambda kv: -len(kv[1]))],
        "attribution": {"extractor": extractor, "errors": len(wrong), "nobody_caught": sum(1 for x in wrong if not x["caught_by_ids"]),
                        "peers": [{"id": p["id"], "name": p["name"], "caught": sum(1 for x in wrong if p["id"] in x["caught_by_ids"]), "missed": sum(1 for x in wrong if p["id"] not in x["caught_by_ids"])} for p in peers]},
        "version_note": "Judged against the SOP code shown on the desk (" + str((sop or {}).get("sop_code") or "none saved") + "). Anything that depends on a different SOP version is on HOLD, not wrong.",
    }
