import { useCallback, useEffect, useState } from 'react'
import { challengeApi, type Challenge, type Counts } from '@/api/auditChallenges'
import { Blank, Chip, Panel, type Tone } from '@/components/enh/kit'
import { Button, cn, toast } from '@/components/ui'

/**
 * Checked fields sent back to the extractor. The admin's verdict is copied onto each one when it is sent and never changed by a reply.
 * The extractor confirms it ("the admin is right") or disagrees with a finding, an optional link and an optional SOP reference.
 * Only an admin ruling of "the extractor is right" changes the audit itself.
 */

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const err = (e: any, d: string) => e?.response?.data?.detail || d
const STATUS: Record<Challenge['status'], { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting for the extractor', tone: 'amber' },
  agreed: { label: 'Extractor agrees', tone: 'green' },
  disputed: { label: 'Extractor disagrees', tone: 'red' },
  settled: { label: 'Settled', tone: 'gray' },
}

function sopLine(h: Challenge['sop_hint']): string {
  if (!h) return ''
  const bits = [h.sop_code, h.section, h.required ? 'required' : '', h.type, h.format ? `format ${h.format}` : '', Array.isArray(h.allowed) && h.allowed.length ? `allowed: ${h.allowed.slice(0, 8).join(', ')}` : ''].filter(Boolean)
  return bits.join(' · ')
}

export function ChallengeCard({ c, canRespond, canRule, showSource, onChanged }: { c: Challenge; canRespond: boolean; canRule: boolean; showSource?: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'disagree' | 'rule'>('')
  const [finding, setFinding] = useState(c.finding ?? '')
  const [url, setUrl] = useState(c.evidence_url ?? '')
  const [sop, setSop] = useState(c.sop_ref ?? '')
  const [rnote, setRnote] = useState('')
  const [busy, setBusy] = useState(false)
  const st = STATUS[c.status]
  const hint = sopLine(c.sop_hint)
  const hintRef = [c.sop_hint?.sop_code, c.sop_hint?.section].filter(Boolean).join(' ')
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast('success', ok); setMode(''); onChanged() } catch (e) { toast('error', err(e, 'Could not save.')) } finally { setBusy(false) }
  }
  const locked = !!c.ruling
  return (
    <li className="rounded-xl border border-gray-100 bg-white p-4 space-y-3 list-none">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-gray-900 break-words">{c.field} <span className="font-normal text-gray-500">in {c.record}</span></p>
          {showSource && <p className="m-0 text-xs text-gray-500">{c.source}{c.extractor ? `, extractor ${c.extractor}` : ''}</p>}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Chip tone={c.admin_verdict === 'correct' ? 'green' : 'red'}>Admin marked it {c.admin_verdict === 'correct' ? 'correct' : 'wrong'}</Chip>
          <Chip tone={st.tone}>{st.label}</Chip>
          {c.ruling && <Chip tone={c.ruling === 'overturned' ? 'blue' : 'gray'}>{c.ruling === 'overturned' ? 'Admin changed the check to correct' : 'Admin check stands'}</Chip>}
        </div>
      </div>
      <dl className="grid sm:grid-cols-2 gap-3 m-0 text-sm">
        <div className="rounded-lg bg-gray-50 p-3 min-w-0"><dt className="text-xs text-gray-500">What was delivered</dt><dd className="m-0 break-words">{show(c.extracted_value)}</dd></div>
        <div className={cn('rounded-lg p-3 min-w-0', c.admin_verdict === 'correct' ? 'bg-emerald-50' : 'bg-red-50')}>
          <dt className="text-xs text-gray-500">{c.admin_verdict === 'correct' ? 'Admin confirmed it matches the source' : 'What the admin says the source really says'}</dt>
          <dd className="m-0 break-words">{c.admin_verdict === 'correct' ? show(c.extracted_value) : show(c.admin_truth)}</dd>
          {c.admin_note && <dd className="m-0 mt-1 text-xs text-gray-600 break-words">Admin note: {c.admin_note}</dd>}
        </div>
      </dl>
      {c.sent_note && <p className="m-0 text-xs text-gray-600">Note sent with it by {c.sent_by || 'the admin'}: {c.sent_note}</p>}
      {hint && <p className="m-0 text-xs text-gray-500"><b>SOP for this field:</b> {hint}{c.sop_hint?.rule ? `. ${c.sop_hint.rule}` : ''}</p>}

      {c.stance && (
        <div className={cn('rounded-lg border px-3 py-2 text-sm', c.stance === 'agree' ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50')}>
          <p className="m-0 font-medium">{c.responded_by || 'The extractor'} {c.stance === 'agree' ? 'confirmed the admin is right' : 'disagrees'}</p>
          {c.finding && <p className="m-0 mt-1 whitespace-pre-wrap break-words">{c.finding}</p>}
          {c.evidence_url && <p className="m-0 mt-1 text-xs break-all"><a href={c.evidence_url} target="_blank" rel="noreferrer noopener" className="underline">{c.evidence_url}</a></p>}
          {c.sop_ref && <p className="m-0 mt-1 text-xs text-gray-600">SOP reference: {c.sop_ref}</p>}
        </div>
      )}
      {c.ruling && <p className="m-0 text-xs text-gray-600">{c.ruled_by || 'An admin'} ruled: {c.ruling === 'overturned' ? 'the extractor is right, the check is now correct.' : 'the admin check stands.'}{c.ruling_note ? ` ${c.ruling_note}` : ''}</p>}

      {canRespond && !locked && mode !== 'disagree' && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="success" loading={busy} onClick={() => run(() => challengeApi.respond(c.id, { stance: 'agree' }), 'Confirmed')}>The admin is right</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('disagree')}>{c.stance === 'disagree' ? 'Edit my finding' : 'I disagree'}</Button>
        </div>
      )}
      {canRespond && !locked && mode === 'disagree' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">What you found
            <textarea value={finding} onChange={e => setFinding(e.target.value)} rows={3} maxLength={3000} placeholder="What the source really says, and why the delivered value is right"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-medium text-gray-700">Link to the evidence (optional)
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-medium text-gray-700">SOP reference (optional)
            <input value={sop} onChange={e => setSop(e.target.value)} maxLength={300} placeholder="Section or rule in the SOP" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          {hintRef && !sop && <button type="button" className="text-xs text-brand-700 underline" onClick={() => setSop(hintRef)}>Use "{hintRef}"</button>}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={finding.trim().length < 5} onClick={() => run(() => challengeApi.respond(c.id, { stance: 'disagree', finding, evidence_url: url, sop_ref: sop }), 'Your finding was sent')}>Send my finding</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('')}>Cancel</Button>
          </div>
        </div>
      )}
      {canRespond && !locked && c.stance === 'agree' && mode === '' && <p className="m-0 text-xs text-gray-500">You can still change your answer until an admin rules.</p>}

      {canRule && c.status !== 'waiting' && mode !== 'rule' && (
        <Button size="sm" variant="secondary" onClick={() => setMode('rule')}>{c.ruling ? 'Change the ruling' : 'Rule on this'}</Button>
      )}
      {canRule && c.status === 'waiting' && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => challengeApi.withdraw(c.id), 'Taken back')}>Take back from the extractor</Button>
      )}
      {canRule && mode === 'rule' && (
        <div className="space-y-2">
          <textarea value={rnote} onChange={e => setRnote(e.target.value)} rows={2} placeholder="Reason (optional)" aria-label="Reason for the ruling" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" loading={busy} onClick={() => run(() => challengeApi.rule(c.id, { ruling: 'upheld', note: rnote }), 'Ruled: the check stands')}>My check stands</Button>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => challengeApi.rule(c.id, { ruling: 'overturned', note: rnote }), 'Ruled: the extractor is right')}>The extractor is right</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('')}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  )
}

const CountChips = ({ c }: { c: Counts }) => (
  <div className="flex gap-2 flex-wrap">
    <Chip tone={c.waiting ? 'amber' : 'gray'}>{c.waiting} waiting</Chip>
    <Chip tone={c.agreed ? 'green' : 'gray'}>{c.agreed} agreed</Chip>
    <Chip tone={c.disputed ? 'red' : 'gray'}>{c.disputed} disagreed</Chip>
    <Chip tone="gray">{c.settled} settled</Chip>
  </div>
)

/** On the source page: what the admin checked and sent back. The extractor answers here; leads can rule. Shows nothing when nothing was sent. */
export function SourceChallenges({ sourceId, refreshKey }: { sourceId: string; refreshKey?: unknown }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof challengeApi.forSource>> | null>(null)
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const load = useCallback(() => { challengeApi.forSource(sourceId).then(setD).catch(() => setD(null)) }, [sourceId])
  useEffect(() => { load() }, [load, refreshKey])
  if (!d || !d.items.length) return null
  const open = d.items.filter(i => i.status !== 'settled' && !(i.stance && !d.can_rule))
  const shown = filter === 'all' ? d.items : d.items.filter(i => (d.can_respond ? i.status === 'waiting' : i.status === 'disputed' || i.status === 'agreed' || i.status === 'waiting'))
  return (
    <Panel title="Fields the admin sent back to you" subtitle="Each one is a field an admin checked against the source. If the admin is right, confirm it. If you think your value is right, give your finding, a link and the SOP reference if you have them. Your answer never changes the admin's check; an admin rules on it."
      actions={<div className="flex gap-1.5">{(['open', 'all'] as const).map(k => <button key={k} type="button" onClick={() => setFilter(k)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', filter === k ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-200 text-gray-600')}>{k === 'open' ? 'To answer' : `Everything (${d.items.length})`}</button>)}</div>}>
      <div className="mb-3"><CountChips c={d.counts} /></div>
      {shown.length === 0
        ? <p className="text-sm text-gray-500 m-0">{open.length === 0 ? 'Nothing left to answer.' : 'Nothing in this view.'} Switch to Everything to read them all.</p>
        : <ul className="space-y-3 p-0 m-0">{shown.map(c => <ChallengeCard key={c.id} c={c} canRespond={d.can_respond} canRule={d.can_rule} onChanged={load} />)}</ul>}
    </Panel>
  )
}

/** In Final check, after Record as audits: send the checked fields to the extractors, then follow their answers and rule on disagreements. */
export function AdminChallenges({ projectId, sourceIds, sourceId }: { projectId?: string; sourceIds: string[]; sourceId?: string }) {
  const [inclCorrect, setInclCorrect] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Awaited<ReturnType<typeof challengeApi.overview>> | null>(null)
  const [f, setF] = useState<'disputed' | 'waiting' | 'agreed' | 'settled' | 'all'>('disputed')
  const load = useCallback(() => { challengeApi.overview({ projectId, sourceId }).then(setD).catch(() => setD(null)) }, [projectId, sourceId])
  useEffect(() => { load() }, [load])
  const send = async () => {
    setBusy(true)
    try {
      const r = await challengeApi.send({ source_ids: sourceIds.length ? sourceIds : undefined, project_id: projectId || undefined, include_correct: inclCorrect, note })
      toast(r.created ? 'success' : 'info', r.created ? `Sent ${r.created} field${r.created === 1 ? '' : 's'} to ${r.sources} extractor${r.sources === 1 ? '' : 's'}` : `Nothing new to send${r.already_sent ? `, ${r.already_sent} were already sent` : ''}`)
      if (r.no_extractor) toast('info', `${r.no_extractor} field${r.no_extractor === 1 ? '' : 's'} not sent: the source has no extractor assigned`)
      load()
    } catch (e) { toast('error', err(e, 'Could not send.')) } finally { setBusy(false) }
  }
  const items = (d?.items ?? []).filter(i => f === 'all' || i.status === f)
  return (
    <Panel title="Send back to the extractors" subtitle="Every field you checked goes to the extractor with your verdict kept exactly as it is. They confirm it if you are right, or give their finding, a link and the SOP reference if they disagree. You rule on disagreements. Do this after Record as audits.">
      <div className="space-y-3">
        <div className="flex gap-3 items-end flex-wrap">
          <label className="flex-1 min-w-[16rem] text-xs font-medium text-gray-700">Note for the extractors (optional)
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="For example: please answer by Friday" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={inclCorrect} onChange={e => setInclCorrect(e.target.checked)} /> Also send fields I marked correct</label>
          <Button loading={busy} onClick={send}>Send to extractors</Button>
        </div>
        <p className="m-0 text-xs text-gray-500">Fields already sent are not sent twice. Scores and your verdicts do not change when they answer.</p>
        {d && d.total > 0 && (
          <>
            <CountChips c={d.counts} />
            <div className="flex gap-1.5 flex-wrap">
              {([['disputed', 'Disagreed'], ['waiting', 'Waiting'], ['agreed', 'Agreed'], ['settled', 'Settled'], ['all', 'All']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setF(k)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', f === k ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-200 text-gray-600')}>{l}</button>))}
            </div>
            {items.length === 0 ? <Blank title="Nothing here" text="Pick another view above." /> : <ul className="space-y-3 p-0 m-0">{items.slice(0, 100).map(c => <ChallengeCard key={c.id} c={c} canRespond={false} canRule showSource onChanged={load} />)}</ul>}
            {items.length > 100 && <p className="m-0 text-xs text-gray-500">Showing the first 100 of {items.length}. Open a source to see the rest.</p>}
          </>
        )}
      </div>
    </Panel>
  )
}
