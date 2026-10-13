import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Blank, Chip, PAGE, PageHeader, Panel, Skeletons, shortAgo } from '@/components/enh/kit'
import { cn } from '@/components/ui'

type Thread = { source_id: string; project_id: string; source: string; project: string; last_body: string; last_who: string; last_at: string; count: number; unread: number; stage: string }

export function MessagesPage() {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [only, setOnly] = useState(false)
  useEffect(() => {
    let live = true
    const load = () => enhApi.inbox().then(r => { if (live) setThreads(r.threads) }).catch(() => { if (live) setThreads(t => t ?? []) })
    load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => { live = false; clearInterval(t) }
  }, [])
  const unread = (threads ?? []).reduce((n, t) => n + t.unread, 0)
  const shown = (threads ?? []).filter(t => !only || t.unread > 0)
  return (
    <div className={PAGE}>
      <PageHeader title="Messages" subtitle="Questions and answers on your sources. Open a source to join the conversation."
        actions={<button type="button" onClick={() => setOnly(v => !v)} className={cn('text-sm font-semibold px-3 py-1.5 rounded-xl border', only ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
          {only ? 'Showing unread' : 'Unread only'}{unread > 0 && <span className="ml-1.5 text-xs">({unread})</span>}</button>} />
      <Panel flush>
        {!threads ? <div className="p-5"><Skeletons rows={4} /></div> : shown.length === 0 ? (
          <Blank title={only ? 'Nothing unread' : 'No conversations yet'} text={only ? 'You are all caught up.' : 'Open any source and use the Conversation panel to ask a question. It will show up here.'} />
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-gray-50">
            {shown.map(t => (
              <li key={t.source_id}>
                <Link to={`/projects/${t.project_id}/sources/${t.source_id}#chat`} className="flex items-start gap-3 px-5 py-4 hover:bg-gray-50/70">
                  <span className="mt-0.5 w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('text-sm truncate', t.unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800')}>{t.source}</span>
                      <span className="text-xs text-gray-400 truncate hidden sm:inline">{t.project}</span>
                    </span>
                    <span className={cn('block text-sm truncate mt-0.5', t.unread ? 'text-gray-700' : 'text-gray-500')}><span className="font-medium">{t.last_who}:</span> {t.last_body}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-gray-400">{shortAgo(t.last_at)}</span>
                    {t.unread > 0 ? <Chip tone="indigo">{t.unread} new</Chip> : <span className="text-xs text-gray-300">{t.count} {t.count === 1 ? 'message' : 'messages'}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
