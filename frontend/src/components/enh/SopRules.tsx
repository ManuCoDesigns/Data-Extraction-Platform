import { useEffect, useMemo, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Skeletons, type Tone } from '@/components/enh/kit'
import { Button, cn, toast } from '@/components/ui'

// What a source must follow, read from the SOP saved on it: the fields it requires, the values it allows and the
// rules it states, each with its section and the exact line. Nothing here is guessed.

const err = (e: any, d: string) => e?.response?.data?.detail || d
const STRENGTH: Record<string, Tone> = { MUST: 'red', SHOULD: 'amber', INFO: 'gray' }

export function SopRulesBody({ sourceId }: { sourceId: string }) {
  const [d, setD] = useState<any>(null)
  const [q, setQ] = useState('')
  const [onlyMust, setOnlyMust] = useState(false)
  useEffect(() => { setD(null); qualityApi.sopRequirementsFor(sourceId).then(setD).catch(() => setD({ error: true })) }, [sourceId])
  const match = (t: string) => !q.trim() || t.toLowerCase().includes(q.trim().toLowerCase())
  const sections = useMemo(() => (d?.sections ?? []).map((s: any) => ({ ...s, rules: s.rules.filter((r: any) => (!onlyMust || r.strength === 'MUST') && (match(r.text) || r.fields.some((f: string) => match(f)))) })).filter((s: any) => s.rules.length), [d, q, onlyMust])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Skeletons rows={3} />
  if (d.error) return <Blank title="Couldn't load the SOP" text="Check your connection and try again." />
  if (!d.has_sop) return <Blank title="No SOP saved for this source" text={d.warnings[0]} />
  const fields = (d.fields ?? []).filter((f: any) => match(f.name) || match(f.rule || '') || match((f.allowed || []).join(' ')))
  const mine = sections.filter((s: any) => s.matches), other = sections.filter((s: any) => !s.matches)
  const ruleList = (list: any[]) => list.map((s: any) => (
    <details key={s.id} open={s.matches || !!q} className="rounded-xl border border-gray-100">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">{s.path.slice(-2).join(' › ') || s.title}
        {s.matches && <Chip tone="green">Names this source</Chip>}<span className="text-xs font-normal text-gray-500">{s.rules.length} rule{s.rules.length === 1 ? '' : 's'}</span></summary>
      <ul className="m-0 p-0 list-none divide-y divide-gray-50">
        {s.rules.map((r: any, i: number) => (
          <li key={i} className="px-3 py-2 flex items-start gap-2">
            <Chip tone={STRENGTH[r.strength] ?? 'gray'}>{r.strength === 'MUST' ? 'Must' : r.strength === 'SHOULD' ? 'Should' : 'Note'}</Chip>
            <div className="min-w-0 text-sm text-gray-800 break-words">{r.text}
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5"><span className="text-[11px] text-gray-500">{r.kind}</span>{r.fields.slice(0, 6).map((f: string) => <span key={f} className="text-[11px] rounded bg-gray-100 px-1.5 text-gray-600 font-mono">{f}</span>)}</div></div>
          </li>
        ))}
      </ul>
    </details>
  ))
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {d.sop_code && <Chip tone="indigo">{d.sop_code}</Chip>}
        {d.spec_version && <Chip tone="gray">Version {d.spec_version}</Chip>}
        {d.entity && <Chip tone="blue">Entity: {d.entity}</Chip>}
        <Chip tone={d.category ? 'green' : 'amber'}>{d.category ? `Category: ${d.category}` : 'No category set'}</Chip>
        <span className="text-sm text-gray-700">{d.title}</span>
        <span className="ml-auto text-xs text-gray-500 tabular-nums">{d.counts.required_fields} required fields · {d.counts.must_rules} must rules · {d.counts.matching_sections} of {d.counts.sections} sections name this source</span>
      </div>
      {d.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <b>Settle these before judging this source strictly.</b>
          <ul className="m-0 mt-1 pl-5 list-disc">{d.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a field or a rule" aria-label="Find a field or a rule" className="text-sm rounded-xl border border-gray-200 px-3 py-1.5 w-64 max-w-full" />
        <button type="button" aria-pressed={onlyMust} onClick={() => setOnlyMust(v => !v)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', onlyMust ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>{onlyMust ? '✓ ' : ''}Must rules only</button>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-900 m-0 mb-1.5">Fields ({fields.length})</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="text-left text-xs text-gray-500 bg-gray-50"><th className="font-semibold px-3 py-1.5">Field</th><th className="font-semibold px-3 py-1.5">Required</th><th className="font-semibold px-3 py-1.5">Allowed values</th><th className="font-semibold px-3 py-1.5">Rule</th><th className="font-semibold px-3 py-1.5">Section</th></tr></thead>
            <tbody>{fields.map((f: any) => (
              <tr key={f.name} className="border-t border-gray-50 align-top" title={f.quote}>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-900">{f.name}</td>
                <td className="px-3 py-1.5">{f.required ? <Chip tone="red">Required</Chip> : f.required === false ? <span className="text-xs text-gray-500">Optional</span> : <span className="text-xs text-gray-400">Not stated</span>}</td>
                <td className="px-3 py-1.5 text-xs text-gray-700">{(f.allowed || []).join(', ') || <span className="text-gray-300">any</span>}{f.format && <div className="text-gray-500">{f.format}</div>}</td>
                <td className="px-3 py-1.5 text-xs text-gray-700 break-words max-w-[340px]">{f.rule}{f.enforce === false && <div className="text-amber-700">Under another category's section: shown, not enforced here.</div>}</td>
                <td className="px-3 py-1.5 text-xs text-gray-500">{f.section}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-500 m-0 mt-1">Hover a row for the exact line in the SOP.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-gray-900 m-0">Rules that name this source ({mine.reduce((n: number, s: any) => n + s.rules.length, 0)})</h3>
        {mine.length ? ruleList(mine) : <p className="text-sm text-gray-500 m-0">No section of the SOP names this source's category or entity.</p>}
        {other.length > 0 && <>
          <h3 className="text-sm font-bold text-gray-900 m-0 pt-2">General and other sections ({other.reduce((n: number, s: any) => n + s.rules.length, 0)})</h3>
          {ruleList(other)}</>}
      </div>
    </div>
  )
}

export function SopRulesPanel({ sourceId, name, onClose }: { sourceId: string; name: string; onClose: () => void }) {
  return (
    <section className="rounded-2xl border border-indigo-200 bg-white" aria-label="What this source must follow">
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 m-0">What {name} must follow</h2>
        <span className="text-xs text-gray-500">Read from the SOP saved on this source, with the exact lines. Nothing is guessed.</span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      <div className="p-4"><SopRulesBody sourceId={sourceId} /></div>
    </section>
  )
}

export function SopRequirementsOverview({ projectId, onPick }: { projectId: string; onPick: (id: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyWarn, setOnlyWarn] = useState(false)
  useEffect(() => { setItems(null); qualityApi.sopRequirements(projectId).then(r => setItems(r.items)).catch(() => setItems([])) }, [projectId])
  const download = async () => { setBusy(true); try { await qualityApi.exportSopRequirements(projectId) } catch (e) { toast.error(err(e, 'Could not prepare the download')) } finally { setBusy(false) } }
  if (!items) return <Skeletons rows={3} />
  const shown = items.filter(x => !onlyWarn || x.warnings.length)
  const bad = items.filter(x => x.warnings.length).length
  return (
    <div className="rounded-2xl border border-gray-100 bg-white">
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 m-0">What each source must follow</h2>
        <span className="text-xs text-gray-500">{items.length} sources · {bad} with something to settle</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" aria-pressed={onlyWarn} onClick={() => setOnlyWarn(v => !v)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', onlyWarn ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>{onlyWarn ? '✓ ' : ''}Needs attention</button>
          <Button size="sm" variant="secondary" disabled={busy || !items.length} onClick={download} title="Every field, rule and warning, with the section and exact line from each SOP">{busy ? 'Preparing…' : 'Download Excel'}</Button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="text-left text-xs text-gray-500 bg-gray-50"><th className="font-semibold px-4 py-1.5">Source</th><th className="font-semibold px-3 py-1.5">Category</th><th className="font-semibold px-3 py-1.5">SOP</th><th className="font-semibold px-3 py-1.5">Required</th><th className="font-semibold px-3 py-1.5">Rules</th><th className="font-semibold px-3 py-1.5">To settle</th></tr></thead>
          <tbody>{shown.map(x => (
            <tr key={x.source_id} className="border-t border-gray-50 align-top">
              <td className="px-4 py-2"><button type="button" className="font-semibold text-gray-900 hover:underline text-left" onClick={() => onPick(x.source_id)}>{x.name}</button></td>
              <td className="px-3 py-2 text-gray-700">{x.category || <span className="text-amber-700">None</span>}</td>
              <td className="px-3 py-2">{x.has_sop ? <><Chip tone="indigo">{x.sop_code || 'SOP'}</Chip>{x.spec_version && <span className="text-xs text-gray-500"> v{x.spec_version}</span>}</> : <Chip tone="gray">No SOP saved</Chip>}</td>
              <td className="px-3 py-2 tabular-nums text-gray-700">{x.has_sop ? x.counts.required_fields ?? x.required_fields.length : ''}</td>
              <td className="px-3 py-2 tabular-nums text-gray-700">{x.has_sop ? `${x.counts.must_rules ?? 0} must · ${x.counts.rules ?? 0}` : ''}</td>
              <td className="px-3 py-2 text-xs text-amber-800 max-w-[360px]">{x.warnings.length ? <details><summary className="cursor-pointer">{x.warnings.length} thing{x.warnings.length === 1 ? '' : 's'}</summary><ul className="m-0 mt-1 pl-4 list-disc">{x.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></details> : <span className="text-emerald-700">Clear</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}
