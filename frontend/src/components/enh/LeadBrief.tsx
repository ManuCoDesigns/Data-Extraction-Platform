import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { briefsApi } from '@/api/briefs'
import { Blank, Chip, Skeletons, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

const LEVEL: Record<string, Tone> = { red: 'red', amber: 'amber', info: 'blue', ok: 'gray' }

/** Everything that needs the team lead's attention, read live. Open it first thing, copy it into Slack, and act from the links. */
export function LeadBrief({ projectId }: { projectId: string }) {
  const [b, setB] = useState<any>(null)
  const load = useCallback(() => {
    setB(null)
    briefsApi.lead(projectId || undefined).then(setB).catch(() => setB({ error: true }))
  }, [projectId])
  useEffect(load, [load])

  if (!b) return <Skeletons rows={4} />
  if (b.error) return <Blank title="Couldn't build the brief" text="Try again in a moment." />
  const copy = async () => { try { await navigator.clipboard.writeText(b.text); toast.success('Brief copied') } catch { toast.error('Could not copy') } }
  const busy = b.sections.filter((s: any) => s.count > 0)
  const max = Math.max(1, ...b.people.map((p: any) => p.open))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h3 className="m-0 text-lg font-semibold text-gray-900">{b.totals.attention ? `${b.totals.attention} ${b.totals.attention === 1 ? 'thing needs' : 'things need'} you today` : 'Nothing needs you right now'}</h3>
          <ul className="mt-2 mb-0 pl-5 text-sm text-gray-700 space-y-1">{b.headline.map((h: string) => <li key={h}>{h}</li>)}</ul>
        </div>
        <div className="flex gap-2"><Button variant="secondary" onClick={load}>Refresh</Button><Button onClick={copy}>Copy for Slack</Button></div>
      </div>
      <div className="flex gap-2 flex-wrap text-sm">
        <Chip tone="blue">{b.totals.open} open</Chip><Chip tone="green">{b.totals.delivered} delivered</Chip>{b.totals.on_hold > 0 && <Chip tone="gray">{b.totals.on_hold} on hold</Chip>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {busy.map((s: any) => (
          <div key={s.key} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2"><h4 className="m-0 text-sm font-semibold text-gray-900">{s.title}</h4><Chip tone={LEVEL[s.level] ?? 'gray'}>{s.count}</Chip></div>
            <p className="text-xs text-gray-500 mt-1 mb-2">{s.hint}</p>
            <ul className="m-0 p-0 list-none divide-y divide-gray-100">
              {s.items.slice(0, 6).map((i: any, k: number) => (
                <li key={k} className="py-1.5 text-sm flex items-baseline gap-2">
                  {i.source_id ? <Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-brand-600 hover:underline truncate">{i.name}</Link> : <span className="truncate">{i.name}</span>}
                  <span className="text-gray-500 truncate">{i.text}</span>
                  {i.days !== null && i.days !== undefined && <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{i.days} d</span>}
                </li>
              ))}
            </ul>
            {s.count > 6 && <p className="text-xs text-gray-400 mt-1 mb-0">and {s.count - 6} more</p>}
          </div>
        ))}
        {!busy.length && <Blank title="All clear" text="No overdue work, nothing unassigned and nothing waiting on you." />}
      </div>
      {b.people.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h4 className="m-0 text-sm font-semibold text-gray-900">Open work per person</h4>
          <p className="text-xs text-gray-500 mt-1 mb-2">Sources on hold are not counted.</p>
          <div className="space-y-1.5">
            {b.people.map((p: any) => (
              <div key={p.user_id} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate text-gray-800">{p.name}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${(100 * p.open) / max}%`, background: b.heavy.some((h: any) => h.user_id === p.user_id) ? '#f59e0b' : '#3b82f6' }} /></div>
                <span className="w-8 text-right tabular-nums text-gray-600">{p.open}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
