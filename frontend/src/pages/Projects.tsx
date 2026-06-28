import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, Trash2, Edit3, Database, ChevronRight, BarChart3, Users, ArrowRight, Globe } from 'lucide-react'
import { projectsApi } from '@/api/client'
import type { Project } from '@/types'
import { Button, Card, Badge, Modal, Input, Textarea, EmptyState, Spinner, ConfirmDialog, cn, toast, safeFromNow } from '@/components/ui'
import { useCapability } from '@/lib/permissions'

// Project card gradient by index
const PROJECT_GRADIENTS = [
  { from: '#2563eb', to: '#4f46e5' },  // blue→indigo
  { from: '#0891b2', to: '#2563eb' },  // cyan→blue
  { from: '#059669', to: '#0891b2' },  // emerald→cyan
  { from: '#7c3aed', to: '#2563eb' },  // violet→blue
  { from: '#0f766e', to: '#059669' },  // teal→emerald
  { from: '#1d4ed8', to: '#7c3aed' },  // blue→violet
]

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const canManage = useCapability('manage_projects')

  const load = () =>
    projectsApi.list().then(r => {
      setProjects(r.items || r)
      setTotal(r.total || (r.items || r).length)
    }).finally(() => setLoading(false))

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [])

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await projectsApi.create({ name: form.name, description: form.description || undefined })
      toast.success('Project created')
      setShowCreate(false)
      setForm({ name: '', description: '' })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create project')
    } finally { setSaving(false) }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editProject || !form.name.trim()) return
    setSaving(true)
    try {
      await projectsApi.update(editProject.id, { name: form.name, description: form.description || undefined })
      toast.success('Project updated')
      setEditProject(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update project')
    } finally { setSaving(false) }
  }

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
    } finally { setDeleting(false) }
  }

  const openEdit = (p: Project) => {
    setEditProject(p)
    setForm({ name: p.name, description: p.description || '' })
  }

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Spinner className="w-8 h-8" />
        <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading projects…</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '32px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0 }}>Projects</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {total} project{total !== 1 ? 's' : ''} · each project is a data acquisition campaign
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setForm({ name: '', description: '' }); setShowCreate(true) }}
            style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 12, fontWeight: 600 }}>
            <Plus className="w-4 h-4" /> New Project
          </Button>
        )}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 380, marginBottom: 28 }}>
        <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
        <input type="text" placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', paddingLeft: 42, paddingRight: 16, paddingTop: 10, paddingBottom: 10, border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 14, outline: 'none', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}
          onFocus={e => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px #dbeafe' }}
          onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No projects match your search' : 'No projects yet'}
          description={canManage ? 'Create your first project to start organizing your extraction work.' : 'No projects available.'}
          action={canManage && !search ? <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> New Project</Button> : undefined}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {filtered.map((p, idx) => {
            const grad = PROJECT_GRADIENTS[idx % PROJECT_GRADIENTS.length]
            const approvedPct = (p as any).approved_pct ?? 0
            return (
              <div key={p.id} style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px #f1f5f9', transition: 'box-shadow 0.2s, transform 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.14)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px #f1f5f9'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}>

                {/* Gradient header */}
                <div style={{ background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`, padding: '20px 22px 16px', position: 'relative', overflow: 'hidden' }}>
                  {/* Decorative circles */}
                  <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                  <div style={{ position: 'absolute', bottom: -10, right: 30, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />

                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 10, backdropFilter: 'blur(8px)' }}>
                      <FolderKanban style={{ width: 20, height: 20, color: '#fff' }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: p.status === 'active' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {p.status}
                    </span>
                  </div>

                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '12px 0 4px', lineHeight: 1.3 }}>{p.name}</h3>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: 0 }}>Updated {safeFromNow(p.updated_at)}</p>
                </div>

                {/* Body */}
                <div style={{ padding: '16px 22px' }}>
                  {p.description && (
                    <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.description}
                    </p>
                  )}

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 16, margin: '0 0 16px' }}>
                    {[
                      { icon: Database, label: 'Sources', value: p.job_count ?? '—' },
                      { icon: Users, label: 'Members', value: p.member_count ?? '—' },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon style={{ width: 13, height: 13, color: '#94a3b8' }} />
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{value} {label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Link to={`/projects/${p.id}`}
                        style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none', padding: '6px 12px', background: '#eff6ff', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <BarChart3 style={{ width: 12, height: 12 }} /> Overview
                      </Link>
                      <Link to={`/projects/${p.id}/sources`}
                        style={{ fontSize: 12, fontWeight: 600, color: '#059669', textDecoration: 'none', padding: '6px 12px', background: '#ecfdf5', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Database style={{ width: 12, height: 12 }} /> Sources
                      </Link>
                    </div>

                    {canManage && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => openEdit(p)}
                          style={{ padding: 6, background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
                          title="Edit project"
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#2563eb'; (e.currentTarget as HTMLElement).style.borderColor = '#bfdbfe'; (e.currentTarget as HTMLElement).style.background = '#eff6ff' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLElement).style.background = 'none' }}>
                          <Edit3 style={{ width: 13, height: 13 }} />
                        </button>
                        <button onClick={() => setDeleteProject(p)}
                          style={{ padding: 6, background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
                          title="Delete project"
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.borderColor = '#fecaca'; (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLElement).style.background = 'none' }}>
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Project" description="Create a new data acquisition project.">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Project name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Critical Materials Intelligence 2025" required autoFocus />
          <Textarea label="Description (optional)" rows={3} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What is this project collecting?" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim()}>
              <Plus className="w-4 h-4" /> Create Project
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editProject} onClose={() => setEditProject(null)} title="Edit Project">
        <form onSubmit={handleEdit} className="space-y-4">
          <Input label="Project name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
          <Textarea label="Description" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditProject(null)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim()}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteProject} title="Delete Project"
        description={`"${deleteProject?.name}" and all its data will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete Project" variant="danger" loading={deleting}
        onConfirm={handleDelete} onCancel={() => setDeleteProject(null)} />
    </div>
  )
}
