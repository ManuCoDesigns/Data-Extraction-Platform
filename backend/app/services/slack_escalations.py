"""The escalations raised with Xtrium in the project chat, with the real times from Slack (Nairobi time), so the days waited are right.

Each entry: when it was raised, the first reply that did not yet answer it (if any), when it was really answered, and the Xtrium item
numbers it concerns. Loading is repeatable: an entry already in the project is skipped.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

NAIROBI = timezone(timedelta(hours=3))


def _t(s: str | None):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=NAIROBI) if s else None


# (raised, first_reply, answered, item_no or None, blocks_clock, topic, text)
ENTRIES = [
    ("2026-08-13 22:01", None, "2026-08-13 22:10", None, False, "Access", "A link opened with no content. Asked how to treat it."),
    ("2026-08-14 13:57", None, "2026-08-19 19:26", None, False, "Access", "Four sites could not be reached. Asked for working links or a decision."),
    ("2026-08-17 14:01", "2026-08-17 19:01", "2026-08-19 19:49", None, False, "Access", "A second list of unreachable sites. Asked for working links or a decision."),
    ("2026-09-09 09:48", None, "2026-09-11 23:57", None, False, "Access", "No links had been assigned. Followed up for the next set of sources."),
    ("2026-09-15 13:32", None, "2026-09-16 17:45", None, False, "SOP and schema", "Asked which SOP references apply to the sources. Chased on 16 Sep at 10:51."),
    ("2026-09-24 23:26", None, "2026-09-24 23:53", None, False, "Submission", "Submission with several records in one JSON was rejected. Asked how Xtrium expects it."),
    ("2026-09-28 20:57", None, "2026-09-28 22:25", None, False, "Submission", "The same submission problem again, and the tool could not reach Xtrium (reported 20:42, first answered 20:53)."),
    ("2026-10-08 00:57", "2026-10-08 02:57", "2026-10-10 22:25", None, False, "SOP and schema", "Asked for the SOPs of 14 sources. Chased on 8 Oct at 21:52. Confirmed visible in the platform on 10 Oct at 22:25."),
    ("2026-10-12 19:30", None, "2026-10-12 19:36", None, False, "Access", "A source had no link. Asked for one."),
    ("2026-10-14 23:41", None, "2026-10-14 23:54", None, False, "Process", "Asked how to record where a value came from (provenance)."),
    ("2026-10-15 00:06", None, "2026-10-16 20:19", None, False, "SOP and schema", "Five questions about the SOPs."),
    ("2026-10-15 21:50", None, "2026-10-19 11:54", 1050, True, "Classification", "MarketSegment classification for #1046 Panjiva, #1049 PubMed and #1050 The Lens. Answered by reclassification, seen at the sync on 19 Oct at the latest."),
    ("2026-10-19 11:54", None, "2026-10-20 18:46", None, False, "Process", "Question about 12 items found at the sync."),
    ("2026-10-23 11:57", None, "2026-10-29 01:36", None, False, "Process", "Asked for the next batch of sources."),
    ("2026-10-29 18:07", "2026-11-02 20:06", "2026-11-02 20:08", None, False, "Classification", "Batch 2 sources that were unclassified. Chased on 2 Nov at 20:06."),
    ("2026-10-29 18:07", None, None, 1051, True, "SOP and schema", "#1051 Espacenet and #1052 Google Patents have no applicable SOP. Chased on 2 Nov at 20:09, #1052 escalated as nothing to extract on 4 Nov, asked again on 11 Nov at 08:21."),
    ("2026-11-11 08:21", None, None, 1172, True, "Access", "#1172 MPDS needs a login and #1173 Matmatch has closed. Asked for a decision."),
]


def load(db, project_ids: set, user_id: str, default_project_id: str | None = None) -> dict:
    """Clear any Slack escalations loaded before, then load them again. Each one goes into the project of the source it concerns; the rest go to the default project."""
    from collections import Counter
    from app.models.all_models import ClientQuestion, Source

    texts = {e[6] for e in ENTRIES}
    gone = db.query(ClientQuestion).filter(ClientQuestion.project_id.in_(project_ids), ClientQuestion.kind != "question", ClientQuestion.question.in_(texts)).delete(synchronize_session=False)
    srcs = db.query(Source).filter(Source.project_id.in_(project_ids), Source.external_ref_id.isnot(None)).order_by(Source.created_at).all()
    by_item = {s.external_ref_id: s for s in srcs}
    default = default_project_id if default_project_id in project_ids else (Counter(s.project_id for s in srcs).most_common(1)[0][0] if srcs else None)
    if not default:
        db.rollback()
        return {"removed": 0, "added": 0, "linked": 0, "error": "No project to load into."}
    added = linked = 0
    for raised, reply, answered, item, blocks, topic, text in ENTRIES:
        src = by_item.get(str(item)) if item else None
        q = ClientQuestion(project_id=src.project_id if src else default, source_id=src.id if src else None, question=text, asked_by=user_id,
                           kind="blocker" if blocks else "escalation", blocks_clock=blocks, topic=topic, asked_at=_t(raised), sent_to_client_at=_t(raised), first_reply_at=_t(reply))
        if answered:
            q.status, q.answered_at, q.answered_by, q.answer = "answered", _t(answered), user_id, "Answered in the project chat."
        else:
            q.status = "open"
        db.add(q)
        added += 1
        linked += 1 if src else 0
    db.commit()
    return {"removed": gone, "added": added, "linked": linked, "unlinked_items": sorted({str(e[3]) for e in ENTRIES if e[3] and str(e[3]) not in by_item})}
