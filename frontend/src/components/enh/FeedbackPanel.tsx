import { useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Chip, Panel, type Tone } from '@/components/enh/kit'
import { cn } from '@/components/ui'

// Feedback from reviewers and admins stays on the source for good. Each item says whether the field has been
// changed since, and whether an admin has checked it again, so nothing disappears once the extractor starts fixing.

const STATE: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: 'Not changed yet', tone: 'amber' },
  confirmed: { label: 'Confirmed error, still to fix', tone: 'red' },
  still_wrong: { label: 'Checked again and still wrong', tone: 'red' },
  changed: { label: 'Changed, waiting for a re-check', tone: 'blue' },
  checked_ok: { label: 'Fixed and checked', tone: 'green' },
  dismissed: { label: 'Not an error', tone: 'gray' },
  unknown: { label: 'Open', tone: 'gray' },
  info: { label: 'Note', tone: 'gray' },
}
const KIND: Record<string, string> = { flag: 'Error logged', correction: 'Sent back', rejection: 'Sent back', sop: 'SOP note', note: 'Admin note', comment: 'Comment' }
const short = (v: unknown) => (v === null || v === undefined || v === '' ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function FeedbackPanel({ sourceId, refreshKey, onOpenRecord }: { sourceId: string; refreshKey?: unknown; onOpenRecord?: (recordId: string) => void }) {
  const [d, setD] = useState<any>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')
  useEffect(() => { qualityApi.feedback(sourceId).then(setD).catch(() => setD(null)) }, [sourceId, refreshKey])
  if (!d || !d.records?.length) return null
  const c = d.counts
  const recs = d.records.map((r: any) => ({ ...r, shown: r.items.filter((i: any) => filter === 'all' || !['checked_ok', 'dismissed', 'info'].includes(i.state)) })).filter((r: any) => r.shown.length)
  return (
    <Panel title="Feedback on this source" subtitle="Everything reviewers and admins pointed out. It stays here after you fix it, until an admin has checked the field again."
      actions={<div className="flex gap-1.5">
        {(['todo', 'all'] as const).map(k => <button key={k} type="button" onClick={() => setFilter(k)} className={cn('text-xs font-semibold rounded-full px-3 py-1 border', filter === k ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>{k === 'todo' ? 'To do' : 'Everything'}</button>)}
      </div>}>
      <div className="flex gap-2 flex-wrap mb-3">
        <Chip tone={c.waiting ? 'amber' : 'gray'}>{c.waiting} to fix</Chip>
        <Chip tone={c.changed ? 'blue' : 'gray'}>{c.changed} changed, waiting for a re-check</Chip>
        <Chip tone={c.checked ? 'green' : 'gray'}>{c.checked} fixed and checked</Chip>
      </div>
      {recs.length === 0 ? <p className="text-sm text-gray-500 m-0">Nothing left to fix. Switch to Everything to read the full feedback.</p> : (
        <ul className="m-0 p-0 list-none space-y-2">
          {recs.map((r: any) => {
            const expanded = open[r.record_id] ?? (r.shown.some((i: any) => ['waiting', 'confirmed', 'still_wrong'].includes(i.state)))
            return (
              <li key={r.record_id} className="rounded-xl border border-gray-100">
                <button type="button" onClick={() => setOpen(o => ({ ...o, [r.record_id]: !expanded }))} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                  <span className="font-semibold text-sm text-gray-900 truncate">{r.record}</span>
                  {r.returned > 0 && <Chip tone="red">Sent back {r.returned}×</Chip>}
                  {r.changed_since_return?.length > 0 && <Chip tone="blue" title={r.changed_since_return.join(', ')}>{r.changed_since_return.length} field{r.changed_since_return.length === 1 ? '' : 's'} changed since</Chip>}
                  <span className="ml-auto text-xs text-gray-400">{r.shown.length} item{r.shown.length === 1 ? '' : 's'} {expanded ? '▴' : '▾'}</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-3 space-y-2">
                    {onOpenRecord && <button type="button" onClick={() => onOpenRecord(r.record_id)} className="text-xs font-semibold text-brand-600 hover:underline">Open this record</button>}
                    {r.shown.map((i: any, n: number) => (
                      <div key={n} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {i.field && <span className="text-xs font-semibold text-gray-700">{i.field}</span>}
                          <Chip tone={(STATE[i.state] ?? STATE.info).tone}>{(STATE[i.state] ?? STATE.info).label}</Chip>
                          <span className="text-[11px] text-gray-400">{KIND[i.kind] ?? i.kind} by {i.by}{i.sop_rule ? `, ${i.sop_rule}` : ''}</span>
                        </div>
                        <p className="m-0 mt-1 text-gray-800 break-words">{i.text}</p>
                        {i.field && i.was !== null && i.was !== undefined && (
                          <p className="m-0 mt-1 text-xs text-gray-500">When it was pointed out it said <b>{short(i.was)}</b>{short(i.was) !== short(i.now) ? <> and now says <b>{short(i.now)}</b></> : ', and it still says the same'}.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
