#!/usr/bin/env python3
"""Upload warning: a single-record JSON file (no wrapper list) no longer says its own lists, such as 'aliases', were NOT read.
They are fields of the record and were kept. A list that really was skipped next to a wrapper list is still reported.
Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/services/enh.py': [('            if isinstance(data, dict):\n                used = next((k for k in JSON_LIST_KEYS if isinstance(data.get(k), list)), None)\n                extra = [(k, len(v)) for k, v in data.items() if isinstance(v, list) and v and k != used]\n                if extra:', "            if isinstance(data, dict):\n                used = next((k for k in JSON_LIST_KEYS if isinstance(data.get(k), list)), None)\n                # With no wrapper list the whole object is the one record, so a list inside it ('aliases') is a field of that record, not a skipped list.\n                extra = [(k, len(v)) for k, v in data.items() if isinstance(v, list) and v and k != used] if used else []\n                if extra:")]}
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
