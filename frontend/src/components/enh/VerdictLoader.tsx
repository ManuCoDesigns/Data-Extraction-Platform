import { useState } from 'react'
import { qualityApi } from '@/api/client'
import { Chip } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { ask } from '@/lib/confirm'

/**
 * Load the verdicts from a review package (the zip with VERDICTS_all_sources.json). Reading changes nothing. "Use these decisions" fills in
 * wrong / right for each field the verdicts settle; you still press Record as audits yourself. "Send back" returns the records that
 * have a wrong field to their extractor with the reasons as the comment, after you confirm. Records already returned, approved or submitted are skipped.
 */
const err = (e: any, d: string) => e?.response?.data?.detail || d

export function VerdictLoader({ projectId, onDecisions }: { projectId: string; onDecisions: (d: Record<string, 'wrong' | 'right'>) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<any>(null)
  const [busy, setBusy] = useState<'read' | 'send' | ''>('')
  const [done, setDone] = useState<any>(null)

  const read = async () => {
    if (!file) return
    setBusy('read'); setDone(null)
    try { setPlan(await qualityApi.verdictsPreview(file, projectId)) } catch (e) { setPlan(null); toast.error(err(e, "Couldn't read the verdicts")) }
    finally { setBusy('') }
  }
  const use = () => {
    onDecisions(plan.decisions)
    toast.success(`${Object.keys(plan.decisions).length} decisions filled in. Check them, then press Record as audits.`)
  }
  const toSend = (plan?.send_back ?? []).filter((x: any) => !x.skip)
  const send = async () => {
    if (!toSend.length) return
    const ok = await ask(`Send ${toSend.length} record${toSend.length === 1 ? '' : 's'} back to the extractors?\n\nEach goes back with the reasons from the verdicts as the comment, and its source moves to Changes requested.`,
      { tone: 'warning', confirmLabel: 'Send back', details: toSend.slice(0, 8).map((x: any) => `${x.source}: ${x.record}`) })
    if (!ok) return
    setBusy('send')
    try {
      const r = await qualityApi.verdictsSendBack(toSend.map((x: any) => ({ source_id: x.source_id, record_id: x.record_id, comment: x.comment })))
      setDone(r)
      toast.success(`${r.sent} sent back${r.failed?.length ? `, ${r.failed.length} failed` : ''}`)
    } catch (e) { toast.error(err(e, "Couldn't send them back")) }
    finally { setBusy('') }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-200 text-sm space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-gray-600">Verdicts from a review package</span>
        <input type="file" accept=".zip,.json" aria-label="Review package" onChange={e => { setFile(e.target.files?.[0] ?? null); setPlan(null); setDone(null) }}
          className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1.5" />
        <Button variant="secondary" onClick={read} disabled={!file || !!busy}>{busy === 'read' ? 'Reading…' : 'Read verdicts'}</Button>
      </div>
      {plan && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <Chip tone="red">{plan.totals.wrong} wrong</Chip>
            <Chip tone="green">{plan.totals.right} extractor right</Chip>
            <Chip tone="amber">{plan.totals.records_to_send_back} records to send back</Chip>
            {plan.totals.records_skipped > 0 && <Chip tone="gray">{plan.totals.records_skipped} skipped (already returned, approved or submitted)</Chip>}
            {plan.totals.unmatched > 0 && <Chip tone="gray">{plan.totals.unmatched} not matched to a record</Chip>}
          </div>
          <ul className="m-0 pl-4 text-xs text-gray-600 space-y-0.5">
            {plan.sources.map((s: any) => <li key={s.name}>{s.name}: {s.verdicts} verdicts, {s.wrong} wrong, {s.right} extractor right, {s.held} held{s.unmatched ? `, ${s.unmatched} not matched` : ''}</li>)}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={use} disabled={!Object.keys(plan.decisions).length}>Use these decisions</Button>
            <Button variant="secondary" onClick={send} disabled={!toSend.length || !!busy}>{busy === 'send' ? 'Sending…' : `Send back ${toSend.length} record${toSend.length === 1 ? '' : 's'}`}</Button>
          </div>
          <p className="text-xs text-gray-500 m-0">Use these decisions only fills in the choices. Nothing is saved until you press Record as audits. Send back asks you to confirm first.</p>
          {!!plan.unmatched.length && (
            <details className="text-xs text-gray-600"><summary className="cursor-pointer">Verdicts not matched to a record</summary>
              <ul className="m-0 pl-4 mt-1 space-y-0.5">{plan.unmatched.slice(0, 40).map((u: any, i: number) => <li key={i}>{u.source}: {u.record} / {u.field} ({u.why})</li>)}</ul>
            </details>
          )}
          {done && <p className="text-xs m-0 text-gray-700">{done.sent} sent back{done.skipped?.length ? `, ${done.skipped.length} skipped` : ''}{done.failed?.length ? `, ${done.failed.length} failed` : ''}.</p>}
        </div>
      )}
    </div>
  )
}
