"""Observations: the issues extractors and reviewers run into (page not accessible, login needed, no data...).
Recording them is a required step for the extractor and for every peer reviewer, and the reports are built from them."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.all_models import Source, SourceObservation, User

# key -> (label, group, blocking). Blocking kinds stop a source from moving until someone decides.
KINDS: dict[str, tuple[str, str, bool]] = {
    "not_accessible": ("Page not accessible", "Access", True),
    "login_required": ("Needs a login", "Access", True),
    "dead_link": ("Link is broken or moved", "Access", True),
    "blocked_robots": ("Blocked by robots.txt or bot protection", "Access", True),
    "paywall": ("Behind a paywall", "Access", True),
    "ssl_error": ("Certificate or SSL error", "Access", True),
    "blank_page": ("Blank or empty page", "Access", True),
    "no_data": ("No extractable data", "Content", True),
    "wrong_entity": ("Not the company or item expected", "Content", True),
    "schema_mismatch": ("Does not fit the schema or SOP", "Content", True),
    "data_conflict": ("Sources disagree with each other", "Content", False),
    "sop_unclear": ("The SOP is unclear here", "Content", False),
    "other": ("Something else", "Content", False),
}
NEED = {
    "Access": "A working link or access, or OK to skip",
    "Content": "A decision on how to treat this source",
}
LABEL = {k: v[0] for k, v in KINDS.items()}


def kind_list() -> list[dict]:
    return [{"key": k, "label": v[0], "group": v[1], "blocking": v[2]} for k, v in KINDS.items()]


def _is_admin(user: User) -> bool:
    return any((getattr(r, "role", None) and getattr(r.role, "value", r.role)) in ("org_admin", "project_admin") for r in user.roles)


def role_on(source: Source, user: User) -> str | None:
    """The part this person plays on the source, or None when they have no check to make."""
    if source.assigned_extractor_id == user.id:
        return "extractor"
    if any(p.user_id == user.id for p in source.peer_reviews):
        return "reviewer"
    return "admin" if _is_admin(user) else None


def rows_for(db: Session, source_ids: list[str]) -> list[SourceObservation]:
    return db.query(SourceObservation).filter(SourceObservation.source_id.in_(source_ids)).order_by(SourceObservation.created_at).all() if source_ids else []


def who_owes(source: Source, rows: list[SourceObservation]) -> list[dict]:
    """Everyone who has to make the check on this source and whether they have."""
    done = {r.user_id for r in rows if r.source_id == source.id}
    out = []
    if source.assigned_extractor_id:
        out.append({"user_id": source.assigned_extractor_id, "role": "extractor", "done": source.assigned_extractor_id in done})
    for p in source.peer_reviews:
        if p.user_id != source.assigned_extractor_id:
            out.append({"user_id": p.user_id, "role": "reviewer", "done": p.user_id in done})
    return out


def require_before_review(db: Session, source: Source, user: User) -> None:
    """A peer reviewer may not finish their review until the extractor and they themselves have recorded observations."""
    if _is_admin(user):
        return
    rows = rows_for(db, [source.id])
    owes = {o["user_id"]: o for o in who_owes(source, rows)}
    ext = owes.get(source.assigned_extractor_id)
    if ext and not ext["done"]:
        name = source.extractor.full_name if source.extractor else "The extractor"
        raise HTTPException(status_code=422, detail=f"{name} has not recorded their observations on this source yet. They have to do that first.")
    me = owes.get(user.id)
    if me and not me["done"]:
        raise HTTPException(status_code=422, detail="Record your observations first: open the Observations tab and list any issues you saw, or confirm you found none.")


def replace_mine(db: Session, source: Source, user: User, role: str, none: bool, items: list[dict]) -> list[SourceObservation]:
    """Set this person's observations on the source. Either 'no issues' or one or more issues, never both. Safe to repeat."""
    if none and items:
        raise HTTPException(status_code=422, detail="Choose either 'No issues found' or list the issues, not both.")
    if not none and not items:
        raise HTTPException(status_code=422, detail="List at least one issue, or confirm that you found no issues.")
    clean = []
    for it in items:
        k = str(it.get("kind") or "")
        if k not in KINDS:
            raise HTTPException(status_code=422, detail=f"Unknown kind: {k}")
        if k == "other" and not str(it.get("note") or "").strip():
            raise HTTPException(status_code=422, detail="Say what the issue was when you choose 'Something else'.")
        clean.append({"kind": k, "note": (str(it.get("note") or "").strip() or None), "record_id": it.get("record_id") or None})
    db.query(SourceObservation).filter(SourceObservation.source_id == source.id, SourceObservation.user_id == user.id).delete(synchronize_session=False)
    out = []
    for c in ([{"kind": "none", "note": None, "record_id": None}] if none else clean):
        o = SourceObservation(source_id=source.id, user_id=user.id, role=role, **c)
        db.add(o)
        out.append(o)
    db.flush()
    return out


def counts(rows: list[SourceObservation]) -> list[dict]:
    """Issues by kind, most common first (the 'no issues' confirmations are not issues)."""
    c: dict = {}
    for r in rows:
        if r.kind == "none":
            continue
        d = c.setdefault(r.kind, {"kind": r.kind, "label": LABEL.get(r.kind, r.kind), "group": KINDS.get(r.kind, ("", "Content", False))[1], "count": 0, "sources": set()})
        d["count"] += 1
        d["sources"].add(r.source_id)
    return sorted(({**d, "sources": len(d["sources"])} for d in c.values()), key=lambda d: -d["count"])
