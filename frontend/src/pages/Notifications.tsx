import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Trash2, Inbox } from 'lucide-react'
import { notificationsApi } from '@/api/client'
import { Card, Button, Spinner, EmptyState, cn, toast } from '@/components/ui'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'

const PAGE_SIZE = 20

// Groups notifications into Today / Yesterday / Earlier sections, the same
// pattern most inbox-style UIs use — makes a long list scannable instead of
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
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = useCallback((p: number, replace: boolean) => {
    if (replace) setLoading(true); else setLoadingMore(true)
    notificationsApi.list({ page: p, page_size: PAGE_SIZE, unread_only: filter === 'unread' })
      .then((r: any) => {
        setItems(prev => replace ? (r.items ?? []) : [...prev, ...(r.items ?? [])])
        setHasMore(!!r.has_more)
        setTotal(r.total ?? 0)
        setPage(p)
      })
      .catch(() => toast.error('Could not load notifications'))
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [filter])

  useEffect(() => { load(1, true) }, [load])

  const unreadCount = items.filter(n => !n.is_read).length

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      notificationsApi.markRead(n.id).catch(() => {})
    }
    if (n.link) navigate(n.link)
  }

  const handleMarkAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    try {
      await notificationsApi.markAllRead()
      toast.success('All notifications marked read')
    } catch {
      toast.error('Could not mark all as read')
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const prev = items
    setItems(items.filter(n => n.id !== id))
    setTotal(t => Math.max(0, t - 1))
    try {
      await notificationsApi.delete(id)
    } catch {
      setItems(prev)
      toast.error('Could not delete notification')
    }
  }

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
            {total} total{unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-100 rounded-xl p-1">
            {(['all', 'unread'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {f === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
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
          title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          description={filter === 'unread' ? "You're all caught up." : "You'll see updates here as they happen."}
        />
      ) : (
        <>
          {groupByDate(items).map(group => (
            <div key={group.label} className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">{group.label}</p>
              <Card className="overflow-hidden divide-y divide-gray-50">
                {group.items.map(n => (
                  <div key={n.id} onClick={() => handleClick(n)}
                    className={cn('relative px-5 py-4 flex items-start gap-3 cursor-pointer transition group',
                      n.is_read ? 'bg-white hover:bg-gray-50' : 'bg-brand-50/40 hover:bg-brand-50')}>
                    {!n.is_read && (
                      <span className="absolute left-2 top-6 w-2 h-2 rounded-full bg-gradient-to-br from-brand-500 to-brand-700" />
                    )}
                    <div className="flex-1 min-w-0 pl-2">
                      <p className={cn('text-sm', n.is_read ? 'text-gray-700 font-normal' : 'text-gray-900 font-semibold')}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{n.body}</p>}
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <button onClick={e => handleDelete(e, n.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition opacity-0 group-hover:opacity-100 shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
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
