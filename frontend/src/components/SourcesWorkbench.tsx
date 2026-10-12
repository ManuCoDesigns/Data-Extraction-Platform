import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, ExternalLink, FileText, Globe } from 'lucide-react'
import type { Source } from '@/types'
import { Avatar, Badge, cn, safeFromNow } from '@/components/ui'
import { saveNav, isTyping } from '@/lib/sourceNav'

// One list you can drive from the keyboard, with a live preview of the highlighted source.
// Moving through the list never leaves the page; opening a source keeps the list order so the
// source page can step to the next one.

const STAGES = [
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

const stageOf = (s: Source) => {
  const i = STAGES.findIndex(st => st.statuses.includes(s.status))
  return i < 0 ? 0 : i
}
const hostOf = (u?: string) => (u ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')
const field = (s: Source, k: string) => (s as any)[k] as string | undefined
// "3h", "2d", "1mo": short enough to stay on one line.
function ago(iso?: string): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`
}

interface Props {
  sources: Source[]
  projectNames: Record<string, string>
  showProject: boolean
  backTo: string
}

export function SourcesWorkbench({ sources, projectNames, showProject: wantProject, backTo }: Props) {
  const navigate = useNavigate()
  // Naming the project on every row only helps when the list spans more than one.
  const showProject = wantProject && new Set(sources.map(s => s.project_id)).size > 1
  const [stage, setStage] = useState<number | 'all'>('all')
  const [shown, setShown] = useState<Record<number, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(SEL_KEY) } catch { return null }
  })
  const listRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => STAGES.map((_, i) => sources.filter(s => stageOf(s) === i)), [sources])
  const blocks = useMemo(
    () => STAGES.map((st, i) => ({ st, i, items: groups[i] })).filter(b => (stage === 'all' ? b.items.length > 0 : b.i === stage)),
    [groups, stage],
  )
  const rendered = blocks.map(b => b.items.slice(0, shown[b.i] ?? PAGE))
  const flat = rendered.flat()
  const full = blocks.flatMap(b => b.items)
  const sel = flat.find(s => s.id === selectedId) ?? flat[0] ?? null

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
      const i = flat.findIndex(s => s.id === sel?.id)
      const move = (n: number) => { const t = flat[Math.max(0, Math.min(flat.length - 1, n))]; if (t) setSelectedId(t.id) }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(i + 1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(i - 1) }
      else if (e.key === 'Enter' && sel && !(e.target as HTMLElement)?.closest?.('a,button')) { e.preventDefault(); open(sel) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const chip = (key: number | 'all', label: string, n: number) => (
    <button key={String(key)} type="button" onClick={() => setStage(key)} aria-pressed={stage === key}
      className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition whitespace-nowrap',
        stage === key ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
      {label} <span className={cn('tabular-nums ml-1', stage === key ? 'text-gray-300' : 'text-gray-400')}>{n}</span>
    </button>
  )

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 overflow-x-auto scrollbar-thin">
          {chip('all', 'All', sources.length)}
          {STAGES.map((st, i) => chip(i, st.label, groups[i].length))}
        </div>

        <div ref={listRef} role="listbox" aria-label="Sources" className="max-h-[calc(100vh-290px)] min-h-[320px] overflow-y-auto scrollbar-thin">
          {flat.length === 0 && <p className="px-5 py-10 text-sm text-gray-400 text-center m-0">Nothing in this stage.</p>}
          {blocks.map((b, bi) => {
            const items = rendered[bi]
            const remaining = b.items.length - items.length
            return (
              <section key={b.i}>
                <h3 className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 m-0 bg-white/95 backdrop-blur border-b border-gray-100 text-xs font-semibold text-gray-600">
                  <span className={cn('w-2 h-2 rounded-full', b.st.rail)} />
                  {b.st.label}
                  <span className="tabular-nums text-gray-400 font-medium">{b.items.length}</span>
                </h3>
                {items.map(s => {
                  const active = sel?.id === s.id
                  const owner = b.i === 2 ? (s.assigned_reviewer_name ?? s.assigned_extractor_name) : s.assigned_extractor_name
                  const country = field(s, 'country')
                  return (
                    <div key={s.id} data-id={s.id} role="option" aria-selected={active}
                      onClick={() => pick(s)} onDoubleClick={() => open(s)}
                      className={cn('group relative flex items-center gap-3 pl-4 pr-3 py-2.5 cursor-pointer border-b border-gray-50 transition-colors',
                        active ? 'bg-brand-50/70' : 'hover:bg-gray-50')}>
                      <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', b.st.rail, !active && 'opacity-50')} />
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm m-0 truncate', active ? 'font-semibold text-gray-900' : 'font-medium text-gray-800')}>{s.name}</p>
                        <p className="text-xs text-gray-400 m-0 mt-0.5 flex items-center gap-x-3 gap-y-0 min-w-0">
                          {showProject && projectNames[s.project_id] && <span className="text-brand-600 truncate">{projectNames[s.project_id]}</span>}
                          {hostOf(s.website_url) && <span className="truncate">{hostOf(s.website_url)}</span>}
                          {country && <span className="shrink-0">{country}</span>}
                        </p>
                      </div>
                      {s.total_records > 0 && (
                        <span className="text-xs tabular-nums text-gray-500 hidden sm:block shrink-0">
                          <span className="text-emerald-600 font-semibold">{s.valid_records}</span>/{s.total_records}
                        </span>
                      )}
                      {owner
                        ? <span title={owner}><Avatar name={owner} size="sm" /></span>
                        : b.i === 0
                          ? <span className="w-7 shrink-0" />
                          : <span title="Not assigned" className="w-7 h-7 rounded-full border border-dashed border-gray-300 shrink-0" />}
                      <span className="w-9 text-right text-xs tabular-nums text-gray-400 hidden md:block shrink-0">{ago(s.updated_at)}</span>
                      <Link to={`/projects/${s.project_id}/sources/${s.id}`} onClick={e => { e.stopPropagation(); saveNav(full, backTo, 'sources'); try { sessionStorage.setItem(SEL_KEY, s.id) } catch { /* ignore */ } }}
                        aria-label={`Open ${s.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-gray-400 hover:text-brand-600 hover:bg-white transition shrink-0">
                        <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </div>
                  )
                })}
                {remaining > 0 && (
                  <button type="button" onClick={() => setShown(p => ({ ...p, [b.i]: (p[b.i] ?? PAGE) + PAGE }))}
                    className="w-full py-2.5 text-xs font-semibold text-brand-600 hover:bg-gray-50 transition border-b border-gray-50">
                    Show {Math.min(PAGE, remaining)} more of {remaining}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      </div>

      <aside className="hidden lg:block lg:sticky lg:top-6">
        {sel ? <Peek s={sel} projectName={showProject ? projectNames[sel.project_id] : undefined} onOpen={() => open(sel)} /> : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-10 text-center text-sm text-gray-400">Select a source to see it here.</div>
        )}
      </aside>
    </div>
  )
}

function Peek({ s, projectName, onOpen }: { s: Source; projectName?: string; onOpen: () => void }) {
  const si = stageOf(s)
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
      <div className={cn('h-1', STAGES[si].rail)} />
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
        </div>

        <div>
          <div className="flex gap-1.5">
            {STAGES.map((st, i) => <div key={st.label} className={cn('h-1.5 flex-1 rounded-full', i <= si ? st.rail : 'bg-gray-100')} />)}
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1.5">
            {STAGES.map((st, i) => <span key={st.label} className={cn(i === si && 'text-gray-800 font-semibold')}>{st.label}</span>)}
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
