import { BalancePanel } from '@/components/enh/BalancePanel'
import { DispatchPanel } from '@/components/enh/DispatchPanel'
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Users, AlertCircle, Clock, ArrowRight, Download } from 'lucide-react'
import { sourcesApi, projectsApi } from '@/api/client'

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:       { label: 'Not Started',       color: 'var(--tx-64748b)', bg: 'var(--bg-f1f5f9)' },
  extracting:        { label: 'Extraction',        color: 'var(--tx-3b82f6)', bg: 'var(--bg-eff6ff)' },
  needs_fixes:       { label: 'Extraction (Fixes)', color: '#f59e0b', bg: 'var(--bg-fffbeb)' },
  ready_for_review:  { label: 'Ready for Review',   color: '#6366f1', bg: 'var(--bg-eef2ff)' },
  in_review:         { label: 'Human Review',       color: 'var(--tx-a855f7)', bg: 'var(--bg-faf5ff)' },
  changes_requested: { label: 'Corrections Needed', color: 'var(--tx-ef4444)', bg: 'var(--bg-fef2f2)' },
  llm_verification:  { label: 'LLM Verification',   color: 'var(--tx-059669)', bg: 'var(--bg-ecfdf5)' },
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: 'var(--tx-64748b)', bg: 'var(--bg-f1f5f9)' }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
  )
}

// Gradient avatar, matching the pattern already used on Escalations —
// deterministic per-name colour, just upgraded from a flat fill to a
// gradient + shadow so it reads consistently with the rest of the app.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#3b82f6,#1d4ed8)', 'linear-gradient(135deg,#a855f7,#7c3aed)',
  'linear-gradient(135deg,#10b981,#047857)', 'linear-gradient(135deg,#ef4444,#b91c1c)',
  'linear-gradient(135deg,#f59e0b,#b45309)', 'linear-gradient(135deg,#06b6d4,#0e7490)',
]

function Avatar({ name }: { name: string }) {
  const grad = AVATAR_GRADIENTS[(name ?? '?').charCodeAt(0) % AVATAR_GRADIENTS.length]
  return (
    <div style={{ width: 26, height: 26, borderRadius: '50%', background: grad,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
      boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
      {(name ?? '?')[0].toUpperCase()}
    </div>
  )
}

export function TeamWorkloadPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)         // only true before the very first load
  const [refreshing, setRefreshing] = useState(false)   // true during the silent 30s poll / filter change / manual refresh
  const [projects, setProjects] = useState<any[]>([])
  const [activeProject, setActiveProject] = useState<string>('')
  const [exporting, setExporting] = useState(false)

  // The 30s poll and every filter change previously replaced the ENTIRE
  // page — KPIs, table, everything — with a bare "Loading workload…" text,
  // exactly like the Dashboard bug before its fix. Only the very first
  // load now shows that; everything after updates silently in place.
  const load = useCallback((opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    if (silent) setRefreshing(true); else setLoading(true)
    sourcesApi.workload(activeProject || undefined)
      .then(setData)
      .catch(() => { if (!silent) setData({ sources: [], by_person: [], unclaimed_count: 0, llm_verifying_count: 0 }) })
      .finally(() => { if (silent) setRefreshing(false); else setLoading(false) })
  }, [activeProject])

  useEffect(() => {
    projectsApi.list().then((r: any) => {
      setProjects(Array.isArray(r) ? r : r?.items ?? [])
    }).catch(() => {})
  }, [])

  // First mount does a real (non-silent) load; every subsequent call from
  // this same effect firing again (i.e. activeProject changing) is silent —
  // switching the filter no longer blanks the page while it refetches.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  useEffect(() => {
    load(hasLoadedOnce ? { silent: true } : undefined)
    setHasLoadedOnce(true)
    const iv = setInterval(() => load({ silent: true }), 30_000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const exportTimesheet = async () => {
    setExporting(true)
    try { await sourcesApi.exportTimesheet(activeProject || undefined) }
    finally { setExporting(false) }
  }

  const sources: any[] = data?.sources ?? []
  const byPerson: any[] = data?.by_person ?? []
  const unclaimedCount: number = data?.unclaimed_count ?? 0
  const llmVerifyingCount: number = data?.llm_verifying_count ?? 0

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25 shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx-0f172a)', margin: 0 }}>Team Workload</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              {refreshing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
              Live view of who's handling what · updates every 30s
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={activeProject} onChange={e => setActiveProject(e.target.value)}
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--bd-e2e8f0)', borderRadius: 10,
              background: 'var(--bg-fff)', color: 'var(--tx-374151)', outline: 'none' }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={exportTimesheet} disabled={exporting}
            style={{ padding: '8px 16px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10,
              cursor: exporting ? 'not-allowed' : 'pointer', fontSize: 13, color: 'var(--tx-64748b)',
              display: 'flex', alignItems: 'center', gap: 6, opacity: exporting ? .6 : 1, transition: 'all 0.15s' }}>
            <Download style={{ width: 14, height: 14 }} /> {exporting ? 'Exporting…' : 'Export Timesheet'}
          </button>
          <button onClick={() => load({ silent: true })}
            style={{ padding: '8px 16px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: 'var(--tx-64748b)', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} style={{ width: 14, height: 14 }} /> Refresh
          </button>
        </div>
      </div>

      <DispatchPanel />
      <BalancePanel />

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading workload…</div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { value: sources.length, label: 'Active Sources', icon: '📋', grad: 'linear-gradient(135deg,#6366f1,#4338ca)', accent: '#4f46e5', bg: 'var(--bg-fff)', border: 'var(--bd-e2e8f0)' },
              { value: byPerson.length, label: 'People Working', icon: '👥', grad: 'linear-gradient(135deg,#a855f7,#7c3aed)', accent: '#7c3aed', bg: 'var(--bg-fff)', border: 'var(--bd-e2e8f0)' },
              { value: llmVerifyingCount, label: 'LLM Verifying', icon: '🤖', grad: 'linear-gradient(135deg,#10b981,#047857)', accent: '#059669',
                bg: llmVerifyingCount > 0 ? 'var(--bg-ecfdf5)' : 'var(--bg-fff)', border: llmVerifyingCount > 0 ? 'var(--bd-bbf7d0)' : 'var(--bd-e2e8f0)' },
              { value: unclaimedCount, label: 'Unclaimed', icon: '⚠️', grad: 'linear-gradient(135deg,#ef4444,#b91c1c)', accent: '#dc2626',
                bg: unclaimedCount > 0 ? 'var(--bg-fef2f2)' : 'var(--bg-fff)', border: unclaimedCount > 0 ? 'var(--bd-fecaca)' : 'var(--bd-e2e8f0)' },
            ].map(({ value, label, icon, grad, accent, bg, border }) => (
              <div key={label} style={{ position: 'relative', background: bg, border: `1px solid ${border}`,
                borderRadius: 14, padding: '16px 18px', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: grad }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: grad, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>{icon}</div>
                  <p style={{ fontSize: 24, fontWeight: 800, color: accent, margin: 0, lineHeight: 1 }}>{value}</p>
                </div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-64748b)', margin: '4px 0 0' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Per-person summary */}
          {byPerson.length > 0 && (
            <div style={{ background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 16,
              padding: '16px 20px', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-0f172a)', margin: '0 0 12px' }}>Currently Assigned</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {byPerson.map((p: any) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', background: 'var(--bg-f8fafc)', border: '1px solid var(--bd-f1f5f9)', borderRadius: 20 }}>
                    <Avatar name={p.name} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1e293b)' }}>{p.name}</span>
                    {p.extracting > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-2563eb)', background: 'var(--bg-eff6ff)',
                        padding: '2px 6px', borderRadius: 20 }}>⛏ {p.extracting}</span>
                    )}
                    {p.reviewing > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-7c3aed)', background: 'var(--bg-faf5ff)',
                        padding: '2px 6px', borderRadius: 20 }}>🔍 {p.reviewing}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unclaimed alert */}
          {unclaimedCount > 0 && (
            <div style={{ position: 'relative', background: 'var(--bg-fff)', border: '1px solid var(--bd-fecaca)', borderRadius: 14,
              padding: '12px 18px 12px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#ef4444,#b91c1c)' }} />
              <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#ef4444,#b91c1c)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertCircle style={{ width: 14, height: 14, color: '#fff' }} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--tx-7f1d1d)', margin: 0 }}>
                <strong>{unclaimedCount}</strong> source{unclaimedCount !== 1 ? 's have' : ' has'} no extractor assigned yet
              </p>
            </div>
          )}

          {/* Main table */}
          <div style={{ background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 16,
            overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-f8fafc)', borderBottom: '2px solid var(--bd-e2e8f0)' }}>
                  {['Source', 'Project', 'Status', 'Extractor', 'Time', 'Reviewer', 'Time', 'Progress', ''].map((h, hi) => (
                    <th key={hi} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                      color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    Nothing in progress — every source is delivered 🎉
                  </td></tr>
                ) : sources.map((s: any) => (
                  <tr key={s.source_id}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-f8fafc)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    style={{ borderBottom: '1px solid var(--bd-f8fafc)', transition: 'background 0.12s' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1e293b)' }}>{s.source_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{s.project_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}><StatusBadge status={s.status} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.extractor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Avatar name={s.extractor} />
                          <span style={{ fontSize: 12, color: 'var(--tx-1e293b)' }}>{s.extractor}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-dc2626)', background: 'var(--bg-fef2f2)',
                          padding: '2px 8px', borderRadius: 20 }}>Unclaimed</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.llm_verifying ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-059669)', background: 'var(--bg-ecfdf5)',
                          padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          🤖 LLM {s.llm_elapsed}
                        </span>
                      ) : s.on_hold ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-6b7280)', background: 'var(--bg-f3f4f6)', padding: '2px 8px', borderRadius: 20 }}>On hold</span>
                      ) : s.extractor_elapsed && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3b82f6)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock style={{ width: 11, height: 11 }} /> {s.extractor_elapsed}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.reviewers?.length ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ display: 'flex' }}>
                            {s.reviewers.slice(0, 3).map((n: string, i: number) => (
                              <span key={n} title={n} style={{ marginLeft: i ? -7 : 0, borderRadius: '50%', boxShadow: '0 0 0 2px #fff' }}><Avatar name={n} /></span>
                            ))}
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--tx-1e293b)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={s.reviewers.join(', ')}>
                            {s.reviewers.length === 1 ? s.reviewers[0] : `${s.reviewers.length} peers`}
                          </span>
                          {s.peers_total > 0 && (
                            <span title="Peer reviewers who have submitted" style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                              color: s.peers_submitted === s.peers_total ? 'var(--tx-047857)' : '#6366f1',
                              background: s.peers_submitted === s.peers_total ? 'var(--bg-ecfdf5)' : 'var(--bg-eef2ff)' }}>
                              {s.peers_submitted}/{s.peers_total}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.reviewer_elapsed ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-7c3aed)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock style={{ width: 11, height: 11 }} /> {s.reviewer_elapsed}
                        </span>
                      ) : s.waiting_elapsed && (
                        <span title="No reviewer has opened this yet — time since it became ready"
                          style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-d97706)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock style={{ width: 11, height: 11 }} /> waiting {s.waiting_elapsed}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, color: 'var(--tx-64748b)' }}>
                        {s.approved_records}/{s.total_records}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <Link to={`/projects/${s.project_id}/sources/${s.source_id}`}
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-2563eb)', textDecoration: 'none',
                          display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                        Open <ArrowRight style={{ width: 11, height: 11 }} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
