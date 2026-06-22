import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, Trash2, Edit3, Users, Database, ChevronRight } from 'lucide-react'
import { projectsApi } from '@/api/client'
import type { Project } from '@/types'
import { Button, Card, Badge, Modal, Input, Textarea, EmptyState, Spinner, ConfirmDialog, cn, toast } from '@/components/ui'
import { useCapability } from '@/lib/permissions'
import { formatDistanceToNow } from 'date-fns'

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const canManage = useCapability('manage_projects')

  const load = () =>
    projectsApi.list().then(r => {
      setProjects(r.items || r)
      setTotal(r.total || (r.items || r).length)
    }).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

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

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">{total} project{total !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
          <Button onClick={() => { setForm({ name: '', description: '' }); setShowCreate(true) }}>
            <Plus className="w-4 h-4" /> New Project
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text" placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No projects match your search' : 'No projects yet'}
          description={canManage ? 'Create your first project to start organizing your extraction work.' : 'No projects available.'}
          action={canManage && !search ? <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> New Project</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <Card key={p.id} hover className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                    <FolderKanban className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Updated {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <Badge variant={p.status === 'active' ? 'green' : 'gray'} className="shrink-0">{p.status}</Badge>
              </div>

              {p.description && (
                <p className="text-sm text-gray-500 line-clamp-2">{p.description}</p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  <Link
                    to={`/projects/${p.id}/sources`}
                    className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    <Database className="w-3.5 h-3.5" /> Sources
                  </Link>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <ChevronRight className="w-3.5 h-3.5" /> Details
                  </Link>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(p)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteProject(p)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Project">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Project name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. BGS Supplier Data 2025" required autoFocus />
          <Textarea label="Description" rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What is this project for?" />
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
          <Textarea label="Description" rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditProject(null)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim()}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteProject}
        title="Delete Project"
        description={`"${deleteProject?.name}" and all its sources, jobs, records, and resources will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete Project"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteProject(null)}
      />
    </div>
  )
}
