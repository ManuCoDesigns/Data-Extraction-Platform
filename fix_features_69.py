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
