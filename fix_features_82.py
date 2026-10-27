#!/usr/bin/env python3
"""Admins bypass the peer-review wait. Run from the repo root (the folder that holds backend/ and frontend/).
Safe to run twice: files already applied are skipped."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/api/v1/routes/sources.py': [('\n    if action == "approve":\n        _assert_peers_done(source)\n        record.review_status = ReviewStatus.APPROVED\n        record.admin_reviewed_by = current_user.id', '\n    if action == "approve":\n        _assert_peers_done(source, current_user)\n        record.review_status = ReviewStatus.APPROVED\n        record.admin_reviewed_by = current_user.id'), ('        raise HTTPException(status_code=403, detail="Only reviewers, QA leads, project admins, or org admins can approve a source")\n\n    _assert_peers_done(source)\n\n    user_roles = _user_roles(current_user)', '        raise HTTPException(status_code=403, detail="Only reviewers, QA leads, project admins, or org admins can approve a source")\n\n    _assert_peers_done(source, current_user)\n\n    user_roles = _user_roles(current_user)'), ('\n\ndef _assert_peers_done(source: Source):\n    waiting = [r for r in source.peer_reviews if r.status != "submitted"]\n    if waiting:', '\n\ndef _assert_peers_done(source: Source, user: User | None = None):\n    # Admins decide on their own: a pending peer review never blocks them.\n    if user is not None and (_user_roles(user) & {"org_admin", "project_admin"}):\n        return\n    waiting = [r for r in source.peer_reviews if r.status != "submitted"]\n    if waiting:')]}
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
        if new in t: continue
        elif t.count(old) == 1: t = t.replace(old, new); changed = True
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
