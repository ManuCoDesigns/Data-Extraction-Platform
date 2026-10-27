import { useEffect, useMemo, useRef, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, Tile, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { ask } from '@/lib/confirm'

/**
 * Upload the final records, see them against what the extractor delivered and what the reviewers flagged, with error % and accuracy %
 * worked out. Checking changes nothing. "Record these as audits" saves each verdict the same way marking a field in Review does.
 * No record is edited at any point.
 */

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v}%`)
const accTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 95 ? 'green' : v >= 85 ? 'amber' : 'red')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d

/** One bar that shows where every compared field landed: right, your change, still to confirm, or an extractor error. */
function Mix({ correct, admin, held, wrong, className }: { correct: number; admin: number; held: number; wrong: number; className?: string }) {
  const n = Math.max(1, correct + admin + held + wrong)
  const seg = (v: number, c: string, label: string) => v > 0 ? <span className={c} style={{ width: `${(100 * v) / n}%` }} title={`${label}: ${v}`} /> : null
  return (
    <span className={`flex h-2 rounded-full overflow-hidden bg-gray-100 ${className ?? ''}`} role="img" aria-label={`${correct} correct, ${admin} your changes, ${held} to confirm, ${wrong} errors`}>
      {seg(correct, 'bg-emerald-500', 'Correct')}{seg(admin, 'bg-sky-400', 'Your changes')}{seg(held, 'bg-amber-400', 'To confirm')}{seg(wrong, 'bg-red-500', 'Errors')}
    </span>
  )
}
const Legend = () => (
  <span className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
    {[['bg-emerald-500', 'Correct'], ['bg-sky-400', 'Your change'], ['bg-amber-400', 'To confirm'], ['bg-red-500', 'Error']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${c}`} />{l}</span>)}
  </span>
)

export function FinalCheck({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'check' | 'apply' | 'download' | ''>('')
  const [res, setRes] = useState<any>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dec, setDec] = useState<Record<string, 'wrong' | 'right'>>({})
  const first = useRef(true)
  const [sub, setSub] = useState<any>(null)
  const [approve, setApprove] = useState(true)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'all' | 'confirm' | 'errors' | 'clean'>('all')
  const [sort, setSort] = useState<'name' | 'accuracy' | 'errors'>('name')

  const download = async (format: 'xlsx' | 'json') => {
    if (!file) return
    setBusy('download')
    try { await qualityApi.answerKeyDownload(file, { format, projectId, sourceId, decisions: dec }) }
    catch (e) { toast.error(err(e, "Couldn't make that download")) } finally { setBusy('') }
  }

  const run = async (apply: boolean) => {
    if (!file) return toast.error('Choose the file first')
    const held = res?.totals?.pending ?? 0
    if (apply && !await ask(`Record these results as audits?\n\nThis saves a correct or wrong verdict for every field you have decided, and settles the reviewers' comments on them. No record is edited.${held ? `\n\n${held} field${held === 1 ? ' is' : 's are'} still to confirm and will not be recorded.` : ''}`, { confirmLabel: 'Record audits' })) return
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
  const submit = async (apply: boolean) => {
    if (!file) return
    if (apply && !await ask(`Submit the final records?\n\n• Each matched record takes your final values\n• A final record with no match is added\n• A delivered record it replaces is removed${approve ? '\n• The records and the sources are approved' : ''}\n\nThe earlier values are kept in the audit trail. Run Record as audits first if you have not: the scores keep the first-pass errors, but this Check will then show the records as matching.`, { confirmLabel: approve ? 'Submit and approve' : 'Submit', tone: 'warning' })) return
    setBusy(apply ? 'apply' : 'check')
    try {
      const r = await qualityApi.submitFinal(file, { apply, approve, projectId, sourceId })
      setSub(r)
      if (apply) toast.success(`Submitted: ${r.totals.records_updated} updated, ${r.totals.records_added} added, ${r.totals.records_removed} removed`)
    } catch (e) { toast.error(err(e, "Couldn't submit the final records")) } finally { setBusy('') }
  }
  const decide = (keys: string[], v: 'wrong' | 'right' | null) => setDec(d => { const n = { ...d }; keys.forEach(k => { if (v) n[k] = v; else delete n[k] }); return n })
  const t = res?.totals
  const rows: any[] = useMemo(() => {
    if (!res) return []
    const ql = q.trim().toLowerCase()
    let r = res.sources.filter((s: any) => !ql || (s.name + ' ' + s.extractor + ' ' + s.reviewers.join(' ')).toLowerCase().includes(ql))
    if (view === 'confirm') r = r.filter((s: any) => s.pending > 0)
    if (view === 'errors') r = r.filter((s: any) => s.wrong > 0)
    if (view === 'clean') r = r.filter((s: any) => s.wrong === 0 && s.pending === 0)
    return [...r].sort((a: any, b: any) => sort === 'accuracy' ? (a.accuracy_pct ?? 101) - (b.accuracy_pct ?? 101) : sort === 'errors' ? b.wrong - a.wrong : a.name.localeCompare(b.name))
  }, [res, q, view, sort])
  const firstHeld = res?.sources.find((s: any) => s.pending > 0)
  const counts = res ? { confirm: res.sources.filter((s: any) => s.pending > 0).length, errors: res.sources.filter((s: any) => s.wrong > 0).length, clean: res.sources.filter((s: any) => s.wrong === 0 && s.pending === 0).length } : { confirm: 0, errors: 0, clean: 0 }

  return (
    <div className="space-y-5">
      <Panel title="Check the final records" subtitle="Upload the zip or the all-records file. Sources and records are matched by name, and every field is compared with what the extractor delivered. Nothing is edited.">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".zip,.json" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null); setDec({}); setSub(null) }} aria-label="Final records file"
            className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          <Button onClick={() => run(false)} disabled={!file || !!busy}>{busy === 'check' ? 'Checking…' : 'Check'}</Button>
          <span className="flex-1" />
          {res && <Button variant="secondary" onClick={() => download('xlsx')} disabled={!!busy} title="Summary, per source, wrong fields, not fixed, held, SOP failures, reviewers and extractors">{busy === 'download' ? 'Preparing…' : 'Download Excel'}</Button>}
          {res && <Button variant="secondary" onClick={() => download('json')} disabled={!!busy}>JSON</Button>}
          {res && res.mode === 'preview' && <Button onClick={() => run(true)} disabled={!!busy} title="Saves each verdict you have decided, the same as marking the field in Review">{busy === 'apply' ? 'Recording…' : 'Record as audits'}</Button>}
        </div>
        {sourceId && <p className="text-xs text-gray-500 mt-2 mb-0">A single list of records will be checked against the source picked above.</p>}
      </Panel>

      {!res ? <Blank title="Nothing checked yet" text="Choose the file, then press Check. You will see the error % and accuracy % before anything is saved." /> : (
        <>
          {res.mode === 'applied' && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm">
              <b>Recorded.</b> {res.applied.written} verdict{res.applied.written === 1 ? '' : 's'} saved, {res.applied.already_recorded} were already recorded{res.applied.held ? `, ${res.applied.held} held back until you decide them` : ''}.
              The Scores tab now includes these. {res.applied.skipped?.length > 0 && <span className="text-amber-800">{res.applied.skipped.length} could not be saved: {res.applied.skipped.slice(0, 4).map((s: any) => `${s.field} (${s.why})`).join('; ')}.</span>}
            </div>
          )}

          <section aria-label="Result" className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)] gap-4">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-card p-5 flex flex-col">
              <p className="m-0 text-xs font-semibold text-gray-500">Accuracy</p>
              <p className="m-0 mt-1 flex items-baseline gap-2"><span className={`text-5xl font-extrabold tabular-nums leading-none ${t.accuracy_pct === null ? 'text-gray-300' : t.accuracy_pct >= 95 ? 'text-emerald-600' : t.accuracy_pct >= 85 ? 'text-amber-600' : 'text-red-600'}`}>{pc(t.accuracy_pct)}</span>
                <span className="text-sm text-gray-500">error rate {pc(t.error_pct)}</span></p>
              <Mix className="mt-4 h-3" correct={t.correct} admin={t.admin_changes} held={t.pending} wrong={t.wrong} />
              <div className="mt-2"><Legend /></div>
              <p className="m-0 mt-3 text-xs text-gray-500 leading-relaxed">{t.fields} fields compared across {t.sources} sources and {t.records} matched records. {t.wrong} extractor error{t.wrong === 1 ? '' : 's'}, {t.admin_changes} change{t.admin_changes === 1 ? '' : 's'} of yours, {t.pending} still to confirm.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
              <Tile label="Extractor errors" value={t.wrong} tone={t.wrong ? 'red' : 'green'} hint={`${t.not_fixed ? `${t.not_fixed} not fixed. ` : ''}${t.unmatched_fields ? `${t.unmatched_fields} in records with no final match.` : 'Wrong, unsupported or missing'}`} />
              <Tile label="To confirm" value={t.pending} tone={t.pending ? 'amber' : 'green'} hint="Held. Decide each one" onClick={t.pending ? () => { setView('confirm'); if (firstHeld) setOpen(o => ({ ...o, [firstHeld.source_id]: true })) } : undefined} />
              <Tile label="Your changes" value={t.admin_changes} tone="blue" hint="Extractor was right. Not held against them" />
              <Tile label="SOP failures" value={t.sop_failures} tone={t.sop_failures ? 'amber' : 'green'} hint="In your final records" />
              <Tile label="Reviewer catch rate" value={t.reviewer_flags === 0 ? '–' : pc(t.catch_rate)} tone={t.reviewer_flags === 0 ? 'gray' : accTone(t.catch_rate)} hint={t.reviewer_flags === 0 ? 'No field-level flags were found' : `${t.caught + (t.fixed ?? 0)} caught${t.fixed ? ` (${t.fixed} fixed after review)` : ''}, ${t.escaped} got through`} />
              <Tile label="False alarms" value={t.false_alarms} tone={t.false_alarms ? 'amber' : 'green'} hint="Flagged by a reviewer, but right" />
            </div>
          </section>

          {t.pending > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex items-center gap-3 flex-wrap">
              <span className="flex-1 min-w-[220px]"><b>{t.pending} field{t.pending === 1 ? '' : 's'} to confirm</b> in {counts.confirm} source{counts.confirm === 1 ? '' : 's'}. They are held: not counted as errors and nothing is recorded until you decide each one.</span>
              <Button size="sm" variant="secondary" onClick={() => { setView('confirm'); if (firstHeld) setOpen(o => ({ ...o, [firstHeld.source_id]: true })) }}>Show them</Button>
            </div>
          )}

          <Panel title="By source" subtitle="Open a source to see its errors, your changes and the fields to confirm." flush>
            <div className="flex items-center gap-2 flex-wrap px-4 pt-3 pb-3 border-b border-gray-50">
              {([['all', `All ${res.sources.length}`], ['confirm', `To confirm ${counts.confirm}`], ['errors', `With errors ${counts.errors}`], ['clean', `Clean ${counts.clean}`]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                  className={`text-xs font-semibold rounded-lg border px-2.5 py-1 ${view === k ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
              ))}
              <span className="flex-1" />
              <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort sources" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-transparent text-gray-700">
                <option value="name">Sort: name</option><option value="accuracy">Sort: lowest accuracy</option><option value="errors">Sort: most errors</option>
              </select>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search source or person" aria-label="Search sources" className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-brand-200 bg-transparent" />
            </div>
            {rows.length === 0 && <p className="m-0 px-5 py-6 text-sm text-gray-400">No sources match.</p>}
            <ul className="m-0 p-0 list-none divide-y divide-gray-50">
              {rows.map((s: any) => (
                <li key={s.source_id}>
                  <button type="button" onClick={() => setOpen(o => ({ ...o, [s.source_id]: !o[s.source_id] }))} aria-expanded={!!open[s.source_id]}
                    className="w-full grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_minmax(120px,1fr)_auto_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-gray-50">
                    <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900 truncate">{open[s.source_id] ? '▾' : '▸'} {s.name}</span>
                      <span className="block text-xs text-gray-500 truncate">{s.extractor}{s.reviewers.length ? ` · reviewed by ${s.reviewers.join(', ')}` : ''}</span></span>
                    <Mix className="hidden md:flex" correct={s.correct} admin={s.admin_changes} held={s.pending} wrong={s.wrong} />
                    <span className="flex items-center gap-1.5 justify-end flex-wrap">
                      {s.wrong > 0 && <Chip tone="red" title="Extractor errors">{s.wrong} error{s.wrong === 1 ? '' : 's'}</Chip>}
                      {s.pending > 0 && <Chip tone="amber" title="Fields to confirm">{s.pending} to confirm</Chip>}
                      {s.admin_changes > 0 && <Chip tone="blue" title="Your changes">{s.admin_changes} yours</Chip>}
                      {s.sop_failures > 0 && <Chip tone="gray" title="SOP failures in the final records">{s.sop_failures} SOP</Chip>}
                    </span>
                    <span className="justify-self-end"><Chip tone={accTone(s.accuracy_pct)}>{pc(s.accuracy_pct)}</Chip></span>
                  </button>
                  {open[s.source_id] && (
                    <div className="px-4 pb-4 bg-gray-50">
                      <p className="m-0 pt-3 text-xs text-gray-500">{s.fields} fields · {s.correct} correct · {s.caught + (s.fixed ?? 0)} caught by reviewers · {s.escaped} got through · {s.false_alarms} false alarm{s.false_alarms === 1 ? '' : 's'} · reviewer flags found: {s.reviewer_flags}</p>
                      {s.wrong_fields.length === 0 && s.false_alarm_fields.length === 0 && (s.unmatched_scored ?? []).length === 0 && <p className="m-0 py-2 text-sm text-emerald-700">Every field matches the final record.</p>}
                      {s.pending > 0 && (
                        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-gray-600">
                          <span>{s.pending} to confirm in this source:</span>
                          <button type="button" className="font-semibold rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100" onClick={() => decide(s.wrong_fields.filter((w: any) => w.decision === 'pending').map((w: any) => w.key), 'wrong')}>All extractor wrong</button>
                          <button type="button" className="font-semibold rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100" onClick={() => decide(s.wrong_fields.filter((w: any) => w.decision === 'pending').map((w: any) => w.key), 'right')}>All extractor right</button>
                        </div>
                      )}
                      {s.wrong_fields.length > 0 && (
                        <div className="mt-2 overflow-x-auto"><table className="w-full text-[13px] border-collapse">
                          <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Record</th><th className="pr-3">Field</th><th className="pr-3">Extractor delivered</th><th className="pr-3">Final</th><th className="pr-3">Flagged by</th><th className="pr-3">Result</th><th>Your call</th></tr></thead>
                          <tbody>{s.wrong_fields.map((w: any, i: number) => (
                            <tr key={i} className="border-t border-gray-100 align-top">
                              <td className="py-1.5 pr-3 text-gray-700">{w.record}</td>
                              <td className="pr-3"><span className="font-mono text-[12px]">{w.field}</span>{w.not_fixed && <div className="mt-0.5"><Chip tone="red">Not fixed</Chip></div>}<div className="mt-0.5 text-[11px] text-gray-500 max-w-[200px]">{w.reason}</div></td>
                              <td className="pr-3 text-gray-700 break-words max-w-[240px]">{show(w.extractor_value)}</td>
                              <td className="pr-3 text-gray-900 break-words max-w-[240px]">{show(w.final_value)}</td>
                              <td className="pr-3 text-gray-700">{w.flagged_by.length ? w.flagged_by.join(', ') : w.system_flagged ? 'System check' : '—'}</td>
                              <td className="pr-3"><Chip tone={w.outcome === 'caught' ? 'green' : w.outcome === 'escaped' ? 'red' : w.outcome === 'admin_change' ? 'blue' : 'amber'}>{w.outcome === 'caught' ? 'Error, caught' : w.outcome === 'escaped' ? 'Error, got through' : w.outcome === 'admin_change' ? 'Your change' : 'To confirm'}</Chip></td>
                              <td className="whitespace-nowrap">
                                {w.not_fixed ? <button type="button" onClick={() => decide([w.key], 'right')} title="Replace your earlier Wrong verdict with Correct"
                                  className="text-xs font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 px-2 py-1">Overrule: extractor right</button> : <>
                                  <button type="button" onClick={() => decide([w.key], w.decision === 'wrong' ? null : 'wrong')} aria-pressed={w.decision === 'wrong'}
                                    className={`text-xs font-semibold rounded-md border px-2 py-1 mr-1 ${w.decision === 'wrong' ? 'bg-red-600 text-white border-red-600' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>Extractor wrong</button>
                                  <button type="button" onClick={() => decide([w.key], w.decision === 'right' ? null : 'right')} aria-pressed={w.decision === 'right'}
                                    className={`text-xs font-semibold rounded-md border px-2 py-1 ${w.decision === 'right' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>Extractor right</button></>}
                              </td>
                            </tr>))}</tbody>
                        </table></div>
                      )}
                      {(s.unmatched_scored ?? []).length > 0 && (
                        <div className="mt-3"><p className="m-0 text-xs font-semibold text-red-700">Delivered records with no final record (every field scored as wrong unless you overrule it)</p>
                          {s.unmatched_scored.map((u: any) => (
                            <div key={u.key} className="flex items-center gap-2 flex-wrap text-[13px] text-gray-700 py-0.5">
                              <span><b>{u.record}</b>, {u.fields} fields{u.replaced_by.length ? `. Replaced by: ${u.replaced_by.join(', ')}` : ''}</span>
                              <button type="button" onClick={() => decide([u.key], u.decision === 'right' ? null : 'right')} aria-pressed={u.decision === 'right'}
                                className={`text-xs font-semibold rounded-md border px-2 py-1 ${u.decision === 'right' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>Not an error</button>
                            </div>))}
                        </div>
                      )}
                      {(s.sop_failure_list ?? []).length > 0 && (
                        <div className="mt-3"><p className="m-0 text-xs font-semibold text-amber-800">SOP failures in your final records (not counted as extractor errors)</p>
                          {s.sop_failure_list.slice(0, 40).map((f: any, i: number) => <p key={i} className="m-0 text-[13px] text-gray-700"><span className="font-mono text-[12px]">{f.field}</span> on {f.record}: {f.rule}. {f.why}</p>)}
                        </div>
                      )}
                      {(s.fixed_fields ?? []).length > 0 && (
                        <div className="mt-3"><p className="m-0 text-xs font-semibold text-emerald-700">Fixed after review (reviewer caught it, extractor corrected it)</p>
                          {s.fixed_fields.map((f: any, i: number) => <p key={i} className="m-0 text-[13px] text-gray-700"><span className="font-mono text-[12px]">{f.field}</span> on {f.record}: {f.flagged_by} flagged {show(f.was)}; now {show(f.now)}.</p>)}
                        </div>
                      )}
                      {s.false_alarm_fields.length > 0 && (
                        <div className="mt-3"><p className="m-0 text-xs font-semibold text-amber-800">False alarms (flagged, but right)</p>
                          {s.false_alarm_fields.map((f: any, i: number) => <p key={i} className="m-0 text-[13px] text-gray-700"><span className="font-mono text-[12px]">{f.field}</span> on {f.record}: flagged by {f.flagged_by.join(', ')}. Value: {show(f.value)}</p>)}
                        </div>
                      )}
                      {(s.key_records_unmatched.length > 0 || s.extractor_records_unmatched.length > 0) && (
                        <p className="m-0 mt-3 text-xs text-amber-800">
                          {s.key_records_unmatched.length > 0 && <>Final records with no match: {s.key_records_unmatched.join(', ')}. </>}
                          {s.extractor_records_unmatched.length > 0 && <>Delivered records with no match (scored as wrong unless overruled): {s.extractor_records_unmatched.join(', ')}.</>}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Extractors" subtitle="How each person's deliveries compare with your final records.">
              <ul className="m-0 p-0 list-none space-y-3">
                {res.extractors.map((e: any) => (
                  <li key={e.name} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-gray-900">{e.name}</span><span className="flex items-baseline gap-2"><span className="text-xs text-gray-500">{e.sources} source{e.sources === 1 ? '' : 's'} · {e.fields} fields</span><Chip tone={accTone(e.accuracy_pct)}>{pc(e.accuracy_pct)}</Chip></span></div>
                    <Mix className="mt-2" correct={e.correct} admin={e.admin_changes} held={e.pending} wrong={e.wrong} />
                    <p className="m-0 mt-2 text-xs text-gray-600 flex gap-x-4 gap-y-0.5 flex-wrap">
                      <span><b className="tabular-nums">{e.wrong}</b> errors{e.not_fixed ? ` (${e.not_fixed} not fixed)` : ''}</span>
                      <span><b className="tabular-nums">{e.admin_changes}</b> your changes</span>
                      <span><b className="tabular-nums">{e.pending}</b> to confirm</span>
                      {e.sop_failures > 0 && <span><b className="tabular-nums">{e.sop_failures}</b> SOP</span>}
                    </p>
                  </li>))}
              </ul>
              <div className="mt-3"><Legend /></div>
            </Panel>
            <Panel title="Reviewers" subtitle="Errors on their sources: how many they flagged and how many they missed.">
              <ul className="m-0 p-0 list-none space-y-3">
                {res.reviewers.map((r: any) => {
                  const tot = Math.max(1, r.errors_on_their_sources)
                  return (
                    <li key={r.name} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-gray-900">{r.name}</span>
                        {r.flags === 0 ? <Chip tone="gray" title="This reviewer raised no field-level flag, so there is nothing to score">No flags</Chip> : <Chip tone={accTone(r.catch_rate)}>{pc(r.catch_rate)} caught</Chip>}</div>
                      <span className="flex h-2 rounded-full overflow-hidden bg-gray-100 mt-2" role="img" aria-label={`${r.caught} caught, ${r.missed} missed`}>
                        {r.caught > 0 && <span className="bg-emerald-500" style={{ width: `${(100 * r.caught) / tot}%` }} />}{r.missed > 0 && <span className="bg-red-500" style={{ width: `${(100 * r.missed) / tot}%` }} />}
                      </span>
                      <p className="m-0 mt-2 text-xs text-gray-600 flex gap-x-4 gap-y-0.5 flex-wrap">
                        <span><b className="tabular-nums">{r.caught}</b> caught</span><span><b className="tabular-nums">{r.missed}</b> missed</span>
                        <span><b className="tabular-nums">{r.false_alarms}</b> false alarm{r.false_alarms === 1 ? '' : 's'}</span><span>{r.sources} source{r.sources === 1 ? '' : 's'}</span>
                        {r.flags > 0 && <span>precision {pc(r.precision)}</span>}
                      </p>
                    </li>)
                })}
              </ul>
              <p className="m-0 mt-3 text-[11px] text-gray-500">Missed counts every error on their sources they did not flag, including where they passed it as fine. "No flags" means they raised nothing on a specific field, so the rate is not scored.</p>
            </Panel>
          </div>

          <Panel title="Submit the final records" subtitle="Put your final records on the platform and clear the sources. Do this after Record as audits, so the scores are saved first.">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer"><input type="checkbox" checked={approve} onChange={e => { setApprove(e.target.checked); setSub(null) }} /> Also approve the records and the sources</label>
              <span className="flex-1" />
              <Button variant="secondary" onClick={() => submit(false)} disabled={!!busy}>See what will change</Button>
              <Button onClick={() => submit(true)} disabled={!!busy || !sub || sub.mode === 'applied'}>{sub?.mode === 'applied' ? 'Submitted' : 'Submit final records'}</Button>
            </div>
            {sub && (
              <div className="mt-3 space-y-2">
                <p className="m-0 text-sm text-gray-800">{sub.mode === 'applied' ? <b>Submitted. </b> : <b>This would change: </b>}{sub.totals.records_updated} record{sub.totals.records_updated === 1 ? '' : 's'} updated ({sub.totals.fields_changed} fields), {sub.totals.records_added} added, {sub.totals.records_removed} removed, {sub.totals.records_unchanged} already match{sub.approve ? `, ${sub.sources.length} source${sub.sources.length === 1 ? '' : 's'} approved` : ''}.</p>
                <ul className="m-0 p-0 list-none divide-y divide-gray-50 text-[13px]">
                  {sub.sources.map((x: any) => (
                    <li key={x.source_id} className="py-1.5 flex items-start gap-3 flex-wrap">
                      <span className="font-semibold text-gray-900 min-w-[200px]">{x.name}</span>
                      <span className="text-gray-600 flex-1 min-w-[220px]">
                        {x.records_updated + x.records_added.length + x.records_removed.length === 0 ? 'Already matches.' : <>
                          {x.records_updated > 0 && <>{x.records_updated} updated ({x.fields_changed} fields). </>}
                          {x.records_added.length > 0 && <>Added: {x.records_added.join(', ')}. </>}
                          {x.records_removed.length > 0 && <>Removed: {x.records_removed.join(', ')}. </>}</>}
                        {x.records_left.length > 0 && <span className="text-amber-700"> Left in place (no final record replaces them): {x.records_left.join(', ')}.</span>}
                      </span>
                      {x.approved && <Chip tone="green">Approved</Chip>}
                    </li>))}
                </ul>
                {sub.unmatched_sources.length > 0 && <p className="m-0 text-xs text-amber-800">Not matched to a source, so not submitted: {sub.unmatched_sources.join(', ')}</p>}
              </div>
            )}
          </Panel>

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
