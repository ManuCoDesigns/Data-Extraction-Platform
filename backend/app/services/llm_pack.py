"""Everything in a Final check, laid out so a language model (or a person) can verify it independently.

The pack says what to do and how to answer, then for each source lists the fields to decide, the extractor's value next to the admin's final
value, who flagged them and what they wrote, the SOP rules, and the full records on both sides. Nothing here is edited or recorded.
"""
from __future__ import annotations

import io
import json
import re
import zipfile

TASK = """# Verify a data extraction

You are checking company data that was extracted from public web sources. For every item below, an extractor delivered one value and the admin's
final record holds another (or a reviewer flagged the value). Decide independently which one is right. Do not trust either side, and do not
assume the admin is right.

## How to check
1. Open the source URL given for the source, and the page the record's own `source_url` or `evidence` field points to. Use other public pages
   only when the official site does not say.
2. For each item, decide one verdict:
   - `extractor_right`: the delivered value is supported by the source.
   - `admin_right`: the final value is supported by the source.
   - `both_wrong`: neither is supported. Give the value the source does support.
   - `unverifiable`: the sources you can reach do not settle it. Say what you looked at.
3. Give the exact URL that supports your verdict, and quote the short passage if you can. A verdict without a URL is `unverifiable`.
4. Check required fields against the SOP rules listed for the source, and say if the final record breaks any of them.
5. Do not invent values. Say `unverifiable` instead of guessing.

## Answer format
Reply with one JSON array. One object per item, in this shape:

```json
{"source": "...", "record": "...", "field": "...", "verdict": "extractor_right|admin_right|both_wrong|unverifiable",
 "correct_value": "...", "evidence_url": "...", "quote": "...", "note": "..."}
```

Then, after the array, write at most five sentences on anything that looks wrong across the whole batch (a pattern, a wrong entity, a missing source).

## Terms
- **To decide**: the two values differ and nothing is recorded yet. These are the most important items.
- **Extractor error**: the delivered value was wrong and the final value is the correction.
- **Admin change**: the delivered value stands as right, and the admin changed it.
- **Caught / escaped**: a reviewer flagged a real error (caught) or nobody did (escaped).
- **False alarm**: a reviewer flagged a value that was fine.
- **Fixed before final**: a reviewer flagged an earlier value, and it was corrected before the final check.
"""


def _v(x) -> str:
    if x is None or x == "":
        return "(empty)"
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, default=str)
    return s if len(s) <= 700 else s[:700] + f"… [{len(s)} characters]"


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:60] or "source"


def _comments(sd: dict, record: str, field: str) -> list:
    for p in sd.get("pack", []):
        if p["record"] == record:
            return [c for c in (p["comments"].get(field) or []) if c.get("comment")]
    return []


def _item(sd: dict, e: dict) -> str:
    out = [f"- **{e['record']} → {e['field']}**",
           f"  - Extractor delivered: {_v(e.get('extractor_value'))}",
           f"  - Admin final: {_v(e.get('final_value'))}"]
    if e.get("reason"):
        out.append(f"  - Platform note: {e['reason']}")
    if e.get("flagged_by"):
        out.append(f"  - Flagged by a reviewer: yes ({len(e['flagged_by'])})")
    for c in _comments(sd, e["record"], e["field"])[:3]:
        out.append(f"  - Reviewer comment ({c.get('type') or 'note'}): {_v(c.get('comment'))}")
    return "\n".join(out)


def source_md(sd: dict) -> str:
    L = [f"# {sd['name']}", ""]
    L.append(f"- Source URL: {sd.get('website_url') or '(none recorded)'}")
    L.append(f"- Extractor: {sd.get('extractor')}. Reviewers: {', '.join(sd.get('reviewers') or []) or 'none'}")
    L.append(f"- Fields compared: {sd['fields']}. Extractor errors: {sd['wrong']}. To decide: {sd['pending']}. Admin changes: {sd['admin_changes']}. False alarms: {sd['false_alarms']}. Fixed before final: {sd['fixed']}.")
    wf = sd.get("wrong_fields") or []
    sections = [("To decide (the two values differ, nothing recorded)", [e for e in wf if e["class"] == "held"]),
                ("Extractor errors (the final value is the correction)", [e for e in wf if e["class"] == "extractor_error"]),
                ("Admin changes (the delivered value was judged right, then changed)", [e for e in wf if e["class"] == "admin_change"])]
    for title, items in sections:
        if items:
            L += ["", f"## {title}", ""] + [_item(sd, e) for e in items]
    if sd.get("false_alarm_fields"):
        L += ["", "## Reviewer false alarms (flagged, but the value was kept)", ""]
        for f in sd["false_alarm_fields"]:
            L.append(f"- **{f['record']} → {f['field']}** is {_v(f['value'])}, flagged by {', '.join(f['flagged_by'])}")
            for c in _comments(sd, f["record"], f["field"])[:2]:
                L.append(f"  - Reviewer comment: {_v(c.get('comment'))}")
    if sd.get("fixed_fields"):
        L += ["", "## Flagged by a reviewer, fixed before the final check", ""]
        L += [f"- **{f['record']} → {f['field']}** was {_v(f['was'])}, now {_v(f['now'])} (flagged by {f['flagged_by']})" for f in sd["fixed_fields"]]
    if sd.get("sop_failure_list"):
        L += ["", "## SOP problems in the final record", ""] + [f"- {x['record']} → {x['field']}: {x['why']}" for x in sd["sop_failure_list"]]
    if sd.get("key_records_unmatched") or sd.get("extractor_records_unmatched"):
        L += ["", "## Records that did not match", ""]
        L += [f"- In the final file only: {n}" for n in sd.get("key_records_unmatched") or []]
        L += [f"- Delivered by the extractor only: {n}" for n in sd.get("extractor_records_unmatched") or []]
    sop = sd.get("sop") or {}
    if sop.get("required"):
        L += ["", "## SOP rules", "", f"Required fields: {', '.join(sop['required'])}"]
        if sop.get("allowed"):
            L.append(f"Allowed fields: {', '.join(sorted(sop['allowed']))}")
    for p in sd.get("pack", []):
        L += ["", f"## Records: {p['record']}", "", "Extractor delivered:", "```json", json.dumps(p["extractor"], ensure_ascii=False, indent=1, default=str), "```",
              "", "Admin final:", "```json", json.dumps(p["final"], ensure_ascii=False, indent=1, default=str), "```"]
    return "\n".join(L) + "\n"


def combined_md(result: dict, meta: dict) -> str:
    t = result["totals"]
    head = [TASK, "", "---", "", "# The batch", "",
            f"Generated {meta.get('generated')}. {t['sources']} sources, {t['records']} records, {t['fields']} fields compared, {t['wrong']} extractor errors, {t['pending']} to decide.", ""]
    if result.get("unmatched_sources"):
        head += ["Sources in the final file that matched no source on the platform:", ""] + [f"- {x if isinstance(x, str) else json.dumps(x, default=str)}" for x in result["unmatched_sources"]] + [""]
    srcs = sorted(result["sources"], key=lambda s: (-(s["pending"] or 0), s["name"].lower()))
    return "\n".join(head) + "\n" + "\n---\n\n".join(source_md(s) for s in srcs)


def zip_pack(result: dict, meta: dict) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("00_TASK_AND_ANSWER_FORMAT.md", TASK)
        for i, s in enumerate(sorted(result["sources"], key=lambda s: s["name"].lower()), 1):
            z.writestr(f"sources/{i:02d}_{_slug(s['name'])}.md", source_md(s))
        slim = {**result, "sources": [{k: v for k, v in s.items() if k != "pack"} for s in result["sources"]]}
        z.writestr("data.json", json.dumps(slim, ensure_ascii=False, indent=1, default=str))
    return b.getvalue()
