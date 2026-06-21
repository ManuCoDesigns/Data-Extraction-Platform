import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Plus, Globe, Database, LayoutGrid, Table as TableIcon,
  Search, User as UserIcon, ChevronRight, AlertCircle
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi, usersApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, cn, toast } from '@/components/ui'
import { useCapability } from '@/lib/permissions'
import { formatDistanceToNow } from 'date-fns'

const STATUS_META: Record<SourceStatus, { label: string; color: 'gray' | 'amber' | 'red' | 'blue' | 'purple' | 'green' | 'indigo' }> = {
  not_started:       { label: 'Not Started',       color: 'gray' },
  extracting:        { label: 'Extracting',        color: 'blue' },
  needs_fixes:       { label: 'Needs Fixes',        color: 'amber' },
  ready_for_review:  { label: 'Ready for Review',   color: 'indigo' },
  in_review:         { label: 'In Review',          color: 'purple' },
  changes_requested: { label: 'Changes Requested',  color: 'red' },
  llm_verification:  { label: 'LLM Verification',   color: 'purple' },
  approved:          { label: 'Approved',           color: 'green' },
}

const KANBAN_COLUMNS: SourceStatus[] = [
  'not_started', 'extracting', 'needs_fixes', 'ready_for_review', 'in_review', 'changes_requested', 'approved',
]

export function SourcesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const canManage = useCapability('manage_projects')
  const [project, setProject] = useState<Project | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', website_url: '', schema_id: '',
    assigned_extractor_id: '', assigned_reviewer_id: '',
  })

  const load = () => {
    if (!projectId) return
    Promise.all([
      projectsApi.get(projectId).then(setProject),
      sourcesApi.list(projectId).then(setSources),
      schemasApi.list(projectId).then((r: any) => setSchemas(Array.isArray(r) ? r : [])),
      projectsApi.listMembers(projectId).then((m: any) => setMembers(m.map((x: any) => ({ id: x.user_id, full_name: x.full_name, email: x.email })))),
    ]).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [projectId])

  const filtered = sources.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.schema_id || !projectId) return
    setCreating(true)
    try {
      const created = await sourcesApi.create(projectId, {
        name: form.name, description: form.description || undefined,
        website_url: form.website_url || undefined, schema_id: form.schema_id,
        assigned_extractor_id: form.assigned_extractor_id || undefined,
        assigned_reviewer_id: form.assigned_reviewer_id || undefined,
      })
      toast.success('Source created')
      setShowCreate(false)
      setForm({ name: '', description: '', website_url: '', schema_id: '', assigned_extractor_id: '', assigned_reviewer_id: '' })
      navigate(`/projects/${projectId}/sources/${created.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create source')
    } finally {
      setCreating(false)
    }
  }

  const updateStatus = async (sourceId: string, status: SourceStatus) => {
    try {
      await sourcesApi.update(sourceId, { status })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update status')
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link to={`/projects/${projectId}`} className="hover:text-gray-600">{project?.name}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-600">Sources</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
          <p className="text-sm text-gray-500 mt-1">{sources.length} tracked dataset{sources.length !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Source
          </Button>
        )}
      </div>

      {/* View toggle + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setView('kanban')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
              view === 'kanban' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Kanban
          </button>
          <button
            onClick={() => setView('table')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
              view === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <TableIcon className="w-3.5 h-3.5" /> Table
          </button>
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text" placeholder="Search sources…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 w-52"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No sources match your search' : 'No sources yet'}
          description={canManage ? 'Create a source to start tracking a dataset through extraction, review, and approval.' : 'No sources have been created in this project yet.'}
          action={canManage && !search ? <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> New Source</Button> : undefined}
        />
      ) : view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(status => {
            const items = filtered.filter(s => s.status === status)
            const meta = STATUS_META[status]
            return (
              <div key={status} className="flex-shrink-0 w-72">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full',
                      meta.color === 'green' ? 'bg-emerald-500' :
                      meta.color === 'amber' ? 'bg-amber-500' :
                      meta.color === 'red' ? 'bg-red-500' :
                      meta.color === 'blue' ? 'bg-blue-500' :
                      meta.color === 'purple' ? 'bg-purple-500' :
                      meta.color === 'indigo' ? 'bg-indigo-500' : 'bg-gray-400'
                    )} />
                    <h3 className="text-sm font-semibold text-gray-700">{meta.label}</h3>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[60px]">
                  {items.map(s => <SourceKanbanCard key={s.id} source={s} projectId={projectId!} />)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Extractor</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Reviewer</th>
                <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Records</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center shrink-0">
                        <Database className="w-4 h-4 text-brand-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 truncate">{s.schema_name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <Badge variant={STATUS_META[s.status].color}>{STATUS_META[s.status].label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 hidden md:table-cell">{s.assigned_extractor_name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 hidden md:table-cell">{s.assigned_reviewer_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-xs hidden sm:table-cell">
                    <span className="text-emerald-700 font-medium">{s.valid_records}</span>
                    <span className="text-gray-400"> / </span>
                    <span className="text-gray-700">{s.total_records}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                    {formatDistanceToNow(new Date(s.updated_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/projects/${projectId}/sources/${s.id}`} className="text-brand-600 hover:text-brand-700 text-xs font-medium">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Source" description="Track a new dataset through extraction, review, and approval." size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Source name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. BGS Directory of Mines 2020" required autoFocus />
          <Textarea label="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What is this dataset?" />
          <Input label="Source website" value={form.website_url} onChange={e => setForm(f => ({ ...f, website_url: e.target.value }))}
            placeholder="https://example.com/dataset" />
          <Select label="Schema" value={form.schema_id} onChange={e => setForm(f => ({ ...f, schema_id: e.target.value }))} required>
            <option value="">Select a schema…</option>
            {schemas.filter(s => !s.is_archived).map(s => (
              <option key={s.id} value={s.id}>{s.name} (v{s.current_version})</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Assign extractor" value={form.assigned_extractor_id} onChange={e => setForm(f => ({ ...f, assigned_extractor_id: e.target.value }))}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
            <Select label="Assign reviewer" value={form.assigned_reviewer_id} onChange={e => setForm(f => ({ ...f, assigned_reviewer_id: e.target.value }))}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={creating} disabled={!form.name.trim() || !form.schema_id}>
              <Plus className="w-4 h-4" /> Create Source
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function SourceKanbanCard({ source, projectId }: { source: Source; projectId: string }) {
  return (
    <Link to={`/projects/${projectId}/sources/${source.id}`}>
      <Card hover className="p-3.5 space-y-2.5">
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{source.name}</p>
        {source.website_url && (
          <p className="text-xs text-gray-400 flex items-center gap-1 truncate">
            <Globe className="w-3 h-3 shrink-0" /> {source.website_url.replace(/^https?:\/\//, '')}
          </p>
        )}
        {source.total_records > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-emerald-600 font-medium">{source.valid_records}</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-500">{source.total_records}</span>
            <span className="text-gray-400">records valid</span>
            {source.invalid_records > 0 && (
              <AlertCircle className="w-3 h-3 text-amber-500 ml-auto" />
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-1.5 border-t border-gray-50">
          {source.assigned_extractor_name ? (
            <div className="flex items-center gap-1.5">
              <Avatar name={source.assigned_extractor_name} size="sm" />
              <span className="text-xs text-gray-500 truncate max-w-[100px]">{source.assigned_extractor_name}</span>
            </div>
          ) : (
            <span className="text-xs text-gray-300 flex items-center gap-1"><UserIcon className="w-3 h-3" /> Unassigned</span>
          )}
          <span className="text-xs text-gray-300">{formatDistanceToNow(new Date(source.updated_at))}</span>
        </div>
      </Card>
    </Link>
  )
}
