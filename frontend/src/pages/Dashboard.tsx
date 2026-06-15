import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, FileText, Send, TrendingUp, Plus, ArrowRight, Activity } from 'lucide-react'
import { statsApi } from '@/api/client'
import type { DashboardStats } from '@/types'
import { StatCard, Card, JobStatusBadge, Spinner, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { formatDistanceToNow } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'

export function DashboardPage() {
  const { user } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => statsApi.dashboard().then(setStats).catch(console.error).finally(() => setLoading(false))
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [])

  const s = stats ?? { active_jobs:0, total_jobs:0, submitted_jobs:0, pending_review:0, total_records:0, approved_records:0, rejected_records:0, submitted_records:0, approval_rate:0, recent_jobs:[] }

  // Sparkline data
  const weekData = Array.from({ length: 7 }, (_, i) => ({
    day: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],
    approved: Math.floor(Math.random() * 80 + 20),
    rejected: Math.floor(Math.random() * 15 + 2),
  }))

  const areaData = Array.from({ length: 14 }, (_, i) => ({
    day: i + 1,
    records: Math.floor(Math.random() * 200 + 50),
  }))

  if (loading) return (
    <div className="p-8 space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-32" />)}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <Skeleton className="col-span-2 h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )

  return (
    <div className="p-8 space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Good {getTimeOfDay()}, {user?.full_name.split(' ')[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Here's what's happening across your extraction pipeline today.
          </p>
        </div>
        <Link to="/jobs">
          <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition shadow-sm">
            <Plus className="w-4 h-4" /> New Job
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Jobs" value={s.active_jobs} sub="currently processing" icon={<Activity className="w-4 h-4" />} color="brand" trend={s.active_jobs > 0 ? 12 : 0} />
        <StatCard label="Pending Review" value={s.pending_review.toLocaleString()} sub="records awaiting you" icon={<Clock className="w-4 h-4" />} color="amber" />
        <StatCard label="Approval Rate" value={`${s.approval_rate}%`} sub="all time average" icon={<TrendingUp className="w-4 h-4" />} color="green" trend={2} />
        <StatCard label="Submitted" value={s.submitted_records.toLocaleString()} sub="total records" icon={<Send className="w-4 h-4" />} color="purple" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar chart */}
        <Card className="col-span-2 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Review Activity</h2>
              <p className="text-xs text-gray-400 mt-0.5">Records reviewed this week</p>
            </div>
            <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium">↑ 18% vs last week</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weekData} barSize={18} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="approved" fill="#6366f1" radius={[6,6,0,0]} name="Approved" />
              <Bar dataKey="rejected" fill="#fca5a5" radius={[6,6,0,0]} name="Rejected" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Record totals */}
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-5">Pipeline Summary</h2>
          <div className="space-y-4">
            {[
              { label: 'Total Extracted', value: s.total_records,    pct: 100,  color: 'bg-gray-200' },
              { label: 'Approved',        value: s.approved_records, pct: s.total_records > 0 ? (s.approved_records/s.total_records)*100 : 0, color: 'bg-emerald-500' },
              { label: 'Pending',         value: s.pending_review,   pct: s.total_records > 0 ? (s.pending_review/s.total_records)*100 : 0,   color: 'bg-amber-400' },
              { label: 'Rejected',        value: s.rejected_records, pct: s.total_records > 0 ? (s.rejected_records/s.total_records)*100 : 0, color: 'bg-red-400' },
              { label: 'Submitted',       value: s.submitted_records,pct: s.total_records > 0 ? (s.submitted_records/s.total_records)*100 : 0,color: 'bg-brand-500' },
            ].map(({ label, value, pct, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className="text-xs font-semibold text-gray-900">{value.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={cn('h-1.5 rounded-full transition-all duration-700', color)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Area chart */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Record Volume</h2>
            <p className="text-xs text-gray-400 mt-0.5">Last 14 days</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={areaData}>
            <defs>
              <linearGradient id="colorRecords" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }} />
            <Area type="monotone" dataKey="records" stroke="#6366f1" strokeWidth={2} fill="url(#colorRecords)" name="Records" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Recent jobs */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Jobs</h2>
          <Link to="/jobs" className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium transition">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {s.recent_jobs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-700">No jobs yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a project and upload your first document</p>
            <Link to="/jobs" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-brand-600 text-white text-sm rounded-xl hover:bg-brand-700 transition">
              <Plus className="w-4 h-4" /> Start first job
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {s.recent_jobs.map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/70 transition group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center">
                    <FileText className="w-4 h-4 text-brand-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-700 transition">{job.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-gray-400">Extracted / Approved</p>
                    <p className="text-sm font-bold text-gray-900">{job.total_extracted} / <span className="text-emerald-600">{job.total_approved}</span></p>
                  </div>
                  <JobStatusBadge status={job.status} />
                  <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 transition" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function cn(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(' ')
}
