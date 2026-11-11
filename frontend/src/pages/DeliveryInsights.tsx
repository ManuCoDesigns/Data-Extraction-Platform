import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Printer, RefreshCw, Wrench } from 'lucide-react'
import { briefsApi } from '@/api/briefs'
import { projectsApi } from '@/api/client'
import { Button, toast } from '@/components/ui'
import { TracePanel } from '@/components/enh/TracePanel'

// Delivery insights: how long each batch took, where the time went, what we waited on Xtrium for, and what still needs checking, in plain words.
const TONE: Record<string, string> = { good: 'border-emerald-200 bg-emerald-50', info: 'border-sky-200 bg-sky-50', warn: 'border-amber-200 bg-amber-50' }
const shortLabel = (l: string) => l.replace(/^Batch (\d+) \((\d{4})-(\d{2})-(\d{2})\)$/, (_m, n, _y, mo, d) => `Batch ${n} · ${d}/${mo}`)
const fmtDate = (s?: string | null) => (s ? s.slice(0, 10) : '')

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 min-w-[150px] flex-1">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      {note && <div className="text-xs text-gray-500 mt-1">{note}</div>}
    </div>
  )
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export function DeliveryInsightsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [periods, setPeriods] = useState<any>(null)
  const [scope, setScope] = useState('all')
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [tools, setTools] = useState(false)
  const [sc, scv] = scope.includes(':') ? [scope.split(':')[0], scope.split(':').slice(1).join(':')] : [scope, undefined]
  const pid = project || undefined

  useEffect(() => { projectsApi.list(1, 100).then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { briefsApi.periods(pid).then(setPeriods).catch(() => setPeriods(null)) }, [pid])
  const load = () => {
    setLoading(true); setErr('')
    return briefsApi.insights(sc, scv, pid).then(setD).catch(e => { setD(null); setErr(e?.response?.data?.detail || 'Could not read the delivery data.') }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [scope, project])

  const turn = useMemo(() => (d?.batches || []).filter((b: any) => b.delivered > 0).map((b: any) => ({
    name: shortLabel(b.label), 'Before extraction started': b.avg_queue_days ?? 0, 'Extraction': b.avg_extraction_days ?? 0, 'Review': b.avg_review_days ?? 0, delivered: b.delivered,
  })), [d])
  const waits = useMemo(() => (d?.waits || []).map((w: any) => ({ ...w, short: w.label.length > 34 ? w.label.slice(0, 33) + '…' : w.label })), [d])
  const exportTrace = async () => { try { download(await briefsApi.traceXlsx(sc, scv, pid), `delivery_trace_${scv || 'all'}.xlsx`) } catch { toast.error('Could not build the Excel file') } }
  const exportTimelines = async () => { try { download(await briefsApi.timelinesXlsx(sc, scv, pid, false), `source_timelines_${scv || 'all'}.xlsx`) } catch { toast.error('Could not build the timelines file') } }
  const K = d?.kpis

  return (
    <div className="grid gap-5 p-1" style={{ maxWidth: 1180 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Delivery insights</h1>
          <p className="text-sm text-gray-600 m-0 mt-1">How long batches take, where the time goes, and what we waited on Xtrium for. Days are elapsed clock time.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap no-print">
          <select className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" value={project} onChange={e => setProject(e.target.value)}>
            <option value="">All my projects</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="all">Whole engagement</option><option value="latest">Latest batch</option>
            {periods?.months?.length > 0 && <optgroup label="A month">{periods.months.map((m: any) => <option key={m.value} value={`month:${m.value}`}>{m.label}</option>)}</optgroup>}
            {periods?.batches?.length > 0 && <optgroup label="A batch">{periods.batches.map((b: any) => <option key={b.key} value={`batch:${b.key}`}>{b.label}</option>)}</optgroup>}
          </select>
          <Button variant="secondary" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</Button>
          <Button variant="secondary" onClick={exportTrace}><Download size={14} /> Trace Excel</Button>
          <Button variant="secondary" onClick={exportTimelines}><Download size={14} /> Timelines Excel</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer size={14} /> Print</Button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{err}</div>}
      {!d && !err && <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Reading the delivery data.</div>}

      {d && (<>
        <div className="flex gap-3 flex-wrap">
          <Tile label="Sources delivered" value={K.delivered} note={`${K.batches} pulled batch${K.batches === 1 ? '' : 'es'}`} />
          <Tile label="Latest batch" value={K.latest_working_days !== null ? `${K.latest_working_days} working days` : 'None yet'} note={`Window is ${d.window_working_days} working days`} />
          <Tile label="Escalations" value={K.escalations} note={`${K.open} still open`} />
          <Tile label="Median wait for an answer" value={K.median_wait_days !== null ? `${K.median_wait_days} days` : 'None yet'} />
        </div>

        <section className="grid gap-2">
          <h2 className="text-base font-bold m-0">What the data says</h2>
          {d.findings.length === 0 && <p className="text-sm text-gray-600 m-0">Nothing to report for this period yet.</p>}
          {d.findings.map((f: any, i: number) => (
            <div key={i} className={`rounded-xl border p-3 ${TONE[f.tone] || TONE.info}`}>
              <div className="font-semibold text-sm text-gray-900">{f.title}</div>
              <div className="text-sm text-gray-700 mt-0.5">{f.text}</div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 grid gap-1.5 text-sm text-gray-700">
          <h2 className="text-base font-bold m-0 text-gray-900">How to read this</h2>
          <p className="m-0">Days are elapsed clock time, so they include nights, weekends and any waiting. Working days leave out weekends. The 5-working-day window runs from the day a batch is pulled to submission to Xtrium.</p>
          <p className="m-0">Extraction happens on the source websites, outside the platform, so extraction days run from when the batch was assigned to when the data was uploaded. They are not hands-on time.</p>
          <p className="m-0">A wait on Xtrium is only counted against a source when the question is tied to that source. Test batches and batches covered earlier are left out once they are marked.</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 grid gap-2">
          <h2 className="text-base font-bold m-0">Where the days went, by batch</h2>
          <p className="text-xs text-gray-600 m-0">Average days per delivered source. Extraction includes any time a source waited on an answer.</p>
          {turn.length === 0 ? <p className="text-sm text-gray-600 m-0">No delivered sources in this period yet.</p> : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={turn} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} unit=" d" />
                  <Tooltip formatter={(v: any) => `${v} days`} /><Legend />
                  <ReferenceLine y={7} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: '5 working days ≈ 7 days', fontSize: 11, fill: '#6b7280', position: 'insideTopRight' }} />
                  <Bar dataKey="Before extraction started" stackId="a" fill="#94a3b8" /><Bar dataKey="Extraction" stackId="a" fill="#3b82f6" /><Bar dataKey="Review" stackId="a" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 grid gap-2 overflow-x-auto">
          <h2 className="text-base font-bold m-0">Batches and the 5-working-day window</h2>
          <table className="text-sm w-full" style={{ minWidth: 760 }}>
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3">Batch</th><th className="pr-3">Pulled</th><th className="pr-3">Status</th><th className="pr-3">Sources</th><th className="pr-3">Delivered</th><th className="pr-3">On time</th><th className="pr-3">Late</th><th className="pr-3">Avg days to approval</th><th>Returned records</th></tr></thead>
            <tbody>{d.batches.map((b: any) => (
              <tr key={b.key} className="border-t border-gray-100 align-top">
                <td className="py-1.5 pr-3 font-medium">{shortLabel(b.label)}{b.flag ? <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{b.flag === 'test' ? 'test sources' : 'covered earlier'}</span> : null}</td>
                <td className="pr-3">{fmtDate(b.pulled)}</td><td className="pr-3">{b.status}</td><td className="pr-3">{b.sources}</td><td className="pr-3">{b.delivered}</td>
                <td className="pr-3">{b.on_time}</td><td className="pr-3">{b.late}</td><td className="pr-3">{b.avg_total_days ?? '–'}</td><td>{b.returned_records || '–'}</td>
              </tr>))}</tbody>
          </table>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 grid gap-2">
          <h2 className="text-base font-bold m-0">What we waited on Xtrium for</h2>
          <p className="text-xs text-gray-600 m-0">Days from asking to the first real answer. Open items are still counting.</p>
          {waits.length === 0 ? <p className="text-sm text-gray-600 m-0">No escalations logged yet. Open the tools below and load the Slack escalations.</p> : (
            <div style={{ width: '100%', height: Math.max(220, waits.length * 26 + 40) }}>
              <ResponsiveContainer>
                <BarChart data={waits} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={{ fontSize: 12 }} unit=" d" />
                  <YAxis type="category" dataKey="short" width={250} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `${v} days`} labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.label || ''} />
                  <Bar dataKey="days" radius={[0, 4, 4, 0]}>{waits.map((w: any, i: number) => <Cell key={i} fill={w.open ? '#ef4444' : '#3b82f6'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {d.by_topic.length > 0 && (
            <div className="grid gap-1 text-sm mt-1">
              <b>By topic</b>
              {d.by_topic.map((t: any) => <div key={t.topic} className="flex justify-between border-t border-gray-100 py-1"><span>{t.topic}</span><span className="text-gray-600">{t.count} asked, {t.avg_days} days on average, longest {t.longest_days}</span></div>)}
            </div>
          )}
        </section>

        {d.active?.by_size?.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 grid gap-1 text-sm">
            <h2 className="text-base font-bold m-0">Days of real work, by source size</h2>
            {d.active.by_size.map((z: any) => <div key={z.size} className="flex justify-between border-t border-gray-100 py-1"><span>{z.size} ({z.records} records), {z.sources} sources</span><span className="text-gray-600">{z.avg_active_days} active days on average, {z.avg_idle_working_days} idle working days</span></div>)}
          </section>
        )}

        <section className="grid gap-2">
          <h2 className="text-base font-bold m-0">Check before you quote these numbers</h2>
          {d.warnings.map((w: any, i: number) => (
            <div key={i} className={`rounded-xl border p-3 ${TONE.warn}`}><div className="font-semibold text-sm text-gray-900">{w.title}</div><div className="text-sm text-gray-700 mt-0.5">{w.text}</div></div>
          ))}
        </section>
      </>)}

      <section className="no-print grid gap-2">
        <div><Button variant="secondary" onClick={() => setTools(v => !v)}><Wrench size={14} /> {tools ? 'Hide' : 'Open'} the tools: log escalations, load Slack, mark test batches</Button></div>
        {tools && <TracePanel scope={sc} value={scv} projectId={pid} onClose={() => setTools(false)} onChanged={load} />}
      </section>
    </div>
  )
}
