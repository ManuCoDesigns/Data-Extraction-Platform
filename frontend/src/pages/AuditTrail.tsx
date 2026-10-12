import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, History, RefreshCw } from 'lucide-react'
import { enhApi, projectsApi } from '@/api/client'
import { Avatar, Button, cn, toast } from '@/components/ui'
import { Blank, Chip, PageHeader, Panel, SelectBox, Skeletons, type Tone, PAGE, shortAgo } from '@/components/enh/kit'
import { format } from 'date-fns'

interface Entry { id: string; at: string; user: string; user_id?: string; action: string; label: string; source_id?: string; source_name?: string; project_id?: string; before: string; after: string }

const toneFor = (a: string): Tone =>
  /approved/.test(a) ? 'green' : /rejected|returned|reset|deactivated|deleted|removed/.test(a) ? 'red'
    : /uploaded|created|added|submitted/.test(a) ? 'blue' : /assigned|role|status|overridden|fixed/.test(a) ? 'amber' : 'gray'

const dayKey = (iso: string) => { try { return format(new Date(iso), 'EEEE d MMMM yyyy') } catch { return '' } }
const timeOf = (iso: string) => { try { return format(new Date(iso), 'HH:mm') } catch { return '' } }

export function AuditTrailPage() {
  const [sp, setSp] = useSearchParams()
  const sourceId = sp.get('source') ?? ''
  const [projects, setProjects] = useState<any[]>([])
  const [project, setProject] = useState(sp.get('project') ?? '')
  const [action, setAction] = useState('')
  const [days, setDays] = useState('30')
  const [actions, setActions] = useState<{ value: string; label: string }[]>([])
  const [items, setItems] = useState<Entry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)

  const params = useCallback((before?: string) => ({
    project_id: project || undefined, source_id: sourceId || undefined, action: action || undefined, days: Number(days), before, limit: 60,
  }), [project, sourceId, action, days])

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await enhApi.audit(params()); setItems(r.items); setNext(r.next_before); setActions(r.actions) }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't load the audit trail") } finally { setLoading(false) }
  }, [params])
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(r.items ?? [])).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (!next) return
    setMore(true)
    try { const r = await enhApi.audit(params(next)); setItems(i => [...i, ...r.items]); setNext(r.next_before) }
    catch { toast.error("Couldn't load more") } finally { setMore(false) }
  }

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['When', 'Who', 'What', 'Source', 'Details'], ...items.map(i => [i.at, i.user, i.label, i.source_name ?? '', [i.before && `Before: ${i.before}`, i.after && `After: ${i.after}`].filter(Boolean).join(' | ')])]
    const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const groups: { day: string; rows: Entry[] }[] = []
  items.forEach(i => { const d = dayKey(i.at); const g = groups[groups.length - 1]; if (g && g.day === d) g.rows.push(i); else groups.push({ day: d, rows: [i] }) })

  return (
    <div className={PAGE}>
      <PageHeader title="Audit trail" subtitle="Who changed what and when. Use it to answer 'who approved this' or 'why did this go back'."
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!items.length}><Download className="w-4 h-4" /> Download CSV</Button>
        </>} />

      <div className="flex items-center gap-2 flex-wrap">
        {projects.length > 1 && (
          <SelectBox label="Project" value={project} onChange={setProject}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectBox>
        )}
        <SelectBox label="Type of change" value={action} onChange={setAction}>
          <option value="">Every change</option>
          {actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </SelectBox>
        <SelectBox label="Period" value={days} onChange={setDays}>
          <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
        </SelectBox>
        {sourceId && (
          <button type="button" onClick={() => { sp.delete('source'); setSp(sp) }}
            className="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-xl transition">One source only. Show all</button>
        )}
      </div>

      {loading ? <Skeletons rows={6} /> : items.length === 0 ? (
        <Panel><Blank icon={<History className="w-5 h-5" />} title="No changes in this period" text="Try a longer period or clear the filters." /></Panel>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <Panel key={g.day} flush title={g.day} subtitle={`${g.rows.length} change${g.rows.length === 1 ? '' : 's'}`}>
              <ul className="m-0 p-0 list-none divide-y divide-gray-50">
                {g.rows.map(i => (
                  <li key={i.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="text-xs tabular-nums text-gray-400 w-10 pt-1 shrink-0">{timeOf(i.at)}</span>
                    <Avatar name={i.user} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 m-0 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{i.user}</span>
                        <Chip tone={toneFor(i.action)}>{i.label}</Chip>
                        {i.source_id && i.source_name && (
                          <Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-brand-600 hover:underline truncate max-w-[280px]">{i.source_name}</Link>
                        )}
                      </p>
                      {(i.before || i.after) && (
                        <p className={cn('text-xs text-gray-500 m-0 mt-1 break-words')}>
                          {i.before && <span><span className="text-gray-400">Before:</span> {i.before}. </span>}
                          {i.after && <span><span className="text-gray-400">{i.before ? 'After:' : 'Details:'}</span> {i.after}</span>}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
          {next && <div className="flex justify-center"><Button variant="secondary" onClick={loadMore} loading={more}>Load older changes</Button></div>}
        </div>
      )}
    </div>
  )
}
