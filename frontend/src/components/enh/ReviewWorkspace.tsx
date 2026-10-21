import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { qualityApi, sourcesApi } from '@/api/client'
import { Blank, Chip, Panel, SelectBox, Skeletons, Tabs, type Tone } from '@/components/enh/kit'
import { CATEGORY_OPTIONS } from '@/components/enh/FlagErrorModal'
import { Button, cn, toast } from '@/components/ui'
import { ReviewSidePanel } from '@/components/enh/ReviewSidePanel'
import { SourceChat } from '@/components/enh/SourceChat'
import { SourceActivity } from '@/components/enh/SourceActivity'
import { AskClientModal } from '@/components/enh/AskClient'
import { SourceAuditPanel, applyAuditRow, type AuditRow } from '@/components/enh/SourceAuditPanel'
import { SopRulesPanel } from '@/components/enh/SopRules'

// The admin's review desk: every field that something doubts is pulled to the top, with the reason beside it,
// so a check against the real source is one click per field instead of a hunt through JSON.

const KIND: Record<string, { label: string; tone: Tone; rank: number }> = {
  recheck: { label: 'Changed since flagged', tone: 'amber', rank: -1 },
  comment: { label: 'Peer comment', tone: 'red', rank: 0 },
  mention: { label: 'Peer mentioned', tone: 'red', rank: 1 },
  finding: { label: 'Error logged', tone: 'amber', rank: 2 },
  sop: { label: 'SOP', tone: 'indigo', rank: 3 },
  system: { label: 'System check', tone: 'blue', rank: 4 },
  ai: { label: 'AI or web flag', tone: 'purple', rank: 5 },
  note: { label: 'Admin note', tone: 'indigo', rank: 6 },
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v))
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v)
const err = (e: any, d: string) => e?.response?.data?.detail || d

type Scope = 'peer_done' | 'all'

export function ReviewWorkspace({ initialSource = '', initialProject = '', onBench }: { initialSource?: string; initialProject?: string; onBench?: (on: boolean) => void }) {
  const [list, setList] = useState<any>(null)
  const [project, setProject] = useState(initialProject)
  const [scope, setScope] = useState<Scope>(initialSource ? 'all' : 'peer_done')
  const [q, setQ] = useState('')
  const [sourceId, setSourceId] = useState(initialSource)

  useEffect(() => { setList(null); qualityApi.reviewSources({ project_id: project || undefined, scope }).then(setList).catch(() => setList({ items: [], projects: [] })) }, [project, scope])
  useEffect(() => { onBench?.(!!sourceId) }, [sourceId])  // eslint-disable-line react-hooks/exhaustive-deps
  const items: any[] = useMemo(() => (list?.items ?? []).filter((s: any) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())), [list, q])
  const groups = useMemo(() => {
    const m = new Map<string, any[]>()
    items.forEach(s => { const k = s.project || 'No project'; m.set(k, [...(m.get(k) ?? []), s]) })
    return [...m.entries()]
  }, [items])
  const at = items.findIndex((x: any) => x.source_id === sourceId)
  const goSource = (delta: number) => { const n = items[at + delta]; if (n) setSourceId(n.source_id); else toast.success(delta > 0 ? 'That was the last source in this list' : 'That is the first source in this list') }

  if (sourceId) {
    return (
      <SourceDesk key={sourceId} sourceId={sourceId} onNextSource={() => goSource(1)} onPrevSource={() => goSource(-1)} position={at >= 0 ? `${at + 1} of ${items.length}` : ''}
        picker={name => <SourcePicker list={list} groups={groups} project={project} setProject={setProject} scope={scope} setScope={setScope} q={q} setQ={setQ} sourceId={sourceId} name={name} onPick={setSourceId} onClear={() => setSourceId('')} />} />
    )
  }
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Projects" className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {!list ? <div className="h-[84px] w-full rounded-2xl bg-gray-100 animate-pulse" /> : [{ id: '', name: 'All projects', sources: (list.projects ?? []).reduce((n: number, p: any) => n + p.sources, 0), peer_done: (list.projects ?? []).reduce((n: number, p: any) => n + p.peer_done, 0), open: (list.projects ?? []).reduce((n: number, p: any) => n + p.open, 0), checked: (list.projects ?? []).reduce((n: number, p: any) => n + p.checked, 0) }, ...(list.projects ?? [])].map((p: any) => (
          <button key={p.id || 'all'} type="button" role="tab" aria-selected={project === p.id} onClick={() => setProject(p.id)}
            className={cn('shrink-0 w-56 text-left rounded-2xl border px-4 py-3 bg-white transition', project === p.id ? 'border-transparent ring-2 ring-brand-400 shadow-card' : 'border-gray-100 hover:border-gray-200')}>
            <span className="block text-sm font-bold text-gray-900 truncate">{p.name || 'Untitled project'}</span>
            <span className="flex items-baseline gap-1.5 mt-1.5"><span className="text-2xl font-extrabold tabular-nums text-emerald-600 leading-none">{p.peer_done}</span><span className="text-xs text-gray-500">peer reviewed of {p.sources}</span></span>
            <span className="flex items-center gap-1.5 mt-2 flex-wrap">
              {p.open > 0 && <Chip tone="amber">{p.open} open</Chip>}
              {p.checked > 0 && <Chip tone="blue">{p.checked} checked</Chip>}
              {p.sources === 0 && <Chip tone="gray">No sources yet</Chip>}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={scope} onChange={setScope} items={[{ key: 'peer_done', label: 'Peer reviewed' }, { key: 'all', label: 'All sources' }]} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a source" aria-label="Find a source" className="text-sm rounded-xl border border-gray-200 px-3 py-2 w-56 max-w-full" />
        <span className="ml-auto inline-flex items-center gap-1.5"><DownloadButtons project={project} scope={scope} /></span>
      </div>
      {!list ? <Skeletons rows={5} /> : groups.length === 0 ? (
        <Blank title={scope === 'peer_done' ? 'No peer-reviewed sources yet' : 'No sources'} text={scope === 'peer_done' ? 'Sources show here once every peer reviewer has submitted. Switch to All sources to look at the rest.' : 'Sources show here once work has started.'} />
      ) : groups.map(([name, rows]) => (
        <section key={name}>
          <h3 className="text-xs font-semibold text-gray-500 m-0 mb-2 px-1">{name}</h3>
          <ul className="m-0 p-0 list-none grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map(s => <li key={s.source_id}><SourceCard s={s} active={false} onPick={() => setSourceId(s.source_id)} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SourceCard({ s, active, onPick }: { s: any; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className={cn('w-full h-full text-left rounded-xl border px-3 py-2.5 transition bg-white', active ? 'border-transparent ring-2 ring-brand-400' : 'border-gray-100 hover:border-gray-300')}>
      <span className="block text-sm font-semibold text-gray-900 truncate">{s.name}</span>
      <span className="block text-[11px] text-gray-400 mt-0.5">{s.records} record{s.records === 1 ? '' : 's'}</span>
      <span className="flex items-center gap-1.5 flex-wrap mt-1.5">
        <Chip tone={s.peer_done ? 'green' : 'gray'}>{s.peer_done ? 'Peers done' : `Peers ${s.peers_done}/${s.peers_total}`}</Chip>
        {s.open_findings > 0 && <Chip tone="amber">{s.open_findings} open</Chip>}
        {s.audited > 0 && <Chip tone="blue">{s.audited} checked</Chip>}
      </span>
    </button>
  )
}

/** Switch source without leaving the desk: one button, a search box and the same list as the picker screen. */
function SourcePicker({ list, groups, project, setProject, scope, setScope, q, setQ, sourceId, name, onPick, onClear }: {
  list: any; groups: [string, any[]][]; project: string; setProject: (v: string) => void; scope: Scope; setScope: (v: Scope) => void; q: string; setQ: (v: string) => void
  sourceId: string; name: string; onPick: (id: string) => void; onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-900 hover:bg-gray-50 max-w-[min(340px,70vw)]" title="Switch to another source">
        <span className="truncate">{name}</span><span aria-hidden className="text-gray-400 text-xs">▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Pick a source" className="absolute left-0 top-full mt-2 z-50 w-[min(580px,92vw)] rounded-2xl border border-gray-200 bg-white shadow-xl p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <SelectBox label="Project" value={project} onChange={setProject} className="!py-1.5"><option value="">All projects</option>{(list?.projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
            <Tabs value={scope} onChange={setScope} items={[{ key: 'peer_done', label: 'Peer reviewed' }, { key: 'all', label: 'All' }]} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a source" aria-label="Find a source" className="text-sm rounded-xl border border-gray-200 px-3 py-1.5 flex-1 min-w-[140px]" />
          </div>
          <div className="max-h-[52vh] overflow-y-auto space-y-3 pr-1">
            {!list ? <Skeletons rows={3} /> : groups.length === 0 ? <p className="text-sm text-gray-500 m-0 px-1">{scope === 'peer_done' ? 'No peer-reviewed sources match. Try All.' : 'No sources match.'}</p> : groups.map(([g, rows]) => (
              <div key={g}>
                <h4 className="text-[11px] font-semibold text-gray-500 m-0 mb-1.5 px-1">{g}</h4>
                <ul className="m-0 p-0 list-none grid gap-1.5 sm:grid-cols-2">{rows.map(s => <li key={s.source_id}><SourceCard s={s} active={s.source_id === sourceId} onPick={() => { onPick(s.source_id); setOpen(false) }} /></li>)}</ul>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2 flex-wrap [&_button]:whitespace-nowrap">
            <button type="button" onClick={() => { setOpen(false); onClear() }} className="text-xs font-semibold text-brand-600 hover:underline">Back to all sources</button>
            <span className="ml-auto text-xs text-gray-500">Download what is listed</span><DownloadButtons project={project} scope={scope} />
          </div>
        </div>
      )}
    </div>
  )
}

function DownloadButtons({ project, scope }: { project: string; scope: Scope }) {
  const [busy, setBusy] = useState('')
  const go = async (format: 'xlsx' | 'json') => {
    setBusy(format)
    try { await qualityApi.exportPeer({ project_id: project || undefined, scope, format }); toast.success('Downloaded') }
    catch (e: any) {
      let msg = "Couldn't download that"
      try { const t = await e?.response?.data?.text?.(); msg = JSON.parse(t).detail || msg } catch { /* keep default */ }
      toast.error(msg)
    } finally { setBusy('') }
  }
  return (
    <>
      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => go('xlsx')} title="Every source in this list, with the peers' comments beside the data">{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</Button>
      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => go('json')} title="The same, as JSON for an AI model">{busy === 'json' ? 'Preparing…' : 'JSON'}</Button>
    </>
  )
}

function useMinWidth(px: number) {
  const q = `(min-width:${px}px)`
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q); if (!m) return
    const h = () => setOk(m.matches); h(); m.addEventListener?.('change', h); return () => m.removeEventListener?.('change', h)
  }, [q])
  return ok
}

function SourceDesk({ sourceId, onNextSource, onPrevSource, position, picker }: { sourceId: string; onNextSource: () => void; onPrevSource: () => void; position: string; picker: (name: string) => React.ReactNode }) {
  const [d, setD] = useState<any>(null)
  const [rid, setRid] = useState('')
  const [view, setView] = useState<'fields' | 'json'>('fields')
  const [onlyFlagged, setOnlyFlagged] = useState(true)
  const [hideDone, setHideDone] = useState(false)
  const [active, setActive] = useState('')
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [focus])
  const [site, setSite] = useState<Record<string, any>>({})
  const [siteBusy, setSiteBusy] = useState(false)
  const [panel, setPanel] = useState<'' | 'audit' | 'sop'>('')
  const [audit, setAudit] = useState<any>(null)
  const [sopInfo, setSopInfo] = useState<any>(null)
  useEffect(() => { setAudit(null); setPanel('') }, [sourceId])
  // The SOP was saved on the source when it was pulled from Xtrium. This only reads that saved copy; it never calls Xtrium.
  useEffect(() => {
    let live = true
    setSopInfo(null)
    qualityApi.sopRequirementsFor(sourceId).then(r => { if (!live) return; setSopInfo(r); if (r.just_saved) load() }).catch(() => { if (live) setSopInfo({ error: true }) })
    return () => { live = false }
  }, [sourceId])  // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => { const m = new Map<string, AuditRow>(); (audit?.rows ?? []).forEach((r: AuditRow) => m.set(r.record_id + '|' + r.field, r)); return m }, [audit])
  const [render, setRender] = useState(false)
  const [nimble, setNimble] = useState<boolean | null>(null)
  useEffect(() => { qualityApi.nimbleStatus().then(r => setNimble(r.configured)).catch(() => setNimble(false)) }, [])
  const runSite = async () => {
    if (!rid) return
    setSiteBusy(true)
    try {
      const r = await qualityApi.siteCheck({ record_id: rid, render, include_text: true })
      setSite(cur => ({ ...cur, [rid]: r }))
      if (!r.ok) toast.error(r.error || "Couldn't read the website")
      else toast.success('Checked against the website')
    } catch (e) { toast.error(err(e, "Couldn't check the website")) } finally { setSiteBusy(false) }
  }
  const [scanBusy, setScanBusy] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const roomy = useMinWidth(1500)
  const [dock, setDock] = useState(() => { try { return localStorage.getItem('dx.reviewDock') !== '0' } catch { return true } })
  const toggleDock = () => setDock(v => { const n = !v; try { localStorage.setItem('dx.reviewDock', n ? '1' : '0') } catch { /* ignore */ } return n })
  const docked = roomy && dock
  const [tool, setTool] = useState<'chat' | 'activity'>('chat')
  const [ask, setAsk] = useState(false)
  const [approving, setApproving] = useState(false)
  const [overview, setOverview] = useState(() => { try { return localStorage.getItem('dx.reviewOverview') === '1' } catch { return false } })
  const toggleOverview = () => setOverview(v => { const n = !v; try { localStorage.setItem('dx.reviewOverview', n ? '1' : '0') } catch { /* ignore */ } return n })
  const runScan = async () => {
    setScanBusy(true)
    try { const r = await qualityApi.scan(sourceId); toast.success(r.created ? `System checks found ${r.created} new issue${r.created === 1 ? '' : 's'}` : 'System checks found nothing new'); load() }
    catch (e) { toast.error(err(e, "Couldn't run the checks")) } finally { setScanBusy(false) }
  }
  const load = useCallback(() => qualityApi.reviewSource(sourceId).then(r => { setD(r); setRid(cur => (cur && r.records.some((x: any) => x.record_id === cur) ? cur : r.records[0]?.record_id ?? '')) }).catch(() => setD({ error: true })), [sourceId])
  useEffect(() => { setD(null); load() }, [load])

  const rec = d?.records?.find((r: any) => r.record_id === rid)
  const shown = useMemo(() => (rec?.fields ?? []).filter((f: any) => (!onlyFlagged || f.signals.length > 0 || f.audit) && (!hideDone || !f.audit)), [rec, onlyFlagged, hideDone])
  const nextTodo = useCallback(() => {
    const todo = (rec?.fields ?? []).filter((f: any) => f.signals.length > 0 && !f.audit)
    if (todo[0]) { setActive(todo[0].name); return }
    setActive('')
  }, [rec])
  // When this record has nothing left to settle, `n` carries on to the next record that does.
  const jumpToWork = useCallback(() => {
    const todo = (rec?.fields ?? []).filter((f: any) => f.signals.length > 0 && !f.audit)
    if (todo[0]) { setActive(todo[0].name); return }
    const recs: any[] = d?.records ?? []
    const i = recs.findIndex((r: any) => r.record_id === rid)
    const next = [...recs.slice(i + 1), ...recs.slice(0, Math.max(i, 0))].find((r: any) => r.todo > 0)
    if (next) setRid(next.record_id); else toast.success('Every doubted field in this source is settled')
  }, [rec, d, rid])
  const confirmSuggestion = async (r: AuditRow) => {
    try {
      await applyAuditRow(r)
      toast.success(`Confirmed ${r.verdict === 'WRONG' ? 'wrong' : 'correct'}. It now counts in the ratings.`)
      await load()
      const names: string[] = (rec?.fields ?? []).map((f: any) => f.name)
      const from = names.indexOf(r.field)
      const nxt = names.slice(from + 1).find(n => { const x = suggestions.get(rec.record_id + '|' + n); const ff = rec.fields.find((q: any) => q.name === n); return x && x.verdict !== 'HOLD' && !ff?.audit })
      if (nxt) setActive(nxt)
    } catch (e) { toast.error(err(e, "Couldn't save that one")) }
  }
  useEffect(() => { nextTodo() }, [rid, d])  // eslint-disable-line react-hooks/exhaustive-deps
  // Show the verdict at once; the server call happens in the background so the next field is one keypress away.
  const applyLocal = (recordId: string, name: string, verdict: string, truth?: string) => setD((cur: any) => {
    if (!cur?.records) return cur
    let audited = 0
    const records = cur.records.map((r: any) => {
      if (r.record_id !== recordId) return r
      const fields = r.fields.map((f: any) => (f.name === name ? { ...f, audit: { verdict, truth_value: truth ?? null, note: null } } : f))
      return { ...r, fields, todo: fields.filter((f: any) => f.signals.length && !f.audit).length, audited: fields.filter((f: any) => f.audit).length }
    })
    records.forEach((r: any) => { audited += r.audited })
    return { ...cur, records, totals: { ...cur.totals, audited } }
  })

  const approveSource = async () => {
    setApproving(true)
    try { await sourcesApi.approve(sourceId); toast.success('Source approved'); load() }
    catch (e) { toast.error(err(e, 'Cannot approve yet. Check that every record is approved.')) } finally { setApproving(false) }
  }

  const openSide = () => { if (roomy) toggleDock(); else setFocus(v => !v) }
  const move = (delta: number) => {
    if (!d) return
    const i = d.records.findIndex((r: any) => r.record_id === rid)
    const n = d.records[Math.max(0, Math.min(d.records.length - 1, i + delta))]
    if (n) setRid(n.record_id)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j') move(1)
      else if (e.key === 'k') move(-1)
      else if (e.key === 'n') jumpToWork()
      else if (e.key === 's') openSide()
      else if (e.key === 'Escape' && focus) setFocus(false)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const names = shown.map((f: any) => f.name); if (!names.length) return
        e.preventDefault()
        const i = names.indexOf(active)
        setActive(names[Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))])
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  if (!d) return <Skeletons rows={5} />
  if (d.error) return <Blank title="Couldn't open this source" text="Check your connection and try again." />
  const t = d.totals
  const pctDone = t.flagged ? Math.round(100 * d.records.reduce((n: number, r: any) => n + r.fields.filter((f: any) => f.signals.length && f.audit).length, 0) / t.flagged) : 100

  const inOverlay = focus && !roomy
  const idx = d.records.findIndex((r: any) => r.record_id === rid)
  const todoLeft = rec ? rec.fields.filter((f: any) => f.signals.length > 0 && !f.audit).length : 0
  const steps = flowSteps(d, pctDone)
  const nextStep = steps.find(x => x.state === 'todo')

  const recNav = (
    <>
      <nav aria-label="Records" className="hidden lg:block rounded-2xl border border-gray-100 bg-white p-1.5 max-h-[calc(100vh-7rem)] overflow-y-auto">
        <p className="text-[11px] text-gray-400 px-2 py-1 m-0">Records, riskiest first</p>
        <ul className="m-0 p-0 list-none">
          {d.records.map((r: any) => (
            <li key={r.record_id}>
              <button type="button" onClick={() => setRid(r.record_id)} aria-current={rid === r.record_id} className={cn('w-full text-left rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-2', rid === r.record_id ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700 hover:bg-gray-50')}>
                <span className={cn('w-2 h-2 rounded-full shrink-0', r.review_status === 'approved' ? 'bg-emerald-500' : r.todo > 0 ? 'bg-red-500' : r.audited > 0 ? 'bg-sky-500' : 'bg-gray-300')} aria-hidden />
                <span className="truncate flex-1">{r.record}</span>
                {r.review_status === 'approved' ? <span className="text-[11px] text-emerald-600" title="Approved">✓</span> : r.todo > 0 ? <span className="text-[11px] tabular-nums text-red-600 font-semibold" title="Doubted fields left">{r.todo}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="lg:hidden">
        <SelectBox label="Record" value={rid} onChange={setRid} className="w-full">
          {d.records.map((r: any, i: number) => <option key={r.record_id} value={r.record_id}>{i + 1}. {r.record}{r.todo > 0 ? ` (${r.todo} to check)` : ''}</option>)}
        </SelectBox>
      </div>
    </>
  )

  const fieldsSection = (
    <section className="min-w-0 space-y-3">
      <div className="md:sticky md:top-0 z-20 rounded-xl border border-gray-200 bg-white px-3 py-2 flex items-center gap-2 flex-wrap shadow-sm [&_button]:whitespace-nowrap">
        <div className="min-w-0 flex items-center gap-1.5">
          <IconButton label="Previous record" onClick={() => move(-1)}>‹</IconButton>
          <span className="text-sm font-bold text-gray-900 truncate max-w-[14ch]" title={rec?.record}>{rec?.record ?? 'No record'}</span>
          <span className="text-xs text-gray-400 tabular-nums">{idx >= 0 ? `${idx + 1}/${d.records.length}` : ''}</span>
          <IconButton label="Next record" onClick={() => move(1)}>›</IconButton>
        </div>
        <FilterChip on={onlyFlagged} onClick={() => setOnlyFlagged(v => !v)} hint="Show only fields that something doubts. Turn it off to spot check any field.">Doubted only</FilterChip>
        <FilterChip on={view === 'json'} onClick={() => setView(view === 'json' ? 'fields' : 'json')} hint="Read the whole record as JSON">JSON</FilterChip>
        <FilterChip on={hideDone} onClick={() => setHideDone(v => !v)} hint="Hide the fields you have already checked">Hide checked</FilterChip>
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Button size="sm" onClick={jumpToWork} title="Jump to the next doubted field (n)">Next doubted{todoLeft ? ` (${todoLeft})` : ''}</Button>
          {!inOverlay && <Button size="sm" variant={docked ? 'primary' : 'secondary'} onClick={openSide} title="SOP, source text and website beside the record (s)">Side by side</Button>}
          <Button size="sm" variant="secondary" disabled={siteBusy || nimble === false} onClick={runSite} title={nimble === false ? 'Add NIMBLE_API_KEY in the server settings to turn this on' : 'Fetch the source website with Nimble and look for each value on it'}>{siteBusy ? 'Reading…' : 'Check site'}</Button>
          <FilterChip on={render} onClick={() => setRender(v => !v)} hint="Slower. Use it for sites that build their pages with JavaScript, then run Check site.">Render page</FilterChip>
          <Button size="sm" variant="secondary" disabled={scanBusy} onClick={runScan} title="Logs missing fields, bad formats and SOP gaps for the whole source">{scanBusy ? 'Running checks…' : 'Run system checks'}</Button>
          {d.website && <a href={d.website} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">Open source site</a>}
        </span>
      </div>
      <p className="hidden md:block text-[11px] text-gray-500 px-1">Keys: ↑ ↓ field · c correct · w wrong · m comment · y confirm the audit's suggestion · n next doubted · j k record · s side by side · Esc close</p>
      {t.flagged > 0 && pctDone === 100 && <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm px-4 py-2.5">Every doubted field in this source is settled. Check a few random fields too: turn off Doubted only.</div>}
      {!rec ? <Blank title="No records" /> : view === 'json' ? <JsonView rec={rec} onPick={n => { setView('fields'); setOnlyFlagged(false); setActive(n) }} /> : (
        <div className="space-y-2">
          {rec.general.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {rec.general.map((g: any, i: number) => <p key={i} className="m-0"><b>{g.by}</b>: {g.text}</p>)}
            </div>
          )}
          {shown.length === 0 ? <Blank title={onlyFlagged ? 'Nothing doubted on this record' : 'Nothing to show'} text={onlyFlagged ? 'Turn off Doubted only to check any field at random.' : ''} /> :
            shown.map((f: any) => <FieldRow key={rec.record_id + f.name} suggestion={suggestions.get(rec.record_id + '|' + f.name)} onConfirmSuggestion={confirmSuggestion} rec={rec} f={f} peers={d.peers} sopRules={d.sop_required ?? []} website={d.website} site={site[rec.record_id]?.ok ? site[rec.record_id].fields[f.name] : undefined} active={active === f.name} onActive={() => setActive(f.name)} onLocal={applyLocal} onReload={load} />)}
        </div>
      )}
      {rec && <RecordBar key={rec.record_id} sourceId={sourceId} rec={rec} todoLeft={todoLeft} onDone={load} onPick={n => { setOnlyFlagged(false); setHideDone(false); setActive(n) }} />}
    </section>
  )
  const activeValue = rec?.fields?.find((f: any) => f.name === active)?.value
  const peerNotes = d.peers.some((p: any) => p.comment) && (
    <div className="space-y-1.5">
      {d.peers.filter((p: any) => p.comment).map((p: any) => (
        <div key={p.id} className="rounded-xl bg-gray-50 px-3 py-2 text-sm"><span className="font-semibold text-gray-900">{p.name}</span><span className="text-gray-400"> wrote </span><span className="text-gray-700">{p.comment}</span>
          {p.fields?.length > 0 && <span className="flex items-center gap-1.5 flex-wrap mt-1"><span className="text-[11px] text-gray-500">Fields it points at:</span>{p.fields.map((n: string) => <Chip key={n} tone="red" title={p.why?.[n] ? `${p.why[n].why}: "${p.why[n].clause}"` : undefined}>{n}</Chip>)}</span>}
          {!(p.fields?.length > 0) && p.comment && <span className="block text-[11px] text-gray-400 mt-1">Not tied to a field: it reads as an acknowledgement, a how-to step, or names no field. Comment on the field itself to credit it.</span>}
          {p.unknown?.length > 0 && <span className="flex items-center gap-1.5 flex-wrap mt-1"><span className="text-[11px] text-gray-500">Named but not a field on this source:</span>{p.unknown.map((n: string) => <Chip key={n} tone="amber" title="Not in the record, the schema or the SOP. Check it by hand.">{n}</Chip>)}</span>}
        </div>
      ))}
    </div>
  )

  if (inOverlay) return createPortal(
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Side by side review">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white flex-wrap">
        <b className="text-sm text-gray-900 truncate max-w-[40ch]">{d.source}</b>
        {(d.sop_code || sopInfo?.sop_code) && <Chip tone="indigo">{d.sop_code || sopInfo?.sop_code}</Chip>}
        {sopInfo && !sopInfo.error && sopInfo.stale && <button type="button" onClick={() => setPanel('sop')} title={sopInfo.warnings?.[0]}><Chip tone="amber">SOP may be outdated</Chip></button>}
        {sopInfo && !sopInfo.error && !sopInfo.has_sop && <button type="button" onClick={() => setPanel('sop')} title={sopInfo.warnings?.[0]}><Chip tone="amber">No SOP saved</Chip></button>}
        {sopInfo?.has_sop && sopInfo.warnings.length > 0 && <button type="button" onClick={() => setPanel('sop')} title={sopInfo.warnings.join(' ')}><Chip tone="amber">{sopInfo.warnings.length} SOP thing{sopInfo.warnings.length === 1 ? '' : 's'} to settle</Chip></button>}
        <span className="text-xs text-gray-500 tabular-nums">{pctDone}% of doubted fields settled</span>
        <span className="text-xs text-gray-400 hidden xl:inline">↑ ↓ field · c correct · w wrong · m comment · n next doubted · j k record · Esc close</span>
        <span className="ml-auto"><Button size="sm" variant="secondary" onClick={() => setFocus(false)}>Close side by side</Button></span>
      </div>
      <div className="flex-1 min-h-0 grid gap-3 p-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(380px,46%)] overflow-y-auto lg:overflow-hidden">
        <div className="lg:overflow-y-auto">{recNav}</div>
        <div className="lg:overflow-y-auto min-w-0 space-y-3 pr-1">
          {peerNotes}
          {fieldsSection}
        </div>
        <div className="min-h-[70vh] lg:min-h-0 lg:h-full">
          <ReviewSidePanel sourceId={sourceId} website={d.website} rec={rec} sopRequired={d.sop_required ?? []} activeValue={activeValue} activeField={active}
            pageText={site[rid]?.ok ? site[rid].text : undefined} pageBusy={siteBusy} nimbleReady={nimble === true} onFetchPage={runSite} />
        </div>
      </div>
    </div>, document.body)

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-gray-100 bg-white px-3 py-2 flex items-center gap-2 flex-wrap [&_button]:whitespace-nowrap">
        {picker(d.source)}
        <span className="inline-flex items-center gap-0.5"><IconButton label="Previous source" onClick={onPrevSource}>‹</IconButton><IconButton label="Next source" onClick={onNextSource}>›</IconButton></span>
        {position && <span className="text-xs text-gray-400 tabular-nums hidden sm:inline">{position}</span>}
        {d.sop_code && <Chip tone="indigo">{d.sop_code}</Chip>}
        <Chip tone={d.peer_done ? 'green' : 'amber'} title={d.peer_done ? 'Every peer reviewer has submitted' : 'Some peer reviewers have not submitted yet'}>{d.peer_done ? 'Peers done' : 'Waiting for peers'}</Chip>
        <Chip tone={d.status === 'approved' ? 'green' : 'gray'}>{d.status === 'approved' ? 'Source approved' : `${d.approved_records}/${d.total_records} approved`}</Chip>
        <span className="hidden md:inline-flex items-center gap-2 text-xs text-gray-500" title="Doubted fields you have settled"><span className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className="block h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${pctDone}%` }} /></span><span className="tabular-nums">{pctDone}% settled</span></span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant={panel === 'sop' ? 'primary' : 'secondary'} onClick={() => setPanel(v => v === 'sop' ? '' : 'sop')} title="The fields, allowed values and rules this source's SOP states, with the exact lines">SOP rules</Button>
          <Button size="sm" variant={panel === 'audit' ? 'primary' : 'secondary'} onClick={() => setPanel(v => v === 'audit' ? '' : 'audit')} title="Check every field of every record against the live pages, using the SOP">Audit against site</Button>
          <Button size="sm" variant="secondary" onClick={() => setAsk(true)} title="Send a question to the client about this source">Ask the client</Button>
          {d.status !== 'approved' && <Button size="sm" disabled={approving || !d.total_records || d.approved_records !== d.total_records} onClick={approveSource} title={d.approved_records === d.total_records ? 'Approve this source' : 'Approve every record first'}>{approving ? 'Approving…' : 'Approve source'}</Button>}
        </span>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white">
        <button type="button" onClick={toggleOverview} aria-expanded={overview} className="w-full flex items-center gap-x-3 gap-y-1 flex-wrap px-4 py-2 text-left text-sm">
          <span className="font-bold text-gray-900">Overview</span>
          <span className="text-gray-500 tabular-nums">{t.flagged} doubted of {t.fields} fields · {t.comments + t.mentions} peer pointers · {t.audited} checked</span>
          <Chip tone={nextStep ? 'amber' : 'green'}>{nextStep ? `Next: ${nextStep.label.toLowerCase()}` : 'All steps done'}</Chip>
          <span className="ml-auto text-xs font-semibold text-brand-600">{overview ? 'Hide' : 'Show peer notes and steps'} <span aria-hidden>{overview ? '▴' : '▾'}</span></span>
        </button>
        {overview && (
          <div className="px-4 pb-3 space-y-3 border-t border-gray-50 pt-3">
            {peerNotes}
            <ReviewFlow steps={steps} busy={scanBusy} onScan={runScan} />
          </div>
        )}
      </div>

      {panel === 'sop' && <SopRulesPanel sourceId={sourceId} name={d.source} onClose={() => setPanel('')} />}
      {panel === 'audit' && <SourceAuditPanel sourceId={sourceId} nimbleReady={nimble === true} result={audit} onResult={setAudit} onClose={() => setPanel('')} onApplied={load}
        onJump={(recordId, field) => { setRid(recordId); setOnlyFlagged(false); setHideDone(false); setActive(field); setPanel('') }} />}

      <div className={cn('grid gap-3 items-start', docked ? 'lg:grid-cols-[200px_minmax(0,1fr)_minmax(440px,42%)]' : 'lg:grid-cols-[210px_minmax(0,1fr)]')}>
        <div className="lg:sticky lg:top-3 lg:self-start">{recNav}</div>
        {fieldsSection}
        {docked && (
          <div className="sticky top-3 self-start h-[calc(100vh-1.5rem)]">
            <ReviewSidePanel sourceId={sourceId} website={d.website} rec={rec} sopRequired={d.sop_required ?? []} activeValue={activeValue} activeField={active}
              pageText={site[rid]?.ok ? site[rid].text : undefined} pageBusy={siteBusy} nimbleReady={nimble === true} onFetchPage={runSite} />
          </div>
        )}
      </div>

      <Panel title="Source discussion and activity" subtitle="The same chat and history as the source page, so you do not have to leave the desk."
        actions={<Button size="sm" variant="secondary" onClick={() => setToolsOpen(v => !v)}>{toolsOpen ? 'Hide' : 'Show'}</Button>}>
        {toolsOpen && (
          <div className="space-y-3">
            <Tabs value={tool} onChange={setTool} items={[{ key: 'chat', label: 'Discussion' }, { key: 'activity', label: 'Activity' }]} />
            {tool === 'chat' ? <SourceChat sourceId={sourceId} /> : <SourceActivity sourceId={sourceId} refreshKey={d.approved_records} />}
          </div>
        )}
      </Panel>
      <AskClientModal open={ask} onClose={() => setAsk(false)} projectId={d.project_id} sourceId={sourceId} />
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 text-base leading-none">{children}</button>
}

function FilterChip({ on, onClick, hint, children }: { on: boolean; onClick: () => void; hint?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} title={hint} onClick={onClick}
      className={cn('text-xs font-semibold rounded-full px-3 py-1 border transition', on ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800')}>
      {on ? '✓ ' : ''}{children}
    </button>
  )
}

/** Always-reachable sign-off for the record you are on: a note, send it back, or approve it. */
function RecordBar({ sourceId, rec, todoLeft, onDone, onPick }: { sourceId: string; rec: any; todoLeft: number; onDone: () => void; onPick: (name: string) => void }) {
  const [mode, setMode] = useState<'' | 'return' | 'comment'>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const status: string = rec.review_status
  const label: Record<string, [string, Tone]> = { approved: ['Approved', 'green'], rejected: ['Sent back', 'red'], pending_admin_review: ['Waiting for your sign-off', 'amber'], pending: ['In progress', 'gray'] }
  const [text, tone] = label[status] ?? [status?.replace(/_/g, ' ') || 'In progress', 'gray']
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); setMode(''); setNote(''); onDone() }
    catch (e) { toast.error(err(e, 'That did not save')) } finally { setBusy(false) }
  }
  const changed: string[] = rec.changed_since_return ?? []
  return (
    <div className="sticky bottom-3 z-20 rounded-2xl border border-gray-200 bg-white shadow-lg px-3 py-2 space-y-2" aria-label="Record sign-off">
      {mode !== '' && (
        <div className="space-y-2">
          <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000}
            placeholder={mode === 'return' ? 'Tell the extractor what to fix. Your field notes go with it.' : 'A note about the whole record'}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2" />
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap [&_button]:whitespace-nowrap">
        <Chip tone={tone}>{text}</Chip>
        {rec.corrections > 0 && <span className="text-xs text-gray-500">sent back {rec.corrections}×</span>}
        {todoLeft > 0 && status !== 'approved' && <span className="text-xs text-amber-700">{todoLeft} doubted field{todoLeft === 1 ? '' : 's'} not settled</span>}
        {changed.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap text-xs text-gray-600 min-w-0"><span>Changed since you sent it back:</span>
            {changed.slice(0, 4).map(n => <button key={n} type="button" onClick={() => onPick(n)}><Chip tone="blue">{n}</Chip></button>)}
            {changed.length > 4 && <span className="text-gray-400">+{changed.length - 4}</span>}
          </span>
        )}
        {rec.returned_at && changed.length === 0 && rec.corrections > 0 && <span className="text-xs text-amber-700">Nothing has changed since you sent it back</span>}
        <span className="ml-auto flex gap-1.5 flex-wrap justify-end">
          {mode !== '' && <Button size="sm" variant="ghost" onClick={() => { setMode(''); setNote('') }}>Cancel</Button>}
          {mode === 'return'
            ? <Button size="sm" variant="danger" disabled={busy || !note.trim()} onClick={() => run(() => sourcesApi.adminReview(sourceId, rec.record_id, { action: 'return', note: note.trim() }), 'Sent back to the extractor')}>Send back</Button>
            : mode === 'comment'
              ? <Button size="sm" disabled={busy || !note.trim()} onClick={() => run(() => qualityApi.comment({ record_id: rec.record_id, comment: note.trim() }), 'Comment saved')}>Save comment</Button>
              : <>
                <Button size="sm" variant="secondary" onClick={() => setMode('comment')}>Comment</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('return')}><span className="hidden sm:inline">Return for correction</span><span className="sm:hidden">Return</span></Button>
                <Button size="sm" variant="success" disabled={busy || status === 'approved'} onClick={() => run(() => sourcesApi.adminReview(sourceId, rec.record_id, { action: 'approve', note: '' }), 'Record approved')}>{status === 'approved' ? 'Approved' : <><span className="hidden sm:inline">Approve record</span><span className="sm:hidden">Approve</span></>}</Button>
              </>}
        </span>
      </div>
    </div>
  )
}

type FlowStep = { n: string; label: string; state: 'done' | 'todo' | 'na'; hint: string }
function flowSteps(d: any, pctDone: number): FlowStep[] {
  const t = d.totals
  return [
    { n: '1', label: 'Peers submitted', state: d.peer_done ? 'done' : 'todo', hint: d.peer_done ? 'All peers are done' : 'Wait for the peers before you settle fields' },
    { n: '2', label: 'System checks', state: t.system_findings > 0 ? 'done' : 'todo', hint: t.system_findings > 0 ? `${t.system_findings} found by the checks` : 'Not run yet, or found nothing' },
    { n: '3', label: 'SOP', state: t.sop_rate === null ? 'na' : t.sop_rate >= 100 ? 'done' : 'todo', hint: t.sop_rate === null ? 'No SOP saved' : `${Math.round(t.sop_rate)}% of records have every required field` },
    { n: '4', label: 'Doubted fields', state: pctDone >= 100 ? 'done' : 'todo', hint: `${pctDone}% settled` },
    { n: '5', label: 'Spot check', state: t.audited >= 30 ? 'done' : 'todo', hint: `${t.audited} of 30 fields checked at the source` },
    { n: '6', label: 'Open errors', state: t.open_findings === 0 ? 'done' : 'todo', hint: t.open_findings === 0 ? 'None waiting' : `${t.open_findings} to settle in Errors logged` },
  ]
}

function ReviewFlow({ steps, busy, onScan }: { steps: FlowStep[]; busy: boolean; onScan: () => void }) {
  const next = steps.find(s => s.state === 'todo')
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap"><h3 className="text-sm font-bold text-gray-900 m-0">Review steps</h3>
        <span className="text-xs text-gray-500">{next ? `Next: ${next.label.toLowerCase()}` : 'All steps done. Approve the source or send records back.'}</span></div>
      <ol className="m-0 p-0 list-none grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {steps.map(s => (
          <li key={s.n} className={cn('rounded-xl border px-3 py-2', s.state === 'done' ? 'border-emerald-200 bg-emerald-50' : s.state === 'na' ? 'border-gray-100 bg-gray-50' : s === next ? 'border-amber-300 bg-amber-50' : 'border-gray-100')}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><span aria-hidden className={s.state === 'done' ? 'text-emerald-600' : 'text-gray-400'}>{s.state === 'done' ? '✓' : s.n}</span>{s.label}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{s.hint}</div>
            {s.n === '2' && s.state !== 'done' && <div className="mt-1"><button type="button" disabled={busy} onClick={onScan} className="text-[11px] font-semibold text-brand-600 hover:underline disabled:opacity-50">{busy ? 'Running…' : 'Run now'}</button></div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div><div className="text-2xl font-extrabold tabular-nums text-gray-900 leading-none">{value}</div><div className="text-xs font-semibold text-gray-700 mt-1">{label}</div><div className="text-[11px] text-gray-400">{sub}</div></div>
}

function FieldRow({ suggestion, onConfirmSuggestion, rec, f, peers, sopRules, website, site, active, onActive, onLocal, onReload }: { suggestion?: AuditRow; onConfirmSuggestion?: (r: AuditRow) => void; rec: any; f: any; peers: any[]; sopRules: string[]; website?: string; site?: { state: string; snippet?: string | null; note?: string }; active: boolean; onActive: () => void; onLocal: (rid: string, name: string, verdict: string, truth?: string) => void; onReload: () => void }) {
  const [same, setSame] = useState(() => { try { return localStorage.getItem('dx.reviewSame') === '1' } catch { return false } })
  const [wrong, setWrong] = useState(false)
  const [truth, setTruth] = useState('')
  const [category, setCategory] = useState('wrong_value')
  const [credit, setCredit] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [originalOk, setOriginalOk] = useState(false)
  const [cmt, setCmt] = useState(false)
  const [ctext, setCtext] = useState('')
  const [crule, setCrule] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const sigs = [...f.signals].sort((a: any, b: any) => (KIND[a.kind]?.rank ?? 9) - (KIND[b.kind]?.rank ?? 9))
  const pointers = [...new Map(f.signals.filter((s: any) => (s.kind === 'mention' || s.kind === 'comment') && s.by_id).map((s: any) => [s.by_id, s.by])).entries()] as [string, string][]
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [active])
  useEffect(() => { setCredit(pointers.map(p => p[0])) }, [f.signals.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const verdict = f.audit?.verdict
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'c') { e.preventDefault(); mark('correct') }
      else if (e.key === 'w') { e.preventDefault(); setWrong(true) }
      else if (e.key === 'm') { e.preventDefault(); setCmt(true) }
      else if (e.key === 'y' && suggestion && suggestion.verdict !== 'HOLD' && !verdict) { e.preventDefault(); onConfirmSuggestion?.(suggestion) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })
  const edge = verdict === 'correct' ? 'border-l-emerald-500' : verdict === 'incorrect' ? 'border-l-red-500' : sigs.length ? 'border-l-amber-500' : 'border-l-gray-200'

  const mark = async (v: 'correct' | 'incorrect') => {
    if (v === 'incorrect' && !truth.trim()) { toast.error('Type what the source really says'); return }
    const t = truth.trim() || undefined
    const withSame = same && f.same_count > 0
    onLocal(rec.record_id, f.name, v, t); setWrong(false); setTruth('')
    try {
      const r = await qualityApi.mark({ record_id: rec.record_id, field: f.name, verdict: v, truth_value: t, category, credit: v === 'incorrect' ? credit : [], same_value: withSame, original_ok: v === 'correct' && originalOk })
      if (r.fixed_credit) toast.success('Counted as a catch. The reviewer was right and the extractor fixed it.')
      if (withSame) { toast.success(`Also marked ${r.also_marked} other record${r.also_marked === 1 ? '' : 's'} with the same value`); onReload() }
    } catch (e) { toast.error(err(e, "Couldn't save that. Showing the saved state again.")); onReload() }
  }
  const saveComment = async () => {
    if (!ctext.trim()) return
    setBusy(true)
    try { await qualityApi.comment({ record_id: rec.record_id, field: f.name, comment: ctext.trim(), sop_rule: crule || undefined, kind: crule ? 'sop' : 'note' }); toast.success('Comment saved. The extractor sees it on the source page.'); setCmt(false); setCtext(''); setCrule(''); onReload() }
    catch (e) { toast.error(err(e, "Couldn't save the comment")) } finally { setBusy(false) }
  }
  const removeComment = async (ts: string) => {
    try { await qualityApi.deleteComment({ record_id: rec.record_id, field: f.name, ts }); onReload() } catch (e) { toast.error(err(e, "Couldn't remove it")) }
  }
  const notes = f.signals.filter((s: any) => s.kind === 'note')
  const rechecks = f.signals.filter((s: any) => s.kind === 'recheck')
  const setSameSaved = (v: boolean) => { setSame(v); try { localStorage.setItem('dx.reviewSame', v ? '1' : '0') } catch { /* ignore */ } }
  const host = (() => { try { return website ? new URL(website).hostname.replace(/^www\./, '') : '' } catch { return '' } })()
  const findUrl = host && typeof f.value === 'string' && f.value.trim() && f.value.length <= 90 && !isUrl(f.value)
    ? `https://www.google.com/search?q=${encodeURIComponent(`site:${host} "${f.value.trim()}"`)}` : ''
  const empty = show(f.value) === ''
  return (
    <div ref={ref} onClick={onActive} className={cn('rounded-xl border border-gray-100 border-l-4 bg-white px-4 py-3', edge, active && 'ring-2 ring-brand-300')}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-1.5 flex-wrap"><span className="text-xs font-semibold text-gray-500">{f.name}</span>
            {sigs.map((s: any, i: number) => <Chip key={i} tone={KIND[s.kind]?.tone ?? 'gray'} title={s.text}>{KIND[s.kind]?.label ?? s.kind}{s.by && s.kind !== 'finding' ? `: ${s.by}` : ''}</Chip>)}
            {site && site.state !== 'skip' && <Chip tone={site.state === 'found' ? 'green' : site.state === 'close' ? 'amber' : site.state === 'neutral' || site.state === 'appears' ? 'gray' : 'red'} title={site.note ?? site.snippet ?? ''}>{site.state === 'found' ? 'Found on the site' : site.state === 'close' ? 'Close match on the site' : site.state === 'neutral' ? 'Filled in by the system' : site.state === 'appears' ? 'Text is on the page' : 'Not on the page'}</Chip>}
            {verdict && <Chip tone={verdict === 'correct' ? 'green' : 'red'}>{verdict === 'correct' ? 'Checked: correct' : 'Checked: wrong'}</Chip>}</div>
          <div className={cn('text-sm mt-1 break-words whitespace-pre-wrap', empty ? 'text-gray-400 italic' : 'text-gray-900 font-medium')}>
            {empty ? 'Empty' : isUrl(f.value) ? <a href={f.value} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all">{f.value}</a> : show(f.value)}
          </div>
          {suggestion && !verdict && (
            <div onClick={e => e.stopPropagation()} className={cn('text-xs rounded-lg px-2.5 py-2 mt-1.5 space-y-1', suggestion.verdict === 'WRONG' ? 'bg-red-50 text-red-900' : suggestion.verdict === 'CORRECT' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>
              <p className="m-0"><b>Audit suggests {suggestion.verdict === 'WRONG' ? 'wrong' : suggestion.verdict === 'CORRECT' ? 'correct' : 'hold'}.</b> {suggestion.comment}</p>
              {suggestion.source_says && <p className="m-0">Source says: <b>{suggestion.source_says}</b></p>}
              {suggestion.proof?.quote && <p className="m-0 opacity-80 break-words">“{suggestion.proof.quote}” {suggestion.proof.url && <a href={suggestion.proof.url} target="_blank" rel="noreferrer" className="underline">page</a>}</p>}
              {suggestion.flag_status && <p className="m-0 opacity-80">Flag: {suggestion.flag_status}{suggestion.caught_by.length ? ` (${suggestion.caught_by.join(', ')})` : ''}</p>}
              {suggestion.verdict !== 'HOLD'
                ? <p className="m-0 flex items-center gap-2 flex-wrap"><Button size="sm" onClick={() => onConfirmSuggestion?.(suggestion)} title="You have looked and you agree. Only a confirmed field counts in the ratings (key y)">Confirm {suggestion.verdict === 'WRONG' ? 'wrong' : 'correct'} (y)</Button><span className="opacity-80">A suggestion only. It is not rated until you confirm.</span></p>
                : <p className="m-0 opacity-80">Not rated. Look at the source and mark it yourself.</p>}
            </div>
          )}
          {sigs.filter((s: any) => s.text && s.kind !== 'mention' && s.kind !== 'note' && s.kind !== 'recheck').slice(0, 3).map((s: any, i: number) => <p key={i} className="text-xs text-gray-500 mt-1 mb-0">{s.by ? `${s.by}: ` : ''}{s.text}</p>)}
          {rechecks.map((s: any, i: number) => (
            <div key={'r' + i} className="text-xs bg-amber-50 text-amber-900 rounded-lg px-2.5 py-1.5 mt-1.5">
              <p className="m-0"><b>Look again.</b> {s.text}</p>
              <p className="m-0 mt-0.5">Then: <b>{show(s.was) || 'empty'}</b>. Now: <b>{show(s.now) || 'empty'}</b>.</p>
              {s.by_id && !verdict && <label className="inline-flex items-center gap-1.5 mt-1" onClick={e => e.stopPropagation()}><input type="checkbox" checked={originalOk} onChange={e => setOriginalOk(e.target.checked)} />The old value was fine, so the flag was a mistake</label>}
            </div>
          ))}
          {f.prior && !verdict && <p className="text-xs text-gray-500 mt-1 mb-0">Last check: marked <b>{f.prior.verdict === 'incorrect' ? 'wrong' : 'correct'}</b> when it said <b>{show(f.prior.value) || 'empty'}</b>.</p>}
          {notes.map((s: any, i: number) => (
            <p key={'n' + i} className="text-xs text-indigo-800 bg-indigo-50 rounded-lg px-2.5 py-1.5 mt-1.5 mb-0 break-words">
              <b>{s.by}</b>{s.sop_rule ? <span> on <b>{s.sop_rule}</b></span> : null}: {s.text}
              {s.mine && <button type="button" onClick={e => { e.stopPropagation(); removeComment(s.ts) }} className="ml-2 underline text-indigo-600">Remove</button>}
            </p>
          ))}
          {site?.snippet && site.state !== 'missing' && <p className="text-xs text-gray-500 mt-1 mb-0 italic break-words">On the site: …{site.snippet}…</p>}
          {site?.note && (site.state === 'appears' || site.state === 'neutral') && <p className="text-xs text-gray-500 mt-1 mb-0">{site.note}</p>}
          {f.audit?.truth_value && <p className="text-xs text-gray-600 mt-1 mb-0">Source says: <b>{f.audit.truth_value}</b></p>}
          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-xs">
            <button type="button" onClick={e => { e.stopPropagation(); setCmt(v => !v) }} className="text-brand-600 hover:underline" title="Leave a note on this field (press m)">Comment</button>
            {findUrl && <a href={findUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">Find it on the site</a>}
            {!empty && <button type="button" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(show(f.value)).then(() => toast.success('Copied')) }} className="text-gray-500 hover:text-gray-800 underline">Copy value</button>}
            {f.same_count > 0 && !verdict && <label className="inline-flex items-center gap-1.5 text-gray-600" onClick={e => e.stopPropagation()}><input type="checkbox" checked={same} onChange={e => setSameSaved(e.target.checked)} />Apply to {f.same_count} more record{f.same_count === 1 ? '' : 's'} with this value</label>}
          </div>
        </div>
        {!wrong && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant={verdict === 'correct' ? 'primary' : 'secondary'} disabled={busy} onClick={e => { e.stopPropagation(); mark('correct') }}>Correct</Button>
            <Button size="sm" variant={verdict === 'incorrect' ? 'primary' : 'secondary'} disabled={busy} onClick={e => { e.stopPropagation(); setWrong(true) }}>Wrong</Button>
          </div>
        )}
      </div>
      {cmt && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2" onClick={e => e.stopPropagation()}>
          <textarea autoFocus value={ctext} onChange={e => setCtext(e.target.value)} rows={2} maxLength={2000}
            onKeyDown={e => { if (e.key === 'Escape') setCmt(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveComment() }}
            placeholder="What is the issue with this field? Say what the SOP expects." className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2" />
          <div className="flex items-center gap-3 flex-wrap">
            {sopRules.length > 0 && <SelectBox label="SOP rule" value={crule} onChange={setCrule}><option value="">None</option>{sopRules.map(r => <option key={r} value={r}>{r} (required)</option>)}</SelectBox>}
            <span className="ml-auto flex gap-1.5"><Button variant="secondary" onClick={() => setCmt(false)}>Cancel</Button><Button disabled={busy || !ctext.trim()} onClick={saveComment}>Save comment</Button></span>
          </div>
        </div>
      )}
      {wrong && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2" onClick={e => e.stopPropagation()}>
          <input autoFocus value={truth} onChange={e => setTruth(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') mark('incorrect'); if (e.key === 'Escape') setWrong(false) }}
            placeholder="What the source really says" className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2" />
          <div className="flex items-center gap-3 flex-wrap">
            <SelectBox label="Kind of error" value={category} onChange={setCategory}>{CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</SelectBox>
            {pointers.length > 0 && <span className="text-xs text-gray-500">Credit as caught by:</span>}
            {pointers.map(([id, name]) => (
              <label key={id} className="text-sm text-gray-700 inline-flex items-center gap-1.5"><input type="checkbox" checked={credit.includes(id)} onChange={e => setCredit(c => (e.target.checked ? [...c, id] : c.filter(x => x !== id)))} />{name}</label>
            ))}
            <span className="ml-auto flex gap-1.5"><Button variant="secondary" onClick={() => setWrong(false)}>Cancel</Button><Button disabled={busy} onClick={() => mark('incorrect')}>Save as wrong</Button></span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The record as JSON, with the doubted keys marked so they can't be missed. Click a key to jump to its check. */
function JsonView({ rec, onPick }: { rec: any; onPick: (name: string) => void }) {
  const fields: any[] = rec.fields
  return (
    <pre className="m-0 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-[13px] leading-6 overflow-x-auto font-mono text-gray-800">
      <span>{'{'}</span>{'\n'}
      {fields.map((f, i) => {
        const hot = f.signals.length > 0
        const tone = f.audit?.verdict === 'correct' ? 'bg-emerald-100 text-emerald-900' : f.audit?.verdict === 'incorrect' ? 'bg-red-100 text-red-900' : hot ? 'bg-amber-100 text-amber-900' : ''
        return (
          <span key={f.name} className={cn('block rounded px-1 -mx-1 cursor-pointer', tone)} onClick={() => onPick(f.name)} title={hot ? f.signals.map((s: any) => KIND[s.kind]?.label).join(', ') : 'Click to check this field'}>
            {'  '}<span className="font-semibold">{JSON.stringify(f.name)}</span>{': '}{f.value === undefined ? <i>missing</i> : JSON.stringify(f.value)}{i < fields.length - 1 ? ',' : ''}
            {hot && <span className="ml-2 text-[11px] font-sans font-semibold">{[...new Set(f.signals.map((s: any) => KIND[s.kind]?.label))].join(' · ')}</span>}
          </span>
        )
      })}
      <span>{'}'}</span>
    </pre>
  )
}
