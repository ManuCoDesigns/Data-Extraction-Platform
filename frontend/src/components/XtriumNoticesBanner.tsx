import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { xtriumApi } from '@/api/client'

interface Notice {
  key: string
  kind: 'escalation' | 'failure' | 'xtrium'
  title: string
  reason?: string | null
  body?: string | null
  at?: string | null
  by?: string | null
}

const KIND_STYLE: Record<Notice['kind'], { box: string; label: string }> = {
  escalation: { box: 'bg-amber-50 border-amber-200', label: 'text-amber-700' },
  failure: { box: 'bg-red-50 border-red-200', label: 'text-red-700' },
  xtrium: { box: 'bg-violet-50 border-violet-200', label: 'text-violet-700' },
}

const ago = (iso?: string | null): string => {
  if (!iso) return ''
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime()
  if (Number.isNaN(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

// A banner at the top of the source page: what was raised on this item
// (broken link, failure report) and anything Xtrium sent back. Renders nothing
// when there is nothing to say, so clean sources look unchanged.
export function XtriumNoticesBanner({ sourceId, reloadKey = '' }: { sourceId: string; reloadKey?: string }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    xtriumApi.notices(sourceId)
      .then((r: any) => {
        if (cancelled) return
        const list: Notice[] = [
          ...(r?.escalations ?? []).map((e: any): Notice => ({
            key: `e${e.id}`, kind: 'escalation', title: 'Escalated — no data found',
            reason: e.reason, body: e.note, at: e.at, by: e.by,
          })),
          ...(r?.failures ?? []).map((f: any, i: number): Notice => ({
            key: `f${i}${f.at}`, kind: 'failure', title: 'Failure reported to Xtrium',
            reason: f.reason, body: f.xtrium_reply ? `Xtrium replied: ${f.xtrium_reply}` : null, at: f.at, by: f.by,
          })),
          ...(r?.xtrium_feedback ?? []).map((f: any, i: number): Notice => ({
            key: `x${i}${f.at}`, kind: 'xtrium', title: 'Sent back by Xtrium', body: f.comment, at: f.at,
          })),
        ].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
        setNotices(list)
      })
      // A banner is a convenience: if it can't load, the page is simply unchanged.
      .catch(() => { if (!cancelled) setNotices([]) })
    return () => { cancelled = true }
  }, [sourceId, reloadKey])

  if (notices.length === 0) return null
  const shown = open ? notices : notices.slice(0, 1)

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-3 space-y-2.5" role="status">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm font-bold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          {notices.length === 1 ? 'Notice on this item' : `${notices.length} notices on this item`}
        </p>
        {notices.length > 1 && (
          <button onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
            {open ? <>Show less <ChevronUp className="w-3.5 h-3.5" /></> : <>Show all <ChevronDown className="w-3.5 h-3.5" /></>}
          </button>
        )}
      </div>
      {shown.map(n => (
        <div key={n.key} className={`rounded-xl border px-3.5 py-2.5 ${KIND_STYLE[n.kind].box}`}>
          <p className={`m-0 text-[11px] font-bold uppercase tracking-wider ${KIND_STYLE[n.kind].label}`}>{n.title}</p>
          {n.reason && <p className="m-0 mt-1 text-sm font-semibold text-gray-900">{n.reason}</p>}
          {n.body && <p className="m-0 mt-1 text-sm text-gray-700" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          <p className="m-0 mt-1 text-[11px] text-gray-400">
            {[n.by ? `by ${n.by}` : null, n.at ? ago(n.at) : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      ))}
    </div>
  )
}
