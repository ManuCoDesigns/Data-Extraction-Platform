import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, FolderKanban, History, LayoutDashboard, Search, Zap } from 'lucide-react'
import { getRecent } from '@/lib/recent'
import { projectsApi, sourcesApi } from '@/api/client'
import { cn } from '@/components/ui'

interface Page { to: string; label: string }
export interface PaletteAction { id: string; label: string; hint?: string; run: () => void }
interface Hit { key: string; group: 'Recent' | 'Actions' | 'Pages' | 'Projects' | 'Sources'; title: string; sub?: string; to?: string; run?: () => void }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
/** Every typed word must appear somewhere; names that start with the text rank first. */
function score(text: string, q: string): number {
  const t = norm(text); if (!q) return 1
  const words = q.split(' ')
  if (!words.every(w => t.includes(w))) return 0
  return t.startsWith(q) ? 3 : t.split(' ').some(w => w.startsWith(words[0])) ? 2 : 1
}

/** Ctrl+K (or Cmd+K): jump to any page, project or source by typing a few letters. */
export function CommandPalette({ pages, open, onClose, actions = [] }: { pages: Page[]; open: boolean; onClose: () => void; actions?: PaletteAction[] }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [sources, setSources] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQ(''); setActive(0)
    setTimeout(() => input.current?.focus(), 0)
    let off = false
    Promise.all([sourcesApi.list().catch(() => []), projectsApi.list().catch(() => ({ items: [] }))]).then(([s, p]: any[]) => {
      if (off) return
      setSources(Array.isArray(s) ? s : []); setProjects(p?.items ?? []); setLoaded(true)
    })
    return () => { off = true }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    const nq = norm(q)
    const pname = Object.fromEntries(projects.map(p => [p.id, p.name]))
    const rank = <T,>(items: T[], text: (x: T) => string) =>
      items.map(i => [i, score(text(i), nq)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([i]) => i)
    const out: Hit[] = []
    if (!nq) {
      const byId = Object.fromEntries(sources.map(s => [s.id, s]))
      getRecent().map(v => byId[v.sid]).filter(Boolean).slice(0, 5).forEach((s: any) => out.push({
        key: 'r' + s.id, group: 'Recent', title: s.name, sub: `${pname[s.project_id] ?? ''} · ${String(s.status).replace(/_/g, ' ')}`, to: `/projects/${s.project_id}/sources/${s.id}`,
      }))
    }
    rank(actions, a => a.label).slice(0, nq ? 3 : 4).forEach(a => out.push({ key: 'a' + a.id, group: 'Actions', title: a.label, sub: a.hint, run: a.run }))
    rank(pages, p => p.label).slice(0, nq ? 4 : 6).forEach(p => out.push({ key: 'p' + p.to, group: 'Pages', title: p.label, to: p.to }))
    if (nq) {
      rank(projects, p => p.name).slice(0, 4).forEach(p => out.push({ key: 'j' + p.id, group: 'Projects', title: p.name, sub: `${p.total_sources ?? 0} sources`, to: `/projects/${p.id}/sources` }))
      rank(sources, s => `${s.name} ${s.website_url ?? ''}`).slice(0, 8).forEach(s => out.push({
        key: 's' + s.id, group: 'Sources', title: s.name, sub: `${pname[s.project_id] ?? ''} · ${String(s.status).replace(/_/g, ' ')}`, to: `/projects/${s.project_id}/sources/${s.id}`,
      }))
    }
    return out
  }, [q, pages, projects, sources, actions])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  if (!open) return null
  const go = (h?: Hit) => { if (!h) return; onClose(); if (h.run) h.run(); else if (h.to) navigate(h.to) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] animate-fade-in" aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Quick search" onKeyDown={onKey}
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-float border border-gray-100 overflow-hidden animate-slide-up">
        <div className="flex items-center gap-3 px-4 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search sources, projects and pages"
            role="combobox" aria-expanded="true" aria-controls="qs-list" aria-activedescendant={hits[active] ? `qs-${hits[active].key}` : undefined}
            className="flex-1 py-4 text-sm bg-transparent outline-none placeholder:text-gray-400" />
          <kbd className="text-[10px] font-semibold text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul id="qs-list" ref={list} role="listbox" className="m-0 p-2 list-none max-h-[50vh] overflow-y-auto scrollbar-thin">
          {hits.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">{q && !loaded ? 'Searching' : q ? `Nothing matches "${q}".` : 'Start typing a company, project or page name.'}</li>
          )}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup; lastGroup = h.group
            const Icon = h.group === 'Pages' ? LayoutDashboard : h.group === 'Projects' ? FolderKanban : h.group === 'Recent' ? History : h.group === 'Actions' ? Zap : Database
            return (
              <li key={h.key} role="presentation">
                {head && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-400 m-0">{h.group}</p>}
                <button id={`qs-${h.key}`} type="button" role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => go(h)}
                  className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors', i === active ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                  <Icon className={cn('w-4 h-4 shrink-0', i === active ? 'text-brand-600' : 'text-gray-400')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{h.title}</span>
                    {h.sub && <span className="block text-xs text-gray-400 truncate">{h.sub}</span>}
                  </span>
                  {i === active && <kbd className="text-[10px] font-semibold text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Enter</kbd>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
