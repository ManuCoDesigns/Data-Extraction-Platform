#!/usr/bin/env python3
"""Patch 107: a field marked Correct can credit the reviewer whose flag led to the fix (also after it was already marked Correct). Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/api/v1/routes/quality.py': [('    credit = set(commenters) | {c for c in body.credit if c in _owner_ids(s)}\n', '    credit = set(commenters) | {c for c in body.credit if c in _owner_ids(s)}\n    explicit = {c for c in body.credit if c in _owner_ids(s) and c != s.assigned_extractor_id} if not wrong else set()   # the admin says: this reviewer was right and the extractor fixed it\n'), ('fixed = (not wrong) and not body.original_ok and f.extracted_value is not None and not _same(f.extracted_value, value)', 'fixed = (not wrong) and not body.original_ok and (f.raised_by in explicit or (f.extracted_value is not None and not _same(f.extracted_value, value)))'), ('            touched += 1\n            fixed_credit += 1 if fixed else 0\n    if wrong:\n', '            touched += 1\n            fixed_credit += 1 if fixed else 0\n        elif (not wrong) and f.raised_by in explicit and not f.fixed_before_final and not body.original_ok:\n            # Marked Correct earlier with no credit (the flag was counted as a false alarm). The admin now credits it.\n            f.status, f.fixed_before_final, f.category = "confirmed", True, "wrong_value"\n            f.truth_value, f.resolved_by, f.resolved_at = truth, user.id, now\n            f.resolve_note = "The reviewer was right. The extractor fixed it before the final review."\n            touched += 1\n            fixed_credit += 1\n    if wrong:\n'), ('        for uid in commenters:\n', '        for uid in set(commenters) | explicit:\n'), ('fixed = (not body.original_ok) and earlier is not _MISSING and not _same(earlier, value)', 'fixed = (not body.original_ok) and (uid in explicit or (earlier is not _MISSING and not _same(earlier, value)))'), ('extracted_value=earlier if fixed else value,', 'extracted_value=(earlier if earlier is not _MISSING else None) if fixed else value,')], 'frontend/src/components/enh/ReviewWorkspace.tsx': [('  const [credit, setCredit] = useState<string[]>([])\n', '  const [credit, setCredit] = useState<string[]>([])\n  const [fixCredit, setFixCredit] = useState<string[]>([])\n'), ("credit: v === 'incorrect' ? credit : [],", "credit: v === 'incorrect' ? credit : fixCredit,"), ('      {wrong && (\n', '      {pointers.length > 0 && verdict !== \'incorrect\' && (\n        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 flex-wrap" onClick={e => e.stopPropagation()}>\n          <span className="text-xs text-gray-500">Reviewer was right and the extractor fixed it. Credit the catch to:</span>\n          {pointers.map(([id, name]) => (\n            <label key={id} className="text-sm text-gray-700 inline-flex items-center gap-1.5"><input type="checkbox" checked={fixCredit.includes(id)} onChange={e => setFixCredit(c => (e.target.checked ? [...c, id] : c.filter(x => x !== id)))} />{name}</label>\n          ))}\n          {verdict === \'correct\' && <Button variant="secondary" disabled={busy || fixCredit.length === 0} onClick={() => mark(\'correct\')}>Save credit</Button>}\n          {verdict !== \'correct\' && <span className="text-xs text-gray-400">Applied when you press Correct.</span>}\n        </div>\n      )}\n      {wrong && (\n')]}
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
