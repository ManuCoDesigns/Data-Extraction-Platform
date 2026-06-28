import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, TrendingUp, CheckCircle, AlertCircle,
  Upload, Eye, Send, ArrowRight, Activity,
  Clock, Users, BarChart3, RefreshCw, Zap
} from 'lucide-react'
import { statsApi, sourcesApi } from '@/api/client'
import { Spinner, cn, safeFromNow } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Pipeline step config
const PIPELINE = [
  { id: 'upload',  label: 'Upload',  icon: '📤', statuses: ['not_started','extracting','needs_fixes'], color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  { id: 'review',  label: 'Review',  icon: '🔍', statuses: ['ready_for_review','in_review','changes_requested','llm_verification'], color: '#7c3aed', bg: '#faf5ff', border: '#c4b5fd' },
  { id: 'approve', label: 'Approved',icon: '✅', statuses: ['approved'],  color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' },
]

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:       { label: 'Not Started',       color: '#94a3b8', bg: '#f1f5f9' },
  extracting:        { label: 'Uploading',          color: '#3b82f6', bg: '#eff6ff' },
  needs_fixes:       { label: 'Schema Errors',      color: '#f59e0b', bg: '#fffbeb' },
  ready_for_review:  { label: 'Awaiting Review',    color: '#6366f1', bg: '#eef2ff' },
  in_review:         { label: 'In Review',          color: '#a855f7', bg: '#faf5ff' },
  changes_requested: { label: 'Corrections Needed', color: '#ef4444', bg: '#fef2f2' },
  llm_verification:  { label: 'LLM Check Done',     color: '#a855f7', bg: '#faf5ff' },
  approved:          { label: 'Approved',           color: '#10b981', bg: '#ecfdf5' },
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, color, trend }: {
  label: string; value: number | string; sub: string
  icon: React.ReactNode; color: string; trend?: { value: number; label: string }
}) {
  const colors: Record<string, { bg: string; text: string; border: string; icon: string }> = {
    blue:   { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe', icon: '#2563eb' },
    green:  { bg: '#ecfdf5', text: '#059669', border: '#6ee7b7', icon: '#059669' },
    purple: { bg: '#faf5ff', text: '#7c3aed', border: '#c4b5fd', icon: '#7c3aed' },
    amber:  { bg: '#fffbeb', text: '#d97706', border: '#fcd34d', icon: '#d97706' },
    red:    { bg: '#fef2f2', text: '#dc2626', border: '#fecaca', icon: '#dc2626' },
    orange: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa', icon: '#ea580c' },
  }
  const c = colors[color] || colors.blue
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', border: `1px solid ${c.border}`, borderTop: `3px solid ${c.text}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -12, right: -12, width: 64, height: 64, borderRadius: '50%', background: c.bg, opacity: 0.7 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.icon }}>
          {icon}
        </div>
        {trend && (
          <span style={{ fontSize: 11, fontWeight: 700, color: trend.value >= 0 ? '#059669' : '#dc2626', background: trend.value >= 0 ? '#ecfdf5' : '#fef2f2', padding: '3px 8px', borderRadius: 20 }}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)} {trend.label}
          </span>
        )}
      </div>
      <p style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: c.text, margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{sub}</p>
    </div>
  )
}

// ── Pipeline Step Card ─────────────────────────────────────────────────────────
function PipelineStep({ step, count, total, isLast }: { step: typeof PIPELINE[0]; count: number; total: number; isLast: boolean }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <div style={{ flex: 1, background: '#fff', border: `1px solid ${step.border}`, borderRadius: 14, padding: '16px 18px', borderTop: `3px solid ${step.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{step.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: step.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{step.label}</span>
          </div>
          <span style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{count}</span>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 99, height: 6, overflow: 'hidden' }}>
          <div style={{ background: step.color, height: '100%', borderRadius: 99, width: `${pct}%`, transition: 'width 0.8s ease' }} />
        </div>
        <p style={{ fontSize: 10, color: '#94a3b8', margin: '6px 0 0' }}>{pct}% of total sources</p>
      </div>
      {!isLast && (
        <div style={{ padding: '0 8px', color: '#cbd5e1' }}>
          <ArrowRight style={{ width: 16, height: 16 }} />
        </div>
      )}
    </div>
  )
}

// ── Team Performance Row ───────────────────────────────────────────────────────
function PerfRow({ name, assigned, completed, avgHours, role }: {
  name: string; assigned: number; completed: number; avgHours: number | null; role: 'extractor' | 'reviewer'
}) {
  const pct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0
  const color = role === 'extractor' ? '#059669' : '#7c3aed'
  const bg = role === 'extractor' ? '#ecfdf5' : '#faf5ff'
  const initial = name?.charAt(0)?.toUpperCase() || '?'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>{completed}/{assigned} sources</span>
            <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: 20 }}>{pct}%</span>
          </div>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 99, height: 6, overflow: 'hidden' }}>
          <div style={{ background: color, height: '100%', borderRadius: 99, width: `${pct}%`, transition: 'width 0.8s ease' }} />
        </div>
        {avgHours != null && (
          <p style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0' }}>avg {avgHours}h per source</p>
        )}
      </div>
    </div>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status]
  if (!m) return null
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ height: 32, width: 280, background: '#e2e8f0', borderRadius: 8, animation: 'pulse 2s infinite' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {[0,1,2,3].map(i => <div key={i} style={{ height: 120, background: '#e2e8f0', borderRadius: 16 }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ height: 280, background: '#e2e8f0', borderRadius: 16 }} />
        <div style={{ height: 280, background: '#e2e8f0', borderRadius: 16 }} />
      </div>
    </div>
  )
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [perf, setPerf]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const load = useCallback(() =>
    Promise.all([
      statsApi.sourcesSummary().then(setSummary),
      sourcesApi.performanceStats().then(setPerf),
    ]).then(() => setLastRefresh(new Date()))
     .finally(() => setLoading(false)), [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [load])

  if (loading) return <Skeleton />

  const byStatus = summary?.by_status ?? {}
  const total = summary?.total ?? 0
  const approvedCount = byStatus['approved'] ?? 0
  const inProgressCount = ['extracting','needs_fixes','ready_for_review','in_review','changes_requested'].reduce((s, k) => s + (byStatus[k] ?? 0), 0)
  const notStarted = byStatus['not_started'] ?? 0

  const pipelineCounts = PIPELINE.map(step => ({
    ...step,
    count: step.statuses.reduce((s, k) => s + (byStatus[k] ?? 0), 0)
  }))

  const chartData = Object.entries(byStatus)
    .filter(([, v]) => (v as number) > 0)
    .map(([status, count]) => ({
      name: STATUS_META[status]?.label?.replace(' ', '\n') ?? status,
      value: count as number,
      color: STATUS_META[status]?.color ?? '#94a3b8',
    }))

  const extractors = perf?.extractors ?? []
  const reviewers  = perf?.reviewers  ?? []

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Here's your extraction operation at a glance · Last updated {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
          <Link to="/sources" style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #2563eb, #4f46e5)', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database style={{ width: 14, height: 14 }} /> All Sources
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Total Sources" value={total} sub="across all projects" icon={<Database style={{ width: 18, height: 18 }} />} color="blue" />
        <KpiCard label="In Progress" value={inProgressCount} sub="uploading or in review" icon={<Activity style={{ width: 18, height: 18 }} />} color="purple" />
        <KpiCard label="Approved" value={approvedCount} sub={`${total > 0 ? Math.round(approvedCount/total*100) : 0}% complete`} icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="green" trend={{ value: summary?.approved_this_week ?? 0, label: 'this week' }} />
        <KpiCard label="Not Started" value={notStarted} sub="waiting for extraction" icon={<Clock style={{ width: 18, height: 18 }} />} color="amber" />
      </div>

      {/* Pipeline funnel */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 22px', marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Extraction Pipeline</h2>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Sources moving through the 4-step workflow</p>
          </div>
          <Link to="/sources" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            View board <ArrowRight style={{ width: 12, height: 12 }} />
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {pipelineCounts.map((step, i) => (
            <PipelineStep key={step.id} step={step} count={step.count} total={total} isLast={i === pipelineCounts.length - 1} />
          ))}
        </div>
      </div>

      {/* Chart + Team — 3-col grid: chart | extractors | reviewers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16, marginBottom: 24 }}>

        {/* Bar chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>Sources by Status</p>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px' }}>{total} total sources</p>
          {chartData.length === 0 ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>No sources yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={18} margin={{ top: 2, right: 2, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11 }} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="value" radius={[4,4,0,0]} name="Sources">
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {chartData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: '#64748b' }}>{d.name}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Extractors column */}
        <div style={{ background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid #6ee7b7', borderRadius: 16, padding: '18px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⛏️</div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#065f46', margin: 0 }}>Extractors</p>
              <p style={{ fontSize: 10, color: '#6ee7b7', margin: 0 }}>{extractors.length} assigned</p>
            </div>
          </div>
          {extractors.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#6ee7b7', fontSize: 12 }}>No extractors assigned</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {extractors.map((e: any) => {
                const pct = e.sources_count > 0 ? Math.round((e.approved_count / e.sources_count) * 100) : 0
                return (
                  <div key={e.user_id} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '10px 12px', border: '1px solid #a7f3d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {e.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#064e3b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</p>
                        <p style={{ fontSize: 10, color: '#6ee7b7', margin: 0 }}>{e.approved_count}/{e.sources_count} done</p>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#059669' }}>{pct}%</span>
                    </div>
                    <div style={{ background: '#a7f3d0', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                      <div style={{ background: '#059669', height: '100%', width: `${pct}%`, borderRadius: 99, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Reviewers column */}
        <div style={{ background: 'linear-gradient(135deg, #faf5ff, #f5f3ff)', border: '1px solid #c4b5fd', borderRadius: 16, padding: '18px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🔍</div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#4c1d95', margin: 0 }}>Reviewers</p>
              <p style={{ fontSize: 10, color: '#c4b5fd', margin: 0 }}>{reviewers.length} assigned</p>
            </div>
          </div>
          {reviewers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#c4b5fd', fontSize: 12 }}>No reviewers assigned</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reviewers.map((r: any) => {
                const pct = r.sources_count > 0 ? Math.round((r.approved_count / r.sources_count) * 100) : 0
                return (
                  <div key={r.user_id} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '10px 12px', border: '1px solid #ddd6fe' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {r.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#3b0764', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</p>
                        <p style={{ fontSize: 10, color: '#c4b5fd', margin: 0 }}>{r.approved_count}/{r.sources_count} done</p>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#7c3aed' }}>{pct}%</span>
                    </div>
                    <div style={{ background: '#ddd6fe', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                      <div style={{ background: '#7c3aed', height: '100%', width: `${pct}%`, borderRadius: 99, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      {(summary?.recent ?? []).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Recent Activity</h2>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Latest source updates across all projects</p>
            </div>
            <Link to="/sources" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              All sources <ArrowRight style={{ width: 12, height: 12 }} />
            </Link>
          </div>
          {(summary.recent as any[]).map((s: any, i: number) => (
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', textDecoration: 'none', borderBottom: i < summary.recent.length - 1 ? '1px solid #f8fafc' : 'none', transition: 'background 0.1s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: STATUS_META[s.status]?.bg ?? '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Database style={{ width: 16, height: 16, color: STATUS_META[s.status]?.color ?? '#94a3b8' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{safeFromNow(s.updated_at)}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
                    <span style={{ fontSize: 11, color: s.invalid_records > 0 ? '#f59e0b' : '#94a3b8' }}>
                      {s.valid_records}/{s.total_records} valid{s.invalid_records > 0 ? ` · ${s.invalid_records} errors` : ''}
                    </span>
                  </div>
                </div>
              </div>
              <StatusPill status={s.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Extractor Dashboard ────────────────────────────────────────────────────────
function ExtractorDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    statsApi.sourcesSummary().then(setSummary).finally(() => setLoading(false))
    const iv = setInterval(() => statsApi.sourcesSummary().then(setSummary), 30_000)
    return () => clearInterval(iv)
  }, [])

  if (loading) return <Skeleton />

  const mine: any[] = summary?.my_extracting ?? []
  const needsAction = mine.filter((s: any) => ['needs_fixes','changes_requested'].includes(s.status))
  const inProgress  = mine.filter((s: any) => s.status === 'extracting')

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>
          {greeting()}, {user?.full_name?.split(' ')[0]} 👋
        </h1>
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Your extraction tasks for today.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Assigned to Me" value={mine.length} sub="total sources" icon={<Upload style={{ width: 18, height: 18 }} />} color="blue" />
        <KpiCard label="Needs Attention" value={needsAction.length} sub="errors to fix" icon={<AlertCircle style={{ width: 18, height: 18 }} />} color="red" />
        <KpiCard label="In Progress" value={inProgress.length} sub="actively extracting" icon={<Activity style={{ width: 18, height: 18 }} />} color="amber" />
      </div>

      {needsAction.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle style={{ width: 16, height: 16, color: '#ef4444' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', margin: 0 }}>Needs Your Attention ({needsAction.length})</h3>
          </div>
          {needsAction.map((s: any, i: number) => (
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', textDecoration: 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.5)', borderBottom: i < needsAction.length - 1 ? '1px solid #fee2e2' : 'none' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{s.invalid_records} schema errors · {safeFromNow(s.updated_at)}</p>
              </div>
              <StatusPill status={s.status} />
            </Link>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>All My Sources</h3>
          <Link to="/sources" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Full board →</Link>
        </div>
        {mine.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
            <Database style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.2 }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', margin: 0 }}>No sources assigned yet</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>An admin will assign you when there's data to extract.</p>
          </div>
        ) : mine.map((s: any, i: number) => (
          <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', textDecoration: 'none', borderBottom: i < mine.length - 1 ? '1px solid #f8fafc' : 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{s.valid_records}/{s.total_records} valid · {safeFromNow(s.updated_at)}</p>
            </div>
            <StatusPill status={s.status} />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── Reviewer Dashboard ────────────────────────────────────────────────────────
function ReviewerDashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    statsApi.sourcesSummary().then(setSummary).finally(() => setLoading(false))
    const iv = setInterval(() => statsApi.sourcesSummary().then(setSummary), 30_000)
    return () => clearInterval(iv)
  }, [])

  if (loading) return <Skeleton />
  const mine: any[] = summary?.my_reviewing ?? []
  const ready = mine.filter((s: any) => s.status === 'ready_for_review')

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>
          {greeting()}, {user?.full_name?.split(' ')[0]} 👋
        </h1>
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Sources waiting for your review.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Ready to Review" value={ready.length} sub="waiting for you" icon={<Eye style={{ width: 18, height: 18 }} />} color="purple" />
        <KpiCard label="In Review" value={mine.filter((s: any) => s.status === 'in_review').length} sub="you've started" icon={<Activity style={{ width: 18, height: 18 }} />} color="blue" />
        <KpiCard label="Total Assigned" value={mine.length} sub="all review sources" icon={<Database style={{ width: 18, height: 18 }} />} color="green" />
      </div>

      {ready.length > 0 && (
        <div style={{ background: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #c4b5fd', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Eye style={{ width: 16, height: 16, color: '#7c3aed' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', margin: 0 }}>Ready for Your Review ({ready.length})</h3>
          </div>
          {ready.map((s: any, i: number) => (
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', textDecoration: 'none', borderBottom: i < ready.length - 1 ? '1px solid #ede9fe' : 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.6)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{s.total_records} records · {safeFromNow(s.updated_at)}</p>
              </div>
              <StatusPill status={s.status} />
            </Link>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>All Review Sources</h3>
          <Link to="/sources" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Full board →</Link>
        </div>
        {mine.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
            <Eye style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.2 }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', margin: 0 }}>No sources assigned for review</p>
          </div>
        ) : mine.map((s: any, i: number) => (
          <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', textDecoration: 'none', borderBottom: i < mine.length - 1 ? '1px solid #f8fafc' : 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{s.approved_records}/{s.total_records} approved · {safeFromNow(s.updated_at)}</p>
            </div>
            <StatusPill status={s.status} />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── Router ─────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { user } = useAuthStore()
  if (!user) return null
  const roles = new Set(user.roles)
  if (roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead')) return <AdminDashboard />
  if (roles.has('reviewer')) return <ReviewerDashboard />
  return <ExtractorDashboard />
}
