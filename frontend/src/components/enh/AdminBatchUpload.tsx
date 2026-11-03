import { useState } from 'react'
import { adminUploadApi, type BatchFile } from '@/api/adminUpload'
import { Button, Modal, toast } from '@/components/ui'

type Row = BatchFile & { chosen: string; mode: 'draft' | 'reference' | 'skip' }

/** Load a whole zip of record files at once. Each file is matched to its source, you check the match, and nothing is submitted. */
export function AdminBatchUpload({ projectId, onDone }: { projectId?: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sources, setSources] = useState<{ id: string; name: string; status: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)

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
      <Button variant="secondary" onClick={() => setOpen(true)} title="Load a zip of record files into their sources as drafts or reference copies">Admin batch upload</Button>
      <Modal open={open} onClose={close} title="Admin batch upload" description="One zip, many sources. Each file is matched to a source for you to check. Nothing is submitted.">
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
              <p className="text-xs text-gray-600 m-0"><b>Draft</b> saves the records and keeps the source in extraction. <b>Reference</b> keeps the file under Versions to compare with the extractor’s data and changes nothing on the source. Sources that already have records default to a reference copy.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2">File</th><th className="pr-2">Records</th><th className="pr-2">Source</th><th className="pr-2">Now</th><th>Load as</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.file} className="border-t border-gray-100 align-top">
                        <td className="py-1.5 pr-2 break-all">{r.file.split('/').pop()}{r.error && <div className="text-red-600">{r.error}</div>}</td>
                        <td className="pr-2">{r.records}{r.invalid ? <div className="text-amber-700">{r.invalid} fail the SOP check</div> : null}</td>
                        <td className="pr-2">
                          <select value={r.chosen} onChange={e => { const s = sources.find(x => x.id === e.target.value); set(i, { chosen: e.target.value, mode: e.target.value ? (s?.status === 'approved' ? 'reference' : r.mode === 'skip' ? 'draft' : r.mode) : 'skip' }) }} className="border border-gray-200 rounded px-1.5 py-1 bg-white max-w-[14rem]">
                            <option value="">Skip this file</option>
                            {[...r.candidates.map(c => c.id), ...sources.map(s => s.id)].filter((v, k, a) => a.indexOf(v) === k).map(id => <option key={id} value={id}>{sources.find(s => s.id === id)?.name}</option>)}
                          </select>
                          {!r.source_id && !r.chosen && <div className="text-amber-700">No clear match</div>}
                        </td>
                        <td className="pr-2">{r.chosen ? `${sources.find(s => s.id === r.chosen)?.status?.replace(/_/g, ' ') ?? ''}${r.chosen === r.source_id && r.existing_records ? `, ${r.existing_records} records` : ''}` : ''}</td>
                        <td>
                          <select value={r.mode} onChange={e => set(i, { mode: e.target.value as Row['mode'] })} disabled={!r.chosen} className="border border-gray-200 rounded px-1.5 py-1 bg-white">
                            <option value="draft" disabled={sources.find(s => s.id === r.chosen)?.status === 'approved'}>Draft</option>
                            <option value="reference">Reference</option>
                            <option value="skip">Skip</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dup && <p className="text-xs text-red-600 m-0">Two files point at the same source. Pick one of them.</p>}
              <div className="flex gap-2"><Button loading={busy} disabled={!ready.length || dup} onClick={apply}>Load {ready.length} file{ready.length === 1 ? '' : 's'}</Button><Button variant="secondary" onClick={() => setRows(null)}>Back</Button></div>
            </>
          )}
          {result && (
            <>
              <p className="m-0"><b>{result.done} loaded</b>{result.failed ? `, ${result.failed} failed` : ''}. Nothing was submitted for review.</p>
              <ul className="m-0 pl-4 text-xs space-y-0.5">
                {result.results.map((r: any) => <li key={r.file}>{r.source_name ?? r.file}: {r.ok ? `${r.mode === 'draft' ? 'saved as a draft' : 'kept as a reference copy'}, ${r.records} records (${r.invalid} fail the SOP check)` : <span className="text-red-600">{r.error}</span>}</li>)}
              </ul>
              <Button onClick={close}>Done</Button>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
