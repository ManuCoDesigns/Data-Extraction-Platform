import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Trophy } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Avatar, Button, cn, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, Tile, type Tone, PAGE, shortAgo } from '@/components/enh/kit'
import { useAuthStore } from '@/store/auth'

interface P {
  user_id: string; name: string; email?: string; ext_assigned: number; ext_open: number; ext_delivered: number
  records: number; returned: number; sent_back_recent?: number; sent_back_prev?: number; trend?: 'better' | 'worse' | 'same'; first_pass_rate: number | null; avg_extract_hours: number | null
  peer_assigned: number; peer_submitted: number; peer_pending: number; avg_peer_hours: number | null
}
const hrs = (h: number | null) => (h === null ? '-' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`)
const rateTone = (r: number | null): Tone => (r === null ? 'gray' : r >= 90 ? 'green' : r >= 75 ? 'amber' : 'red')

function Bar({ value, tone }: { value: number; tone: Tone }) {
  const color = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-gray-300', blue: 'bg-blue-500', indigo: 'bg-indigo-500', purple: 'bg-purple-500' }[tone]
  return <span className="block w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className={cn('block h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
}

export function InsightsPage() {
  const { user } = useAuthStore()
  const isLead = ['org_admin', 'project_admin', 'qa_lead'].some(r => user?.roles?.includes(r))
  const [days, setDays] = useState('30')
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [rows, setRows] = useState<P[]>([])
  const [me, setMe] = useState<P | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'extract' | 'peer'>('extract')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const mine = await enhApi.myStats(Number(days)); setMe(mine.me)
      if (isLead) setRows((await enhApi.peopleStats(Number(days), project || undefined)).people)
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't load the numbers") } finally { setLoading(false) }
  }, [days, project, isLead])
  useEffect(() => { if (isLead) projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [isLead])
  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => [...rows].sort((a, b) => view === 'extract'
    ? b.ext_delivered - a.ext_delivered || b.ext_assigned - a.ext_assigned
    : b.peer_submitted - a.peer_submitted || b.peer_assigned - a.peer_assigned).filter(r => view === 'extract' ? r.ext_assigned > 0 : r.peer_assigned > 0), [rows, view])

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Name', 'Sources assigned', 'Delivered', 'Open', 'Records', 'Sent back', 'First pass rate %', 'Avg extraction hours', 'Peer reviews assigned', 'Peer reviews done', 'Peer reviews waiting', 'Avg peer response hours']
    const body = rows.map(r => [r.name, r.ext_assigned, r.ext_delivered, r.ext_open, r.records, r.returned, r.first_pass_rate ?? '', r.avg_extract_hours ?? '', r.peer_assigned, r.peer_submitted, r.peer_pending, r.avg_peer_hours ?? ''])
    const blob = new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `team_insights_${days}d.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className={PAGE}>
      <PageHeader title="Insights"
        subtitle={isLead ? 'How work is moving: deliveries, how often records pass the first review, and how fast peers respond.' : 'Your own numbers: what you delivered, how often it passed review first time, and how quickly you responded.'}
        actions={<>
          {isLead && projects.length > 1 && (
            <SelectBox label="Project" value={project} onChange={setProject}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          )}
          <SelectBox label="Period" value={days} onChange={setDays}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
          </SelectBox>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          {isLead && <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> Download CSV</Button>}
        </>} />

      {loading ? <Skeletons rows={5} /> : (
        <>
          {(me || !isLead) && <section aria-label="Your numbers">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Your numbers</h2>
            {!me ? <Panel><Blank title="Nothing to show yet" text="Numbers appear once you have been assigned a source or a peer review." /></Panel> : (
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                <Tile label="Delivered" value={me.ext_delivered} tone="green" hint={`${me.ext_open} still open`} />
                <Tile label="First pass" value={me.first_pass_rate === null ? '-' : `${me.first_pass_rate}%`} tone={rateTone(me.first_pass_rate)} hint={`${me.returned} of ${me.records} records sent back`} />
                <Tile label="Extraction time" value={hrs(me.avg_extract_hours)} tone="blue" hint="Average per source" />
                <Tile label="Peer reviews" value={me.peer_submitted} tone="indigo" hint={`${me.peer_pending} waiting on you`} />
                <Tile label="Response time" value={hrs(me.avg_peer_hours)} tone="purple" hint="From request to comment" />
                <Tile label="Assigned" value={me.ext_assigned + me.peer_assigned} tone="gray" hint="Sources and reviews" />
              </div>
            )}
          </section>}

          {isLead && (
            <Panel flush title="The team" subtitle="Use this to balance work and to see who needs help. It is not a ranking of people."
              actions={
                <div className="inline-flex p-0.5 rounded-lg bg-gray-100 text-xs font-semibold">
                  {(['extract', 'peer'] as const).map(v => (
                    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                      className={cn('px-3 py-1.5 rounded-md transition', view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
                      {v === 'extract' ? 'Extraction' : 'Peer review'}
                    </button>
                  ))}
                </div>}>
              {sorted.length === 0 ? <Blank icon={<Trophy className="w-5 h-5" />} title="No activity in this period" text="Try a longer period." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                        <th className="font-medium px-5 py-2.5">Person</th>
                        {view === 'extract' ? (<>
                          <th className="font-medium px-3 py-2.5 text-right">Delivered</th><th className="font-medium px-3 py-2.5 text-right">Open</th>
                          <th className="font-medium px-3 py-2.5 w-64">First pass</th><th className="font-medium px-3 py-2.5 text-right pr-5">Avg time</th>
                        </>) : (<>
                          <th className="font-medium px-3 py-2.5 text-right">Done</th><th className="font-medium px-3 py-2.5 text-right">Waiting</th>
                          <th className="font-medium px-3 py-2.5 w-44">Completed</th><th className="font-medium px-3 py-2.5 text-right pr-5">Avg response</th>
                        </>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(r => {
                        const done = view === 'extract' ? r.first_pass_rate : r.peer_assigned ? Math.round((r.peer_submitted / r.peer_assigned) * 100) : null
                        return (
                          <tr key={r.user_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                            <td className="px-5 py-3"><span className="flex items-center gap-2.5"><Avatar name={r.name} size="sm" /><span className="font-medium text-gray-900 truncate">{r.name}</span></span></td>
                            {view === 'extract' ? (<>
                              <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-600">{r.ext_delivered}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-600">{r.ext_open}</td>
                              <td className="px-3 py-3"><span className="flex items-center gap-2"><Bar value={r.first_pass_rate ?? 0} tone={rateTone(r.first_pass_rate)} /><span className="text-xs tabular-nums text-gray-500 w-11 text-right">{r.first_pass_rate === null ? '-' : `${r.first_pass_rate}%`}</span>
                                {r.trend && r.trend !== 'same' && (
                                  <Chip tone={r.trend === 'better' ? 'green' : 'red'} title={`Records sent back: ${r.sent_back_recent} in the last 14 days, ${r.sent_back_prev} in the 14 days before`}>
                                    {r.trend === 'better' ? 'Improving' : 'More sent back'}
                                  </Chip>
                                )}</span></td>
                              <td className="px-3 py-3 text-right pr-5 tabular-nums text-gray-600">{hrs(r.avg_extract_hours)}</td>
                            </>) : (<>
                              <td className="px-3 py-3 text-right tabular-nums font-semibold text-indigo-600">{r.peer_submitted}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{r.peer_pending > 0 ? <Chip tone="amber">{r.peer_pending}</Chip> : <span className="text-gray-300">0</span>}</td>
                              <td className="px-3 py-3"><span className="flex items-center gap-2"><Bar value={done ?? 0} tone="indigo" /><span className="text-xs tabular-nums text-gray-500 w-11 text-right">{done === null ? '-' : `${done}%`}</span></span></td>
                              <td className="px-3 py-3 text-right pr-5 tabular-nums text-gray-600">{hrs(r.avg_peer_hours)}</td>
                            </>)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
          <p className="text-xs text-gray-400 m-0">First pass counts a record as passed when it was never sent back for correction. Times are measured from the moment a source was started or a review was requested.</p>
        </>
      )}
    </div>
  )
}
