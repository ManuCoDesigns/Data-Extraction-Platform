import { useEffect, useMemo, useState } from 'react'
import { downloadText, toCsv } from '@/lib/csv'
import { Link } from 'react-router-dom'
import { qualityApi } from '@/api/client'
import { Blank, Skeletons } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { A4, OnePager } from '@/components/enh/reports/OnePager'
import { EngagementDeck, SLIDE, useFit } from '@/components/enh/reports/EngagementDeck'

// The report is a fixed light page (it is meant to be printed or sent), so it uses its own colours, not the app theme.
const STAGE_COLOR: Record<string, string> = {
  delivered: '#1d4ed8', signoff: '#3b82f6', peer_review: '#93c5fd', needs_fixes: '#f59e0b', extracting: '#a5b4fc', not_started: '#d1d5db', blocked: '#f97316',
}
const BLOCK_STYLE: Record<string, { bg: string; fg: string }> = {
  link: { bg: '#fdf0e6', fg: '#c2410c' }, nodata: { bg: '#f1ebfb', fg: '#6d28d9' }, question: { bg: '#fce8f1', fg: '#be185d' },
}
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 10) / 10}%`)

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0)
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`
}

function Donut({ stages, percent }: { stages: { key: string; label: string; count: number }[]; percent: number }) {
  const total = stages.reduce((n, s) => n + s.count, 0) || 1
  let a = -Math.PI / 2
  return (
    <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label={`${percent}% delivered`}>
      {stages.filter(s => s.count > 0).map(s => {
        const span = (2 * Math.PI * s.count) / total
        const full = s.count === total
        const d = full ? `${arc(120, 120, 70, 112, a, a + Math.PI)} ${arc(120, 120, 70, 112, a + Math.PI, a + 2 * Math.PI - 0.0001)}` : arc(120, 120, 70, 112, a, a + span - 0.012)
        a += span
        return <path key={s.key} d={d} fill={STAGE_COLOR[s.key]}><title>{s.label}: {s.count}</title></path>
      })}
      <text x="120" y="118" textAnchor="middle" fontSize="38" fontWeight="700" fill="#1d4ed8">{percent}%</text>
      <text x="120" y="142" textAnchor="middle" fontSize="13" fill="#6b7280">delivered</text>
    </svg>
  )
}

function reportText(d: any) {
  const blocked = d.blocked.map((g: any) => `- ${g.title} (${g.items.length}): ${g.items.map((i: any) => i.name).join(', ')}. Need from you: ${g.need}.`).join('\n')
  return [`${d.label} status update`, '', ...d.highlights, ...(blocked ? ['', "What's blocked:", blocked] : [])].join('\n')
}

/** One page per Xtrium pull, built from live data: progress, what is blocked and what we need, people and accuracy. Print it to save as a PDF. */
type Mode = 'page' | 'detail' | 'deck'

export function BatchReport({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<Mode>('page')
  const [eng, setEng] = useState<any>(null)
  const fitA = useFit(A4.w), fitD = useFit(SLIDE.w)
  const [list, setList] = useState<any[] | null>(null)
  const [key, setKey] = useState('')
  const [d, setD] = useState<any>(null)
  const [stageFilter, setStageFilter] = useState('')

  useEffect(() => {
    qualityApi.batchList(projectId || undefined).then(r => {
      setList(r.batches); setKey(k => (k && r.batches.some((b: any) => b.key === k) ? k : r.batches.filter((b: any) => b.key !== 'other').slice(-1)[0]?.key || r.batches[0]?.key || ''))
    }).catch(() => setList([]))
  }, [projectId])
  useEffect(() => {
    if (!key) { setD(null); return }
    setD(null); setStageFilter('')
    qualityApi.batchReport(key, projectId || undefined).then(setD).catch(() => setD({ error: true }))
  }, [key, projectId])

  useEffect(() => {
    if (mode !== 'deck') return
    setEng(null)
    qualityApi.engagement(projectId || undefined).then(setEng).catch(() => setEng({ error: true }))
  }, [mode, projectId])

  const shown = useMemo(() => (d?.sources ?? []).filter((s: any) => !stageFilter || s.stage === stageFilter), [d, stageFilter])
  const delivered = () => {
    const rows = mode === 'deck' ? (eng?.delivered_rows ?? []) : (d?.sources ?? []).filter((s: any) => s.stage === 'delivered').map((s: any) => ({ name: s.name, project: s.project, item_no: s.item_no, records: s.approved, approved_at: s.approved_at, submitted_at: s.submitted_at, batch: d.label }))
    if (!rows.length) { toast.error('Nothing delivered yet'); return }
    downloadText(`delivered_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Source', 'Project', 'Xtrium item', 'Batch', 'Approved records', 'Approved', 'Submitted to Xtrium'],
      rows.map((r: any) => [r.name, r.project ?? '', r.item_no ?? '', r.batch ?? '', r.records, (r.approved_at || '').slice(0, 10), (r.submitted_at || '').slice(0, 10)])))
  }
  const copy = async () => { try { await navigator.clipboard.writeText(reportText(d)); toast.success('Status text copied') } catch { toast.error('Could not copy') } }

  if (!list) return <Skeletons rows={3} />
  if (!list.length) return <Blank title="No batches yet" text="A batch is every source pulled from Xtrium on the same day. Pull some work and the report builds itself." />
  const date = d?.generated_at ? new Date(d.generated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <div className="space-y-4">
      <style>{`@media print { body * { visibility: hidden !important } ${mode === 'page' ? '#onepager-wrap' : mode === 'deck' ? '#deck-wrap' : '#batch-report'}, ${mode === 'page' ? '#onepager-wrap' : mode === 'deck' ? '#deck-wrap' : '#batch-report'} * { visibility: visible !important } ${mode === 'page' ? '#onepager-wrap' : mode === 'deck' ? '#deck-wrap' : '#batch-report'} { position: absolute; left: 0; top: 0; ${mode === 'detail' ? 'width: 100%;' : 'zoom: 1 !important; width: auto !important; height: auto !important; overflow: visible !important;'} } html, body { margin: 0 !important; padding: 0 !important; background: #fff !important } .no-print { display: none !important } @page { ${mode === 'page' ? 'size: 210mm 297mm; margin: 0' : mode === 'deck' ? `size: ${SLIDE.w}px ${SLIDE.h}px; margin: 0` : 'size: A4; margin: 8mm'} } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } .avoid-break { break-inside: avoid } #deck-wrap { gap: 0 !important } .deck-slide { break-after: page; page-break-after: always } .deck-slide:last-child { break-after: auto; page-break-after: auto } }`}</style>
      <div className="no-print flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 text-sm">
          {([['page', 'One page'], ['detail', 'Batch detail'], ['deck', 'Full engagement report']] as [Mode, string][]).map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg ${mode === m ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>
        {mode !== 'deck' && (
          <label className="text-sm text-gray-600 flex items-center gap-2">Batch
            <select value={key} onChange={e => setKey(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900">
              {list.map(b => <option key={b.key} value={b.key}>{b.label} · {b.delivered}/{b.sources} delivered</option>)}
            </select>
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={mode === 'deck' ? !eng || eng.error : !d || d.error} onClick={delivered}>Delivered CSV</Button>
          {mode !== 'deck' && <Button variant="secondary" disabled={!d || d.error} onClick={copy}>Copy status text</Button>}
          <Button disabled={mode === 'deck' ? !eng || eng.error : !d || d.error} onClick={() => window.print()}>Save as PDF</Button>
        </div>
      </div>
      {mode !== 'detail' && <p className="no-print text-xs text-gray-500 m-0">{mode === 'page' ? 'One A4 page. In the print window choose "Save as PDF", with margins set to None.' : 'Slides for the whole engagement, one per page. In the print window choose "Save as PDF", with margins set to None.'}</p>}

      {mode === 'page' && (!d ? <Skeletons rows={4} /> : d.error ? <Blank title="Couldn't build the report" text="Try again in a moment." /> : (
        <div ref={fitA.ref} className="w-full"><div id="onepager-wrap" style={{ zoom: fitA.s, width: A4.w, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,.18)', borderRadius: 6, overflow: 'hidden' }}><OnePager d={d} /></div></div>
      ))}
      {mode === 'deck' && (!eng ? <Skeletons rows={4} /> : eng.error ? <Blank title="Couldn't build the report" text="Try again in a moment." /> : (
        <div ref={fitD.ref} className="w-full"><div id="deck-wrap" style={{ zoom: fitD.s, width: SLIDE.w, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}><EngagementDeck e={eng} /></div></div>
      ))}
      {mode === 'detail' && (!d ? <Skeletons rows={4} /> : d.error ? <Blank title="Couldn't build the report" text="Try again in a moment." /> : (
        <div id="batch-report" className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm" style={{ background: '#fff', color: '#111827' }}>
          <div style={{ background: '#1473f0', color: '#fff' }} className="px-7 pt-7 pb-8">
            <div className="flex items-start justify-between gap-4">
              <span className="inline-block rounded-xl px-4 py-2 font-bold text-lg" style={{ background: '#fff', color: '#1f2937' }}>Careerflow.ai</span>
              <span className="text-sm opacity-90 text-right">{d.label} status update, {date}</span>
            </div>
            <h2 className="mt-6 mb-1 text-4xl font-bold tracking-tight" style={{ color: '#fff' }}>{d.label.replace(/\s*\(.*\)/, '')} report</h2>
            <p className="m-0 text-lg opacity-95"><b>{d.totals.delivered}</b> of <b>{d.totals.sources}</b> sources delivered so far, <b>{d.totals.percent}%</b> of the batch. Pulled from Xtrium on {d.date}.</p>

            <div className="mt-6 rounded-2xl p-5 grid gap-6 md:grid-cols-[240px_1fr] items-center avoid-break" style={{ background: '#fff', color: '#111827' }}>
              <div className="mx-auto"><Donut stages={d.stages} percent={d.totals.percent} /></div>
              <div>
                <h3 className="m-0 text-lg font-bold">Where the {d.totals.sources} sources are</h3>
                <table className="w-full text-sm mt-2">
                  <tbody>
                    {d.stages.filter((s: any) => s.count > 0).map((s: any) => (
                      <tr key={s.key} className="border-t" style={{ borderColor: '#f1f5f9' }}>
                        <td className="py-1.5"><span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: STAGE_COLOR[s.key] }} />{s.label}</td>
                        <td className="font-bold text-lg tabular-nums" style={{ color: ['not_started', 'peer_review', 'extracting'].includes(s.key) ? '#4b5563' : STAGE_COLOR[s.key] }}>{s.count}</td>
                        <td className="w-1/3"><div className="h-2 rounded-full" style={{ background: '#e5e7eb' }}><div className="h-2 rounded-full" style={{ width: `${(100 * s.count) / d.totals.sources}%`, background: STAGE_COLOR[s.key] }} /></div></td>
                        <td className="text-right tabular-nums text-gray-600 pl-2">{Math.round((100 * s.count) / d.totals.sources)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs mt-3 mb-0" style={{ color: '#6b7280' }}>{d.totals.records_approved} of {d.totals.records} records approved. {d.totals.submitted_to_xtrium} sources already submitted to Xtrium.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Delivered', `${d.totals.delivered} of ${d.totals.sources}`, `${d.totals.records_approved} records approved`],
                ['Still moving', String(d.totals.in_progress), 'In extraction, fixes or review'],
                ['Blocked', String(d.totals.blocked), d.totals.blocked ? 'Each group below needs a decision' : 'Nothing is waiting on you'],
                ['Average time', d.timing.avg_days_delivered === null ? '–' : `${d.timing.avg_days_delivered} days`, d.timing.longest_waiting_days === null ? 'From pull to delivered' : `Longest open: ${d.timing.longest_waiting_days} days`],
              ].map(([h, v, s]) => (
                <div key={h} className="rounded-xl p-4 avoid-break" style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.3)' }}>
                  <div className="text-sm opacity-90">{h}</div><div className="text-2xl font-bold">{v}</div><div className="text-xs opacity-85">{s}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-7 py-7 space-y-8" style={{ background: '#fff' }}>
            <section className="avoid-break">
              <h3 className="m-0 text-2xl font-bold">What's blocked<span style={{ color: '#1473f0' }}>*</span></h3>
              <p className="mt-1 mb-3 text-sm" style={{ color: '#4b5563' }}>{d.blocked.length ? `${d.totals.blocked} ${d.totals.blocked === 1 ? 'source' : 'sources'} can't move as things stand. We flag them early so they don't hold up the rest, and each group needs a decision from you.` : 'No source in this batch is blocked.'}</p>
              <div className="grid gap-3 md:grid-cols-3">
                {d.blocked.map((g: any) => {
                  const st = BLOCK_STYLE[g.kind] || BLOCK_STYLE.link
                  return (
                    <div key={g.kind + g.title} className="rounded-2xl p-4 avoid-break" style={{ background: st.bg }}>
                      <div className="flex gap-3 items-start"><span className="text-4xl font-bold leading-none" style={{ color: st.fg }}>{g.items.length}</span>
                        <div><div className="font-bold" style={{ color: '#111827' }}>{g.title}</div><div className="text-xs mt-0.5"><b style={{ color: st.fg }}>Need from you: </b><span style={{ color: '#4b5563' }}>{g.need}</span></div></div></div>
                      <ul className="list-none p-0 mt-3 mb-0 space-y-1 text-[13px] border-t pt-2" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
                        {g.items.map((i: any) => <li key={i.source_id}><b style={{ color: st.fg }}>{i.item_no ? `#${i.item_no}` : ''}</b> {i.name}{i.detail ? <span style={{ color: '#6b7280' }}> — {i.detail}</span> : null}</li>)}
                      </ul>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs mt-3 mb-0" style={{ color: '#6b7280' }}>* This list updates as we find more.</p>
            </section>

            {d.observations?.length > 0 && (
              <section className="avoid-break">
                <h3 className="m-0 text-xl font-bold">What extractors and reviewers ran into</h3>
                <p className="mt-1 mb-2 text-xs" style={{ color: '#6b7280' }}>{d.observation_checks.done} of {d.observation_checks.total} required observation checks recorded for this batch.</p>
                <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                  {d.observations.map((o: any) => (
                    <div key={o.kind} className="flex justify-between text-sm"><span>{o.label}</span><span className="tabular-nums" style={{ color: '#6b7280' }}>{o.count} on {o.sources} {o.sources === 1 ? 'source' : 'sources'}</span></div>
                  ))}
                </div>
              </section>
            )}

            <section className="avoid-break">
              <h3 className="m-0 text-xl font-bold">Summary</h3>
              <ul className="mt-2 mb-0 pl-5 text-sm space-y-1" style={{ color: '#374151' }}>{d.highlights.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
            </section>

            {d.quality && (
              <section className="avoid-break">
                <h3 className="m-0 text-xl font-bold">Accuracy of this batch</h3>
                <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-4">
                  {[['Final accuracy', pct(d.quality.final_accuracy), `${d.quality.fields} fields checked`], ['Right first time', pct(d.quality.first_pass_accuracy), 'Before any fixes'], ['Errors per 100 fields', d.quality.errors_per_100 ?? '–', `${d.quality.errors} errors found`], ['Caught in review', pct(d.quality.caught_rate), 'Share of known errors peers found']].map(([h, v, s]) => (
                    <div key={h as string} className="rounded-xl p-4" style={{ background: '#f4f7ff' }}><div className="text-xs" style={{ color: '#6b7280' }}>{h}</div><div className="text-2xl font-bold" style={{ color: '#1d4ed8' }}>{v}</div><div className="text-xs" style={{ color: '#6b7280' }}>{s}</div></div>
                  ))}
                </div>
              </section>
            )}

            {d.by_type.length > 1 && (
              <section className="avoid-break">
                <h3 className="m-0 text-xl font-bold">By type</h3>
                <div className="mt-2 grid gap-x-8 gap-y-2 md:grid-cols-2">
                  {d.by_type.map((t: any) => (
                    <div key={t.type} className="text-sm"><div className="flex justify-between"><span>{t.type}</span><span className="tabular-nums" style={{ color: '#6b7280' }}>{t.delivered} of {t.total}</span></div>
                      <div className="h-1.5 rounded-full mt-1" style={{ background: '#e5e7eb' }}><div className="h-1.5 rounded-full" style={{ width: `${(100 * t.delivered) / t.total}%`, background: '#1d4ed8' }} /></div></div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="m-0 text-xl font-bold">Every source</h3>
                <div className="no-print flex gap-1.5 flex-wrap">
                  <button onClick={() => setStageFilter('')} className={`px-2.5 py-1 rounded-full text-xs border ${!stageFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'}`}>All {d.totals.sources}</button>
                  {d.stages.filter((s: any) => s.count > 0).map((s: any) => <button key={s.key} onClick={() => setStageFilter(stageFilter === s.key ? '' : s.key)} className={`px-2.5 py-1 rounded-full text-xs border ${stageFilter === s.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'}`}>{s.label} {s.count}</button>)}
                </div>
              </div>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs" style={{ background: '#1473f0', color: '#fff' }}>
                    {['Source', 'Stage', 'Records', 'Peer reviews', 'Approved', 'Days', 'Accuracy'].map(h => <th key={h} className="py-2 px-2.5 font-semibold">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {shown.map((s: any, i: number) => (
                      <tr key={s.source_id} className="avoid-break" style={{ background: i % 2 ? '#f6f8ff' : '#fff' }}>
                        <td className="py-1.5 px-2.5"><Link to={`/projects/${s.project_id}/sources/${s.source_id}`} className="no-underline font-medium" style={{ color: '#111827' }}>{s.name}</Link>{s.item_no ? <span style={{ color: '#9ca3af' }}> #{s.item_no}</span> : null}</td>
                        <td className="px-2.5 whitespace-nowrap"><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: STAGE_COLOR[s.stage] }} />{d.stages.find((x: any) => x.key === s.stage)?.label}</td>
                        <td className="px-2.5 tabular-nums">{s.approved}/{s.records}</td>
                        <td className="px-2.5 tabular-nums">{s.peers_done}/{s.peers_total}</td>
                        <td className="px-2.5 tabular-nums whitespace-nowrap">{s.approved_at ? s.approved_at.slice(0, 10) : '–'}</td>
                        <td className="px-2.5 tabular-nums whitespace-nowrap">{s.days ?? '–'}{s.on_hold ? <span style={{ color: '#6b7280' }}> · on hold</span> : null}</td>
                        <td className="px-2.5 tabular-nums">{pct(s.final_accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="avoid-break">
              <h3 className="m-0 text-xl font-bold">Team</h3>
              <p className="mt-2 mb-0 text-sm" style={{ color: '#374151' }}>{d.team.extractors} {d.team.extractors === 1 ? 'extractor' : 'extractors'} and {d.team.reviewers} peer {d.team.reviewers === 1 ? 'reviewer' : 'reviewers'} worked this batch. {d.team.peer_done} of {d.team.peer_total} peer reviews are submitted.</p>
            </section>
            <p className="text-xs m-0" style={{ color: '#9ca3af' }}>Built from live platform data on {date}. Nothing here is typed by hand.</p>
          </div>
        </div>
      ))}
    </div>
  )
}
