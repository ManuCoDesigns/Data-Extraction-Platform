import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi } from '@/api/client'
import { dispatchApi } from '@/api/dispatch'
import { useAuthStore } from '@/store/auth'
import { Blank, Chip, Panel, SelectBox, Skeletons, shortAgo } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

/** New pulls: share them across the team in one click, and stop the clock on sources that can wait.
 *  Sits on the Team workload page above Work balance. */
export function DispatchPanel() {
  const { user } = useAuthStore()
  const isAdmin = ['org_admin', 'project_admin'].some(r => user?.roles?.includes(r as any))
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState('')
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { projectsApi.list().then((r: any) => { const l = Array.isArray(r) ? r : r.items ?? []; setProjects(l); if (l[0]) setProjectId(x => x || l[0].id) }).catch(() => {}) }, [])
  const load = () => { if (!projectId) return; setD(null); dispatchApi.get(projectId).then(setD).catch(() => setD({ error: true })) }
  useEffect(load, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(true)
    try { const r = await fn(); if (r?.view) setD(r.view); else if (r?.batches) setD(r); if (ok) toast.success(ok(r)) } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not save') } finally { setBusy(false) }
  }
  const share = (key?: string) => act(() => dispatchApi.share(projectId, key ? { batch_key: key } : {}), r =>
    r.assigned ? `${r.assigned} shared: ${Object.entries(r.per_person).map(([n, c]) => `${n} ${c}`).join(', ')}` : (r.reason || 'Nothing to share'))
  const hold = (key: string, on: boolean) => act(() => dispatchApi.hold(projectId, { hold: on, batch_key: key }), r => r.changed ? `${r.changed} ${on ? 'put on hold' : 'released'}` : (on ? 'Nothing to hold in this pull' : 'Nothing was on hold'))

  const summary = d && !d.error ? `${d.unassigned.total} to share · ${d.held_count} on hold` : ''
  return (
    <div className="rounded-2xl border border-gray-200 bg-white mb-3" style={{ background: 'var(--bg-fff)', borderColor: 'var(--bd-e2e8f0)' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <span className="font-bold text-sm">New pulls: share and hold</span>
        {d && !d.error && <Chip tone={d.unassigned.total || d.held_count ? 'amber' : 'green'}>{summary}</Chip>}
        <span className="text-xs text-gray-500 flex-1 hidden md:block">Share new links with the team in one click. Hold the clock on sources that can wait.</span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <SelectBox label="Project" value={projectId} onChange={setProjectId}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
            {d && !d.error && <Button onClick={() => share()} disabled={busy || !d.unassigned.total}>{busy ? 'Working…' : `Share all ${d.unassigned.total || ''} unassigned`.trim()}</Button>}
          </div>
          {!projectId || !d ? <Skeletons rows={4} /> : d.error ? <Blank title="Couldn't load this project" /> : (
            <>
              <Panel title="Pulls" subtitle="Sources Xtrium gave on the same day are one pull. Sharing deals them to whoever has the least left, without starting their clock.">
                {d.batches.length === 0 ? <Blank title="No open sources" text="Everything here is delivered." /> : (
                  <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-semibold">Pull</th><th className="pr-3 font-semibold">Open</th><th className="pr-3 font-semibold">Not yet owned</th><th className="pr-3 font-semibold">On hold</th><th className="font-semibold text-right">Actions</th></tr></thead>
                    <tbody>{d.batches.map((b: any) => (
                      <tr key={b.key} className="border-t border-gray-50">
                        <td className="py-2 pr-3 font-medium">{b.label}</td><td className="pr-3 tabular-nums">{b.open}</td>
                        <td className="pr-3 tabular-nums">{b.unassigned}</td><td className="pr-3 tabular-nums">{b.held}</td>
                        <td className="py-1.5"><div className="flex gap-2 justify-end flex-wrap">
                          <Button variant="secondary" size="sm" disabled={busy || !b.unassigned} onClick={() => share(b.key)}>Share {b.unassigned || ''}</Button>
                          {b.held < b.unstarted && <Button variant="secondary" size="sm" disabled={busy || !b.unstarted} onClick={() => hold(b.key, true)}>Hold not started</Button>}
                          {b.held > 0 && <Button variant="secondary" size="sm" disabled={busy} onClick={() => hold(b.key, false)}>Release {b.held}</Button>}
                        </div></td>
                      </tr>))}</tbody></table></div>
                )}
                <p className="text-xs text-gray-500 mt-3 mb-0">Holding stops the clock: held sources are not shown as overdue, nobody is reminded about them, and the days in reports leave that time out. Sources someone has already started are never put on hold by a pull. Releasing starts the clock where it stopped.</p>
              </Panel>
              {isAdmin && (
                <div className="flex items-center gap-3 text-sm flex-wrap"><label className="flex items-center gap-2"><input type="checkbox" checked={d.auto_share} disabled={busy} onChange={e => act(() => dispatchApi.auto(projectId, e.target.checked))} /> Share new pulls with the team automatically</label>
                  <span className="text-gray-500">Checked every 30 minutes. Nothing already owned or started is touched.</span></div>
              )}
              {d.held.length > 0 && (
                <Panel title="On hold" subtitle="The clock is stopped for these">
                  <ul className="m-0 p-0 list-none divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {d.held.map((h: any) => (
                      <li key={h.source_id} className="py-1.5 text-sm flex justify-between gap-3 items-center">
                        <span className="truncate"><Link to={`/projects/${projectId}/sources/${h.source_id}`} className="text-brand-600 hover:underline">{h.name}</Link>{h.item_no ? <span className="text-gray-400"> #{h.item_no}</span> : null}</span>
                        <span className="flex items-center gap-2 whitespace-nowrap"><Chip tone="gray">held {shortAgo(h.since)}</Chip>
                          <button className="text-xs text-brand-600 hover:underline" disabled={busy} onClick={() => act(() => dispatchApi.hold(projectId, { hold: false, source_ids: [h.source_id] }))}>Release</button></span>
                      </li>))}
                  </ul>
                </Panel>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
