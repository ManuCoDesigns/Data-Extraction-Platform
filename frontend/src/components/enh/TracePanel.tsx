import { useEffect, useState } from 'react'
import { briefsApi } from '@/api/briefs'
import { Button, toast } from '@/components/ui'

// Delivery trace: what we asked Xtrium and how long it took, the 5 working day batch clock, the days work really happened, and the times we sat waiting.
const TZ = 'Africa/Nairobi'
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '')
const fmtDay = (d?: string | null) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }) : '')
const local = (iso?: string | null) => {
  if (!iso) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
const days = (n?: number | null) => (n === null || n === undefined ? '–' : n < 0.05 ? 'under 2 hours' : n < 1 ? `${Math.round(n * 24)} h` : `${n} day${n === 1 ? '' : 's'}`)
const STATE: Record<string, { label: string; cls: string }> = {
  on_time: { label: 'On time', cls: 'bg-green-100 text-green-800' }, late: { label: 'Late', cls: 'bg-red-100 text-red-800' },
  open: { label: 'In progress', cls: 'bg-blue-100 text-blue-800' }, overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-800' },
  set_aside: { label: 'Set aside', cls: 'bg-amber-100 text-amber-800' },
}
const inp = 'border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white text-gray-900'

type EscForm = { id?: string; question: string; kind: string; blocks: boolean; source_id: string; raised: string; reply: string; answered: string }
const blank: EscForm = { question: '', kind: 'escalation', blocks: false, source_id: '', raised: '', reply: '', answered: '' }

export function TracePanel({ scope, value, projectId, onClose }: { scope: string; value?: string; projectId?: string; onClose: () => void }) {
  const [t, setT] = useState<any>(null)
  const [esc, setEsc] = useState<EscForm | null>(null)
  const [wf, setWf] = useState<{ kind: string; reason: string; from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => briefsApi.trace(scope, value, projectId).then(setT).catch(e => setT({ error: e?.response?.data?.detail || 'Could not read the trace. Try again in a moment.' }))
  useEffect(() => { setT(null); load() }, [scope, value, projectId])

  const sources: { id: string; label: string }[] = (t?.clock || []).flatMap((b: any) => b.items.map((s: any) => ({ id: s.source_id, label: `${s.item_no ? `#${s.item_no} ` : ''}${s.name}` })))
  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); await load() } catch (e: any) { toast.error(e?.response?.data?.detail || 'That did not save') } finally { setBusy(false) }
  }
  const download = async () => {
    try {
      const url = URL.createObjectURL(await briefsApi.traceXlsx(scope, value, projectId))
      const a = document.createElement('a'); a.href = url; a.download = `delivery_trace_${value || 'all'}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch { toast.error('Could not build the Excel file') }
  }
  const saveEsc = () => {
    if (!esc || !projectId) return
    const body: Record<string, any> = { question: esc.question, kind: esc.kind, blocks_clock: esc.blocks, raised_at: esc.raised || undefined, first_reply_at: esc.reply || undefined, answered_at: esc.answered || undefined }
    if (esc.id) run(() => briefsApi.editEscalation(esc.id!, body), 'Saved').then(() => setEsc(null))
    else run(() => briefsApi.addEscalation({ ...body, project_id: projectId, source_id: esc.source_id || undefined }), 'Logged').then(() => setEsc(null))
  }
  const saveWait = () => {
    if (!wf || !projectId) return
    run(() => briefsApi.addWait({ project_id: projectId, kind: wf.kind, reason: wf.reason, started_at: wf.from, ended_at: wf.to || undefined }), 'Logged').then(() => setWf(null))
  }

  if (!t) return <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-gray-800">Reading the trace from the platform.</div>
  if (t.error) return <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-gray-800 flex justify-between"><span>{t.error}</span><button className="text-xs underline" onClick={onClose}>Close</button></div>
  const S = t.escalations.summary
  const canLog = !!projectId

  return (
    <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-gray-800 grid gap-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <b>Delivery trace · {t.scope?.label}</b>
        <span className="flex items-center gap-3"><Button variant="secondary" onClick={download}>Download Excel</Button><button className="text-xs underline" onClick={onClose}>Close</button></span>
      </div>

      <section className="grid gap-2">
        <b>What we asked Xtrium</b>
        {S.questions_logged > 0 && <p className="m-0 text-xs text-gray-600">{S.questions_logged} other question{S.questions_logged === 1 ? '' : 's'} from the Questions page {S.questions_logged === 1 ? 'is' : 'are'} kept apart in the Excel file{S.untimed ? `; ${S.untimed} of them were answered later in one go, so their waits were never recorded` : ''}.</p>}
        <p className="m-0">{S.total} logged. {S.answered} answered ({S.within_2h} within 2 hours, {S.within_2d} within 2 days, {S.longer_than_2d} took longer). {S.open} open{S.longest_open_days ? `, the longest waiting ${days(S.longest_open_days)}` : ''}. {S.median_days !== null ? `Median wait ${days(S.median_days)}.` : ''}</p>
        <div className="grid gap-2">
          {t.escalations.items.map((r: any) => (
            <div key={r.id} className="bg-white rounded-lg border border-emerald-100 p-3 grid gap-1">
              <p className="m-0"><b>{r.item_no ? `#${r.item_no} ` : ''}{r.source ? `${r.source}: ` : ''}</b>{r.question}</p>
              <p className="m-0 text-gray-600">{r.kind}{r.blocks_clock ? ', stops the clock' : ''}. Raised {fmt(r.raised_at)}.{r.first_reply_at ? ` First reply ${fmt(r.first_reply_at)}.` : ''} {r.status === 'answered' ? `Answered ${fmt(r.answered_at)}, waited ${days(r.waited_days)} (${r.waited_working_days} working).` : `Not answered yet, waiting ${days(r.waited_days)} (${r.waited_working_days} working).`}</p>
              <div className="flex gap-3 text-xs">
                {r.status === 'open' && <button className="underline" disabled={busy} onClick={() => run(() => briefsApi.editEscalation(r.id, { answered_now: true }), 'Marked answered')}>Answered now</button>}
                {r.status === 'answered' && <button className="underline" disabled={busy} onClick={() => run(() => briefsApi.editEscalation(r.id, { reopen: true }), 'Reopened')}>Reopen</button>}
                <button className="underline" onClick={() => setEsc({ id: r.id, question: r.question, kind: r.kind, blocks: r.blocks_clock, source_id: r.source_id || '', raised: local(r.raised_at), reply: local(r.first_reply_at), answered: local(r.answered_at) })}>Edit times</button>
              </div>
            </div>
          ))}
        </div>
        {esc ? (
          <div className="bg-white rounded-lg border border-emerald-200 p-3 grid gap-2">
            <b>{esc.id ? 'Edit' : 'Log an escalation or question'}</b>
            <textarea className={inp} rows={2} placeholder="What was asked" value={esc.question} onChange={e => setEsc({ ...esc, question: e.target.value })} />
            <div className="flex flex-wrap gap-2 items-center">
              <select className={inp} value={esc.kind} onChange={e => setEsc({ ...esc, kind: e.target.value })}><option value="escalation">Escalation</option><option value="question">Question</option><option value="blocker">Blocker</option></select>
              {!esc.id && <select className={inp} value={esc.source_id} onChange={e => setEsc({ ...esc, source_id: e.target.value })}><option value="">No single source</option>{sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={esc.blocks} onChange={e => setEsc({ ...esc, blocks: e.target.checked })} /> Source cannot be worked until answered</label>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="grid gap-0.5 text-xs text-gray-600">Raised<input type="datetime-local" className={inp} value={esc.raised} onChange={e => setEsc({ ...esc, raised: e.target.value })} /></label>
              <label className="grid gap-0.5 text-xs text-gray-600">First reply<input type="datetime-local" className={inp} value={esc.reply} onChange={e => setEsc({ ...esc, reply: e.target.value })} /></label>
              <label className="grid gap-0.5 text-xs text-gray-600">Answered<input type="datetime-local" className={inp} value={esc.answered} onChange={e => setEsc({ ...esc, answered: e.target.value })} /></label>
            </div>
            <p className="m-0 text-xs text-gray-600">Times are Nairobi time, as shown in Slack. Leave Answered empty while Xtrium has not answered.</p>
            <div className="flex gap-2"><Button disabled={busy || !esc.question.trim() || (!esc.id && !canLog)} onClick={saveEsc}>Save</Button><Button variant="secondary" onClick={() => setEsc(null)}>Cancel</Button></div>
          </div>
        ) : <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={!canLog} onClick={() => setEsc({ ...blank })}>Log an escalation</Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(async () => { const r = await briefsApi.importSlack(projectId); toast.success(`${r.added} loaded (${r.linked} tied to their sources), ${r.removed} earlier ones replaced`) }, 'Slack escalations loaded')}>Load the Slack escalations</Button>{!canLog && <span className="ml-2 text-xs text-gray-600">Pick one project to log new items.</span>}</div>}
      </section>

      <section className="grid gap-2">
        <b>Batch clock: {t.clock[0]?.window_working_days ?? 5} working days from the pull to submission to Xtrium</b>
        {t.clock.length === 0 && <p className="m-0">No batches in this period.</p>}
        {t.clock.map((b: any) => (
          <div key={b.key} className="bg-white rounded-lg border border-emerald-100 p-3 grid gap-1.5">
            <p className="m-0"><b>{b.label}: {b.status}.</b> Pulled {b.pulled}, due {fmtDay(b.due)}{b.latest_due !== b.due ? ` (up to ${fmtDay(b.latest_due)} for sources that were paused)` : ''}. {b.submitted} of {b.counted} counted sources submitted{b.set_aside ? `, ${b.set_aside} set aside` : ''}{b.late ? `, ${b.late} late` : ''}.</p>
            {canLog && b.key && (
              <p className="m-0 text-xs text-gray-600 flex items-center gap-2">Count this batch as:
                <select className={inp} disabled={busy} defaultValue="" onChange={e => { const v = e.target.value; if (v === '') return; run(() => briefsApi.flagBatch({ project_id: projectId, batch_key: b.key, flag: v === 'normal' ? '' : v }), 'Saved'); e.target.value = '' }}>
                  <option value="">Change...</option><option value="normal">A normal batch</option><option value="test">Test sources (linking the tool)</option><option value="covered">Covered earlier through Google Drive</option>
                </select>
              </p>
            )}
            {b.items.map((s: any) => (
              <p key={s.source_id} className="m-0 flex flex-wrap gap-x-2 items-baseline">
                <span className={`text-xs px-1.5 py-0.5 rounded ${STATE[s.state]?.cls}`}>{STATE[s.state]?.label}</span>
                <span>{s.item_no ? `#${s.item_no} ` : ''}{s.name}</span>
                <span className="text-gray-600 text-xs">
                  {s.state === 'set_aside' ? s.reason : s.submitted_at ? `submitted ${fmt(s.submitted_at)}${s.late_working_days ? `, ${s.late_working_days} working days late` : ''}` : s.state === 'overdue' ? `due ${fmtDay(s.due)}, not submitted` : `due ${fmtDay(s.due)}, ${s.working_days_left} working days left`}
                  {s.paused_working_days ? ` · ${s.paused_working_days} working days paused while waiting` : ''}
                </span>
              </p>
            ))}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <b>Days work really happened (waiting left out)</b>
        {t.active.by_size.length === 0 ? <p className="m-0">No delivered sources with logged work in this period yet.</p> : t.active.by_size.map((z: any) => (
          <p key={z.size} className="m-0"><b>{z.size} ({z.records} records):</b> {z.sources} source{z.sources === 1 ? '' : 's'}, average {z.avg_active_days} active days (median {z.median_active_days}, most {z.max_active_days}) and about {z.avg_logged_hours} logged hours. Between first and last work there were on average {z.avg_span_working_days} working days, of which {z.avg_idle_working_days} had no work logged.</p>
        ))}
        {t.active.all.sources > 0 && <p className="m-0">All delivered sources: {t.active.all.sources}, average {t.active.all.avg_active_days} active days.</p>}
        <p className="m-0 text-xs text-gray-600">{t.active.caveat} Per-source detail is in the Excel file.</p>
      </section>

      <section className="grid gap-2">
        <b>Times we could not work{t.waits.items.length ? `: ${t.waits.working_days} working days logged` : ''}</b>
        {t.waits.items.map((w: any) => (
          <p key={w.id} className="m-0 flex flex-wrap gap-x-2 items-baseline">
            <span>{w.reason}</span>
            <span className="text-gray-600 text-xs">{w.kind}, {fmt(w.started_at)} to {w.open ? 'still waiting' : fmt(w.ended_at)}, {days(w.days)} ({w.working_days} working)</span>
            {w.open && <button className="underline text-xs" disabled={busy} onClick={() => run(() => briefsApi.editWait(w.id, { end_now: true }), 'Ended')}>End now</button>}
            <button className="underline text-xs" disabled={busy} onClick={() => run(() => briefsApi.deleteWait(w.id), 'Removed')}>Remove</button>
          </p>
        ))}
        {wf ? (
          <div className="bg-white rounded-lg border border-emerald-200 p-3 grid gap-2">
            <div className="flex flex-wrap gap-2">
              <select className={inp} value={wf.kind} onChange={e => setWf({ ...wf, kind: e.target.value })}><option value="links">No links assigned</option><option value="decision">Waiting for a decision</option><option value="access">Waiting for access</option><option value="other">Other</option></select>
              <input className={`${inp} flex-1 min-w-[220px]`} placeholder="What we were waiting for" value={wf.reason} onChange={e => setWf({ ...wf, reason: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="grid gap-0.5 text-xs text-gray-600">From<input type="datetime-local" className={inp} value={wf.from} onChange={e => setWf({ ...wf, from: e.target.value })} /></label>
              <label className="grid gap-0.5 text-xs text-gray-600">To (empty while still waiting)<input type="datetime-local" className={inp} value={wf.to} onChange={e => setWf({ ...wf, to: e.target.value })} /></label>
            </div>
            <div className="flex gap-2"><Button disabled={busy || !wf.reason.trim() || !wf.from} onClick={saveWait}>Save</Button><Button variant="secondary" onClick={() => setWf(null)}>Cancel</Button></div>
          </div>
        ) : <div><Button variant="secondary" disabled={!canLog} onClick={() => setWf({ kind: 'links', reason: '', from: '', to: '' })}>Log a waiting period</Button></div>}
      </section>
    </div>
  )
}
