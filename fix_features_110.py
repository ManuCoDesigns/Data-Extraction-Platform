#!/usr/bin/env python3
"""Patch 110: the reports show categories (Organization, Material, ...) taken from the source or its SOP, instead of Unclassified, with a categories slide. Needs patches 96 and 109. Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/services/batch_report.py': [('def _days(a, b):\n', 'def category_of(s) -> str:\n    """What the source is: the category on the source, or, when that is empty or Unclassified, the entity of the SOP Xtrium attached."""\n    c = (getattr(s, "category", None) or "").strip()\n    if c and c.lower() != "unclassified":\n        return c\n    saved = getattr(s, "xtrium_sop", None)\n    saved = saved if isinstance(saved, dict) else {}\n    sop = saved.get("sop") if isinstance(saved.get("sop"), dict) else {}\n    meta = saved.get("meta") if isinstance(saved.get("meta"), dict) else {}\n    return str(sop.get("entity") or meta.get("target_entity") or "").strip() or "Unclassified"\n\n\ndef _days(a, b):\n'), ('            "type": s.type or (s.schema.name if s.schema else None), "sop":', '            "type": s.type or (s.schema.name if s.schema else None), "category": category_of(s), "sop":'), ('        t = by_type.setdefault(r["type"] or "Not set", {"type": r["type"] or "Not set", "total": 0, "delivered": 0})', '        t = by_type.setdefault(r["category"], {"type": r["category"], "total": 0, "delivered": 0})     # grouped by category, so the report says Organization or Material, not Unclassified'), ('    all_obs = obs.rows_for(db, ids)\n    stage_tot: dict = {}', '    cat_tot: dict = {}\n    for r in reps:\n        for x in r["sources"]:\n            d = cat_tot.setdefault(x["category"], {"category": x["category"], "total": 0, "delivered": 0, "records": 0})\n            d["total"] += 1\n            d["delivered"] += 1 if x["stage"] == "delivered" else 0\n            d["records"] += x["approved"] or 0\n    by_category = sorted(cat_tot.values(), key=lambda d: (d["category"] == "Unclassified", -d["total"], d["category"]))\n\n    all_obs = obs.rows_for(db, ids)\n    stage_tot: dict = {}'), ('"stages": stages_all, "observations": obs.counts(all_obs),', '"stages": stages_all, "by_category": by_category, "observations": obs.counts(all_obs),')], 'frontend/src/components/enh/reports/EngagementDeck.tsx': [('      {/* 7. challenges */}\n', '      {/* 6b. categories */}\n      {(e.by_category ?? []).length > 0 && (\n        <Frame n={next()} project={project} title={`${e.by_category.length} ${e.by_category.length === 1 ? \'category\' : \'categories\'} of work`} lede="What kind of record each source is, taken from the SOP Xtrium attached. The ring shows how much of each category is delivered.">\n          <div style={{ display: \'grid\', gridTemplateColumns: \'repeat(5,1fr)\', gap: 18 }}>\n            {e.by_category.slice(0, 10).map((c: any) => (\n              <div key={c.category} style={{ background: PALE, borderRadius: 14, padding: \'26px 8px 20px\', textAlign: \'center\' }}>\n                <div style={{ display: \'flex\', justifyContent: \'center\' }}><Ring pct={(100 * c.delivered) / c.total} size={120} stroke={12} color={BLUE} track="#fff" label={`${c.delivered}/${c.total}`} /></div>\n                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>{c.category}</div>\n                <div style={{ fontSize: 14, color: MUTE }}>{c.records} {c.records === 1 ? \'record\' : \'records\'} approved</div>\n              </div>\n            ))}\n          </div>\n        </Frame>\n      )}\n\n      {/* 7. challenges */}\n')]}
root = os.getcwd()
if not (os.path.isdir(os.path.join(root, 'backend')) and os.path.isdir(os.path.join(root, 'frontend'))):
    sys.exit('Run this from the repo root (the folder containing backend and frontend).')
def rd(p): return open(p, encoding='utf-8', newline='').read()
done = skipped = 0; bad = []
for rel, hunks in MOD.items():
    p = os.path.join(root, rel)
    if not os.path.exists(p): bad.append(rel + ' (missing)'); continue
    raw = rd(p); crlf = '\r\n' in raw; t = raw.replace('\r\n', '\n'); changed = False
    for old, new in hunks:
        if new in t and not (new in old and new != old): continue
        elif t.count(old) == 1: t = t.replace(old, new); changed = True
        elif new in t: continue
        else: bad.append(rel + ' (a section does not match; file differs from expected version)'); break
    else:
        if changed:
            open(p, 'w', encoding='utf-8', newline='').write(t.replace('\n', '\r\n') if crlf else t); done += 1; print('updated ', rel)
        else: skipped += 1
for rel, blob in NEW.items():
    p = os.path.join(root, rel); data = zlib.decompress(base64.b64decode(blob))
    if os.path.exists(p) and open(p, 'rb').read() == data: skipped += 1; continue
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(data); done += 1; print('wrote   ', rel)
print(f'\n{done} changed, {skipped} already applied.')
if bad:
    print('\nPROBLEMS:'); [print(' -', b) for b in bad]; sys.exit(1)
