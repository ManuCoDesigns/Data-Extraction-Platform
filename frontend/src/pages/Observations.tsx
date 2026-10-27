import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { observationsApi, projectsApi } from '@/api/client'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tile } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

/** Every issue extractors and reviewers recorded, how often each came up, and who still has to record theirs. Feeds the reports. */
export function ObservationsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState('')
  const [kind, setKind] = useState('')
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(Array.isArray(r) ? r : r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { setD(null); observationsApi.summary({ project_id: projectId || undefined, kind: kind || undefined }).then(setD).catch(() => setD({ error: true })) }, [projectId, kind])
  const max = Math.max(1, ...(d?.by_kind ?? []).map((k: any) => k.count))
  const dl = async () => { setBusy(true); try { await observationsApi.download({ project_id: projectId || undefined, kind: kind || undefined }) } catch { toast.error('Nothing to download yet') } finally { setBusy(false) } }

  return (
    <div className={PAGE}>
      <PageHeader title="Observations" subtitle="What extractors and reviewers ran into on each source: pages that would not open, logins, no data. Everyone who works a source has to record theirs, and the reports are built from this."
        actions={<Button variant="secondary" onClick={dl} disabled={busy || !d || d.error}>{busy ? 'Preparing…' : 'Download Excel'}</Button>} />
      <div className="flex gap-3 flex-wrap">
        <SelectBox label="Project" value={projectId} onChange={setProjectId}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
        {d && !d.error && <SelectBox label="Issue" value={kind} onChange={setKind}><option value="">All issues</option>{d.kinds.map((k: any) => <option key={k.key} value={k.key}>{k.label}</option>)}</SelectBox>}
      </div>
      {!d ? <Skeletons rows={5} /> : d.error ? <Blank title="Couldn't load observations" /> : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="Issues recorded" value={d.total} tone={d.total ? 'amber' : 'gray'} hint={`Across ${d.sources_affected} sources`} />
            <Tile label="Confirmed no issues" value={d.confirmed_none} tone="green" hint="People who looked and found none" />
            <Tile label="Still to record" value={d.missing.length} tone={d.missing.length ? 'red' : 'green'} hint="Extractors and reviewers who owe a check" />
            <Tile label="Kinds seen" value={d.by_kind.length} tone="blue" hint="Different issues so far" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="What came up most" subtitle="Click one to filter the list">
              {d.by_kind.length === 0 ? <Blank title="No issues recorded" text="Issues show here as extractors and reviewers record them." /> : (
                <ul className="m-0 p-0 list-none space-y-2.5">
                  {d.by_kind.map((k: any) => (
                    <li key={k.kind}><button onClick={() => setKind(kind === k.kind ? '' : k.kind)} className="w-full text-left">
                      <div className="flex justify-between text-sm"><span className="text-gray-800">{k.label} <span className="text-gray-400 text-xs">{k.group}</span></span><span className="font-semibold tabular-nums">{k.count} <span className="text-gray-400 font-normal">on {k.sources} {k.sources === 1 ? 'source' : 'sources'}</span></span></div>
                      <div className="h-1.5 rounded-full bg-gray-100 mt-1"><div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${(100 * k.count) / max}%` }} /></div>
                    </button></li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Still to record" subtitle="Peer reviewers are held up until the extractor has recorded theirs">
              {d.missing.length === 0 ? <Blank title="Everyone is up to date" text="Nobody owes an observation check right now." /> : (
                <ul className="m-0 p-0 list-none divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {d.missing.map((m: any, i: number) => (
                    <li key={i} className="py-1.5 text-sm flex justify-between gap-3"><Link to={`/projects/${m.project_id}/sources/${m.source_id}`} className="text-brand-600 hover:underline truncate">{m.source}</Link><span className="text-gray-600 whitespace-nowrap">{m.person} · {m.role === 'extractor' ? 'Extractor' : 'Reviewer'}</span></li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <Panel title="Everything recorded" subtitle={`${d.items.length} shown`}>
            {d.items.length === 0 ? <Blank title="Nothing here yet" /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-semibold">Source</th><th className="pr-3 font-semibold">Issue</th><th className="pr-3 font-semibold">Note</th><th className="pr-3 font-semibold">Recorded by</th><th className="font-semibold">When</th></tr></thead>
                <tbody>{d.items.map((i: any) => (
                  <tr key={i.id} className="border-t border-gray-50 align-top">
                    <td className="py-1.5 pr-3"><Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-brand-600 hover:underline">{i.source}</Link>{i.item_no ? <span className="text-gray-400"> #{i.item_no}</span> : null}</td>
                    <td className="pr-3"><Chip tone={i.group === 'Access' ? 'amber' : 'purple'}>{i.label}</Chip></td>
                    <td className="pr-3 text-gray-600">{i.note || ''}</td>
                    <td className="pr-3 whitespace-nowrap">{i.user} <span className="text-gray-400">({i.role})</span></td>
                    <td className="text-gray-500 whitespace-nowrap">{String(i.created_at || '').slice(0, 10)}</td>
                  </tr>))}</tbody></table></div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
