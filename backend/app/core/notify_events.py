"""Notifications that follow from a source changing, wherever in the code the change happens.

A listener notes every change to a source's status or extractor; just before the database write
it turns the changes into notices. Keeping this in one place means no code path can forget to tell
people (uploads, fixes, LLM verification, manual status changes, Xtrium all go through here).
"""
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.notify import ACTION, INFO, notify, src_link
from app.models.all_models import Source, new_uuid


def _val(x):
    return getattr(x, "value", x)


@event.listens_for(Source.status, "set", active_history=True)
def _status_set(target, value, old, initiator):
    if _val(value) != _val(old):
        target.__dict__.setdefault("_nx", []).append(("status", _val(old), _val(value)))


@event.listens_for(Source.assigned_extractor_id, "set", active_history=True)
def _extractor_set(target, value, old, initiator):
    if value and value != old:
        target.__dict__.setdefault("_nx", []).append(("extractor", old, value))


def _peer_ids(source) -> set:
    ids = {r.user_id for r in source.peer_reviews}
    if source.assigned_reviewer_id:
        ids.add(source.assigned_reviewer_id)
    ids.discard(source.assigned_extractor_id)
    return ids


@event.listens_for(Session, "before_flush")
def _notify_on_flush(session, flush_context, instances):
    for obj in list(session.new) + list(session.dirty):
        if not isinstance(obj, Source):
            continue
        events = obj.__dict__.pop("_nx", None)
        if not events:
            continue
        if obj.id is None:
            obj.id = new_uuid()
        link = src_link(obj)
        for what, old, new in events:
            if what == "extractor":
                notify(session, new, f"New source assigned: '{obj.name}'",
                       "This source is assigned to you. Open it to start extracting.",
                       link, "assigned", ACTION)
            elif new == "ready_for_review":
                for uid in _peer_ids(obj):
                    notify(session, uid, f"Ready for peer review: '{obj.name}'",
                           "Extraction is finished. Check the records, then submit your review with a comment.",
                           link, "ready_for_review", ACTION)
            elif new == "approved":
                for uid in ({obj.assigned_extractor_id} | _peer_ids(obj)) - {None}:
                    notify(session, uid, f"Approved: '{obj.name}'", "An admin approved this source. Nothing more to do.",
                           link, "approved", INFO)
