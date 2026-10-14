import { useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tabs, Tile, shortAgo, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`)
const scoreTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d

type Tab = 'scores' | 'findings' | 'audit'

export function QualityPage() {
  const [sources, setSources] = useState<any[] | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [days, setDays] = useState('90')
  const [tab, setTab] = useState<Tab>('scores')

  useEffect(() => { qualityApi.sources().then(r => setSources(r.items)).catch(() => setSources([])) }, [tab])
  const src = (sources ?? []).find(s => s.source_id === sourceId)

  return (
    <div className={PAGE}>
      <PageHeader title="Quality" subtitle="How accurate the delivered data is, how many errors reviewers caught, and how many got through. Scores come from errors that were checked and from fields an admin verified against the real source." />
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'scores', label: 'Scores' }, { key: 'findings', label: 'Errors logged', count: (sources ?? []).reduce((n, s) => n + s.open_findings, 0) }, { key: 'audit', label: 'Check against source' }]} />
        <SelectBox label="Source" value={sourceId} onChange={setSourceId}>
          <option value="">All sources</option>
          {(sources ?? []).map(s => <option key={s.source_id} value={s.source_id}>{s.name}{s.open_findings ? ` (${s.open_findings} open)` : ''}</option>)}
        </SelectBox>
        {tab === 'scores' && (
          <SelectBox label="Period" value={days} onChange={setDays}>
            <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
          </SelectBox>
        )}
      </div>
      {tab === 'scores' && <Scores sourceId={sourceId} days={Number(days)} />}
      {tab === 'findings' && <Findings sourceId={sourceId} source={src} />}
      {tab === 'audit' && <Audit sourceId={sourceId} />}
    </div>
  )
}

function Scores({ sourceId, days }: { sourceId: string; days: number }) {
  const [d, setD] = useState<any>(null)
  useEffect(() => { setD(null); qualityApi.summary({ source_id: sourceId || undefined, days }).then(setD).catch(() => setD({ error: true })) }, [sourceId, days])
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
        <Tile label="Final accuracy" value={pc(s.final_accuracy)} tone={scoreTone(s.final_accuracy)} hint={`${c.audited - c.audited_wrong} of ${c.audited} checked fields were right`} />
        <Tile label="Review catch rate" value={pc(s.review_catch_rate)} tone={scoreTone(s.review_catch_rate)} hint={`${c.reviewer_confirmed} caught, ${c.escaped} got through`} />
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
        <Panel title="Extractors" subtitle="Errors per 100 fields, and accuracy on fields checked at the source">
          {d.extractors.length === 0 ? <Blank title="No data yet" /> : (
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-semibold">Name</th><th className="font-semibold">Errors/100</th><th className="font-semibold">Checked</th><th className="font-semibold">Accuracy</th></tr></thead>
              <tbody>{d.extractors.map((e: any) => (
                <tr key={e.user_id} className="border-t border-gray-50"><td className="py-1.5 text-gray-900">{e.name}</td><td className="tabular-nums">{e.errors_per_100 ?? '–'}</td><td className="tabular-nums">{e.audited}</td><td><Chip tone={scoreTone(e.audit_accuracy)}>{pc(e.audit_accuracy)}</Chip></td></tr>
              ))}</tbody></table>
          )}
        </Panel>
      </div>
      <Panel title="Reviewers" subtitle="How many of each reviewer's logged errors turned out to be real">
        {d.reviewers.length === 0 ? <Blank title="No errors logged yet" text="Reviewers flag errors from a record in the source page." /> : (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-semibold">Name</th><th className="font-semibold">Logged</th><th className="font-semibold">Confirmed</th><th className="font-semibold">Dismissed</th><th className="font-semibold">Open</th><th className="font-semibold">Precision</th></tr></thead>
            <tbody>{d.reviewers.map((r: any) => (
              <tr key={r.user_id} className="border-t border-gray-50"><td className="py-1.5 text-gray-900">{r.name}</td><td className="tabular-nums">{r.raised}</td><td className="tabular-nums">{r.confirmed}</td><td className="tabular-nums">{r.dismissed}</td><td className="tabular-nums">{r.open}</td><td><Chip tone={scoreTone(r.precision)}>{pc(r.precision)}</Chip></td></tr>
            ))}</tbody></table>
        )}
      </Panel>
    </div>
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
