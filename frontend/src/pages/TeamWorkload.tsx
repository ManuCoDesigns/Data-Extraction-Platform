import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Users, AlertCircle, Clock, ArrowRight, Download } from 'lucide-react'
import { sourcesApi, projectsApi } from '@/api/client'

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started:       { label: 'Not Started',       color: '#64748b', bg: '#f1f5f9' },
  extracting:        { label: 'Extracting',        color: '#3b82f6', bg: '#eff6ff' },
  needs_fixes:       { label: 'Needs Fixes',        color: '#f59e0b', bg: '#fffbeb' },
  ready_for_review:  { label: 'Ready for Review',   color: '#6366f1', bg: '#eef2ff' },
  in_review:         { label: 'In Review',          color: '#a855f7', bg: '#faf5ff' },
  changes_requested: { label: 'Corrections Needed', color: '#ef4444', bg: '#fef2f2' },
  llm_verification:  { label: 'LLM Check',          color: '#a855f7', bg: '#faf5ff' },
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9' }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
  )
}

function Avatar({ name }: { name: string }) {
  const colors = ['#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706', '#0891b2']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{ width: 26, height: 26, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {(name ?? '?')[0].toUpperCase()}
    </div>
  )
}

export function TeamWorkloadPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<any[]>([])
  const [activeProject, setActiveProject] = useState<string>('')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    sourcesApi.workload(activeProject || undefined)
      .then(setData)
      .catch(() => setData({ sources: [], by_person: [], unclaimed_count: 0 }))
      .finally(() => setLoading(false))
  }, [activeProject])

  useEffect(() => {
    projectsApi.list().then((r: any) => {
      setProjects(Array.isArray(r) ? r : r?.items ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [load])

  const exportTimesheet = async () => {
    setExporting(true)
    try { await sourcesApi.exportTimesheet(activeProject || undefined) }
    finally { setExporting(false) }
  }

  const sources: any[] = data?.sources ?? []
  const byPerson: any[] = data?.by_person ?? []
  const unclaimedCount: number = data?.unclaimed_count ?? 0

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Workload</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Live view of who's handling what · updates every 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={activeProject} onChange={e => setActiveProject(e.target.value)}
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 10,
              background: '#fff', color: '#374151', outline: 'none' }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={exportTimesheet} disabled={exporting}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              cursor: exporting ? 'not-allowed' : 'pointer', fontSize: 13, color: '#64748b',
              display: 'flex', alignItems: 'center', gap: 6, opacity: exporting ? .6 : 1 }}>
            <Download style={{ width: 14, height: 14 }} /> {exporting ? 'Exporting…' : 'Export Timesheet'}
          </button>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading workload…</div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px' }}>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>{sources.length}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', margin: '4px 0 0' }}>Active Sources</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px' }}>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#7c3aed', margin: 0 }}>{byPerson.length}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', margin: '4px 0 0' }}>People Working</p>
            </div>
            <div style={{ background: unclaimedCount > 0 ? '#fef2f2' : '#fff',
              border: `1px solid ${unclaimedCount > 0 ? '#fecaca' : '#e2e8f0'}`, borderRadius: 14, padding: '16px 18px' }}>
              <p style={{ fontSize: 24, fontWeight: 800, color: unclaimedCount > 0 ? '#dc2626' : '#0f172a', margin: 0 }}>{unclaimedCount}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: unclaimedCount > 0 ? '#dc2626' : '#64748b', margin: '4px 0 0' }}>Unclaimed</p>
            </div>
          </div>

          {/* Per-person summary */}
          {byPerson.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
              padding: '16px 20px', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>Currently Assigned</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {byPerson.map((p: any) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 20 }}>
                    <Avatar name={p.name} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{p.name}</span>
                    {p.extracting > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', background: '#eff6ff',
                        padding: '2px 6px', borderRadius: 20 }}>⛏ {p.extracting}</span>
                    )}
                    {p.reviewing > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#faf5ff',
                        padding: '2px 6px', borderRadius: 20 }}>🔍 {p.reviewing}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unclaimed alert */}
          {unclaimedCount > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 14,
              padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertCircle style={{ width: 18, height: 18, color: '#dc2626', flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>
                <strong>{unclaimedCount}</strong> source{unclaimedCount !== 1 ? 's have' : ' has'} no extractor assigned yet
              </p>
            </div>
          )}

          {/* Main table */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
            overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Source', 'Project', 'Status', 'Extractor', 'Time', 'Reviewer', 'Time', 'Progress', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
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
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{s.source_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{s.project_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}><StatusBadge status={s.status} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.extractor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Avatar name={s.extractor} />
                          <span style={{ fontSize: 12, color: '#1e293b' }}>{s.extractor}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2',
                          padding: '2px 8px', borderRadius: 20 }}>Unclaimed</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.extractor_elapsed && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock style={{ width: 11, height: 11 }} /> {s.extractor_elapsed}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.reviewer ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Avatar name={s.reviewer} />
                          <span style={{ fontSize: 12, color: '#1e293b' }}>{s.reviewer}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.reviewer_elapsed && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock style={{ width: 11, height: 11 }} /> {s.reviewer_elapsed}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        {s.approved_records}/{s.total_records}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <Link to={`/projects/${s.project_id}/sources/${s.source_id}`}
                        style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textDecoration: 'none',
                          display: 'flex', alignItems: 'center', gap: 3 }}>
                        Open <ArrowRight style={{ width: 11, height: 11 }} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
