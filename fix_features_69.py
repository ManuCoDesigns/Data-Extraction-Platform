#!/usr/bin/env python3
"""Extractor, on a record that was sent back: a "Fix these fields" card at the top of the record screen.
It lists only the flagged fields (the open ones from fix_features_68), each with what the reviewers asked, what the field said, an input to
fix it right there, a "x of y changed" count, and n to jump to the next one. The rest of the screen is unchanged, and the passed fields stay
locked below. Frontend only: no new actions and no reviewer features. Reviewer names are not shown, only Admin or Reviewer.
Run from the repo root. Safe to run twice."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {'frontend/src/components/enh/FixPanel.tsx': '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'}
MOD = {'frontend/src/pages/JsonRecordViewer.tsx': [("import { EvidencePanel } from '@/components/enh/EvidencePanel'\nimport { SIGNAL_LABEL, type Signal } from '@/components/enh/SourceQuality'\n\ninterface SchemaField {", "import { EvidencePanel } from '@/components/enh/EvidencePanel'\nimport { SIGNAL_LABEL, type Signal } from '@/components/enh/SourceQuality'\nimport { FixPanel } from '@/components/enh/FixPanel'\n\ninterface SchemaField {"), ("        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>\n\n          {/* Validation errors */}\n          {(errors.length > 0 || webFlags.length > 0) && (", "        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>\n\n          {/* A sent-back record, for the extractor: the flagged fields first */}\n          {!isAdmin && Array.isArray(record.editable_fields) && record.editable_fields.length > 0 && (\n            <FixPanel record={record} values={localFields} signals={signals} onChange={handleSaveField} onSave={handleSaveAll} dirty={hasChanges} />\n          )}\n\n          {/* Validation errors */}\n          {(errors.length > 0 || webFlags.length > 0) && (")]}
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
