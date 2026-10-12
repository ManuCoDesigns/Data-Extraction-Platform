import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownUp, ArrowUpRight, CheckCheck, Check, ExternalLink, FileText, Globe, Link2Off } from 'lucide-react'
import type { Source } from '@/types'
import { Avatar, Badge, cn, safeFromNow } from '@/components/ui'
import { saveNav, isTyping } from '@/lib/sourceNav'
import { BulkBar } from '@/components/enh/BulkBar'

// Link problems found by the link checker (see Data health). Only these show on the cards.
const LINK_FLAGS: Record<string, { label: string; cls: string }> = {
  login: { label: 'Link needs login', cls: 'text-amber-600 bg-amber-50' },
  blocked: { label: 'Link blocked', cls: 'text-red-600 bg-red-50' },
  dead: { label: 'Link not found', cls: 'text-red-600 bg-red-50' },
}

// The Sources workbench: summary cards that double as filters, a project filter, and one list
// ordered by what needs attention first. Peer-reviewed sources (a reviewer has approved records
// and an admin still has to sign off) come first, then extracted sources waiting for a reviewer,
// then everything else. Inside each group the longest-waiting source is on top.
// The whole list is keyboard-driven, with a live preview of the highlighted source.

interface Tier {
  key: string
  label: string
  hint: string
  rail: string      // solid colour for rails and dots
  text: string      // matching text colour for numbers
  ring: string      // selected-card ring
}

const TIERS: Tier[] = [
  { key: 'final', label: 'Peer reviewed', hint: 'Peers are done. Needs admin sign-off', rail: 'bg-indigo-500', text: 'text-indigo-600', ring: 'ring-indigo-300' },
  { key: 'extracted', label: 'Extracted', hint: 'Done by the extractor. Needs peer review', rail: 'bg-purple-500', text: 'text-purple-600', ring: 'ring-purple-300' },
  { key: 'returned', label: 'Sent back', hint: 'Needs fixes from the extractor', rail: 'bg-amber-500', text: 'text-amber-600', ring: 'ring-amber-300' },
  { key: 'extracting', label: 'Extracting', hint: 'Being worked on now', rail: 'bg-blue-500', text: 'text-blue-600', ring: 'ring-blue-300' },
  { key: 'todo', label: 'Not started', hint: 'Waiting for an extractor', rail: 'bg-gray-300', text: 'text-gray-600', ring: 'ring-gray-300' },
  { key: 'done', label: 'Approved', hint: 'Finished', rail: 'bg-emerald-500', text: 'text-emerald-600', ring: 'ring-emerald-300' },
]
const T_FINAL = 0, T_EXTRACTED = 1, T_TODO = 4, T_DONE = 5

// The four steps a source moves through, shown as a progress bar in the preview.
const PIPE = [
  { label: 'To do', statuses: ['not_started'], rail: 'bg-gray-300' },
  { label: 'Extracting', statuses: ['extracting', 'needs_fixes'], rail: 'bg-blue-500' },
  { label: 'In review', statuses: ['ready_for_review', 'in_review', 'changes_requested', 'llm_verification'], rail: 'bg-purple-500' },
  { label: 'Done', statuses: ['approved'], rail: 'bg-emerald-500' },
]

type Variant = 'gray' | 'amber' | 'red' | 'blue' | 'purple' | 'green' | 'indigo'
const STATUS: Record<string, { label: string; variant: Variant }> = {
  not_started: { label: 'Not started', variant: 'gray' },
  extracting: { label: 'Extracting', variant: 'blue' },
  needs_fixes: { label: 'Needs fixes', variant: 'amber' },
  ready_for_review: { label: 'Ready for review', variant: 'indigo' },
  in_review: { label: 'In review', variant: 'purple' },
  changes_requested: { label: 'Changes requested', variant: 'red' },
  llm_verification: { label: 'Checking', variant: 'purple' },
  approved: { label: 'Approved', variant: 'green' },
}

const PAGE = 40
const SEL_KEY = 'dx.sourcesSel'
const SORT_KEY = 'dx.sourcesSort'
const DAY = 86400000

type SortMode = 'wait' | 'new'

const peerCount = (s: Source) => Number((s as any).peer_reviewed_records ?? 0) || 0
const peerTotal = (s: Source) => s.peer_total ?? 0
const peerDone = (s: Source) => s.peer_submitted ?? 0
// Ready for the admin: every assigned peer has submitted their review. Older sources with no peers
// set up fall back to "a reviewer approved some records".
const readyForSignOff = (s: Source) => (s.peer_gated ? peerTotal(s) > 0 && peerDone(s) === peerTotal(s) : peerCount(s) > 0)

function tierOf(s: Source): number {
  if (s.status === 'approved') return T_DONE
  if (readyForSignOff(s)) return T_FINAL
  switch (s.status) {
    case 'ready_for_review': case 'in_review': case 'llm_verification': return T_EXTRACTED
    case 'changes_requested': case 'needs_fixes': return 2
    case 'extracting': return 3
    default: return T_TODO
  }
}
const pipeOf = (s: Source) => {
  const i = PIPE.findIndex(st => st.statuses.includes(s.status))
  return i < 0 ? 0 : i
}
// The moment a source started waiting in its current group.
function sinceOf(s: Source, tier: number): number {
  const raw = tier === T_FINAL ? ((s as any).peer_reviewed_at ?? s.updated_at)
    : tier === T_EXTRACTED ? (s.extraction_completed_at ?? s.updated_at)
      : s.updated_at
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

const hostOf = (u?: string) => (u ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')
const field = (s: Source, k: string) => (s as any)[k] as string | undefined
// "3h", "2d", "1mo": short enough to stay on one line.
function ago(t: number): string {
  if (!t) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`
}
// Old work that is still waiting on someone turns amber, then red.
function waitTone(t: number, tier: number): string {
  if (!t || tier === T_DONE || tier > 2) return 'text-gray-400'
  const age = Date.now() - t
  return age >= 7 * DAY ? 'text-red-600 font-semibold' : age >= 3 * DAY ? 'text-amber-600 font-semibold' : 'text-gray-400'
}

interface Props {
  sources: Source[]
  projectNames: Record<string, string>
  showProject: boolean
  backTo: string
  projectFilter?: string
  onProjectFilter?: (id: string) => void
  linkStatus?: Record<string, string>   // source id -> ok | login | blocked | dead | ...
  canBulk?: boolean                     // admins can tick several sources and assign people at once
  onChanged?: () => void
}

export function SourcesWorkbench({ sources: all, projectNames, showProject: wantProject, backTo, projectFilter = '', onProjectFilter, linkStatus, canBulk, onChanged }: Props) {
  const navigate = useNavigate()
  const [tier, setTier] = useState<number | 'all'>('all')
  const [shown, setShown] = useState<Record<number, number>>({})
  const [sort, setSort] = useState<SortMode>(() => {
    try { return localStorage.getItem(SORT_KEY) === 'new' ? 'new' : 'wait' } catch { return 'wait' }
  })
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(SEL_KEY) } catch { return null }
  })
  const listRef = useRef<HTMLDivElement>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggleChecked = (id: string) => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const setMany = (ids: string[], on: boolean) => setChecked(s => { const n = new Set(s); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return n })

  // Projects present in the list, with how many sources each has (before the project filter).
  const projectCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of all) m.set(s.project_id, (m.get(s.project_id) ?? 0) + 1)
    return [...m.entries()]
      .map(([id, n]) => ({ id, n, name: projectNames[id] ?? 'Project' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [all, projectNames])
  const multiProject = projectCounts.length > 1
  const canFilterProject = multiProject && !!onProjectFilter
  const sources = useMemo(
    () => (projectFilter && canFilterProject ? all.filter(s => s.project_id === projectFilter) : all),
    [all, projectFilter, canFilterProject],
  )
  // Naming the project on every row only helps when the list spans more than one.
  const showProject = wantProject && multiProject && !(projectFilter && canFilterProject)

  const groups = useMemo(() => {
    const g: Source[][] = TIERS.map(() => [])
    for (const s of sources) g[tierOf(s)].push(s)
    g.forEach((items, i) => {
      const dir = i === T_DONE || sort === 'new' ? -1 : 1
      items.sort((a, b) => dir * (sinceOf(a, i) - sinceOf(b, i)))
    })
    return g
  }, [sources, sort])

  const blocks = useMemo(
    () => TIERS.map((t, i) => ({ t, i, items: groups[i] })).filter(b => (tier === 'all' ? b.items.length > 0 : b.i === tier)),
    [groups, tier],
  )
  const rendered = blocks.map(b => b.items.slice(0, shown[b.i] ?? PAGE))
  const flat = rendered.flat()
  const full = blocks.flatMap(b => b.items)
  const sel = flat.find(s => s.id === selectedId) ?? flat[0] ?? null
  useEffect(() => {
    if (!checked.size) return
    const ids = new Set(all.map(s => s.id))
    const keep = [...checked].filter(i => ids.has(i))
    if (keep.length !== checked.size) setChecked(new Set(keep))
  }, [all])
  const nameById = useMemo(() => Object.fromEntries(all.map(s => [s.id, s.name])), [all])

  const open = (s: Source) => {
    saveNav(full, backTo, 'sources')
    try { sessionStorage.setItem(SEL_KEY, s.id) } catch { /* ignore */ }
    navigate(`/projects/${s.project_id}/sources/${s.id}`)
  }
  const pick = (s: Source) => {
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1024px)').matches : true
    if (wide) setSelectedId(s.id)
    else open(s)
  }
  const changeSort = () => {
    const next: SortMode = sort === 'wait' ? 'new' : 'wait'
    setSort(next)
    try { localStorage.setItem(SORT_KEY, next) } catch { /* ignore */ }
  }

  // Keep the highlighted row in view while moving with the keyboard.
  useEffect(() => {
    if (!sel) return
    const el = listRef.current?.querySelector(`[data-id="${sel.id}"]`) as HTMLElement | null
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [sel?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.key === '/') { e.preventDefault(); document.getElementById('sources-search')?.focus(); return }
      if (canBulk && (e.key === 'x' || e.key === 'X') && sel) { e.preventDefault(); toggleChecked(sel.id); return }
      if (canBulk && e.key === 'Escape' && checked.size) { setChecked(new Set()); return }
      const i = flat.findIndex(s => s.id === sel?.id)
      const move = (n: number) => { const t = flat[Math.max(0, Math.min(flat.length - 1, n))]; if (t) setSelectedId(t.id) }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(i + 1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(i - 1) }
      else if (e.key === 'Enter' && sel && !(e.target as HTMLElement)?.closest?.('a,button')) { e.preventDefault(); open(sel) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="space-y-4">
      {/* Summary cards: counts for the current project, and a one-click filter. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" role="group" aria-label="Filter by group">
        {TIERS.map((t, i) => {
          const items = groups[i]
          const active = tier === i
          const oldest = i === T_DONE ? 0 : items.reduce((m, s) => { const v = sinceOf(s, i); return v && (!m || v < m) ? v : m }, 0)
          return (
            <button key={t.key} type="button" data-tier={t.key} aria-pressed={active} disabled={items.length === 0 && !active}
              onClick={() => setTier(active ? 'all' : i)}
              className={cn('relative text-left bg-white rounded-2xl border px-4 pt-4 pb-3 shadow-card transition overflow-hidden',
                active ? cn('border-transparent ring-2', t.ring) : 'border-gray-100 hover:border-gray-200 hover:-translate-y-px',
                items.length === 0 && !active && 'opacity-60 cursor-default hover:translate-y-0')}>
              <span className={cn('absolute top-0 left-0 right-0 h-1', t.rail)} />
              <span className="flex items-baseline gap-2">
                <span className={cn('text-2xl font-extrabold tabular-nums leading-none', items.length ? t.text : 'text-gray-300')}>{items.length}</span>
                <span className="text-sm font-semibold text-gray-800 truncate">{t.label}</span>
              </span>
              <span className="block text-[11px] text-gray-400 mt-1.5 leading-snug">
                {items.length === 0 ? 'None right now' : oldest ? `Oldest waiting ${ago(oldest)}` : t.hint}
              </span>
            </button>
          )
        })}
      </div>

      {/* Project filter and sort. */}
      {(canFilterProject || sources.length > 1) && (
        <div className="flex items-center gap-x-3 gap-y-2 flex-wrap sm:flex-nowrap">
          {canFilterProject ? (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin w-full sm:w-auto sm:flex-1 min-w-0 py-0.5" role="group" aria-label="Filter by project">
              <button type="button" data-project="" aria-pressed={!projectFilter} onClick={() => onProjectFilter!('')}
                className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition whitespace-nowrap border',
                  !projectFilter ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                All projects <span className={cn('tabular-nums ml-1', !projectFilter ? 'text-gray-300' : 'text-gray-400')}>{all.length}</span>
              </button>
              {projectCounts.map(p => (
                <button key={p.id} type="button" data-project={p.id} aria-pressed={projectFilter === p.id} onClick={() => onProjectFilter!(p.id)}
                  className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition whitespace-nowrap border max-w-[220px] truncate',
                    projectFilter === p.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                  {p.name} <span className={cn('tabular-nums ml-1', projectFilter === p.id ? 'text-gray-300' : 'text-gray-400')}>{p.n}</span>
                </button>
              ))}
            </div>
          ) : <div className="hidden sm:block flex-1" />}
          <button type="button" data-sort={sort} onClick={changeSort}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition whitespace-nowrap shrink-0">
            <ArrowDownUp className="w-3.5 h-3.5" /> {sort === 'wait' ? 'Longest waiting first' : 'Newest first'}
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <div ref={listRef} role="listbox" aria-label="Sources"
          className="rounded-2xl bg-gray-50/80 border border-gray-100 max-h-[calc(100vh-380px)] min-h-[340px] overflow-y-auto scrollbar-thin">
          {flat.length === 0 && <p className="px-5 py-10 text-sm text-gray-400 text-center m-0">Nothing in this group.</p>}
          {blocks.map((b, bi) => {
            const items = rendered[bi]
            const remaining = b.items.length - items.length
            return (
              <section key={b.i} data-group={b.t.key}>
                <h3 className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 m-0 bg-gray-50/95 backdrop-blur text-xs font-semibold text-gray-700">
                  <span className={cn('w-2 h-2 rounded-full', b.t.rail)} />
                  <span className="whitespace-nowrap">{b.t.label}</span>
                  <span className="tabular-nums text-gray-400 font-medium">{b.items.length}</span>
                  <span className="hidden sm:inline text-gray-400 font-normal truncate">{b.t.hint}</span>
                  {canBulk && b.i !== T_DONE && b.items.length > 0 && (() => {
                    const ids = b.items.map(s => s.id)
                    const all_ = ids.every(i => checked.has(i))
                    return (
                      <button type="button" onClick={() => setMany(ids, !all_)}
                        className="ml-auto text-[11px] font-semibold text-brand-600 hover:text-brand-700 px-2 py-0.5 rounded-md hover:bg-brand-50 transition whitespace-nowrap">
                        {all_ ? 'Clear group' : `Select ${ids.length}`}
                      </button>
                    )
                  })()}
                </h3>
                <div className="px-3 pb-3 space-y-2">
                  {items.map(s => {
                    const active = sel?.id === s.id
                    const peer = peerCount(s)
                    const pt = peerTotal(s), pd = peerDone(s)
                    const pill = b.i === T_FINAL
                      ? (s.peer_gated ? `All ${pt} ${pt === 1 ? 'peer' : 'peers'} done` : peer > 0 ? `${peer} peer reviewed` : null)
                      : (s.peer_gated && pt > 0 && b.i <= 2 ? `${pd}/${pt} peers` : null)
                    const since = sinceOf(s, b.i)
                    const owner = b.i <= T_EXTRACTED ? (s.assigned_reviewer_name ?? s.assigned_extractor_name) : s.assigned_extractor_name
                    const country = field(s, 'country')
                    const pct = s.total_records > 0 ? Math.round((s.valid_records / s.total_records) * 100) : 0
                    return (
                      <div key={s.id} data-id={s.id} role="option" aria-selected={active}
                        onClick={() => pick(s)} onDoubleClick={() => open(s)}
                        className={cn('group relative flex items-center gap-3 pl-5 pr-3 py-3 rounded-xl border bg-white cursor-pointer transition',
                          active ? 'border-brand-300 shadow-card ring-1 ring-brand-200' : 'border-gray-100 hover:border-gray-200 hover:shadow-card')}>
                        <span className={cn('absolute left-1.5 top-2.5 bottom-2.5 w-1 rounded-full', b.t.rail)} />
                        {canBulk && s.status !== 'approved' && (
                          <button type="button" role="checkbox" aria-checked={checked.has(s.id)} aria-label={`Select ${s.name}`}
                            onClick={e => { e.stopPropagation(); toggleChecked(s.id) }} onDoubleClick={e => e.stopPropagation()}
                            className={cn('w-5 h-5 -ml-1 rounded-md border flex items-center justify-center shrink-0 transition',
                              checked.has(s.id) ? 'bg-brand-600 border-brand-600 text-white' : cn('border-gray-300 bg-white hover:border-brand-400', checked.size === 0 && 'opacity-0 group-hover:opacity-100 focus:opacity-100'))}>
                            {checked.has(s.id) && <Check className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm m-0 truncate', active ? 'font-semibold text-gray-900' : 'font-medium text-gray-800')}>{s.name}</p>
                          <p className="text-xs text-gray-400 m-0 mt-0.5 flex items-center gap-x-3 min-w-0">
                            {showProject && projectNames[s.project_id] && <span className="text-brand-600 truncate">{projectNames[s.project_id]}</span>}
                            {hostOf(s.website_url) && <span className="truncate">{hostOf(s.website_url)}</span>}
                            {LINK_FLAGS[linkStatus?.[s.id] ?? ''] && (
                              <span title={LINK_FLAGS[linkStatus![s.id]].label} className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', LINK_FLAGS[linkStatus![s.id]].cls)}>
                                <Link2Off className="w-3 h-3" />{LINK_FLAGS[linkStatus![s.id]].label.replace('Link ', '')}
                              </span>
                            )}
                            {country && <span className="shrink-0">{country}</span>}
                          </p>
                        </div>
                        {pill && (
                          <span className={cn('hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full shrink-0',
                            b.i === T_FINAL ? 'text-indigo-700 bg-indigo-50' : 'text-gray-600 bg-gray-100')}
                            title={s.peer_gated ? 'Peer reviewers who have submitted their review' : 'Records a reviewer has approved'}>
                            <CheckCheck className="w-3 h-3" /> {pill}
                          </span>
                        )}
                        {s.total_records > 0 && (
                          <span className="hidden sm:flex flex-col items-end gap-1 shrink-0 w-14" title={`${s.valid_records} of ${s.total_records} records valid`}>
                            <span className="text-xs tabular-nums text-gray-500"><span className="text-emerald-600 font-semibold">{s.valid_records}</span>/{s.total_records}</span>
                            <span className="w-full h-1 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
                          </span>
                        )}
                        {owner
                          ? <span title={owner}><Avatar name={owner} size="sm" /></span>
                          : b.i === T_TODO
                            ? <span className="w-7 shrink-0" />
                            : <span title="Not assigned" className="w-7 h-7 rounded-full border border-dashed border-gray-300 shrink-0" />}
                        <span className={cn('w-9 text-right text-xs tabular-nums hidden md:block shrink-0', waitTone(since, b.i))} title="Time in this group">{ago(since)}</span>
                        <Link to={`/projects/${s.project_id}/sources/${s.id}`} onClick={e => { e.stopPropagation(); saveNav(full, backTo, 'sources'); try { sessionStorage.setItem(SEL_KEY, s.id) } catch { /* ignore */ } }}
                          aria-label={`Open ${s.name}`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-50 transition shrink-0">
                          <ArrowUpRight className="w-4 h-4" />
                        </Link>
                      </div>
                    )
                  })}
                  {remaining > 0 && (
                    <button type="button" onClick={() => setShown(p => ({ ...p, [b.i]: (p[b.i] ?? PAGE) + PAGE }))}
                      className="w-full py-2.5 text-xs font-semibold text-brand-600 bg-white rounded-xl border border-dashed border-gray-200 hover:bg-gray-50 transition">
                      Show {Math.min(PAGE, remaining)} more of {remaining}
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <aside className="hidden lg:block lg:sticky lg:top-6">
          {sel ? <Peek s={sel} projectName={showProject ? projectNames[sel.project_id] : undefined} onOpen={() => open(sel)} link={linkStatus?.[sel.id]} /> : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-10 text-center text-sm text-gray-400">Select a source to see it here.</div>
          )}
        </aside>
      </div>
      {canBulk && checked.size > 0 && (
        <BulkBar ids={[...checked]} names={nameById} onClear={() => setChecked(new Set())} onDone={() => onChanged?.()} />
      )}
    </div>
  )
}

function Peek({ s, projectName, onOpen, link }: { s: Source; projectName?: string; onOpen: () => void; link?: string }) {
  const si = pipeOf(s)
  const tier = tierOf(s)
  const peer = peerCount(s)
  const meta = STATUS[s.status] ?? STATUS.not_started
  const xtriumId = field(s, 'external_ref_id')
  const tags = [field(s, 'category'), field(s, 'type'), field(s, 'country')].filter(Boolean) as string[]
  const pct = s.total_records > 0 ? Math.round((s.valid_records / s.total_records) * 100) : 0
  const Person = ({ role, name }: { role: string; name?: string }) => (
    <div className="flex items-center gap-2.5">
      {name ? <Avatar name={name} size="sm" /> : <span className="w-7 h-7 rounded-full border border-dashed border-gray-300 shrink-0" />}
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 m-0">{role}</p>
        <p className={cn('text-sm m-0 truncate', name ? 'text-gray-800 font-medium' : 'text-gray-400')}>{name ?? 'Not assigned'}</p>
      </div>
    </div>
  )
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden" aria-live="polite">
      <div className={cn('h-1', TIERS[tier].rail)} />
      <div className="px-6 pt-5 pb-6 space-y-5">
        <div className="space-y-2">
          {projectName && <p className="text-xs font-medium text-brand-600 m-0">{projectName}</p>}
          <h2 className="text-lg font-bold text-gray-900 m-0 leading-snug break-words">{s.name}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            {tags.map(t => <span key={t} className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">{t}</span>)}
          </div>
          {s.website_url && (
            <a href={s.website_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 max-w-full">
              <Globe className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{hostOf(s.website_url)}</span> <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          )}
          {LINK_FLAGS[link ?? ''] && (
            <p className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg m-0', LINK_FLAGS[link!].cls)}>
              <Link2Off className="w-3.5 h-3.5" /> {LINK_FLAGS[link!].label}. Ask the client for another way in, or open it yourself and mark it in Data health.
            </p>
          )}
        </div>

        {s.peer_gated && peerTotal(s) > 0 && tier !== T_DONE && (
          <div className={cn('flex items-start gap-2.5 rounded-xl px-3.5 py-3', tier === T_FINAL ? 'bg-indigo-50' : 'bg-gray-50')}>
            <CheckCheck className={cn('w-4 h-4 mt-0.5 shrink-0', tier === T_FINAL ? 'text-indigo-600' : 'text-gray-400')} />
            <p className={cn('text-sm m-0', tier === T_FINAL ? 'text-indigo-900' : 'text-gray-700')}>
              {tier === T_FINAL
                ? <>All <span className="font-bold tabular-nums">{peerTotal(s)}</span> peer {peerTotal(s) === 1 ? 'reviewer has' : 'reviewers have'} submitted. Waiting for your sign-off.</>
                : <><span className="font-bold tabular-nums">{peerDone(s)}</span> of <span className="tabular-nums">{peerTotal(s)}</span> peer reviewers have submitted.</>}
            </p>
          </div>
        )}
        {!s.peer_gated && peer > 0 && tier === T_FINAL && (
          <div className="flex items-start gap-2.5 rounded-xl bg-indigo-50 px-3.5 py-3">
            <CheckCheck className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
            <p className="text-sm text-indigo-900 m-0">
              <span className="font-bold tabular-nums">{peer}</span> {peer === 1 ? 'record is' : 'records are'} peer reviewed and waiting for final sign-off.
            </p>
          </div>
        )}

        <div>
          <div className="flex gap-1.5">
            {PIPE.map((st, i) => <div key={st.label} className={cn('h-1.5 flex-1 rounded-full', i <= si ? st.rail : 'bg-gray-100')} />)}
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1.5">
            {PIPE.map((st, i) => <span key={st.label} className={cn(i === si && 'text-gray-800 font-semibold')}>{st.label}</span>)}
          </div>
        </div>

        <div>
          {s.total_records > 0 ? (
            <>
              <p className="text-sm text-gray-700 m-0">
                <span className="font-bold text-emerald-600 tabular-nums">{s.valid_records}</span> of <span className="tabular-nums">{s.total_records}</span> records valid
                {s.invalid_records > 0 && <span className="text-amber-600">, {s.invalid_records} need fixes</span>}
              </p>
              <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden mt-2">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : <p className="text-sm text-gray-400 m-0">No records yet.</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Person role="Extractor" name={s.assigned_extractor_name} />
          <Person role="Reviewer" name={s.assigned_reviewer_name} />
        </div>

        <p className="text-xs text-gray-400 m-0">
          Updated {safeFromNow(s.updated_at)}{xtriumId ? `. Xtrium item #${xtriumId}` : ''}
        </p>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpen}
            className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white px-4 py-2.5 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 hover:opacity-95 transition">
            Open source <ArrowUpRight className="w-4 h-4" />
          </button>
          {xtriumId && (
            <Link to={`/projects/${s.project_id}/sources/${s.id}/sop`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition">
              <FileText className="w-4 h-4" /> SOP
            </Link>
          )}
        </div>
        <p className="text-[11px] text-gray-400 m-0">Arrow keys move through the list, Enter opens, / searches.</p>
      </div>
    </div>
  )
}
