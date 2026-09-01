import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, CheckCircle, AlertCircle, Upload, Eye, ArrowRight,
  Activity, Clock, RefreshCw, ShieldCheck, Zap,
} from 'lucide-react'
import { statsApi, projectsApi } from '@/api/client'
import { Card, Badge, Avatar, Button, Skeleton as UiSkeleton, safeFromNow, cn } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Matches the variant union Badge actually accepts (ui/index.tsx doesn't
// export BadgeProps, so this is kept in sync manually — green/amber/red/
// blue/gray/purple/indigo, the same seven Badge supports).
type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple' | 'indigo'

// Maps every source status onto the shared Badge's variant set (green /
// amber / red / blue / gray / purple / indigo) plus the hex it should use
// in the recharts bar chart, so the chart and the badges are always
// perfectly in sync — one source of truth instead of two color tables.
const STATUS_META: Record<string, { label: string; variant: BadgeVariant; chartColor: string }> = {
  not_started:       { label: 'Not Started',       variant: 'gray',   chartColor: '#94a3b8' },
  extracting:        { label: 'Extracting',        variant: 'blue',  chartColor: '#3b82f6' },
  needs_fixes:       { label: 'Needs Fixes',        variant: 'amber',  chartColor: '#f59e0b' },
  ready_for_review:  { label: 'Ready for Review',   variant: 'indigo', chartColor: '#6366f1' },
  in_review:         { label: 'In Review',          variant: 'purple', chartColor: '#a855f7' },
  changes_requested: { label: 'Corrections Needed', variant: 'red',   chartColor: '#ef4444' },
  llm_verification:  { label: 'LLM Check',          variant: 'purple', chartColor: '#a855f7' },
  approved:          { label: 'Approved',           variant: 'green', chartColor: '#10b981' },
}

// ── Shared local components (thin wrappers over the design system) ───────────

function KPI({ label, value, sub, icon, color, trend }: {
  label: string; value: number | string; sub: string
  icon: React.ReactNode; color: 'blue' | 'purple' | 'green' | 'red' | 'amber' | 'indigo'
  trend?: { value: number; label: string }
}) {
  const tones: Record<string, { grad: string; ring: string; text: string; accent: string }> = {
    blue:   { grad: 'from-blue-500 to-blue-600',       ring: 'shadow-blue-500/25',   text: 'text-blue-700',    accent: 'bg-blue-500' },
    purple: { grad: 'from-purple-500 to-purple-600',   ring: 'shadow-purple-500/25', text: 'text-purple-700',  accent: 'bg-purple-500' },
    green:  { grad: 'from-emerald-500 to-emerald-600', ring: 'shadow-emerald-500/25',text: 'text-emerald-700', accent: 'bg-emerald-500' },
    red:    { grad: 'from-red-500 to-rose-600',        ring: 'shadow-red-500/25',    text: 'text-red-700',     accent: 'bg-red-500' },
    amber:  { grad: 'from-amber-500 to-orange-600',    ring: 'shadow-amber-500/25',  text: 'text-amber-700',   accent: 'bg-amber-500' },
    indigo: { grad: 'from-brand-500 to-brand-700',     ring: 'shadow-brand-500/25',  text: 'text-brand-700',   accent: 'bg-brand-600' },
  }
  const t = tones[color] ?? tones.indigo
  return (
    <div className={cn(
      'relative bg-white rounded-2xl border border-gray-100 p-4 overflow-hidden group',
      'shadow-card hover:shadow-float hover:-translate-y-0.5 transition-all duration-200'
    )}>
      <div className={cn('absolute top-0 left-0 right-0 h-1', t.accent)} />
      <div className="flex items-center justify-between mb-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br shadow-lg', t.grad, t.ring)}>
          {icon}
        </div>
        {trend && trend.value > 0 && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full flex items-center gap-0.5">
            ↑ {trend.value} {trend.label}
          </span>
        )}
      </div>
      <p className="text-[28px] font-extrabold text-gray-900 leading-none tracking-tight tabular-nums">{value}</p>
      <p className={cn('text-xs font-bold mt-1.5', t.text)}>{label}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status]
  if (!m) return <span className="text-xs text-gray-400">{status}</span>
  return <Badge variant={m.variant}>{m.label}</Badge>
}

function SectionCard({ title, sub, badge, badgeVariant = 'blue', action, children }: {
  title: string; sub?: string; badge?: string | number; badgeVariant?: BadgeVariant
  action?: { label: string; to: string }; children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden mb-5">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <div className="flex items-center gap-2">
          {badge !== undefined && <Badge variant={badgeVariant}>{badge}</Badge>}
          {action && (
            <Link to={action.to} className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1">
              {action.label} <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </Card>
  )
}

function TH({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th className={cn('px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap bg-gray-50 border-b-2 border-gray-100',
      align === 'center' && 'text-center', align === 'right' && 'text-right', align === 'left' && 'text-left')}>
      {children}
    </th>
  )
}

function TD({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <td className={cn('px-4 py-3 border-b border-gray-50 text-sm text-gray-800 align-middle',
      align === 'center' && 'text-center', align === 'right' && 'text-right', align === 'left' && 'text-left')}>
      {children}
    </td>
  )
}

function MiniBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'green' | 'red' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const bar = tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : 'bg-brand-600'
  const text = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-brand-600'
  return (
    <div className="flex items-center gap-2">
      <div className="bg-gray-100 rounded-full h-1.5 w-14 overflow-hidden shrink-0">
        <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-semibold', text)}>{pct}%</span>
    </div>
  )
}

function DashSkeleton() {
  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      <UiSkeleton className="w-40 h-6 mb-6" />
      <div className="space-y-4">
        <UiSkeleton className="h-24" />
        <UiSkeleton className="h-20" />
        <UiSkeleton className="h-56" />
        <UiSkeleton className="h-44" />
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-7 py-20 max-w-[1200px] mx-auto text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <p className="text-base font-semibold text-gray-800 mb-2">Dashboard failed to load</p>
      <p className="text-sm text-gray-400 mb-6">The server may be waking up — this usually takes 30–60 seconds on first load</p>
      <Button onClick={onRetry}>Retry</Button>
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

// ── Reusable header bar (greeting + refresh + primary CTA) ───────────────────
function DashboardHeader({ subtitle, ctaLabel, ctaTo, ctaIcon, onRefresh }: {
  subtitle: string; ctaLabel: string; ctaTo: string; ctaIcon: React.ReactNode; onRefresh: () => void
}) {
  const { user } = useAuthStore()
  return (
    <div className="relative rounded-2xl overflow-hidden mb-6 shadow-float">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-purple-800" />
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'radial-gradient(circle at 15% 20%, white 0%, transparent 35%), radial-gradient(circle at 85% 80%, white 0%, transparent 40%)' }} />
      <div className="relative px-7 py-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold text-white tracking-tight">
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p className="text-[13px] text-white/70 mt-1.5 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            {subtitle}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh}
            className="px-3.5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm text-white font-medium flex items-center gap-2 transition backdrop-blur-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link to={ctaTo}
            className="px-3.5 py-2 bg-white text-brand-700 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
            {ctaIcon} {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard() {
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

  if (loading) return <DashSkeleton />
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
      color: STATUS_META[st]?.chartColor ?? '#94a3b8',
    }))

  const pName = (id: string) => projects.find(p => p.id === id)?.name ?? id.slice(0, 8) + '…'
  const recent = (s?.recent ?? []).filter((r: any) => !activeProject || r.project_id === activeProject)

  const extractors: any[] = productivity?.extractors ?? []
  const reviewers:  any[] = productivity?.reviewers  ?? []
  const hasFlagged = reviewers.some((r: any) => r.flagged)

  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      <DashboardHeader
        subtitle={`Platform overview · Updated ${ts.toLocaleTimeString()}`}
        ctaLabel="All Sources" ctaTo="/sources" ctaIcon={<Database className="w-3.5 h-3.5" />}
        onRefresh={load}
      />

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <KPI label="Total Sources" value={total} sub="across all projects" icon={<Database className="w-[18px] h-[18px]" />} color="blue" />
        <KPI label="In Progress" value={inProgress} sub="active work" icon={<Activity className="w-[18px] h-[18px]" />} color="purple" />
        <KPI label="Approved" value={approvedCount} sub={`${total > 0 ? Math.round(approvedCount / total * 100) : 0}% complete`}
          icon={<CheckCircle className="w-[18px] h-[18px]" />} color="green"
          trend={{ value: s?.approved_this_week ?? 0, label: 'this week' }} />
        <KPI label="Not Started" value={byStatus['not_started'] ?? 0} sub="awaiting extraction" icon={<Clock className="w-[18px] h-[18px]" />} color="amber" />
        <KPI label="Needs Admin ✓" value={pendingAdmin} sub="reviewer approved" icon={<ShieldCheck className="w-[18px] h-[18px]" />} color="red" />
      </div>

      {/* Admin review alert */}
      {pendingAdmin > 0 && (
        <div className="relative bg-white border border-red-100 rounded-2xl pl-5 pr-5 py-4 mb-5 flex items-center gap-4 shadow-card overflow-hidden">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-gradient-to-b from-red-500 to-rose-600" />
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/25 shrink-0">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">
              {pendingAdmin} source{pendingAdmin !== 1 ? 's' : ''} waiting for your final approval
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Reviewer has approved — do your admin final review to mark complete</p>
          </div>
          <Link to="/sources">
            <Button size="sm" variant="danger">Review now →</Button>
          </Link>
        </div>
      )}

      {/* Fast review alert */}
      {hasFlagged && (
        <div className="relative bg-white border border-amber-100 rounded-2xl pl-5 pr-5 py-4 mb-5 flex items-center gap-4 shadow-card overflow-hidden">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-gradient-to-b from-amber-400 to-orange-600" />
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25 shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Suspiciously fast reviews detected</p>
            <p className="text-xs text-gray-400 mt-0.5">One or more reviewers completed records in under 90 seconds — check the Reviewers table below</p>
          </div>
        </div>
      )}

      {/* Chart + Per-project table */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: '340px 1fr' }}>
        <Card className="p-5">
          <p className="text-sm font-bold text-gray-900 mb-1">Sources by Status</p>
          <p className="text-[11px] text-gray-400 mb-3.5">{total} total</p>
          {chartData.length === 0
            ? <div className="h-40 flex items-center justify-center text-gray-400 text-xs">No data yet</div>
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
          <div className="flex flex-col gap-1 mt-2.5">
            {chartData.map(d => (
              <div key={d.name} className="flex items-center justify-between px-1.5 py-0.5 rounded-md">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-sm" style={{ background: d.color }} />
                  <span className="text-[10px] text-gray-500">{d.name}</span>
                </div>
                <span className="text-[11px] font-bold" style={{ color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <SectionCard title="Projects Overview" sub="Click a project to filter recent activity">
          {perProject.length === 0
            ? <div className="p-8 text-center text-gray-400 text-sm">No projects yet</div>
            : <div className="overflow-x-auto">
                <table className="w-full border-collapse">
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
                          className={cn('cursor-pointer transition', active ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                          <TD>
                            <div className="flex items-center gap-2">
                              <div className={cn('w-2 h-2 rounded-full', pct === 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-500' : 'bg-gray-300')} />
                              <span className="font-semibold">{pName(pp.project_id)}</span>
                              {active && <Badge variant="indigo">filtered</Badge>}
                            </div>
                          </TD>
                          <TD align="center"><span className="font-bold">{pp.total}</span></TD>
                          <TD align="center"><span className="text-emerald-600 font-semibold">{pp.approved}</span></TD>
                          <TD align="center"><span className="text-purple-600">{pp.in_progress}</span></TD>
                          <TD align="center"><span className="text-gray-400">{pp.not_started}</span></TD>
                          <TD align="center"><MiniBar value={pp.approved} max={pp.total} tone={pct === 100 ? 'green' : 'brand'} /></TD>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
          }
          {activeProject && (
            <div className="px-4 py-2 border-t border-gray-100">
              <button onClick={() => setActiveProject(null)} className="text-xs text-brand-600 hover:text-brand-700">
                ✕ Clear project filter
              </button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Productivity tables */}
      <SectionCard title="Team Productivity" sub="Per-person extraction and review metrics from all projects">
        <div className="px-4 pt-3 flex border-b border-gray-100">
          {(['extractors', 'reviewers'] as const).map(t => (
            <button key={t} onClick={() => setProdTab(t)}
              className={cn('px-4.5 py-1.5 text-sm font-medium border-b-2 -mb-px transition',
                prodTab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t === 'extractors' ? `⛏ Extractors (${extractors.length})` : `🔍 Reviewers (${reviewers.length})`}
            </button>
          ))}
        </div>

        {prodTab === 'extractors' && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TH>Extractor</TH><TH align="center">Sources</TH><TH align="center">Records</TH>
                  <TH align="center">Valid</TH><TH align="center">Errors</TH><TH align="center">Error Rate</TH><TH align="center">Approval Rate</TH>
                </tr>
              </thead>
              <tbody>
                {extractors.length === 0
                  ? <tr><td colSpan={7} className="p-8 text-center text-gray-400">No extraction data yet</td></tr>
                  : extractors.map((e: any) => (
                    <tr key={e.user_id} className="hover:bg-gray-50 transition">
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={e.name} size="sm" />
                          <div>
                            <p className="text-sm font-semibold m-0">{e.name}</p>
                            <p className="text-[11px] text-gray-400 m-0">{e.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="center">{e.sources_worked}</TD>
                      <TD align="center"><span className="font-bold text-brand-600">{e.total_records}</span></TD>
                      <TD align="center"><span className="text-emerald-600 font-semibold">{e.valid_records}</span></TD>
                      <TD align="center">
                        <span className={cn(e.invalid_records > 0 ? 'text-red-600 font-bold' : 'text-gray-400')}>{e.invalid_records}</span>
                      </TD>
                      <TD align="center"><MiniBar value={e.error_rate_pct} max={100} tone={e.error_rate_pct > 10 ? 'red' : 'green'} /></TD>
                      <TD align="center">
                        <span className={cn('text-xs font-bold',
                          e.approval_rate_pct >= 80 ? 'text-emerald-600' : e.approval_rate_pct >= 50 ? 'text-amber-600' : 'text-red-600')}>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TH>Reviewer</TH><TH align="center">Reviewed</TH><TH align="center">Approved</TH>
                  <TH align="center">Rejected</TH><TH align="center">Avg Review Time</TH><TH align="center">Fast Reviews</TH><TH align="center">Approval Rate</TH>
                </tr>
              </thead>
              <tbody>
                {reviewers.length === 0
                  ? <tr><td colSpan={7} className="p-8 text-center text-gray-400">No review data yet</td></tr>
                  : reviewers.map((r: any) => (
                    <tr key={r.user_id} className={cn('transition', r.flagged ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50')}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={r.name} size="sm" />
                          <div>
                            <p className="text-sm font-semibold m-0">{r.name}</p>
                            <p className="text-[11px] text-gray-400 m-0">{r.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="center"><span className="font-bold text-purple-600">{r.total_reviewed}</span></TD>
                      <TD align="center"><span className="text-emerald-600 font-semibold">{r.approved}</span></TD>
                      <TD align="center"><span className={cn(r.rejected > 0 ? 'text-red-600' : 'text-gray-400')}>{r.rejected}</span></TD>
                      <TD align="center">
                        <span className={cn('text-xs font-semibold',
                          r.avg_review_secs && r.avg_review_secs < 90 ? 'text-red-600'
                            : r.avg_review_secs && r.avg_review_secs < 300 ? 'text-amber-600' : 'text-emerald-600')}>
                          {r.avg_review_label ?? '—'}
                        </span>
                      </TD>
                      <TD align="center">
                        {r.fast_reviews > 0 ? <Badge variant="red">⚡ {r.fast_reviews}</Badge> : <span className="text-xs text-gray-400">—</span>}
                      </TD>
                      <TD align="center">
                        <span className={cn('text-xs font-bold',
                          r.approval_rate_pct >= 80 ? 'text-emerald-600' : r.approval_rate_pct >= 50 ? 'text-amber-600' : 'text-red-600')}>
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
          ? <div className="p-10 text-center text-gray-400 text-sm">No recent activity</div>
          : <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr><TH>Source</TH><TH>Project</TH><TH align="center">Status</TH><TH align="center">Records</TH><TH align="center">Valid</TH><TH>Last Updated</TH></tr>
                </thead>
                <tbody>
                  {recent.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <TD>
                        <Link to={`/projects/${r.project_id}/sources/${r.id}`} className="text-gray-800 font-semibold hover:text-brand-600">
                          {r.name}
                        </Link>
                      </TD>
                      <TD><span className="text-[11px] text-gray-400">{pName(r.project_id)}</span></TD>
                      <TD align="center"><StatusBadge status={r.status} /></TD>
                      <TD align="center">{r.total_records ?? 0}</TD>
                      <TD align="center"><span className="text-emerald-600 font-semibold">{r.valid_records ?? 0}</span></TD>
                      <TD><span className="text-xs text-gray-400">{safeFromNow(r.updated_at)}</span></TD>
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
  const { data: s, loading, error, load, ts, clearError } = useSummary()

  if (loading) return <DashSkeleton />
  if (error && !s?.my_extracting) return <ErrorState onRetry={() => { clearError(); load() }} />

  const mine       : any[] = s?.my_extracting ?? []
  const available  : any[] = s?.available     ?? []
  const needsAction        = mine.filter((r: any) => ['needs_fixes', 'changes_requested'].includes(r.status))
  const totalRecords       = s?.total_extracted ?? 0
  const totalApproved      = s?.total_ext_approved ?? 0
  const pct                = totalRecords > 0 ? Math.round((totalApproved / totalRecords) * 100) : 0

  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      <DashboardHeader
        subtitle={`Your extraction workspace · ${ts.toLocaleTimeString()}`}
        ctaLabel="All Sources" ctaTo="/sources" ctaIcon={<Database className="w-3.5 h-3.5" />}
        onRefresh={load}
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="My Sources" value={mine.length} sub="assigned to me" icon={<Upload className="w-[18px] h-[18px]" />} color="blue" />
        <KPI label="Records Uploaded" value={totalRecords} sub={`${pct}% reviewer-approved`} icon={<Database className="w-[18px] h-[18px]" />} color="purple" />
        <KPI label="Needs Fixes" value={needsAction.length} sub="errors or corrections" icon={<AlertCircle className="w-[18px] h-[18px]" />} color="red" />
        <KPI label="Available to Claim" value={available.length} sub="unclaimed sources" icon={<Activity className="w-[18px] h-[18px]" />} color="green" />
      </div>

      {needsAction.length > 0 && (
        <SectionCard title="Needs Your Attention" sub="Reviewer sent these back — fix and re-upload" badge={needsAction.length} badgeVariant="red">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><TH>Source</TH><TH align="center">Status</TH><TH align="center">Errors</TH><TH>Updated</TH><TH> </TH></tr></thead>
              <tbody>
                {needsAction.map((r: any) => (
                  <tr key={r.id} className="bg-red-50/60">
                    <TD><span className="font-semibold">{r.name}</span></TD>
                    <TD align="center"><StatusBadge status={r.status} /></TD>
                    <TD align="center"><span className="text-red-600 font-bold">{r.invalid_records}</span></TD>
                    <TD><span className="text-xs text-gray-400">{safeFromNow(r.updated_at)}</span></TD>
                    <TD>
                      <Link to={`/projects/${r.project_id}/sources/${r.id}`}>
                        <Button size="xs" variant="danger">Fix →</Button>
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
        <SectionCard title="Available to Claim" sub="No extractor assigned — open and claim" badge={`${available.length} available`} badgeVariant="green">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><TH>Source</TH><TH align="center">Records</TH><TH>Updated</TH><TH> </TH></tr></thead>
              <tbody>
                {available.slice(0, 8).map((r: any) => (
                  <tr key={r.id} className="hover:bg-emerald-50/40 transition">
                    <TD><span className="font-semibold">{r.name}</span></TD>
                    <TD align="center">{r.total_records ?? 0}</TD>
                    <TD><span className="text-xs text-gray-400">{safeFromNow(r.updated_at)}</span></TD>
                    <TD>
                      <Link to={`/projects/${r.project_id}/sources/${r.id}`}>
                        <Button size="xs" variant="success">Claim →</Button>
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
          ? <div className="p-12 text-center text-gray-400">
              <Database className="w-9 h-9 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-semibold">No sources assigned yet</p>
              <p className="text-xs mt-1">Claim a source above or ask an admin to assign you</p>
            </div>
          : <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr><TH>Source</TH><TH align="center">Status</TH><TH align="center">Total</TH><TH align="center">Valid</TH><TH align="center">Errors</TH><TH align="center">Approved</TH><TH>Updated</TH></tr></thead>
                <tbody>
                  {mine.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <TD>
                        <Link to={`/projects/${r.project_id}/sources/${r.id}`} className="text-gray-800 font-semibold hover:text-brand-600">
                          {r.name}
                        </Link>
                      </TD>
                      <TD align="center"><StatusBadge status={r.status} /></TD>
                      <TD align="center">{r.total_records ?? 0}</TD>
                      <TD align="center"><span className="text-emerald-600 font-semibold">{r.valid_records ?? 0}</span></TD>
                      <TD align="center"><span className={cn(r.invalid_records > 0 ? 'text-red-500' : 'text-gray-400')}>{r.invalid_records ?? 0}</span></TD>
                      <TD align="center"><span className="text-purple-600 font-semibold">{r.approved_records ?? 0}</span></TD>
                      <TD><span className="text-xs text-gray-400">{safeFromNow(r.updated_at)}</span></TD>
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
  const { data: s, loading, error, load, ts, clearError } = useSummary()

  if (loading) return <DashSkeleton />
  if (error && !s?.my_reviewing) return <ErrorState onRetry={() => { clearError(); load() }} />

  const mine            : any[] = s?.my_reviewing         ?? []
  const approvedRecords         = s?.my_approved_records  ?? 0
  const approvedThisWeek        = s?.my_approved_this_week ?? 0
  const pendingTotal            = s?.my_pending_total     ?? 0
  const ready = mine.filter((r: any) => r.status === 'ready_for_review')
  const pct   = approvedRecords + pendingTotal > 0
    ? Math.round((approvedRecords / (approvedRecords + pendingTotal)) * 100) : 0

  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      <DashboardHeader
        subtitle={`Your review workspace · ${ts.toLocaleTimeString()}`}
        ctaLabel="All Sources" ctaTo="/sources" ctaIcon={<Eye className="w-3.5 h-3.5" />}
        onRefresh={load}
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="Records Approved" value={approvedRecords} sub="approved by you total" icon={<CheckCircle className="w-[18px] h-[18px]" />} color="green" trend={{ value: approvedThisWeek, label: 'this week' }} />
        <KPI label="Pending" value={pendingTotal} sub="awaiting your review" icon={<Clock className="w-[18px] h-[18px]" />} color="amber" />
        <KPI label="Ready to Review" value={ready.length} sub="sources waiting for you" icon={<Eye className="w-[18px] h-[18px]" />} color="purple" />
        <KPI label="My Sources" value={mine.length} sub="assigned to review" icon={<Activity className="w-[18px] h-[18px]" />} color="blue" />
      </div>

      {/* Progress card */}
      <div className="relative bg-white rounded-2xl border border-gray-100 p-5 mb-5 shadow-card overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-brand-600" />
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-gray-900">Your Review Progress</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {approvedRecords} approved · {pendingTotal} pending across {mine.length} source{mine.length !== 1 ? 's' : ''}
            </p>
          </div>
          <p className="text-[32px] font-extrabold leading-none tabular-nums bg-gradient-to-br from-purple-600 to-brand-600 bg-clip-text text-transparent">{pct}%</p>
        </div>
        <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7c3aed,#6366f1)' }} />
        </div>
      </div>

      <SectionCard title="My Review Queue" sub="Click any row to open and review" action={{ label: 'Full board', to: '/sources' }}>
        {mine.length === 0
          ? <div className="p-10 text-center text-gray-400">
              <Eye className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>No sources in your review queue yet</p>
            </div>
          : <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Source</TH><TH align="center">Status</TH><TH align="center">Total</TH>
                    <TH align="center">Approved</TH><TH align="center">Pending</TH><TH align="center">Progress</TH><TH>Updated</TH><TH> </TH>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r: any) => {
                    const tot  = r.total_records    ?? 0
                    const appr = r.approved_records ?? 0
                    const pend = r.pending_records  ?? Math.max(0, tot - appr)
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 transition">
                        <TD><span className="font-semibold">{r.name}</span></TD>
                        <TD align="center"><StatusBadge status={r.status} /></TD>
                        <TD align="center">{tot}</TD>
                        <TD align="center"><span className="text-emerald-600 font-semibold">{appr}</span></TD>
                        <TD align="center"><span className={cn(pend > 0 ? 'text-red-600 font-bold' : 'text-gray-400')}>{pend}</span></TD>
                        <TD align="center"><MiniBar value={appr} max={tot} tone="brand" /></TD>
                        <TD><span className="text-xs text-gray-400">{safeFromNow(r.updated_at)}</span></TD>
                        <TD>
                          <Link to={`/projects/${r.project_id}/sources/${r.id}`}
                            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100 transition">
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
