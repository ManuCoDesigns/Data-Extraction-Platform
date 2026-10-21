import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { qualityApi } from '@/api/client'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tabs, Tile, shortAgo, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { ProcessReport } from '@/components/enh/ProcessReport'
import { ReviewWorkspace } from '@/components/enh/ReviewWorkspace'
import { SopRequirementsOverview, SopRulesBody } from '@/components/enh/SopRules'

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`)
const scoreTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d

type Tab = 'review' | 'scores' | 'sop' | 'findings' | 'audit'

export function QualityPage() {
  const [sources, setSources] = useState<any[] | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [days, setDays] = useState('90')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState<Tab>('review')
  const [projectId, setProjectId] = useState('')
  const [bench, setBench] = useState(!!new URLSearchParams(window.location.search).get('source'))
  const [params] = useSearchParams()

  useEffect(() => { qualityApi.sources().then(r => setSources(r.items)).catch(() => setSources([])) }, [tab])
  const src = (sources ?? []).find(s => s.source_id === sourceId)
  const projects = [...new Map((sources ?? []).map(s => [s.project_id, s.project])).entries()].map(([id, name]) => ({ id, name: name as string }))

  return (
    <div className={tab === 'review' && bench ? 'p-3 lg:p-5 max-w-[1760px] mx-auto space-y-3 animate-fade-in' : PAGE}>
      <PageHeader title="Quality" subtitle={tab === 'review' && bench ? undefined : "How accurate the delivered data is, how many errors reviewers caught, and how many got through. Scores come from errors that were checked and from fields an admin verified against the real source."} />
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onChange={t => { setTab(t) }} items={[{ key: 'review', label: 'Review' }, { key: 'scores', label: 'Scores' }, { key: 'sop', label: 'SOP check' }, { key: 'findings', label: 'Errors logged', count: (sources ?? []).reduce((n, s) => n + s.open_findings, 0) }, { key: 'audit', label: 'Check against source' }]} />
        {tab !== 'review' && <SelectBox label="Project" value={projectId} onChange={v => { setProjectId(v); setSourceId('') }}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectBox>}
        {tab !== 'review' && <SelectBox label="Source" value={sourceId} onChange={setSourceId}>
          <option value="">All sources</option>
          {(sources ?? []).filter(s => !projectId || s.project_id === projectId).map(s => <option key={s.source_id} value={s.source_id}>{s.name}{s.open_findings ? ` (${s.open_findings} open)` : ''}</option>)}
        </SelectBox>}
        {tab === 'scores' && <Period days={days} setDays={setDays} from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      </div>
      {tab === 'review' && <ReviewWorkspace onBench={setBench} initialSource={params.get('source') || ''} initialProject={params.get('project') || ''} />}
      {tab === 'scores' && <Scores sourceId={sourceId} projectId={projectId} period={{ days: Number(days), from, to }} />}
      {tab === 'sop' && <SopCheck sourceId={sourceId} projectId={projectId} onPick={id => setSourceId(id)} />}
      {tab === 'findings' && <Findings sourceId={sourceId} source={src} />}
      {tab === 'audit' && <Audit sourceId={sourceId} />}
    </div>
  )
}

type PeriodValue = { days: number; from: string; to: string }
const dayStr = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10)  // Nairobi calendar day
const nice = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

function Period({ days, setDays, from, to, setFrom, setTo }: { days: string; setDays: (v: string) => void; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const ranged = !!(from || to)
  const pick = (a: string, b: string) => { setFrom(a); setTo(b) }
  const today = dayStr(new Date()), yest = dayStr(new Date(Date.now() - 86400_000))
  const chip = 'text-xs font-semibold rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50'
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <SelectBox label="Period" value={ranged ? 'custom' : days} onChange={v => { if (v !== 'custom') { pick('', ''); setDays(v) } }}>
        <option value="0">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>{ranged && <option value="custom">Custom dates</option>}
      </SelectBox>
      <label className="text-xs text-gray-500 flex items-center gap-1">From<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="text-sm rounded-xl border border-gray-200 px-2 py-1.5" aria-label="From date" /></label>
      <label className="text-xs text-gray-500 flex items-center gap-1">To<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="text-sm rounded-xl border border-gray-200 px-2 py-1.5" aria-label="To date" /></label>
      <button type="button" className={chip} onClick={() => pick(today, today)}>Today</button>
      <button type="button" className={chip} onClick={() => pick(yest, yest)}>Yesterday</button>
      <button type="button" className={chip} onClick={() => pick(dayStr(new Date(Date.now() - 6 * 86400_000)), today)}>Last 7 days</button>
      {ranged && <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => pick('', '')}>Clear dates</button>}
    </div>
  )
}

function Scores({ sourceId, projectId, period }: { sourceId: string; projectId: string; period: PeriodValue }) {
  const [d, setD] = useState<any>(null)
  const { days, from, to } = period
  const ranged = !!(from || to)
  useEffect(() => { setD(null); qualityApi.summary({ source_id: sourceId || undefined, project_id: projectId || undefined, days: ranged ? undefined : days, date_from: from || undefined, date_to: to || undefined }).then(setD).catch(() => setD({ error: true })) }, [sourceId, projectId, days, from, to])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Skeletons rows={4} />
  if (d.error) return <Blank title="Couldn't load scores" text="Check your connection and try again." />
  const s = d.scores, c = d.counts
  return (
    <div className="space-y-5">
      {d.confidence === 'low' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">
          Only {c.audited} field{c.audited === 1 ? '' : 's'} checked against the real source so far. Scores can swing a lot with a small sample. Check at least 30 fields for a dependable number.
        </div>
      )}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Process score" value={pc(s.process)} tone={scoreTone(s.process)} hint="Accuracy, review catch rate and reviewer precision combined" />
        <Tile label="Final accuracy" value={pc(s.final_accuracy)} tone={scoreTone(s.final_accuracy)} hint={`${pc(s.first_pass_accuracy)} were right the first time. ${c.audited} fields checked`} />
        <Tile label="Review catch rate" value={pc(s.review_catch_rate)} tone={scoreTone(s.review_catch_rate)} hint={`${c.caught} of ${c.errors} known errors were caught by peers`} />
        <Tile label="Reviewer precision" value={pc(s.reviewer_precision)} tone={scoreTone(s.reviewer_precision)} hint={`${c.reviewer_confirmed} confirmed, ${c.reviewer_dismissed} dismissed`} />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Errors per 100 fields" value={c.errors_per_100_fields ?? '–'} hint={`${c.fields} fields in total`} />
        <Tile label="Waiting for an admin" value={c.open} tone={c.open ? 'amber' : 'gray'} hint="Logged errors not settled yet" />
        <Tile label="Found by system checks" value={c.system_findings} tone="blue" hint={`System precision ${pc(d.system_precision)}`} />
        <Tile label="Critical errors" value={d.by_severity.critical} tone={d.by_severity.critical ? 'red' : 'gray'} hint={`${d.by_severity.major} major, ${d.by_severity.minor} minor`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Kinds of error" subtitle="Confirmed errors only">
          {d.by_category.length === 0 ? <Blank title="No confirmed errors" text="Errors show here once an admin confirms them." /> : (
            <ul className="m-0 p-0 list-none space-y-2">
              {d.by_category.map((x: any) => {
                const max = d.by_category[0].count
                return (
                  <li key={x.category} className="text-sm">
                    <div className="flex justify-between"><span className="text-gray-800">{x.label}</span><span className="font-semibold tabular-nums text-gray-900">{x.count}</span></div>
                    <div className="h-1.5 rounded-full bg-gray-100 mt-1"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(100 * x.count) / max}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
      <ProcessReport sourceId={sourceId} projectId={projectId} from={period.from} to={period.to} />
      <ExtractorReport sourceId={sourceId} projectId={projectId} period={period} />
      <Panel title="Reviewers" subtitle="What each peer reviewer caught, out of every known error on the sources they were assigned to">
        {d.reviewers.length === 0 ? <Blank title="No reviewers yet" text="Peer reviewers show here once they are assigned to a source or flag an error." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-semibold">Name</th><th className="pr-3 font-semibold">Sources</th><th className="pr-3 font-semibold">Known errors</th><th className="pr-3 font-semibold">Caught</th><th className="pr-3 font-semibold">Catch rate</th><th className="pr-3 font-semibold">False alarms</th><th className="pr-3 font-semibold">Precision</th><th className="font-semibold">Open</th></tr></thead>
            <tbody>{d.reviewers.map((r: any) => (
              <tr key={r.user_id} className="border-t border-gray-50"><td className="py-1.5 pr-3 text-gray-900">{r.name}</td><td className="pr-3 tabular-nums">{r.sources}</td><td className="pr-3 tabular-nums">{r.known_errors}</td><td className="pr-3 tabular-nums">{r.caught}</td>
                <td className="pr-3"><Chip tone={scoreTone(r.catch_rate)}>{pc(r.catch_rate)}</Chip>{r.confidence === 'low' && <span className="ml-1 text-[11px] text-gray-400">early</span>}</td>
                <td className="pr-3 tabular-nums">{r.false_alarms}</td><td className="pr-3"><Chip tone={scoreTone(r.precision)}>{pc(r.precision)}</Chip></td><td className="tabular-nums">{r.open}</td></tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </div>
  )
}

function ExtractorReport({ sourceId, projectId, period }: { sourceId: string; projectId: string; period: PeriodValue }) {
  const [d, setD] = useState<any>(null)
  const { days, from, to } = period
  const [open, setOpen] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const ranged = !!(from || to)
  const filt = { source_id: sourceId || undefined, project_id: projectId || undefined, days: ranged ? undefined : Number(days) || undefined, date_from: from || undefined, date_to: to || undefined }
  useEffect(() => { setD(null); qualityApi.extractorReport(filt).then(setD).catch(() => setD({ error: true })) }, [sourceId, projectId, days, from, to])  // eslint-disable-line react-hooks/exhaustive-deps
  const download = async () => { setBusy(true); try { await qualityApi.exportExtractorReport(filt) } catch (e) { toast.error(err(e, 'Nothing to download yet')) } finally { setBusy(false) } }
  const th = 'font-semibold py-1 pr-3 whitespace-nowrap'
  return (
    <Panel title="Extractor report" subtitle={`Every error ever found stays counted, even after the extractor fixes it. First pass is how they did before any rework. ${ranged ? `Showing checks first made ${from ? nice(from) : 'from the start'}${to && to !== from ? ' to ' + nice(to) : from && !to ? ' onwards' : ''}.` : days ? `Showing the last ${days} days.` : 'Showing all time.'}`}
      actions={<div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" disabled={busy || !d?.extractors?.length} onClick={download}>{busy ? 'Preparing…' : 'Download Excel'}</Button>
      </div>}>
      {!d ? <Skeletons rows={3} /> : d.error ? <Blank title="Couldn't load the report" /> : d.extractors.length === 0 ? <Blank title="No extractor data yet" text="Extractors appear here once they have a source with records." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead><tr className="text-left text-xs text-gray-500"><th className={th}>Extractor</th><th className={th}>Fields</th><th className={th}>Errors</th><th className={th}>Per 100</th><th className={th}>Checked</th><th className={th}>First pass</th><th className={th}>Final</th><th className={th}>Caught by reviewers</th><th className={th}>Fixed</th><th className={th}>Still wrong</th><th className={th}>Sent back</th></tr></thead>
            <tbody>
              {d.extractors.map((e: any) => (
                <Fragment key={e.user_id}>
                  <tr className="border-t border-gray-50 cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === e.user_id ? '' : e.user_id)}>
                    <td className="py-1.5 pr-3 text-gray-900 font-medium">{open === e.user_id ? '▾' : '▸'} {e.name}{e.confidence === 'low' && <span className="ml-1.5 text-[11px] text-amber-700" title="Fewer than 30 fields checked">low confidence</span>}</td>
                    <td className="tabular-nums pr-3">{e.fields}</td><td className="tabular-nums pr-3">{e.errors}</td><td className="tabular-nums pr-3">{e.errors_per_100 ?? '–'}</td><td className="tabular-nums pr-3">{e.audited}</td>
                    <td className="pr-3"><Chip tone={scoreTone(e.first_pass_accuracy)}>{pc(e.first_pass_accuracy)}</Chip></td><td className="pr-3"><Chip tone={scoreTone(e.final_accuracy)}>{pc(e.final_accuracy)}</Chip></td>
                    <td className="tabular-nums pr-3">{e.caught}</td><td className="tabular-nums pr-3">{e.fixed}</td><td className="tabular-nums pr-3">{e.still_wrong ? <span className="text-red-600 font-semibold">{e.still_wrong}</span> : 0}</td>
                    <td className="tabular-nums pr-3">{e.returned_records}<span className="text-gray-400"> of {e.records}</span></td>
                  </tr>
                  {open === e.user_id && e.sources.map((x: any) => (
                    <tr key={e.user_id + x.source_id} className="bg-gray-50 text-gray-700">
                      <td className="py-1 pl-6 pr-3 truncate max-w-[220px]">{x.source}</td><td className="tabular-nums pr-3">{x.fields}</td><td className="tabular-nums pr-3">{x.errors}</td><td className="tabular-nums pr-3">{x.errors_per_100 ?? '–'}</td><td className="tabular-nums pr-3">{x.audited}</td>
                      <td className="pr-3">{pc(x.first_pass_accuracy)}</td><td className="pr-3">{pc(x.final_accuracy)}{x.waiting_recheck > 0 && <span className="text-[11px] text-blue-700"> ({x.waiting_recheck} to re-check)</span>}</td>
                      <td className="tabular-nums pr-3">{x.caught}</td><td className="tabular-nums pr-3">{x.fixed}</td><td className="tabular-nums pr-3">{x.still_wrong}</td><td className="tabular-nums pr-3">{x.returned_records}<span className="text-gray-400"> of {x.records}</span></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {ranged && <p className="text-xs text-gray-500 mt-3 mb-0">Dates are in Nairobi time. A check counts on the day it was first made. Fields and Sent back still show each source in full, so use Checked, Errors and First pass to judge this period.</p>}
          <p className="text-xs text-gray-500 mt-3 mb-0">Click a name to see their sources. First pass counts fields as wrong if they were wrong when first checked, even if fixed later. Final counts what is right now. Fields the extractor changed after a check are left out of Final until you check them again.</p>
        </div>
      )}
    </Panel>
  )
}

function Findings({ sourceId, source }: { sourceId: string; source: any }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [status, setStatus] = useState('open')
  const [busy, setBusy] = useState(false)
  const [truth, setTruth] = useState<Record<string, string>>({})
  const load = () => { if (!sourceId) return setRows([]); qualityApi.sourceFindings(sourceId, status === 'all' ? undefined : status).then(r => setRows(r.items)).catch(() => setRows([])) }
  useEffect(() => { setRows(null); load() }, [sourceId, status])

  if (!sourceId) return <Blank title="Pick a source" text="Choose a source above to see the errors logged on it." />
  const scan = async () => {
    setBusy(true)
    try { const r = await qualityApi.scan(sourceId); toast.success(r.created ? `System checks found ${r.created} new issue${r.created === 1 ? '' : 's'}` : 'System checks found nothing new'); load() }
    catch (e) { toast.error(err(e, "Couldn't run the checks")) } finally { setBusy(false) }
  }
  const resolve = async (f: any, st: 'confirmed' | 'dismissed') => {
    try { await qualityApi.resolve(f.id, { status: st, truth_value: truth[f.id]?.trim() || undefined }); toast.success(st === 'confirmed' ? 'Marked as a real error' : 'Dismissed'); load() }
    catch (e) { toast.error(err(e, "Couldn't save that")) }
  }
  return (
    <Panel title={source?.name ?? 'Errors'} subtitle="Confirm an error only after checking the real source. Confirmed errors count against the score."
      actions={<div className="flex items-center gap-2">
        <SelectBox label="Status" value={status} onChange={setStatus}><option value="open">Waiting</option><option value="confirmed">Confirmed</option><option value="dismissed">Dismissed</option><option value="all">All</option></SelectBox>
        <Button onClick={scan} disabled={busy}>{busy ? 'Checking…' : 'Run system checks'}</Button>
      </div>}>
      {!rows ? <Skeletons rows={3} /> : rows.length === 0 ? <Blank title="Nothing here" text={status === 'open' ? 'No errors waiting. Run the system checks to look for structure and format problems.' : 'No errors with this status.'} /> : (
        <ul className="m-0 p-0 list-none space-y-3">
          {rows.map(f => (
            <li key={f.id} className="rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="font-semibold text-gray-900 text-sm">{f.record}</span><span className="text-gray-400">·</span><span className="text-sm text-gray-700">{f.field ?? 'Whole record'}</span>
                <Chip tone={f.severity === 'critical' ? 'red' : f.severity === 'major' ? 'amber' : 'gray'}>{f.severity}</Chip>
                <Chip tone="indigo">{f.category_label}</Chip>
                {f.origin === 'system' && <Chip tone="blue">System check</Chip>}
                {f.auto_verdict && <Chip tone={f.auto_verdict === 'not_reproduced' ? 'amber' : f.auto_verdict === 'needs_human' ? 'gray' : 'green'} title={f.auto_note ?? ''}>{{ confirmed: 'System agrees', supported: 'System also sees it', not_reproduced: 'System cannot see it', needs_human: 'Needs checking at the source' }[f.auto_verdict as string] ?? f.auto_verdict}</Chip>}
              </div>
              <p className="text-sm text-gray-600 m-0">Record says: <b className="text-gray-900">{show(f.extracted_value)}</b></p>
              {(f.note || f.rule) && <p className="text-sm text-gray-600 mt-1 mb-0">{f.note || f.rule}</p>}
              {f.auto_note && <p className="text-xs text-gray-500 mt-1 mb-0">{f.auto_note}</p>}
              <p className="text-xs text-gray-400 mt-1 mb-0">{f.raised_by} · {shortAgo(f.created_at)}{f.status !== 'open' && f.resolved_by ? ` · ${f.status} by ${f.resolved_by}` : ''}</p>
              {f.status === 'open' ? (
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <input value={truth[f.id] ?? ''} onChange={e => setTruth(t => ({ ...t, [f.id]: e.target.value }))} placeholder="What the source really says (optional)"
                    className="flex-1 min-w-[200px] text-sm rounded-lg border border-gray-200 px-3 py-1.5" />
                  <Button onClick={() => resolve(f, 'confirmed')}>Real error</Button>
                  <Button variant="secondary" onClick={() => resolve(f, 'dismissed')}>Not an error</Button>
                </div>
              ) : f.truth_value ? <p className="text-sm text-gray-600 mt-1 mb-0">Source says: <b className="text-gray-900">{f.truth_value}</b></p> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Audit({ sourceId }: { sourceId: string }) {
  const [d, setD] = useState<any>(null)
  const [truth, setTruth] = useState<Record<string, string>>({})
  const load = () => { if (!sourceId) return; qualityApi.sample(sourceId, 20).then(setD).catch(() => setD({ items: [], done: [], audited: 0, fields_total: 0 })) }
  useEffect(() => { setD(null); load() }, [sourceId])
  if (!sourceId) return <Blank title="Pick a source" text="Choose a source above, then check a sample of its fields against the real source." />
  if (!d) return <Skeletons rows={4} />
  const key = (x: any) => `${x.record_id}:${x.field}`
  const mark = async (x: any, verdict: 'correct' | 'incorrect') => {
    const t = truth[key(x)]?.trim()
    if (verdict === 'incorrect' && !t) return toast.error('Type what the source really says first')
    try { await qualityApi.audit({ record_id: x.record_id, field: x.field, verdict, truth_value: t || undefined }); load() }
    catch (e) { toast.error(err(e, "Couldn't save that")) }
  }
  const undo = async (x: any) => { try { await qualityApi.deleteAudit(x.audit_id); load() } catch (e) { toast.error(err(e, "Couldn't undo that")) } }
  return (
    <div className="space-y-5">
      <Panel title="Fields to check" subtitle={`${d.audited} of ${d.fields_total} fields checked. Fields already doubted come first, then a random spread. Open the real source, compare, and mark each one.`}>
        {d.items.length === 0 ? <Blank title="All sampled fields are checked" text="Reload for a new sample, or look at the scores." /> : (
          <ul className="m-0 p-0 list-none divide-y divide-gray-50">
            {d.items.map((x: any) => (
              <li key={key(x)} className="py-3 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="text-xs text-gray-500 m-0">{x.record} · {x.field} {x.reason === 'doubted' && <Chip tone="amber">Doubted</Chip>}</p>
                  <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5 break-words">{show(x.value)}</p>
                </div>
                <input value={truth[key(x)] ?? ''} onChange={e => setTruth(t => ({ ...t, [key(x)]: e.target.value }))} placeholder="Real value, if wrong"
                  className="text-sm rounded-lg border border-gray-200 px-3 py-1.5 w-48 max-w-full" />
                <Button onClick={() => mark(x, 'correct')}>Correct</Button>
                <Button variant="secondary" onClick={() => mark(x, 'incorrect')}>Wrong</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {d.done.length > 0 && (
        <Panel title="Recently checked">
          <ul className="m-0 p-0 list-none divide-y divide-gray-50">
            {d.done.slice().reverse().map((x: any) => (
              <li key={key(x)} className="py-2 flex items-center gap-3 text-sm flex-wrap">
                <Chip tone={x.verdict === 'correct' ? 'green' : 'red'}>{x.verdict === 'correct' ? 'Correct' : 'Wrong'}</Chip>
                <span className="text-gray-700 flex-1 min-w-0 break-words">{x.record} · {x.field}: {show(x.value)}{x.truth_value ? ` → ${x.truth_value}` : ''}</span>
                <button type="button" onClick={() => undo(x)} className="text-xs text-gray-500 hover:text-gray-800 underline">Undo</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

function SopCheck({ sourceId, projectId, onPick }: { sourceId: string; projectId: string; onPick: (id: string) => void }) {
  const [ov, setOv] = useState<any[] | null>(null)
  const [d, setD] = useState<any>(null)
  useEffect(() => { setOv(null); setD(null); if (sourceId) qualityApi.sopCheck(sourceId).then(setD).catch(() => setD({ error: true })); else qualityApi.sopOverview(projectId).then(r => setOv(r.items)).catch(() => setOv([])) }, [sourceId, projectId])

  if (!sourceId) {
    if (!ov) return <Skeletons rows={4} />
    if (ov.length === 0) return <Blank title="No sources to check yet" text="Sources show here once work has started on them." />
    return (
      <div className="space-y-5">
      <SopRequirementsOverview projectId={projectId} onPick={onPick} />
      <Panel title="Do the records follow each source's SOP?" subtitle="Checked against what the SOP text requires for the source's category: required fields filled in, and values inside the SOP's allowed lists. Open a source to see each field.">
        <ul className="m-0 p-0 list-none divide-y divide-gray-50">
          {ov.map(x => (
            <li key={x.source_id} className="py-2.5 flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => onPick(x.source_id)} className="text-sm font-semibold text-gray-900 hover:underline text-left flex-1 min-w-[160px]">{x.name}</button>
              {x.sop_code && <Chip tone="indigo">{x.sop_code}</Chip>}
              {x.known && <span className="text-xs text-gray-500">{x.required_count} required{x.category ? ` · ${x.category}` : ''}</span>}
              {x.known && x.warnings > 0 && <Chip tone="amber">{x.warnings} to settle</Chip>}
              {x.stale && <Chip tone="amber">SOP may be outdated</Chip>}
              {x.no_contract && <Chip tone="gray">No contract</Chip>}
              {x.known ? <><span className="text-sm text-gray-500 tabular-nums">{x.compliant} of {x.records} records</span><Chip tone={scoreTone(x.rate)}>{pc(x.rate)}</Chip></> : <Chip tone="gray">No SOP saved</Chip>}
            </li>
          ))}
        </ul>
      </Panel>
      </div>
    )
  }
  if (!d) return <Skeletons rows={4} />
  if (d.error) return <Blank title="Couldn't run the SOP check" text="Check your connection and try again." />
  if (!d.known) return <Blank title="No SOP saved on this source" text="The SOP is saved when a source is pulled from Xtrium. This one has none yet. Open Review, then SOP rules, and use Refresh from Xtrium once." />
  const reqPanel = <Panel title="What this SOP requires" subtitle="Every field, allowed value and rule the SOP states, with the exact line. Rules under another category's heading are shown but not enforced here."><SopRulesBody sourceId={sourceId} /></Panel>
  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Follow the SOP" value={pc(d.rate)} tone={scoreTone(d.rate)} hint={`${d.compliant} of ${d.records} records have every required field`} />
        <Tile label="Records falling short" value={d.failing_total} tone={d.failing_total ? 'amber' : 'green'} hint="A required field is empty, or a value is outside the allowed list" />
        <Tile label="Required fields" value={d.required.length} hint={[d.sop_code, d.entity, d.category && `category ${d.category}`].filter(Boolean).join(' · ')} />
        <Tile label="Fields not in the SOP" value={d.extra_fields.length} tone={d.extra_fields.length ? 'amber' : 'gray'} hint="Filled in but not listed by the SOP" />
      </div>
      {d.warnings?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">Settle these before trusting the percentage</div>
          <ul className="m-0 pl-5 space-y-0.5">{d.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Fields the SOP checks" subtitle="Required fields and fields with allowed values, weakest first. Names are matched ignoring case and underscores.">
          <ul className="m-0 p-0 list-none space-y-2">
            {d.by_field.map((f: any) => (
              <li key={f.field} className="text-sm">
                <div className="flex justify-between"><span className="text-gray-800">{f.field}</span><span className="tabular-nums text-gray-600">{f.filled} ok · {f.missing} {f.absent ? `empty (${f.absent} never delivered)` : 'empty'}{f.bad ? ` · ${f.bad} not allowed` : ''}</span></div>
                {f.allowed?.length > 0 && <div className="text-xs text-gray-500">allowed: {f.allowed.join(', ')}</div>}
                <div className="h-1.5 rounded-full bg-gray-100 mt-1"><div className={`h-1.5 rounded-full ${f.pct >= 90 ? 'bg-emerald-500' : f.pct >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${f.pct ?? 0}%` }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Fields the SOP does not list">
          {d.extra_fields.length === 0 ? <Blank title="None" text="Every filled field is one the SOP asks for." /> : (
            <ul className="m-0 p-0 list-none space-y-1.5">{d.extra_fields.map((f: any) => <li key={f.field} className="flex justify-between text-sm"><span className="text-gray-800">{f.field}</span><span className="tabular-nums text-gray-600">{f.count} record{f.count === 1 ? '' : 's'}</span></li>)}</ul>
          )}
        </Panel>
      </div>
      <Panel title="Records falling short" subtitle={d.failing_total > d.failing.length ? `Showing ${d.failing.length} of ${d.failing_total}. Use "Run system checks" in Errors logged to log all of them.` : 'Use "Run system checks" in Errors logged to log these as findings.'}>
        {d.failing.length === 0 ? <Blank title="Every record follows the SOP" /> : (
          <ul className="m-0 p-0 list-none divide-y divide-gray-50">
            {d.failing.map((r: any) => (
              <li key={r.record_id} className="py-2 text-sm flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900">{r.record}</span>
                {r.missing.length > 0 && <span className="text-gray-500">missing</span>}
                {r.missing.map((m: string) => <Chip key={m} tone="red">{m}</Chip>)}
                {(r.bad || []).map((b: any) => <span key={b.field} className="text-xs text-gray-600"><Chip tone="amber">{b.field}</Chip> {b.value} {b.allowed?.length ? `is not in: ${b.allowed.join(', ')}` : `is ${b.reason}`}</span>)}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {reqPanel}
    </div>
  )
}
