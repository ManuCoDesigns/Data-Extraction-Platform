"""One-click reports and the team lead brief, all read live from the platform."""
import csv
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.v1.routes.enhancements import _need_lead, _visible_sources
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.all_models import User
from app.services import batch_report as br
from app.services import lead_brief as lb

router = APIRouter(prefix="/briefs", tags=["briefs"])

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _month_label(m: str) -> str:
    return f"{MONTHS[int(m[5:7]) - 1]} {m[:4]}"


def _now_month() -> str:
    return datetime.now(timezone(timedelta(hours=3))).strftime("%Y-%m")


def _prev(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


def _periods(srcs: list) -> dict:
    batches = [b for b in br.list_batches(srcs) if b["key"] != "other"]
    months: dict = {}
    for b in batches:
        m = months.setdefault(b["key"][:7], {"value": b["key"][:7], "label": _month_label(b["key"][:7]), "sources": 0, "delivered": 0, "batches": 0})
        m["sources"] += b["sources"]
        m["delivered"] += b["delivered"]
        m["batches"] += 1
    return {"months": sorted(months.values(), key=lambda m: m["value"], reverse=True), "batches": list(reversed(batches)), "this_month": _now_month(), "last_month": _prev(_now_month())}


def _scope(srcs: list, scope: str, value: str | None) -> tuple[list | None, dict]:
    p = _periods(srcs)
    have = {b["key"] for b in p["batches"]}
    if scope == "all":
        return None, {"kind": "all", "label": "Whole engagement"}
    if scope in ("month", "this_month", "last_month"):
        m = value if scope == "month" else (p["this_month"] if scope == "this_month" else p["last_month"])
        keys = [k for k in have if k.startswith(m or "~")]
        if not keys:
            raise HTTPException(status_code=404, detail=f"Nothing was pulled in {_month_label(m) if m else 'that month'}.")
        return keys, {"kind": "month", "value": m, "label": _month_label(m)}
    if scope == "latest":
        if not p["batches"]:
            raise HTTPException(status_code=404, detail="No pulls yet.")
        b = p["batches"][0]
        return [b["key"]], {"kind": "batch", "value": b["key"], "label": b["label"]}
    if scope == "batch":
        b = next((x for x in p["batches"] if x["key"] == value), None)
        if not b:
            raise HTTPException(status_code=404, detail="That batch has no sources you can see.")
        return [b["key"]], {"kind": "batch", "value": b["key"], "label": b["label"]}
    raise HTTPException(status_code=400, detail="Unknown report period.")


def _report(db: Session, user: User, project_id, scope: str, value) -> dict:
    from app.api.v1.routes.quality import _scorecard_data
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    if not srcs:
        raise HTTPException(status_code=404, detail="No sources yet.")
    keys, sc_info = _scope(srcs, scope, value)
    try:
        sc, _ = _scorecard_data(db, user, project_id, None, None, None)
    except Exception:
        sc = None
    return br.engagement(db, user, srcs, sc, keys=keys, scope=sc_info)


def _fmt(v, unit=" days"):
    return f"{v}{unit}" if v is not None else "n/a"


def summary_text(r: dict) -> str:
    t, tm = r["totals"], r.get("timing") or {}
    out = [f"*{r['scope']['label']}: delivery summary*", f"• {t['delivered']} of {t['sources']} sources delivered ({t['records_approved']} records approved)"]
    if t.get("final_accuracy") is not None:
        out.append(f"• Final accuracy {t['final_accuracy']}% across {t['fields']} checked fields")
    if tm.get("extraction"):
        e = tm["extraction"]
        out.append(f"• Extraction took {e['avg']} days on average (fastest {e['min']}, slowest {e['max']})")
    v = (tm.get("validation") or {})
    if (v.get("peer") or {}).get("submitted"):
        out.append(f"• {v['peer']['submitted']} peer reviews submitted; admin sign-off on every source")
    c = tm.get("corrections") or {}
    if c:
        out.append(f"• {c.get('records_returned', 0)} records came back for correction across {c.get('sources_returned', 0)} sources")
    if t.get("blocked"):
        out.append(f"• {t['blocked']} sources are blocked and need a decision")
    out.append("_Times are elapsed clock time from the platform, not hands-on hours._")
    return "\n".join(out)


@router.get("/periods")
def periods(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    return _periods(_visible_sources(db, user, project_id).all())


@router.get("/report")
def report(scope: str = "latest", value: str | None = None, project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _report(db, user, project_id, scope, value)
    r["summary_text"] = summary_text(r)
    return r


@router.get("/report.csv")
def report_csv(scope: str = "latest", value: str | None = None, project_id: str | None = None, anon: bool = False,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _report(db, user, project_id, scope, value)
    tm = r.get("timing") or {}
    alias: dict = {}

    def who(n):
        if not n:
            return ""
        if not anon:
            return n
        return alias.setdefault(n, f"Person {len(alias) + 1}")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Item", "Source", "Extractor", "Records", "Submitted", "Approved", "Extraction days", "Review days", "Total days", "Returned", "Peer reviews done", "Peer reviews assigned", "Days on hold"])
    for x in tm.get("per_source", []):
        w.writerow([x["item_no"] or "", x["name"], who(x["extractor"]), x["records"], x["submitted_at"] or "", x["approved_at"] or "", x["extraction_days"] if x["extraction_days"] is not None else "",
                    x["review_days"] if x["review_days"] is not None else "", x["total_days"] if x["total_days"] is not None else "", x["returns"], x["peers_done"], x["peers_total"], x["held_days"] or ""])
    w.writerow([])
    w.writerow(["Person", "Sources", "Records", "Avg extraction days", "Slowest", "Peer reviews done", "Avg peer review days"])
    for p in tm.get("people", []):
        e, v = p.get("extraction") or {}, p.get("review") or {}
        w.writerow([who(p["name"]), p["sources"], p["records"], e.get("avg", ""), e.get("max", ""), p["reviews_done"], v.get("avg", "")])
    w.writerow([])
    w.writerow([tm.get("caveat", "")])
    name = f"report_{(r['scope'].get('value') or 'all').replace(' ', '_')}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/lead")
def lead(project_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _need_lead(user)
    srcs = _visible_sources(db, user, project_id).all()
    b = lb.build(db, srcs)
    b["text"] = lb.text(b)
    return b
