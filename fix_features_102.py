#!/usr/bin/env python3
"""Patch 102: register the admin-upload routes in backend/app/main.py (the router file was added but never switched on),
then report which parts of patches 98-101 are in your files. Run from the repo root. Safe to run twice."""
import os, re, sys, json
sys.stdout.reconfigure(errors='replace')
root = os.getcwd()
if not (os.path.isdir(os.path.join(root, 'backend')) and os.path.isdir(os.path.join(root, 'frontend'))):
    sys.exit('Run this from the repo root (the folder containing backend and frontend).')
def rd(p): return open(p, encoding='utf-8', newline='').read()

# 1) main.py: import the router and include it, whatever the file looks like
p = os.path.join(root, 'backend/app/main.py'); raw = rd(p); crlf = '\r\n' in raw; t = raw.replace('\r\n', '\n'); ch = False
if not os.path.exists(os.path.join(root, 'backend/app/api/v1/routes/admin_upload.py')):
    sys.exit('backend/app/api/v1/routes/admin_upload.py is missing. Run fix_features_98.py first.')
if not re.search(r'import\s*\([^)]*\badmin_upload\b', t, re.S) and not re.search(r'routes import [^\n(]*\badmin_upload\b', t):
    m = re.search(r'(from app\.api\.v1\.routes import \()(.*?)(\n\))', t, re.S)
    if m:
        body = m.group(2).rstrip()
        body = body + ('' if body.endswith(',') else ',') + ' admin_upload,'
        t = t[:m.start()] + m.group(1) + body + m.group(3) + t[m.end():]; ch = True
    else:
        m = re.search(r'(from app\.api\.v1\.routes import )([^\n(]+)', t)
        if not m: sys.exit('Could not find the routes import in backend/app/main.py. Send me the first 25 lines of that file.')
        t = t[:m.end()] + ', admin_upload' + t[m.end():]; ch = True
if 'admin_upload.router' not in t:
    last = None
    for m in re.finditer(r'^app\.include_router\([^\n]*\)[ \t]*$', t, re.M): last = m
    if not last: sys.exit('Could not find app.include_router lines in backend/app/main.py. Send me that file.')
    t = t[:last.end()] + '\napp.include_router(admin_upload.router,                    prefix=PREFIX)' + t[last.end():]; ch = True
if ch:
    open(p, 'w', encoding='utf-8', newline='').write(t.replace('\n', '\r\n') if crlf else t); print('updated  backend/app/main.py (admin_upload registered)')
else:
    print('already  backend/app/main.py has admin_upload')

# 2) which parts of patches 98-101 are in the files
MARKS = {"backend/app/api/v1/routes/sources.py": [[98, "admin_mode: str | None = Form(None),"], [98, "from app.services import admin_upload as _au  # an admin upload is a draft or a reference copy, never final by"], [98, "current_user=current_user, db=db, raw_entries=raw_entries, replace_reason=replace_reason, admin_mode=_mode,"], [98, "admin_mode: str | None = Form(None),"], [98, "_bulk_override = None if _mode == \"reference\" else _ver.gate(db, source, current_user, replace_reason)"], [98, "current_user=current_user, db=db, raw_entries=raw_entries, replace_reason=replace_reason, admin_mode=_mode,"], [98, "admin_mode: str | None = None,"], [98, "return _au.store_reference(db, source, current_user, rows, ext, extraction_method, file_breakdown, files_proce"], [98, "source_type=file_ext_type, status=(JobStatus.EXTRACTING if admin_mode == \"draft\" else JobStatus.READY_FOR_REVI"], [98, "source.status = SourceStatus.EXTRACTING     # an admin draft is not a submission: no clock, nothing for the re"], [98, "user_id=current_user.id, project_id=source.project_id, source_id=source.id,"]], "backend/app/services/versions.py": [[98, "kind = \"replaced\" if (r.reason or \"\").startswith(\"Replaced\") else \"restored\" if (r.reason or \"\").startswith(\"R"]], "backend/app/api/v1/routes/versions.py": [[98, "admin_mode=\"draft\" if (rl.is_admin(user) and (rd.reason or \"\").startswith(\"Reference\")) else None)   # an admi"], [99, "if rd and (rd.reason or \"\").startswith(\"Reference\") and not (user and rl.is_admin(user)):"], [99, "return ver.compare(db, source, _round(db, source, round_id, user))"], [99, "rd = _round(db, source, round_id, user)"], [99, "rd = _round(db, source, round_id, user)"], [99, "\"versions\": [v for v in ver.listing(db, source) if admin or v[\"kind\"] != \"reference\"],"]], "frontend/src/api/client.ts": [[98, "uploadMulti: (id: string, files: File[], onProgress?: (pct: number) => void, replaceReason?: string, adminMode"], [101, "answerKeyDownload: async (file: File, o: { format: 'xlsx' | 'json' | 'llm' | 'llm_zip';"], [101, "a.download = `final_check${o.format.startsWith('llm') ? '_for_llm' : ''}_${new Date().toISOString().slice(0, 1"]], "frontend/src/pages/SourceDetail.tsx": [[98, "sourcesApi.uploadMulti(sourceId, chunks, setUploadProgress, reason, isAdmin ? adminMode : undefined)"], [98, "if (isAdmin) fd.append('admin_mode', adminMode)"], [98, "sourcesApi.uploadMulti(sourceId, Array.from(folderFiles), setUploadProgress, reason, isAdmin ? adminMode : und"], [98, "{isAdmin && <AdminModePicker mode={adminMode} setMode={setAdminMode} hasRecords={source.total_records > 0} />}"], [98, "<AdminDraftBanner sourceId={source.id} reloadKey={String(source.updated_at ?? '') + String(source.status)} onS"], [99, "import { AdminModePicker, AdminDraftBanner, AdminCopiesPanel, AdminRecordCopy, type UploadMode } from '@/compo"], [99, "useState<UploadMode>('reference')"], [99, "'Loaded as data, not submitted. '"], [99, "'Saved privately. Only admins can see it, and the source is unchanged. '"], [99, "{isAdmin && sourceId && <AdminCopiesPanel sourceId={sourceId} onApplied={() => { load(); setRawFilesLoaded(fal"], [99, "{isAdmin && sourceId && showTimeline && <AdminRecordCopy sourceId={sourceId} recordId={showTimeline} />}"]], "frontend/src/components/enh/VersionsPanel.tsx": [[98, "<Chip tone={v.kind === 'replaced' ? 'amber' : v.kind === 'restored' ? 'blue' : v.kind === 'reference' ? 'purpl"]], "frontend/src/pages/Sources.tsx": [[98, "import { AdminBatchUpload } from '@/components/enh/AdminBatchUpload'"], [98, "<AdminBatchUpload projectId={projectId} onDone={() => window.location.reload()} />"]], "backend/app/models/all_models.py": [[99, "\"\"\"Data an admin saved for their own checking and final review. It is kept apart from the source, so extractor"]], "frontend/src/components/enh/FinalCheck.tsx": [[100, "import { adminUploadApi } from '@/api/adminUpload'"], [100, "setFile(new File([blob], `${label}.json`, { type: 'application/json' })); setRes(null); setDec({}); setSub(nul"], [100, "if (s.saved) toast.success(`Kept a private copy for ${s.saved} source${s.saved === 1 ? '' : 's'}. You will not"], [100, "<input key={inputKey} type=\"file\" accept=\".zip,.json\" onChange={e => { setFile(e.target.files?.[0] ?? null); s"], [100, "{!fromSaved && <label className=\"flex items-center gap-2 text-xs text-gray-600 mt-2\"><input type=\"checkbox\" ch"], [101, "const download = async (format: 'xlsx' | 'json' | 'llm' | 'llm_zip') => {"], [101, "{res && <Button variant=\"secondary\" onClick={() => download('llm')} disabled={!!busy} title=\"One markdown file"]], "backend/app/api/v1/routes/quality.py": [[101, "sd[\"sop\"] = {\"required\": sorted(req.get(\"required\") or []) if sop_on else [], \"allowed\": sorted(req.get(\"allow"], [101, "return Response(content=lp.combined_md(result, {\"generated\": stamp}).encode(\"utf-8\"), media_type=\"text/markdow"]]}
print('\nCheck of patches 98-101:')
missing = 0
for rel, items in MARKS.items():
    fp = os.path.join(root, rel)
    if not os.path.exists(fp): print('  MISSING FILE', rel); missing += len(items); continue
    t = rd(fp).replace('\r\n', '\n'); miss = sorted({n for n, mk in items if mk not in t})
    if miss: print('  NOT APPLIED  %-58s patch(es) %s' % (rel, ', '.join(map(str, miss)))); missing += len(miss)
    else: print('  ok           ' + rel)
for rel in ['backend/app/services/admin_upload.py', 'backend/app/services/llm_pack.py', 'backend/migrations/versions/035_admin_copies.py',
            'frontend/src/components/enh/AdminUpload.tsx', 'frontend/src/components/enh/AdminBatchUpload.tsx', 'frontend/src/api/adminUpload.ts']:
    print('  %-12s %s' % ('ok' if os.path.exists(os.path.join(root, rel)) else 'MISSING FILE', rel))
print('\n' + ('Everything from 98-101 is in place. Commit and push.' if not missing else
      'Some parts of 98-101 are not in your files (listed above). Send me that list and I will fix them.'))
