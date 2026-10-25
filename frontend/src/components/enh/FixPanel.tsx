import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import type { Signal } from '@/components/enh/SourceQuality'

/**
 * For the extractor, on a record that was sent back: the flagged fields first, each with what the reviewers said, an input to
 * fix it right there, and a count of how many are done. Fields the reviewers passed stay in the record below, locked. Nothing here
 * is a reviewer action: it only edits the flagged fields, using the same save as the rest of the record screen.
 */

const FLAG_TYPES = ['correction', 'sop', 'rejection']
// The same test the server uses for "this comment asks for a change".
const asksForChange = (e: any) => !!e && typeof e === 'object' && e.type !== 'note' && (e.type ? FLAG_TYPES.includes(e.type) : e.role !== 'admin')

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const scalar = (v: unknown) => v == null || ['string', 'number', 'boolean'].includes(typeof v)
const show = (v: unknown) => (v == null || v === '' ? 'empty' : typeof v === 'string' ? v : JSON.stringify(v))

export function FixPanel({ record, values, signals, onChange, onSave, dirty }: {
  record: any; values: Record<string, unknown>; signals?: Record<string, Signal[]>
  onChange: (field: string, value: string) => void; onSave: () => Promise<void> | void; dirty: boolean
}) {
  const fields: string[] = record.editable_fields || []
  const base = useRef<{ id: string; v: Record<string, unknown> }>({ id: '', v: {} })
  if (base.current.id !== record.id) base.current = { id: record.id, v: { ...(record.extracted_fields || {}) } }
  const [busy, setBusy] = useState(false)

  const info = fields.map(f => {
    const asks = ((record.reviewer_field_comments || {})[f] || []).filter(asksForChange)
    const last = asks[asks.length - 1]
    const before = last && 'value_at' in last ? last.value_at : base.current.v[f] // what the field said when it was flagged
    return { f, last, asks, before, notes: signals?.[f] || [], fixed: !same(values[f], before) }
  })
  const done = info.filter(i => i.fixed).length

  // n: go to the next flagged field that is still unchanged
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const next = info.find(i => !i.fixed) || info[0]
      if (!next) return
      e.preventDefault()
      const box = document.getElementById(`fix-${next.f}`)
      box?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      ;(document.getElementById(`fix-in-${next.f}`) as HTMLElement | null)?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const save = async () => { setBusy(true); try { await onSave() } finally { setBusy(false) } }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/70 px-4 py-3 space-y-3" aria-label="Fields to fix">
      <div className="flex items-center gap-3 flex-wrap">
        <b className="text-sm text-amber-900">Fix these {info.length} field{info.length === 1 ? '' : 's'}</b>
        <span className="text-xs text-amber-800 tabular-nums">{done} of {info.length} changed</span>
        <div className="flex-1 min-w-[60px] h-1.5 rounded-full bg-amber-200 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${info.length ? (100 * done) / info.length : 0}%` }} /></div>
        <span className="text-[11px] text-amber-800">Press <kbd className="px-1 rounded border border-amber-300 bg-white">n</kbd> for the next one</span>
      </div>
      <p className="m-0 text-xs text-amber-800">The other fields were passed by the reviewers and are locked. Fix only what is listed here, then save.</p>
      <ul className="m-0 p-0 list-none space-y-2.5">
        {info.map(i => (
          <li key={i.f} id={`fix-${i.f}`} className={'rounded-xl border bg-white px-3 py-2.5 ' + (i.fixed ? 'border-emerald-300' : 'border-amber-200')}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-[12.5px] font-semibold text-gray-900">{i.f}</span>
              {i.fixed && <span className="text-[11px] font-semibold text-emerald-700">✓ changed</span>}
              <button type="button" onClick={() => document.getElementById(`fld-${i.f}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })} className="ml-auto text-[11px] text-brand-600 hover:underline">Show in the record</button>
            </div>
            {i.asks.slice(-2).map((e: any, k: number) => (
              <p key={k} className="m-0 mb-1 text-[13px] text-gray-800"><span className="text-[11px] font-semibold text-amber-800 mr-1">{e.role === 'admin' ? 'Admin' : 'Reviewer'}:</span>{e.comment}</p>
            ))}
            {i.asks.length === 0 && i.notes.length > 0 && (
              <p className="m-0 mb-1 text-[13px] text-gray-800">{[...new Set(i.notes.map(n => n.text))].slice(0, 2).join(' ')}</p>
            )}
            {i.asks.length === 0 && i.notes.length === 0 && <p className="m-0 mb-1 text-[13px] text-gray-600">A reviewer check flagged this field.</p>}
            <p className="m-0 mb-1 text-[11px] text-gray-500">It said: <span className="font-mono">{show(i.before)}</span></p>
            {scalar(values[i.f]) ? (
              <input id={`fix-in-${i.f}`} value={values[i.f] == null ? '' : String(values[i.f])} onChange={e => onChange(i.f, e.target.value)}
                aria-label={`New value for ${i.f}`} placeholder="Type the corrected value"
                className="w-full text-[13px] font-mono rounded-lg border border-gray-300 px-2.5 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            ) : (
              <p className="m-0 text-xs text-gray-600">This field holds a list or a group. Edit it in the record below.</p>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save fixes'}</Button>
        {!dirty && done > 0 && <span className="text-xs text-emerald-700">Saved. Hand the source back for review when every field is done.</span>}
      </div>
    </div>
  )
}
