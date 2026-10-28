import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi } from '@/api/client'
import { balanceApi } from '@/api/balance'
import { useAuthStore } from '@/store/auth'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tile, shortAgo } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

/** Keeps everyone's remaining extraction work even without an admin. Only sources nobody has started are ever moved. */
export function WorkBalancePage() {
  const { user } = useAuthStore()
  const isAdmin = ['org_admin', 'project_admin'].some(r => user?.roles?.includes(r as any))
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState('')
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { projectsApi.list().then((r: any) => { const l = Array.isArray(r) ? r : r.items ?? []; setProjects(l); if (l[0]) setProjectId(x => x || l[0].id) }).catch(() => {}) }, [])
  const load = () => { if (!projectId) return; setD(null); balanceApi.get(projectId).then(setD).catch(() => setD({ error: true })) }
  useEffect(load, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(true)
    try { const r = await fn(); if (r?.view) setD(r.view); else if (r?.people) setD(r); if (ok) toast.success(ok(r)) } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not save') } finally { setBusy(false) }
  }
  const aside = (d?.people ?? []).filter((p: any) => !p.included).map((p: any) => p.user_id)
  const toggleAside = (uid: string, include: boolean) => act(() => balanceApi.update(projectId, { set_aside: include ? aside.filter((x: string) => x !== uid) : [...aside, uid] }))
  const max = Math.max(1, ...(d?.people ?? []).map((p: any) => p.load))

  return (
    <div className={PAGE}>
      <PageHeader title="Work balance" subtitle="Everyone's remaining extraction work is kept about equal, automatically. When someone flags broken links or finishes faster, sources nobody has started are moved to the people with the least left. Anything an extractor has started is never taken from them."
        actions={isAdmin && d && !d.error ? <Button onClick={() => act(() => balanceApi.run(projectId), r => r.moved ? `${r.moved} ${r.moved === 1 ? 'source' : 'sources'} moved` : 'Already even')} disabled={busy || !d.enabled}>{busy ? 'Working…' : 'Balance now'}</Button> : undefined} />
      <SelectBox label="Project" value={projectId} onChange={setProjectId}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
      {!projectId || !d ? <Skeletons rows={5} /> : d.error ? <Blank title="Couldn't load work balance" /> : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="Balance" value={d.even ? 'Even' : `${d.spread} apart`} tone={d.even ? 'green' : 'amber'} hint="Most minus least remaining" />
            <Tile label="Automatic balancing" value={d.enabled ? 'On' : 'Off'} tone={d.enabled ? 'green' : 'gray'} hint={d.last_run ? `Last checked ${shortAgo(d.last_run)}` : 'Runs on its own'} />
            <Tile label="Remaining" value={d.people.filter((p: any) => p.included).reduce((n: number, p: any) => n + p.load, 0)} tone="blue" hint="Sources still to extract" />
            <Tile label="Can still move" value={d.people.filter((p: any) => p.included).reduce((n: number, p: any) => n + p.movable, 0)} tone="indigo" hint="Not started by anyone" />
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={d.enabled} disabled={busy} onChange={e => act(() => balanceApi.update(projectId, { enabled: e.target.checked }))} /> Balance automatically for this project</label>
              <span className="text-gray-500">Runs whenever someone flags a link and every 30 minutes.</span></div>
          )}
          <Panel title="Remaining work per extractor" subtitle="Sources not yet extracted, not counting ones parked by a broken link or no data">
            {d.people.length === 0 ? <Blank title="No extractors on this project" text="Add members with the extractor role to balance work between them." /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-semibold">Extractor</th><th className="pr-3 font-semibold w-1/3">Remaining</th><th className="pr-3 font-semibold">Started (kept)</th><th className="pr-3 font-semibold">Can move</th><th className="pr-3 font-semibold">Parked</th>{isAdmin && <th className="font-semibold">Included</th>}</tr></thead>
                <tbody>{d.people.map((p: any) => (
                  <tr key={p.user_id} className={`border-t border-gray-50 ${p.included ? '' : 'opacity-50'}`}>
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="pr-3"><div className="flex items-center gap-2"><div className="flex-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(100 * p.load) / max}%` }} /></div><span className="tabular-nums w-6 text-right font-semibold">{p.load}</span></div></td>
                    <td className="pr-3 tabular-nums">{p.started}</td><td className="pr-3 tabular-nums">{p.movable}</td><td className="pr-3 tabular-nums text-gray-500">{p.parked}</td>
                    {isAdmin && <td><input type="checkbox" checked={p.included} disabled={busy} onChange={e => toggleAside(p.user_id, e.target.checked)} aria-label={`Include ${p.name}`} /></td>}
                  </tr>))}</tbody></table></div>
            )}
            {isAdmin && <p className="text-xs text-gray-500 mt-3 mb-0">Untick someone who is away. Their unstarted sources go to the others, and they get no new ones until you tick them again.</p>}
          </Panel>
          <Panel title="Recent automatic moves" subtitle="Every move is recorded here">
            {d.moves.length === 0 ? <Blank title="Nothing has been moved yet" text="Moves show up here when the work gets uneven." /> : (
              <ul className="m-0 p-0 list-none divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {d.moves.map((m: any, i: number) => (
                  <li key={i} className="py-1.5 text-sm flex justify-between gap-3"><span className="truncate">{m.source_id ? <Link to={`/projects/${projectId}/sources/${m.source_id}`} className="text-brand-600 hover:underline">{m.source || 'Source'}</Link> : m.source}</span>
                    <span className="text-gray-600 whitespace-nowrap">{m.from || 'nobody'} <span className="text-gray-400">to</span> {m.to} <Chip tone="gray">{shortAgo(m.at)}</Chip></span></li>))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
