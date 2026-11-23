import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { sourcesApi } from '@/api/client'
import { Button, Modal, cn, toast } from '@/components/ui'

export interface ReuploadSource { id: string; name: string; status: string; extractor?: string; open?: boolean }

/** Opens many sources for one re-upload each by their own extractors. The old data is kept as a version on every upload. */
export function BulkReuploadModal({ sources, onClose, onDone }: { sources: ReuploadSource[]; onClose: () => void; onDone: () => void }) {
  const list = useMemo(() => sources.filter(s => s.status !== 'approved' && s.extractor), [sources])
  const people = useMemo(() => [...new Set(list.map(s => s.extractor as string))].sort(), [list])
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [hours, setHours] = useState(48)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ opened: { name: string }[]; skipped: { name: string; why: string }[] } | null>(null)
  const shown = list.filter(s => (!who || s.extractor === who) && s.name.toLowerCase().includes(q.toLowerCase()))
  const setMany = (xs: ReuploadSource[], on: boolean) => setChosen(c => { const n = new Set(c); xs.forEach(x => (on ? n.add(x.id) : n.delete(x.id))); return n })
  const allShown = shown.length > 0 && shown.every(s => chosen.has(s.id))

  const go = async () => {
    setBusy(true)
    try {
      const r = await sourcesApi.allowReuploadBulk([...chosen], hours, note.trim())
      setResult(r); onDone()
      toast.success(`Opened ${r.opened.length} ${r.opened.length === 1 ? 'source' : 'sources'} for re-upload`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not open them')
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Allow re-upload" description="Each extractor can replace the data on their sources once. The old data is kept as a version and the peer reviews start again.">
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="m-0 font-semibold text-emerald-700">{result.opened.length} opened. The extractors have been told.</p>
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
              <p className="m-0 font-semibold">Not opened</p>
              {result.skipped.map((s, i) => <p key={i} className="m-0">{s.name}: {s.why}</p>)}
            </div>
          )}
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search sources" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" />
            <select value={who} onChange={e => setWho(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900">
              <option value="">All extractors</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={allShown} onChange={e => setMany(shown, e.target.checked)} />
            Select all shown ({shown.length}). {chosen.size} chosen.
          </label>
          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {shown.length === 0 && <p className="m-0 p-3 text-xs text-gray-500">No sources match.</p>}
            {shown.map(s => (
              <label key={s.id} className={cn('flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50', chosen.has(s.id) && 'bg-brand-50/40')}>
                <input type="checkbox" checked={chosen.has(s.id)} onChange={e => setMany([s], e.target.checked)} />
                <span className="flex-1 min-w-0 truncate">{s.name}</span>
                <span className="text-xs text-gray-500 shrink-0">{s.extractor}</span>
                {s.open && <span className="text-[10px] font-bold text-emerald-700 shrink-0">open</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2 items-center text-xs text-gray-600">
            <span>Open for</span>
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-900">
              <option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option>
            </select>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Note for the extractors (optional)" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={go} loading={busy} disabled={chosen.size === 0}><Upload className="w-3.5 h-3.5" /> Allow re-upload for {chosen.size}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
