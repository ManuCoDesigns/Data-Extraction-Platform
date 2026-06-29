import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, CheckCircle, AlertCircle,
  Upload, Eye, ArrowRight, Activity,
  Clock, BarChart3, RefreshCw,
} from 'lucide-react'
import { statsApi, sourcesApi } from '@/api/client'
import { safeFromNow } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:       { label: 'Not Started',       color: '#94a3b8', bg: '#f1f5f9' },
  extracting:        { label: 'Uploading',          color: '#3b82f6', bg: '#eff6ff' },
  needs_fixes:       { label: 'Schema Errors',      color: '#f59e0b', bg: '#fffbeb' },
  ready_for_review:  { label: 'Awaiting Review',    color: '#6366f1', bg: '#eef2ff' },
  in_review:         { label: 'In Review',          color: '#a855f7', bg: '#faf5ff' },
  changes_requested: { label: 'Corrections Needed', color: '#ef4444', bg: '#fef2f2' },
  llm_verification:  { label: 'LLM Check',          color: '#a855f7', bg: '#faf5ff' },
  approved:          { label: 'Approved',           color: '#10b981', bg: '#ecfdf5' },
}

const PIPELINE = [
  { id: 'upload',  label: 'Upload',  icon: '📤', color: '#3b82f6', border: '#bfdbfe',
    statuses: ['not_started','extracting','needs_fixes'] },
  { id: 'review',  label: 'Review',  icon: '🔍', color: '#a855f7', border: '#e9d5ff',
    statuses: ['ready_for_review','in_review','changes_requested','llm_verification'] },
  { id: 'approve', label: 'Approve', icon: '✅', color: '#10b981', border: '#a7f3d0',
    statuses: ['approved'] },
]

// ── Shared small components ───────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status]
  if (!m) return null
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

function KpiCard({ label, value, sub, icon, color, trend }: {
  label: string; value: number | string; sub: string
  icon: React.ReactNode; color: string; trend?: { value: number; label: string }
}) {
  const C = {
    blue:   { bg: '#eff6ff', icon: '#2563eb', text: '#1d4ed8' },
    purple: { bg: '#faf5ff', icon: '#7c3aed', text: '#6d28d9' },
    green:  { bg: '#ecfdf5', icon: '#059669', text: '#047857' },
    red:    { bg: '#fef2f2', icon: '#dc2626', text: '#b91c1c' },
    amber:  { bg: '#fffbeb', icon: '#d97706', text: '#b45309' },
  }[color] ?? { bg: '#f8fafc', icon: '#64748b', text: '#475569' }
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
      padding: '20px 22px', position: 'relative', overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ position: 'absolute', top: -12, right: -12, width: 64, height: 64,
        borderRadius: '50%', background: C.bg, opacity: 0.7 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: C.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.icon }}>
          {icon}
        </div>
        {trend && trend.value > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#059669',
            background: '#ecfdf5', padding: '2px 8px', borderRadius: 20 }}>
            +{trend.value} {trend.label}
          </span>
        )}
      </div>
      <p style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '4px 0 2px' }}>{label}</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{sub}</p>
    </div>
  )
}

function DashHeader({ name, sub, onRefresh, actionTo, actionLabel, actionColor = '#2563eb,#4f46e5', actionIcon }: {
  name: string; sub: string; onRefresh: () => void
  actionTo: string; actionLabel: string; actionColor?: string; actionIcon: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>
          {greeting()}, {name} 👋
        </h1>
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{sub}</p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRefresh}
          style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0',
            borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#64748b',
            display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
        </button>
        <Link to={actionTo}
          style={{ padding: '8px 16px',
            background: `linear-gradient(135deg, ${actionColor})`,
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
            color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          {actionIcon} {actionLabel}
        </Link>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ background: '#f1f5f9', borderRadius: 16, height: i === 1 ? 32 : 120,
          marginBottom: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

function SectionCard({ title, sub, badge, badgeColor = '#2563eb', linkTo, children }: {
  title: string; sub?: string; badge?: string | number; badgeColor?: string
  linkTo?: string; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
      overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 20 }}>
      <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h2>
          {sub && <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>{sub}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {badge !== undefined && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: badgeColor + '15', color: badgeColor, border: `1px solid ${badgeColor}30` }}>
              {badge}
            </span>
          )}
          {linkTo && (
            <Link to={linkTo} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              Full board <ArrowRight style={{ width: 12, height: 12 }} />
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ color: '#e2e8f0', display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {icon}
      </div>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b', margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
}

function SourceRow({ s, i, total }: { s: any; i: number; total: number }) {
  return (
    <Link to={`/projects/${s.project_id}/sources/${s.id}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 22px', textDecoration: 'none',
        borderBottom: i < total - 1 ? '1px solid #f8fafc' : 'none', transition: 'background 0.1s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: STATUS_META[s.status]?.bg ?? '#f8fafc',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Database style={{ width: 16, height: 16, color: STATUS_META[s.status]?.color ?? '#94a3b8' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{safeFromNow(s.updated_at)}</span>
            {s.total_records > 0 && <>
              <span style={{ fontSize: 11, color: '#e2e8f0' }}>·</span>
              <span style={{ fontSize: 11, color: s.invalid_records > 0 ? '#f59e0b' : '#94a3b8' }}>
                {s.valid_records}/{s.total_records} valid
                {s.invalid_records > 0 ? ` · ${s.invalid_records} errors` : ''}
              </span>
            </>}
          </div>
        </div>
      </div>
      <StatusPill status={s.status} />
    </Link>
  )
}

function ReviewQueueTable({ sources }: { sources: any[] }) {
  if (!sources.length) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
      <Eye style={{ width: 36, height: 36, margin: '0 auto 10px', opacity: 0.2 }} />
      <p style={{ fontSize: 13, margin: 0 }}>No sources in your review queue yet</p>
    </div>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
            {['Source', 'Status', 'Total', 'Approved', 'Pending', ''].map((h, i) => (
              <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10,
                fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
                letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map(s => {
            const tot  = s.total_records ?? 0
            const appr = s.approved_records ?? 0
            const pend = s.pending_records ?? Math.max(0, tot - appr)
            const pct  = tot > 0 ? Math.round((appr / tot) * 100) : 0
            const m    = STATUS_META[s.status]
            return (
              <tr key={s.id}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                style={{ borderBottom: '1px solid #f8fafc' }}>
                <td style={{ padding: '12px 16px' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{safeFromNow(s.updated_at)}</p>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
                    background: (m?.bg ?? '#f1f5f9'), color: m?.color ?? '#94a3b8' }}>
                    {m?.label ?? s.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>{tot}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, width: 60, overflow: 'hidden' }}>
                      <div style={{ background: '#10b981', height: '100%', width: `${pct}%`, borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>{appr}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: pend > 0 ? '#dc2626' : '#94a3b8' }}>
                    {pend}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <Link to={`/projects/${s.project_id}/sources/${s.id}`}
                    style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 8,
                      background: '#eff6ff', color: '#2563eb', textDecoration: 'none' }}>
                    Review →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Hook: safe summary load ────────────────────────────────────────────────────
function useSummary() {
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(new Date())

  const load = useCallback(() => {
    setLoading(true)
    statsApi.sourcesSummary()
      .then(d => { setData(d); setRefresh(new Date()) })
      .catch(() => setData({}))        // never crash — empty data on error
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [load])

  return { data, loading, load, lastRefresh: refresh }
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard() {
  const { user }                    = useAuthStore()
  const { data: summary, loading, load, lastRefresh } = useSummary()
  const [perf, setPerf]             = useState<any>(null)

  useEffect(() => {
    sourcesApi.performanceStats().then(setPerf).catch(() => {})
  }, [])

  if (loading) return <Skeleton />

  const byStatus      = summary?.by_status ?? {}
  const total         = summary?.total ?? 0
  const approvedCount = byStatus['approved'] ?? 0
  const inProgress    = ['extracting','needs_fixes','ready_for_review','in_review','changes_requested']
    .reduce((s, k) => s + (byStatus[k] ?? 0), 0)
  const notStarted    = byStatus['not_started'] ?? 0

  const chartData = Object.entries(byStatus)
    .filter(([, v]) => (v as number) > 0)
    .map(([status, count]) => ({
      name:  STATUS_META[status]?.label ?? status,
      value: count as number,
      color: STATUS_META[status]?.color ?? '#94a3b8',
    }))

  const pipelineCounts = PIPELINE.map(step => ({
    ...step,
    count: step.statuses.reduce((s, k) => s + (byStatus[k] ?? 0), 0),
  }))

  const extractors = perf?.extractors ?? []
  const reviewers  = perf?.reviewers  ?? []

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <DashHeader
        name={user?.full_name?.split(' ')[0] ?? ''}
        sub={`Extraction operation at a glance · Last updated ${lastRefresh.toLocaleTimeString()}`}
        onRefresh={load} actionTo="/sources" actionLabel="All Sources"
        actionIcon={<Database style={{ width: 14, height: 14 }} />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Total Sources"  value={total}         sub="across all projects"        icon={<Database style={{ width: 18, height: 18 }} />}    color="blue"   />
        <KpiCard label="In Progress"    value={inProgress}    sub="uploading or in review"     icon={<Activity style={{ width: 18, height: 18 }} />}    color="purple" />
        <KpiCard label="Approved"       value={approvedCount} sub={`${total > 0 ? Math.round(approvedCount/total*100) : 0}% complete`} icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="green" trend={{ value: summary?.approved_this_week ?? 0, label: 'this week' }} />
        <KpiCard label="Not Started"    value={notStarted}    sub="waiting for extraction"     icon={<Clock style={{ width: 18, height: 18 }} />}        color="amber"  />
      </div>

      {/* Pipeline funnel */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
        padding: '20px 22px', marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Extraction Pipeline</h2>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Sources moving through the workflow</p>
          </div>
          <Link to="/sources" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            View board <ArrowRight style={{ width: 12, height: 12 }} />
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {pipelineCounts.map(step => {
            const pct = total > 0 ? Math.round((step.count / total) * 100) : 0
            return (
              <div key={step.id} style={{ flex: 1, background: '#fff', border: `1px solid ${step.border}`,
                borderRadius: 14, padding: '16px 18px', borderTop: `3px solid ${step.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{step.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: step.color,
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>{step.label}</span>
                </div>
                <p style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>{step.count}</p>
                <div style={{ background: '#f1f5f9', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: step.color, height: '100%', borderRadius: 99,
                    width: `${pct}%`, transition: 'width 0.8s ease' }} />
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>{pct}% of total</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Chart + Team */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Bar chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>Sources by Status</p>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px' }}>{total} total</p>
          {chartData.length === 0
            ? <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>No data yet</div>
            : <ResponsiveContainer width="100%" height={160}>
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
          }
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {chartData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: d.color }} />
                  <span style={{ fontSize: 10, color: '#64748b' }}>{d.name}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Extractors */}
        <div style={{ background: 'linear-gradient(135deg,#ecfdf5,#f0fdf4)', border: '1px solid #6ee7b7',
          borderRadius: 16, padding: '18px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#059669',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⛏️</div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#065f46', margin: 0 }}>Extractors</p>
              <p style={{ fontSize: 10, color: '#6ee7b7', margin: 0 }}>{extractors.length} assigned</p>
            </div>
          </div>
          {extractors.length === 0
            ? <div style={{ textAlign: 'center', padding: '20px 0', color: '#6ee7b7', fontSize: 12 }}>No extractors assigned</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {extractors.map((e: any) => {
                  const pct = e.sources_count > 0 ? Math.round((e.approved_count / e.sources_count) * 100) : 0
                  return (
                    <div key={e.user_id} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 10,
                      padding: '10px 12px', border: '1px solid #a7f3d0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#059669',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {(e.name ?? '?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: '#064e3b', margin: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</p>
                          <p style={{ fontSize: 10, color: '#6ee7b7', margin: 0 }}>{e.approved_count}/{e.sources_count} done</p>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#059669' }}>{pct}%</span>
                      </div>
                      <div style={{ background: '#a7f3d0', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                        <div style={{ background: '#059669', height: '100%', width: `${pct}%`,
                          borderRadius: 99, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* Reviewers */}
        <div style={{ background: 'linear-gradient(135deg,#faf5ff,#f5f3ff)', border: '1px solid #c4b5fd',
          borderRadius: 16, padding: '18px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#7c3aed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🔍</div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#4c1d95', margin: 0 }}>Reviewers</p>
              <p style={{ fontSize: 10, color: '#c4b5fd', margin: 0 }}>{reviewers.length} assigned</p>
            </div>
          </div>
          {reviewers.length === 0
            ? <div style={{ textAlign: 'center', padding: '20px 0', color: '#c4b5fd', fontSize: 12 }}>No reviewers assigned</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reviewers.map((r: any) => {
                  const pct = r.sources_count > 0 ? Math.round((r.approved_count / r.sources_count) * 100) : 0
                  return (
                    <div key={r.user_id} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 10,
                      padding: '10px 12px', border: '1px solid #ddd6fe' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#7c3aed',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {(r.name ?? '?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: '#3b0764', margin: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</p>
                          <p style={{ fontSize: 10, color: '#c4b5fd', margin: 0 }}>{r.approved_count}/{r.sources_count} done</p>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#7c3aed' }}>{pct}%</span>
                      </div>
                      <div style={{ background: '#ddd6fe', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                        <div style={{ background: '#7c3aed', height: '100%', width: `${pct}%`,
                          borderRadius: 99, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>
      </div>

      {/* Recent Activity */}
      {(summary?.recent ?? []).length > 0 && (
        <SectionCard title="Recent Activity" sub="Latest source updates" linkTo="/sources">
          {(summary.recent as any[]).map((s: any, i: number) => (
            <SourceRow key={s.id} s={s} i={i} total={summary.recent.length} />
          ))}
        </SectionCard>
      )}
    </div>
  )
}

// ── Extractor Dashboard ────────────────────────────────────────────────────────
function ExtractorDashboard() {
  const { user }                    = useAuthStore()
  const { data: summary, loading, load, lastRefresh } = useSummary()

  if (loading) return <Skeleton />

  const mine        : any[] = summary?.my_extracting ?? []
  const available   : any[] = summary?.available     ?? []
  const needsAction         = mine.filter((s: any) => ['needs_fixes','changes_requested'].includes(s.status))
  const totalExtracted      = summary?.total_extracted      ?? mine.reduce((t: number, s: any) => t + (s.total_records    ?? 0), 0)
  const totalApproved       = summary?.total_ext_approved   ?? mine.reduce((t: number, s: any) => t + (s.approved_records ?? 0), 0)
  const pct                 = totalExtracted > 0 ? Math.round((totalApproved / totalExtracted) * 100) : 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <DashHeader
        name={user?.full_name?.split(' ')[0] ?? ''}
        sub={`Your extraction workspace · Last updated ${lastRefresh.toLocaleTimeString()}`}
        onRefresh={load} actionTo="/sources" actionLabel="All Sources"
        actionIcon={<Database style={{ width: 14, height: 14 }} />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="My Sources"         value={mine.length}       sub="assigned to me"              icon={<Upload style={{ width: 18, height: 18 }} />}    color="blue"   />
        <KpiCard label="Records Uploaded"   value={totalExtracted}    sub={`${pct}% approved by reviewer`} icon={<Database style={{ width: 18, height: 18 }} />} color="purple" />
        <KpiCard label="Needs Fixes"        value={needsAction.length} sub="errors or sent back"        icon={<AlertCircle style={{ width: 18, height: 18 }} />} color="red"    />
        <KpiCard label="Available to Claim" value={available.length}  sub="unassigned sources"          icon={<Activity style={{ width: 18, height: 18 }} />}   color="green"  />
      </div>

      {/* Needs attention */}
      {needsAction.length > 0 && (
        <SectionCard title="Needs Your Attention" sub="Reviewer sent these back — fix and re-upload"
          badge={needsAction.length} badgeColor="#dc2626">
          {needsAction.map((s: any, i: number) => (
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 22px', textDecoration: 'none',
                borderBottom: i < needsAction.length - 1 ? '1px solid #fef2f2' : 'none', transition: 'background 0.1s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AlertCircle style={{ width: 16, height: 16, color: '#ef4444' }} />
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                    {s.invalid_records > 0 ? `${s.invalid_records} schema errors` : 'Changes requested'} · {safeFromNow(s.updated_at)}
                  </p>
                </div>
              </div>
              <StatusPill status={s.status} />
            </Link>
          ))}
        </SectionCard>
      )}

      {/* Available to claim */}
      {available.length > 0 && (
        <SectionCard title="Available to Claim" sub="No extractor assigned — open a source and click Claim This Source"
          badge={`${available.length} available`} badgeColor="#059669">
          {available.slice(0, 6).map((s: any, i: number) => (
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 22px', textDecoration: 'none',
                borderBottom: i < Math.min(available.length, 6) - 1 ? '1px solid #f0fdf4' : 'none', transition: 'background 0.1s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f0fdf4' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#ecfdf5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>✋</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{s.name}</p>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>Not started · {safeFromNow(s.updated_at)}</p>
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px',
                borderRadius: 8, background: '#059669', color: '#fff' }}>Claim →</span>
            </Link>
          ))}
        </SectionCard>
      )}

      {/* My sources */}
      <SectionCard title="My Sources" sub="All sources currently assigned to you" linkTo="/sources">
        {mine.length === 0
          ? <EmptyRow icon={<Database style={{ width: 40, height: 40 }} />}
              title="No sources assigned yet"
              sub="Claim a source above, or ask an admin to assign you." />
          : mine.map((s: any, i: number) => <SourceRow key={s.id} s={s} i={i} total={mine.length} />)
        }
      </SectionCard>
    </div>
  )
}

// ── Reviewer Dashboard ────────────────────────────────────────────────────────
function ReviewerDashboard() {
  const { user }                    = useAuthStore()
  const { data: summary, loading, load, lastRefresh } = useSummary()

  if (loading) return <Skeleton />

  const mine             : any[] = summary?.my_reviewing       ?? []
  const approvedRecords          = summary?.my_approved_records ?? 0
  const approvedThisWeek         = summary?.my_approved_this_week ?? 0
  const pendingTotal             = summary?.my_pending_total    ?? 0
  const ready                    = mine.filter((s: any) => s.status === 'ready_for_review')
  const inProgress               = mine.filter((s: any) => s.status === 'in_review')
  const pctDone                  = approvedRecords + pendingTotal > 0
    ? Math.round((approvedRecords / (approvedRecords + pendingTotal)) * 100) : 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <DashHeader
        name={user?.full_name?.split(' ')[0] ?? ''}
        sub={`Your review workspace · Last updated ${lastRefresh.toLocaleTimeString()}`}
        onRefresh={load} actionTo="/sources" actionLabel="All Sources"
        actionColor="#7c3aed,#6366f1"
        actionIcon={<Eye style={{ width: 14, height: 14 }} />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Records Approved" value={approvedRecords} sub="approved by you total"
          icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="green"
          trend={{ value: approvedThisWeek, label: 'this week' }} />
        <KpiCard label="Pending Records"  value={pendingTotal}    sub="still need your review"
          icon={<Clock style={{ width: 18, height: 18 }} />}        color="amber" />
        <KpiCard label="Ready to Review"  value={ready.length}    sub="sources waiting for you"
          icon={<Eye style={{ width: 18, height: 18 }} />}          color="purple" />
        <KpiCard label="In Progress"      value={inProgress.length} sub="you've started reviewing"
          icon={<Activity style={{ width: 18, height: 18 }} />}     color="blue" />
      </div>

      {/* Progress bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
        padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Your Review Progress</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>
              {approvedRecords} approved · {pendingTotal} pending across {mine.length} source{mine.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 32, fontWeight: 800, color: '#7c3aed', margin: 0, lineHeight: 1 }}>{pctDone}%</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>complete</p>
          </div>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 99, height: 12, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(90deg,#7c3aed,#6366f1)', height: '100%',
            borderRadius: 99, width: `${pctDone}%`, transition: 'width 0.8s ease' }} />
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
          {[
            { label: 'Ready',             count: ready.length,       color: '#6366f1' },
            { label: 'In Review',         count: inProgress.length,  color: '#7c3aed' },
            { label: 'Approved This Week', count: approvedThisWeek,  color: '#059669' },
            { label: 'Total Approved',    count: approvedRecords,    color: '#10b981' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>{s.label}: <strong style={{ color: s.color }}>{s.count}</strong></span>
            </div>
          ))}
        </div>
      </div>

      {/* Review queue */}
      <SectionCard title="My Review Queue" sub="Click any row to open and review" linkTo="/sources">
        <ReviewQueueTable sources={mine} />
      </SectionCard>
    </div>
  )
}

// ── Dual Role Dashboard ───────────────────────────────────────────────────────
function DualRoleDashboard() {
  const { user }                    = useAuthStore()
  const { data: summary, loading, load, lastRefresh } = useSummary()

  if (loading) return <Skeleton />

  const myExtracting: any[] = summary?.my_extracting ?? []
  const myReviewing : any[] = summary?.my_reviewing  ?? []
  const needsAction         = myExtracting.filter((s: any) => ['needs_fixes','changes_requested'].includes(s.status))
  const pendingReview       = myReviewing.filter((s: any) => (s.pending_records ?? 0) > 0)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {greeting()}, {user?.full_name?.split(' ')[0] ?? ''} 👋
          </h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7' }}>⛏️ Extractor</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: '#faf5ff', color: '#7c3aed', border: '1px solid #c4b5fd' }}>🔍 Reviewer</span>
            <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
              Dual role · {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ padding: '8px 16px', background: '#fff',
            border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer', fontSize: 13,
            color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
          <Link to="/sources" style={{ padding: '8px 16px',
            background: 'linear-gradient(135deg,#2563eb,#7c3aed)', border: 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database style={{ width: 14, height: 14 }} /> All Sources
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="My Sources"     value={myExtracting.length}  sub="assigned to extract"  icon={<Upload style={{ width: 18, height: 18 }} />}       color="blue"   />
        <KpiCard label="Needs Fixes"    value={needsAction.length}   sub="errors to fix"        icon={<AlertCircle style={{ width: 18, height: 18 }} />}   color="red"    />
        <KpiCard label="To Review"      value={myReviewing.length}   sub="assigned to review"   icon={<Eye style={{ width: 18, height: 18 }} />}           color="purple" />
        <KpiCard label="Pending Records" value={pendingReview.reduce((s: number, r: any) => s + (r.pending_records ?? 0), 0)}
          sub="records awaiting approval" icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="amber" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <SectionCard title="My Extraction Work" badge={myExtracting.length} badgeColor="#2563eb">
          {myExtracting.length === 0
            ? <EmptyRow icon={<Upload style={{ width: 36, height: 36 }} />} title="No sources assigned for extraction" />
            : myExtracting.map((s: any, i: number) => <SourceRow key={s.id} s={s} i={i} total={myExtracting.length} />)
          }
        </SectionCard>
        <SectionCard title="My Review Queue" badge={pendingReview.length > 0 ? `${pendingReview.length} pending` : undefined} badgeColor="#dc2626">
          <ReviewQueueTable sources={myReviewing} />
        </SectionCard>
      </div>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { user } = useAuthStore()
  if (!user) return null

  // Defensive: handle undefined/null roles gracefully
  const roles = new Set(Array.isArray(user.roles) ? user.roles : [])

  if (roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead'))
    return <AdminDashboard />

  const isExtractor = roles.has('pipeline_operator')
  const isReviewer  = roles.has('reviewer')

  if (isExtractor && isReviewer) return <DualRoleDashboard />
  if (isReviewer)                return <ReviewerDashboard />
  return <ExtractorDashboard />
}
