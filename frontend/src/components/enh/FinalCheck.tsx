import { Fragment, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, Tile, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

/**
 * Upload the final records, see them against what the extractor delivered and what the reviewers flagged, with error % and accuracy %
 * worked out. Checking changes nothing. "Record these as audits" saves each verdict the same way marking a field in Review does.
 * No record is edited at any point.
 */

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v}%`)
const accTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 95 ? 'green' : v >= 85 ? 'amber' : 'red')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d

export function FinalCheck({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'check' | 'apply' | ''>('')
  const [res, setRes] = useState<any>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const run = async (apply: boolean) => {
    if (!file) return toast.error('Choose the file first')
    if (apply && !window.confirm('Record these results as audits?\n\nThis saves a correct or wrong verdict for every field compared, and settles the reviewers\' comments on them. No record is edited.')) return
    setBusy(apply ? 'apply' : 'check')
    try {
      const r = await qualityApi.answerKey(file, { apply, projectId, sourceId })
      setRes(r)
      if (apply) toast.success(`Recorded ${r.applied?.written ?? 0} field verdicts`)
    } catch (e) { toast.error(err(e, "Couldn't read that file")) } finally { setBusy('') }
  }

  const t = res?.totals
  return (
    <div className="space-y-5">
      <Panel title="Check the final records" subtitle="Upload the zip or the all-records file. Each source and record is matched by name, and every field is compared with what the extractor delivered. Wrong fields the reviewers flagged count as catches; wrong fields nobody flagged escaped. Nothing is edited.">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".zip,.json" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null) }} aria-label="Final records file"
            className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          <Button onClick={() => run(false)} disabled={!file || !!busy}>{busy === 'check' ? 'Checking…' : 'Check'}</Button>
          {res && res.mode === 'preview' && <Button variant="secondary" onClick={() => run(true)} disabled={!!busy}>{busy === 'apply' ? 'Recording…' : 'Record these as audits'}</Button>}
        </div>
        {sourceId && <p className="text-xs text-gray-500 mt-2 mb-0">A single list of records will be checked against the source picked above.</p>}
      </Panel>

      {!res ? <Blank title="Nothing checked yet" text="Choose the file, then press Check. You will see the error % and accuracy % before anything is saved." /> : (
        <>
          {res.mode === 'applied' && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm">
              <b>Recorded.</b> {res.applied.written} verdict{res.applied.written === 1 ? '' : 's'} saved, {res.applied.already_recorded} were already recorded.
              The Scores tab now includes these. {res.applied.skipped?.length > 0 && <span className="text-amber-800">{res.applied.skipped.length} could not be saved: {res.applied.skipped.slice(0, 4).map((s: any) => `${s.field} (${s.why})`).join('; ')}.</span>}
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Tile label="Accuracy" value={pc(t.accuracy_pct)} tone={accTone(t.accuracy_pct)} hint={`${t.fields - t.wrong} of ${t.fields} fields match the final records`} />
            <Tile label="Error rate" value={pc(t.error_pct)} tone={t.wrong ? 'red' : 'green'} hint={`${t.wrong} wrong of ${t.fields} fields compared`} />
            <Tile label="Reviewer catch rate" value={pc(t.catch_rate)} tone={accTone(t.catch_rate)} hint={`${t.caught} caught, ${t.escaped} got through`} />
            <Tile label="False alarms" value={t.false_alarms} tone={t.false_alarms ? 'amber' : 'green'} hint="Fields a reviewer flagged that were right" />
            <Tile label="Sources" value={t.sources} hint={`${t.records} records matched`} />
            <Tile label="Wording only" value={t.cosmetic} hint="Different case or spacing, counted as correct" />
          </div>

          <Panel title="By source" subtitle="Open a row to see the wrong fields, with who flagged each." flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">
                  {['Source', 'Extractor', 'Fields', 'Wrong', 'Error %', 'Accuracy %', 'Caught', 'Escaped', 'False alarms'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {res.sources.map((s: any) => (
                    <Fragment key={s.source_id}>
                      <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [s.source_id]: !o[s.source_id] }))}>
                        <td className="px-3 py-2 font-semibold text-gray-900">{open[s.source_id] ? '▾' : '▸'} {s.name}</td>
                        <td className="px-3 py-2 text-gray-700">{s.extractor}</td>
                        <td className="px-3 py-2 tabular-nums">{s.fields}</td>
                        <td className="px-3 py-2 tabular-nums">{s.wrong}</td>
                        <td className="px-3 py-2 tabular-nums">{pc(s.error_pct)}</td>
                        <td className="px-3 py-2 tabular-nums"><Chip tone={accTone(s.accuracy_pct)}>{pc(s.accuracy_pct)}</Chip></td>
                        <td className="px-3 py-2 tabular-nums">{s.caught}</td>
                        <td className="px-3 py-2 tabular-nums">{s.escaped}</td>
                        <td className="px-3 py-2 tabular-nums">{s.false_alarms}</td>
                      </tr>
                      {open[s.source_id] && (
                        <tr><td colSpan={9} className="px-3 pb-3 bg-gray-50">
                          {s.wrong_fields.length === 0 && s.false_alarm_fields.length === 0 && <p className="m-0 py-2 text-sm text-emerald-700">Every field matches the final record.</p>}
                          {s.wrong_fields.length > 0 && (
                            <table className="w-full text-[13px] border-collapse mt-2">
                              <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Record</th><th className="pr-3">Field</th><th className="pr-3">Extractor delivered</th><th className="pr-3">Final</th><th className="pr-3">Flagged by</th><th>Result</th></tr></thead>
                              <tbody>{s.wrong_fields.map((w: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 align-top">
                                  <td className="py-1.5 pr-3 text-gray-700">{w.record}</td>
                                  <td className="pr-3 font-mono text-[12px]">{w.field}</td>
                                  <td className="pr-3 text-gray-700 break-words max-w-[240px]">{show(w.extractor_value)}</td>
                                  <td className="pr-3 text-gray-900 break-words max-w-[240px]">{show(w.final_value)}</td>
                                  <td className="pr-3 text-gray-700">{w.flagged_by.length ? w.flagged_by.join(', ') : w.system_flagged ? 'System check' : '—'}</td>
                                  <td><Chip tone={w.outcome === 'caught' ? 'green' : 'red'}>{w.outcome === 'caught' ? 'Caught' : 'Got through'}</Chip></td>
                                </tr>))}</tbody>
                            </table>
                          )}
                          {s.false_alarm_fields.length > 0 && (
                            <div className="mt-2"><p className="m-0 text-xs font-semibold text-amber-800">False alarms (flagged, but right)</p>
                              {s.false_alarm_fields.map((f: any, i: number) => <p key={i} className="m-0 text-[13px] text-gray-700"><span className="font-mono text-[12px]">{f.field}</span> on {f.record}: flagged by {f.flagged_by.join(', ')}. Value: {show(f.value)}</p>)}
                            </div>
                          )}
                          {(s.key_records_unmatched.length > 0 || s.extractor_records_unmatched.length > 0) && (
                            <p className="m-0 mt-2 text-xs text-amber-800">
                              {s.key_records_unmatched.length > 0 && <>Final records with no match, not scored: {s.key_records_unmatched.join(', ')}. </>}
                              {s.extractor_records_unmatched.length > 0 && <>Extractor records with no match, not scored: {s.extractor_records_unmatched.join(', ')}.</>}
                            </p>
                          )}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Extractors" flush>
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">{['Extractor', 'Sources', 'Fields', 'Wrong', 'Error %', 'Accuracy %'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{res.extractors.map((e: any) => (
                  <tr key={e.name} className="border-b border-gray-50"><td className="px-3 py-2 font-semibold text-gray-900">{e.name}</td><td className="px-3 py-2 tabular-nums">{e.sources}</td><td className="px-3 py-2 tabular-nums">{e.fields}</td><td className="px-3 py-2 tabular-nums">{e.wrong}</td><td className="px-3 py-2 tabular-nums">{pc(e.error_pct)}</td><td className="px-3 py-2"><Chip tone={accTone(e.accuracy_pct)}>{pc(e.accuracy_pct)}</Chip></td></tr>))}</tbody>
              </table>
            </Panel>
            <Panel title="Reviewers" flush>
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">{['Reviewer', 'Flags', 'Caught', 'False alarms', 'Catch rate', 'Precision'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{res.reviewers.map((r: any) => (
                  <tr key={r.name} className="border-b border-gray-50"><td className="px-3 py-2 font-semibold text-gray-900">{r.name}</td><td className="px-3 py-2 tabular-nums">{r.flags}</td><td className="px-3 py-2 tabular-nums">{r.caught}</td><td className="px-3 py-2 tabular-nums">{r.false_alarms}</td><td className="px-3 py-2"><Chip tone={accTone(r.catch_rate)}>{pc(r.catch_rate)}</Chip></td><td className="px-3 py-2 tabular-nums">{pc(r.precision)}</td></tr>))}</tbody>
              </table>
              <p className="m-0 px-3 py-2 text-[11px] text-gray-500">Catch rate: errors they flagged out of all wrong fields on their sources. Precision: their flags that were really wrong.</p>
            </Panel>
          </div>

          {(res.unmatched_sources.length > 0 || res.notes.length > 0) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm space-y-1">
              {res.unmatched_sources.length > 0 && <p className="m-0"><b>Not matched to a source, so not scored:</b> {res.unmatched_sources.join(', ')}</p>}
              {res.notes.map((n: string, i: number) => <p key={i} className="m-0">{n}</p>)}
            </div>
          )}
          <p className="text-xs text-gray-500 m-0">Ignored when comparing: {res.ignored_fields.join(', ') || 'nothing'}. These are timestamps, not accuracy.</p>
        </>
      )}
    </div>
  )
}
