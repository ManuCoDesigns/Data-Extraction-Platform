import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, FolderKanban, Database, CheckCircle, Clock, ArrowRight, Trash2, Edit3, Download } from 'lucide-react'
import { projectsApi, sourcesApi } from '@/api/client'
import { Modal, Input, Textarea, toast, cn } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useCapability } from '@/lib/permissions'
import type { Project } from '@/types'

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showNew,  setShowNew]  = useState(false)
  const [name,     setName]     = useState('')
  const [desc,     setDesc]     = useState('')
  const [saving,   setSaving]   = useState(false)
  const canManage = useCapability('manage_projects')
  const { user }  = useAuthStore()
  const navigate  = useNavigate()

  const load = () => {
    setLoading(true)
    projectsApi.list().then((r: any) => {
      setProjects(Array.isArray(r) ? r : r?.items ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const [exporting, setExporting] = useState<string | null>(null)
  const exportTimesheet = async (projectId?: string) => {
    setExporting(projectId ?? 'all')
    try {
      await sourcesApi.exportTimesheet(projectId)
      toast.success('Timesheet downloaded')
    } catch {
      toast.error('Failed to export timesheet')
    } finally {
      setExporting(null)
    }
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await projectsApi.create({ name: name.trim(), description: desc.trim() })
      toast.success('Project created')
      setShowNew(false); setName(''); setDesc('')
      load()
    } catch { toast.error('Failed to create project') }
    finally { setSaving(false) }
  }

  const totalSources   = (p: Project) => (p as any).total_sources   ?? 0
  const approvedSources = (p: Project) => (p as any).approved_sources ?? 0
  const pct = (p: Project) => totalSources(p) > 0
    ? Math.round((approvedSources(p) / totalSources(p)) * 100) : 0

  const statusColor = (p: Project) => {
    const s = (p as any).status ?? ''
    if (s === 'active')   return { bg: '#ecfdf5', color: '#059669', label: 'Active' }
    if (s === 'paused')   return { bg: '#fffbeb', color: '#d97706', label: 'Paused' }
    if (s === 'archived') return { bg: '#f1f5f9', color: '#64748b', label: 'Archived' }
    return { bg: '#eff6ff', color: '#2563eb', label: 'Active' }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Projects</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''} · manage extraction pipelines
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportTimesheet()} disabled={exporting === 'all' || projects.length === 0}
            title="Download delivery timesheet for all projects" style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            background: '#fff', color: '#374151', border: '1px solid #e2e8f0',
            borderRadius: 10, fontSize: 13, fontWeight: 600,
            cursor: exporting === 'all' ? 'not-allowed' : 'pointer', opacity: exporting === 'all' ? .6 : 1,
          }}>
            <Download style={{ width: 15, height: 15 }} /> {exporting === 'all' ? 'Exporting…' : 'Export Timesheet'}
          </button>
          {canManage && (
            <button onClick={() => setShowNew(true)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
              background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              <Plus style={{ width: 16, height: 16 }} /> New Project
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {projects.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Projects', value: projects.length, color: '#2563eb', bg: '#eff6ff' },
            { label: 'Total Sources',  value: projects.reduce((a,p) => a + totalSources(p), 0), color: '#7c3aed', bg: '#faf5ff' },
            { label: 'Approved',       value: projects.reduce((a,p) => a + approvedSources(p), 0), color: '#059669', bg: '#ecfdf5' },
            { label: 'Avg Completion', value: projects.length > 0
              ? Math.round(projects.reduce((a,p) => a + pct(p), 0) / projects.length) + '%'
              : '0%', color: '#d97706', bg: '#fffbeb' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <p style={{ fontSize: 24, fontWeight: 800, color, margin: 0 }}>{value}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', margin: '4px 0 0' }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Projects table */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: 60, textAlign: 'center' }}>
          <FolderKanban style={{ width: 40, height: 40, color: '#e2e8f0', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 6px' }}>No projects yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>Create your first project to get started</p>
          {canManage && (
            <button onClick={() => setShowNew(true)} style={{
              padding: '9px 20px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Project','Status','Sources','Approved','Progress','Last Updated',''].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em',
                    whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const { bg, color, label } = statusColor(p)
                const progress = pct(p)
                return (
                  <tr key={p.id}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    style={{ borderBottom: i < projects.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FolderKanban style={{ width: 16, height: 16, color: '#2563eb' }} />
                        </div>
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{p.name}</p>
                          {p.description && (
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0',
                              maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px',
                        borderRadius: 20, background: bg, color }}>{label}</span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                      {totalSources(p)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#059669' }}>
                        {approvedSources(p)}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, width: 80, overflow: 'hidden' }}>
                          <div style={{ background: progress === 100 ? '#10b981' : '#2563eb',
                            height: '100%', width: `${progress}%`, borderRadius: 99 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600,
                          color: progress === 100 ? '#059669' : '#2563eb' }}>
                          {progress}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#94a3b8' }}>
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={e => { e.stopPropagation(); exportTimesheet(p.id) }}
                          disabled={exporting === p.id}
                          title="Download delivery timesheet for this project"
                          style={{ padding: '5px 9px', borderRadius: 8, background: '#f8fafc',
                            border: '1px solid #e2e8f0', color: '#64748b',
                            cursor: exporting === p.id ? 'not-allowed' : 'pointer',
                            opacity: exporting === p.id ? .6 : 1, display: 'flex', alignItems: 'center' }}>
                          <Download style={{ width: 13, height: 13 }} />
                        </button>
                        <Link to={`/projects/${p.id}/sources`}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                            fontWeight: 700, color: '#2563eb', textDecoration: 'none',
                            padding: '5px 12px', borderRadius: 8,
                            background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                          Open <ArrowRight style={{ width: 12, height: 12 }} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New project modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Project">
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Project name *
            </label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. WebTailBench 2026" required />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Description
            </label>
            <Textarea value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Brief description of what this project extracts" rows={3} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" onClick={() => setShowNew(false)}
              style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none',
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              style={{ padding: '9px 18px', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1 }}>
              {saving ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
