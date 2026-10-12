import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, CheckCircle2, ChevronDown, Mail, RefreshCw, Siren } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Avatar, Button, cn, safeFromNow, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, Tile, dayLabel, levelTone, PAGE, shortAgo } from '@/components/enh/kit'

interface Item { source_id: string; source_name: string; project_id: string; project_name: string; stage: string; days: number; level: string; name: string; role: string }
interface Person { user_id?: string | null; name: string; role: string; count: number; oldest_days: number; level: string; items: Item[] }

const ROLE_LABEL: Record<string, string> = { extractor: 'Extractor', 'peer reviewer': 'Peer reviewer', admin: 'Admin', unassigned: 'No one yet', system: 'System' }

export function DigestPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'mail' | 'nudge' | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try { setData(await enhApi.digest(project || undefined)) }
    catch { toast.error("Couldn't load the digest") } finally { setLoading(false) }
  }, [project])
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 120000); return () => clearInterval(t) }, [load])

  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const nudge = async () => {
    setBusy('nudge')
    try {
      const r = await enhApi.runReminders()
      toast.success(r.people + r.admins === 0 ? 'Nobody needed a reminder (or they were already reminded today)' : `Sent ${r.people} reminder${r.people === 1 ? '' : 's'} to people and ${r.admins} to admins`)
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't send reminders") } finally { setBusy(null) }
  }
  const mail = async () => {
    setBusy('mail')
    try { const r = await enhApi.emailDigest(); toast.success(`Sent to ${r.sent_to}`) }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't send the email") } finally { setBusy(null) }
  }

  const t = data?.totals
  return (
    <div className={PAGE}>
      <PageHeader title="Daily digest" subtitle="What is waiting on whom, what is overdue, and what was approved. Admins also get this by email each morning once email is set up."
        actions={<>
          {projects.length > 1 && (
            <SelectBox label="Project" value={project} onChange={setProject}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          )}
          <Button variant="secondary" size="sm" onClick={() => load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button variant="secondary" size="sm" onClick={mail} loading={busy === 'mail'}><Mail className="w-4 h-4" /> Email me this</Button>
          <Button size="sm" onClick={nudge} loading={busy === 'nudge'}><BellRing className="w-4 h-4" /> Send reminders now</Button>
        </>} />

      {loading || !data ? <Skeletons rows={5} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Tile label="Open" value={t.open} tone="blue" hint="Not approved yet" />
            <Tile label="Overdue" value={t.overdue} tone="amber" hint="Waiting 3 to 6 days" />
            <Tile label="Critical" value={t.critical} tone="red" hint="Waiting 7+ days" />
            <Tile label="Sign-off" value={t.signoff} tone="indigo" hint="Admin to approve" />
            <Tile label="Unassigned" value={t.unassigned} tone="purple" hint="Needs assigning" />
            <Tile label="Approved 24h" value={t.approved_24h} tone="green" hint="Last 24 hours" />
            <Tile label="This week" value={t.approved_7d} tone="green" hint="Last 7 days" />
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <Panel flush title="Who has what" subtitle="Longest waiting first. Open a row to see the sources.">
              {data.people.length === 0 ? <Blank icon={<CheckCircle2 className="w-5 h-5" />} title="Nothing is waiting" text="Every source you can see is approved." /> : (
                <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                  {data.people.map((p: Person) => {
                    const k = p.user_id ?? p.name
                    const isOpen = open.has(k)
                    return (
                      <li key={k}>
                        <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen}
                          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50/70 transition">
                          {p.role === 'admin' || p.role === 'unassigned' || p.role === 'system'
                            ? <span className="w-7 h-7 rounded-full border border-dashed border-gray-300 shrink-0" />
                            : <Avatar name={p.name} size="sm" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900 m-0 truncate">{p.name}</p>
                            <p className="text-xs text-gray-400 m-0">{ROLE_LABEL[p.role] ?? p.role}</p>
                          </div>
                          <Chip tone="gray"><span className="tabular-nums">{p.count}</span> source{p.count === 1 ? '' : 's'}</Chip>
                          <Chip tone={levelTone(p.level)} title="Their longest wait">{dayLabel(p.oldest_days)}</Chip>
                          <ChevronDown className={cn('w-4 h-4 text-gray-300 transition-transform', isOpen && 'rotate-180')} />
                        </button>
                        {isOpen && (
                          <ul className="m-0 px-5 pb-3 pl-16 list-none space-y-1.5">
                            {p.items.map(i => (
                              <li key={i.source_id + i.stage} className="flex items-center gap-2 text-sm">
                                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', i.level === 'red' ? 'bg-red-500' : i.level === 'amber' ? 'bg-amber-500' : 'bg-gray-300')} />
                                <Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-gray-800 hover:text-brand-600 truncate flex-1 min-w-0">{i.source_name}</Link>
                                <span className="text-xs text-gray-400 shrink-0">{i.stage}</span>
                                <span className={cn('text-xs tabular-nums w-14 text-right shrink-0', i.level === 'red' ? 'text-red-600 font-semibold' : i.level === 'amber' ? 'text-amber-600 font-semibold' : 'text-gray-400')}>{dayLabel(i.days)}</span>
                              </li>
                            ))}
                            {p.count > p.items.length && (
                              <li className="text-xs text-gray-400 pt-1">and {p.count - p.items.length} more, shorter waits</li>
                            )}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>

            <div className="space-y-5">
              <Panel flush title="Waiting longest" subtitle="3 days or more">
                {data.overdue.length === 0 ? <Blank title="Nothing is overdue" text="Nobody has had work for 3 days or more." /> : (
                  <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                    {data.overdue.slice(0, 8).map((i: Item) => (
                      <li key={i.source_id + i.name + i.stage} className="px-5 py-3 flex items-center gap-3">
                        <Siren className={cn('w-4 h-4 shrink-0', i.level === 'red' ? 'text-red-500' : 'text-amber-500')} />
                        <div className="min-w-0 flex-1">
                          <Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-sm font-medium text-gray-900 hover:text-brand-600 truncate block">{i.source_name}</Link>
                          <p className="text-xs text-gray-400 m-0 truncate">{i.role === 'unassigned' ? i.stage : `${i.stage}, ${i.name}`}</p>
                        </div>
                        <Chip tone={levelTone(i.level)}>{dayLabel(i.days)}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel flush title="Approved in the last 24 hours">
                {data.approved.length === 0 ? <Blank title="Nothing approved today yet" /> : (
                  <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                    {data.approved.map((a: any) => (
                      <li key={a.source_id} className="px-5 py-3 flex items-center gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <Link to={`/projects/${a.project_id}/sources/${a.source_id}`} className="text-sm text-gray-800 hover:text-brand-600 truncate flex-1 min-w-0">{a.source_name}</Link>
                        <span className="text-xs text-gray-400 shrink-0">{a.records} records, {shortAgo(a.approved_at)} ago</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
