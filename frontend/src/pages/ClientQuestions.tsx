import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardCopy, HelpCircle, MessageSquarePlus, RotateCcw, Send, Trash2, Upload } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Avatar, Button, ConfirmDialog, cn, safeFromNow, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, Tabs, PAGE, shortAgo } from '@/components/enh/kit'
import { AskClientModal } from '@/components/enh/AskClient'
import { useAuthStore } from '@/store/auth'

interface Q {
  id: string; project_id: string; source_id?: string | null; source_name?: string | null; question: string; answer?: string | null
  status: 'open' | 'answered'; asked_by?: string | null; asked_by_id?: string | null; answered_by?: string | null
  sent_to_client_at?: string | null; created_at: string; answered_at?: string | null; topic?: string | null; answered_by_name?: string | null
}

export function ClientQuestionsPage() {
  const { user } = useAuthStore()
  const isLead = ['org_admin', 'project_admin', 'qa_lead'].some(r => user?.roles?.includes(r))
  const [tab, setTab] = useState<'open' | 'answered' | 'all'>('open')
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [items, setItems] = useState<Q[]>([])
  const [counts, setCounts] = useState({ open: 0, answered: 0 })
  const [loading, setLoading] = useState(true)
  const [ask, setAsk] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Q | null>(null)
  const importQa = async (file: File | undefined) => {
    if (!file) return
    const pid = project || (projects.length === 1 ? projects[0].id : '')
    if (!pid) { toast.error('Pick a project first, then import'); return }
    try {
      const raw = JSON.parse(await file.text())
      const items = Array.isArray(raw) ? raw : raw.items
      if (!Array.isArray(items) || !items.length) throw new Error('empty')
      const r = await enhApi.importQuestions({ project_id: pid, items })
      toast.success(`${r.added} added, ${r.updated} filled in`)
      load()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'That file is not a list of questions and answers') }
  }

  const load = useCallback(async () => {
    try {
      const r = await enhApi.questions({ project_id: project || undefined })
      setItems(r.items); setCounts({ open: r.open, answered: r.answered })
    } catch { toast.error("Couldn't load questions") } finally { setLoading(false) }
  }, [project])
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { setLoading(true); load() }, [load])

  const shown = useMemo(() => items.filter(q => tab === 'all' || q.status === tab), [items, tab])
  const openShown = shown.filter(q => q.status === 'open')
  const projName = (id: string) => projects.find(p => p.id === id)?.name

  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const copyForClient = async () => {
    const chosen = items.filter(q => picked.has(q.id))
    if (!chosen.length) return
    const text = 'Hi, a few points need your input so we can continue:\n\n'
      + chosen.map((q, i) => `${i + 1}. ${q.source_name ? `[${q.source_name}] ` : ''}${q.question}`).join('\n\n') + '\n\nThank you.'
    try {
      await navigator.clipboard.writeText(text)
      await enhApi.markSent(chosen.map(q => q.id))
      toast.success(`Copied ${chosen.length} question${chosen.length === 1 ? '' : 's'} and marked them as sent`)
      setPicked(new Set()); load()
    } catch { toast.error("Couldn't copy. Try again") }
  }
  const save = async (q: Q) => {
    const a = (drafts[q.id] ?? '').trim()
    if (!a) { toast.error("Write the client's answer first"); return }
    setBusy(q.id)
    try { await enhApi.answer(q.id, a); setDrafts(d => ({ ...d, [q.id]: '' })); toast.success('Answer saved'); load() }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't save the answer") } finally { setBusy(null) }
  }
  const reopen = async (q: Q) => { try { await enhApi.reopen(q.id); load() } catch { toast.error("Couldn't reopen") } }
  const remove = async () => {
    if (!toDelete) return
    try { await enhApi.removeQuestion(toDelete.id); toast.success('Question removed'); setToDelete(null); load() }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't remove it") }
  }

  return (
    <div className={PAGE}>
      <PageHeader title="Client questions"
        subtitle="Keep every unclear point in one place. Send the open ones to the client together, then record their answers so everyone sees them."
        actions={<>
          {projects.length > 1 && (
            <SelectBox label="Project" value={project} onChange={setProject}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          )}
          {isLead && (
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              <Upload className="w-4 h-4" /> Import Q&A
              <input type="file" accept=".json,application/json" className="hidden" onChange={e => { importQa(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
          <Button onClick={() => setAsk(true)}><MessageSquarePlus className="w-4 h-4" /> Ask a question</Button>
        </>} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'open', label: 'Open', count: counts.open, tone: counts.open ? 'amber' : 'gray' },
          { key: 'answered', label: 'Answered', count: counts.answered, tone: 'green' },
          { key: 'all', label: 'All', count: counts.open + counts.answered },
        ]} />
        {isLead && openShown.length > 0 && (
          <div className="flex items-center gap-2">
            <button type="button" className="text-xs font-semibold text-gray-500 hover:text-gray-800"
              onClick={() => setPicked(picked.size === openShown.length ? new Set() : new Set(openShown.map(q => q.id)))}>
              {picked.size === openShown.length ? 'Clear selection' : 'Select all open'}
            </button>
            <Button size="sm" onClick={copyForClient} disabled={!picked.size}><ClipboardCopy className="w-4 h-4" /> Copy {picked.size || ''} for client</Button>
          </div>
        )}
      </div>

      {loading ? <Skeletons /> : shown.length === 0 ? (
        <Panel><Blank icon={<HelpCircle className="w-5 h-5" />}
          title={tab === 'open' ? 'No open questions' : tab === 'answered' ? 'Nothing answered yet' : 'No questions yet'}
          text="When something in a source or the SOP is unclear, write it here instead of asking in chat. Answers stay attached to the source."
          action={<Button variant="secondary" onClick={() => setAsk(true)}><MessageSquarePlus className="w-4 h-4" /> Ask a question</Button>} /></Panel>
      ) : (
        <div className="space-y-3">
          {shown.map(q => {
            const open = q.status === 'open'
            return (
              <article key={q.id} className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                <div className={cn('h-1', open ? 'bg-amber-400' : 'bg-emerald-500')} />
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    {isLead && open && (
                      <input type="checkbox" aria-label="Select this question" checked={picked.has(q.id)} onChange={() => togglePick(q.id)}
                        className="mt-1 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-200" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Chip tone={open ? 'amber' : 'green'}>{open ? 'Open' : 'Answered'}</Chip>
                        {q.topic && <Chip tone="purple">{q.topic}</Chip>}
                        {q.sent_to_client_at && open && <Chip tone="indigo" title="Copied for the client"><Send className="w-3 h-3" /> Sent {shortAgo(q.sent_to_client_at)} ago</Chip>}
                        {q.source_id && q.source_name && (
                          <Link to={`/projects/${q.project_id}/sources/${q.source_id}`} className="text-xs font-medium text-brand-600 hover:underline truncate max-w-[260px]">{q.source_name}</Link>
                        )}
                        {projects.length > 1 && projName(q.project_id) && <span className="text-xs text-gray-400">{projName(q.project_id)}</span>}
                      </div>
                      <p className="text-sm text-gray-900 m-0 whitespace-pre-wrap leading-relaxed">{q.question}</p>
                      <div className="text-xs text-gray-400 m-0 mt-2 flex items-center gap-1.5">
                        {q.asked_by && <Avatar name={q.asked_by} size="sm" />}
                        {q.asked_by ?? 'Someone'} asked {safeFromNow(q.created_at)}
                      </div>
                    </div>
                    {(isLead || (open && q.asked_by_id === user?.id)) && (
                      <button type="button" aria-label="Remove question" onClick={() => setToDelete(q)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>

                  {!open && q.answer && (
                    <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3">
                      <p className="text-xs font-semibold text-emerald-700 m-0 mb-1 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Client's answer{q.answered_by_name ? ` from ${q.answered_by_name}` : ''}{q.answered_by ? `, recorded by ${q.answered_by}` : ''}{q.answered_at ? ` ${safeFromNow(q.answered_at)}` : ''}</p>
                      <p className="text-sm text-emerald-950 m-0 whitespace-pre-wrap leading-relaxed">{q.answer}</p>
                      {isLead && <button type="button" onClick={() => reopen(q)} className="mt-2 text-xs font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Reopen</button>}
                    </div>
                  )}
                  {open && isLead && (
                    <div className="mt-4">
                      <textarea value={drafts[q.id] ?? ''} onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))} rows={2}
                        placeholder="Paste or type the client's answer here"
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y" />
                      <div className="flex justify-end mt-2"><Button size="sm" onClick={() => save(q)} loading={busy === q.id} disabled={!(drafts[q.id] ?? '').trim()}>Save answer</Button></div>
                    </div>
                  )}
                  {open && !isLead && <p className="text-xs text-gray-400 m-0 mt-3">Waiting for the client. You'll get a notice when it is answered.</p>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <AskClientModal open={ask} onClose={() => setAsk(false)} onAsked={load} />
      <ConfirmDialog open={!!toDelete} onCancel={() => setToDelete(null)} onConfirm={remove}
        title="Remove this question?" description="It will disappear for everyone. Answered questions are a useful record, so keep those unless they are wrong." confirmLabel="Remove" variant="danger" />
    </div>
  )
}
