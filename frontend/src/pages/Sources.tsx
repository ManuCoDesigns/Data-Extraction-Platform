import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Plus, Globe, Database, LayoutGrid, Table as TableIcon,
  Search, User as UserIcon, ChevronRight, AlertCircle, ArrowUpRight, Sparkles, Trash2,
  Lock, CheckCircle2, RefreshCw
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, ConfirmDialog, cn, toast, safeFromNow, safeFormat } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useCapability } from '@/lib/permissions'

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

// 4-step pipeline view — matches the step wizard in SourceDetail
// These groups match the 4-step pipeline exactly.
// Every possible SourceStatus maps to exactly one step — no gaps, no ambiguity.
const SIMPLE_STEPS: { label: string; statuses: SourceStatus[]; color: string; icon: string; desc: string }[] = [
  {
    label: '1. Upload',
    statuses: ['not_started', 'extracting', 'needs_fixes'],
    color: 'bg-blue-500', icon: '📤',
    desc: 'Data not yet uploaded or has schema errors',
  },
  {
    label: '2. Review',
    statuses: ['ready_for_review', 'in_review', 'changes_requested', 'llm_verification'],
    color: 'bg-purple-500', icon: '🔍',
    desc: 'Records being reviewed — approved, pending, or sent back',
  },
  {
    label: '3. Approved',
    statuses: ['approved'],
    color: 'bg-emerald-500', icon: '✅',
    desc: 'All records approved and source locked',
  },
  {
    label: '4. Submitted',
    statuses: [],   // computed: approved + is_submitted on records
    color: 'bg-orange-500', icon: '🚀',
    desc: 'Records delivered to client',
  },
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
  const canManage  = useCapability('manage_projects')
  const isGlobal   = !projectId
  const roles      = new Set(user?.roles ?? [])
  const isAdmin    = roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead')
  const isExtractor = roles.has('pipeline_operator') && !roles.has('org_admin') && !roles.has('project_admin')
  const isReviewer  = roles.has('reviewer') && !roles.has('org_admin') && !roles.has('project_admin')

  const [project, setProject] = useState<Project | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [schemasLoading, setSchemasLoading] = useState(false)

  const loadSchemasAndMembers = (pid: string) => {
    if (!pid) { setSchemas([]); setMembers([]); return }
    setSchemasLoading(true)
    Promise.all([
      schemasApi.list(pid).then((r: any) => setSchemas(Array.isArray(r) ? r : [])),
      projectsApi.listMembers(pid).then((m: any) =>
        setMembers(m.map((x: any) => ({ id: x.user_id, full_name: x.full_name, email: x.email })))
      ),
    ]).catch(() => {}).finally(() => setSchemasLoading(false))
  }
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'simple' | 'kanban' | 'table'>('simple')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(projectId ?? '')
  const [mineOnly, setMineOnly] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleteSource, setDeleteSource] = useState<Source | null>(null)
  const [deleting, setDeleting] = useState(false)
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
  useEffect(() => {
    load()
    // Auto-refresh every 30s so status changes from other users show up
    const iv = setInterval(load, 30_000)
    // Also refresh immediately when user returns to this tab
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load() })
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [projectId])

  // Load schemas + members whenever the target project changes
  useEffect(() => {
    const pid = isGlobal ? form.project_id : projectId
    loadSchemasAndMembers(pid || '')
  }, [form.project_id, projectId])

  const filtered = sources.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false
    if (isGlobal && projectFilter && s.project_id !== projectFilter) return false
    if (mineOnly && s.assigned_extractor_id !== user?.id && s.assigned_reviewer_id !== user?.id) return false
    return true
  })

  const handleDeleteSource = async () => {
    if (!deleteSource) return
    setDeleting(true)
    try {
      await sourcesApi.delete(deleteSource.id)
      toast.success('Source deleted')
      setDeleteSource(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Cannot delete this source')
    } finally { setDeleting(false) }
  }

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
          <Button onClick={() => {
              setForm({ name: '', description: '', website_url: '', schema_id: '', project_id: projectId ?? '', assigned_extractor_id: '', assigned_reviewer_id: '' })
              loadSchemasAndMembers(projectId ?? form.project_id ?? '')
              setShowCreate(true)
            }}>
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

      {/* Role-aware priority strip */}
      {isExtractor && !isReviewer && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* My sources */}
          {sources.filter(s => s.assigned_extractor_id === user?.id).length > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '12px 16px' }}>
              <div className="flex items-center justify-between mb-2">
                <p style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', margin: 0 }}>⛏️ My Sources ({sources.filter(s => s.assigned_extractor_id === user?.id).length})</p>
                <button onClick={() => setMineOnly(true)} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Filter ↓</button>
              </div>
              <p style={{ fontSize: 11, color: '#3b82f6', margin: 0 }}>Sources assigned to you — upload data, run LLM verify, fix errors</p>
            </div>
          )}
          {/* Available */}
          {sources.filter(s => !s.assigned_extractor_id && s.status === 'not_started').length > 0 && (
            <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: '12px 16px' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#065f46', margin: '0 0 4px' }}>✋ Available to Claim ({sources.filter(s => !s.assigned_extractor_id && s.status === 'not_started').length})</p>
              <p style={{ fontSize: 11, color: '#059669', margin: 0 }}>Open any green-ringed card below and click "Claim This Source"</p>
            </div>
          )}
        </div>
      )}

      {isReviewer && !isExtractor && (
        <div style={{ background: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: 12, padding: '12px 16px' }}>
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#5b21b6', margin: '0 0 2px' }}>
                🔍 My Review Queue ({sources.filter(s => s.assigned_reviewer_id === user?.id && ['ready_for_review','in_review','changes_requested'].includes(s.status)).length} pending)
              </p>
              <p style={{ fontSize: 11, color: '#7c3aed', margin: 0 }}>Purple-ringed cards are your assigned review sources — click to open and review records</p>
            </div>
            <button onClick={() => setMineOnly(true)} style={{ fontSize: 11, color: '#7c3aed', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Show mine only
            </button>
          </div>
        </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SIMPLE_STEPS.map(step => {
            const items = filtered.filter(s => step.statuses.includes(s.status))
            return (
              <div key={step.label}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span style={{ fontSize: 16 }}>{step.icon}</span>
                  <h3 className="text-sm font-semibold text-gray-700">{step.label}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full ml-auto">{items.length}</span>
                </div>
                <div className="space-y-3.5 min-h-[60px]">
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
                <div className="space-y-3.5 min-h-[60px]">
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
                    {safeFromNow(s.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <Link to={`/projects/${s.project_id}/sources/${s.id}`} className="text-brand-600 hover:text-brand-700 text-xs font-medium">
                        Open →
                      </Link>
                      {canManage && (
                        <button onClick={() => setDeleteSource(s)} className="p-1 text-gray-300 hover:text-red-500 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
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
            <option value="">
              {schemasLoading ? 'Loading schemas…' : isGlobal && !form.project_id ? 'Select a project first' : schemas.length === 0 ? 'No schemas found — create one first' : 'Select a schema…'}
            </option>
            {schemas.map(s => (
              <option key={s.id} value={s.id}>{s.name} (v{s.current_version})</option>
            ))}
          </Select>
          {!schemasLoading && schemas.length === 0 && (isGlobal ? !!form.project_id : true) && (
            <p className="text-xs text-amber-600 -mt-2">
              ⚠ No schemas found for this project. <a href={`/schemas?project_id=${isGlobal ? form.project_id : projectId}`} className="underline">Create a schema first</a>.
            </p>
          )}
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

      <ConfirmDialog
        open={!!deleteSource}
        title="Delete Source"
        description={`"${deleteSource?.name}" and all its records will be permanently deleted. Approved sources cannot be deleted.`}
        confirmLabel="Delete Source"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteSource}
        onCancel={() => setDeleteSource(null)}
      />
    </div>
  )
}

function SourceCard({ source, projectId, projectName }: { source: Source; projectId: string; projectName?: string }) {
  const { user } = useAuthStore()
  const roles = new Set(user?.roles ?? [])
  const isAdmin    = roles.has('org_admin') || roles.has('project_admin') || roles.has('qa_lead')
  const isExtractor = roles.has('pipeline_operator')
  const isReviewer  = roles.has('reviewer')

  const myId            = user?.id
  const claimedByMe     = source.assigned_extractor_id && source.assigned_extractor_id === myId
  const claimedByOther  = source.assigned_extractor_id && source.assigned_extractor_id !== myId
  const available       = !source.assigned_extractor_id && source.status === 'not_started'
  const myReview        = source.assigned_reviewer_id === myId
  const inExtractPhase  = ['not_started','extracting','needs_fixes'].includes(source.status)

  // Locked: claimed by someone else AND I'm a pure extractor (no admin/reviewer perms)
  const isLocked = !isAdmin && isExtractor && !isReviewer && claimedByOther && inExtractPhase

  const cardContent = (
    <Card hover={!isLocked} className={cn(
      'relative transition-all duration-150 space-y-2.5',
      isLocked ? 'pt-9 px-3.5 pb-3.5' : 'p-3.5',
      isLocked ? 'opacity-50 cursor-not-allowed bg-gray-50' : '',
      available && isExtractor && !isAdmin ? 'ring-2 ring-emerald-400 ring-offset-1' : '',
      claimedByMe ? 'ring-2 ring-blue-400 ring-offset-1' : '',
      myReview && isReviewer && !isAdmin ? 'ring-2 ring-purple-400 ring-offset-1' : '',
    )}>
      {/* Lock band */}
      {isLocked && (
        <div className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-3 py-1.5"
          style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', borderRadius: '12px 12px 0 0' }}>
          <Lock className="w-3 h-3 text-slate-500" />
          <span className="text-xs font-bold text-slate-500 truncate">
            Claimed · {source.assigned_extractor_name ?? 'another user'}
          </span>
        </div>
      )}
      {available && isExtractor && !isAdmin && (
        <span className="absolute top-2.5 right-2.5 text-xs font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-full">
          ✋ Claim
        </span>
      )}
      {claimedByMe && !isLocked && (
        <span className="absolute top-2.5 right-2.5 text-xs font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full">
          Mine
        </span>
      )}
      {myReview && isReviewer && !isAdmin && !claimedByMe && (
        <span className="absolute top-2.5 right-2.5 text-xs font-bold bg-purple-500 text-white px-2 py-0.5 rounded-full">
          🔍 Review
        </span>
      )}

      {projectName && (
        <p className="text-xs text-brand-600 font-medium flex items-center gap-1">
          <ArrowUpRight className="w-3 h-3" /> {projectName}
        </p>
      )}
      <p className={cn('text-sm font-semibold leading-snug line-clamp-2', isLocked ? 'text-gray-400' : 'text-gray-900')}>{source.name}</p>



      {!isLocked && source.website_url && (
        <p className="text-xs text-gray-400 flex items-center gap-1 truncate">
          <Globe className="w-3 h-3 shrink-0" /> {source.website_url.replace(/^https?:\/\//, '')}
        </p>
      )}
      {!isLocked && source.total_records > 0 && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-emerald-600 font-medium">{source.valid_records}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-500">{source.total_records}</span>
          <span className="text-gray-400">valid</span>
          {source.invalid_records > 0 && <AlertCircle className="w-3 h-3 text-amber-500 ml-auto" />}
        </div>
      )}
      <div className="flex items-center justify-between pt-1.5 border-t border-gray-50">
        {!isLocked && source.assigned_extractor_name ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={source.assigned_extractor_name} size="sm" />
            <span className="text-xs text-gray-500 truncate max-w-[100px]">{source.assigned_extractor_name}</span>
          </div>
        ) : isLocked ? (
          <span className="text-xs text-gray-300 flex items-center gap-1"><Lock className="w-3 h-3" /> Not available</span>
        ) : (
          <span className="text-xs text-gray-300 flex items-center gap-1"><UserIcon className="w-3 h-3" /> Unassigned</span>
        )}
        <span className="text-xs text-gray-300">{safeFromNow(source.updated_at, false)}</span>
      </div>
    </Card>
  )

  if (isLocked) return <div title={`Claimed by ${source.assigned_extractor_name}`}>{cardContent}</div>
  return <Link to={`/projects/${projectId}/sources/${source.id}`}>{cardContent}</Link>
}
