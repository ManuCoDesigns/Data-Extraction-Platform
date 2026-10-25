#!/usr/bin/env python3
"""Peer-reviewed records can no longer be deleted by the extractor, and an empty source can always be refilled.
What happened: on a sent-back source the extractor deleted the only record to re-upload it, but the re-upload was locked, so the source
was left with peer reviews and no records. Now: deleting a record once peers are involved is admin-only (a clear message says to edit or
Apply as corrections instead); a source with no records is not bulk-locked, so its extractor can upload; and the source page shows a
warning when peer reviews exist but no records do.
Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {'backend/app/services/record_locks.py': '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'}
MOD = {'backend/app/api/v1/routes/sources.py': [('        raise HTTPException(status_code=404, detail="Record not found in this source")\n    from app.services import record_locks as _rl  # delete_record.lock\n    lock_override = _rl.assert_record_editable(source, record, current_user)\n    db.add(AuditLog(', '        raise HTTPException(status_code=404, detail="Record not found in this source")\n    from app.services import record_locks as _rl  # delete_record.lock\n    lock_override = _rl.assert_record_deletable(source, record, current_user)\n    db.add(AuditLog(')], 'frontend/src/pages/SourceDetail.tsx': [('        </div>\n      </Card>\n', '        </div>\n      </Card>\n\n      {source.total_records === 0 && ((source.peer_ids ?? []).length > 0 || !!source.assigned_reviewer_id) && [\'changes_requested\', \'in_review\', \'ready_for_review\'].includes(source.status) && (\n        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-900">\n          <b>This source has peer reviews but no records.</b> The record was removed after review, so the reviewers\' comments below no longer have anything to attach to.\n          {isAdmin\n            ? \' Upload the corrected file with Upload Data. Admins are not locked, and the upload is logged. The peers will need to review the new record.\'\n            : \' Use Upload Data to add the record again. If it is refused, tell an admin.\'}\n        </div>\n      )}\n')]}
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
