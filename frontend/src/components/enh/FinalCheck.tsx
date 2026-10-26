import { Fragment, useEffect, useRef, useState } from 'react'
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
  const [busy, setBusy] = useState<'check' | 'apply' | 'download' | ''>('')
  const [res, setRes] = useState<any>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dec, setDec] = useState<Record<string, 'wrong' | 'right'>>({})
  const first = useRef(true)

  const download = async (format: 'xlsx' | 'json') => {
    if (!file) return
    setBusy('download')
    try { await qualityApi.answerKeyDownload(file, { format, projectId, sourceId, decisions: dec }) }
    catch (e) { toast.error(err(e, "Couldn't make that download")) } finally { setBusy('') }
  }

  const run = async (apply: boolean) => {
    if (!file) return toast.error('Choose the file first')
    const held = res?.totals?.pending ?? 0
    if (apply && !window.confirm(`Record these results as audits?\n\nThis saves a correct or wrong verdict for every field you have decided, and settles the reviewers' comments on them.${held ? `\n\n${held} field${held === 1 ? ' is' : 's are'} still to confirm and will NOT be recorded.` : ''}\nNo record is edited.`)) return
    setBusy(apply ? 'apply' : 'check')
    try {
      const r = await qualityApi.answerKey(file, { apply, projectId, sourceId, decisions: dec })
      setRes(r)
      if (apply) toast.success(`Recorded ${r.applied?.written ?? 0} field verdicts`)
    } catch (e) { toast.error(err(e, "Couldn't read that file")) } finally { setBusy('') }
  }

  // Deciding a field recalculates the numbers (nothing is saved until "Record these as audits").
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!res || !file || busy) return
    const h = setTimeout(() => { qualityApi.answerKey(file, { apply: false, projectId, sourceId, decisions: dec }).then(setRes).catch(() => {}) }, 500)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dec])
  const decide = (keys: string[], v: 'wrong' | 'right' | null) => setDec(d => { const n = { ...d }; keys.forEach(k => { if (v) n[k] = v; else delete n[k] }); return n })
  const t = res?.totals
  return (
    <div className="space-y-5">
      <Panel title="Check the final records" subtitle="Upload the zip or the all-records file. Each source and record is matched by name, and every field is compared with what the extractor delivered. A field that differs is only a doubt until you decide it: it is held, and counts against nobody. Mark it Wrong (the extractor erred) or Extractor right (you changed it). Nothing is edited.">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".zip,.json" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null); setDec({}) }} aria-label="Final records file"
            className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          <Button onClick={() => run(false)} disabled={!file || !!busy}>{busy === 'check' ? 'Checking…' : 'Check'}</Button>
          {res && res.mode === 'preview' && <Button variant="secondary" onClick={() => run(true)} disabled={!!busy}>{busy === 'apply' ? 'Recording…' : 'Record these as audits'}</Button>}
          {res && <Button variant="secondary" onClick={() => download('xlsx')} disabled={!!busy} title="Summary, per source, every wrong field, reviewers and extractors">{busy === 'download' ? 'Preparing…' : 'Download Excel'}</Button>}
          {res && <Button variant="secondary" onClick={() => download('json')} disabled={!!busy}>Download JSON</Button>}
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
          {t.pending > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>{t.pending} field{t.pending === 1 ? '' : 's'} to confirm.</b> The final value differs from what the extractor delivered. These are held: they are not counted as errors and nothing is recorded for them until you decide each one. Open a source below.
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Tile label="Accuracy" value={pc(t.accuracy_pct)} tone={accTone(t.accuracy_pct)} hint={`${t.fields - t.pending - t.wrong} of ${t.fields - t.pending} decided fields match${t.pending ? `, ${t.pending} still to confirm` : ''}`} />
            <Tile label="Error rate" value={pc(t.error_pct)} tone={t.wrong ? 'red' : 'green'} hint={`${t.wrong} wrong of ${t.fields - t.pending} fields compared`} />
            <Tile label="Reviewer catch rate" value={t.reviewer_flags === 0 ? '–' : pc(t.catch_rate)} tone={t.reviewer_flags === 0 ? 'gray' : accTone(t.catch_rate)} hint={t.reviewer_flags === 0 ? 'No field-level reviewer flags were found, so nothing counts as caught. Reviewers may have commented on the whole source only.' : `${t.caught + (t.fixed ?? 0)} caught${t.fixed ? ` (${t.fixed} fixed after review)` : ''}, ${t.escaped} got through`} />
            <Tile label="False alarms" value={t.false_alarms} tone={t.false_alarms ? 'amber' : 'green'} hint="Fields a reviewer flagged that were right" />
            <Tile label="Sources" value={t.sources} hint={`${t.records} records matched`} />
            <Tile label="To confirm" value={t.pending} tone={t.pending ? 'amber' : 'green'} hint={t.admin_changes ? `${t.admin_changes} marked as your own change` : 'Differences held until you decide'} />
          </div>

          <Panel title="By source" subtitle="Open a row to see the wrong fields, with who flagged each." flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">
                  {['Source', 'Extractor', 'Fields', 'Wrong', 'To confirm', 'Error %', 'Accuracy %', 'Caught', 'Escaped', 'False alarms'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {res.sources.map((s: any) => (
                    <Fragment key={s.source_id}>
                      <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [s.source_id]: !o[s.source_id] }))}>
                        <td className="px-3 py-2 font-semibold text-gray-900">{open[s.source_id] ? '▾' : '▸'} {s.name}</td>
                        <td className="px-3 py-2 text-gray-700">{s.extractor}</td>
                        <td className="px-3 py-2 tabular-nums">{s.fields}</td>
                        <td className="px-3 py-2 tabular-nums">{s.wrong}</td>
                        <td className="px-3 py-2 tabular-nums">{s.pending ? <Chip tone="amber">{s.pending}</Chip> : 0}</td>
                        <td className="px-3 py-2 tabular-nums">{pc(s.error_pct)}</td>
                        <td className="px-3 py-2 tabular-nums"><Chip tone={accTone(s.accuracy_pct)}>{pc(s.accuracy_pct)}</Chip></td>
                        <td className="px-3 py-2 tabular-nums">{s.caught + (s.fixed ?? 0)}</td>
                        <td className="px-3 py-2 tabular-nums">{s.escaped}</td>
                        <td className="px-3 py-2 tabular-nums">{s.false_alarms}</td>
                      </tr>
                      {open[s.source_id] && (
                        <tr><td colSpan={10} className="px-3 pb-3 bg-gray-50">
                          <p className="m-0 pt-2 text-xs text-gray-500">Reviewer flags found on this source: {s.reviewer_flags}</p>
                          {s.wrong_fields.length === 0 && s.false_alarm_fields.length === 0 && <p className="m-0 py-2 text-sm text-emerald-700">Every field matches the final record.</p>}
                          {s.pending > 0 && (
                            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-gray-600">
                              <span>{s.pending} to confirm in this source:</span>
                              <button type="button" className="font-semibold rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100" onClick={() => decide(s.wrong_fields.filter((w: any) => w.decision === 'pending').map((w: any) => w.key), 'wrong')}>All extractor wrong</button>
                              <button type="button" className="font-semibold rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100" onClick={() => decide(s.wrong_fields.filter((w: any) => w.decision === 'pending').map((w: any) => w.key), 'right')}>All extractor right</button>
                            </div>
                          )}
                          {s.wrong_fields.length > 0 && (
                            <table className="w-full text-[13px] border-collapse mt-2">
                              <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Record</th><th className="pr-3">Field</th><th className="pr-3">Extractor delivered</th><th className="pr-3">Final</th><th className="pr-3">Flagged by</th><th className="pr-3">Result</th><th>Your call</th></tr></thead>
                              <tbody>{s.wrong_fields.map((w: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 align-top">
                                  <td className="py-1.5 pr-3 text-gray-700">{w.record}</td>
                                  <td className="pr-3 font-mono text-[12px]">{w.field}</td>
                                  <td className="pr-3 text-gray-700 break-words max-w-[240px]">{show(w.extractor_value)}</td>
                                  <td className="pr-3 text-gray-900 break-words max-w-[240px]">{show(w.final_value)}</td>
                                  <td className="pr-3 text-gray-700">{w.flagged_by.length ? w.flagged_by.join(', ') : w.system_flagged ? 'System check' : '—'}</td>
                                  <td className="pr-3"><Chip tone={w.outcome === 'caught' ? 'green' : w.outcome === 'escaped' ? 'red' : w.outcome === 'admin_change' ? 'gray' : 'amber'}>{w.outcome === 'caught' ? 'Caught' : w.outcome === 'escaped' ? 'Got through' : w.outcome === 'admin_change' ? 'Your change' : 'To confirm'}</Chip></td>
                                  <td className="whitespace-nowrap">
                                    <button type="button" onClick={() => decide([w.key], w.decision === 'wrong' ? null : 'wrong')} aria-pressed={w.decision === 'wrong'}
                                      className={`text-xs font-semibold rounded-md border px-2 py-1 mr-1 ${w.decision === 'wrong' ? 'bg-red-600 text-white border-red-600' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>Extractor wrong</button>
                                    <button type="button" onClick={() => decide([w.key], w.decision === 'right' ? null : 'right')} aria-pressed={w.decision === 'right'}
                                      className={`text-xs font-semibold rounded-md border px-2 py-1 ${w.decision === 'right' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>Extractor right</button>
                                  </td>
                                </tr>))}</tbody>
                            </table>
                          )}
                          {(s.fixed_fields ?? []).length > 0 && (
                            <div className="mt-2"><p className="m-0 text-xs font-semibold text-emerald-700">Fixed after review (reviewer caught it, extractor corrected it)</p>
                              {s.fixed_fields.map((f: any, i: number) => <p key={i} className="m-0 text-[13px] text-gray-700"><span className="font-mono text-[12px]">{f.field}</span> on {f.record}: {f.flagged_by} flagged {show(f.was)}; now {show(f.now)}.</p>)}
                            </div>
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
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">{['Extractor', 'Sources', 'Fields', 'Wrong', 'To confirm', 'Error %', 'Accuracy %'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{res.extractors.map((e: any) => (
                  <tr key={e.name} className="border-b border-gray-50"><td className="px-3 py-2 font-semibold text-gray-900">{e.name}</td><td className="px-3 py-2 tabular-nums">{e.sources}</td><td className="px-3 py-2 tabular-nums">{e.fields}</td><td className="px-3 py-2 tabular-nums">{e.wrong}</td><td className="px-3 py-2 tabular-nums">{e.pending}</td><td className="px-3 py-2 tabular-nums">{pc(e.error_pct)}</td><td className="px-3 py-2"><Chip tone={accTone(e.accuracy_pct)}>{pc(e.accuracy_pct)}</Chip></td></tr>))}</tbody>
              </table>
            </Panel>
            <Panel title="Reviewers" flush>
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">{['Reviewer', 'Flags', 'Caught', 'False alarms', 'Catch rate', 'Precision'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{res.reviewers.map((r: any) => (
                  <tr key={r.name} className="border-b border-gray-50"><td className="px-3 py-2 font-semibold text-gray-900">{r.name}</td><td className="px-3 py-2 tabular-nums">{r.flags}</td><td className="px-3 py-2 tabular-nums">{r.caught}</td><td className="px-3 py-2 tabular-nums">{r.false_alarms}</td><td className="px-3 py-2">{r.flags === 0 ? <Chip tone="gray" title="This reviewer raised no field-level flag, so there is nothing to score">No flags</Chip> : <Chip tone={accTone(r.catch_rate)}>{pc(r.catch_rate)}</Chip>}</td><td className="px-3 py-2 tabular-nums">{pc(r.precision)}</td></tr>))}</tbody>
              </table>
              <p className="m-0 px-3 py-2 text-[11px] text-gray-500">Catch rate: errors they flagged out of all wrong fields on their sources. Precision: their flags that were really wrong. "No flags" means they raised nothing on a specific field, so the rate is not scored.</p>
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
