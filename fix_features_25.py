#!/usr/bin/env python3
"""Careerflow platform enhancements. Run from the repo root (the folder that holds backend/ and frontend/).
Safe to run twice: files already applied are skipped."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {"backend/app/services/nimble.py": [["    headers = {\"Authorization\": f\"Bearer {os.getenv('NIMBLE_API_KEY')}\", \"Content-Type\": \"application/json\"}\n    body = {\"url\": u, \"formats\": [\"markdown\"], \"render\": render}\n    try:\n        with httpx.Client(timeout=60) as c:\n            r = c.post(_base() + os.getenv(\"NIMBLE_EXTRACT_PATH\", \"/v2/extract\"), json=body, headers=headers)\n            if r.status_code in (401, 403):\n                return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble rejected the API key.\"}\n            if r.status_code == 404:\n                return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble did not recognise the extract address. Check NIMBLE_EXTRACT_PATH.\"}\n", "    headers = {\"Authorization\": f\"Bearer {os.getenv('NIMBLE_API_KEY')}\", \"Content-Type\": \"application/json\"}\n    body = {\"url\": u, \"formats\": [\"markdown\"], \"render\": render}\n    try:\n        with httpx.Client(timeout=60) as c:\n            r = None\n            for attempt in range(3):  # back off on rate limits (429) and retry a slow page once\n                try:\n                    r = c.post(_base() + os.getenv(\"NIMBLE_EXTRACT_PATH\", \"/v2/extract\"), json=body, headers=headers)\n                except httpx.TimeoutException:\n                    if attempt == 1:\n                        raise\n                    continue\n                if r.status_code != 429:\n                    break\n                try:\n                    wait = float(r.json().get(\"retry_after\") or r.headers.get(\"retry-after\") or 1)\n                except Exception:\n                    wait = 1.0\n                time.sleep(min(max(wait, 0.5), 10))\n            if r is None or r.status_code == 429:\n                return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble is busy right now (rate limit). Try again in a minute.\"}\n            if r.status_code in (401, 403):\n                return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble rejected the API key.\"}\n            if r.status_code == 404:\n                return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble did not recognise the extract address. Check NIMBLE_EXTRACT_PATH.\"}\n"], ["                        data = j.get(\"data\") or {}\n                        break\n            text = data.get(\"markdown\") or data.get(\"text\") or data.get(\"html\") or \"\"\n            status = str(j.get(\"status\") or \"success\").lower()\n    except httpx.HTTPError:\n        return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Could not reach Nimble. Try again in a moment.\"}\n    except ValueError:\n        return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble sent back something unreadable.\"}\n", "                        data = j.get(\"data\") or {}\n                        break\n            text = data.get(\"markdown\") or data.get(\"text\") or data.get(\"html\") or \"\"\n            status = str(j.get(\"status\") or \"success\").lower()\n    except httpx.TimeoutException:\n        return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"The page took too long to load. Try again, or tick Render page.\"}\n    except httpx.HTTPError:\n        return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Could not reach Nimble. Try again in a moment.\"}\n    except ValueError:\n        return {\"ok\": False, \"url\": u, \"text\": \"\", \"error\": \"Nimble sent back something unreadable.\"}\n"]]}
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
