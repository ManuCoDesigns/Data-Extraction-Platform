import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw, MessageSquare, ArrowRight, Clock } from 'lucide-react'
import { sourcesApi } from '@/api/client'

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function Avatar({ name }: { name: string }) {
  const colors = ['#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706', '#0891b2']
  const color = colors[(name || '?').charCodeAt(0) % colors.length]
  return (
    <div style={{ width: 30, height: 30, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

export function EscalationsPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    sourcesApi.escalations(!showAll)
      .then(setData)
      .catch(() => setData({ escalations: [], count: 0 }))
      .finally(() => setLoading(false))
  }, [showAll])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [load])

  const escalations: any[] = data?.escalations ?? []

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle style={{ width: 22, height: 22, color: '#dc2626' }} />
            Escalations
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Records sent back with feedback — needs your attention
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAll(s => !s)}
            style={{ padding: '8px 16px', background: showAll ? '#eff6ff' : '#fff',
              border: `1px solid ${showAll ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: showAll ? '#2563eb' : '#64748b', fontWeight: 600 }}>
            {showAll ? 'Showing All' : 'Show Mine Only'}
          </button>
          <button onClick={load}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              cursor: 'pointer', fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
      ) : escalations.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 6px' }}>
            Nothing sent back
          </p>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
            {showAll ? 'No records anywhere need correction right now' : "You're all caught up — no records assigned to you need fixes"}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {escalations.map((e: any) => (
            <div key={e.record_id} style={{
              background: '#fff', border: '1px solid #fecaca', borderRadius: 14,
              padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{e.source_name}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>· {e.project_name}</span>
                    {e.correction_count > 1 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                        Returned {e.correction_count}×
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                    Record: <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{e.record_label}</span>
                  </p>
                </div>
                <Link to={`/projects/${e.project_id}/sources/${e.source_id}`}
                  style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textDecoration: 'none',
                    display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                    padding: '6px 12px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  Open <ArrowRight style={{ width: 12, height: 12 }} />
                </Link>
              </div>

              {/* Feedback message */}
              {e.message && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                  padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <MessageSquare style={{ width: 15, height: 15, color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: '#7f1d1d', margin: 0, lineHeight: 1.5 }}>{e.message}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      {e.by && <Avatar name={e.by} />}
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#991b1b' }}>{e.by}</span>
                      {e.role && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: e.role === 'admin' ? '#dc2626' : '#7c3aed',
                          background: e.role === 'admin' ? '#fef2f2' : '#faf5ff',
                          padding: '1px 6px', borderRadius: 20, textTransform: 'capitalize' }}>
                          {e.role}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                        <Clock style={{ width: 10, height: 10 }} /> {timeAgo(e.when)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional past messages, collapsed */}
              {e.all_messages && e.all_messages.length > 1 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}>
                    + {e.all_messages.length - 1} earlier message{e.all_messages.length - 1 !== 1 ? 's' : ''}
                  </summary>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {e.all_messages.slice(0, -1).reverse().map((m: any, i: number) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                        <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>{m.comment}</p>
                        <p style={{ fontSize: 10, color: '#94a3b8', margin: '3px 0 0' }}>
                          {m.user} · {m.field === '_general' ? 'General' : m.field}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
