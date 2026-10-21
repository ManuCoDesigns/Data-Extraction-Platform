#!/usr/bin/env python3
"""Xtrium is the authority: on a real refresh the source's category, website, country and type are read from Xtrium's item
as they are now. Run from the repo root. Safe to run twice."""
import os, sys
sys.stdout.reconfigure(errors='replace')
P = "backend/app/api/v1/routes/integrations.py"
FUNC = "def _mirror_item(source, item: dict, db) -> list[str]:\n    \"\"\"Xtrium is the authority on what its item is. On a real refresh, the source's category, website, country and type\n    are taken from the item as Xtrium has them now (only values Xtrium actually gives; nothing is blanked).\"\"\"\n    want = {\n        \"category\": item.get(\"category\") or item.get(\"kg_node\"),\n        \"website_url\": item.get(\"resolved_link\") or item.get(\"url\"),\n        \"country\": item.get(\"country_of_origin\"),\n        \"type\": item.get(\"type\"),\n    }\n    changed = []\n    for k, v in want.items():\n        if isinstance(v, str) and v.strip() and (getattr(source, k, None) or \"\") != v.strip():\n            setattr(source, k, v.strip())\n            changed.append(k)\n    if changed:\n        try:\n            db.commit()\n        except Exception:\n            db.rollback()\n            return []\n    return changed\n\n\n"
A1 = "async def _load_sop(source, db, force: bool = True, deep: bool = False) -> dict:"
A2 = "    meta = _sop_meta(item) if item else None\n"
if not os.path.exists(P): sys.exit("MISSING " + P)
raw = open(P, 'rb').read().decode('utf-8'); crlf = '\r\n' in raw; t = raw.replace('\r\n', '\n')
ok = True
if "def _mirror_item" in t: print("already  helper")
elif A1 in t: t = t.replace(A1, FUNC + A1, 1); print("applied  helper")
else: print("NO MATCH helper"); ok = False
if "_mirror_item(source, item, db)" in t: print("already  call")
elif A2 in t and ok: t = t.replace(A2, A2 + "    if item:\n        _mirror_item(source, item, db)\n", 1); print("applied  call")
else: print("NO MATCH call"); ok = False
open(P, 'wb').write((t.replace('\n', '\r\n') if crlf else t).encode('utf-8'))
print("\nAll applied." if ok else "\nSome edits did not match: paste the lines above.")
