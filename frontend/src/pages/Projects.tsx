import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, FolderKanban, Database, CheckCircle, Clock, ArrowRight, Trash2, Edit3, Download, TrendingUp, Package } from 'lucide-react'
import { projectsApi, sourcesApi } from '@/api/client'
import { Modal, Input, Textarea, Select, ConfirmDialog, toast, cn } from '@/components/ui'
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

  // Surfaces the existing /export-package endpoint (Word cover doc + all
  // JSON records) — fully built server-side already, but had no UI entry
  // point anywhere on this page before now.
  const [exportingPackage, setExportingPackage] = useState<string | null>(null)
  const exportPackage = async (p: Project) => {
    setExportingPackage(p.id)
    try {
      await projectsApi.exportPackage(p.id, p.name)
      toast.success('Package downloaded')
    } catch {
      toast.error('Failed to export package — the project may have no approved records yet')
    } finally {
      setExportingPackage(null)
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

  // ── Edit ───────────────────────────────────────────────────────────────────
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [savingEdit, setSavingEdit] = useState(false)

  const openEdit = (p: Project) => {
    setEditProject(p)
    setEditName(p.name)
    setEditDesc(p.description ?? '')
    setEditStatus((p as any).status ?? 'active')
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editProject || !editName.trim()) return
    setSavingEdit(true)
    try {
      await projectsApi.update(editProject.id, {
        name: editName.trim(), description: editDesc.trim(), status: editStatus,
      })
      toast.success('Project updated')
      setEditProject(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update project')
    } finally {
      setSavingEdit(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!deleteProject) return
    setDeleting(true)
    try {
      await projectsApi.delete(deleteProject.id)
      toast.success('Project deleted')
      setDeleteProject(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete project')
    } finally {
      setDeleting(false)
    }
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
    if (s === 'template') return { bg: '#faf5ff', color: '#7c3aed', label: 'Template' }
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
            borderRadius: 10, fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            cursor: exporting === 'all' ? 'not-allowed' : 'pointer', opacity: exporting === 'all' ? .6 : 1,
          }}>
            <Download style={{ width: 15, height: 15 }} /> {exporting === 'all' ? 'Exporting…' : 'Export Timesheet'}
          </button>
          {canManage && (
            <button onClick={() => setShowNew(true)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
              background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(37,99,235,0.3)', transition: 'all 0.15s',
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
            { label: 'Total Projects', value: projects.length, icon: FolderKanban, grad: 'from-brand-500 to-brand-700', accent: 'bg-brand-600' },
            { label: 'Total Sources',  value: projects.reduce((a,p) => a + totalSources(p), 0), icon: Database, grad: 'from-purple-500 to-purple-700', accent: 'bg-purple-500' },
            { label: 'Approved',       value: projects.reduce((a,p) => a + approvedSources(p), 0), icon: CheckCircle, grad: 'from-emerald-500 to-emerald-700', accent: 'bg-emerald-500' },
            { label: 'Avg Completion', value: projects.length > 0
              ? Math.round(projects.reduce((a,p) => a + pct(p), 0) / projects.length) + '%'
              : '0%', icon: TrendingUp, grad: 'from-amber-500 to-orange-600', accent: 'bg-amber-500' },
          ].map(({ label, value, icon: Icon, grad, accent }) => (
            <div key={label} className={cn('relative bg-white rounded-2xl border border-gray-100 overflow-hidden',
              'shadow-card hover:shadow-float hover:-translate-y-0.5 transition-all duration-200')} style={{ padding: '16px 18px' }}>
              <div className={cn('absolute top-0 left-0 right-0 h-1', accent)} />
              <div className="flex items-center justify-between mb-2.5">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white bg-gradient-to-br shadow-md', grad)}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
              </div>
              <p style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', margin: '6px 0 0' }}>{label}</p>
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
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 6px' }}>No projects yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>Create your first project to get started</p>
          {canManage && (
            <button onClick={() => setShowNew(true)} style={{
              padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(37,99,235,0.3)' }}>
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
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
                    style={{ borderBottom: i < projects.length - 1 ? '1px solid #f8fafc' : 'none', transition: 'background 0.12s' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm"
                          style={{ width: 36, height: 36, borderRadius: 10,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FolderKanban style={{ width: 16, height: 16, color: '#fff' }} />
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
                          <div style={{
                            background: progress === 100 ? 'linear-gradient(90deg,#10b981,#059669)' : 'linear-gradient(90deg,#3b82f6,#2563eb)',
                            height: '100%', width: `${progress}%`, borderRadius: 99, transition: 'width 0.4s ease' }} />
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
                            border: '1px solid #e2e8f0', color: '#64748b', transition: 'all 0.15s',
                            cursor: exporting === p.id ? 'not-allowed' : 'pointer',
                            opacity: exporting === p.id ? .6 : 1, display: 'flex', alignItems: 'center' }}>
                          <Download style={{ width: 13, height: 13 }} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); exportPackage(p) }}
                          disabled={exportingPackage === p.id}
                          title="Download full package (Word cover doc + JSON records)"
                          style={{ padding: '5px 9px', borderRadius: 8, background: '#f8fafc',
                            border: '1px solid #e2e8f0', color: '#64748b', transition: 'all 0.15s',
                            cursor: exportingPackage === p.id ? 'not-allowed' : 'pointer',
                            opacity: exportingPackage === p.id ? .6 : 1, display: 'flex', alignItems: 'center' }}>
                          <Package style={{ width: 13, height: 13 }} />
                        </button>
                        {canManage && (
                          <>
                            <button onClick={e => { e.stopPropagation(); openEdit(p) }}
                              title="Edit project"
                              style={{ padding: '5px 9px', borderRadius: 8, background: '#f8fafc',
                                border: '1px solid #e2e8f0', color: '#64748b', transition: 'all 0.15s',
                                cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                              <Edit3 style={{ width: 13, height: 13 }} />
                            </button>
                            <button onClick={e => { e.stopPropagation(); setDeleteProject(p) }}
                              title="Delete project"
                              style={{ padding: '5px 9px', borderRadius: 8, background: '#fef2f2',
                                border: '1px solid #fecaca', color: '#dc2626', transition: 'all 0.15s',
                                cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                              <Trash2 style={{ width: 13, height: 13 }} />
                            </button>
                          </>
                        )}
                        <Link to={`/projects/${p.id}/sources`}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                            fontWeight: 700, color: '#2563eb', textDecoration: 'none', transition: 'all 0.15s',
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
              style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1,
                boxShadow: saving ? 'none' : '0 3px 10px rgba(37,99,235,0.3)' }}>
              {saving ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit project modal */}
      <Modal open={!!editProject} onClose={() => setEditProject(null)} title="Edit Project">
        <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Project name *
            </label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} required />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Description
            </label>
            <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Status
            </label>
            <Select value={editStatus} onChange={e => setEditStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
              <option value="template">Template</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" onClick={() => setEditProject(null)}
              style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none',
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button type="submit" disabled={savingEdit || !editName.trim()}
              style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? .7 : 1,
                boxShadow: savingEdit ? 'none' : '0 3px 10px rgba(37,99,235,0.3)' }}>
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteProject}
        title="Delete Project"
        description={`"${deleteProject?.name}" will be removed from your project list. Its sources and records are kept in the database but become inaccessible through the normal UI. This is reversible only by an engineer restoring it directly in the database.`}
        confirmLabel="Delete Project"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteProject(null)}
      />
    </div>
  )
}
