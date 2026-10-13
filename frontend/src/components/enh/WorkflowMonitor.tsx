import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Download, Search } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Avatar, Button, cn, toast } from '@/components/ui'
import { Blank, Chip, Panel, Skeletons, Tile, type Tone, shortAgo } from '@/components/enh/kit'

type Stage = 'not_started' | 'extracting' | 'needs_fixes' | 'peer_review' | 'signoff' | 'delivered'
const STAGES: { key: Stage; label: string; hint: string; tone: Tone; bar: string }[] = [
  { key: 'not_started', label: 'Not started', hint: 'Waiting for an extractor', tone: 'gray', bar: 'bg-gray-300' },
  { key: 'extracting', label: 'Extracting', hint: 'Being worked on now', tone: 'blue', bar: 'bg-blue-500' },
  { key: 'needs_fixes', label: 'Needs fixes', hint: 'Sent back to the extractor', tone: 'amber', bar: 'bg-amber-500' },
  { key: 'peer_review', label: 'Peer review', hint: 'Waiting for peer reviewers', tone: 'purple', bar: 'bg-purple-500' },
  { key: 'signoff', label: 'Admin sign-off', hint: 'Peers are done', tone: 'indigo', bar: 'bg-indigo-500' },
  { key: 'delivered', label: 'Delivered', hint: 'Approved', tone: 'green', bar: 'bg-emerald-500' },
]
const STAGE = Object.fromEntries(STAGES.map(s => [s.key, s])) as Record<Stage, typeof STAGES[number]>

interface Row {
  source_id: string; project_id: string; project: string; name: string; item_no?: string | number | null; stage: Stage; extractor?: string | null
  peers_done: number; peers_total: number; records: number; valid: number; approved: number; sent_back: number; days_in_stage: number | null; updated_at?: string
}
interface Data {
  stages: Record<Stage, number>; totals: Record<string, number>
  series: { buckets: string[]; step_days: number; extracted: number[]; peer_submitted: number[]; sent_back: number[]; delivered: number[] }
  projects: { project_id: string; name: string; sources: number; stages: Record<Stage, number>; records: number; approved: number; sent_back: number; peers_done: number; peers_total: number; last_activity?: string | null }[]
  sources: Row[]
}
interface Person { user_id: string; name: string; ext_open: number; ext_delivered: number; returned: number; peer_pending: number; peer_submitted: number; records: number }

const LINES = [
  { key: 'extracted', label: 'Records extracted', color: '#3b82f6' },
  { key: 'peer_submitted', label: 'Peer reviews submitted', color: '#a855f7' },
  { key: 'sent_back', label: 'Records sent back', color: '#ef4444' },
  { key: 'delivered', label: 'Sources delivered', color: '#10b981' },
] as const
type LineKey = typeof LINES[number]['key']

function StageBar({ stages, total, className }: { stages: Record<Stage, number>; total: number; className?: string }) {
  return (
    <span className={cn('flex h-2 w-full rounded-full overflow-hidden bg-gray-100', className)} role="img"
      aria-label={STAGES.map(s => `${stages[s.key] ?? 0} ${s.label}`).join(', ')}>
      {total > 0 && STAGES.map(s => (stages[s.key] ?? 0) > 0 && <span key={s.key} className={s.bar} style={{ width: `${(100 * stages[s.key]) / total}%` }} title={`${s.label}: ${stages[s.key]}`} />)}
    </span>
  )
}

function ActivityChart({ data }: { data: Data['series'] }) {
  const [on, setOn] = useState<Record<LineKey, boolean>>({ extracted: true, peer_submitted: true, sent_back: true, delivered: true })
  const [hover, setHover] = useState<number | null>(null)
  const W = 760, H = 220, L = 34, R = 12, T = 12, B = 26
  const n = data.buckets.length
  const max = Math.max(1, ...LINES.filter(l => on[l.key]).flatMap(l => data[l.key]))
  const nice = Math.max(1, Math.ceil(max / 4) * 4)
  const x = (i: number) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1))
  const y = (v: number) => T + (1 - v / nice) * (H - T - B)
  const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const ticks = [0, 1, 2, 3, 4].map(i => (nice * i) / 4)
  const labelIdx = n <= 8 ? data.buckets.map((_, i) => i) : [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1]
  const empty = LINES.every(l => data[l.key].every(v => v === 0))
  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))))
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {LINES.map(l => (
          <button key={l.key} type="button" aria-pressed={on[l.key]} onClick={() => setOn(o => ({ ...o, [l.key]: !o[l.key] }))}
            className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition', on[l.key] ? 'border-gray-200 text-gray-700 bg-white' : 'border-transparent text-gray-400 bg-gray-50')}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: on[l.key] ? l.color : '#9ca3af' }} /> {l.label}
            <span className="tabular-nums text-gray-400">{data[l.key].reduce((a, b) => a + b, 0)}</span>
          </button>
        ))}
      </div>
      {empty ? <Blank title="No activity in this period" text="Try a longer period." /> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Daily activity" onMouseMove={move} onMouseLeave={() => setHover(null)}>
            {ticks.map(t => (
              <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-gray-100" strokeWidth={1} />
                <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={10} className="fill-gray-400">{Math.round(t)}</text></g>
            ))}
            {labelIdx.map(i => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={10} className="fill-gray-400">{fmt(data.buckets[i])}</text>)}
            {LINES.filter(l => on[l.key]).map(l => (
              <polyline key={l.key} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={data[l.key].map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="currentColor" className="text-gray-300" strokeDasharray="3 3" />}
            {hover !== null && LINES.filter(l => on[l.key]).map(l => <circle key={l.key} cx={x(hover)} cy={y(data[l.key][hover])} r={3.5} fill={l.color} />)}
          </svg>
          {hover !== null && (
            <div className="absolute top-1 pointer-events-none bg-white border border-gray-200 rounded-xl shadow-float px-3 py-2 text-xs"
              style={{ left: `${Math.min(78, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}>
              <p className="font-semibold text-gray-900 m-0 mb-1">{data.step_days > 1 ? 'Week of ' : ''}{fmt(data.buckets[hover])}</p>
              {LINES.filter(l => on[l.key]).map(l => (
                <p key={l.key} className="m-0 flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: l.color }} />{l.label}<b className="ml-auto pl-3 tabular-nums text-gray-900">{data[l.key][hover]}</b></p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function WorkflowMonitor({ project, days, projects, onPickProject }: { project: string; days: number; projects: { id: string; name: string }[]; onPickProject: (id: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<Stage | ''>('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(30)
  const [reminded, setReminded] = useState<Set<string>>(new Set())
  const [nudging, setNudging] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, p] = await Promise.all([enhApi.monitor(days, project || undefined), enhApi.peopleStats(days, project || undefined)])
      setData(m); setPeople(p.people ?? [])
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't load the workflow") } finally { setLoading(false) }
  }, [days, project])
  useEffect(() => { load(); setStage(''); setLimit(30) }, [load])
  useEffect(() => { const t = setInterval(load, 120000); return () => clearInterval(t) }, [load])

  const rows = useMemo(() => {
    const nq = q.trim().toLowerCase()
    return (data?.sources ?? []).filter(r => (!stage || r.stage === stage) && (!nq || `${r.name} ${r.extractor ?? ''} ${r.project ?? ''} ${r.item_no ?? ''}`.toLowerCase().includes(nq)))
  }, [data, stage, q])

  const stuck = useMemo(() => rows.filter(r => r.stage !== 'delivered' && (r.days_in_stage ?? 0) >= 7 && (r.stage !== 'not_started' || r.extractor)), [rows])
  const remind = async (ids: string[]) => {
    if (!ids.length || nudging) return
    setNudging(true)
    try {
      const res = await enhApi.nudge(ids)
      setReminded(prev => new Set([...prev, ...ids]))
      if (res.sent) toast.success(`Reminder sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}`)
      else toast.info(res.skipped[0]?.reason ? `Nobody reminded: ${res.skipped[0].reason}` : 'Nobody to remind')
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't send the reminder") } finally { setNudging(false) }
  }

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Source', 'Item', 'Project', 'Stage', 'Extractor', 'Peer reviews done', 'Peer reviews total', 'Records', 'Valid', 'Approved', 'Sent back', 'Days in stage']
    const body = rows.map(r => [r.name, r.item_no ?? '', r.project, STAGE[r.stage].label, r.extractor ?? '', r.peers_done, r.peers_total, r.records, r.valid, r.approved, r.sent_back, r.days_in_stage ?? ''])
    const blob = new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `workflow_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (loading && !data) return <Skeletons rows={6} />
  if (!data || !data.totals.sources) return <Panel><Blank title="No sources to show" text="Pick another project, or add sources first." /></Panel>
  const t = data.totals
  const sentPct = t.records ? Math.round((100 * t.records_sent_back) / t.records) : 0
  const peerPct = t.peers_total ? Math.round((100 * t.peers_done) / t.peers_total) : 0
  const people_sorted = [...people].filter(p => p.ext_open || p.peer_pending || p.peer_submitted || p.ext_delivered || p.returned)
    .sort((a, b) => (b.ext_open + b.peer_pending) - (a.ext_open + a.peer_pending))

  return (
    <div className="space-y-5">
      <section aria-label="Where every source is">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900 m-0">Where every source is <span className="font-normal text-gray-400">· {t.sources} sources, {t.percent}% delivered</span></h2>
          {stage && <button type="button" onClick={() => setStage('')} className="text-xs font-semibold text-brand-600 hover:underline">Show all stages</button>}
        </div>
        <StageBar stages={data.stages} total={t.sources} className="h-3 mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map(s => <Tile key={s.key} label={s.label} value={data.stages[s.key] ?? 0} tone={s.tone} hint={s.hint} active={stage === s.key}
            onClick={() => setStage(stage === s.key ? '' : s.key)} />)}
        </div>
      </section>

      <section aria-label="Totals" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Records" value={t.records} tone="blue" hint="Extracted so far" />
        <Tile label="Approved" value={t.records_approved} tone="green" hint="Records signed off" />
        <Tile label="Sent back" value={t.records_sent_back} tone={sentPct > 25 ? 'red' : sentPct > 10 ? 'amber' : 'gray'} hint={`${sentPct}% of records needed a fix`} />
        <Tile label="Peer reviews" value={`${t.peers_done}/${t.peers_total}`} tone="purple" hint={`${peerPct}% submitted`} />
        <Tile label="Stuck" value={t.stuck} tone={t.stuck ? 'red' : 'gray'} hint="No movement for 7+ days" />
        <Tile label="Sent to client" value={t.submitted_to_client} tone="indigo" hint="Submitted to Xtrium" />
      </section>

      <Panel title="Activity" subtitle={`What happened each ${data.series.step_days > 1 ? 'week' : 'day'}. Hover to read the numbers.`}>
        <ActivityChart data={data.series} />
      </Panel>

      {!project && data.projects.length > 1 && (
        <Panel flush title="Projects" subtitle="Click a project to look at it on its own.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                <th className="font-medium px-5 py-2.5">Project</th><th className="font-medium px-3 py-2.5 w-56">Stages</th>
                <th className="font-medium px-3 py-2.5 text-right">Delivered</th><th className="font-medium px-3 py-2.5 text-right">Records</th>
                <th className="font-medium px-3 py-2.5 text-right">Peers</th><th className="font-medium px-3 py-2.5 text-right">Sent back</th><th className="font-medium px-3 py-2.5 text-right pr-5">Last activity</th>
              </tr></thead>
              <tbody>
                {data.projects.map(p => (
                  <tr key={p.project_id} onClick={() => onPickProject(p.project_id)} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
                    <td className="px-5 py-3 font-medium text-gray-900">{p.name}<span className="block text-xs font-normal text-gray-400">{p.sources} sources</span></td>
                    <td className="px-3 py-3"><StageBar stages={p.stages} total={p.sources} /></td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-600">{p.stages.delivered}<span className="text-gray-300 font-normal"> / {p.sources}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{p.approved}<span className="text-gray-300"> / {p.records}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{p.peers_done}<span className="text-gray-300"> / {p.peers_total}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.sent_back ? <Chip tone="amber">{p.sent_back}</Chip> : <span className="text-gray-300">0</span>}</td>
                    <td className="px-3 py-3 text-right pr-5 text-xs text-gray-400">{shortAgo(p.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {people_sorted.length > 0 && (
        <Panel flush title="Who has what" subtitle="Everyone's open work right now, with what they delivered in this period.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                <th className="font-medium px-5 py-2.5">Person</th><th className="font-medium px-3 py-2.5 text-right">Extracting now</th><th className="font-medium px-3 py-2.5 text-right">Peer reviews waiting</th>
                <th className="font-medium px-3 py-2.5 text-right">Peer reviews done</th><th className="font-medium px-3 py-2.5 text-right">Records sent back</th><th className="font-medium px-3 py-2.5 text-right pr-5">Delivered</th>
              </tr></thead>
              <tbody>
                {people_sorted.map(p => (
                  <tr key={p.user_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-5 py-3"><span className="flex items-center gap-2.5"><Avatar name={p.name} size="sm" /><span className="font-medium text-gray-900 truncate">{p.name}</span></span></td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-700">{p.ext_open || <span className="text-gray-300">0</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.peer_pending ? <Chip tone="amber">{p.peer_pending}</Chip> : <span className="text-gray-300">0</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-indigo-600 font-semibold">{p.peer_submitted || <span className="text-gray-300 font-normal">0</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.returned ? <Chip tone="red">{p.returned}</Chip> : <span className="text-gray-300">0</span>}</td>
                    <td className="px-3 py-3 text-right pr-5 tabular-nums font-semibold text-emerald-600">{p.ext_delivered || <span className="text-gray-300 font-normal">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel flush title="Source tracker" subtitle={stage ? `${STAGE[stage].label}: ${rows.length} sources` : `${rows.length} sources, longest waiting first`}
        actions={<div className="flex items-center gap-2">
          <label className="relative"><Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => { setQ(e.target.value); setLimit(30) }} placeholder="Search" aria-label="Search sources"
              className="text-sm border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-brand-200" /></label>
          {stuck.length > 0 && <Button variant="secondary" size="sm" loading={nudging} onClick={() => { if (window.confirm(`Send a reminder for ${stuck.length} ${stuck.length === 1 ? 'source' : 'sources'} that have waited 7+ days? People are only reminded once a day.`)) remind(stuck.map(r => r.source_id)) }}><Bell className="w-4 h-4" /> Remind {stuck.length} stuck</Button>}
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> CSV</Button>
        </div>}>
        {rows.length === 0 ? <Blank title="No sources match" text="Clear the stage filter or the search." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[860px]">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                <th className="font-medium px-5 py-2.5">Source</th><th className="font-medium px-3 py-2.5">Stage</th><th className="font-medium px-3 py-2.5">Extractor</th>
                <th className="font-medium px-3 py-2.5 text-right">Peers</th><th className="font-medium px-3 py-2.5 text-right">Records</th><th className="font-medium px-3 py-2.5 text-right">Approved</th>
                <th className="font-medium px-3 py-2.5 text-right">Sent back</th><th className="font-medium px-3 py-2.5 text-right pr-5">Waiting</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, limit).map(r => {
                  const st = STAGE[r.stage]
                  const late = r.stage !== 'delivered' && (r.days_in_stage ?? 0) >= 7
                  return (
                    <tr key={r.source_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                      <td className="px-5 py-3 max-w-[280px]"><Link to={`/projects/${r.project_id}/sources/${r.source_id}`} className="font-medium text-gray-900 hover:text-brand-600 truncate block">{r.name}</Link>
                        <span className="block text-xs text-gray-400 truncate">{r.project}{r.item_no ? ` · #${r.item_no}` : ''}</span></td>
                      <td className="px-3 py-3"><Chip tone={st.tone}>{st.label}</Chip></td>
                      <td className="px-3 py-3 text-gray-600">{r.extractor ?? <span className="text-gray-300">Nobody yet</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-600">{r.peers_total ? <>{r.peers_done}<span className="text-gray-300"> / {r.peers_total}</span></> : <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-600">{r.records ? <>{r.valid}<span className="text-gray-300"> / {r.records}</span></> : <span className="text-gray-300">0</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-emerald-600 font-semibold">{r.approved || <span className="text-gray-300 font-normal">0</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.sent_back ? <Chip tone="amber">{r.sent_back}</Chip> : <span className="text-gray-300">0</span>}</td>
                      <td className="px-3 py-3 text-right pr-5 tabular-nums whitespace-nowrap">{r.stage === 'delivered' ? <span className="text-gray-300">-</span> : <>
                        {(r.days_in_stage ?? 0) >= 3 && (r.stage !== 'not_started' || r.extractor) && (reminded.has(r.source_id)
                          ? <span className="text-xs text-emerald-600 mr-2">Reminded</span>
                          : <button type="button" onClick={() => remind([r.source_id])} disabled={nudging} title="Remind whoever has this source" className="text-xs font-semibold text-brand-600 hover:underline mr-2 disabled:opacity-50">Remind</button>)}
                        <span className={cn(late ? 'text-red-600 font-semibold' : 'text-gray-500')}>{r.days_in_stage === null ? '-' : r.days_in_stage < 1 ? 'today' : `${r.days_in_stage} d`}</span></>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > limit && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
                <span className="text-xs text-gray-500">Showing {limit} of {rows.length}</span>
                <button type="button" onClick={() => setLimit(n => n + 30)} className="text-sm font-semibold text-brand-600 hover:underline">Show 30 more</button>
              </div>
            )}
          </div>
        )}
      </Panel>
      <p className="text-xs text-gray-400 m-0">"Waiting" counts the days since the source last changed. "Sent back" counts records a reviewer returned at least once. Refreshes every 2 minutes.</p>
    </div>
  )
}
