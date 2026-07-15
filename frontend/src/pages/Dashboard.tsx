import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, CheckCircle, AlertCircle, Upload, Eye, ArrowRight,
  Activity, Clock, RefreshCw, ShieldCheck, TrendingUp, Zap,
  Users, BarChart3, Target, Award,
} from 'lucide-react'
import { statsApi, projectsApi } from '@/api/client'
import { safeFromNow } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:         { label: 'Not Started',       color: '#64748b', bg: '#f1f5f9' },
  extracting:          { label: 'Extracting',         color: '#3b82f6', bg: '#eff6ff' },
  needs_fixes:         { label: 'Needs Fixes',        color: '#f59e0b', bg: '#fffbeb' },
  ready_for_review:    { label: 'Ready for Review',   color: '#6366f1', bg: '#eef2ff' },
  in_review:           { label: 'In Review',          color: '#a855f7', bg: '#faf5ff' },
  changes_requested:   { label: 'Corrections Needed', color: '#ef4444', bg: '#fef2f2' },
  llm_verification:    { label: 'LLM Check',          color: '#a855f7', bg: '#faf5ff' },
  approved:            { label: 'Approved',           color: '#10b981', bg: '#ecfdf5' },
}

// ── Shared components ─────────────────────────────────────────────────────────
function KPI({ label, value, sub, icon, color, trend }: {
  label: string; value: number | string; sub: string
  icon: React.ReactNode; color: string; trend?: { value: number; label: string }
}) {
  const C = ({
    blue:   { bg: '#eff6ff', ic: '#2563eb', tx: '#1d4ed8' },
    purple: { bg: '#faf5ff', ic: '#7c3aed', tx: '#6d28d9' },
    green:  { bg: '#ecfdf5', ic: '#059669', tx: '#047857' },
    red:    { bg: '#fef2f2', ic: '#dc2626', tx: '#b91c1c' },
    amber:  { bg: '#fffbeb', ic: '#d97706', tx: '#b45309' },
    indigo: { bg: '#eef2ff', ic: '#4f46e5', tx: '#4338ca' },
  } as any)[color] ?? { bg: '#f8fafc', ic: '#64748b', tx: '#475569' }
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ic }}>{icon}</div>
        {trend && trend.value > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', background: '#ecfdf5',
            padding: '2px 7px', borderRadius: 20 }}>+{trend.value} {trend.label}</span>
        )}
      </div>
      <p style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: C.tx, margin: '3px 0 1px' }}>{label}</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{sub}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status]
  if (!m) return <span style={{ fontSize: 11, color: '#94a3b8' }}>{status}</span>
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
  )
}

function SectionCard({ title, sub, badge, badgeColor = '#2563eb', action, children }: {
  title: string; sub?: string; badge?: string | number; badgeColor?: string
  action?: { label: string; to: string }; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
      overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 20 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h2>
          {sub && <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>{sub}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {badge !== undefined && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: badgeColor + '18', color: badgeColor, border: `1px solid ${badgeColor}30` }}>{badge}</span>
          )}
          {action && (
            <Link to={action.to} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              {action.label} <ArrowRight style={{ width: 12, height: 12 }} />
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function TH({ children, align = 'left' }: { children: React.ReactNode; align?: string }) {
  return (
    <th style={{ padding: '10px 16px', textAlign: align as any, fontSize: 10, fontWeight: 700,
      color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap',
      background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>{children}</th>
  )
}

function TD({ children, align = 'left' }: { children: React.ReactNode; align?: string }) {
  return (
    <td style={{ padding: '12px 16px', textAlign: align as any, borderBottom: '1px solid #f8fafc',
      fontSize: 13, color: '#1e293b', verticalAlign: 'middle' }}>{children}</td>
  )
}

function Avatar({ name }: { name: string }) {
  const colors = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706','#0891b2']
  const color  = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {(name ?? '?')[0].toUpperCase()}
    </div>
  )
}

function MiniBar({ value, max, color = '#2563eb' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, width: 60, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ background: color, height: '100%', width: `${pct}%`, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{pct}%</span>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ padding: '22px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{ width: 160, height: 24, borderRadius: 8, background: '#e2e8f0' }} />
      </div>
      {[100, 80, 220, 180].map((h, i) => (
        <div key={i} style={{ background: '#f1f5f9', borderRadius: 16, height: h, marginBottom: 16 }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ padding: '80px 28px', maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
        Dashboard failed to load
      </p>
      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24 }}>
        The server may be waking up — this usually takes 30–60 seconds on first load
      </p>
      <button onClick={onRetry}
        style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none',
          borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Retry
      </button>
    </div>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────
function useSummary() {
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [ts, setTs]           = useState(new Date())

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    statsApi.sourcesSummary()
      .then(d => { setData(d && typeof d === 'object' ? d : {}); setTs(new Date()) })
      .catch(() => { setData({}); setError(true) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [load])

  return { data, loading, error, load, ts, clearError: () => setError(false) }
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard() {
  const { user }                               = useAuthStore()
  const { data: s, loading, error, load, ts, clearError } = useSummary()
  const [productivity, setProductivity]        = useState<any>(null)
  const [projects, setProjects]                = useState<any[]>([])
  const [activeProject, setActiveProject]      = useState<string | null>(null)
  const [prodTab, setProdTab]                  = useState<'extractors' | 'reviewers'>('extractors')

  useEffect(() => {
    statsApi.productivity().then(setProductivity).catch(() => {})
    projectsApi.list().then((r: any) => {
      setProjects(Array.isArray(r) ? r : r?.items ?? [])
    }).catch(() => {})
  }, [])

  if (loading) return <Skeleton />
  if (error && !s?.total) return <ErrorState onRetry={() => { clearError(); load() }} />

  const byStatus      = s?.by_status         ?? {}
  const total         = s?.total             ?? 0
  const approvedCount = byStatus['approved'] ?? 0
  const inProgress    = ['extracting', 'needs_fixes', 'ready_for_review', 'in_review', 'changes_requested']
    .reduce((a, k) => a + (byStatus[k] ?? 0), 0)
  const pendingAdmin  = (s?.pending_admin_review ?? []).length
  const perProject: any[] = s?.per_project ?? []

  const chartData = Object.entries(byStatus)
    .filter(([, v]) => (v as number) > 0)
    .map(([st, count]) => ({
      name: STATUS_META[st]?.label ?? st,
      value: count as number,
      color: STATUS_META[st]?.color ?? '#94a3b8',
    }))

  const pName = (id: string) => projects.find(p => p.id === id)?.name ?? id.slice(0, 8) + '…'
  const recent = (s?.recent ?? []).filter((r: any) => !activeProject || r.project_id === activeProject)

  const extractors: any[] = productivity?.extractors ?? []
  const reviewers:  any[] = productivity?.reviewers  ?? []
  const hasFlagged = reviewers.some((r: any) => r.flagged)

  return (
    <div style={{ padding: '22px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Platform overview · Updated {ts.toLocaleTimeString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#64748b',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
          <Link to="/sources"
            style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
              borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff',
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database style={{ width: 14, height: 14 }} /> All Sources
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        <KPI label="Total Sources"  value={total}         sub="across all projects"     icon={<Database style={{ width: 18, height: 18 }} />}    color="blue"   />
        <KPI label="In Progress"    value={inProgress}    sub="active work"             icon={<Activity style={{ width: 18, height: 18 }} />}    color="purple" />
        <KPI label="Approved"       value={approvedCount} sub={`${total > 0 ? Math.round(approvedCount / total * 100) : 0}% complete`}
          icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="green"
          trend={{ value: s?.approved_this_week ?? 0, label: 'this week' }} />
        <KPI label="Not Started"    value={byStatus['not_started'] ?? 0} sub="awaiting extraction"
          icon={<Clock style={{ width: 18, height: 18 }} />} color="amber" />
        <KPI label="Needs Admin ✓"  value={pendingAdmin}  sub="reviewer approved"      icon={<ShieldCheck style={{ width: 18, height: 18 }} />} color="red"    />
      </div>

      {/* Admin review alert */}
      {pendingAdmin > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 14,
          padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldCheck style={{ width: 20, height: 20, color: '#dc2626', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', margin: 0 }}>
              {pendingAdmin} source{pendingAdmin !== 1 ? 's' : ''} waiting for your final approval
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>
              Reviewer has approved — do your admin final review to mark complete
            </p>
          </div>
          <Link to="/sources"
            style={{ padding: '7px 14px', background: '#dc2626', color: '#fff',
              borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
            Review now →
          </Link>
        </div>
      )}

      {/* Fast review alert */}
      {hasFlagged && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 14,
          padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Zap style={{ width: 20, height: 20, color: '#c2410c', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#c2410c', margin: 0 }}>
              Suspiciously fast reviews detected
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>
              One or more reviewers completed records in under 90 seconds — check the Reviewers table below
            </p>
          </div>
        </div>
      )}

      {/* Chart + Per-project table */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, marginBottom: 20 }}>

        {/* Status chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>Sources by Status</p>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 14px' }}>{total} total</p>
          {chartData.length === 0
            ? <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>No data yet</div>
            : <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} barSize={16} margin={{ top: 2, right: 2, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Sources">
                    {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
          }
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10 }}>
            {chartData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 6px', borderRadius: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: d.color }} />
                  <span style={{ fontSize: 10, color: '#64748b' }}>{d.name}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-project table */}
        <SectionCard title="Projects Overview"
          sub="Click a project to filter recent activity">
          {perProject.length === 0
            ? <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No projects yet</div>
            : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Project</TH>
                      <TH align="center">Total</TH>
                      <TH align="center">Approved</TH>
                      <TH align="center">In Progress</TH>
                      <TH align="center">Not Started</TH>
                      <TH align="center">Progress</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {perProject.map((pp: any) => {
                      const pct  = pp.total > 0 ? Math.round((pp.approved / pp.total) * 100) : 0
                      const active = activeProject === pp.project_id
                      return (
                        <tr key={pp.project_id}
                          onClick={() => setActiveProject(active ? null : pp.project_id)}
                          style={{ cursor: 'pointer', background: active ? '#eff6ff' : 'transparent' }}
                          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                          <TD>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%',
                                background: pct === 100 ? '#10b981' : pct > 50 ? '#3b82f6' : '#94a3b8' }} />
                              <span style={{ fontWeight: 600 }}>{pName(pp.project_id)}</span>
                              {active && <span style={{ fontSize: 10, background: '#2563eb', color: '#fff', padding: '1px 6px', borderRadius: 20 }}>filtered</span>}
                            </div>
                          </TD>
                          <TD align="center"><span style={{ fontWeight: 700 }}>{pp.total}</span></TD>
                          <TD align="center"><span style={{ color: '#059669', fontWeight: 600 }}>{pp.approved}</span></TD>
                          <TD align="center"><span style={{ color: '#7c3aed' }}>{pp.in_progress}</span></TD>
                          <TD align="center"><span style={{ color: '#94a3b8' }}>{pp.not_started}</span></TD>
                          <TD align="center"><MiniBar value={pp.approved} max={pp.total} color={pct === 100 ? '#10b981' : '#2563eb'} /></TD>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
          }
          {activeProject && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid #f1f5f9' }}>
              <button onClick={() => setActiveProject(null)}
                style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
                ✕ Clear project filter
              </button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Productivity tables */}
      <SectionCard title="Team Productivity"
        sub="Per-person extraction and review metrics from all projects">
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 0, borderBottom: '1px solid #f1f5f9' }}>
          {(['extractors', 'reviewers'] as const).map(t => (
            <button key={t} onClick={() => setProdTab(t)}
              style={{ padding: '7px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                border: 'none', borderBottom: prodTab === t ? '2px solid #2563eb' : '2px solid transparent',
                background: 'transparent', color: prodTab === t ? '#2563eb' : '#64748b',
                marginBottom: -1 }}>
              {t === 'extractors'
                ? `⛏ Extractors (${extractors.length})`
                : `🔍 Reviewers (${reviewers.length})`}
            </button>
          ))}
        </div>

        {prodTab === 'extractors' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH>Extractor</TH>
                  <TH align="center">Sources</TH>
                  <TH align="center">Records</TH>
                  <TH align="center">Valid</TH>
                  <TH align="center">Errors</TH>
                  <TH align="center">Error Rate</TH>
                  <TH align="center">Approval Rate</TH>
                </tr>
              </thead>
              <tbody>
                {extractors.length === 0
                  ? <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>No extraction data yet</td></tr>
                  : extractors.map((e: any) => (
                    <tr key={e.user_id}
                      onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <TD>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={e.name} />
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{e.name}</p>
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{e.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="center">{e.sources_worked}</TD>
                      <TD align="center"><span style={{ fontWeight: 700, color: '#2563eb' }}>{e.total_records}</span></TD>
                      <TD align="center"><span style={{ color: '#059669', fontWeight: 600 }}>{e.valid_records}</span></TD>
                      <TD align="center">
                        <span style={{ color: e.invalid_records > 0 ? '#dc2626' : '#94a3b8', fontWeight: e.invalid_records > 0 ? 700 : 400 }}>
                          {e.invalid_records}
                        </span>
                      </TD>
                      <TD align="center">
                        <MiniBar value={e.error_rate_pct} max={100}
                          color={e.error_rate_pct > 10 ? '#ef4444' : '#10b981'} />
                      </TD>
                      <TD align="center">
                        <span style={{ fontSize: 12, fontWeight: 700,
                          color: e.approval_rate_pct >= 80 ? '#059669' : e.approval_rate_pct >= 50 ? '#d97706' : '#dc2626' }}>
                          {e.approval_rate_pct}%
                        </span>
                      </TD>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {prodTab === 'reviewers' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH>Reviewer</TH>
                  <TH align="center">Reviewed</TH>
                  <TH align="center">Approved</TH>
                  <TH align="center">Rejected</TH>
                  <TH align="center">Avg Review Time</TH>
                  <TH align="center">Fast Reviews</TH>
                  <TH align="center">Approval Rate</TH>
                </tr>
              </thead>
              <tbody>
                {reviewers.length === 0
                  ? <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>No review data yet</td></tr>
                  : reviewers.map((r: any) => (
                    <tr key={r.user_id}
                      style={{ background: r.flagged ? '#fff7ed' : 'transparent' }}
                      onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = r.flagged ? '#fed7aa30' : '#f8fafc' }}
                      onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = r.flagged ? '#fff7ed' : 'transparent' }}>
                      <TD>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={r.name} />
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{r.name}</p>
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{r.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="center"><span style={{ fontWeight: 700, color: '#7c3aed' }}>{r.total_reviewed}</span></TD>
                      <TD align="center"><span style={{ color: '#059669', fontWeight: 600 }}>{r.approved}</span></TD>
                      <TD align="center"><span style={{ color: r.rejected > 0 ? '#dc2626' : '#94a3b8' }}>{r.rejected}</span></TD>
                      <TD align="center">
                        <span style={{ fontSize: 12, fontWeight: 600,
                          color: r.avg_review_secs && r.avg_review_secs < 90 ? '#dc2626'
                            : r.avg_review_secs && r.avg_review_secs < 300 ? '#d97706' : '#059669' }}>
                          {r.avg_review_label ?? '—'}
                        </span>
                      </TD>
                      <TD align="center">
                        {r.fast_reviews > 0
                          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                              background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                              ⚡ {r.fast_reviews}
                            </span>
                          : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                        }
                      </TD>
                      <TD align="center">
                        <span style={{ fontSize: 12, fontWeight: 700,
                          color: r.approval_rate_pct >= 80 ? '#059669' : r.approval_rate_pct >= 50 ? '#d97706' : '#dc2626' }}>
                          {r.approval_rate_pct}%
                        </span>
                      </TD>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Recent Activity */}
      <SectionCard title="Recent Activity"
        sub={activeProject ? `Filtered: ${pName(activeProject)}` : 'Latest source updates across all projects'}
        action={{ label: 'View all', to: '/sources' }}>
        {recent.length === 0
          ? <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No recent activity</div>
          : <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <TH>Source</TH>
                    <TH>Project</TH>
                    <TH align="center">Status</TH>
                    <TH align="center">Records</TH>
                    <TH align="center">Valid</TH>
                    <TH>Last Updated</TH>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r: any) => (
                    <tr key={r.id}
                      onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <TD>
                        <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                          style={{ color: '#1e293b', textDecoration: 'none', fontWeight: 600 }}>
                          {r.name}
                        </Link>
                      </TD>
                      <TD><span style={{ fontSize: 11, color: '#94a3b8' }}>{pName(r.project_id)}</span></TD>
                      <TD align="center"><StatusBadge status={r.status} /></TD>
                      <TD align="center">{r.total_records ?? 0}</TD>
                      <TD align="center">
                        <span style={{ color: '#059669', fontWeight: 600 }}>{r.valid_records ?? 0}</span>
                      </TD>
                      <TD><span style={{ fontSize: 12, color: '#94a3b8' }}>{safeFromNow(r.updated_at)}</span></TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </SectionCard>
    </div>
  )
}

// ── Extractor Dashboard ────────────────────────────────────────────────────────
function ExtractorDashboard() {
  const { user }                               = useAuthStore()
  const { data: s, loading, error, load, ts, clearError } = useSummary()

  if (loading) return <Skeleton />
  if (error && !s?.my_extracting) return <ErrorState onRetry={() => { clearError(); load() }} />

  const mine       : any[] = s?.my_extracting ?? []
  const available  : any[] = s?.available     ?? []
  const needsAction        = mine.filter((r: any) => ['needs_fixes', 'changes_requested'].includes(r.status))
  const totalRecords       = s?.total_extracted ?? 0
  const totalApproved      = s?.total_ext_approved ?? 0
  const pct                = totalRecords > 0 ? Math.round((totalApproved / totalRecords) * 100) : 0

  return (
    <div style={{ padding: '22px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Your extraction workspace · {ts.toLocaleTimeString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
          <Link to="/sources"
            style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
              borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database style={{ width: 14, height: 14 }} /> All Sources
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <KPI label="My Sources"         value={mine.length}        sub="assigned to me"           icon={<Upload style={{ width: 18, height: 18 }} />}    color="blue"   />
        <KPI label="Records Uploaded"   value={totalRecords}       sub={`${pct}% reviewer-approved`} icon={<Database style={{ width: 18, height: 18 }} />} color="purple" />
        <KPI label="Needs Fixes"        value={needsAction.length} sub="errors or corrections"    icon={<AlertCircle style={{ width: 18, height: 18 }} />} color="red"    />
        <KPI label="Available to Claim" value={available.length}   sub="unclaimed sources"        icon={<Activity style={{ width: 18, height: 18 }} />}   color="green"  />
      </div>

      {needsAction.length > 0 && (
        <SectionCard title="Needs Your Attention" sub="Reviewer sent these back — fix and re-upload"
          badge={needsAction.length} badgeColor="#dc2626">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><TH>Source</TH><TH align="center">Status</TH><TH align="center">Errors</TH><TH>Updated</TH><TH> </TH></tr></thead>
              <tbody>
                {needsAction.map((r: any) => (
                  <tr key={r.id} style={{ background: '#fef2f2' }}>
                    <TD><span style={{ fontWeight: 600 }}>{r.name}</span></TD>
                    <TD align="center"><StatusBadge status={r.status} /></TD>
                    <TD align="center"><span style={{ color: '#dc2626', fontWeight: 700 }}>{r.invalid_records}</span></TD>
                    <TD><span style={{ fontSize: 12, color: '#94a3b8' }}>{safeFromNow(r.updated_at)}</span></TD>
                    <TD>
                      <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                        style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                          background: '#fef2f2', color: '#dc2626', textDecoration: 'none', border: '1px solid #fecaca' }}>
                        Fix →
                      </Link>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {available.length > 0 && (
        <SectionCard title="Available to Claim" sub="No extractor assigned — open and claim"
          badge={`${available.length} available`} badgeColor="#059669">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><TH>Source</TH><TH align="center">Records</TH><TH>Updated</TH><TH> </TH></tr></thead>
              <tbody>
                {available.slice(0, 8).map((r: any) => (
                  <tr key={r.id}
                    onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = '#f0fdf4' }}
                    onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    <TD><span style={{ fontWeight: 600 }}>{r.name}</span></TD>
                    <TD align="center">{r.total_records ?? 0}</TD>
                    <TD><span style={{ fontSize: 12, color: '#94a3b8' }}>{safeFromNow(r.updated_at)}</span></TD>
                    <TD>
                      <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                        style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                          background: '#059669', color: '#fff', textDecoration: 'none' }}>
                        Claim →
                      </Link>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="My Sources" sub="All sources assigned to you" action={{ label: 'Full board', to: '/sources' }}>
        {mine.length === 0
          ? <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              <Database style={{ width: 36, height: 36, margin: '0 auto 8px', opacity: .2 }} />
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>No sources assigned yet</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>Claim a source above or ask an admin to assign you</p>
            </div>
          : <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><TH>Source</TH><TH align="center">Status</TH><TH align="center">Total</TH><TH align="center">Valid</TH><TH align="center">Errors</TH><TH align="center">Approved</TH><TH>Updated</TH></tr></thead>
                <tbody>
                  {mine.map((r: any) => (
                    <tr key={r.id}
                      onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <TD>
                        <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                          style={{ color: '#1e293b', textDecoration: 'none', fontWeight: 600 }}>
                          {r.name}
                        </Link>
                      </TD>
                      <TD align="center"><StatusBadge status={r.status} /></TD>
                      <TD align="center">{r.total_records ?? 0}</TD>
                      <TD align="center"><span style={{ color: '#059669', fontWeight: 600 }}>{r.valid_records ?? 0}</span></TD>
                      <TD align="center"><span style={{ color: r.invalid_records > 0 ? '#ef4444' : '#94a3b8' }}>{r.invalid_records ?? 0}</span></TD>
                      <TD align="center"><span style={{ color: '#7c3aed', fontWeight: 600 }}>{r.approved_records ?? 0}</span></TD>
                      <TD><span style={{ fontSize: 12, color: '#94a3b8' }}>{safeFromNow(r.updated_at)}</span></TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </SectionCard>
    </div>
  )
}

// ── Reviewer Dashboard ────────────────────────────────────────────────────────
function ReviewerDashboard() {
  const { user }                               = useAuthStore()
  const { data: s, loading, error, load, ts, clearError } = useSummary()

  if (loading) return <Skeleton />
  if (error && !s?.my_reviewing) return <ErrorState onRetry={() => { clearError(); load() }} />

  const mine            : any[] = s?.my_reviewing         ?? []
  const approvedRecords         = s?.my_approved_records  ?? 0
  const approvedThisWeek        = s?.my_approved_this_week ?? 0
  const pendingTotal            = s?.my_pending_total     ?? 0
  const ready = mine.filter((r: any) => r.status === 'ready_for_review')
  const pct   = approvedRecords + pendingTotal > 0
    ? Math.round((approvedRecords / (approvedRecords + pendingTotal)) * 100) : 0

  return (
    <div style={{ padding: '22px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Your review workspace · {ts.toLocaleTimeString()}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
          <Link to="/sources"
            style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
              borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye style={{ width: 14, height: 14 }} /> All Sources
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <KPI label="Records Approved" value={approvedRecords}  sub="approved by you total"     icon={<CheckCircle style={{ width: 18, height: 18 }} />} color="green"  trend={{ value: approvedThisWeek, label: 'this week' }} />
        <KPI label="Pending"          value={pendingTotal}     sub="awaiting your review"      icon={<Clock style={{ width: 18, height: 18 }} />}       color="amber"  />
        <KPI label="Ready to Review"  value={ready.length}     sub="sources waiting for you"   icon={<Eye style={{ width: 18, height: 18 }} />}         color="purple" />
        <KPI label="My Sources"       value={mine.length}      sub="assigned to review"        icon={<Activity style={{ width: 18, height: 18 }} />}    color="blue"   />
      </div>

      {/* Progress bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
        padding: '16px 20px', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Your Review Progress</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>
              {approvedRecords} approved · {pendingTotal} pending across {mine.length} source{mine.length !== 1 ? 's' : ''}
            </p>
          </div>
          <p style={{ fontSize: 28, fontWeight: 800, color: '#7c3aed', margin: 0 }}>{pct}%</p>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 99, height: 10, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(90deg,#7c3aed,#6366f1)', height: '100%',
            borderRadius: 99, width: `${pct}%`, transition: 'width 0.8s ease' }} />
        </div>
      </div>

      {/* Review queue table */}
      <SectionCard title="My Review Queue" sub="Click any row to open and review"
        action={{ label: 'Full board', to: '/sources' }}>
        {mine.length === 0
          ? <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              <Eye style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: .2 }} />
              <p>No sources in your review queue yet</p>
            </div>
          : <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <TH>Source</TH>
                    <TH align="center">Status</TH>
                    <TH align="center">Total</TH>
                    <TH align="center">Approved</TH>
                    <TH align="center">Pending</TH>
                    <TH align="center">Progress</TH>
                    <TH>Updated</TH>
                    <TH> </TH>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r: any) => {
                    const tot  = r.total_records    ?? 0
                    const appr = r.approved_records ?? 0
                    const pend = r.pending_records  ?? Math.max(0, tot - appr)
                    return (
                      <tr key={r.id}
                        onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                        onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        <TD><span style={{ fontWeight: 600 }}>{r.name}</span></TD>
                        <TD align="center"><StatusBadge status={r.status} /></TD>
                        <TD align="center">{tot}</TD>
                        <TD align="center"><span style={{ color: '#059669', fontWeight: 600 }}>{appr}</span></TD>
                        <TD align="center">
                          <span style={{ color: pend > 0 ? '#dc2626' : '#94a3b8', fontWeight: pend > 0 ? 700 : 400 }}>{pend}</span>
                        </TD>
                        <TD align="center"><MiniBar value={appr} max={tot} color="#7c3aed" /></TD>
                        <TD><span style={{ fontSize: 12, color: '#94a3b8' }}>{safeFromNow(r.updated_at)}</span></TD>
                        <TD>
                          <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                            style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                              background: '#faf5ff', color: '#7c3aed', textDecoration: 'none', border: '1px solid #e9d5ff' }}>
                            Review →
                          </Link>
                        </TD>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
        }
      </SectionCard>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { user } = useAuthStore()
  if (!user) return null
  const roles     = new Set(Array.isArray(user.roles) ? user.roles : [])
  const isAdmin   = roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead')
  const isReviewer  = roles.has('reviewer')
  const isExtractor = roles.has('pipeline_operator')
  if (isAdmin)                        return <AdminDashboard />
  if (isReviewer && isExtractor)      return <AdminDashboard />
  if (isReviewer)                     return <ReviewerDashboard />
  return <ExtractorDashboard />
}
