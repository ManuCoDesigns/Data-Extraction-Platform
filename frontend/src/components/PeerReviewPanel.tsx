import { useCallback, useEffect, useState } from 'react'
import { CheckCheck, Clock, Pencil, UsersRound } from 'lucide-react'
import { sourcesApi } from '@/api/client'
import { Avatar, Button, Card, Spinner, Textarea, cn, safeFromNow, toast } from '@/components/ui'

interface Peer { user_id: string; name?: string | null; status: string; submitted_at?: string | null; mine: boolean; comment?: string | null }
interface Candidate { user_id: string; name: string; email: string; role: string; assigned: boolean }
interface Detail { peers: Peer[]; total: number; submitted: number; gated: boolean; can_manage: boolean; can_submit: boolean; comments_locked?: boolean; candidates: Candidate[] }

const roleLabel = (r: string) => (r === 'pipeline_operator' ? 'Extractor' : r === 'reviewer' ? 'Reviewer' : r.replace(/_/g, ' '))

// Peer review for one source: who is assigned, who has finished, and what each person said.
// Admins assign people here. A peer finishes by writing a comment. Admin approval waits for everyone.
export function PeerReviewPanel({ sourceId, onChanged }: { sourceId: string; onChanged?: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    sourcesApi.getPeerReviews(sourceId).then((r: Detail) => { setD(r); setFailed(false) }).catch(() => setFailed(true))
  }, [sourceId])
  useEffect(() => { setD(null); setEditing(false); setComment(''); setErr(''); load() }, [load])

  if (failed && !d) return null
  if (!d) return <Card className="p-5 flex justify-center"><Spinner className="w-5 h-5" /></Card>
  const hasMine = d.peers.some(p => p.mine)
  // People who are not admins and not peers have nothing to do here.
  if (!d.can_manage && d.total === 0 && !hasMine) return null

  const startEdit = () => { setPicked(d.peers.map(p => p.user_id)); setEditing(true) }
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const save = async () => {
    setSaving(true)
    try {
      setD(await sourcesApi.setPeerReviewers(sourceId, picked))
      setEditing(false)
      toast.success('Peer reviewers updated')
      onChanged?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Couldn't update peer reviewers")
    } finally { setSaving(false) }
  }
  const send = async () => {
    setErr('')
    if (!comment.trim()) { setErr('Add a comment before you finish your review.'); return }
    setSending(true)
    try {
      setD(await sourcesApi.submitPeerReview(sourceId, comment.trim()))
      setComment('')
      toast.success('Peer review submitted')
      onChanged?.()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Couldn't submit your review")
    } finally { setSending(false) }
  }

  const pct = d.total > 0 ? Math.round((d.submitted / d.total) * 100) : 0
  const allDone = d.total > 0 && d.submitted === d.total

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 flex-wrap border-b border-gray-50">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0">
          <UsersRound className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 m-0">Peer review</p>
          <p className="text-xs text-gray-500 m-0">
            {d.total === 0 ? 'No peer reviewers yet' : allDone ? 'Everyone has submitted. Ready for admin sign-off.' : `${d.submitted} of ${d.total} submitted. Admin approval waits for everyone.`}
          </p>
        </div>
        {d.total > 0 && (
          <div className="hidden sm:block w-32 h-1.5 rounded-full bg-gray-100 overflow-hidden ml-2" aria-hidden>
            <div className={cn('h-full rounded-full transition-all', allDone ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${pct}%` }} />
          </div>
        )}
        {d.can_manage && !editing && (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={startEdit}>
            <Pencil className="w-3.5 h-3.5" /> {d.total === 0 ? 'Assign peer reviewers' : 'Edit peer reviewers'}
          </Button>
        )}
      </div>

      {editing && (
        <div className="px-5 py-4 bg-gray-50/60 border-b border-gray-100 space-y-3">
          <p className="text-xs text-gray-500 m-0">Pick who should review this source. Extractors and reviewers on the project can be picked, except this source's own extractor.</p>
          {d.candidates.length === 0 ? (
            <p className="text-sm text-gray-400 m-0">No one eligible yet. Add extractors or reviewers to the project first.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {d.candidates.map(c => (
                <label key={c.user_id} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-white cursor-pointer transition',
                  picked.includes(c.user_id) ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-gray-300')}>
                  <input type="checkbox" checked={picked.includes(c.user_id)} onChange={() => toggle(c.user_id)} className="accent-indigo-600" />
                  <Avatar name={c.name || '?'} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 truncate">{c.name}</span>
                    <span className="block text-[11px] text-gray-400">{roleLabel(c.role)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" loading={saving} onClick={save}>Save peer reviewers</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <span className="text-xs text-gray-400">{picked.length} selected</span>
          </div>
        </div>
      )}

      {d.peers.length > 0 && (
        <ul className="m-0 p-0 list-none divide-y divide-gray-50">
          {d.peers.map(p => (
            <li key={p.user_id} className="px-5 py-3.5 flex gap-3" data-peer={p.user_id}>
              <Avatar name={p.name || '?'} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{p.name ?? 'Unknown'}{p.mine && <span className="text-gray-400 font-normal"> (you)</span>}</span>
                  {p.status === 'submitted'
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCheck className="w-3 h-3" /> Submitted</span>
                    : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><Clock className="w-3 h-3" /> Waiting</span>}
                  {p.status === 'submitted' && p.submitted_at && <span className="text-xs text-gray-400">{safeFromNow(p.submitted_at)}</span>}
                </div>
                {p.comment ? (
                  <p className={cn('text-sm mt-1.5 mb-0 whitespace-pre-wrap rounded-lg px-3 py-2 border-l-2',
                    p.status === 'submitted' ? 'bg-gray-50 text-gray-700 border-indigo-300' : 'bg-gray-50/60 text-gray-500 border-gray-200')}>
                    {p.comment}
                    {p.status !== 'submitted' && <span className="block text-[11px] text-gray-400 mt-1">Earlier comment. Sent back, so this review needs another look.</span>}
                  </p>
                ) : p.status === 'submitted' ? (
                  <p className="text-xs text-gray-400 mt-1 mb-0">{d.comments_locked ? 'Hidden until you submit your own review, so every review stays independent.' : 'Comment is only shown to admins, the extractor and reviewers who have finished their own review.'}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {d.can_submit && (
        <div className="px-5 py-4 border-t border-gray-100 bg-indigo-50/40 space-y-3">
          <p className="text-sm font-semibold text-gray-900 m-0">Finish your peer review</p>
          <p className="text-xs text-gray-500 m-0">Check the records against the source, approve or send back what you need to, then say what you found. You can't finish without a comment. Other reviewers' comments stay hidden until you submit yours.</p>
          <Textarea rows={3} value={comment} onChange={e => { setComment(e.target.value); if (err) setErr('') }} error={err}
            placeholder="What did you check, and what did you find?" aria-label="Peer review comment" />
          <Button size="sm" loading={sending} onClick={send} disabled={!comment.trim()}>Submit my review</Button>
        </div>
      )}
    </Card>
  )
}
