"""Download of peer-reviewed sources: one workbook with the peers' comments beside the data, so the same file can be
handed to an AI model (or a person) to double-check what the peers said."""
import io
import json
from datetime import timezone

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

KIND = {"comment": "Peer comment", "mention": "Peer mentioned", "finding": "Error logged", "sop": "SOP", "system": "System check", "ai": "AI or web flag"}
README = [
    "Peer-reviewed sources: what the reviewers said, next to the data.",
    "",
    "Sheets",
    "Sources: one row per source with counts.",
    "Peer comments: every comment a reviewer wrote (source notes and notes on a single field or record).",
    "Fields: one row per field of every record. Doubted fields come first. 'Why doubted' lists every signal, 'Peer says' quotes the reviewers.",
    "Records JSON: the raw record as JSON, so a model can read a whole record in one cell.",
    "",
    "How to use it with an AI model",
    "1. Give the model the Fields sheet (or the JSON download) and the source website.",
    "2. Ask it to check each row where 'Doubted' is yes against the website and answer correct, wrong or unsure, with the real value.",
    "3. Compare its answers with the 'Admin verdict' column. Anything it calls wrong that no peer pointed at is worth a look.",
    "A signal is only a pointer. It is not proof that a value is wrong.",
]


def _fmt(dt):
    if not dt:
        return ""
    try:
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(dt)


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def collect(items: list[dict]) -> dict:
    """items: [{source, project, extractor, review, peer_rows, sop_code}] -> plain structure used by both formats."""
    sources, comments, fields, records = [], [], [], []
    for it in items:
        s, rv = it["source"], it["review"]
        tot = rv["totals"]
        sources.append({"project": it["project"], "source": s.name, "website": s.website_url or "", "sop": rv.get("sop_code") or "",
                        "extractor": it["extractor"], "peers": len(rv["peers"]), "records": len(rv["records"]), "fields": tot["fields"], "doubted": tot["flagged"],
                        "peer_comments": tot["comments"], "peer_mentions": tot["mentions"], "checked": tot["audited"]})
        for p in it["peer_rows"]:
            comments.append({"project": it["project"], "source": s.name, "record": "(whole source)", "field": "", "by": p["name"], "role": "peer reviewer", "type": p["status"], "comment": p["comment"], "when": p["when"]})
        for r in rv["records"]:
            for g in r["general"]:
                comments.append({"project": it["project"], "source": s.name, "record": r["record"], "field": "", "by": g["by"], "role": g.get("role") or "", "type": g.get("type") or "note", "comment": g["text"], "when": g.get("ts") or ""})
            raw = {}
            for f in r["fields"]:
                raw[f["name"]] = f["value"]
                peer_say = " | ".join(f"{x.get('by') or 'Reviewer'}: {x['text']}" for x in f["signals"] if x["kind"] == "comment")
                for x in f["signals"]:
                    if x["kind"] == "comment":
                        comments.append({"project": it["project"], "source": s.name, "record": r["record"], "field": f["name"], "by": x.get("by") or "", "role": x.get("role") or "", "type": "field comment", "comment": x["text"], "when": ""})
                mention = " | ".join(f"{x.get('by') or 'Reviewer'}: {x['text']}" for x in f["signals"] if x["kind"] == "mention")
                why = "; ".join(sorted({KIND.get(x["kind"], x["kind"]) for x in f["signals"]}))
                a = f["audit"] or {}
                fields.append({"project": it["project"], "source": s.name, "website": s.website_url or "", "record": r["record"], "field": f["name"], "value": f["value"],
                               "doubted": "yes" if f["signals"] else "no", "why": why, "peer_says": peer_say, "peer_mentioned_in": mention,
                               "other": "; ".join(x["text"] for x in f["signals"] if x["kind"] in ("sop", "system", "ai", "finding") and x.get("text"))[:500],
                               "verdict": {"correct": "correct", "incorrect": "wrong"}.get(a.get("verdict"), ""), "truth": a.get("truth_value") or ""})
            records.append({"project": it["project"], "source": s.name, "record": r["record"], "json": json.dumps(raw, ensure_ascii=False)})
    fields.sort(key=lambda x: (x["doubted"] != "yes", x["project"], x["source"], x["record"]))
    return {"sources": sources, "comments": comments, "fields": fields, "records": records}


def to_json(data: dict, meta: dict) -> bytes:
    return json.dumps({"about": README[0], "meta": meta, **data}, ensure_ascii=False, indent=1, default=str).encode("utf-8")


def to_xlsx(data: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Read me"
    for line in README:
        ws.append([line])
    ws["A1"].font = Font(bold=True, size=13)
    ws.column_dimensions["A"].width = 120

    def sheet(title, headers, rows):
        sh = wb.create_sheet(title)
        sh.append([h for h, _ in headers])
        for r in rows:
            sh.append([_cell(r.get(k)) for _, k in headers])
        for c in sh[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="2563EB")
        sh.freeze_panes = "A2"
        sh.auto_filter.ref = sh.dimensions
        for i, (h, k) in enumerate(headers, 1):
            longest = max([len(str(h))] + [len(str(_cell(r.get(k)))) for r in rows[:200]])
            sh.column_dimensions[get_column_letter(i)].width = min(max(longest + 2, 10), 60)
            for row in sh.iter_rows(min_row=2, min_col=i, max_col=i):
                for c in row:
                    c.alignment = Alignment(wrap_text=True, vertical="top")
                    if isinstance(c.value, str) and c.value.startswith("="):
                        c.data_type = "s"
        return sh

    sheet("Sources", [("Project", "project"), ("Source", "source"), ("Website", "website"), ("SOP", "sop"), ("Extractor", "extractor"), ("Peers", "peers"), ("Records", "records"),
                      ("Fields", "fields"), ("Doubted fields", "doubted"), ("Peer comments", "peer_comments"), ("Peer mentions", "peer_mentions"), ("Checked at source", "checked")], data["sources"])
    sheet("Peer comments", [("Project", "project"), ("Source", "source"), ("Record", "record"), ("Field", "field"), ("Reviewer", "by"), ("Role", "role"), ("Kind", "type"), ("Comment", "comment"), ("When", "when")], data["comments"])
    sheet("Fields", [("Project", "project"), ("Source", "source"), ("Website", "website"), ("Record", "record"), ("Field", "field"), ("Value", "value"), ("Doubted", "doubted"), ("Why doubted", "why"),
                     ("Peer says", "peer_says"), ("Peer mentioned in", "peer_mentioned_in"), ("Other flags", "other"), ("Admin verdict", "verdict"), ("Real value", "truth")], data["fields"])
    sheet("Records JSON", [("Project", "project"), ("Source", "source"), ("Record", "record"), ("Record JSON", "json")], data["records"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
