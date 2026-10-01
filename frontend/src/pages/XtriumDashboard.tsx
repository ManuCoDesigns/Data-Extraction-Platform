import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, Database, Clock, CheckCircle, Send, RefreshCw, ArrowUpRight,
  Globe, Archive, AlertTriangle, Inbox,
} from 'lucide-react'
import { xtriumApi } from '@/api/client'
import { cn } from '@/components/ui'

const STATUS_META: Record<string, { label: string; color: string; grad: string }> = {
  not_started:        { label: 'Not Started',       color: '#64748b', grad: 'from-gray-400 to-gray-500' },
  extracting:          { label: 'Extracting',        color: '#2563eb', grad: 'from-blue-500 to-blue-600' },
  needs_fixes:         { label: 'Needs Fixes',        color: '#d97706', grad: 'from-amber-500 to-orange-600' },
  ready_for_review:    { label: 'Ready for Review',   color: '#4f46e5', grad: 'from-brand-500 to-brand-700' },
  in_review:           { label: 'In Review',          color: '#7c3aed', grad: 'from-purple-500 to-purple-600' },
  changes_requested:   { label: 'Changes Requested',  color: '#dc2626', grad: 'from-red-500 to-rose-600' },
  llm_verification:    { label: 'LLM Verification',   color: '#7c3aed', grad: 'from-purple-500 to-purple-600' },
  approved:            { label: 'Approved',           color: '#059669', grad: 'from-emerald-500 to-emerald-600' },
}

function StatCard({ label, value, icon: Icon, grad }: any) {
  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden p-4">
      <div className={cn('absolute top-0 left-0 right-0 h-1 bg-gradient-to-r', grad)} />
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br shadow-sm', grad)}>
          <Icon className="w-[18px] h-[18px] text-white" />
        </div>
        <div>
          <p className="text-2xl font-extrabold text-gray-900 leading-none">{value}</p>
          <p className="text-xs text-gray-400 mt-1">{label}</p>
        </div>
      </div>
    </div>
  )
}

const ACTIVITY_ICON: Record<string, any> = {
  'Pulled from Xtrium':         { icon: Inbox, grad: 'from-blue-500 to-blue-600' },
  'Submitted to Xtrium':        { icon: Send, grad: 'from-emerald-500 to-emerald-600' },
  'Archived by Xtrium':         { icon: Archive, grad: 'from-gray-400 to-gray-500' },
  'Rejected by Xtrium':         { icon: AlertTriangle, grad: 'from-red-500 to-rose-600' },
  'Escalated — no data found':  { icon: AlertTriangle, grad: 'from-amber-500 to-orange-600' },
}

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function XtriumDashboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    else setRefreshing(true)
    xtriumApi.dashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => {
    load()
    const interval = setInterval(() => load({ silent: true }), 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
  }

  if (!data) {
    return (
      <div className="px-7 py-6 max-w-[1200px] mx-auto">
        <p className="text-sm text-gray-400">Couldn't load the Xtrium dashboard. Try refreshing.</p>
      </div>
    )
  }

  const byStatus = data.by_status ?? {}
  const sources = data.sources ?? []
  const activity = data.activity ?? []
  const live = data.live_availability

  const inProgress = ['extracting', 'needs_fixes', 'ready_for_review', 'in_review', 'changes_requested', 'llm_verification']
    .reduce((a, k) => a + (byStatus[k] ?? 0), 0)

  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25 shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900 m-0">Xtrium Integration</h1>
            <p className="text-xs text-gray-400 mt-0.5">Live progress across the Xtrium Catalog IQ pipeline</p>
          </div>
        </div>
        <button onClick={() => load({ silent: true })} disabled={refreshing}
          className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Live availability banner */}
      {live && (
        <div className="relative bg-white border border-gray-100 rounded-2xl pl-5 pr-5 py-3.5 mb-5 flex items-center gap-4 shadow-card overflow-hidden">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-gradient-to-b from-brand-500 to-brand-700" />
          <Globe className="w-4 h-4 text-brand-600 shrink-0" />
          <p className="text-sm text-gray-600">
            <span className="font-bold text-brand-700">{live.queued ?? live.assigned ?? 0}</span> available to pull right now
            {' · '}
            <span className="font-bold text-gray-700">{live.in_progress ?? 0}</span> currently in progress on Xtrium's side
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Linked" value={data.total_linked ?? 0} icon={Database} grad="from-blue-500 to-blue-600" />
        <StatCard label="In Progress" value={inProgress} icon={Clock} grad="from-amber-500 to-orange-600" />
        <StatCard label="Approved" value={byStatus['approved'] ?? 0} icon={CheckCircle} grad="from-emerald-500 to-emerald-600" />
        <StatCard label="Submitted" value={data.submitted_count ?? 0} icon={Send} grad="from-purple-500 to-purple-600" />
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* Sources table */}
        <div className="col-span-3 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="text-sm font-bold text-gray-900 m-0">Xtrium-Linked Sources</h2>
          </div>
          <div className="overflow-x-auto scrollbar-thin" style={{ maxHeight: 520 }}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 sticky top-0">
                  {['Source', 'Status', 'Submitted', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">No Xtrium-linked sources yet</td></tr>
                ) : sources.map((s: any) => {
                  const meta = STATUS_META[s.status] ?? { label: s.status, color: '#64748b', grad: 'from-gray-400 to-gray-500' }
                  return (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-gray-900 truncate max-w-[220px]">{s.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[220px]">{s.project_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ background: `${meta.color}15`, color: meta.color }}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {s.xtrium_submitted_at ? timeAgo(s.xtrium_submitted_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/projects/${s.project_id}/sources/${s.id}`}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                          Open <ArrowUpRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity feed */}
        <div className="col-span-2 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="text-sm font-bold text-gray-900 m-0">Recent Activity</h2>
          </div>
          <div className="overflow-y-auto scrollbar-thin px-5 py-4" style={{ maxHeight: 520 }}>
            {activity.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No recent Xtrium activity</p>
            ) : (
              <div className="space-y-4">
                {activity.map((a: any) => {
                  const meta = ACTIVITY_ICON[a.label] ?? { icon: Zap, grad: 'from-gray-400 to-gray-500' }
                  const Icon = meta.icon
                  return (
                    <div key={a.id} className="flex items-start gap-3">
                      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br', meta.grad)}>
                        <Icon className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">{a.label}</p>
                        <p className="text-xs text-gray-400 truncate">{a.source_name ?? 'Unknown source'}</p>
                        <p className="text-[11px] text-gray-300 mt-0.5">
                          {a.user_name ? `${a.user_name} · ` : ''}{timeAgo(a.created_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
