import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Send, TrendingUp, Plus, ArrowRight, Database,
  Activity, CheckCircle, AlertCircle, Users, BarChart3,
  FileText, Upload, Eye, RefreshCw, Zap
} from 'lucide-react'
import { statsApi, sourcesApi } from '@/api/client'
import { StatCard, Card, Badge, Spinner, Skeleton, cn, safeFromNow, safeFormat } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useCapability } from '@/lib/permissions'
import { format } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:       { label: 'Not Started',       color: '#94a3b8', bg: '#f1f5f9' },
  extracting:        { label: 'Extracting',        color: '#3b82f6', bg: '#eff6ff' },
  needs_fixes:       { label: 'Needs Fixes',        color: '#f59e0b', bg: '#fffbeb' },
  ready_for_review:  { label: 'Ready for Review',   color: '#6366f1', bg: '#eef2ff' },
  in_review:         { label: 'In Review',          color: '#a855f7', bg: '#faf5ff' },
  changes_requested: { label: 'Changes Requested',  color: '#ef4444', bg: '#fef2f2' },
  approved:          { label: 'Approved',           color: '#10b981', bg: '#ecfdf5' },
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [perf, setPerf] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = () =>
    Promise.all([
      statsApi.sourcesSummary().then(setSummary),
      sourcesApi.performanceStats().then(setPerf),
    ]).finally(() => setLoading(false))

  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv) }, [])

  if (loading) return <DashSkeleton />

  const byStatus = summary?.by_status ?? {}
  const total = summary?.total ?? 0
  const approvedCount = byStatus['approved'] ?? 0
  const inProgressCount = (byStatus['extracting'] ?? 0) + (byStatus['needs_fixes'] ?? 0) + (byStatus['ready_for_review'] ?? 0) + (byStatus['in_review'] ?? 0) + (byStatus['changes_requested'] ?? 0)
  const notStarted = byStatus['not_started'] ?? 0

  const statusChartData = Object.entries(byStatus)
    .filter(([, count]) => (count as number) > 0)
    .map(([status, count]) => ({
      name: STATUS_META[status]?.label ?? status,
      value: count as number,
      fill: STATUS_META[status]?.color ?? '#94a3b8',
    }))

  const extractors = perf?.extractors ?? []
  const reviewers = perf?.reviewers ?? []

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greeting()}, {user?.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">Here's your extraction operation at a glance.</p>
        </div>
        <Link to="/sources">
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition shadow-sm">
            <Database className="w-4 h-4" /> All Sources
          </button>
        </Link>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sources" value={total} sub="across all projects" icon={<Database className="w-4 h-4" />} color="brand" />
        <StatCard label="In Progress" value={inProgressCount} sub="extracting or in review" icon={<Activity className="w-4 h-4" />} color="amber" />
        <StatCard label="Approved" value={approvedCount} sub={`${total > 0 ? Math.round(approvedCount/total*100) : 0}% complete`} icon={<CheckCircle className="w-4 h-4" />} color="green" />
        <StatCard label="This Week" value={summary?.approved_this_week ?? 0} sub="newly approved" icon={<TrendingUp className="w-4 h-4" />} color="purple" />
      </div>

      {/* Split view: Sources chart + Team performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sources by status */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Sources by Status</h2>
              <p className="text-xs text-gray-400 mt-0.5">{total} total across all projects</p>
            </div>
            <Link to="/sources" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {statusChartData.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No sources yet</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={statusChartData} barSize={28} margin={{ top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Sources">
                    {statusChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {statusChartData.map(d => (
                  <div key={d.name} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: STATUS_META[Object.keys(STATUS_META).find(k => STATUS_META[k].label === d.name) ?? '']?.bg ?? '#f8fafc' }}>
                    <span className="text-gray-600 truncate">{d.name}</span>
                    <span className="font-bold ml-2" style={{ color: d.fill }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Team performance */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Team Performance</h2>
              <p className="text-xs text-gray-400 mt-0.5">Sources assigned vs completed</p>
            </div>
          </div>
          {extractors.length === 0 && reviewers.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">Assign sources to team members to see performance</div>
          ) : (
            <div className="space-y-5">
              {extractors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Extractors</p>
                  <div className="space-y-2.5">
                    {extractors.map((e: any) => (
                      <PerfRow key={e.user_id} name={e.name} assigned={e.sources_count} completed={e.approved_count} avgHours={e.avg_hours_per_source} role="extractor" />
                    ))}
                  </div>
                </div>
              )}
              {reviewers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Reviewers</p>
                  <div className="space-y-2.5">
                    {reviewers.map((r: any) => (
                      <PerfRow key={r.user_id} name={r.name} assigned={r.sources_count} completed={r.approved_count} avgHours={r.avg_hours_per_source} role="reviewer" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Recent activity */}
      {(summary?.recent ?? []).length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
            <Link to="/sources" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {(summary.recent as any[]).map((s: any) => (
              <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
                className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/60 transition group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: STATUS_META[s.status]?.bg ?? '#f8fafc' }}>
                    <Database className="w-4 h-4" style={{ color: STATUS_META[s.status]?.color ?? '#94a3b8' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400">{safeFromNow(s.updated_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-xs text-gray-500 hidden sm:block">
                    {s.valid_records}/{s.total_records} valid
                  </span>
                  <StatusPill status={s.status} />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Extractor Dashboard ──────────────────────────────────────────────────────
function ExtractorDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    statsApi.sourcesSummary().then(setSummary).finally(() => setLoading(false))
  }, [])

  if (loading) return <DashSkeleton />

  const myExtracting: any[] = summary?.my_extracting ?? []
  const needsAction = myExtracting.filter((s: any) => ['needs_fixes', 'changes_requested'].includes(s.status))
  const inProgress = myExtracting.filter((s: any) => s.status === 'extracting')

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greeting()}, {user?.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">Your extraction tasks for today.</p>
        </div>
        <Link to="/sources">
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition shadow-sm">
            <Database className="w-4 h-4" /> My Sources
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Assigned to Me" value={myExtracting.length} sub="total sources" icon={<Upload className="w-4 h-4" />} color="brand" />
        <StatCard label="Needs Action" value={needsAction.length} sub="errors to fix" icon={<AlertCircle className="w-4 h-4" />} color="red" />
        <StatCard label="In Progress" value={inProgress.length} sub="actively extracting" icon={<RefreshCw className="w-4 h-4" />} color="amber" />
      </div>

      {needsAction.length > 0 && (
        <Card className="border-red-200">
          <div className="px-6 py-4 border-b border-red-100 flex items-center gap-2 bg-red-50/50 rounded-t-2xl">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-semibold text-red-700">Needs Your Attention ({needsAction.length})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {needsAction.map((s: any) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">All My Sources</h2>
          <Link to="/sources" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
            Full board <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {myExtracting.length === 0 ? (
          <div className="p-12 text-center">
            <Database className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700">No sources assigned yet</p>
            <p className="text-xs text-gray-400 mt-1">An admin will assign you to a source when there's data to extract.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {myExtracting.map((s: any) => <SourceRow key={s.id} source={s} />)}
          </div>
        )}
      </Card>

      {/* Quick guide for new extractors */}
      {myExtracting.length === 0 && (
        <Card className="p-6 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-brand-600" /> How extraction works
          </h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li><span className="font-medium text-gray-800">1. Get assigned</span> — an admin adds you to a source with a schema and source website</li>
            <li><span className="font-medium text-gray-800">2. Extract</span> — pull data from the website however you like (script, manual, tool)</li>
            <li><span className="font-medium text-gray-800">3. Upload</span> — drop your CSV, Excel, JSON, or PDF directly into the source</li>
            <li><span className="font-medium text-gray-800">4. Fix errors</span> — the tool validates each row; fix any that don't match the schema</li>
            <li><span className="font-medium text-gray-800">5. Hand off</span> — once all rows pass validation, it moves to a reviewer automatically</li>
          </ol>
        </Card>
      )}
    </div>
  )
}

// ─── Reviewer Dashboard ───────────────────────────────────────────────────────
function ReviewerDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    statsApi.sourcesSummary().then(setSummary).finally(() => setLoading(false))
  }, [])

  if (loading) return <DashSkeleton />

  const myReviewing: any[] = summary?.my_reviewing ?? []
  const readyCount = myReviewing.filter((s: any) => s.status === 'ready_for_review').length
  const inReviewCount = myReviewing.filter((s: any) => s.status === 'in_review').length

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greeting()}, {user?.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">Sources waiting for your review.</p>
        </div>
        <Link to="/sources">
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition shadow-sm">
            <Eye className="w-4 h-4" /> Review Queue
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Ready to Review" value={readyCount} sub="waiting for you" icon={<Eye className="w-4 h-4" />} color="brand" />
        <StatCard label="In Review" value={inReviewCount} sub="you've started" icon={<Activity className="w-4 h-4" />} color="purple" />
        <StatCard label="Total Assigned" value={myReviewing.length} sub="all review sources" icon={<Database className="w-4 h-4" />} color="brand" />
      </div>

      {readyCount > 0 && (
        <Card className="border-indigo-200">
          <div className="px-6 py-4 border-b border-indigo-100 bg-indigo-50/40 rounded-t-2xl flex items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-indigo-700">Ready for Your Review ({readyCount})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {myReviewing.filter((s: any) => s.status === 'ready_for_review').map((s: any) => <SourceRow key={s.id} source={s} />)}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">All Review Sources</h2>
          <Link to="/sources" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
            Full board <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {myReviewing.length === 0 ? (
          <div className="p-12 text-center">
            <Eye className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700">No sources assigned for review yet</p>
            <p className="text-xs text-gray-400 mt-1">You'll be notified when a source is ready for your review.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {myReviewing.map((s: any) => <SourceRow key={s.id} source={s} />)}
          </div>
        )}
      </Card>

      {myReviewing.length === 0 && (
        <Card className="p-6 bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-600" /> Your review process
          </h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li><span className="font-medium text-gray-800">1. Source arrives</span> — extractor finishes uploading and fixing validation errors</li>
            <li><span className="font-medium text-gray-800">2. Open each record</span> — check extracted values against the source website</li>
            <li><span className="font-medium text-gray-800">3. Approve or send back</span> — fix it yourself or return it to the extractor with a note</li>
            <li><span className="font-medium text-gray-800">4. Approve all</span> — once every record is verified, mark the whole source as approved</li>
          </ol>
        </Card>
      )}
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status]
  if (!meta) return null
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  )
}

function SourceRow({ source }: { source: any }) {
  return (
    <Link to={`/projects/${source.project_id}/sources/${source.id}`}
      className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/60 transition group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: STATUS_META[source.status]?.bg ?? '#f8fafc' }}>
          <Database className="w-4 h-4" style={{ color: STATUS_META[source.status]?.color ?? '#94a3b8' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-700 truncate">{source.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {source.valid_records}/{source.total_records} valid
            {source.invalid_records > 0 && <span className="text-amber-500 ml-1">· {source.invalid_records} need fixes</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <StatusPill status={source.status} />
        <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-500" />
      </div>
    </Link>
  )
}

function PerfRow({ name, assigned, completed, avgHours, role }: {
  name: string; assigned: number; completed: number; avgHours: number | null; role: string
}) {
  const pct = assigned > 0 ? Math.round(completed / assigned * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0',
        role === 'extractor' ? 'bg-emerald-500' : 'bg-purple-500'
      )}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-800 truncate">{name}</span>
          <span className="text-xs text-gray-400 shrink-0 ml-2">{completed}/{assigned}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className={cn('h-1.5 rounded-full transition-all duration-700', role === 'extractor' ? 'bg-emerald-500' : 'bg-purple-500')}
            style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="text-xs text-gray-400 shrink-0 w-12 text-right">
        {avgHours != null ? `${avgHours}h avg` : '—'}
      </span>
    </div>
  )
}

function DashSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}</div>
      <div className="grid grid-cols-2 gap-6"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      <Skeleton className="h-48" />
    </div>
  )
}

// ─── Smart router: picks the right dashboard based on role ────────────────────
export function DashboardPage() {
  const { user } = useAuthStore()
  if (!user) return null

  const roles = new Set(user.roles)
  if (roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead')) return <AdminDashboard />
  if (roles.has('reviewer')) return <ReviewerDashboard />
  return <ExtractorDashboard />
}
