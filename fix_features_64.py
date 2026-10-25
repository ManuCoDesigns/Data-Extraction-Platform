#!/usr/bin/env python3
"""Loading corrections: read JSON and CSV files that were saved with a byte-order mark (Windows editors add one). Before this the file was
refused with "Could not read that file".
Run from the repo root. Safe to run twice."""
import os, sys, json
sys.stdout.reconfigure(errors='replace')
OPS = json.loads('[["backend/app/api/v1/routes/sources.py", "a byte-order mark, which Windows editors add", "    content = await file.read()\\n    if len(content) > MAX_UPLOAD_SIZE_BYTES:\\n        raise HTTPException(status_code=413, detail=\\"That file is too large for corrections.", "    content = await file.read()\\n    if content.startswith(b\\"\\\\xef\\\\xbb\\\\xbf\\"):  # a byte-order mark, which Windows editors add to JSON and CSV files\\n        content = content[3:]\\n    if len(content) > MAX_UPLOAD_SIZE_BYTES:\\n        raise HTTPException(status_code=413, detail=\\"That file is too large for corrections."]]')
ok = True

def rd(p):
    raw = open(p, 'rb').read().decode('utf-8'); return raw, ('\r\n' in raw), raw.replace('\r\n', '\n')
def wr(p, t, crlf): open(p, 'wb').write((t.replace('\n', '\r\n') if crlf else t).encode('utf-8'))

by = {}
for f, mark, anchor, new in OPS: by.setdefault(f, []).append((mark, anchor, new))
for f, steps in by.items():
    if not os.path.exists(f): print("MISSING   ", f); ok = False; continue
    raw, crlf, t = rd(f)
    for mark, anchor, new in steps:
        if mark in t: print("already   ", f.split('/')[-1], mark[:40].strip()); continue
        if t.count(anchor) != 1: print("NO MATCH  ", f, mark[:50]); ok = False; continue
        t = t.replace(anchor, new, 1); print("applied   ", f.split('/')[-1], mark[:40].strip())
    wr(f, t, crlf)
print()
print("All applied." if ok else "Some edits did not match: paste the lines above and I will fit them to your files.")
