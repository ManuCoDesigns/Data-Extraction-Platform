import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { enhApi } from '@/api/client'
import { cn } from '@/components/ui'
import { Panel, shortAgo } from '@/components/enh/kit'

type Item = { id: string; at: string; who: string; text: string; tone: string; detail?: string | null }

const DOT: Record<string, string> = {
  gray: 'bg-gray-300', blue: 'bg-blue-500', amber: 'bg-amber-500', green: 'bg-emerald-500', red: 'bg-red-500', purple: 'bg-purple-500',
}

/** What happened to this source, newest first, so nobody has to open the audit trail to find out. */
export function SourceActivity({ sourceId, refreshKey }: { sourceId: string; refreshKey?: unknown }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let live = true
    enhApi.sourceActivity(sourceId).then(r => { if (live) { setItems(r.items); setFailed(false) } }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [sourceId, refreshKey])

  if (failed && !items) return null
  const shown = items ? (all ? items : items.slice(0, 5)) : []
  return (
    <Panel title="Activity" subtitle="What happened to this source, newest first"
      actions={<History className="w-4 h-4 text-gray-300" aria-hidden />}>
      {!items ? <div className="h-16 rounded-xl bg-gray-100 animate-pulse" /> : items.length === 0 ? (
        <p className="text-sm text-gray-400 m-0">Nothing has happened yet. Uploads, reviews and approvals will show up here.</p>
      ) : (
        <>
          <ol className="m-0 p-0 list-none relative">
            {shown.map((it, i) => (
              <li key={it.id} className="flex gap-3 pb-4 last:pb-0 relative">
                {i < shown.length - 1 && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-gray-100" aria-hidden />}
                <span className={cn('w-[11px] h-[11px] rounded-full mt-1.5 shrink-0 relative z-10', DOT[it.tone] ?? DOT.gray)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700 m-0"><span className="font-semibold text-gray-900">{it.who}</span> {it.text}</p>
                  {it.detail && <p className="text-xs text-gray-500 m-0 mt-0.5 break-words">{it.detail}</p>}
                </div>
                <time className="text-xs text-gray-400 shrink-0 tabular-nums" dateTime={it.at} title={new Date(it.at).toLocaleString()}>{shortAgo(it.at)}</time>
              </li>
            ))}
          </ol>
          {items.length > 5 && (
            <button type="button" onClick={() => setAll(v => !v)} className="mt-3 text-sm font-semibold text-brand-600 hover:underline">
              {all ? 'Show less' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  )
}
