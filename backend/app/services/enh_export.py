"""Review notes for the client export: what each reviewer said, record by record."""
from app.models.all_models import ExtractedRecord, ExtractionJob


def review_notes(source, db):
    recs = (
        db.query(ExtractedRecord).join(ExtractionJob, ExtractedRecord.job_id == ExtractionJob.id)
        .filter(ExtractionJob.source_id == source.id).all()
    )
    rows = []
    for r in recs:
        fc = r.reviewer_field_comments or {}
        if r.review_note or r.admin_review_note or fc or (r.correction_count or 0) or (r.revision_count or 0):
            rows.append({
                "record": r.canonical_name or r.id, "status": r.review_status.value if hasattr(r.review_status, "value") else str(r.review_status),
                "reviewer_note": r.review_note, "admin_note": r.admin_review_note, "field_comments": fc,
                "times_sent_back": r.correction_count or 0, "times_revised": r.revision_count or 0,
            })
    md = [f"# Review notes: {source.name}", ""]
    md.append("## Peer review")
    if source.peer_reviews:
        for p in source.peer_reviews:
            who = p.user.full_name if p.user else "Reviewer"
            when = p.submitted_at.strftime("%Y-%m-%d %H:%M UTC") if p.submitted_at else "not submitted"
            md.append(f"- **{who}** ({p.status}, {when}): {p.comment or '(no comment)'}")
    else:
        md.append("- No peer reviewers were recorded.")
    md += ["", "## Record notes"]
    if not rows:
        md.append("- No record had review comments or corrections.")
    for x in rows:
        md.append(f"### {x['record']} ({x['status']})")
        if x["reviewer_note"]:
            md.append(f"- Reviewer: {x['reviewer_note']}")
        if x["admin_note"]:
            md.append(f"- Admin: {x['admin_note']}")
        for k, v in (x["field_comments"] or {}).items():
            md.append(f"- Field `{k}`: {v}")
        if x["times_sent_back"] or x["times_revised"]:
            md.append(f"- Sent back {x['times_sent_back']} time(s), revised {x['times_revised']} time(s)")
        md.append("")
    return "\n".join(md), {"peer_reviews": [
        {"reviewer": p.user.full_name if p.user else None, "status": p.status, "comment": p.comment, "submitted_at": p.submitted_at}
        for p in source.peer_reviews], "records": rows}
