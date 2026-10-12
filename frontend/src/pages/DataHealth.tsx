import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardCopy, ExternalLink, Link2, RefreshCw, ShieldAlert, ShieldCheck, Copy } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Button, cn, safeFromNow, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, Tabs, Tile, type Tone, PAGE, shortAgo } from '@/components/enh/kit'
import { useAuthStore } from '@/store/auth'

type LinkStatus = 'ok' | 'login' | 'blocked' | 'dead' | 'error' | 'unchecked' | 'none'
interface LinkRow {
  source_id: string; source_name: string; project_id: string; project_name: string; url?: string | null
  status: LinkStatus; http_code?: number | null; detail?: string | null; manual: boolean
  checked_at?: string | null; extractor?: string | null; source_status: string
}

export const LINK_META: Record<LinkStatus, { label: string; tone: Tone; hint: string }> = {
  login: { label: 'Needs login', tone: 'amber', hint: 'Opens a sign-in or paywall' },
  blocked: { label: 'Blocked', tone: 'red', hint: 'Refuses automated access' },
  dead: { label: 'Not found', tone: 'red', hint: 'Page or site is gone' },
  error: { label: "Couldn't check", tone: 'purple', hint: 'Timeout or server error' },
  unchecked: { label: 'Not checked', tone: 'gray', hint: 'Never checked' },
  ok: { label: 'Opens fine', tone: 'green', hint: 'No problem found' },
  none: { label: 'No link', tone: 'gray', hint: 'Source has no website' },
}
const ORDER: LinkStatus[] = ['login', 'blocked', 'dead', 'error', 'unchecked', 'ok', 'none']
const hostOf = (u?: string | null) => (u ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')

export function LinkChip({ status, detail }: { status: LinkStatus; detail?: string | null }) {
  const m = LINK_META[status]
  return <Chip tone={m.tone} title={detail || m.hint}>{m.label}</Chip>
}

export function DataHealthPage() {
  const { user } = useAuthStore()
  const isLead = ['org_admin', 'project_admin', 'qa_lead'].some(r => user?.roles?.includes(r))
  const [tab, setTab] = useState<'links' | 'dups'>('links')
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState('')
  const [links, setLinks] = useState<LinkRow[]>([])
  const [dups, setDups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LinkStatus | 'all'>('all')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, d] = await Promise.all([
        enhApi.links(project || undefined),
        isLead ? enhApi.duplicates(project || undefined) : Promise.resolve({ groups: [] }),
      ])
      setLinks(l.items); setDups(d.groups)
    } catch { toast.error("Couldn't load data health") } finally { setLoading(false) }
  }, [project, isLead])

  useEffect(() => { projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { setLoading(true); load() }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    links.forEach(l => { c[l.status] = (c[l.status] ?? 0) + 1 })
    return c
  }, [links])
  const shown = useMemo(() => {
    const rows = filter === 'all' ? links.filter(l => l.status !== 'none') : links.filter(l => l.status === filter)
    return [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.source_name.localeCompare(b.source_name))
  }, [links, filter])

  const runCheck = async (everything: boolean) => {
    const targets = links.filter(l => l.url && (everything || l.status === 'unchecked'))
    if (!targets.length) { toast.info(everything ? 'No links to check' : 'Every link has been checked already'); return }
    setProgress({ done: 0, total: targets.length })
    try {
      for (let i = 0; i < targets.length; i += 24) {
        const ids = targets.slice(i, i + 24).map(t => t.source_id)
        await enhApi.checkLinks({ source_ids: ids, force: false, limit: 24 })
        setProgress({ done: Math.min(i + 24, targets.length), total: targets.length })
      }
      toast.success(`Checked ${targets.length} link${targets.length === 1 ? '' : 's'}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Link check stopped early')
    } finally { setProgress(null); load() }
  }

  const mark = async (l: LinkRow, status: string) => {
    try { await enhApi.markLink(l.source_id, status); toast.success('Link marked'); load() }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't mark this link") }
  }

  const copyForClient = async () => {
    const bad = links.filter(l => ['login', 'blocked', 'dead'].includes(l.status) && l.url)
    if (!bad.length) { toast.info('No problem links to share'); return }
    const sec = (st: LinkStatus, head: string) => {
      const rows = bad.filter(l => l.status === st)
      return rows.length ? `${head} (${rows.length})\n` + rows.map(l => `- ${l.source_name}: ${l.url}`).join('\n') + '\n' : ''
    }
    const text = 'Hi, these links could not be opened for extraction. Could you send an alternative link or a way to access them?\n\n'
      + sec('login', 'They ask for a login or a subscription') + '\n' + sec('blocked', 'They refuse access') + '\n' + sec('dead', 'The page no longer exists')
    try { await navigator.clipboard.writeText(text.trim() + '\n'); toast.success('Copied. Paste it into your message to the client') }
    catch { toast.error("Couldn't copy. Select the list and copy it by hand") }
  }

  const problems = (counts.login ?? 0) + (counts.blocked ?? 0) + (counts.dead ?? 0)

  return (
    <div className={PAGE}>
      <PageHeader title="Data health"
        subtitle="Find links that can't be opened and records that appear twice, before they reach the client."
        actions={<>
          {projects.length > 1 && (
            <SelectBox label="Project" value={project} onChange={setProject}>
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          )}
        </>} />

      <Tabs value={tab} onChange={setTab} items={[
        { key: 'links', label: 'Links', count: problems, tone: problems ? 'red' : 'gray' },
        ...(isLead ? [{ key: 'dups' as const, label: 'Duplicates', count: dups.length, tone: (dups.length ? 'amber' : 'gray') as Tone }] : []),
      ]} />

      {loading ? <Skeletons rows={5} /> : tab === 'links' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" role="group" aria-label="Filter by link status">
            {(['login', 'blocked', 'dead', 'error', 'unchecked', 'ok'] as LinkStatus[]).map(s => (
              <Tile key={s} label={LINK_META[s].label} value={counts[s] ?? 0} hint={LINK_META[s].hint} tone={LINK_META[s].tone}
                active={filter === s} disabled={!(counts[s] ?? 0) && filter !== s} onClick={() => setFilter(filter === s ? 'all' : s)} />
            ))}
          </div>

          <Panel flush
            title={filter === 'all' ? 'All links' : LINK_META[filter].label}
            subtitle={`${shown.length} source${shown.length === 1 ? '' : 's'}${counts.none ? `, ${counts.none} without a link` : ''}`}
            actions={isLead ? (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button variant="secondary" size="sm" onClick={copyForClient} disabled={!problems}><ClipboardCopy className="w-4 h-4" /> Copy list for client</Button>
                <Button variant="secondary" size="sm" onClick={() => runCheck(true)} disabled={!!progress}><RefreshCw className={cn('w-4 h-4', progress && 'animate-spin')} /> Re-check all</Button>
                <Button size="sm" onClick={() => runCheck(false)} disabled={!!progress || !(counts.unchecked ?? 0)}><ShieldCheck className="w-4 h-4" /> Check new links</Button>
              </div>
            ) : undefined}>
            {progress && (
              <div className="px-5 py-3 border-b border-gray-50 bg-brand-50/40">
                <div className="flex items-center justify-between text-xs font-semibold text-brand-700 mb-1.5">
                  <span>Checking links, this takes a moment</span><span className="tabular-nums">{progress.done} of {progress.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-brand-100 overflow-hidden"><div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              </div>
            )}
            {shown.length === 0 ? (
              <Blank icon={<Link2 className="w-5 h-5" />} title={filter === 'all' ? 'No links to show yet' : 'Nothing in this group'}
                text={filter === 'all' ? 'Sources with a website will appear here. Use Check new links to test them.' : 'Pick another status above, or clear the filter.'} />
            ) : (
              <ul className="divide-y divide-gray-50 m-0 p-0 list-none">
                {shown.map(l => (
                  <li key={l.source_id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition">
                    <span className={cn('w-1 self-stretch rounded-full shrink-0', l.status === 'ok' ? 'bg-emerald-400' : l.status === 'unchecked' ? 'bg-gray-200' : l.status === 'login' ? 'bg-amber-400' : l.status === 'error' ? 'bg-purple-400' : 'bg-red-400')} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/projects/${l.project_id}/sources/${l.source_id}`} className="text-sm font-semibold text-gray-900 hover:text-brand-600 truncate block">{l.source_name}</Link>
                      <p className="text-xs text-gray-400 m-0 mt-0.5 flex items-center gap-x-3 flex-wrap">
                        {l.url && <a href={l.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1 truncate max-w-[260px]"><ExternalLink className="w-3 h-3 shrink-0" />{hostOf(l.url)}</a>}
                        {l.detail && <span className="truncate">{l.detail}</span>}
                        {l.extractor && <span>{l.extractor}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {l.manual && <Chip tone="indigo" title="Marked by a person">Marked</Chip>}
                      <LinkChip status={l.status} detail={l.detail} />
                      <span className="hidden md:block w-10 text-right text-xs text-gray-400">{l.checked_at ? shortAgo(l.checked_at) : ''}</span>
                      {l.url && (
                        <select aria-label={`Mark the link for ${l.source_name}`} value="" onChange={e => e.target.value && mark(l, e.target.value)}
                          className="text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg px-2 py-1.5 hover:bg-gray-50 w-[92px]">
                          <option value="">Mark as</option>
                          <option value="ok">Opens fine</option>
                          <option value="login">Needs login</option>
                          <option value="blocked">Blocked</option>
                          <option value="dead">Not found</option>
                        </select>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="text-xs text-gray-400 m-0 flex items-start gap-1.5"><ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            The check works like a quick visit from our server. Some sites refuse it even though they open in a browser, so open a flagged link yourself and use <b>Mark as</b> when the check is wrong. Marks are kept until you re-check everything.</p>
        </>
      ) : (
        <Panel flush title="Names that appear more than once" subtitle="Across sources, or twice inside one source. Check whether they are real duplicates before sending.">
          {dups.length === 0 ? <Blank icon={<CheckCircle2 className="w-5 h-5" />} title="No duplicates found" text="No record name appears twice in the sources you can see." /> : (
            <ul className="divide-y divide-gray-50 m-0 p-0 list-none">
              {dups.map(g => (
                <li key={g.project_id + g.name} className="px-5 py-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Copy className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold text-gray-900 capitalize">{g.name}</span>
                    <Chip tone={g.kind === 'across sources' ? 'amber' : 'purple'}>{g.kind}</Chip>
                    <span className="text-xs text-gray-400 tabular-nums">{g.count} records in {g.source_count} source{g.source_count === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {Array.from(new Map<string, any>(g.items.map((i: any) => [i.source_id, i])).values()).map((i: any) => (
                      <Link key={i.source_id} to={`/projects/${g.project_id}/sources/${i.source_id}`}
                        className="text-xs font-medium text-gray-600 bg-gray-50 hover:bg-brand-50 hover:text-brand-700 px-2.5 py-1 rounded-lg transition">{i.source_name}</Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  )
}
