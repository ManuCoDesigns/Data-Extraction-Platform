import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Database, ExternalLink, FileText, RefreshCw } from 'lucide-react'
import { sourcesApi, projectsApi } from '@/api/client'
import { Spinner, cn } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { MyQueue, buildQueue } from '@/components/MyQueue'
import type { QueueItem } from '@/components/MyQueue'
import type { Source } from '@/types'

type Focus = 'all' | 'extract' | 'review'

const hello = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// What "do this next" means for each stage, in the person's own terms.
const NEXT: Record<string, { why: string; cta: string }> = {
  changes_requested: { why: 'A reviewer sent this back — fix what they asked for.', cta: 'Open and fix' },
  needs_fixes: { why: 'Some records have errors that need correcting.', cta: 'Fix records' },
  in_review: { why: "You've started this review — finish it.", cta: 'Continue review' },
  ready_for_review: { why: 'The extractor is done — it needs your review.', cta: 'Start review' },
  extracting: { why: "You're partway through extracting this one.", cta: 'Continue extracting' },
  not_started: { why: 'Nothing extracted yet — a good place to begin.', cta: 'Start extracting' },
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Tile({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-3.5">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider m-0">{label}</p>
      <p className={cn('text-2xl font-extrabold m-0 mt-1', tone)} data-tile>{value}</p>
      <p className="text-xs text-gray-400 m-0">{sub}</p>
    </div>
  )
}

function UpNext({ item, rest, projectName }: { item: QueueItem; rest: number; projectName?: string }) {
  const s = item.source
  const next = NEXT[s.status] ?? NEXT.not_started
  const xtriumId = (s as any).external_ref_id as string | undefined
  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-500 to-brand-700" />
      <div className="px-6 py-5 flex items-start justify-between gap-5 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-brand-600 uppercase tracking-wider m-0">
            Up next · {item.role === 'extract' ? 'Extract' : 'Review'}
          </p>
          <h2 className="text-lg font-extrabold text-gray-900 mt-1 mb-0 truncate">{s.name}</h2>
          <p className="text-sm text-gray-500 mt-1 mb-0">{next.why}</p>
          <p className="text-xs text-gray-400 mt-2 mb-0 flex items-center gap-x-3 gap-y-1 flex-wrap">
            {projectName && <span>{projectName}</span>}
            {xtriumId && <span>Xtrium item #{xtriumId}</span>}
            {s.total_records > 0 && <span>{s.valid_records}/{s.total_records} records valid</span>}
            {s.website_url && (
              <a href={s.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                <ExternalLink className="w-3 h-3" /> {s.website_url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {xtriumId && (
            <Link to={`/projects/${s.project_id}/sources/${s.id}/sop`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 px-3 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
              <FileText className="w-3.5 h-3.5" /> SOP
            </Link>
          )}
          <Link to={`/projects/${s.project_id}/sources/${s.id}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-white px-4 py-2.5 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 hover:opacity-95">
            {next.cta} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
      {rest > 0 && <p className="text-xs text-gray-400 px-6 pb-4 m-0 -mt-1">then {plural(rest, 'more thing')} below</p>}
    </div>
  )
}

// Home page for people who extract and/or review (everyone who is not an admin).
// It adapts to the person's roles and to what is actually on their plate.
export function WorkDashboard() {
  const { user } = useAuthStore()
  const roles = new Set(Array.isArray(user?.roles) ? user!.roles : [])
  const isExtractor = roles.has('pipeline_operator')
  const isReviewer = roles.has('reviewer')
  const both = isExtractor && isReviewer

  const [sources, setSources] = useState<Source[] | null>(null)
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [focus, setFocus] = useState<Focus>('all')

  useEffect(() => {
    let cancelled = false
    setError(null)
    sourcesApi.list()
      .then((r: any) => { if (!cancelled) setSources(Array.isArray(r) ? r : []) })
      .catch(() => { if (!cancelled) setError("Couldn't load your work.") })
    projectsApi.list()
      .then((r: any) => {
        if (!cancelled) setProjectNames(Object.fromEntries((r?.items ?? []).map((p: any) => [p.id, p.name])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [attempt])

  const scoped = useMemo(() => (sources ?? []).filter(s =>
    focus === 'extract' ? s.assigned_extractor_id === user?.id
      : focus === 'review' ? s.assigned_reviewer_id === user?.id
        : true), [sources, focus, user?.id])
  const q = useMemo(() => buildQueue(scoped, user?.id), [scoped, user?.id])

  if (error) {
    return (
      <div className="px-7 py-6 max-w-[1100px] mx-auto">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error} <button onClick={() => setAttempt(a => a + 1)} className="font-semibold underline">Retry</button>
        </div>
      </div>
    )
  }
  if (sources === null) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  const firstName = (user?.full_name ?? '').trim().split(/\s+/)[0] || 'there'
  const weekAgo = Date.now() - 7 * 86400000
  const count = (items: QueueItem[], role: 'extract' | 'review', ...statuses: string[]) =>
    items.filter(i => i.role === role && statuses.includes(i.source.status)).length
  const all = [...q.action, ...q.waiting]
  const returned = count(all, 'extract', 'changes_requested', 'needs_fixes')
  const toReview = count(all, 'review', 'ready_for_review', 'in_review')
  const inProgress = count(all, 'extract', 'extracting', 'not_started')
  const withReviewer = count(all, 'extract', 'ready_for_review', 'in_review', 'llm_verification')
  const waitingOnExtractor = count(all, 'review', 'not_started', 'extracting', 'needs_fixes', 'changes_requested')
  const approvedWeek = q.done.filter(i => i.source.approved_at && new Date(i.source.approved_at).getTime() >= weekAgo).length

  const tiles: { label: string; value: number; sub: string; tone: string }[] = []
  const T = (label: string, value: number, sub: string, tone = 'text-gray-900') => tiles.push({ label, value, sub, tone })
  if (isExtractor || !isReviewer) {
    T('Returned to you', returned, 'fix these first', returned ? 'text-red-600' : 'text-gray-900')
  }
  if (isReviewer) T('To review', toReview, 'ready for your check', toReview ? 'text-purple-600' : 'text-gray-900')
  if (isExtractor || !isReviewer) T('In progress', inProgress, 'extracting or not started', 'text-blue-600')
  if (isExtractor && !both) T('With reviewer', withReviewer, 'waiting on a review', 'text-amber-600')
  if (isReviewer && !both) T('Waiting on extractor', waitingOnExtractor, 'not ready to review yet', 'text-amber-600')
  T('Approved', q.done.length, approvedWeek ? `${approvedWeek} this week` : 'all time', 'text-emerald-600')

  const actionCount = q.action.length
  const parts: string[] = []
  if (returned) parts.push(`${returned} returned for fixes`)
  if (toReview) parts.push(`${toReview} to review`)
  if (inProgress && !returned) parts.push(`${inProgress} to extract`)
  const summary = actionCount === 0
    ? (sources.length === 0 ? "Nothing is assigned to you yet — an admin will assign work when it's ready." : "You're all caught up.")
    : `You have ${plural(actionCount, 'thing')} to do${parts.length ? ': ' + parts.join(', ') : ''}.`

  const roleChips = [isExtractor && 'Extractor', isReviewer && 'Reviewer'].filter(Boolean) as string[]
  const top = q.action[0]

  return (
    <div className="px-7 py-6 max-w-[1100px] mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 m-0">{hello()}, {firstName}</h1>
          <p className="text-sm text-gray-500 mt-1 mb-0">{summary}</p>
          {roleChips.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {roleChips.map(r => (
                <span key={r} className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md',
                  r === 'Extractor' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700')}>{r}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAttempt(a => a + 1)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link to="/sources"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
            <Database className="w-3.5 h-3.5" /> All my sources
          </Link>
        </div>
      </div>

      {top && <UpNext item={top} rest={q.action.length - 1} projectName={projectNames[top.source.project_id]} />}

      <div className={cn('grid gap-3', tiles.length >= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3')}>
        {tiles.map(t => <Tile key={t.label} {...t} />)}
      </div>

      {both && (
        <div className="flex items-center gap-1.5" role="group" aria-label="Show">
          {([['all', 'Everything'], ['extract', 'To extract'], ['review', 'To review']] as [Focus, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFocus(k)} aria-pressed={focus === k}
              className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition',
                focus === k ? 'bg-brand-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
              {label}
            </button>
          ))}
        </div>
      )}

      <MyQueue sources={scoped} userId={user?.id} projectNames={projectNames} />

      {sources.length > 0 && (
        <p className="text-xs text-gray-400 m-0">
          {isExtractor && !isReviewer && 'Tip: on any Xtrium source, the SOP tab lists exactly what to capture and where to find it.'}
          {isReviewer && !isExtractor && 'Tip: approve a source only after checking its records against the source website.'}
          {both && 'Tip: use the filter above to focus on just extracting or just reviewing.'}
        </p>
      )}
    </div>
  )
}
