import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronUp, CornerUpLeft, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Avatar, Button, Modal, cn, toast } from '@/components/ui'

interface Person { user_id: string; name: string; email: string; role: string }
type Mode = 'extractor' | 'add_peers' | 'remove_peers' | 'send_back' | 'approve' | null

interface Props {
  ids: string[]
  names: Record<string, string>
  onClear: () => void
  onDone: () => void
}

/** Floating bar that appears when sources are ticked in the list: assign an extractor, add or remove peer reviewers. */
export function BulkBar({ ids, names, onClear, onDone }: Props) {
  const [people, setPeople] = useState<Person[]>([])
  const [mode, setMode] = useState<Mode>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [report, setReport] = useState<{ done: number; skipped: number; rows: { name: string; reason: string }[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { enhApi.people().then(r => setPeople(r.people)).catch(() => {}) }, [])
  useEffect(() => { setMode(null); setPick(new Set()); setQ(''); setNote('') }, [ids.length === 0])
  useEffect(() => {
    if (!mode) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMode(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [mode])

  const shown = useMemo(() => people.filter(p => (p.name + p.email).toLowerCase().includes(q.toLowerCase())), [people, q])
  const toggle = (id: string) => setPick(s => {
    const n = new Set(mode === 'extractor' ? [] : s)
    s.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const run = async (action: string, extra: { user_id?: string; user_ids?: string[]; note?: string } = {}) => {
    setBusy(true)
    try {
      const r = await enhApi.bulk({ source_ids: ids, action, ...extra })
      const rows = r.results.filter((x: any) => !x.ok).map((x: any) => ({ name: names[x.source_id] ?? 'A source', reason: x.reason ?? 'Skipped' }))
      if (r.skipped > 0) setReport({ done: r.done, skipped: r.skipped, rows })
      else toast.success(`Updated ${r.done} source${r.done === 1 ? '' : 's'}`)
      setMode(null); setPick(new Set()); setNote('')
      onDone()
      if (r.skipped === 0) onClear()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Couldn't update the sources")
    } finally { setBusy(false) }
  }

  const apply = () => {
    if (!pick.size) return
    if (mode === 'extractor') run('assign_extractor', { user_id: [...pick][0] })
    else if (mode === 'add_peers') run('add_peers', { user_ids: [...pick] })
    else if (mode === 'remove_peers') run('remove_peers', { user_ids: [...pick] })
  }

  const people_mode = mode === 'extractor' || mode === 'add_peers' || mode === 'remove_peers'
  const BTN = 'inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition whitespace-nowrap shrink-0'
  const title = mode === 'extractor' ? 'Who should extract?' : mode === 'add_peers' ? 'Who should peer review?' : 'Remove which peer reviewers?'

  return (
    <>
      <div ref={ref} role="toolbar" aria-label="Actions for the selected sources"
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[min(96vw,900px)] animate-slide-up">
        {mode === 'send_back' && (
          <div className="mb-2 bg-white rounded-2xl border border-gray-100 shadow-float overflow-hidden">
            <div className="px-4 pt-3 pb-2"><p className="text-sm font-bold text-gray-900 m-0">Send {ids.length} source{ids.length === 1 ? '' : 's'} back for fixes</p>
              <p className="text-xs text-gray-400 m-0 mt-0.5">Each extractor gets this note and a notice that needs action. Peer reviews who already submitted will look again.</p></div>
            <div className="px-4 pb-3">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus aria-label="Note for the extractors" placeholder="What needs fixing?"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none" />
            </div>
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-50 bg-gray-50/60">
              <span className="text-xs text-gray-500">Only work that has been delivered for review can be sent back.</span>
              <Button size="sm" onClick={() => run('send_back', { note })} loading={busy} disabled={note.trim().length < 3}>Send back</Button>
            </div>
          </div>
        )}
        {mode === 'approve' && (
          <div className="mb-2 bg-white rounded-2xl border border-gray-100 shadow-float overflow-hidden">
            <div className="px-4 pt-3 pb-3"><p className="text-sm font-bold text-gray-900 m-0">Approve {ids.length} source{ids.length === 1 ? '' : 's'}?</p>
              <p className="text-xs text-gray-500 m-0 mt-1 leading-relaxed">Only sources where every peer reviewer has submitted and every record is approved will be approved. Anything else is skipped and listed so you can open it.</p></div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-50 bg-gray-50/60">
              <Button size="sm" variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
              <Button size="sm" onClick={() => run('approve')} loading={busy}>Approve</Button>
            </div>
          </div>
        )}
        {people_mode && (
          <div className="mb-2 bg-white rounded-2xl border border-gray-100 shadow-float overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <p className="text-sm font-bold text-gray-900 m-0 flex-1">{title}</p>
              <span className="text-xs text-gray-400">{mode === 'extractor' ? 'Pick one' : 'Pick one or more'}</span>
            </div>
            <div className="px-4 pb-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name" autoFocus aria-label="Search people"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <ul className="m-0 px-2 pb-2 list-none max-h-56 overflow-y-auto scrollbar-thin">
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-400">No one matches.</li>}
              {shown.map(p => {
                const on = pick.has(p.user_id)
                return (
                  <li key={p.user_id}>
                    <button type="button" onClick={() => toggle(p.user_id)} aria-pressed={on}
                      className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition', on ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                      <Avatar name={p.name} size="sm" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-gray-900 truncate">{p.name}</span>
                        <span className="block text-xs text-gray-400 truncate">{p.role.replace('_', ' ')}</span></span>
                      <span className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0', on ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300')}>{on && <Check className="w-3.5 h-3.5" />}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-50 bg-gray-50/60">
              <span className="text-xs text-gray-500">Applies to {ids.length} source{ids.length === 1 ? '' : 's'}. People not on a source's project are skipped.</span>
              <Button size="sm" onClick={apply} loading={busy} disabled={!pick.size}>Apply</Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 bg-gray-900 text-white rounded-2xl shadow-float px-3 py-2.5">
          <span className="text-sm font-semibold px-2 tabular-nums whitespace-nowrap">{ids.length} selected</span>
          <span className="w-px h-6 bg-white/15" />
          <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-thin">
            <button type="button" onClick={() => { setMode(mode === 'extractor' ? null : 'extractor'); setPick(new Set()) }} className={cn(BTN, 'hover:bg-white/10', mode === 'extractor' && 'bg-white/15')}><UserPlus className="w-4 h-4" /> Assign</button>
            <button type="button" onClick={() => { setMode(mode === 'add_peers' ? null : 'add_peers'); setPick(new Set()) }} className={cn(BTN, 'hover:bg-white/10', mode === 'add_peers' && 'bg-white/15')}><Users className="w-4 h-4" /> Add peers</button>
            <button type="button" onClick={() => { setMode(mode === 'remove_peers' ? null : 'remove_peers'); setPick(new Set()) }} className={cn(BTN, 'hover:bg-white/10', mode === 'remove_peers' && 'bg-white/15')}><UserMinus className="w-4 h-4" /> Remove peers</button>
            <button type="button" disabled={busy} onClick={() => run('unassign_extractor')} className={cn(BTN, 'hover:bg-white/10 text-white/80')}>Unassign</button>
            <span className="w-px h-6 bg-white/15 shrink-0" />
            <button type="button" onClick={() => { setMode(mode === 'send_back' ? null : 'send_back'); setPick(new Set()) }} className={cn(BTN, 'hover:bg-white/10', mode === 'send_back' && 'bg-white/15')}><CornerUpLeft className="w-4 h-4" /> Send back</button>
            <button type="button" onClick={() => { setMode(mode === 'approve' ? null : 'approve'); setPick(new Set()) }} className={cn(BTN, 'hover:bg-white/10', mode === 'approve' && 'bg-white/15')}><CheckCheck className="w-4 h-4" /> Approve</button>
          </div>
          <ChevronUp className={cn('w-4 h-4 text-white/40 transition-transform', mode && 'rotate-180')} aria-hidden />
          <button type="button" onClick={onClear} aria-label="Clear selection" className="p-2 rounded-xl hover:bg-white/10 transition"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <Modal open={!!report} onClose={() => { setReport(null); onClear() }} title="Some sources were skipped"
        description={report ? `${report.done} updated, ${report.skipped} skipped.` : undefined}>
        <ul className="m-0 p-0 list-none divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {report?.rows.map((r, i) => (
            <li key={i} className="py-2.5"><p className="text-sm font-medium text-gray-900 m-0">{r.name}</p><p className="text-xs text-gray-500 m-0 mt-0.5">{r.reason}</p></li>
          ))}
        </ul>
        <div className="flex justify-end mt-4"><Button onClick={() => { setReport(null); onClear() }}>Done</Button></div>
      </Modal>
    </>
  )
}
