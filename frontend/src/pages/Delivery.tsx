import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Printer, RefreshCw, CheckCircle2, MessageCircleQuestion, LinkIcon } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Button, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, Tile, PAGE } from '@/components/enh/kit'
import { LinkChip } from '@/pages/DataHealth'
import { fmtDate, fmtDateTime } from '@/lib/prefs'
import { downloadText, toCsv } from '@/lib/csv'

const STAGES: { key: string; label: string; bar: string; dot: string }[] = [
  { key: 'delivered', label: 'Delivered', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'review', label: 'In review', bar: 'bg-purple-500', dot: 'bg-purple-500' },
  { key: 'extraction', label: 'Being extracted', bar: 'bg-blue-500', dot: 'bg-blue-500' },
  { key: 'not_started', label: 'Not started', bar: 'bg-gray-300', dot: 'bg-gray-300' },
]

/** A single page for a status call with the client. Prints cleanly and exports to CSV. */
export function DeliveryPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setD(await enhApi.delivery(project || undefined)) } catch { toast.error("Couldn't load the delivery summary") } finally { setLoading(false) }
  }, [project])
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { setLoading(true); load() }, [load])

  const projectName = project ? projects.find(p => p.id === project)?.name : 'All projects'
  const exportCsv = () => {
    if (!d) return
    const rows = d.delivered.map((r: any) => [r.name, r.project, r.item_no ?? '', r.records, fmtDate(r.approved_at), r.submitted_at ? fmtDate(r.submitted_at) : ''])
    downloadText(`delivered_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Source', 'Project', 'Xtrium item', 'Records', 'Approved', 'Submitted to Xtrium'], rows))
  }

  return (
    <div className={PAGE}>
      <style>{`@media print {
        aside, nav, header, [data-noprint] { display: none !important }
        body, main { background: #fff !important }
        main { padding: 0 !important; margin: 0 !important }
        section { break-inside: avoid; box-shadow: none !important }
      }`}</style>
      <PageHeader title="Delivery summary" subtitle="What has been delivered, what is moving, and what we are waiting on the client for."
        actions={<span data-noprint className="flex items-center gap-2 flex-wrap">
          {projects.length > 1 && (
            <SelectBox label="Project" value={project} onChange={setProject}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          )}
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!d?.delivered?.length}><Download className="w-3.5 h-3.5" /> Delivered CSV</Button>
          <Button size="sm" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" /> Print or save as PDF</Button>
        </span>} />

      {loading || !d ? <Skeletons rows={5} /> : (
        <>
          <p className="hidden print:block text-sm text-gray-600 m-0">{projectName}. Prepared {fmtDateTime(d.generated_at)}.</p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Delivered" value={`${d.totals.delivered} of ${d.totals.sources}`} hint={`${d.totals.percent}% of sources`} tone="green" />
            <Tile label="Records delivered" value={d.totals.records_delivered.toLocaleString()} hint="Approved records" tone="green" />
            <Tile label="Delivered this week" value={d.totals.delivered_this_week} hint="Last 7 days" tone={d.totals.delivered_this_week ? 'green' : 'gray'} />
            <Tile label="Waiting on client" value={d.waiting_on_client.length} hint="Open questions" tone={d.waiting_on_client.length ? 'amber' : 'gray'} />
          </div>

          <Panel title="Where everything stands" subtitle={d.totals.sources ? `${d.totals.sources} source${d.totals.sources === 1 ? '' : 's'} in scope.` : 'No sources in scope yet.'}>
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100" role="img"
              aria-label={STAGES.map(s => `${d.stages[s.key]} ${s.label.toLowerCase()}`).join(', ')}>
              {STAGES.map(s => d.stages[s.key] > 0 && <div key={s.key} className={s.bar} style={{ width: `${(d.stages[s.key] / d.totals.sources) * 100}%` }} />)}
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-1.5 m-0 mt-3 p-0 list-none">
              {STAGES.map(s => (
                <li key={s.key} className="flex items-center gap-2 text-sm text-gray-600">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} /> {s.label} <b className="text-gray-900 tabular-nums">{d.stages[s.key]}</b>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel flush title="Delivered" subtitle={d.delivered_count > d.delivered.length ? `Showing the latest ${d.delivered.length} of ${d.delivered_count}.` : undefined}>
            {d.delivered.length === 0 ? <Blank icon={<CheckCircle2 className="w-5 h-5" />} title="Nothing delivered yet" text="Approved sources appear here with their approval date and record count." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="font-medium px-5 py-2.5">Source</th><th className="font-medium px-3 py-2.5">Item</th>
                    <th className="font-medium px-3 py-2.5 text-right">Records</th><th className="font-medium px-3 py-2.5">Approved</th><th className="font-medium px-3 py-2.5 pr-5">Submitted to Xtrium</th>
                  </tr></thead>
                  <tbody>
                    {d.delivered.map((r: any) => (
                      <tr key={r.source_id} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-2.5"><Link to={`/projects/${r.project_id}/sources/${r.source_id}`} className="font-medium text-gray-900 hover:text-brand-600">{r.name}</Link>
                          {!project && r.project && <span className="block text-xs text-gray-400">{r.project}</span>}</td>
                        <td className="px-3 py-2.5 text-gray-500 tabular-nums">{r.item_no ? `#${r.item_no}` : ''}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.records}</td>
                        <td className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDate(r.approved_at)}</td>
                        <td className="px-3 py-2.5 pr-5 text-gray-600 tabular-nums">{r.submitted_at ? fmtDate(r.submitted_at) : <span className="text-gray-300">Not yet</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel flush title="We are waiting on the client" subtitle="Questions that have no answer yet.">
              {d.waiting_on_client.length === 0 ? <Blank icon={<MessageCircleQuestion className="w-5 h-5" />} title="Nothing outstanding" text="Every question we asked has been answered." /> : (
                <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                  {d.waiting_on_client.map((q: any) => (
                    <li key={q.id} className="px-5 py-3">
                      <p className="text-sm text-gray-900 m-0">{q.question}</p>
                      <p className="text-xs text-gray-400 m-0 mt-1 flex items-center gap-2 flex-wrap">
                        {q.source_name && <Link to={`/projects/${q.project_id}/sources/${q.source_id}`} className="hover:text-brand-600">{q.source_name}</Link>}
                        <span>Asked {fmtDate(q.created_at)}</span>
                        <Chip tone={q.sent_to_client_at ? 'green' : 'gray'}>{q.sent_to_client_at ? 'Sent to client' : 'Not sent yet'}</Chip>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel flush title="Websites we could not open" subtitle="Sign-in, blocked or not found. Not yet delivered.">
              {d.cant_open.length === 0 ? <Blank icon={<LinkIcon className="w-5 h-5" />} title="No link problems" text="Every checked website opened. Run Check links in Data health to refresh." /> : (
                <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                  {d.cant_open.map((r: any) => (
                    <li key={r.source_id} className="px-5 py-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`/projects/${r.project_id}/sources/${r.source_id}`} className="text-sm font-medium text-gray-900 hover:text-brand-600">{r.name}</Link>
                        {r.url && <p className="text-xs text-gray-400 m-0 truncate">{r.url}</p>}
                      </div>
                      <LinkChip status={r.status} detail={r.detail} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
