#!/usr/bin/env python3
"""Round 44 finish: the three edits fix_features_44 could not place (country-code check and the outdated / no-contract flags
in the SOP overview). Run from the repo root. Safe to run twice."""
import os, re, sys
sys.stdout.reconfigure(errors='replace')

def edit(path, steps):
    if not os.path.exists(path):
        print("MISSING ", path); return False
    raw = open(path, 'rb').read().decode('utf-8')
    crlf = '\r\n' in raw
    s = raw.replace('\r\n', '\n')
    ok = True
    for name, done, find, new in steps:
        if done in s:
            print("already ", name); continue
        if s.count(find) < 1:
            print("NO MATCH", name, "->", path); ok = False; continue
        s = s.replace(find, new, 1)
        print("applied ", name)
    if crlf: s = s.replace('\n', '\r\n')
    open(path, 'wb').write(s.encode('utf-8'))
    return ok

A2 = '''    if t in ("string", "") and not isinstance(val, (list, dict)) and re.search(r"alpha-?2|ISO ?3166-?1", " ".join(str(spec.get(k) or "") for k in ("format", "rule")), re.I) and not re.fullmatch(r"[A-Z]{2}", sv):
        return "not an ISO 3166-1 alpha-2 country code (two capital letters, for example KE), and a country name is not accepted"
'''
BOOL = '    if t == "boolean" and not isinstance(val, bool)'
r = [edit("backend/app/services/quality.py", [("country-code check", "ISO 3166-1 alpha-2 country code", BOOL, A2 + BOOL)])]
R = "backend/app/api/v1/routes/quality.py"
r.append(edit(R, [
 ("source SOP payload flags", '"stale": b.get("stale")',
  '"spec_version": b.get("spec_version")}', '"spec_version": b.get("spec_version"), "stale": b.get("stale"), "no_contract": b.get("no_contract")}'),
 ("overview row flags", '"stale": bool(req.get("stale"))',
  '"warnings": len(req.get("warnings") or []), "known":', '"warnings": len(req.get("warnings") or []), "stale": bool(req.get("stale")), "no_contract": bool(req.get("no_contract")), "known":'),
 ("requirements list flags", '"from_xtrium", "stale", "no_contract")',
  '"saved_at", "from_xtrium")})', '"saved_at", "from_xtrium", "stale", "no_contract")})'),
]))
print()
print("All applied." if all(r) else "Some edits did not match: send me the lines printed above.")
