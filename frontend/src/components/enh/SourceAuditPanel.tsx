import { useMemo, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Chip, type Tone } from '@/components/enh/kit'
import { Button, cn, toast } from '@/components/ui'

// Audit against the live site: every field of every record is checked against the pages the records cite,
// using the SOP rules. It only suggests. The reviewer applies what they agree with.

type Row = {
  record_id: string; record: string; field: string; delivered: unknown; verdict: 'CORRECT' | 'WRONG' | 'HOLD'; error_kind: string | null; source_says: string | null
  comment: string; proof: { url: string | null; quote: string | null } | null; flag_status: string; caught_by: string[]; caught_by_ids: string[]; missed_by: string[]; pattern: string
}
const KIND_LABEL: Record<string, string> = { wrong_value: 'Wrong value', missing_value: 'Missing value', unsupported_value: 'Not in the source', format: 'Format', sop_rule: 'SOP rule', schema: 'Schema', duplicate: 'Duplicate', other: 'Other' }
const VERDICT: Record<string, { label: string; tone: Tone }> = { CORRECT: { label: 'Suggests correct', tone: 'green' }, WRONG: { label: 'Suggests wrong', tone: 'red' }, HOLD: { label: 'Hold', tone: 'amber' } }
const DECISION: Record<string, { label: string; tone: Tone; text: string }> = {
  'SEND BACK': { label: 'Send back', tone: 'red', text: 'At least one field is wrong. Add your comments first, then use Return for correction, because sending back resets the peer reviews.' },
  HOLD: { label: 'Hold', tone: 'amber', text: 'Nothing is proven wrong, but some fields depend on something you must confirm (an SOP version, a page that would not load, or a weak match). Do not approve yet.' },
  APPROVE: { label: 'Approve', tone: 'green', text: 'Every field checked out against the live pages that could be read.' },
}
const flagTone = (s: string): Tone => (s.startsWith('VALID') ? 'green' : s.startsWith('NOT FLAGGED') ? 'red' : s.startsWith('FALSE') ? 'amber' : s.startsWith('STALE') ? 'blue' : 'gray')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d

export type AuditRow = Row

/** The one place a suggestion becomes a rating. The admin has looked and agreed, so this is the confirmation. */
export async function applyAuditRow(r: Row) {
  if (r.verdict === 'WRONG') await qualityApi.mark({ record_id: r.record_id, field: r.field, verdict: 'incorrect', truth_value: r.source_says || undefined, note: r.comment, category: r.error_kind || 'wrong_value', severity: 'major', credit: r.caught_by_ids })
  else if (r.verdict === 'CORRECT') await qualityApi.mark({ record_id: r.record_id, field: r.field, verdict: 'correct' })
  else await qualityApi.comment({ record_id: r.record_id, field: r.field, comment: `Audit hold: ${r.comment}` })
}

type Filter = 'all' | 'WRONG' | 'HOLD' | 'unflagged' | 'false'

export function SourceAuditPanel({ sourceId, nimbleReady, result: res, onResult: setRes, onApplied, onJump, onClose }: {
  sourceId: string; nimbleReady: boolean; result: any; onResult: (r: any) => void; onApplied: () => void; onJump: (recordId: string, field: string) => void; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [render, setRender] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [applying, setApplying] = useState<string>('')
  const [done, setDone] = useState<Record<string, boolean>>({})

  const run = async () => {
    setBusy(true); setDone({})
    try { setRes(await qualityApi.sourceAudit({ source_id: sourceId, render })) } catch (e) { toast.error(err(e, 'The audit could not run')) } finally { setBusy(false) }
  }
  const key = (r: Row) => r.record_id + '|' + r.field
  const rows: Row[] = res?.rows ?? []
  const shown = useMemo(() => rows.filter(r => filter === 'all' ? true : filter === 'WRONG' ? r.verdict === 'WRONG' : filter === 'HOLD' ? r.verdict === 'HOLD' : filter === 'unflagged' ? r.flag_status === 'NOT FLAGGED' : r.flag_status.startsWith('FALSE')), [rows, filter])
  const byRecord = useMemo(() => {
    const m = new Map<string, { name: string; rows: Row[] }>()
    shown.forEach(r => { if (!m.has(r.record_id)) m.set(r.record_id, { name: r.record, rows: [] }); m.get(r.record_id)!.rows.push(r) })
    return [...m.entries()].sort((a, b) => b[1].rows.filter(x => x.verdict === 'WRONG').length - a[1].rows.filter(x => x.verdict === 'WRONG').length)
  }, [shown])

  const apply = applyAuditRow
  const applyOne = async (r: Row) => {
    setApplying(key(r))
    try { await apply(r); setDone(d => ({ ...d, [key(r)]: true })); onApplied(); toast.success(r.verdict === 'HOLD' ? 'Note saved on the field' : `Confirmed ${r.verdict === 'WRONG' ? 'wrong' : 'correct'}. It now counts in the ratings.`) } catch (e) { toast.error(err(e, 'Could not apply that one')) } finally { setApplying('') }
  }
  const download = () => {
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'source-audit.json'; a.click(); URL.revokeObjectURL(a.href)
  }
  const copy = (text: string, msg: string) => navigator.clipboard?.writeText(text).then(() => toast.success(msg)).catch(() => toast.error('Copy failed'))

  const dec = res ? DECISION[res.decision] : null
  const c = res?.counts
  return (
    <section className="rounded-2xl border border-brand-200 bg-white" aria-label="Audit against the live site">
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 m-0">Audit against the live site</h2>
        <span className="text-xs text-gray-500">Reads the pages the records cite and checks every field against the SOP. It only suggests. Nothing counts until you confirm each field.</span>
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-600 flex items-center gap-1" title="Slower. Use it for sites that build their pages with JavaScript."><input type="checkbox" checked={render} onChange={e => setRender(e.target.checked)} />Render pages</label>
          <Button size="sm" disabled={busy || !nimbleReady} onClick={run} title={nimbleReady ? 'Fetch the cited pages and check every field' : 'Add NIMBLE_API_KEY in the server settings to turn this on'}>{busy ? 'Reading the pages…' : res ? 'Run again' : 'Run the audit'}</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </span>
      </div>

      {!res && !busy && <p className="px-4 py-6 text-sm text-gray-500 m-0">Run the audit to get Correct, Wrong or Hold for every field, with the exact text from the page as proof. Fields it cannot prove either way are put on Hold, never marked wrong.</p>}
      {busy && <p className="px-4 py-6 text-sm text-gray-500 m-0" role="status">Reading the cited pages. This can take a minute for sites that are slow to load.</p>}

      {res && dec && (
        <div className="p-4 space-y-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">Suggested decision</span><Chip tone={dec.tone}>{dec.label}</Chip>
              <span className="text-xs text-gray-500 tabular-nums">{c.fields} fields · {c.correct} correct · {c.wrong} wrong · {c.hold} on hold</span>
              {res.sop_code && <Chip tone="indigo">{res.sop_code}</Chip>}
            </div>
            <p className="text-sm text-gray-700 m-0">{dec.text}</p>
            <p className="text-sm font-semibold text-gray-900 m-0">These are suggestions. A field only counts in the accuracy and error ratings after you confirm it, one field at a time.</p>
            <p className="text-xs text-gray-500 m-0">{res.version_note}</p>
          </div>

          {res.patterns?.some((p: any) => p.count > 1) && (
            <div className="text-sm text-gray-700"><b>Repeated defects.</b> One pattern is not many separate mistakes:
              <ul className="m-0 mt-1 pl-5 list-disc">{res.patterns.filter((p: any) => p.count > 1).map((p: any) => <li key={p.field + p.pattern}>{p.field}: {p.pattern.replace(/_/g, ' ')} on {p.count} records</li>)}</ul>
            </div>
          )}

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>Not scanned, so not proven.</b>
            <ul className="m-0 mt-1 pl-5 list-disc">{res.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {([['all', `All (${rows.length})`], ['WRONG', `Wrong (${c.wrong})`], ['HOLD', `Hold (${c.hold})`], ['unflagged', `Nobody flagged (${c.not_flagged})`], ['false', `False flags (${c.false_positive})`]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', filter === k ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>{label}</button>
            ))}
            <span className="ml-auto flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-600 tabular-nums" aria-live="polite">{Object.keys(done).length} of {rows.length} confirmed by you</span>
              <Button size="sm" variant="secondary" onClick={download} title="The full audit as JSON, one record per field">Download JSON</Button>
            </span>
          </div>

          <div className="space-y-3">
            {byRecord.length === 0 && <p className="text-sm text-gray-500 m-0">Nothing matches this filter.</p>}
            {byRecord.map(([rid, g]) => (
              <details key={rid} open={g.rows.some(x => x.verdict !== 'CORRECT')} className="rounded-xl border border-gray-100">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">{g.name}
                  <span className="text-xs font-normal text-gray-500 tabular-nums">{g.rows.filter(x => x.verdict === 'WRONG').length} wrong · {g.rows.filter(x => x.verdict === 'HOLD').length} hold · {g.rows.filter(x => x.verdict === 'CORRECT').length} correct</span></summary>
                <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                  {g.rows.map(r => (
                    <li key={key(r)} className="px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" className="text-sm font-bold text-gray-900 hover:underline" onClick={() => onJump(r.record_id, r.field)} title="Open this field in the desk">{r.field}</button>
                        <Chip tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Chip>
                        {r.error_kind && <Chip tone="gray">{KIND_LABEL[r.error_kind] ?? r.error_kind}</Chip>}
                        {r.flag_status && <Chip tone={flagTone(r.flag_status)} title={r.caught_by.length ? `Pointed at by ${r.caught_by.join(', ')}` : undefined}>{r.flag_status}{r.caught_by.length ? `: ${r.caught_by.join(', ')}` : ''}</Chip>}
                        {r.verdict === 'WRONG' && r.missed_by.length > 0 && <span className="text-[11px] text-gray-500">Missed by {r.missed_by.join(', ')}</span>}
                        <span className="ml-auto flex items-center gap-1.5">{done[key(r)] ? <Chip tone="green">Confirmed by you</Chip> : <>
                          <Button size="sm" variant="secondary" disabled={!!applying} onClick={() => onJump(r.record_id, r.field)} title="Open the field in the desk, look at the source yourself and mark it your way">Check myself</Button>
                          <Button size="sm" disabled={!!applying} onClick={() => applyOne(r)} title={r.verdict === 'HOLD' ? 'Leave this as a comment on the field. It is not a rating.' : 'You have looked, and you agree. This is when it counts in the ratings.'}>{applying === key(r) ? 'Saving…' : r.verdict === 'HOLD' ? 'Save as note' : r.verdict === 'WRONG' ? 'Confirm wrong' : 'Confirm correct'}</Button></>}</span>
                      </div>
                      <p className="text-sm text-gray-700 m-0 break-words"><span className="text-gray-500">Delivered: </span>{show(r.delivered)}</p>
                      {r.source_says && <p className="text-sm text-gray-900 m-0 break-words"><span className="text-gray-500">Source says: </span>{r.source_says}</p>}
                      <p className="text-sm text-gray-600 m-0">{r.comment}</p>
                      {r.proof?.quote && (
                        <blockquote className="m-0 border-l-2 border-gray-200 pl-3 text-xs text-gray-600 break-words">“{r.proof.quote}”
                          {r.proof.url && <> <a href={r.proof.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{r.proof.url}</a></>}</blockquote>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          {(res.suggested_records.length > 0 || res.remove_records.length > 0) && (
            <div className="rounded-xl border border-gray-100 px-4 py-3 space-y-2">
              {res.suggested_records.length > 0 && <>
                <div className="flex items-center gap-2 flex-wrap"><b className="text-sm text-gray-900">Records the pages suggest adding ({res.suggested_records.length})</b>
                  <span className="text-xs text-gray-500">From the pages that were read only, one verbatim sentence each. Check before adding.</span>
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => copy(JSON.stringify(res.suggested_records, null, 2), 'Suggested records copied')}>Copy as JSON</Button></div>
                <ul className="m-0 pl-0 list-none space-y-1.5">{res.suggested_records.map((s: any) => (
                  <li key={s.segment_name} className="text-sm"><b>{s.segment_name}</b> <span className="text-gray-500">· </span><span className="text-gray-700">“{s.evidence}”</span> <a href={s.source_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">{s.source_url}</a></li>
                ))}</ul>
              </>}
              {res.remove_records.length > 0 && <p className="text-sm text-gray-700 m-0"><b>Remove:</b> {res.remove_records.length} record{res.remove_records.length === 1 ? '' : 's'} whose segment is a platform, service or duplicate, and the pages name nothing to replace it with.</p>}
            </div>
          )}

          <div className="rounded-xl border border-gray-100 px-4 py-3 text-sm text-gray-700 space-y-1">
            <b className="text-gray-900">Who owns the errors</b>
            <p className="m-0">Extractor {res.attribution.extractor || '(not assigned)'}: {res.attribution.errors} error field{res.attribution.errors === 1 ? '' : 's'}. {res.attribution.nobody_caught} caught by nobody.</p>
            {res.attribution.peers.map((p: any) => <p key={p.id} className="m-0 text-xs text-gray-600">{p.name}: pointed at {p.caught}, missed {p.missed}</p>)}
            <p className="m-0 text-xs text-gray-500">Holds are not errors. A false flag counts against the reviewer's precision, not the extractor.</p>
          </div>

          <details className="text-xs text-gray-500"><summary className="cursor-pointer">Pages read ({res.pages.length})</summary>
            <ul className="m-0 mt-1 pl-5 list-disc">{res.pages.map((p: any) => <li key={p.url}>{p.ok ? 'Read' : 'Could not read'}: {p.url}{p.error ? ` (${p.error})` : ''}{p.final_url && p.final_url !== p.url ? ` → ${p.final_url}` : ''}</li>)}</ul></details>
        </div>
      )}
    </section>
  )
}
