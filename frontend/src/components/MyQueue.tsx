import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react'
import { Badge, cn, safeFromNow } from '@/components/ui'
import type { Source } from '@/types'

const STATUS: Record<string, { label: string; color: 'gray' | 'amber' | 'red' | 'blue' | 'purple' | 'green' | 'indigo' }> = {
  not_started: { label: 'Not Started', color: 'gray' },
  extracting: { label: 'Extracting', color: 'blue' },
  needs_fixes: { label: 'Needs Fixes', color: 'amber' },
  ready_for_review: { label: 'Ready for Review', color: 'indigo' },
  in_review: { label: 'In Review', color: 'purple' },
  changes_requested: { label: 'Changes Requested', color: 'red' },
  llm_verification: { label: 'LLM Verification', color: 'purple' },
  approved: { label: 'Approved', color: 'green' },
}

// Returned work comes first, then what is mid-way, then what has not been started.
const RANK: Record<string, number> = {
  changes_requested: 0, needs_fixes: 1, in_review: 2, ready_for_review: 3, extracting: 4, not_started: 5,
}
const EXTRACT_ACTION = new Set(['changes_requested', 'needs_fixes', 'extracting', 'not_started'])
const REVIEW_ACTION = new Set(['ready_for_review', 'in_review'])

type Group = 'action' | 'waiting' | 'done'
export interface QueueItem { source: Source; role: 'extract' | 'review'; group: Group; rank: number }

// What does this person have to do with this source right now?
export function classify(s: Source, userId: string | undefined): QueueItem {
  const isExtractor = !!userId && s.assigned_extractor_id === userId
  const isReviewer = !!userId && s.assigned_reviewer_id === userId
  const rank = RANK[s.status] ?? 9
  if (s.status === 'approved') return { source: s, role: isExtractor ? 'extract' : 'review', group: 'done', rank }
  if (isExtractor && EXTRACT_ACTION.has(s.status)) return { source: s, role: 'extract', group: 'action', rank }
  if (isReviewer && REVIEW_ACTION.has(s.status)) return { source: s, role: 'review', group: 'action', rank }
  return { source: s, role: isExtractor ? 'extract' : 'review', group: 'waiting', rank }
}

export function buildQueue(sources: Source[], userId: string | undefined) {
  const when = (s: Source) => new Date(s.updated_at as any).getTime() || 0
  const items = sources.map(s => classify(s, userId))
  const sorted = (g: Group) => items.filter(i => i.group === g)
    .sort((a, b) => a.rank - b.rank || when(b.source) - when(a.source))
  return { action: sorted('action'), waiting: sorted('waiting'), done: sorted('done') }
}

function Row({ item, projectName }: { item: QueueItem; projectName?: string }) {
  const s = item.source
  const meta = STATUS[s.status] ?? STATUS.not_started
  return (
    <Link to={`/projects/${s.project_id}/sources/${s.id}`}
      className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition">
      <span className={cn('shrink-0 w-[58px] text-center text-[10px] font-bold uppercase tracking-wide py-1 rounded-md',
        item.role === 'extract' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700')}>
        {item.role === 'extract' ? 'Extract' : 'Review'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 truncate">{s.name}</span>
        {projectName && <span className="block text-[11px] text-gray-400 truncate">{projectName}</span>}
      </span>
      <Badge variant={meta.color}>{meta.label}</Badge>
      <span className="hidden sm:block w-24 text-xs text-gray-500 text-right">
        {s.total_records > 0 ? `${s.valid_records}/${s.total_records} valid` : '—'}
      </span>
      <span className="hidden md:block w-28 text-xs text-gray-400 text-right">{safeFromNow(s.updated_at, false)}</span>
      <span className="text-xs font-semibold text-brand-600 inline-flex items-center gap-0.5 shrink-0">Open <ArrowUpRight className="w-3 h-3" /></span>
    </Link>
  )
}

function Section({ title, hint, items, tone, projectNames, limit, collapsible, startOpen }: {
  title: string; hint: string; items: QueueItem[]; tone: string; projectNames?: Record<string, string>
  limit: number; collapsible?: boolean; startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen ?? true)
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const shown = all ? items : items.slice(0, limit)
  const Head = (
    <>
      <span className={cn('w-2 h-2 rounded-full', tone)} />
      <span className="text-sm font-bold text-gray-900">{title}</span>
      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
      <span className="text-xs text-gray-400 ml-1 hidden sm:inline">{hint}</span>
    </>
  )
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      {collapsible ? (
        <button onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50/60">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          {Head}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">{Head}</div>
      )}
      {open && (
        <div>
          {shown.map(i => <Row key={i.source.id} item={i} projectName={projectNames?.[i.source.project_id]} />)}
          {items.length > limit && (
            <button onClick={() => setAll(a => !a)}
              className="w-full px-4 py-2.5 text-xs font-semibold text-brand-600 hover:bg-gray-50 border-t border-gray-50">
              {all ? 'Show fewer' : `Show ${items.length - limit} more`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// The assigned work, in the order a person should do it: act on these first,
// then what is waiting on someone else, then what is finished.
export function MyQueue({ sources, userId, projectNames, limit = 8 }: {
  sources: Source[]; userId: string | undefined; projectNames?: Record<string, string>; limit?: number
}) {
  const q = useMemo(() => buildQueue(sources, userId), [sources, userId])
  return (
    <div className="space-y-4">
      {q.action.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-8 text-center">
          <p className="text-sm font-semibold text-gray-800 m-0">You're all caught up</p>
          <p className="text-sm text-gray-500 mt-1 mb-0">Nothing needs your action right now.</p>
        </div>
      )}
      <Section title="Needs your action" hint="start at the top" items={q.action} tone="bg-red-500" projectNames={projectNames} limit={limit} />
      <Section title="Waiting on others" hint="with a reviewer or admin" items={q.waiting} tone="bg-amber-400"
        projectNames={projectNames} limit={limit} collapsible startOpen={q.action.length === 0} />
      <Section title="Done" hint="approved" items={q.done} tone="bg-emerald-500" projectNames={projectNames} limit={limit} collapsible startOpen={false} />
    </div>
  )
}
