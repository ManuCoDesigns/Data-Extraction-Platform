#!/usr/bin/env python3
"""Final check: a Not fixed field can be overruled ("Overrule: extractor right") and the earlier Wrong verdict is replaced with Correct on Record as audits. Needs 78. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'backend/app/api/v1/routes/quality.py': [('                        cls, why = "held", "The value differs and no verdict is recorded. Decide it, or record a verdict in Check against source"\n                elif aud_ok and aud.verdict == "incorrect":\n                    cls, why, not_fixed = "error", "You marked it wrong in review and the final value is still the delivered value (not fixed)", True\n                if cls == "correct":\n                    sd["correct"] += 1', '                        cls, why = "held", "The value differs and no verdict is recorded. Decide it, or record a verdict in Check against source"\n                elif aud_ok and aud.verdict == "incorrect":\n                    if decs.get(key) == "right":\n                        cls, why = "admin", "You overruled your earlier Wrong verdict: the delivered value is right"\n                    else:\n                        cls, why, not_fixed = "error", "You marked it wrong in review and the final value is still the delivered value (not fixed)", True\n                if cls == "correct":\n                    sd["correct"] += 1')], 'frontend/src/components/enh/FinalCheck.tsx': [('                              <td className="pr-3"><Chip tone={w.outcome === \'caught\' ? \'green\' : w.outcome === \'escaped\' ? \'red\' : w.outcome === \'admin_change\' ? \'blue\' : \'amber\'}>{w.outcome === \'caught\' ? \'Error, caught\' : w.outcome === \'escaped\' ? \'Error, got through\' : w.outcome === \'admin_change\' ? \'Your change\' : \'To confirm\'}</Chip></td>\n                              <td className="whitespace-nowrap">\n                                {w.not_fixed ? <span className="text-xs text-gray-500">Fix it, or change the review verdict</span> : <>\n                                  <button type="button" onClick={() => decide([w.key], w.decision === \'wrong\' ? null : \'wrong\')} aria-pressed={w.decision === \'wrong\'}\n                                    className={`text-xs font-semibold rounded-md border px-2 py-1 mr-1 ${w.decision === \'wrong\' ? \'bg-red-600 text-white border-red-600\' : \'border-gray-300 text-gray-700 hover:bg-gray-100\'}`}>Extractor wrong</button>', '                              <td className="pr-3"><Chip tone={w.outcome === \'caught\' ? \'green\' : w.outcome === \'escaped\' ? \'red\' : w.outcome === \'admin_change\' ? \'blue\' : \'amber\'}>{w.outcome === \'caught\' ? \'Error, caught\' : w.outcome === \'escaped\' ? \'Error, got through\' : w.outcome === \'admin_change\' ? \'Your change\' : \'To confirm\'}</Chip></td>\n                              <td className="whitespace-nowrap">\n                                {w.not_fixed ? <button type="button" onClick={() => decide([w.key], \'right\')} title="Replace your earlier Wrong verdict with Correct"\n                                  className="text-xs font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 px-2 py-1">Overrule: extractor right</button> : <>\n                                  <button type="button" onClick={() => decide([w.key], w.decision === \'wrong\' ? null : \'wrong\')} aria-pressed={w.decision === \'wrong\'}\n                                    className={`text-xs font-semibold rounded-md border px-2 py-1 mr-1 ${w.decision === \'wrong\' ? \'bg-red-600 text-white border-red-600\' : \'border-gray-300 text-gray-700 hover:bg-gray-100\'}`}>Extractor wrong</button>')]}
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
