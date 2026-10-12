"""Logic behind the extra tools: link checks, upload warnings, duplicates, digest, reminders, people stats, 2-step sign-in."""
import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import socket
import struct
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.notify import notify, admin_user_ids, src_link, ACTION, INFO
from app.core.source_access import restrict_sources_query
from app.models.all_models import (
    ExtractedRecord, ExtractionJob, Project, ReminderLog, ReviewStatus, Source, SourceLinkCheck,
    SourcePeerReview, SourceStatus, User,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ─── Link checks ─────────────────────────────────────────────────────────────

LOGIN_PATH = re.compile(r"/(log-?in|sign-?in|signin|sso|auth|account/login|users/sign_in|session/new)(/|$|\?)", re.I)
LOGIN_TEXT = re.compile(r"(type=[\"']password[\"']|please (log|sign) ?in|sign in to (continue|view|read|access)|log in to (continue|view|read|access)"
                        r"|subscribe to (read|continue)|members only|create an account to)", re.I)
BLOCK_TEXT = re.compile(r"(just a moment|attention required|access denied|verify you are (a )?human|captcha|request blocked)", re.I)
UA = "Mozilla/5.0 (compatible; DataExtractionLinkCheck/1.0)"


def _public_host(host: str) -> bool:
    """Don't let the checker be pointed at the server's own network."""
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except socket.gaierror:
        return True   # let the request itself report "not found"


def check_url(url: str) -> dict:
    url = (url or "").strip()
    if not url:
        return {"status": "unchecked", "detail": "No link on this source", "http_code": None, "final_url": None}
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    host = urlparse(url).hostname or ""
    if not host:
        return {"status": "dead", "detail": "That doesn't look like a web address", "http_code": None, "final_url": None}
    if not _public_host(host):
        return {"status": "error", "detail": "Address points to a private network, not checked", "http_code": None, "final_url": None}
    try:
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(10.0, connect=6.0), headers={"User-Agent": UA, "Accept": "text/html,*/*"}, verify=True) as c:
            with c.stream("GET", url) as r:
                code = r.status_code
                final = str(r.url)
                ctype = r.headers.get("content-type", "")
                body = ""
                if "html" in ctype or "text" in ctype:
                    chunk = b""
                    for part in r.iter_bytes():
                        chunk += part
                        if len(chunk) > 80_000:
                            break
                    body = chunk.decode("utf-8", errors="ignore")
    except httpx.ConnectError as e:
        msg = str(e).lower()
        if "name or service" in msg or "nodename" in msg or "getaddrinfo" in msg or "resolve" in msg:
            return {"status": "dead", "detail": "Site not found (domain doesn't exist)", "http_code": None, "final_url": None}
        return {"status": "error", "detail": "Could not connect to the site", "http_code": None, "final_url": None}
    except httpx.TimeoutException:
        return {"status": "error", "detail": "The site took too long to answer", "http_code": None, "final_url": None}
    except httpx.TooManyRedirects:
        return {"status": "error", "detail": "Redirects in a loop", "http_code": None, "final_url": None}
    except Exception as e:
        return {"status": "error", "detail": f"Could not check: {type(e).__name__}", "http_code": None, "final_url": None}

    looks_login = bool(LOGIN_PATH.search(urlparse(final).path + ("?" if urlparse(final).query else ""))) or bool(LOGIN_TEXT.search(body))
    sent_to_login = bool(LOGIN_PATH.search(urlparse(final).path)) and not LOGIN_PATH.search(urlparse(url).path)
    if sent_to_login and code < 500:
        return {"status": "login", "detail": "Redirects to a sign-in page", "http_code": code, "final_url": final}
    if code in (404, 410):
        return {"status": "dead", "detail": f"Page not found ({code})", "http_code": code, "final_url": final}
    if code == 401:
        return {"status": "login", "detail": "Needs a sign-in (401)", "http_code": code, "final_url": final}
    if code == 403:
        if looks_login:
            return {"status": "login", "detail": "Needs a sign-in (403)", "http_code": code, "final_url": final}
        return {"status": "blocked", "detail": "Site refuses automated access (403); may open fine in a browser", "http_code": code, "final_url": final}
    if code in (429, 999) or (code in (503, 520, 521, 522, 523, 524) and BLOCK_TEXT.search(body)):
        return {"status": "blocked", "detail": f"Site is limiting automated access ({code}); try in a browser", "http_code": code, "final_url": final}
    if code >= 500:
        return {"status": "error", "detail": f"Site error ({code})", "http_code": code, "final_url": final}
    if code >= 400:
        return {"status": "error", "detail": f"Unexpected answer ({code})", "http_code": code, "final_url": final}
    if BLOCK_TEXT.search(body[:4000]) and len(body) < 20000:
        return {"status": "blocked", "detail": "Shows a bot check; open it in a browser", "http_code": code, "final_url": final}
    if looks_login:
        return {"status": "login", "detail": "Opens a sign-in or subscription page", "http_code": code, "final_url": final}
    return {"status": "ok", "detail": "Opens normally", "http_code": code, "final_url": final}


def run_link_checks(db: Session, sources: list, user_id: str | None, force: bool = False) -> list[dict]:
    """Check these sources' links (8 at a time) and store the result. Manual marks are kept unless force."""
    existing = {c.source_id: c for c in db.query(SourceLinkCheck).filter(SourceLinkCheck.source_id.in_([s.id for s in sources])).all()} if sources else {}
    todo = [s for s in sources if force or not (existing.get(s.id) and existing[s.id].manual)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda s: check_url(s.website_url or ""), todo))
    out = []
    for s, res in zip(todo, results):
        row = existing.get(s.id) or SourceLinkCheck(source_id=s.id)
        row.url, row.status, row.http_code = s.website_url, res["status"], res["http_code"]
        row.detail, row.final_url, row.manual = res["detail"], res["final_url"], False
        row.checked_at, row.checked_by = now_utc(), user_id
        db.add(row)
        out.append({"source_id": s.id, **res})
    db.commit()
    return out


# ─── Upload warnings and duplicates ──────────────────────────────────────────

NAME_KEYS = ("canonical_name", "company_name", "material_name", "name")
JSON_LIST_KEYS = ("items", "records", "data", "rows", "suppliers", "materials")


def norm_name(v) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def analyse_upload(db: Session, source: Source, job_id: str, rows: list, ext: str, raw_entries, files_processed: int) -> list[str]:
    warnings: list[str] = []

    if source.external_system and files_processed == 1 and len(rows) > 1:
        warnings.append(f"This one file produced {len(rows)} records. Xtrium items are normally one record each. If this is meant to be a bundle, check with Xtrium that they accept it.")

    # lists in a JSON file that were not read
    if ext == ".json" and raw_entries and len(raw_entries) == 1 and raw_entries[0].get("content"):
        try:
            data = json.loads(raw_entries[0]["content"].decode("utf-8"))
            if isinstance(data, dict):
                used = next((k for k in JSON_LIST_KEYS if isinstance(data.get(k), list)), None)
                extra = [(k, len(v)) for k, v in data.items() if isinstance(v, list) and v and k != used]
                if extra:
                    names = ", ".join(f"'{k}' ({n} items)" for k, n in extra[:5])
                    which = f"the list '{used}'" if used else "the top-level fields"
                    warnings.append(f"The file also holds other lists that were NOT read: {names}. Only {which} became records.")
        except Exception:
            pass

    recs = db.query(ExtractedRecord.canonical_name).filter(ExtractedRecord.job_id == job_id).all()
    names = [norm_name(r[0]) for r in recs if r[0]]
    dup_in = [(n, c) for n, c in Counter(names).items() if c > 1]
    if dup_in:
        dup_in.sort(key=lambda x: -x[1])
        sample = ", ".join(f"'{n}' x{c}" for n, c in dup_in[:3])
        warnings.append(f"{len(dup_in)} name(s) appear more than once in this upload (for example {sample}). Check whether they are real duplicates.")

    if names:
        uniq = list(set(names))
        other = (
            db.query(ExtractedRecord.canonical_name, Source.name)
            .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
            .join(Source, ExtractionJob.source_id == Source.id)
            .filter(Source.project_id == source.project_id, Source.id != source.id,
                    func.lower(ExtractedRecord.canonical_name).in_(uniq[:500]))
            .limit(400).all()
        )
        seen: dict[str, set] = defaultdict(set)
        for cn, sname in other:
            seen[norm_name(cn)].add(sname)
        if seen:
            ex_name, ex_src = next(iter(seen.items()))
            warnings.append(f"{len(seen)} record name(s) already exist in other sources of this project (for example '{ex_name}' in '{sorted(ex_src)[0]}'). See Data health, Duplicates.")
    return warnings


def find_duplicates(db: Session, user: User, project_id: str | None, limit: int = 100) -> list[dict]:
    """Names that appear on more than one record, across sources or inside one."""
    q = (
        db.query(ExtractedRecord.id, ExtractedRecord.canonical_name, ExtractedRecord.review_status, Source.id, Source.name, Source.project_id)
        .join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .join(Source, ExtractionJob.source_id == Source.id)
        .filter(ExtractedRecord.canonical_name != None)  # noqa: E711
    )
    q = restrict_sources_query(q, user, db)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    groups: dict[tuple, list] = defaultdict(list)
    for rid, cn, rs, sid, sname, pid in q.all():
        key = (pid, norm_name(cn))
        if key[1]:
            groups[key].append({"record_id": rid, "source_id": sid, "source_name": sname, "status": rs.value if hasattr(rs, "value") else str(rs)})
    out = []
    for (pid, name), items in groups.items():
        if len(items) > 1:
            srcs = {i["source_id"] for i in items}
            out.append({"name": name, "project_id": pid, "count": len(items), "source_count": len(srcs),
                        "kind": "across sources" if len(srcs) > 1 else "inside one source",
                        "items": items[:12]})
    out.sort(key=lambda g: (-g["source_count"], -g["count"], g["name"]))
    return out[:limit]


# ─── Where is each source waiting? (digest, reminders) ───────────────────────

def stage_since(s: Source):
    st = s.status
    if st == SourceStatus.NOT_STARTED:
        return aware(s.created_at)
    if st == SourceStatus.EXTRACTING:
        return aware(s.extraction_started_at or s.updated_at)
    if st == SourceStatus.READY_FOR_REVIEW:
        return aware(s.extraction_completed_at or s.updated_at)
    if st == SourceStatus.IN_REVIEW:
        return aware(s.review_started_at or s.updated_at)
    if st == SourceStatus.LLM_VERIFICATION:
        return aware(s.llm_verification_started_at or s.updated_at)
    return aware(s.updated_at)   # needs_fixes, changes_requested


def level_for(days: float) -> str:
    return "red" if days >= 7 else "amber" if days >= 3 else "ok"


def waiting_items(db: Session, sources: list) -> list[dict]:
    """One row per (source, person who has to act)."""
    now = now_utc()
    pnames: dict[str, str] = {}
    projects = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({s.project_id for s in sources})).all()} if sources else {}

    def uname(uid):
        if uid not in pnames:
            u = db.query(User).filter(User.id == uid).first()
            pnames[uid] = u.full_name if u else "Unknown"
        return pnames[uid]

    rows = []
    for s in sources:
        since = stage_since(s) or now
        days = max(0.0, (now - since).total_seconds() / 86400)
        base = {"source_id": s.id, "source_name": s.name, "project_id": s.project_id,
                "project_name": projects.get(s.project_id, ""), "since": since.isoformat(), "days": round(days, 1), "level": level_for(days)}
        st = s.status
        if st in (SourceStatus.NOT_STARTED, SourceStatus.EXTRACTING, SourceStatus.NEEDS_FIXES, SourceStatus.CHANGES_REQUESTED):
            stage = {"not_started": "Waiting to start", "extracting": "Extracting", "needs_fixes": "Fixing errors", "changes_requested": "Making corrections"}[st.value]
            if s.assigned_extractor_id:
                rows.append({**base, "user_id": s.assigned_extractor_id, "name": uname(s.assigned_extractor_id), "role": "extractor", "stage": stage})
            else:
                rows.append({**base, "user_id": None, "name": "Nobody yet", "role": "unassigned", "stage": "No extractor assigned"})
        elif st in (SourceStatus.READY_FOR_REVIEW, SourceStatus.IN_REVIEW):
            pending = [r for r in s.peer_reviews if r.status != "submitted"]
            if pending:
                for r in pending:
                    ref = aware(r.created_at) if aware(r.created_at) and aware(r.created_at) > since else since
                    d = max(0.0, (now - ref).total_seconds() / 86400)
                    rows.append({**base, "since": ref.isoformat(), "days": round(d, 1), "level": level_for(d),
                                 "user_id": r.user_id, "name": uname(r.user_id), "role": "peer reviewer", "stage": "Peer review"})
            elif s.peer_reviews or s.assigned_reviewer_id is None:
                rows.append({**base, "user_id": None, "name": "Admin sign-off", "role": "admin", "stage": "Ready for sign-off" if s.peer_reviews else "No reviewer assigned"})
            else:
                rows.append({**base, "user_id": s.assigned_reviewer_id, "name": uname(s.assigned_reviewer_id), "role": "peer reviewer", "stage": "Review"})
        elif st == SourceStatus.LLM_VERIFICATION:
            rows.append({**base, "user_id": None, "name": "AI check", "role": "system", "stage": "AI verification"})
    return rows


def build_digest(db: Session, user: User, project_id: str | None = None) -> dict:
    q = db.query(Source)
    q = restrict_sources_query(q, user, db)
    if project_id:
        q = q.filter(Source.project_id == project_id)
    allsrc = q.all()
    open_src = [s for s in allsrc if s.status != SourceStatus.APPROVED]
    rows = waiting_items(db, open_src)

    people: dict[str, dict] = {}
    for r in rows:
        key = r["user_id"] or r["name"]
        p = people.setdefault(key, {"user_id": r["user_id"], "name": r["name"], "role": r["role"], "items": [], "oldest_days": 0.0})
        p["items"].append(r)
        p["oldest_days"] = max(p["oldest_days"], r["days"])
    plist = sorted(people.values(), key=lambda p: (-p["oldest_days"], -len(p["items"])))
    for p in plist:
        p["count"] = len(p["items"])
        p["items"].sort(key=lambda i: -i["days"])
        p["level"] = level_for(p["oldest_days"])

    now = now_utc()
    appr = [s for s in allsrc if s.status == SourceStatus.APPROVED and s.approved_at]
    day = [s for s in appr if aware(s.approved_at) >= now - timedelta(days=1)]
    week = [s for s in appr if aware(s.approved_at) >= now - timedelta(days=7)]
    overdue = [r for r in rows if r["level"] != "ok"]
    return {
        "generated_at": now.isoformat(),
        "totals": {"open": len(open_src), "overdue": len([r for r in overdue if r["level"] == "amber"]),
                   "critical": len([r for r in overdue if r["level"] == "red"]),
                   "approved_24h": len(day), "approved_7d": len(week),
                   "unassigned": len([r for r in rows if r["role"] == "unassigned"]),
                   "signoff": len([r for r in rows if r["role"] == "admin"])},
        "people": plist,
        "overdue": sorted(overdue, key=lambda r: -r["days"])[:30],
        "approved": [{"source_id": s.id, "source_name": s.name, "project_id": s.project_id, "approved_at": aware(s.approved_at).isoformat(),
                      "records": s.approved_records or 0} for s in sorted(day, key=lambda x: x.approved_at, reverse=True)],
    }


def digest_text(d: dict) -> tuple[str, str]:
    t = d["totals"]
    lines = [f"Open sources: {t['open']}   Overdue (3+ days): {t['overdue']}   Critical (7+ days): {t['critical']}",
             f"Approved in the last 24 hours: {t['approved_24h']}   Last 7 days: {t['approved_7d']}",
             f"Waiting for admin sign-off: {t['signoff']}   Without an extractor: {t['unassigned']}", ""]
    if d["overdue"]:
        lines.append("Waiting longest:")
        for r in d["overdue"][:10]:
            lines.append(f"  - {r['source_name']}: {r['stage']}, {r['name']}, {r['days']} days")
        lines.append("")
    if d["people"]:
        lines.append("Who has what:")
        for p in d["people"][:12]:
            lines.append(f"  - {p['name']}: {p['count']} ({p['role']}), oldest {p['oldest_days']} days")
    text = "\n".join(lines)
    from html import escape
    rows = "".join(f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0'>{escape(r['source_name'])}</td>"
                   f"<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0'>{escape(r['name'])}</td>"
                   f"<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;color:{'#dc2626' if r['level']=='red' else '#d97706'};font-weight:600'>{r['days']} d</td></tr>"
                   for r in d["overdue"][:10])
    html = (f"<div style='font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a'>"
            f"<h2 style='margin:0 0 4px'>Daily digest</h2><p style='color:#64748b;margin:0 0 16px;font-size:13px'>What is waiting on whom</p>"
            f"<p style='font-size:14px;line-height:1.7'><b>{t['open']}</b> open &middot; <b style='color:#d97706'>{t['overdue']}</b> overdue &middot; "
            f"<b style='color:#dc2626'>{t['critical']}</b> critical &middot; <b style='color:#059669'>{t['approved_24h']}</b> approved in 24h &middot; "
            f"<b>{t['signoff']}</b> waiting for sign-off</p>"
            + (f"<table style='border-collapse:collapse;width:100%;font-size:13px;margin-top:12px'>{rows}</table>" if rows else "<p>Nothing is overdue.</p>")
            + "</div>")
    return text, html


# ─── Reminders ───────────────────────────────────────────────────────────────

def _once(db: Session, key: str) -> bool:
    if db.query(ReminderLog.key).filter(ReminderLog.key == key).first():
        return False
    db.add(ReminderLog(key=key))
    return True


def run_reminders(db: Session) -> dict:
    """Nudge people whose work has been waiting 3+ days; tell admins when it reaches 7+. At most once a day per item."""
    today = now_utc().strftime("%Y-%m-%d")
    sources = db.query(Source).filter(Source.status != SourceStatus.APPROVED).all()
    sent = {"people": 0, "admins": 0}
    for r in waiting_items(db, sources):
        if r["level"] == "ok":
            continue
        days = int(r["days"])
        link = f"/projects/{r['project_id']}/sources/{r['source_id']}"
        if r["user_id"] and r["role"] in ("extractor", "peer reviewer"):
            if _once(db, f"p:{r['source_id']}:{r['user_id']}:{today}"):
                what = "peer review" if r["role"] == "peer reviewer" else "work"
                if notify(db, r["user_id"], f"Reminder: {what} waiting on you ({days} days): '{r['source_name']}'",
                          f"{r['stage']} has been waiting {days} days. Please pick it up, or tell your admin if you are stuck.",
                          link, "reminder", ACTION):
                    sent["people"] += 1
        if r["level"] == "red" or r["role"] in ("admin", "unassigned"):
            for uid in admin_user_ids(db, r["project_id"]):
                if _once(db, f"a:{r['source_id']}:{r['user_id'] or r['role']}:{uid}:{today}"):
                    who = r["name"]
                    if notify(db, uid, f"Stalled {days} days: '{r['source_name']}'",
                              f"{r['stage']}: waiting on {who}.", link, "stalled", ACTION):
                        sent["admins"] += 1
    db.commit()
    return sent


# ─── People stats ────────────────────────────────────────────────────────────

def people_stats(db: Session, since: datetime, project_id: str | None = None, only_user: str | None = None, viewer: User | None = None) -> list[dict]:
    sq = db.query(Source)
    if viewer is not None:
        sq = restrict_sources_query(sq, viewer, db)
    if project_id:
        sq = sq.filter(Source.project_id == project_id)
    sources = sq.all()
    sids = [s.id for s in sources]
    by: dict[str, dict] = {}

    def row(uid):
        if uid not in by:
            u = db.query(User).filter(User.id == uid).first()
            by[uid] = {"user_id": uid, "name": u.full_name if u else "Unknown", "email": u.email if u else None,
                       "ext_assigned": 0, "ext_open": 0, "ext_delivered": 0, "ext_hours": [], "records": 0, "returned": 0,
                       "peer_assigned": 0, "peer_submitted": 0, "peer_pending": 0, "peer_hours": []}
        return by[uid]

    if not sids:
        return []
    rec = (db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id))
           .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id).filter(ExtractionJob.source_id.in_(sids))
           .group_by(ExtractionJob.source_id).all())
    total_by_src = {sid: n for sid, n in rec}
    ret_rows = (db.query(ExtractionJob.source_id, func.count(ExtractedRecord.id))
                .join(ExtractedRecord, ExtractedRecord.job_id == ExtractionJob.id)
                .filter(ExtractionJob.source_id.in_(sids), or_(ExtractedRecord.correction_count > 0, ExtractedRecord.revision_count > 0))
                .group_by(ExtractionJob.source_id).all())
    ret_by_src = {sid: n for sid, n in ret_rows}

    for s in sources:
        if s.assigned_extractor_id and (not only_user or s.assigned_extractor_id == only_user):
            r = row(s.assigned_extractor_id)
            r["ext_assigned"] += 1
            if s.status == SourceStatus.APPROVED:
                if s.approved_at and aware(s.approved_at) >= since:
                    r["ext_delivered"] += 1
            else:
                r["ext_open"] += 1
            if s.extraction_started_at and s.extraction_completed_at and aware(s.extraction_completed_at) >= since:
                r["ext_hours"].append((aware(s.extraction_completed_at) - aware(s.extraction_started_at)).total_seconds() / 3600)
            if aware(s.updated_at) and aware(s.updated_at) >= since or s.status != SourceStatus.APPROVED:
                r["records"] += total_by_src.get(s.id, 0)
                r["returned"] += ret_by_src.get(s.id, 0)
        for p in s.peer_reviews:
            if only_user and p.user_id != only_user:
                continue
            r = row(p.user_id)
            r["peer_assigned"] += 1
            if p.status == "submitted":
                if p.submitted_at and aware(p.submitted_at) >= since:
                    r["peer_submitted"] += 1
                    if p.created_at:
                        r["peer_hours"].append(max(0.0, (aware(p.submitted_at) - aware(p.created_at)).total_seconds() / 3600))
            else:
                r["peer_pending"] += 1

    out = []
    for r in by.values():
        eh, ph = r.pop("ext_hours"), r.pop("peer_hours")
        r["avg_extract_hours"] = round(sum(eh) / len(eh), 1) if eh else None
        r["avg_peer_hours"] = round(sum(ph) / len(ph), 1) if ph else None
        r["first_pass_rate"] = round(100 * (1 - r["returned"] / r["records"]), 1) if r["records"] else None
        out.append(r)
    out.sort(key=lambda r: -(r["ext_delivered"] + r["peer_submitted"]))
    return out


# ─── Two-step sign-in (authenticator app codes) ──────────────────────────────

def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[off:off + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def totp_now(secret: str, at: float | None = None) -> str:
    return _hotp(secret, int((at or time.time()) // 30))


def verify_totp(secret: str, code: str) -> bool:
    code = re.sub(r"\D", "", code or "")
    if len(code) != 6 or not secret:
        return False
    t = int(time.time() // 30)
    return any(hmac.compare_digest(_hotp(secret, t + d), code) for d in (-1, 0, 1))


def totp_uri(secret: str, email: str) -> str:
    from urllib.parse import quote
    return f"otpauth://totp/{quote('Data Extraction')}:{quote(email)}?secret={secret}&issuer={quote('Data Extraction')}"
