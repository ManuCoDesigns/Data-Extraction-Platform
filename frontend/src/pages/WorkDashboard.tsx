import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, RefreshCw } from 'lucide-react'
import { sourcesApi, projectsApi } from '@/api/client'
import { Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { MyQueue, buildQueue } from '@/components/MyQueue'
import type { Source } from '@/types'

// Home page for people who extract and review (not admins): just their own
// assigned work, ordered by what to do first.
export function WorkDashboard() {
  const { user } = useAuthStore()
  const [sources, setSources] = useState<Source[] | null>(null)
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    sourcesApi.list()
      .then((r: any) => { if (!cancelled) setSources(Array.isArray(r) ? r : []) })
      .catch(() => { if (!cancelled) setError("Couldn't load your work.") })
    projectsApi.list()
      .then((r: any) => {
        if (!cancelled) setProjectNames(Object.fromEntries((r?.items ?? []).map((p: any) => [p.id, p.name])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [attempt])

  const q = useMemo(() => buildQueue(sources ?? [], user?.id), [sources, user?.id])

  if (error) {
    return (
      <div className="px-7 py-6 max-w-[1100px] mx-auto">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error} <button onClick={() => setAttempt(a => a + 1)} className="font-semibold underline">Retry</button>
        </div>
      </div>
    )
  }
  if (sources === null) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  const Tile = ({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: string }) => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-3.5">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider m-0">{label}</p>
      <p className={`text-2xl font-extrabold m-0 mt-1 ${tone}`}>{value}</p>
      <p className="text-xs text-gray-400 m-0">{sub}</p>
    </div>
  )

  return (
    <div className="px-7 py-6 max-w-[1100px] mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 m-0">My work</h1>
          <p className="text-sm text-gray-500 mt-1 mb-0">Only what's assigned to you, in the order to do it.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAttempt(a => a + 1)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link to="/sources"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
            <Database className="w-3.5 h-3.5" /> All my sources
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Needs your action" value={q.action.length} sub="start here" tone={q.action.length ? 'text-red-600' : 'text-gray-900'} />
        <Tile label="Waiting on others" value={q.waiting.length} sub="with a reviewer or admin" tone="text-amber-600" />
        <Tile label="Done" value={q.done.length} sub="approved" tone="text-emerald-600" />
      </div>

      <MyQueue sources={sources} userId={user?.id} projectNames={projectNames} />
    </div>
  )
}
