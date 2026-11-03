#!/usr/bin/env python3
"""Patch 105: the Review page hides projects with no sources (with a note and a link to delete them) and no longer lists deleted projects. Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/api/v1/routes/quality.py': [('        pids |= {p.id for p in db.query(Project.id).all()}\n    _prj = db.query(Project).filter(Project.id.in_(pids)).all() if pids else []', '        pids |= {p.id for p in db.query(Project.id).filter(Project.deleted_at == None).all()}\n    _prj = db.query(Project).filter(Project.id.in_(pids), Project.deleted_at == None).all() if pids else []   # a deleted project is gone from here too'), ('    proj = {k: _newp(k) for k in pids}\n', '    proj = {k: _newp(k) for k in pids if k in pn}\n'), ('    for s in allsrc:\n        total, done = _peer_state(s)\n        peer_done = total > 0 and done == total\n', '    for s in allsrc:\n        if s.project_id not in pn:\n            continue\n        total, done = _peer_state(s)\n        peer_done = total > 0 and done == total\n')], 'frontend/src/components/enh/ReviewWorkspace.tsx': [("  const projs: any[] = list?.projects ?? []\n  const nSent = projs.filter(p => p.submitted).length\n  const nActive = projs.length - nSent\n  const tabProjects: any[] = useMemo(() => (list?.projects ?? []).filter((p: any) => !!p.submitted === (tab === 'submitted')), [list, tab])", "  const projs: any[] = (list?.projects ?? []).filter((p: any) => p.sources > 0)     // a project with no sources has nothing to review\n  const nEmpty = (list?.projects ?? []).length - projs.length\n  const nSent = projs.filter(p => p.submitted).length\n  const nActive = projs.length - nSent\n  const tabProjects: any[] = useMemo(() => (list?.projects ?? []).filter((p: any) => p.sources > 0 && !!p.submitted === (tab === 'submitted')), [list, tab])"), ('        <span className="text-xs text-gray-500">{tab === \'active\' ?', '        {tab === \'active\' && nEmpty > 0 && <span className="text-xs text-gray-400">{nEmpty} project{nEmpty === 1 ? \'\' : \'s\'} with no sources hidden. Delete {nEmpty === 1 ? \'it\' : \'them\'} on the <Link to="/projects" className="underline">Projects page</Link> if not needed.</span>}\n        <span className="text-xs text-gray-500">{tab === \'active\' ?'), ("import { createPortal } from 'react-dom'\n", "import { createPortal } from 'react-dom'\nimport { Link } from 'react-router-dom'\n"), ('<option value="">All projects</option>{(list?.projects ?? []).map((p: any) =>', '<option value="">All projects</option>{(list?.projects ?? []).filter((p: any) => p.sources > 0).map((p: any) =>')]}
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
