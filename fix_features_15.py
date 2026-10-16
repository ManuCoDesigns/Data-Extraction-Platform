#!/usr/bin/env python3
"""Careerflow platform enhancements. Run from the repo root (the folder that holds backend/ and frontend/).
Safe to run twice: files already applied are skipped."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {"frontend/src/theme.css": [[".dark .skeleton { background: linear-gradient(90deg,#172033 25%,#1f2b42 50%,#172033 75%); background-size: 200% 100%; }\n.dark .glass { background: rgba(17,24,39,.85); }\n.dark ::selection { background: rgba(99,102,241,.45); }\n.dark pre, .dark code { color-scheme: dark; }\n", ".dark .skeleton { background: linear-gradient(90deg,#172033 25%,#1f2b42 50%,#172033 75%); background-size: 200% 100%; }\n.dark .glass { background: rgba(17,24,39,.85); }\n.dark ::selection { background: rgba(99,102,241,.45); }\n.dark pre, .dark code { color-scheme: dark; }\n\n/* ── Dark mode gap fixes: very dark text shades, pale gradient stops, light rings ── */\n.dark .text-amber-950, .dark .text-yellow-950, .dark .text-orange-950 { color: #fde68a; }\n.dark .text-emerald-950, .dark .text-green-950 { color: #a7f3d0; }\n.dark .text-red-950, .dark .text-rose-950 { color: #fecaca; }\n.dark .text-blue-950, .dark .text-indigo-950 { color: #c7d2fe; }\n.dark .text-purple-950, .dark .text-violet-950 { color: #ddd6fe; }\n.dark .from-brand-50 { --tw-gradient-from: rgba(99,102,241,.16) var(--tw-gradient-from-position); --tw-gradient-to: rgba(99,102,241,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }\n.dark .to-indigo-50 { --tw-gradient-to: rgba(99,102,241,.1) var(--tw-gradient-to-position); }\n.dark .to-purple-50 { --tw-gradient-to: rgba(168,85,247,.1) var(--tw-gradient-to-position); }\n.dark .ring-amber-100, .dark .ring-amber-200, .dark .ring-amber-300 { --tw-ring-color: rgba(251,191,36,.3); }\n.dark .ring-emerald-100, .dark .ring-emerald-200, .dark .ring-emerald-300 { --tw-ring-color: rgba(52,211,153,.3); }\n.dark .ring-red-100, .dark .ring-red-200 { --tw-ring-color: rgba(248,113,113,.3); }\n.dark .ring-blue-200, .dark .ring-blue-300, .dark .ring-indigo-200, .dark .ring-indigo-300, .dark .ring-brand-100, .dark .ring-brand-200 { --tw-ring-color: rgba(129,140,248,.35); }\n.dark .ring-purple-100, .dark .ring-purple-200, .dark .ring-purple-300 { --tw-ring-color: rgba(192,132,252,.3); }\n/* The notification banner is always a bright gradient: keep its text and Open button the same as in light mode */\n.dark [data-banner] .bg-white { background-color: #fff; color: #111827; }\n.dark [data-banner] { color: #fff; }\n/* Pale tints with an opacity suffix (bg-red-50/50 and so on) */\n.dark .bg-amber-50\\/40, .dark .bg-amber-50\\/70 { background-color: rgba(245,158,11,.1); }\n.dark .bg-indigo-50\\/40 { background-color: rgba(99,102,241,.1); }\n.dark .bg-violet-50\\/70 { background-color: rgba(139,92,246,.12); }\n.dark .bg-red-50\\/30, .dark .bg-red-50\\/50, .dark .bg-red-50\\/70 { background-color: rgba(239,68,68,.1); }\n.dark .text-red-700\\/80 { color: #fca5a5; }\n.dark .text-sky-800\\/80 { color: #7dd3fc; }\n"]]}
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
