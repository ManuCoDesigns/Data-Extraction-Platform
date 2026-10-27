import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, Trash2 } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Avatar, Button, cn, toast } from '@/components/ui'
import { Panel } from '@/components/enh/kit'
import { useAuthStore } from '@/store/auth'
import { ask } from '@/lib/confirm'

type Msg = { id: string; who: string; role: string; body: string; at: string; mine: boolean; new: boolean; thread: string }
type Thread = { items: Msg[]; can_post: boolean; closed: boolean; scope: 'all' | 'private'; owners: { user_id: string; name: string }[]; extractor?: string | null; is_extractor: boolean }

const ROLE_TONE: Record<string, string> = {
  Extractor: 'bg-blue-50 text-blue-700', Reviewer: 'bg-purple-50 text-purple-700', 'Peer reviewer': 'bg-purple-50 text-purple-700',
  Admin: 'bg-amber-50 text-amber-700', Lead: 'bg-amber-50 text-amber-700',
}
const dayName = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, t)) return 'Today'
  const y = new Date(t); y.setDate(t.getDate() - 1)
  return same(d, y) ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' })
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** A conversation on one source: the extractor, the reviewers and the admins can ask and answer here. */
export function SourceChat({ sourceId, onUnread }: { sourceId: string; onUnread?: (n: number) => void }) {
  const me = useAuthStore(s => s.user)
  const isAdmin = !!me?.roles?.some((r: string) => r === 'org_admin' || r === 'project_admin')
  const [data, setData] = useState<Thread | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const last = useRef('')

  const load = useCallback(async () => {
    try {
      const d: Thread = await enhApi.messages(sourceId)
      setData(d); setFailed(false)
      const unread = d.items.filter(m => m.new).length
      onUnread?.(unread)
      if (unread && document.visibilityState === 'visible') { await enhApi.markMessagesRead(sourceId).catch(() => {}) }
    } catch { setFailed(true) }
  }, [sourceId, onUnread])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (data?.is_extractor && !to && data.owners.length === 1) setTo(data.owners[0].user_id) }, [data, to])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 12000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    const id = data?.items[data.items.length - 1]?.id ?? ''
    if (id !== last.current) { last.current = id; box.current?.scrollTo({ top: box.current.scrollHeight }) }
  }, [data])
  useEffect(() => { if (window.location.hash === '#chat' && data) document.getElementById('chat')?.scrollIntoView({ block: 'start' }) }, [!!data])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try { await enhApi.postMessage(sourceId, body, to || undefined); setText(''); await load() }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't send that message") }
    finally { setSending(false) }
  }
  const remove = async (id: string) => {
    if (!await ask('Delete this message for everyone?', { confirmLabel: 'Delete', tone: 'danger' })) return
    try { await enhApi.deleteMessage(id); await load() } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't delete it") }
  }

  if (failed && !data) return null
  const owners = data?.owners ?? []
  const priv = data?.scope === 'private'
  const needsTarget = !!data?.is_extractor && owners.length > 0
  let prevDay = ''
  return (
    <div id="chat" className="scroll-mt-20">
      <Panel title="Conversation" subtitle={priv ? `Private: only you, ${data?.extractor ?? 'the extractor'} and admins can read this` : 'Each reviewer has a private thread with the extractor. Admins see all of them.'}
        actions={<MessageCircle className="w-4 h-4 text-gray-300" aria-hidden />} flush>
        <div ref={box} className="max-h-[360px] overflow-y-auto px-5 py-4 space-y-3" aria-live="polite">
          {!data ? <div className="h-16 rounded-xl bg-gray-100 animate-pulse" /> : data.items.length === 0 ? (
            <p className="text-sm text-gray-400 m-0 text-center py-6">No messages yet. Questions here stay between you, the extractor and admins. Other reviewers cannot see them.</p>
          ) : data.items.map(m => {
            const day = dayName(m.at); const showDay = day !== prevDay; prevDay = day
            return (
              <div key={m.id}>
                {showDay && <div className="text-center text-[11px] text-gray-400 my-2">{day}</div>}
                <div className={cn('group flex gap-2.5', m.mine && 'flex-row-reverse')}>
                  <Avatar name={m.who} size="sm" />
                  <div className={cn('max-w-[78%] min-w-0', m.mine && 'items-end flex flex-col')}>
                    <div className={cn('flex items-center gap-1.5 mb-0.5 text-xs flex-wrap', m.mine && 'flex-row-reverse')}>
                      <span className="font-semibold text-gray-800">{m.mine ? 'You' : m.who}</span>
                      <span className={cn('px-1.5 py-px rounded-md text-[10px] font-semibold', ROLE_TONE[m.role] ?? 'bg-gray-100 text-gray-600')}>{m.role}</span>
                      {!priv && <span className="text-gray-400">in {m.thread === 'Team' ? 'team notes' : `${m.thread}'s thread`}</span>}
                      <span className="text-gray-400">{clock(m.at)}</span>
                      {m.new && <span className="px-1.5 py-px rounded-full bg-brand-600 text-white text-[10px] font-bold">New</span>}
                      {(m.mine || isAdmin) && <button type="button" onClick={() => remove(m.id)} aria-label="Delete message" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>}
                    </div>
                    <p className={cn('m-0 text-sm leading-relaxed whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2', m.mine ? 'bg-brand-600 text-white rounded-tr-md' : 'bg-gray-100 text-gray-800 rounded-tl-md')}>{m.body}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {data?.closed && <p className="text-xs text-gray-400 m-0 px-5 pb-2">This source is delivered. You can still leave a note.</p>}
        {data && (data.can_post ? (
          <form onSubmit={e => { e.preventDefault(); send() }} className="flex items-end gap-2 border-t border-gray-100 px-4 py-3 flex-wrap sm:flex-nowrap">
            {!priv && (
              <select value={to} onChange={e => setTo(e.target.value)} aria-label="Send to" className="text-sm border border-gray-200 rounded-xl px-2.5 py-2 max-w-[11rem] focus:outline-none focus:ring-2 focus:ring-brand-200">
                {!needsTarget && <option value="">Team notes (extractor and admins)</option>}
                {needsTarget && !to && <option value="" disabled>Send to...</option>}
                {owners.map(o => <option key={o.user_id} value={o.user_id}>To {o.name}</option>)}
              </select>
            )}
            <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000} aria-label="Write a message"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Write a message. Enter sends, Shift+Enter adds a line."
              className="flex-1 resize-none text-sm border border-gray-200 rounded-xl px-3 py-2 max-h-32 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <Button type="submit" size="sm" loading={sending} disabled={!text.trim() || (needsTarget && !to)}><Send className="w-4 h-4" /> Send</Button>
          </form>
        ) : <p className="text-xs text-gray-400 m-0 border-t border-gray-100 px-5 py-3">Your role can read this conversation but not write in it.</p>)}
      </Panel>
    </div>
  )
}
