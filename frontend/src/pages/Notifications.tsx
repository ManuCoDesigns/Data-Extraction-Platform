import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Trash2, Inbox, ArrowUpRight } from 'lucide-react'
import { notificationsApi } from '@/api/client'
import { Card, Button, Spinner, EmptyState, cn, toast } from '@/components/ui'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { isAction, noticeMeta } from '@/lib/notices'

const PAGE_SIZE = 20
type Filter = 'all' | 'unread' | 'action'

// Groups notifications into Today / Yesterday / Earlier sections, the same
// pattern most inbox-style UIs use: makes a long list scannable instead of
// one undifferentiated column.
function groupByDate(items: Notification[]) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)

  const groups: { label: string; items: Notification[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier', items: [] },
  ]
  for (const n of items) {
    const d = new Date(n.created_at)
    if (d >= startOfToday) groups[0].items.push(n)
    else if (d >= startOfYesterday) groups[1].items.push(n)
    else groups[2].items.push(n)
  }
  return groups.filter(g => g.items.length > 0)
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Notification[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [counts, setCounts] = useState<{ unread: number; action: number }>({ unread: 0, action: 0 })

  const loadCounts = useCallback(() => {
    notificationsApi.unreadCount()
      .then((c: any) => setCounts({ unread: c?.unread_count ?? 0, action: c?.action_count ?? 0 }))
      .catch(() => {})
  }, [])

  const load = useCallback((p: number, replace: boolean) => {
    if (replace) setLoading(true); else setLoadingMore(true)
    notificationsApi.list({ page: p, page_size: PAGE_SIZE, unread_only: filter === 'unread' || filter === 'action', action_only: filter === 'action' })
      .then((r: any) => {
        setItems(prev => replace ? (r.items ?? []) : [...prev, ...(r.items ?? [])])
        setHasMore(!!r.has_more)
        setTotal(r.total ?? 0)
        setPage(p)
      })
      .catch(() => toast.error('Could not load notifications'))
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [filter])

  useEffect(() => { load(1, true); loadCounts() }, [load, loadCounts])

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      setCounts(c => ({ unread: Math.max(0, c.unread - 1), action: Math.max(0, c.action - (isAction(n) ? 1 : 0)) }))
      notificationsApi.markRead(n.id).catch(() => {})
    }
    if (n.link) navigate(n.link)
  }

  const handleMarkAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    setCounts({ unread: 0, action: 0 })
    try {
      await notificationsApi.markAllRead()
      toast.success('All notifications marked read')
    } catch {
      toast.error('Could not mark all as read')
      loadCounts()
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const prev = items
    setItems(items.filter(n => n.id !== id))
    setTotal(t => Math.max(0, t - 1))
    try {
      await notificationsApi.delete(id)
      loadCounts()
    } catch {
      setItems(prev)
      toast.error('Could not delete notification')
    }
  }

  const tabs: { key: Filter; label: string; n?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', n: counts.unread },
    { key: 'action', label: 'Needs action', n: counts.action },
  ]

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25">
              <Bell className="w-4 h-4 text-white" />
            </div>
            Notifications
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {counts.action > 0
              ? <><span className="font-semibold text-red-600">{counts.action} need{counts.action === 1 ? 's' : ''} your action</span>{counts.unread > counts.action ? `, ${counts.unread - counts.action} more unread` : ''}</>
              : counts.unread > 0 ? `${counts.unread} unread` : "You're all caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-100 rounded-xl p-1" role="tablist">
            {tabs.map(t => (
              <button key={t.key} role="tab" aria-selected={filter === t.key} onClick={() => setFilter(t.key)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                  filter === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {t.label}
                {!!t.n && <span className={cn('tabular-nums text-[10px] font-bold px-1.5 rounded-full', t.key === 'action' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600')}>{t.n}</span>}
              </button>
            ))}
          </div>
          {counts.unread > 0 && (
            <Button variant="secondary" size="sm" onClick={handleMarkAllRead}>
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="w-6 h-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-10 h-10" />}
          title={filter === 'action' ? 'Nothing needs your action' : filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          description={filter === 'all' ? "You'll see updates here as they happen." : "You're all caught up."}
        />
      ) : (
        <>
          <p className="text-xs text-gray-400 m-0 -mb-2 px-1">{total} {filter === 'all' ? 'in total' : 'shown'}</p>
          {groupByDate(items).map(group => (
            <div key={group.label} className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">{group.label}</p>
              <Card className="overflow-hidden divide-y divide-gray-50">
                {group.items.map(n => {
                  const { label, Icon } = noticeMeta(n)
                  const action = isAction(n) && !n.is_read
                  return (
                    <div key={n.id} onClick={() => handleClick(n)} data-notice={n.id}
                      className={cn('relative px-5 py-4 flex items-start gap-3.5 cursor-pointer transition group',
                        n.is_read ? 'bg-white hover:bg-gray-50' : action ? 'bg-red-50/50 hover:bg-red-50' : 'bg-brand-50/40 hover:bg-brand-50')}>
                      {!n.is_read && <span className={cn('absolute left-0 top-0 bottom-0 w-1', action ? 'bg-red-500' : 'bg-brand-500')} />}
                      <span className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                        n.is_read ? 'bg-gray-100 text-gray-400' : action ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-600')}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold text-gray-400">{label}</span>
                          {action && <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">Action needed</span>}
                        </div>
                        <p className={cn('text-sm m-0 mt-0.5', n.is_read ? 'text-gray-700 font-normal' : 'text-gray-900 font-semibold')}>{n.title}</p>
                        {n.body && <p className="text-xs text-gray-500 mt-1 mb-0 leading-relaxed line-clamp-3">{n.body}</p>}
                        <p className="text-[11px] text-gray-400 mt-1.5 mb-0">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                      </div>
                      {n.link && <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-brand-600 shrink-0 mt-1 transition" />}
                      <button onClick={e => handleDelete(e, n.id)} aria-label="Delete notification"
                        className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </Card>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={() => load(page + 1, false)} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
