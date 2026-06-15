import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, FileText, Send, TrendingUp } from 'lucide-react'
import { statsApi } from '@/api/client'
import type { DashboardStats } from '@/types'
import { StatCard, Card, JobStatusBadge, Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { formatDistanceToNow } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

export function DashboardPage() {
  const { user } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => {
      setError('')
      statsApi.dashboard()
        .then(data => { setStats(data); setLoading(false) })
        .catch(err => {
          console.error('Dashboard error:', err)
          setError('Could not load stats — API may be starting up')
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  // Safe defaults if stats failed to load
  const s = stats ?? {
    active_jobs: 0, total_jobs: 0, submitted_jobs: 0,
    pending_review: 0, total_records: 0, approved_records: 0,
    rejected_records: 0, submitted_records: 0,
    approval_rate: 0, recent_jobs: [],
  }

  const sparkData = Array.from({ length: 7 }, (_, i) => ({
    day: `D${i + 1}`,
    approved: Math.floor(Math.random() * 40 + 5),
    rejected: Math.floor(Math.random() * 8 + 1),
  }))

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.full_name.split(' ')[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Here's what's happening across your extraction jobs.
        </p>
        {error && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-700">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Jobs" value={s.active_jobs} sub="currently running" icon={<Clock className="w-5 h-5" />} color="brand" />
        <StatCard label="Pending Review" value={s.pending_review.toLocaleString()} sub="records awaiting you" icon={<FileText className="w-5 h-5" />} color="amber" />
        <StatCard label="Approval Rate" value={`${s.approval_rate}%`} sub="all time" icon={<TrendingUp className="w-5 h-5" />} color="green" />
        <StatCard label="Submitted" value={s.submitted_records.toLocaleString()} sub="records total" icon={<Send className="w-5 h-5" />} color="brand" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-2 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Review Activity (sample)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sparkData} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="approved" fill="#4f6ef7" radius={[4, 4, 0, 0]} name="Approved" />
              <Bar dataKey="rejected" fill="#fca5a5" radius={[4, 4, 0, 0]} name="Rejected" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Record Totals</h2>
          <div className="space-y-3">
            {[
              { label: 'Total Extracted', value: s.total_records, color: 'bg-gray-400' },
              { label: 'Approved', value: s.approved_records, color: 'bg-green-500' },
              { label: 'Rejected', value: s.rejected_records, color: 'bg-red-400' },
              { label: 'Pending', value: s.pending_review, color: 'bg-amber-400' },
              { label: 'Submitted', value: s.submitted_records, color: 'bg-blue-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                  <span className="text-sm text-gray-600">{label}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent jobs */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Recent Jobs</h2>
          <Link to="/jobs" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all →
          </Link>
        </div>
        {s.recent_jobs.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-600">No jobs yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a project and upload a document to get started</p>
            <Link
              to="/jobs"
              className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
            >
              Start your first job
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {s.recent_jobs.map(job => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{job.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-gray-500">Extracted / Approved</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {job.total_extracted} / {job.total_approved}
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
