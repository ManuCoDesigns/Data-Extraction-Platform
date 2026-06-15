import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FolderKanban, Users, Briefcase } from 'lucide-react'
import { projectsApi } from '@/api/client'
import type { Project } from '@/types'
import {
  Button, Card, Badge, Modal, Input, EmptyState, Spinner
} from '@/components/ui'
import { formatDistanceToNow } from 'date-fns'

const STATUS_COLOR: Record<string, 'green' | 'amber' | 'gray' | 'blue'> = {
  active: 'green', paused: 'amber', archived: 'gray', template: 'blue',
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })

  const load = () =>
    projectsApi.list().then(r => setProjects(r.items)).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      await projectsApi.create(form)
      setShowCreate(false)
      setForm({ name: '', description: '' })
      load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            Each project is an isolated extraction workspace with its own schemas and team.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Project
        </Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start extracting data."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Create Project
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(project => (
            <Link key={project.id} to={`/projects/${project.id}`}>
              <Card className="p-6 hover:shadow-md hover:border-brand-200 transition-all cursor-pointer h-full flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                    <FolderKanban className="w-5 h-5 text-brand-600" />
                  </div>
                  <Badge variant={STATUS_COLOR[project.status] ?? 'gray'}>
                    {project.status}
                  </Badge>
                </div>
                <h3 className="font-semibold text-gray-900">{project.name}</h3>
                {project.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2 flex-1">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Briefcase className="w-3.5 h-3.5" />
                    {project.job_count ?? 0} jobs
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Users className="w-3.5 h-3.5" />
                    {project.member_count ?? 0} members
                  </div>
                  <div className="ml-auto text-xs text-gray-400">
                    {formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Project">
        <form onSubmit={createProject} className="space-y-4">
          <Input
            label="Project name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="BGS DMQ 2020"
            required
            autoFocus
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description (optional)</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What data are you extracting?"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>Create Project</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
