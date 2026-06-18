import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, Link as LinkIcon, BookOpen, ClipboardList,
  Plus, Trash2, Download, Upload, CheckCircle, XCircle, RotateCcw,
} from 'lucide-react'
import { projectsApi, resourcesApi, workSubmissionsApi, usersApi } from '@/api/client'
import type { Project, ProjectMember, ProjectResource, ProjectSubmission, ResourceType, User } from '@/types'
import { useAuthStore } from '@/store/auth'
import { isProjectAdmin, canReviewProject } from '@/lib/permissions'
import {
  Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, cn, toast,
} from '@/components/ui'
import { formatDistanceToNow } from 'date-fns'

type Tab = 'overview' | 'resources' | 'submissions' | 'members'

const RESOURCE_ICON: Record<ResourceType, typeof FileText> = {
  file: FileText, link: LinkIcon, instruction: ClipboardList, sop: BookOpen,
}
const RESOURCE_LABEL: Record<ResourceType, string> = {
  file: 'File', link: 'Link', instruction: 'Instructions', sop: 'SOP',
}
const SUBMISSION_STATUS_COLOR: Record<string, 'gray' | 'amber' | 'green' | 'red' | 'blue'> = {
  submitted: 'gray', in_review: 'amber', approved: 'green', rejected: 'red', needs_revision: 'amber',
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuthStore()
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [resources, setResources] = useState<ProjectResource[]>([])
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')

  const load = () => {
    if (!projectId) return
    Promise.all([
      projectsApi.get(projectId).then(setProject),
      projectsApi.listMembers(projectId).then(setMembers),
      resourcesApi.list(projectId).then(setResources),
      workSubmissionsApi.list(projectId).then(setSubmissions).catch(() => setSubmissions([])),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => { setLoading(true); load() }, [projectId])

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  if (!project || !user) return <EmptyState title="Project not found" />

  const isAdmin = isProjectAdmin(user.roles, user.id, members)
  const canReview = canReviewProject(user.roles, user.id, members)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'resources', label: 'Resources' },
    { id: 'submissions', label: 'Submissions' },
    ...(isAdmin ? [{ id: 'members' as Tab, label: 'Members' }] : []),
  ]

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="text-gray-400 hover:text-gray-600 transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            {project.description && <p className="text-sm text-gray-500 mt-0.5">{project.description}</p>}
          </div>
        </div>
        <Badge variant={project.status === 'active' ? 'green' : 'gray'}>{project.status}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Resources', value: resources.length },
          { label: 'Members', value: members.length },
          { label: 'Submissions', value: submissions.length },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      <div className="border-b border-gray-200 flex gap-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'pb-3 text-sm font-medium border-b-2 transition',
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Card className="p-6 space-y-3">
          <h3 className="font-semibold text-gray-700 text-sm">Project Info</h3>
          {[
            { label: 'Project ID', value: project.id },
            { label: 'Status', value: project.status },
            { label: 'Created', value: formatDistanceToNow(new Date(project.created_at), { addSuffix: true }) },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-800 font-mono text-xs">{value}</span>
            </div>
          ))}
        </Card>
      )}

      {tab === 'resources' && (
        <ResourcesTab projectId={project.id} resources={resources} isAdmin={isAdmin} onChange={load} />
      )}

      {tab === 'submissions' && (
        <SubmissionsTab
          projectId={project.id}
          submissions={submissions}
          members={members}
          currentUserId={user.id}
          canReview={canReview}
          onChange={load}
        />
      )}

      {tab === 'members' && isAdmin && (
        <MembersTab projectId={project.id} members={members} onChange={load} />
      )}
    </div>
  )
}

// ─── Resources tab ──────────────────────────────────────────────────────────
function ResourcesTab({ projectId, resources, isAdmin, onChange }: {
  projectId: string; resources: ProjectResource[]; isAdmin: boolean; onChange: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [type, setType] = useState<ResourceType>('sop')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const reset = () => { setType('sop'); setTitle(''); setDescription(''); setUrl(''); setBody(''); setFile(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (type === 'link') {
        await resourcesApi.createLink(projectId, title, url, description || undefined)
      } else if (type === 'instruction' || type === 'sop') {
        await resourcesApi.createInstruction(projectId, type, title, body, description || undefined)
      } else {
        if (!file) return
        const fd = new FormData()
        fd.append('type', 'file')
        fd.append('title', title)
        if (description) fd.append('description', description)
        fd.append('file', file)
        await resourcesApi.createFile(projectId, fd)
      }
      toast.success('Resource added')
      setShowAdd(false)
      reset()
      onChange()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to add resource')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (resourceId: string) => {
    if (!confirm('Delete this resource?')) return
    try {
      await resourcesApi.delete(projectId, resourceId)
      toast.success('Resource deleted')
      onChange()
    } catch {
      toast.error('Failed to delete resource')
    }
  }

  const handleDownload = async (r: ProjectResource) => {
    try {
      await resourcesApi.download(projectId, r.id, r.file_name || r.title)
    } catch {
      toast.error('Download failed')
    }
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Resource</Button>
        </div>
      )}

      {resources.length === 0 ? (
        <EmptyState
          title="No guidelines attached yet"
          description={isAdmin ? "Attach SOPs, instructions, files, or links for annotators to reference." : "The project admin hasn't attached any guidelines yet."}
          action={isAdmin ? <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Resource</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {resources.map(r => {
            const Icon = RESOURCE_ICON[r.type]
            return (
              <Card key={r.id} className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-brand-600" />
                  </div>
                  <Badge variant="gray">{RESOURCE_LABEL[r.type]}</Badge>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{r.title}</h3>
                  {r.description && <p className="text-sm text-gray-500 mt-1">{r.description}</p>}
                </div>
                {(r.type === 'instruction' || r.type === 'sop') && r.body && (
                  <p className="text-xs text-gray-600 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {r.body}
                  </p>
                )}
                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                  {r.type === 'link' ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5" /> Open link
                    </a>
                  ) : r.file_name ? (
                    <button onClick={() => handleDownload(r)} className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> Download
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                  )}
                  {isAdmin && (
                    <button onClick={() => handleDelete(r.id)} className="text-gray-400 hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Resource" size="lg">
        <form onSubmit={submit} className="space-y-4">
          <Select label="Type" value={type} onChange={e => setType(e.target.value as ResourceType)}>
            <option value="sop">SOP</option>
            <option value="instruction">Instructions</option>
            <option value="file">File</option>
            <option value="link">Link</option>
          </Select>
          <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
          <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />

          {type === 'link' && (
            <Input label="URL" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" required />
          )}

          {(type === 'instruction' || type === 'sop') && (
            <Textarea label="Content" rows={8} value={body} onChange={e => setBody(e.target.value)} required placeholder="Write the guideline or SOP text here…" />
          )}

          {type === 'file' && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">File</label>
              <input
                type="file"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:text-sm"
                required
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Add Resource</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ─── Submissions tab ────────────────────────────────────────────────────────
function SubmissionsTab({ projectId, submissions, members, currentUserId, canReview, onChange }: {
  projectId: string; submissions: ProjectSubmission[]; members: ProjectMember[]
  currentUserId: string; canReview: boolean; onChange: () => void
}) {
  const [view, setView] = useState<'mine' | 'queue'>('mine')
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitting, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ProjectSubmission | null>(null)

  const nameFor = (userId: string) => members.find(m => m.user_id === userId)?.full_name ?? userId.slice(0, 8)

  const mine = submissions.filter(s => s.user_id === currentUserId)
  const queue = submissions

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setSaving(true)
    try {
      const fd = new FormData()
      if (title) fd.append('title', title)
      if (note) fd.append('note', note)
      fd.append('file', file)
      await workSubmissionsApi.create(projectId, fd)
      toast.success('Work submitted')
      setShowSubmit(false)
      setTitle(''); setNote(''); setFile(null)
      onChange()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Submission failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async (s: ProjectSubmission) => {
    try {
      await workSubmissionsApi.download(s.id, s.file_name)
    } catch {
      toast.error('Download failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {canReview ? (
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {([['mine', 'My Submissions'], ['queue', 'Review Queue']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn('px-3 py-1 rounded-lg text-xs font-medium transition',
                  view === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}
              >
                {label}
              </button>
            ))}
          </div>
        ) : <div />}
        <Button onClick={() => setShowSubmit(true)}><Upload className="w-4 h-4" /> Submit Work</Button>
      </div>

      {(view === 'mine' ? mine : queue).length === 0 ? (
        <EmptyState
          title={view === 'mine' ? 'No submissions yet' : 'Nothing to review'}
          description={view === 'mine' ? 'Submit your completed work for this project.' : 'No submissions are waiting for review.'}
        />
      ) : (
        <div className="space-y-2">
          {(view === 'mine' ? mine : queue).map(s => (
            <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{s.title || s.file_name}</p>
                  <Badge variant={SUBMISSION_STATUS_COLOR[s.status] ?? 'gray'}>{s.status.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {view === 'queue' && `${nameFor(s.user_id)} · `}
                  {s.file_name} · {formatDistanceToNow(new Date(s.submitted_at), { addSuffix: true })}
                </p>
                {s.note && <p className="text-xs text-gray-500 mt-1">{s.note}</p>}
                {s.review_notes && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1.5 inline-block">
                    Reviewer note: {s.review_notes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => handleDownload(s)}>
                  <Download className="w-3.5 h-3.5" />
                </Button>
                {view === 'queue' && canReview && s.status === 'submitted' && (
                  <Button size="sm" onClick={() => setReviewTarget(s)}>Review</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showSubmit} onClose={() => setShowSubmit(false)} title="Submit Work">
        <form onSubmit={submit} className="space-y-4">
          <Input label="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} placeholder="What is this submission?" />
          <Textarea label="Note (optional)" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the reviewer should know" />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">File</label>
            <input
              type="file"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:text-sm"
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button type="submit" loading={submitting} disabled={!file}><Upload className="w-4 h-4" /> Submit</Button>
          </div>
        </form>
      </Modal>

      <ReviewModal submission={reviewTarget} onClose={() => setReviewTarget(null)} onDone={onChange} />
    </div>
  )
}

function ReviewModal({ submission, onClose, onDone }: {
  submission: ProjectSubmission | null; onClose: () => void; onDone: () => void
}) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  if (!submission) return null

  const act = async (action: 'approve' | 'reject' | 'needs_revision') => {
    setSaving(true)
    try {
      await workSubmissionsApi.review(submission.id, action, notes || undefined)
      toast.success(`Submission ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'sent back for revision'}`)
      setNotes('')
      onClose()
      onDone()
    } catch {
      toast.error('Review action failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!submission} onClose={onClose} title={`Review: ${submission.title || submission.file_name}`}>
      <div className="space-y-4">
        <Textarea label="Notes (optional)" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Feedback for the submitter" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={() => act('needs_revision')} loading={saving}>
            <RotateCcw className="w-3.5 h-3.5" /> Needs Revision
          </Button>
          <Button variant="danger" size="sm" onClick={() => act('reject')} loading={saving}>
            <XCircle className="w-3.5 h-3.5" /> Reject
          </Button>
          <Button size="sm" onClick={() => act('approve')} loading={saving}>
            <CheckCircle className="w-3.5 h-3.5" /> Approve
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Members tab ────────────────────────────────────────────────────────────
const PROJECT_ROLES = ['project_admin', 'qa_lead', 'pipeline_operator', 'reviewer', 'read_only']

function MembersTab({ projectId, members, onChange }: {
  projectId: string; members: ProjectMember[]; onChange: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('reviewer')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (showAdd) usersApi.list().then((r: any) => setAllUsers(r.items)).catch(() => toast.error('Could not load users'))
  }, [showAdd])

  const availableUsers = allUsers.filter(u => !members.some(m => m.user_id === u.id))

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return
    setSaving(true)
    try {
      await projectsApi.addMember(projectId, userId, role)
      toast.success('Member added')
      setShowAdd(false)
      setUserId(''); setRole('reviewer')
      onChange()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to add member')
    } finally {
      setSaving(false)
    }
  }

  const removeMember = async (memberId: string) => {
    if (!confirm('Remove this member from the project?')) return
    try {
      await projectsApi.removeMember(projectId, memberId)
      toast.success('Member removed')
      onChange()
    } catch {
      toast.error('Failed to remove member')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Member</Button>
      </div>

      <Card>
        {members.length === 0 ? (
          <EmptyState title="No members yet" description="Add people to give them access to this project." />
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={m.full_name} size="sm" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                    <p className="text-xs text-gray-500">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="blue">{m.role.replace(/_/g, ' ')}</Badge>
                  <button onClick={() => removeMember(m.user_id)} className="text-gray-400 hover:text-red-600 transition">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Member">
        <form onSubmit={addMember} className="space-y-4">
          <Select label="User" value={userId} onChange={e => setUserId(e.target.value)} required>
            <option value="">Select a user…</option>
            {availableUsers.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
          </Select>
          <Select label="Project role" value={role} onChange={e => setRole(e.target.value)}>
            {PROJECT_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </Select>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!userId}>Add Member</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}