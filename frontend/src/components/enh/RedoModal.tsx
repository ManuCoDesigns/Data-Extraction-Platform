import { useEffect, useMemo, useState } from 'react'
import { Check, Shuffle, X } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Avatar, Button, cn, toast } from '@/components/ui'

interface Person { user_id: string; name: string; email: string; role: string }

/**
 * Re-extraction round. Pick who takes part, press Shuffle, look at the plan, apply.
 * Every source gets a new extractor and a new reviewer. Nobody gets a source they worked on before, and everyone ends up with the same load.
 */
export interface RedoSource { id: string; name: string; status: string; extractor?: string }

export function RedoModal({ ids, names, sources, onClose, onDone }: { ids: string[]; names: Record<string, string>; sources?: RedoSource[]; onClose: () => void; onDone: () => void }) {
  const list: RedoSource[] = useMemo(() => sources ?? ids.map(i => ({ id: i, name: names[i] ?? 'A source', status: '' })), [sources, ids, names])
  const [chosen, setChosen] = useState<Set<string>>(new Set(ids.length ? ids : list.map(s => s.id)))
  const [q, setQ] = useState('')
  const [stat, setStat] = useState('')
  const shown = useMemo(() => list.filter(s => (!stat || s.status === stat) && (s.name + ' ' + (s.extractor ?? '')).toLowerCase().includes(q.toLowerCase())), [list, stat, q])
  const stats = useMemo(() => { const m: Record<string, number> = {}; list.forEach(s => { if (s.status) m[s.status] = (m[s.status] ?? 0) + 1 }); return m }, [list])
  const setMany = (xs: RedoSource[], on: boolean) => { setPlan(null); setChosen(c => { const n = new Set(c); xs.forEach(x => (on ? n.add(x.id) : n.delete(x.id))); return n }) }
  const pick = [...chosen]
  const [people, setPeople] = useState<Person[]>([])
  const [pool, setPool] = useState<Set<string>>(new Set())
  const [startOver, setStartOver] = useState(true)
  const [plan, setPlan] = useState<any>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | ''>('')
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    enhApi.people().then(r => {
      const list: Person[] = r.people
      setPeople(list)
      setPool(new Set(list.filter(p => !['org_admin', 'project_admin'].includes(p.role)).map(p => p.user_id)))   // admins are not given work unless ticked
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [busy, onClose])

  const toggle = (id: string) => { setPlan(null); setPool(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const shuffle = async () => {
    setBusy('plan')
    try { setPlan(await enhApi.redoPlan({ source_ids: pick, extractor_ids: [...pool] })) }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't make a plan") } finally { setBusy('') }
  }
  const apply = async () => {
    if (!plan) return
    const n = plan.assignments.length
    const warn = startOver && plan.with_records > 0 ? `\n\n${plan.with_records} of them have earlier records. Those are cleared (a copy is kept in the audit trail) and the scores recorded on them are removed.` : ''
    if (!window.confirm(`Assign ${n} source${n === 1 ? '' : 's'} now?${warn}\n\nEach extractor and reviewer is told what they have been given.`)) return
    setBusy('apply')
    try {
      const r = await enhApi.redoApply({ assignments: plan.assignments.map((a: any) => ({ source_id: a.source_id, extractor_id: a.extractor_id, reviewer_id: a.reviewer_id })), start_over: startOver, note: 'Re-extraction round' })
      setResult(r)
      onDone()
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't apply the plan") } finally { setBusy('') }
  }

  const maxLoad = useMemo(() => Math.max(1, ...(plan?.people ?? []).map((p: any) => p.load)), [plan])
  const st = (s: string) => s.replace(/_/g, ' ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Re-extract and shuffle">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-float w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 m-0 flex items-center gap-2"><Shuffle className="w-5 h-5 text-brand-600" /> Re-extract and shuffle</h3>
            <p className="text-sm text-gray-500 m-0 mt-0.5">{chosen.size} of {list.length} source{list.length === 1 ? '' : 's'} chosen. Each gets a new extractor and a new reviewer. Nobody gets a source they worked on before.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm">
                <b>Done.</b> {result.done} source{result.done === 1 ? '' : 's'} assigned{result.skipped ? `, ${result.skipped} skipped` : ''}. Everyone has been notified.
              </div>
              {result.skipped > 0 && (
                <ul className="m-0 p-0 list-none text-sm divide-y divide-gray-50">
                  {result.results.filter((r: any) => !r.ok).map((r: any, i: number) => <li key={i} className="py-2"><b>{r.name ?? names[r.source_id] ?? 'A source'}</b>: <span className="text-gray-600">{r.reason}</span></li>)}
                </ul>
              )}
              <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
            </div>
          ) : (
            <>
              <section aria-label="Which sources">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <p className="text-sm font-semibold text-gray-900 m-0 mr-1">Which sources</p>
                  <button type="button" onClick={() => setStat('')} aria-pressed={!stat} className={cn('text-xs font-semibold rounded-lg border px-2.5 py-1', !stat ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>All {list.length}</button>
                  {Object.entries(stats).map(([k, n]) => (
                    <button key={k} type="button" onClick={() => setStat(stat === k ? '' : k)} aria-pressed={stat === k}
                      className={cn('text-xs font-semibold rounded-lg border px-2.5 py-1 capitalize', stat === k ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>{st(k)} {n}</button>
                  ))}
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search sources" className="ml-auto text-sm border border-gray-200 rounded-lg px-2.5 py-1 w-40 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                </div>
                <div className="flex items-center gap-3 text-xs mb-1.5">
                  <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setMany(shown, true)}>Tick all {shown.length} shown</button>
                  <button type="button" className="font-semibold text-gray-600 hover:underline" onClick={() => setMany(shown, false)}>Untick shown</button>
                  <button type="button" className="font-semibold text-gray-600 hover:underline" onClick={() => { setPlan(null); setChosen(new Set()) }}>Clear all</button>
                </div>
                <ul className="m-0 p-1 list-none max-h-44 overflow-y-auto rounded-xl border border-gray-100 grid sm:grid-cols-2 gap-x-2">
                  {shown.length === 0 && <li className="px-3 py-4 text-sm text-gray-400 col-span-2">No sources match.</li>}
                  {shown.map(s => {
                    const on = chosen.has(s.id)
                    return (
                      <li key={s.id}>
                        <button type="button" role="checkbox" aria-checked={on} onClick={() => setMany([s], !on)} className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm', on ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                          <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300')}>{on && <Check className="w-3 h-3" />}</span>
                          <span className="truncate flex-1 text-gray-900">{s.name}</span>
                          <span className="text-[11px] text-gray-400 truncate max-w-[40%]">{s.extractor ?? ''}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section aria-label="Who takes part">
                <p className="text-sm font-semibold text-gray-900 m-0 mb-2">Who takes part</p>
                <div className="flex flex-wrap gap-2">
                  {people.map(p => {
                    const on = pool.has(p.user_id)
                    return (
                      <button key={p.user_id} type="button" onClick={() => toggle(p.user_id)} aria-pressed={on}
                        className={cn('inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border text-sm transition', on ? 'bg-brand-50 border-brand-300 text-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                        <Avatar name={p.name} size="sm" />
                        <span className="font-medium">{p.name}</span>
                        {['org_admin', 'project_admin'].includes(p.role) && <span className="text-[11px] text-gray-400">admin</span>}
                        <span className={cn('w-4 h-4 rounded border flex items-center justify-center', on ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300')}>{on && <Check className="w-3 h-3" />}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-500 m-0 mt-2">Everyone ticked both extracts and reviews. Admins are left out unless you tick them.</p>
                <label className="flex items-start gap-2 mt-3 text-sm text-gray-800 cursor-pointer">
                  <input type="checkbox" checked={startOver} onChange={e => { setStartOver(e.target.checked); }} className="mt-1" />
                  <span><b>Start over.</b> Reset each source to Not started and clear its earlier records, so the new extractor begins fresh. A copy of the old records stays in the audit trail. Untick to only change who is assigned.</span>
                </label>
                <div className="mt-3 flex items-center gap-2">
                  <Button onClick={shuffle} loading={busy === 'plan'} disabled={pool.size < 2 || chosen.size === 0}>{plan ? 'Shuffle again' : `Shuffle ${chosen.size} source${chosen.size === 1 ? '' : 's'}`}</Button>
                  {pool.size < 2 && <span className="text-xs text-amber-700">Pick at least two people, so the extractor and reviewer differ.</span>}
                </div>
              </section>

              {plan && (
                <>
                  {plan.unassigned.length > 0 && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                      <b>{plan.unassigned.length} source{plan.unassigned.length === 1 ? '' : 's'} can't be placed</b> with these people (everyone has worked on it before, or is not on its project). Tick more people, or leave them out:
                      <ul className="m-0 mt-1 pl-5">{plan.unassigned.slice(0, 6).map((u: any, i: number) => <li key={i}>{u.name !== 'A source' ? u.name : names[u.source_id] ?? u.name}: {u.why}</li>)}</ul>
                    </div>
                  )}
                  {plan.notes.map((n: string, i: number) => <div key={i} className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">{n}</div>)}
                  {startOver && plan.with_records > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 px-4 py-2 text-sm">
                      {plan.with_records} of these sources already have records. Starting over clears them and the scores recorded on them. A copy is kept in the audit trail.
                    </div>
                  )}

                  <section aria-label="Workload">
                    <p className="text-sm font-semibold text-gray-900 m-0 mb-2">Workload</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">{['Person', 'Extracts', 'Reviews', 'Total', 'Hard links', 'Effort'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                        <tbody>{plan.people.map((p: any) => (
                          <tr key={p.user_id} className="border-b border-gray-50">
                            <td className="px-3 py-2 font-semibold text-gray-900">{p.name}</td>
                            <td className="px-3 py-2 tabular-nums">{p.extract}</td>
                            <td className="px-3 py-2 tabular-nums">{p.review}</td>
                            <td className="px-3 py-2 tabular-nums font-semibold">{p.total}</td>
                            <td className="px-3 py-2 tabular-nums" title="Dead, blocked, broken or login-only websites">{p.hard_links}</td>
                            <td className="px-3 py-2 w-40"><div className="h-2 rounded-full bg-gray-100" title={`${p.load} effort points`}><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(100 * p.load) / maxLoad}%` }} /></div></td>
                          </tr>))}</tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-500 m-0 mt-1">Counts differ by one at most. Effort also weighs how big the earlier delivery was and how many websites are dead or blocked.</p>
                  </section>

                  <section aria-label="Plan">
                    <p className="text-sm font-semibold text-gray-900 m-0 mb-2">The plan</p>
                    <div className="overflow-auto max-h-72 rounded-xl border border-gray-100">
                      <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0 bg-gray-50"><tr className="text-left text-[11px] text-gray-500">{['Source', 'Now', 'Did it before', 'New extractor', 'Reviewer'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                        <tbody>{plan.assignments.map((a: any) => (
                          <tr key={a.source_id} className="border-t border-gray-50">
                            <td className="px-3 py-1.5 font-medium text-gray-900">{a.name}</td>
                            <td className="px-3 py-1.5 text-gray-500 capitalize">{st(a.status)}{a.records ? `, ${a.records} records` : ''}</td>
                            <td className="px-3 py-1.5 text-gray-500">{a.was_extractor.join(', ') || '–'}</td>
                            <td className="px-3 py-1.5 font-semibold text-gray-900">{a.extractor}</td>
                            <td className="px-3 py-1.5 text-gray-800">{a.reviewer ?? <span className="text-amber-700">None possible</span>}</td>
                          </tr>))}</tbody>
                      </table>
                    </div>
                  </section>

                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    <span className="text-xs text-gray-500">Nothing has changed yet. Shuffle again for a different mix, or apply this one.</span>
                    <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={apply} loading={busy === 'apply'} disabled={!plan.assignments.length}>Assign {plan.assignments.length} sources</Button></div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
