import { useCallback, useEffect, useState } from 'react'
import { adminUploadApi, type CopyMeta } from '@/api/adminUpload'
import { Button, toast } from '@/components/ui'
import { downloadText } from '@/lib/csv'

export type UploadMode = 'draft' | 'reference' | 'submit'

const OPTIONS: { key: UploadMode; title: string; text: string }[] = [
  { key: 'reference', title: 'Save privately (admin only)', text: 'Kept for your own checking and the final review. Extractors and reviewers cannot see it, and the source is not changed. It is saved by source name, so it is still there if the source is pulled again.' },
  { key: 'draft', title: 'Load as the source’s data, not submitted', text: 'The records become the source’s data but it stays in extraction and does not count as submitted. The extractor and reviewers can see these records.' },
  { key: 'submit', title: 'Submit for review now', text: 'The normal upload: the source goes to Ready for review straight away.' },
]

/** What an admin's upload should be. Nothing is final unless the admin picks the last option. */
export function AdminModePicker({ mode, setMode, hasRecords }: { mode: UploadMode; setMode: (m: UploadMode) => void; hasRecords: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
      <p className="text-sm font-semibold text-gray-900 m-0">What is this upload?</p>
      {OPTIONS.map(o => (
        <label key={o.key} className="flex items-start gap-2 cursor-pointer text-xs">
          <input type="radio" name="admin-upload-mode" checked={mode === o.key} onChange={() => setMode(o.key)} className="mt-0.5" />
          <span><b className="text-gray-900">{o.title}</b><br /><span className="text-gray-600">{o.text}</span></span>
        </label>
      ))}
      {hasRecords && mode === 'draft' && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-1.5 m-0">This source already has records. Loading replaces them, and the current data is kept under Versions. To check them against this file instead, save it privately.</p>}
    </div>
  )
}

/** Shown on a source whose data is an admin draft. */
export function AdminDraftBanner({ sourceId, reloadKey, onSubmitted }: { sourceId: string; reloadKey?: string; onSubmitted?: () => void }) {
  const [st, setSt] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { adminUploadApi.state(sourceId).then(setSt).catch(() => setSt(null)) }, [sourceId])
  useEffect(load, [load, reloadKey])
  if (!st?.draft) return null
  const submit = async () => {
    setBusy(true)
    try {
      const r = await adminUploadApi.submit(sourceId)
      toast.success(r.invalid ? `Sent back to extraction: ${r.invalid} records still need fixes.` : 'Submitted for review.')
      load(); onSubmitted?.()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not submit') } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="text-sm text-indigo-900 flex-1 min-w-[16rem]">
        <b>Admin data, not submitted.</b> {st.records} records{st.invalid ? `, ${st.invalid} need fixes` : ''} loaded{st.by ? ` by ${st.by}` : ''}. It does not count as submitted or in the reports until an admin submits it.
      </div>
      {st.can_submit && <Button size="sm" loading={busy} onClick={submit}>Submit for review</Button>}
    </div>
  )
}


/** The admin's saved copies of this source. Admin only. Compare, download, load as data, or delete. */
export function AdminCopiesPanel({ sourceId, onApplied }: { sourceId: string; onApplied?: () => void }) {
  const [copies, setCopies] = useState<CopyMeta[] | null>(null)
  const [diff, setDiff] = useState<Record<string, any>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => { adminUploadApi.copies(sourceId).then(r => setCopies(r.copies)).catch(() => setCopies([])) }, [sourceId])
  useEffect(load, [load])
  if (!copies || !copies.length) return null
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
  const compare = async (c: CopyMeta) => {
    if (diff[c.id]) { setDiff(d => { const n = { ...d }; delete n[c.id]; return n }); return }
    try { setDiff(d => ({ ...d, [c.id]: null })); const r = await adminUploadApi.compareCopy(c.id, sourceId); setDiff(d => ({ ...d, [c.id]: r })) } catch { toast.error('Could not compare'); setDiff(d => { const n = { ...d }; delete n[c.id]; return n }) }
  }
  const download = async (c: CopyMeta) => { try { downloadText(`${c.source_name}_admin_copy.json`, await adminUploadApi.downloadCopy(c.id), 'application/json') } catch { toast.error('Could not download') } }
  const apply = async (c: CopyMeta, mode: 'draft' | 'submit') => {
    if (!window.confirm(mode === 'draft' ? 'Load this copy as the source’s data? The current data is kept under Versions. It stays unsubmitted, and the extractor and reviewers will see these records.' : 'Load this copy and submit the source for review? The current data is kept under Versions.')) return
    setBusy(c.id + mode)
    try { const r = await adminUploadApi.applyCopy(c.id, mode, sourceId); toast.success(`${r.records} records loaded${mode === 'draft' ? ' as a draft' : ''}.`); load(); onApplied?.() } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not load it') } finally { setBusy(null) }
  }
  const del = async (c: CopyMeta) => {
    if (!window.confirm('Delete this saved copy for good?')) return
    try { await adminUploadApi.deleteCopy(c.id); load() } catch { toast.error('Could not delete') }
  }
  return (
    <div className="space-y-2 mt-4 pt-4 border-t border-gray-200">
      <p className="text-sm font-semibold text-gray-900 m-0">Your saved copies <span className="text-xs font-normal text-gray-500">Only admins can see these.</span></p>
      {copies.map(c => (
        <div key={c.id} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-sm">{c.file || c.batch_label}</b>
            <span className="text-xs text-gray-600">{c.records} records{c.invalid ? `, ${c.invalid} fail the SOP check` : ''} · saved {when(c.created_at)}{c.applied_at ? ` · loaded ${when(c.applied_at)}` : ''}{c.batch_label && c.batch_label !== c.file ? ` · ${c.batch_label}` : ''}</span>
            <div className="ml-auto flex gap-1.5 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => compare(c)}>{diff[c.id] !== undefined ? 'Hide' : 'Compare'}</Button>
              <Button size="sm" variant="secondary" onClick={() => download(c)}>Download</Button>
              <Button size="sm" variant="secondary" loading={busy === c.id + 'draft'} onClick={() => apply(c, 'draft')}>Load as data</Button>
              <Button size="sm" variant="secondary" onClick={() => del(c)}>Delete</Button>
            </div>
          </div>
          {diff[c.id] && (
            <div className="mt-2 text-xs text-gray-700 space-y-1 bg-white rounded-lg p-2.5">
              <p className="m-0"><b>Compared with the source now:</b> {diff[c.id].counts.changed} changed, {diff[c.id].counts.added} not on the source, {diff[c.id].counts.removed} only on the source, {diff[c.id].counts.same} the same.</p>
              {diff[c.id].changed.slice(0, 10).map((x: any) => <p key={x.name} className="m-0">{x.name}: {x.fields.join(', ')}{x.more ? ` and ${x.more} more` : ''}</p>)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** In the final check: the admin's saved copy of this record next to what the extractor has, field by field. */
export function AdminRecordCopy({ sourceId, recordId }: { sourceId: string; recordId: string }) {
  const [r, setR] = useState<any>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { setR(null); adminUploadApi.recordCompare(sourceId, recordId).then(setR).catch(() => setR(null)) }, [sourceId, recordId])
  if (!r || !r.found) return null
  const show = (v: any) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v))
  return (
    <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: '#3730a3', margin: 0 }}>
        Your saved copy {r.differs ? `differs on ${r.differs} field${r.differs === 1 ? '' : 's'}` : 'matches this record'}
        <span style={{ fontWeight: 400, color: '#6366f1' }}> · {r.copy.file}, only you can see it</span>
      </p>
      {r.differs > 0 && <button type="button" onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', color: '#4338ca', fontSize: 12, cursor: 'pointer', padding: 0, marginTop: 4 }}>{open ? 'Hide the differences' : 'Show the differences'}</button>}
      {open && (
        <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b' }}><th style={{ padding: '2px 8px 2px 0' }}>Field</th><th style={{ padding: '2px 8px' }}>On the source</th><th style={{ padding: '2px 0 2px 8px' }}>Your copy</th></tr></thead>
          <tbody>{r.diff.map((d: any) => (
            <tr key={d.field} style={{ borderTop: '1px solid #e0e7ff', verticalAlign: 'top' }}>
              <td style={{ padding: '3px 8px 3px 0', fontWeight: 600 }}>{d.field}</td>
              <td style={{ padding: '3px 8px', wordBreak: 'break-word' }}>{show(d.live)}</td>
              <td style={{ padding: '3px 0 3px 8px', wordBreak: 'break-word' }}>{show(d.copy)}</td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  )
}
