import { useState } from 'react'
import { adminUploadApi, type BatchFile } from '@/api/adminUpload'
import { Button, Modal, toast } from '@/components/ui'
import { adminUploadApi as api2, type CopyMeta } from '@/api/adminUpload'

type Row = BatchFile & { chosen: string; mode: 'draft' | 'reference' | 'skip' }

/** Load a whole zip of record files at once. Each file is matched to its source, you check the match, and nothing is submitted. */
export function AdminBatchUpload({ projectId, onDone }: { projectId?: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sources, setSources] = useState<{ id: string; name: string; status: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [lib, setLib] = useState<{ batch_id: string; label: string; created_at: string; copies: CopyMeta[] }[] | null>(null)
  const openLib = async () => { try { setLib((await api2.library()).batches) } catch { toast.error('Could not open the saved batches') } }
  const reapply = async (id: string) => { if (!window.confirm('Load this batch into the sources that exist now, as unsubmitted data? Current data is kept under Versions, and extractors will see these records.')) return; try { const r = await api2.applyBatch(id, 'draft'); toast.success(`${r.done} loaded${r.failed ? `, ${r.failed} could not be (no source with that name, or approved)` : ''}.`); onDone?.() } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not load it') } }
  const dropBatch = async (id: string) => { if (!window.confirm('Delete this saved batch for good?')) return; try { await api2.deleteBatch(id); openLib() } catch { toast.error('Could not delete') } }

  const close = () => { if (busy) return; setOpen(false); setFile(null); setRows(null); setResult(null) }
  const check = async () => {
    if (!file) return
    setBusy(true)
    try {
      const r = await adminUploadApi.preview(file, projectId)
      setSources(r.sources)
      setRows(r.files.map(f => ({ ...f, chosen: f.source_id ?? '', mode: f.source_id ? f.suggested_mode : 'skip' })))
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not read that zip') } finally { setBusy(false) }
  }
  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs!.map((r, j) => j === i ? { ...r, ...patch } : r))
  const ready = (rows ?? []).filter(r => r.mode !== 'skip' && r.chosen)
  const used = ready.map(r => r.chosen)
  const dup = used.length !== new Set(used).size
  const apply = async () => {
    if (!file || !ready.length || dup) return
    setBusy(true)
    try {
      const r = await adminUploadApi.apply(file, ready.map(x => ({ file: x.file, source_id: x.chosen, mode: x.mode })), projectId)
      setResult(r)
      toast.success(`${r.done} loaded${r.failed ? `, ${r.failed} failed` : ''}. Nothing was submitted for review.`)
      onDone?.()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not load the batch') } finally { setBusy(false) }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} title="Save a zip of record files for your own checking, or load them into their sources">Admin batch upload</Button>
      <Button variant="secondary" onClick={openLib} title="Your saved admin batches. Only admins can see them.">Saved admin batches</Button>
      <Modal open={!!lib} onClose={() => setLib(null)} title="Saved admin batches" description="Only admins can see these. They are kept by source name, so they are still here if a source is pulled again.">
        <div className="space-y-3 text-sm" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {lib && !lib.length && <p className="m-0 text-gray-600">Nothing saved yet. Use Admin batch upload and choose Save privately.</p>}
          {lib?.map(b => (
            <div key={b.batch_id} className="rounded-xl border border-gray-200 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap"><b>{b.label}</b><span className="text-xs text-gray-500">{new Date(b.created_at).toLocaleString()} · {b.copies.length} files</span>
                <span className="ml-auto flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => reapply(b.batch_id)}>Load into sources</Button><Button size="sm" variant="secondary" onClick={() => dropBatch(b.batch_id)}>Delete</Button></span></div>
              <ul className="m-0 pl-4 text-xs space-y-0.5">{b.copies.map(c => <li key={c.id}>{c.source_name}: {c.records} records{c.source_present ? ` · source is ${String(c.current_status).replace(/_/g, ' ')}` : ' · no source with this name right now'}{c.applied_at ? ' · loaded before' : ''}</li>)}</ul>
            </div>
          ))}
        </div>
      </Modal>
      <Modal open={open} onClose={close} size="lg" title="Admin batch upload" description="One zip, many sources. Each file is matched to a source for you to check. Nothing is submitted, and saved copies are visible to admins only.">
        <div className="space-y-3 text-sm" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {!rows && !result && (
            <>
              <input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-gray-600 m-0">A zip with one .json file per source, such as records/Parkdale_Mills.json. Notes, manifests and checklists in the zip are ignored.</p>
              <Button loading={busy} disabled={!file} onClick={check}>Match to sources</Button>
            </>
          )}
          {rows && !result && (
            <>
              <p className="text-xs text-gray-600 m-0"><b>Save privately</b> keeps the file for your own checking and changes nothing on the source: extractors and reviewers cannot see it, and it is kept by source name so you do not have to upload it again. <b>Load as data</b> makes it the source’s data without submitting it, and the extractor can see those records.</p>
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const chosenSrc = sources.find(s => s.id === r.chosen)
                  return (
                    <div key={r.file} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-gray-900 break-all">{r.file.split('/').pop()}</span>
                        <span className="text-xs text-gray-500 shrink-0">{r.records} record{r.records === 1 ? '' : 's'}</span>
                      </div>
                      {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                      {!!r.invalid && <div className="text-xs text-amber-700">{r.invalid} fail the SOP check</div>}
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
                        <label className="block text-xs text-gray-500">Source
                          <select value={r.chosen} onChange={e => { const s = sources.find(x => x.id === e.target.value); set(i, { chosen: e.target.value, mode: e.target.value ? (s?.status === 'approved' ? 'reference' : r.mode === 'skip' ? 'draft' : r.mode) : 'skip' }) }} className="mt-0.5 w-full border border-gray-200 rounded px-2 py-1.5 bg-white text-sm text-gray-900">
                            <option value="">Skip this file</option>
                            {[...r.candidates.map(c => c.id), ...sources.map(s => s.id)].filter((v, k, a) => a.indexOf(v) === k).map(id => <option key={id} value={id}>{sources.find(s => s.id === id)?.name}</option>)}
                          </select>
                        </label>
                        <label className="block text-xs text-gray-500">Load as
                          <select value={r.mode} onChange={e => set(i, { mode: e.target.value as Row['mode'] })} disabled={!r.chosen} className="mt-0.5 w-full border border-gray-200 rounded px-2 py-1.5 bg-white text-sm text-gray-900">
                            <option value="reference">Save privately</option>
                            <option value="draft" disabled={chosenSrc?.status === 'approved'}>Load as data</option>
                            <option value="skip">Skip</option>
                          </select>
                        </label>
                      </div>
                      <div className="text-xs text-gray-500">
                        {!r.source_id && !r.chosen && <span className="text-amber-700">No clear match. Pick the source, or skip this file.</span>}
                        {!!r.chosen && <span>Now: {chosenSrc?.status?.replace(/_/g, ' ') ?? ''}{r.chosen === r.source_id && r.existing_records ? `, ${r.existing_records} records` : ''}</span>}
                        {!!r.saved_copies && r.chosen === r.source_id && <span> · {r.saved_copies} saved before</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {dup && <p className="text-xs text-red-600 m-0">Two files point at the same source. Pick one of them.</p>}
              <div className="flex gap-2"><Button loading={busy} disabled={!ready.length || dup} onClick={apply}>Load {ready.length} file{ready.length === 1 ? '' : 's'}</Button><Button variant="secondary" onClick={() => setRows(null)}>Back</Button></div>
            </>
          )}
          {result && (
            <>
              <p className="m-0"><b>{result.done} loaded</b>{result.failed ? `, ${result.failed} failed` : ''}. Nothing was submitted for review.</p>
              <ul className="m-0 pl-4 text-xs space-y-0.5">
                {result.results.map((r: any) => <li key={r.file}>{r.source_name ?? r.file}: {r.ok ? `${r.mode === 'draft' ? 'loaded as data, not submitted' : 'saved privately'}, ${r.records} records (${r.invalid} fail the SOP check)` : <span className="text-red-600">{r.error}</span>}</li>)}
              </ul>
              <Button onClick={close}>Done</Button>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
