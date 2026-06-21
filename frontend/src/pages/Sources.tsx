import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Plus, Globe, Database, LayoutGrid, Table as TableIcon,
  Search, User as UserIcon, ChevronRight, AlertCircle, ArrowUpRight, Sparkles
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, cn, toast } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
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

// Simplified 4-step view of the same columns, for people new to the tool
const SIMPLE_STEPS: { label: string; statuses: SourceStatus[]; color: string }[] = [
  { label: '1. To Do',      statuses: ['not_started'],                                    color: 'bg-gray-400' },
  { label: '2. Extracting', statuses: ['extracting', 'needs_fixes'],                       color: 'bg-blue-500' },
  { label: '3. In Review',  statuses: ['ready_for_review', 'in_review', 'changes_requested'], color: 'bg-purple-500' },
  { label: '4. Done',       statuses: ['approved'],                                        color: 'bg-emerald-500' },
]

/**
 * Works in two modes:
 *  - Global  (route: /sources)              — every source the user can access, across all projects
 *  - Project (route: /projects/:id/sources) — sources within one project only
 */
export function SourcesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const canManage = useCapability('manage_projects')
  const isGlobal = !projectId

  const [project, setProject] = useState<Project | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'simple' | 'kanban' | 'table'>('simple')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(projectId ?? '')
  const [mineOnly, setMineOnly] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', website_url: '', schema_id: '', project_id: projectId ?? '',
    assigned_extractor_id: '', assigned_reviewer_id: '',
  })

  const load = () => {
    const sourcesPromise = isGlobal
      ? sourcesApi.list().catch(() => [])
      : sourcesApi.list(projectId!)
    Promise.all([
      isGlobal ? projectsApi.list().then((r: any) => setProjects(r.items)) : projectsApi.get(projectId!).then(setProject),
      sourcesPromise.then(setSources),
    ]).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [projectId])

  // Load schema/member options for the create form, scoped to the chosen project
  useEffect(() => {
    const targetProjectId = isGlobal ? form.project_id : projectId
    if (!targetProjectId) { setSchemas([]); setMembers([]); return }
    schemasApi.list(targetProjectId).then((r: any) => setSchemas(Array.isArray(r) ? r : [])).catch(() => setSchemas([]))
    projectsApi.listMembers(targetProjectId).then((m: any) => setMembers(m.map((x: any) => ({ id: x.user_id, full_name: x.full_name, email: x.email })))).catch(() => setMembers([]))
  }, [form.project_id, projectId])

  const filtered = sources.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false
    if (isGlobal && projectFilter && s.project_id !== projectFilter) return false
    if (mineOnly && s.assigned_extractor_id !== user?.id && s.assigned_reviewer_id !== user?.id) return false
    return true
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const targetProjectId = isGlobal ? form.project_id : projectId
    if (!form.name.trim() || !form.schema_id || !targetProjectId) return
    setCreating(true)
    try {
      const created = await sourcesApi.create(targetProjectId, {
        name: form.name, description: form.description || undefined,
        website_url: form.website_url || undefined, schema_id: form.schema_id,
        assigned_extractor_id: form.assigned_extractor_id || undefined,
        assigned_reviewer_id: form.assigned_reviewer_id || undefined,
      })
      toast.success('Source created')
      setShowCreate(false)
      setForm({ name: '', description: '', website_url: '', schema_id: '', project_id: projectId ?? '', assigned_extractor_id: '', assigned_reviewer_id: '' })
      navigate(`/projects/${targetProjectId}/sources/${created.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create source')
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const pageTitle = isGlobal ? 'Sources' : `${project?.name} — Sources`

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          {!isGlobal && (
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <Link to={`/projects/${projectId}`} className="hover:text-gray-600">{project?.name}</Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-gray-600">Sources</span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">{isGlobal ? 'Sources' : 'Sources'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isGlobal ? 'Every dataset you have access to, in one place.' : `${sources.length} tracked dataset${sources.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Source
          </Button>
        )}
      </div>

      {/* Onboarding strip — only shows when there's nothing yet, explains the whole flow in one glance */}
      {sources.length === 0 && (
        <Card className="p-5 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-100">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">How Sources work</p>
              <p className="text-sm text-gray-600 mt-1">
                A Source is one dataset you're tracking — like "BGS Mines Directory 2020." An admin creates it and assigns
                an extractor. The extractor pulls the data however they like, then uploads it here — the tool checks each
                row against the schema and shows exactly what needs fixing. Once it's clean, a reviewer checks it against
                the source website and approves it. Approved data can be exported as JSON with a cover sheet, anytime.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-gray-100 rounded-xl p-1">
          {(['simple', 'kanban', 'table'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
            >
              {v === 'simple' ? <Sparkles className="w-3.5 h-3.5" /> : v === 'kanban' ? <LayoutGrid className="w-3.5 h-3.5" /> : <TableIcon className="w-3.5 h-3.5" />}
              {v === 'simple' ? 'Simple' : v === 'kanban' ? 'Full Kanban' : 'Table'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setMineOnly(m => !m)}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5',
            mineOnly ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}
        >
          <UserIcon className="w-3.5 h-3.5" /> Assigned to me
        </button>

        {isGlobal && projects.length > 1 && (
          <Select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="!py-1.5 !text-xs w-44">
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}

        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text" placeholder="Search sources…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 w-52"
          />
        </div>
      </div>

      {filtered.length === 0 && sources.length > 0 ? (
        <EmptyState title="No sources match your filters" description="Try clearing the search or filters above." />
      ) : filtered.length === 0 ? (
        canManage ? (
          <EmptyState
            title="No sources yet"
            description="Create your first source to start tracking a dataset through extraction, review, and approval."
            action={<Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> New Source</Button>}
          />
        ) : (
          <EmptyState title="No sources assigned yet" description="An admin will assign you to a source when there's data to extract or review." />
        )
      ) : view === 'simple' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SIMPLE_STEPS.map(step => {
            const items = filtered.filter(s => step.statuses.includes(s.status))
            return (
              <div key={step.label}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={cn('w-2 h-2 rounded-full', step.color)} />
                  <h3 className="text-sm font-semibold text-gray-700">{step.label}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full ml-auto">{items.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[60px]">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-300 px-1">Nothing here</p>
                  ) : items.map(s => (
                    <SourceCard key={s.id} source={s} projectId={s.project_id} projectName={isGlobal ? projectMap[s.project_id] : undefined} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
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
                      meta.color === 'green' ? 'bg-emerald-500' : meta.color === 'amber' ? 'bg-amber-500' :
                      meta.color === 'red' ? 'bg-red-500' : meta.color === 'blue' ? 'bg-blue-500' :
                      meta.color === 'purple' ? 'bg-purple-500' : meta.color === 'indigo' ? 'bg-indigo-500' : 'bg-gray-400'
                    )} />
                    <h3 className="text-sm font-semibold text-gray-700">{meta.label}</h3>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[60px]">
                  {items.map(s => <SourceCard key={s.id} source={s} projectId={s.project_id} projectName={isGlobal ? projectMap[s.project_id] : undefined} />)}
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
                {isGlobal && <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Project</th>}
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
                  {isGlobal && <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">{projectMap[s.project_id]}</td>}
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
                    <Link to={`/projects/${s.project_id}/sources/${s.id}`} className="text-brand-600 hover:text-brand-700 text-xs font-medium">
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
          {isGlobal && (
            <Select label="Project" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value, schema_id: '' }))} required>
              <option value="">Select a project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <Input label="Source name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. BGS Directory of Mines 2020" required autoFocus />
          <Textarea label="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What is this dataset?" />
          <Input label="Source website" value={form.website_url} onChange={e => setForm(f => ({ ...f, website_url: e.target.value }))}
            placeholder="https://example.com/dataset" />
          <Select label="Schema" value={form.schema_id} onChange={e => setForm(f => ({ ...f, schema_id: e.target.value }))} required disabled={isGlobal && !form.project_id}>
            <option value="">{isGlobal && !form.project_id ? 'Select a project first' : 'Select a schema…'}</option>
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

function SourceCard({ source, projectId, projectName }: { source: Source; projectId: string; projectName?: string }) {
  return (
    <Link to={`/projects/${projectId}/sources/${source.id}`}>
      <Card hover className="p-3.5 space-y-2.5">
        {projectName && (
          <p className="text-xs text-brand-600 font-medium flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3" /> {projectName}
          </p>
        )}
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
            <span className="text-gray-400">valid</span>
            {source.invalid_records > 0 && <AlertCircle className="w-3 h-3 text-amber-500 ml-auto" />}
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
