import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, SelectBox, Skeletons, Tabs, type Tone } from '@/components/enh/kit'
import { CATEGORY_OPTIONS } from '@/components/enh/FlagErrorModal'
import { Button, cn, toast } from '@/components/ui'

// The admin's review desk: every field that something doubts is pulled to the top, with the reason beside it,
// so a check against the real source is one click per field instead of a hunt through JSON.

const KIND: Record<string, { label: string; tone: Tone; rank: number }> = {
  comment: { label: 'Peer comment', tone: 'red', rank: 0 },
  mention: { label: 'Peer mentioned', tone: 'red', rank: 1 },
  finding: { label: 'Error logged', tone: 'amber', rank: 2 },
  sop: { label: 'SOP', tone: 'indigo', rank: 3 },
  system: { label: 'System check', tone: 'blue', rank: 4 },
  ai: { label: 'AI or web flag', tone: 'purple', rank: 5 },
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v))
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v)
const err = (e: any, d: string) => e?.response?.data?.detail || d

type Scope = 'peer_done' | 'all'

export function ReviewWorkspace() {
  const [list, setList] = useState<any>(null)
  const [project, setProject] = useState('')
  const [scope, setScope] = useState<Scope>('peer_done')
  const [q, setQ] = useState('')
  const [sourceId, setSourceId] = useState('')

  useEffect(() => { setList(null); qualityApi.reviewSources({ project_id: project || undefined, scope }).then(setList).catch(() => setList({ items: [], projects: [] })) }, [project, scope])
  const items: any[] = useMemo(() => (list?.items ?? []).filter((s: any) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())), [list, q])
  const groups = useMemo(() => {
    const m = new Map<string, any[]>()
    items.forEach(s => { const k = s.project || 'No project'; m.set(k, [...(m.get(k) ?? []), s]) })
    return [...m.entries()]
  }, [items])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <SelectBox label="Project" value={project} onChange={v => { setProject(v); setSourceId('') }}>
          <option value="">All projects</option>
          {(list?.projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.count})</option>)}
        </SelectBox>
        <Tabs value={scope} onChange={setScope} items={[{ key: 'peer_done', label: 'Peer reviewed' }, { key: 'all', label: 'All sources' }]} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a source" aria-label="Find a source" className="text-sm rounded-xl border border-gray-200 px-3 py-1.5 w-48 max-w-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {!list ? <Skeletons rows={5} /> : groups.length === 0 ? (
            <Blank title={scope === 'peer_done' ? 'No peer-reviewed sources yet' : 'No sources'} text={scope === 'peer_done' ? 'Sources show here once every peer reviewer has submitted. Switch to All sources to look at the rest.' : 'Sources show here once work has started.'} />
          ) : groups.map(([name, rows]) => (
            <div key={name}>
              <h3 className="text-xs font-semibold text-gray-500 m-0 mb-1.5 px-1">{name}</h3>
              <ul className="m-0 p-0 list-none space-y-1.5">
                {rows.map(s => (
                  <li key={s.source_id}>
                    <button type="button" onClick={() => setSourceId(s.source_id)} className={cn('w-full text-left rounded-xl border px-3 py-2.5 transition bg-white', sourceId === s.source_id ? 'border-transparent ring-2 ring-brand-400' : 'border-gray-100 hover:border-gray-200')}>
                      <span className="block text-sm font-semibold text-gray-900 truncate">{s.name}</span>
                      <span className="flex items-center gap-1.5 flex-wrap mt-1">
                        <Chip tone={s.peer_done ? 'green' : 'gray'}>{s.peer_done ? 'Peers done' : `Peers ${s.peers_done}/${s.peers_total}`}</Chip>
                        {s.open_findings > 0 && <Chip tone="amber">{s.open_findings} open</Chip>}
                        {s.audited > 0 && <Chip tone="blue">{s.audited} checked</Chip>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
        <main className="min-w-0">
          {sourceId ? <SourceDesk key={sourceId} sourceId={sourceId} /> : <Blank title="Pick a source" text="Choose a source on the left. Fields that peers commented on, the SOP is missing, or the system doubts are pulled to the top." />}
        </main>
      </div>
    </div>
  )
}

function SourceDesk({ sourceId }: { sourceId: string }) {
  const [d, setD] = useState<any>(null)
  const [rid, setRid] = useState('')
  const [view, setView] = useState<'fields' | 'json'>('fields')
  const [onlyFlagged, setOnlyFlagged] = useState(true)
  const [hideDone, setHideDone] = useState(false)
  const [active, setActive] = useState('')
  const load = useCallback(() => qualityApi.reviewSource(sourceId).then(r => { setD(r); setRid(cur => (cur && r.records.some((x: any) => x.record_id === cur) ? cur : r.records[0]?.record_id ?? '')) }).catch(() => setD({ error: true })), [sourceId])
  useEffect(() => { setD(null); load() }, [load])

  const rec = d?.records?.find((r: any) => r.record_id === rid)
  const shown = useMemo(() => (rec?.fields ?? []).filter((f: any) => (!onlyFlagged || f.signals.length > 0 || f.audit) && (!hideDone || !f.audit)), [rec, onlyFlagged, hideDone])
  const nextTodo = useCallback(() => {
    const todo = (rec?.fields ?? []).filter((f: any) => f.signals.length > 0 && !f.audit)
    setActive(todo[0]?.name ?? '')
  }, [rec])
  useEffect(() => { nextTodo() }, [rid, d])  // eslint-disable-line react-hooks/exhaustive-deps

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
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  if (!d) return <Skeletons rows={5} />
  if (d.error) return <Blank title="Couldn't open this source" text="Check your connection and try again." />
  const t = d.totals
  const pctDone = t.flagged ? Math.round(100 * d.records.reduce((n: number, r: any) => n + r.fields.filter((f: any) => f.signals.length && f.audit).length, 0) / t.flagged) : 100

  return (
    <div className="space-y-4">
      <Panel title={d.source} subtitle={d.peer_done ? 'Every peer reviewer has submitted.' : 'Some peer reviewers have not submitted yet.'}
        actions={<div className="flex items-center gap-1.5 flex-wrap">{d.sop_code && <Chip tone="indigo">{d.sop_code}</Chip>}{d.website && <a href={d.website} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">Open the source site</a>}</div>}>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 text-sm">
          <Stat label="Fields doubted" value={t.flagged} sub={`of ${t.fields}`} />
          <Stat label="Peer comments" value={t.comments} sub="on a field" />
          <Stat label="Peer mentions" value={t.mentions} sub="in their notes" />
          <Stat label="Checked at source" value={t.audited} sub="fields so far" />
        </div>
        <div className="mt-3"><div className="flex justify-between text-xs text-gray-500 mb-1"><span>Doubted fields settled</span><span className="tabular-nums">{pctDone}%</span></div>
          <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${pctDone}%` }} /></div></div>
        {d.peers.some((p: any) => p.comment) && (
          <div className="mt-4 space-y-2">
            {d.peers.filter((p: any) => p.comment).map((p: any) => (
              <div key={p.id} className="rounded-xl bg-gray-50 px-3 py-2 text-sm"><span className="font-semibold text-gray-900">{p.name}</span><span className="text-gray-400"> wrote </span><span className="text-gray-700">{p.comment}</span></div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)] items-start">
        <nav aria-label="Records" className="rounded-2xl border border-gray-100 bg-white p-2 xl:max-h-[70vh] overflow-y-auto">
          <p className="text-[11px] text-gray-400 px-2 py-1 m-0">Riskiest first. Press j and k to move.</p>
          <ul className="m-0 p-0 list-none">
            {d.records.map((r: any) => (
              <li key={r.record_id}>
                <button type="button" onClick={() => setRid(r.record_id)} className={cn('w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center gap-2', rid === r.record_id ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700 hover:bg-gray-50')}>
                  <span className={cn('w-2 h-2 rounded-full shrink-0', r.todo > 0 ? 'bg-red-500' : r.audited > 0 ? 'bg-emerald-500' : 'bg-gray-300')} aria-hidden />
                  <span className="truncate flex-1">{r.record}</span>
                  {r.todo > 0 && <span className="text-[11px] tabular-nums text-red-600 font-semibold">{r.todo}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={view} onChange={setView} items={[{ key: 'fields', label: 'Fields' }, { key: 'json', label: 'JSON' }]} />
            <label className="text-sm text-gray-600 inline-flex items-center gap-1.5"><input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Only doubted fields</label>
            <label className="text-sm text-gray-600 inline-flex items-center gap-1.5"><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide checked</label>
            <span className="ml-auto flex gap-1.5"><Button variant="secondary" onClick={() => move(-1)}>Previous</Button><Button variant="secondary" onClick={() => move(1)}>Next record</Button></span>
          </div>
          {!rec ? <Blank title="No records" /> : view === 'json' ? <JsonView rec={rec} onPick={n => { setView('fields'); setOnlyFlagged(false); setActive(n) }} /> : (
            <div className="space-y-2.5">
              {rec.general.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                  {rec.general.map((g: any, i: number) => <p key={i} className="m-0"><b>{g.by}</b>: {g.text}</p>)}
                </div>
              )}
              {shown.length === 0 ? <Blank title={onlyFlagged ? 'Nothing doubted on this record' : 'Nothing to show'} text={onlyFlagged ? 'Untick "Only doubted fields" to check any field at random.' : ''} /> :
                shown.map((f: any) => <FieldRow key={rec.record_id + f.name} rec={rec} f={f} peers={d.peers} active={active === f.name} onActive={() => setActive(f.name)} onDone={() => { load() }} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div><div className="text-2xl font-extrabold tabular-nums text-gray-900 leading-none">{value}</div><div className="text-xs font-semibold text-gray-700 mt-1">{label}</div><div className="text-[11px] text-gray-400">{sub}</div></div>
}

function FieldRow({ rec, f, peers, active, onActive, onDone }: { rec: any; f: any; peers: any[]; active: boolean; onActive: () => void; onDone: () => void }) {
  const [wrong, setWrong] = useState(false)
  const [truth, setTruth] = useState('')
  const [category, setCategory] = useState('wrong_value')
  const [credit, setCredit] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const sigs = [...f.signals].sort((a: any, b: any) => (KIND[a.kind]?.rank ?? 9) - (KIND[b.kind]?.rank ?? 9))
  const pointers = [...new Map(f.signals.filter((s: any) => (s.kind === 'mention' || s.kind === 'comment') && s.by_id).map((s: any) => [s.by_id, s.by])).entries()] as [string, string][]
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [active])
  useEffect(() => { setCredit(pointers.map(p => p[0])) }, [f.signals.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const verdict = f.audit?.verdict
  const edge = verdict === 'correct' ? 'border-l-emerald-500' : verdict === 'incorrect' ? 'border-l-red-500' : sigs.length ? 'border-l-amber-500' : 'border-l-gray-200'

  const mark = async (v: 'correct' | 'incorrect') => {
    if (v === 'incorrect' && !truth.trim()) { toast.error('Type what the source really says'); return }
    setBusy(true)
    try { await qualityApi.mark({ record_id: rec.record_id, field: f.name, verdict: v, truth_value: truth.trim() || undefined, category, credit: v === 'incorrect' ? credit : [] }); setWrong(false); setTruth(''); onDone() }
    catch (e) { toast.error(err(e, "Couldn't save that")) } finally { setBusy(false) }
  }
  const empty = show(f.value) === ''
  return (
    <div ref={ref} onClick={onActive} className={cn('rounded-xl border border-gray-100 border-l-4 bg-white px-4 py-3', edge, active && 'ring-2 ring-brand-300')}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-1.5 flex-wrap"><span className="text-xs font-semibold text-gray-500">{f.name}</span>
            {sigs.map((s: any, i: number) => <Chip key={i} tone={KIND[s.kind]?.tone ?? 'gray'} title={s.text}>{KIND[s.kind]?.label ?? s.kind}{s.by && s.kind !== 'finding' ? `: ${s.by}` : ''}</Chip>)}
            {verdict && <Chip tone={verdict === 'correct' ? 'green' : 'red'}>{verdict === 'correct' ? 'Checked: correct' : 'Checked: wrong'}</Chip>}</div>
          <div className={cn('text-sm mt-1 break-words whitespace-pre-wrap', empty ? 'text-gray-400 italic' : 'text-gray-900 font-medium')}>
            {empty ? 'Empty' : isUrl(f.value) ? <a href={f.value} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all">{f.value}</a> : show(f.value)}
          </div>
          {sigs.filter((s: any) => s.text && s.kind !== 'mention').slice(0, 3).map((s: any, i: number) => <p key={i} className="text-xs text-gray-500 mt-1 mb-0">{s.by ? `${s.by}: ` : ''}{s.text}</p>)}
          {f.audit?.truth_value && <p className="text-xs text-gray-600 mt-1 mb-0">Source says: <b>{f.audit.truth_value}</b></p>}
        </div>
        {!wrong && (
          <div className="flex gap-1.5 shrink-0">
            <Button variant={verdict === 'correct' ? 'primary' : 'secondary'} disabled={busy} onClick={e => { e.stopPropagation(); mark('correct') }}>Correct</Button>
            <Button variant={verdict === 'incorrect' ? 'primary' : 'secondary'} disabled={busy} onClick={e => { e.stopPropagation(); setWrong(true) }}>Wrong</Button>
          </div>
        )}
      </div>
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
