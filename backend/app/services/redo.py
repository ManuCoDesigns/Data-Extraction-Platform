"""Shuffle a batch of sources for re-extraction.

Each source gets a new extractor and a new reviewer from the people you pick. The rules:
- Nobody extracts a source they extracted before.
- The reviewer is never the new extractor and never someone who extracted it before (and, when possible, not someone who reviewed it before).
- Everyone ends up with the same number of sources to extract and to review (the counts differ by one at most), and
  the load is balanced further by how big the earlier delivery was and how many links are dead, blocked or broken.
Pure functions, so the same seed always gives the same plan and "Shuffle again" is just a new seed.
"""
import random

PROBLEM_LINKS = {"dead", "blocked", "error", "login"}


def weight(src: dict) -> float:
    """Rough effort: bigger earlier deliveries and hard-to-open sites count for more."""
    return 1.0 + min(int(src.get("records") or 0), 20) / 20.0 + (0.5 if src.get("link") in PROBLEM_LINKS else 0.0)


def _quotas(n: int, people: list, rng: random.Random, base_load: dict | None = None) -> dict:
    """How many each person gets. Equal share, extras go to whoever has the least so far (combined load when base_load is given)."""
    q = {p: 0 for p in people}
    base = base_load or {}
    for _ in range(n):
        low = min(q[p] + base.get(p, 0) for p in people)
        q[rng.choice([p for p in people if q[p] + base.get(p, 0) == low])] += 1
    return q


def _match(items: list, allowed: dict, quota: dict, rng: random.Random):
    """Give every item to one allowed person without going over anyone's quota. Returns (item -> person, items left over)."""
    slots = [(p, i) for p, c in quota.items() for i in range(c)]
    rng.shuffle(slots)
    owner: dict = {}           # slot -> item
    adj = {it: [s for s in slots if s[0] in allowed[it]] for it in items}
    for it in adj:
        rng.shuffle(adj[it])

    def aug(it, seen):
        for s in adj[it]:
            if s in seen:
                continue
            seen.add(s)
            if s not in owner or aug(owner[s], seen):
                owner[s] = it
                return True
        return False

    order = sorted(items, key=lambda it: (len(adj[it]), rng.random()))   # the most restricted first
    left = [it for it in order if not aug(it, set())]
    return {it: s[0] for s, it in owner.items()}, left


def _improve(assign: dict, srcs: dict, allowed: dict, people: list, rounds: int = 3000, rng=None):
    """Swap sources between two people when it keeps every rule and makes the weighted load more even. Counts never change."""
    load = {p: 0.0 for p in people}
    for s, p in assign.items():
        load[p] += weight(srcs[s])
    items = list(assign)
    rng = rng or random.Random(0)
    for _ in range(rounds):
        a, b = rng.sample(items, 2) if len(items) > 1 else (None, None)
        if a is None:
            break
        pa, pb = assign[a], assign[b]
        if pa == pb or pb not in allowed[a] or pa not in allowed[b]:
            continue
        wa, wb = weight(srcs[a]), weight(srcs[b])
        before = (load[pa] - load[pb]) ** 2
        after = ((load[pa] - wa + wb) - (load[pb] - wb + wa)) ** 2
        if after + 1e-9 < before:
            assign[a], assign[b] = pb, pa
            load[pa] += wb - wa
            load[pb] += wa - wb
    return assign


def build_plan(sources: list[dict], extractors: list, reviewers: list, seed: int = 0) -> dict:
    """sources: [{id, name, prev_extractors:set, prev_reviewers:set, records:int, link:str, members:set|None}]
    extractors / reviewers: lists of user ids. Returns {"assignments": [{source_id, extractor, reviewer}], "unassigned": [...], "notes": [...]}"""
    rng = random.Random(seed)
    srcs = {s["id"]: s for s in sources}
    ids = list(srcs)
    notes: list[str] = []
    if not ids or not extractors:
        return {"assignments": [], "unassigned": [{"source_id": i, "why": "Nobody picked to extract"} for i in ids], "notes": notes}

    def ext_ok(s):
        return {p for p in extractors if p not in s["prev_extractors"] and (s.get("members") is None or p in s["members"])}

    allowed_e = {i: ext_ok(srcs[i]) for i in ids}
    stuck = [i for i in ids if not allowed_e[i]]
    work = [i for i in ids if allowed_e[i]]
    best = None
    for attempt in range(40):
        quota = _quotas(len(work), extractors, rng)
        got, left = _match(work, allowed_e, quota, rng)
        if best is None or len(left) < len(best[1]):
            best = (got, left)
        if not left:
            break
    got, left = best
    if left:                                      # equal shares are impossible with these rules: loosen the share, keep the rules
        cap = {p: len(work) for p in extractors}
        got, left = _match(work, allowed_e, cap, rng)
        notes.append("The rules (nobody repeats a source) do not allow perfectly equal shares, so the counts differ by more than one.")
    assign_e = _improve(dict(got), srcs, allowed_e, extractors, rng=rng)
    unassigned = [{"source_id": i, "why": "Everyone picked has already extracted it, or is not on its project"} for i in stuck + left]

    e_load = {p: 0 for p in reviewers}
    for s, p in assign_e.items():
        if p in e_load:
            e_load[p] += 1
    done = list(assign_e)
    assign_r: dict = {}
    for strict in (True, False):
        def rev_ok(s):
            ex = assign_e[s]
            bad = set(s_["prev_extractors"]) | {ex}
            if strict:
                bad |= set(s_["prev_reviewers"])
            return {p for p in reviewers if p not in bad and (s_.get("members") is None or p in s_["members"])}
        allowed_r = {}
        for i in done:
            s_ = srcs[i]
            allowed_r[i] = rev_ok(i)
        best = None
        for attempt in range(40):
            quota = _quotas(len(done), reviewers, rng, base_load=e_load) if reviewers else {}
            got_r, left_r = _match(done, allowed_r, quota, rng) if reviewers else ({}, list(done))
            if best is None or len(left_r) < len(best[1]):
                best = (got_r, left_r)
            if not left_r:
                break
        got_r, left_r = best
        if left_r and reviewers:
            cap = {p: len(done) for p in reviewers}
            got_r2, left_r2 = _match(done, allowed_r, cap, rng)
            if len(left_r2) < len(left_r):
                got_r, left_r = got_r2, left_r2
        assign_r, missing = got_r, left_r
        if not missing:
            if not strict:
                notes.append("Some reviewers had reviewed these sources before; it could not be avoided while keeping the shares equal.")
            break
    out = [{"source_id": i, "extractor": assign_e[i], "reviewer": assign_r.get(i)} for i in done]
    for i in done:
        if i not in assign_r:
            unassigned.append({"source_id": i, "why": "No reviewer is allowed for it (extractor and earlier extractors cannot review it)", "partial": True})
    return {"assignments": out, "unassigned": unassigned, "notes": notes}
