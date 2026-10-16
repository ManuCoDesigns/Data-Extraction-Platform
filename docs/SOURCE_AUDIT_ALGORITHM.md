# Source Audit Algorithm (Nimble-based): MarketSegment / Regulation extraction QA

Purpose: check AI- or hand-extracted records against the live source site, field by field, using the SOP, and produce Correct / Wrong / Hold verdicts with proof, paste-ready text, and error attribution. This is the exact logic used in the 16 Oct 2026 final admin review.

---

## 0. Inputs and outputs

Inputs
- Records: JSON per source (segment_name, regions, industry, regulation_name, jurisdiction, issuing_body, data_origin, method, retrieved_at, source_url, evidence).
- SOP text (note its version; flag if the delivered version differs from the text you hold).
- Peer comments and system flags per field.
- Extractor name and peer reviewer names per source.

Outputs per field
- verdict: CORRECT | WRONG | HOLD
- error_kind (SOP rule | Format | Not in the source | ...)
- source_says: exact text the source supports (paste into "What the source really says")
- comment: paste-ready explanation
- proof: quoted live text + page URL
- flag_status: VALID | FALSE POSITIVE | STALE | NOT FLAGGED
- caught_by, missed_by, extractor
Outputs per source: decision (APPROVE | HOLD | SEND BACK), records to ADD, records to REMOVE.

---

## 1. Nimble tool routing

| Need | Tool | Notes |
|---|---|---|
| Read one known URL | `nimble_extract` (plain_text or markdown) | Large output is saved to a file; parse it with code, do not read it inline. |
| JS-heavy or bot-protected sites (e.g. dnb.com) | `nimble_extract` with `driver="vx10"`, `output_format="markdown"` | Lighter drivers return an app shell or time out. |
| List all URLs on a site | `nimble_map` | Gives candidate pages; may time out or return one URL, so record that as a scan gap. |
| Bulk fetch a known doc tree | `nimble_crawl_run` / `nimble_crawl_status` | Use after Map when many candidate pages. |
| Cached or stale text, or pages that will not render | `nimble_search` | Treat as a hint only; the live extract wins on any conflict. |

Rules
1. Extract the exact `source_url` the record cites, not the homepage.
2. Compare the final returned URL with the cited URL. A redirect to a different page is a source_url error.
3. If an extract returns the wrong page (e.g. a blog index instead of the article), retry with a stronger driver; if still wrong, search for the page text and mark the evidence unverified, not wrong.
4. Never mark Wrong from a failed fetch. Failure means HOLD with "could not verify".

---

## 2. Text normalisation (do this before every comparison)

```
def norm(t):
    t = strip_json_ld_and_scripts(t)       # remove {"@context"...}, <script>, cookie code
    t = unicode_normalise(t)               # keep en/em dashes and curly quotes distinct; do NOT silently fold them
    return collapse_whitespace(t)
```
Keep a second folded copy (dashes to hyphen, curly to straight quotes) used ONLY to explain a near-match. A character-level difference such as an en dash vs a hyphen is a minor Comment, not a Wrong, unless the SOP demands exact characters.

---

## 3. Per-source algorithm

```
for source in sources:
    pages = fetch(all distinct source_url in records)          # Section 1
    site_map = nimble_map(source.site)                          # deep scan
    candidates = filter(site_map, keywords=[commodity, mineral, metal, industry, regulation, market, ...])
    candidate_text = fetch_and_normalise(candidates)            # grep, never eyeball

    for record in source.records:
        for field in record.fields:
            verdict = check_field(field, record, pages, SOP)
            attach_flags(verdict, peer_flags, system_flags)
    missing = find_missing_records(source, candidate_text, SOP)  # Section 6
    decision = decide(source)                                    # Section 8
```

---

## 4. Field checks (the decision tree)

### 4.1 evidence
1. Is `evidence` a substring of norm(page text at source_url)?
   - Yes → CORRECT for verbatim. Go to 4.1.3.
   - No → 2.
2. Split the evidence on obvious joiners (" – ", " - ", ": ", " | ").
   - If every part is on the page but the joined string is not → WRONG, kind "SOP rule" (joiner defect). Source says = ONE real sentence as printed on the page. Show both halves with context.
   - If the sentence exists on a different page of the same site → WRONG, kind "Not in the source" for this URL. Give the page where it does exist, and the sentence that IS on the cited page.
   - If nothing close exists anywhere scanned → WRONG ("Not in the source").
   - If fetch was incomplete (paywall, truncation, "View More") → HOLD, name what to click.
3. Does the sentence support the segment_name or only describe a platform or service? If it supports a service only, evidence is CORRECT as a quote but segment_name is the error.

Note: a system message that says the SOP "does not list" `evidence` is a false positive if the tech team has confirmed evidence is accepted. Judge the content, not the message.

### 4.2 segment_name
1. Is the value on the cited page (or the site)? If not → WRONG "Not in the source".
2. Is it a commodity or industrial market trading category (SOP wording, e.g. "Titanium sponge")? Apply the pitfall tests:
   - Platform, database or company name ("Panjiva", "PubMed", "The Lens") → WRONG, SOP rule.
   - Service sold ("Supply chain risk management") → WRONG, SOP rule.
   - Finished product, component or chemical class (inverters, chips, PFAS) → WRONG or skip.
   - Broad sector or classification group (NAICS/SIC-style, "Energy") overlapping commodity records → HOLD (parent/child question), not WRONG.
   - Over-fragmenting (many records for one segment) → WRONG, SOP rule.
3. If WRONG because platform or service: scan the site for real commodities (Section 6) and give the replacement records.

### 4.3 data_origin and method (provenance pair)
```
curated        ↔ manual            (hand-made)
ai_generated   ↔ llm_extraction    (AI-made)
```
- Pair mismatch → WRONG, kind "SOP rule".
- Pair consistent → CORRECT, even if a peer suggests the other pair. A peer's "use curated if you checked by hand" is conditional, not an error.

### 4.4 retrieved_at
- Must match `YYYY-MM-DDTHH:MM:SSZ`. A date-only value, a missing Z, or a wrong shape → WRONG, kind "Format".
- `T00:00:00Z` on every record of a source, or all values identical → placeholder suspect → WRONG, kind "Format"; correct value: the real retrieval time or delete the key.
- Compare with the work log or timesheet window if available. On-the-hour but plausible → CORRECT.

### 4.5 source_url
1. Fetch it. If it fails → WRONG, "Format" (or HOLD if a transient fetch error).
2. If the final URL differs from the cited URL (redirect) → WRONG, "Format"; correct value = final canonical URL.
3. If the page does not contain the evidence → the problem is evidence or source assignment, say which.
4. A homepage URL is acceptable only when the evidence is on the homepage.

### 4.6 regions
1. Each name must appear on the page (use the live list in page order; check the first visible items and flag the part hidden behind "View More").
2. Keys: the SOP skeleton lists `regions[{name}]`. An extra key such as `country` (ISO code) is HOLD until the SOP version in force is confirmed. Do not delete data on a hold.
3. A code that is correct (e.g. CD = Democratic Republic of the Congo) must not be flagged.

### 4.7 industry, regulation_name, jurisdiction, issuing_body
1. Value must be supported by text on the cited page. Quote it.
2. If it appears only as a slogan on another page → HOLD or WRONG "Not in the source" depending on strength.
3. Optional fields missing on some records → HOLD (version question), not WRONG.

---

## 5. Verdict rules

| Condition | Verdict |
|---|---|
| Proven against live text | CORRECT |
| Proven contradicted or absent from the cited source | WRONG + error_kind |
| Depends on an SOP version you do not hold, or on the client | HOLD (comment only) |
| Fetch failed, paywall, truncated | HOLD ("could not verify" + what to click) |

Hard rules
- Never mark WRONG on a guess. If the source does not settle it, HOLD.
- WRONG always needs a "source says" value and a quoted proof.
- State the SOP version used. Rules from a version you do not hold are marked "v4.1.0 not held".

---

## 6. Deep scan: find what is missing (so you do not flag something that exists)

```
def find_missing_records(source, candidate_text, SOP):
    terms = commodity_lexicon()          # metals, minerals, REE, battery materials, critical materials...
    hits = grep_sentences(candidate_text, terms)
    for hit in hits:
        if is_finished_product_or_service(hit):  continue
        if already_recorded(hit.segment, source.records): continue
        yield Record(
            segment_name = hit.commodity,
            data_origin  = 'curated', method = 'manual',   # when added by hand
            source_url   = hit.page_url,                  # the exact page
            evidence     = hit.sentence,                  # verbatim, one sentence
            retrieved_at = now_utc_iso(),                 # real time, not midnight
        )
```
Rules
- One record per distinct commodity. One verbatim sentence from the exact page.
- Before flagging "missing X", grep the full scan text for X. Only flag if absent everywhere scanned.
- Paywalled pages: only teaser text is verifiable; say so.
- Record every scan gap (map timeout, one-URL map, unscanned sibling pages). Gaps are reported as "not proven", never as "clean".
- If the site has no commodity content (literature index, patent database, platform homepage), the right answer is REMOVE the record with nothing to add.

---

## 7. Reviewer-flag audit

For each peer comment and system flag, per field:
```
VALID          the flagged problem is real on the live page
FALSE POSITIVE the flagged problem does not exist (e.g. system "SOP does not list evidence"; correct ISO code called an error)
STALE          real in an earlier version, already fixed (verify the current value)
VAGUE          hinted but not specific (credit it, note it)
NOT FLAGGED    error exists and no one flagged it (an extractor miss AND a reviewer miss)
```
Keyword "Peer mentioned" chips are text matches, not findings. Judge the note itself.

Credit rule: credit a peer for an error ONLY if their note points at that error.

---

## 8. Source decision

```
if any WRONG:                      SEND BACK (Return for correction)
elif any HOLD:                     HOLD  (do not approve until the client answers)
else:                              APPROVE
```
Add the comment before sending back, because sending back resets peer reviews.

---

## 9. Error attribution and rates

```
errors = [f for f in fields if f.verdict == 'WRONG']      # holds are NOT errors
for e in errors:
    e.extractor  = source.extractor
    e.caught_by  = peers whose note points at e
    e.missed_by  = source.peers - e.caught_by
extractor_error_count[extractor] += 1
reviewer_catch_rate[r] = caught_by_r / errors_on_sources_r_reviewed
errors_nobody_caught = [e for e in errors if not e.caught_by]
```
Report counts per field per record, and note when one defect repeats (e.g. 18 S&P evidence joiners) so one pattern does not look like 18 independent mistakes. Also count reviewer false flags separately; they measure reviewer precision.

---

## 10. Failure patterns learned (train the model on these)

1. Platform or service name used as segment_name (Panjiva, PubMed, The Lens, Resilinc).
2. Evidence built by gluing two page elements with an invented " – " or ": ".
3. Evidence copied from a different page than source_url.
4. Placeholder midnight timestamps repeated across records.
5. Value present only as a slogan on another page (industry "fashion").
6. URL that silently redirects to another site (OMRON record pointing at an EcoVadis page).
7. Wrong source assigned (page has no content about the named company).
8. Peer approvals that never test evidence live ("clean", "ok").
9. False flags: correct ISO codes called errors; system messages about fields the SOP accepts; stale chips on already fixed fields.
10. SOP version drift: record created under one version, reviewed under another. Hold, do not mark wrong.

---

## 11. Output record (per field)

```json
{
  "source": "Resilinc", "record": "Record 1", "field": "segment_name",
  "delivered": "Supply chain risk management",
  "sop_rule": "commodity or industrial market trading category; not a service",
  "verdict": "WRONG", "error_kind": "SOP rule",
  "source_says": "No commodity or market segment is stated on the homepage. 'Supply chain risk management' is the service Resilinc sells.",
  "comment": "SOP: a MarketSegment is a commodity ... Replace with commodity records named on industry pages.",
  "proof": {"url": "https://resilinc.ai/industry/high-tech-semiconductor/",
            "quote": "Understand the ripple effects of bans on gallium, germanium, cobalt, and PFAS..."},
  "flag_status": "VALID (Austine)",
  "caught_by": ["Austine"], "missed_by": ["Sarah"], "extractor": "Nuhash",
  "add_records": ["Gallium", "Germanium", "Cobalt", "Copper", "Aluminum"]
}
```

## 12. Guardrails for the AI

- Quote, do not paraphrase, in every proof.
- Never invent a URL, sentence or timestamp. If it is not in fetched text, it does not exist.
- Say what was not scanned. A scan that could not run is a gap, not a pass.
- Prefer HOLD to a wrong WRONG; a false error corrupts reviewer and extractor error rates.
- Re-fetch before trusting cached or search text.