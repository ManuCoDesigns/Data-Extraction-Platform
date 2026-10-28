import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi } from '@/api/client'
import { sopAssignApi } from '@/api/sopAssign'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tabs, Tile } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { ask } from '@/lib/confirm'

type Tab = 'missing' | 'assigned'
const host = (u?: string | null) => { try { return new URL(/^https?:/i.test(u || '') ? (u as string) : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u || '' } }

/** Sources uploaded from a sheet have no SOP from Xtrium. This suggests one from the source's name, website and category, and a lead confirms it. */
export function SopAssignPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState('')
  const [tab, setTab] = useState<Tab>('missing')
  const [lib, setLib] = useState<any[]>([])
  const [d, setD] = useState<any>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { projectsApi.list().then((r: any) => setProjects(Array.isArray(r) ? r : r.items ?? [])).catch(() => {}); sopAssignApi.library().then(r => setLib(r.sops)).catch(() => {}) }, [])
  const load = () => {
    setD(null)
    sopAssignApi.suggestions({ project_id: projectId || undefined, scope: tab }).then((r: any) => {
      setD(r)
      const p: Record<string, string> = {}, o: Record<string, boolean> = {}
      r.items.forEach((i: any) => { p[i.source_id] = i.current?.code || i.suggested.code; o[i.source_id] = tab === 'missing' && i.suggested.confidence !== 'low' })
      setPick(p); setOn(o)
    }).catch(() => setD({ error: true }))
  }
  useEffect(load, [projectId, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => (d?.items ?? []).filter((i: any) => on[i.source_id]), [d, on])
  const tone = (c: string) => (c === 'high' ? 'green' : c === 'medium' ? 'amber' : 'gray') as any
  const title = (code: string) => lib.find(s => s.code === code)?.title || ''

  const apply = async () => {
    if (!chosen.length) return
    const low = chosen.filter((i: any) => i.suggested.confidence === 'low' && pick[i.source_id] === i.suggested.code).length
    const ok = await ask(`Attach the chosen SOP to ${chosen.length} ${chosen.length === 1 ? 'source' : 'sources'}? Extractors and reviewers will see it on each source.`, {
      title: 'Assign SOPs', confirmLabel: 'Assign', details: low ? [`${low} of these are low-confidence suggestions. Check them first if you have not.`] : undefined,
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await sopAssignApi.apply(chosen.map((i: any) => ({ source_id: i.source_id, sop_code: pick[i.source_id] })))
      toast.success(`${r.applied} ${r.applied === 1 ? 'source' : 'sources'} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`)
      load()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not assign') } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    if (!(await ask('Remove the assigned SOP from this source? It goes back to "no SOP".', { title: 'Remove SOP', confirmLabel: 'Remove', tone: 'danger' }))) return
    try { await sopAssignApi.clear(id); load() } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not remove') }
  }
  const setAll = (f: (i: any) => boolean) => { const o: Record<string, boolean> = {}; (d?.items ?? []).forEach((i: any) => { o[i.source_id] = f(i) }); setOn(o) }

  return (
    <div className={PAGE}>
      <PageHeader title="SOP assignment" subtitle="Sources uploaded from a sheet have no SOP from Xtrium. The platform suggests one from each source's name, website and category, using Xtrium's own routing rules. Nothing is saved until you confirm. Sources that already carry Xtrium's SOP are never changed." />
      <div className="flex gap-3 flex-wrap items-end">
        <SelectBox label="Project" value={projectId} onChange={setProjectId}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
        <Tabs value={tab} onChange={setTab} items={[{ key: 'missing', label: 'Needs a SOP' }, { key: 'assigned', label: 'Assigned here' }]} />
      </div>
      {!d ? <Skeletons rows={6} /> : d.error ? <Blank title="Couldn't load sources" /> : (
        <>
          {tab === 'missing' && (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Without a SOP" value={d.total} tone={d.total ? 'amber' : 'green'} hint="Not pulled from Xtrium" />
              <Tile label="Clear match" value={d.by_confidence.high} tone="green" hint="Website is a known source" />
              <Tile label="Likely" value={d.by_confidence.medium} tone="blue" hint="Several keywords agree" />
              <Tile label="Check these" value={d.by_confidence.low} tone={d.by_confidence.low ? 'red' : 'gray'} hint="Weak or no hint" />
            </div>
          )}
          {tab === 'missing' && d.by_sop.length > 0 && (
            <div className="flex gap-2 flex-wrap text-xs">{d.by_sop.map((s: any) => <Chip key={s.code} tone="indigo" title={s.title}>{s.code.replace('SOP-', '')} · {s.count}</Chip>)}</div>
          )}
          <Panel title={tab === 'missing' ? 'Suggested SOPs' : 'SOPs assigned from the library'} subtitle={tab === 'missing' ? 'Change any suggestion before you apply. Clear and likely matches are ticked for you.' : 'These came from the SOP documents, not from Xtrium. Xtrium\'s own copy replaces them if the source is ever pulled.'}
            actions={tab === 'missing' ? (
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" onClick={() => setAll(i => i.suggested.confidence === 'high')}>Tick clear matches</Button>
                <Button variant="secondary" onClick={() => setAll(() => false)}>Clear ticks</Button>
                <Button onClick={apply} disabled={busy || !chosen.length}>{busy ? 'Assigning…' : `Assign ${chosen.length || ''} selected`}</Button>
              </div>
            ) : undefined}>
            {d.items.length === 0 ? <Blank title={tab === 'missing' ? 'Every source has a SOP' : 'Nothing assigned here yet'} text={tab === 'missing' ? 'Sources without a SOP show up here with a suggestion.' : 'SOPs you assign show up here.'} /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500">{tab === 'missing' && <th className="py-1 pr-2 w-6" />}<th className="py-1 pr-3 font-semibold">Source</th><th className="pr-3 font-semibold">Website</th><th className="pr-3 font-semibold">Category</th><th className="pr-3 font-semibold">SOP</th>{tab === 'missing' && <th className="font-semibold">Why</th>}{tab === 'assigned' && <th />}</tr></thead>
                <tbody>{d.items.map((i: any) => (
                  <tr key={i.source_id} className="border-t border-gray-50 align-top">
                    {tab === 'missing' && <td className="py-2 pr-2"><input type="checkbox" checked={!!on[i.source_id]} onChange={e => setOn(o => ({ ...o, [i.source_id]: e.target.checked }))} aria-label={`Select ${i.name}`} /></td>}
                    <td className="py-2 pr-3"><Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-brand-600 hover:underline">{i.name}</Link></td>
                    <td className="pr-3 text-gray-600 max-w-[190px] truncate" title={i.url || ''}>{host(i.url) || '–'}</td>
                    <td className="pr-3 text-gray-600">{i.category || '–'}</td>
                    <td className="pr-3 min-w-[230px]">
                      <select value={pick[i.source_id] || ''} onChange={e => { const v = e.target.value; setPick(p => ({ ...p, [i.source_id]: v })); if (tab === 'missing') setOn(o => ({ ...o, [i.source_id]: true })) }}
                        className="w-full border border-gray-200 rounded-md py-1 px-2 text-sm bg-white" title={title(pick[i.source_id])}>
                        {lib.map(s => <option key={s.code} value={s.code}>{s.code.replace('SOP-', '')} · {s.title}</option>)}
                      </select>
                      {tab === 'assigned' && pick[i.source_id] !== i.current?.code && <Button variant="secondary" className="mt-1" onClick={async () => { try { await sopAssignApi.apply([{ source_id: i.source_id, sop_code: pick[i.source_id] }]); toast.success('SOP changed'); load() } catch { toast.error('Could not change') } }}>Save change</Button>}
                    </td>
                    {tab === 'missing' && <td className="text-gray-600"><Chip tone={tone(i.suggested.confidence)}>{i.suggested.confidence === 'high' ? 'Clear match' : i.suggested.confidence === 'medium' ? 'Likely' : 'Check'}</Chip> <span className="text-xs">{i.suggested.reason}</span></td>}
                    {tab === 'assigned' && <td className="text-right"><Button variant="ghost" onClick={() => remove(i.source_id)}>Remove</Button></td>}
                  </tr>))}</tbody></table></div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
