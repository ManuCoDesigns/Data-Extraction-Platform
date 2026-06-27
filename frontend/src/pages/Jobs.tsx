import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Upload, FileText, RefreshCw, Search, ChevronLeft, ChevronRight,
  AlertCircle, CheckCircle, Clock, Send, Zap, Eye
} from 'lucide-react'
import { jobsApi, projectsApi, schemasApi } from '@/api/client'
import type { Job, Project, Schema } from '@/types'
import {
  Button, Card, Badge, Modal, Input, Select,
  EmptyState, Spinner, ProgressBar, cn, toast, safeFromNow,
} from '@/components/ui'
import { useCapability } from '@/lib/permissions'

const ACTIVE_STATES   = ['queued', 'parsing', 'extracting', 'llm_review']
const FAILED_STATES   = ['parse_failed', 'extraction_failed', 'llm_failed', 'validation_failed', 'submission_failed']
const REVIEW_STATES   = ['ready_for_review', 'in_review']

// ── Status meta ───────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  queued:            { label: 'Queued',           color: '#64748b', bg: '#f1f5f9', icon: <Clock size={12}/> },
  parsing:           { label: 'Parsing',          color: '#2563eb', bg: '#eff6ff', icon: <RefreshCw size={12} className="animate-spin"/> },
  extracting:        { label: 'Extracting',       color: '#7c3aed', bg: '#f5f3ff', icon: <Zap size={12}/> },
  llm_review:        { label: 'AI Review',        color: '#0891b2', bg: '#ecfeff', icon: <RefreshCw size={12} className="animate-spin"/> },
  ready_for_review:  { label: 'Awaiting Review',  color: '#d97706', bg: '#fffbeb', icon: <Eye size={12}/> },
  in_review:         { label: 'In Review',        color: '#9333ea', bg: '#faf5ff', icon: <Eye size={12}/> },
  submitted:         { label: 'Submitted',        color: '#059669', bg: '#ecfdf5', icon: <CheckCircle size={12}/> },
  validated:         { label: 'Validated',        color: '#059669', bg: '#ecfdf5', icon: <CheckCircle size={12}/> },
  archived:          { label: 'Archived',         color: '#94a3b8', bg: '#f8fafc', icon: <CheckCircle size={12}/> },
  parse_failed:      { label: 'Parse Failed',     color: '#dc2626', bg: '#fef2f2', icon: <AlertCircle size={12}/> },
  extraction_failed: { label: 'Extraction Failed',color: '#dc2626', bg: '#fef2f2', icon: <AlertCircle size={12}/> },
  llm_failed:        { label: 'AI Failed',        color: '#dc2626', bg: '#fef2f2', icon: <AlertCircle size={12}/> },
  submission_failed: { label: 'Submit Failed',    color: '#dc2626', bg: '#fef2f2', icon: <AlertCircle size={12}/> },
}

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9', icon: null }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: m.bg, color: m.color, fontSize: 11, fontWeight: 700, border: `1px solid ${m.color}30` }}>
      {m.icon}{m.label}
    </span>
  )
}

// ── Pipeline stage indicator ───────────────────────────────────────────────────
function PipelineStages({ status, extracted, approved, submitted }: { status: string; extracted: number; approved: number; submitted: number }) {
  const stages = [
    { key: 'extract', label: 'Extract',  done: !['queued','parsing','extracting'].includes(status) || extracted > 0 },
    { key: 'ai',      label: 'AI Check', done: !['queued','parsing','extracting','llm_review'].includes(status) },
    { key: 'review',  label: 'Review',   done: approved > 0 || status === 'submitted' },
    { key: 'submit',  label: 'Submit',   done: status === 'submitted' || submitted > 0 },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {stages.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: s.done ? '#059669' : '#cbd5e1', whiteSpace: 'nowrap' }}>
            {s.done ? '✓ ' : '○ '}{s.label}
          </span>
          {i < stages.length - 1 && <span style={{ color: '#e2e8f0', fontSize: 10 }}>›</span>}
        </div>
      ))}
    </div>
  )
}

export function JobsPage() {
  const navigate   = useNavigate()
  const canUpload  = useCapability('upload_extraction_jobs')
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs]         = useState<Job[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [showUpload, setShowUpload] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [schemas, setSchemas]   = useState<Schema[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm]   = useState({ project_id: '', schema_id: '', job_name: '' })
  const [file, setFile]   = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage]   = useState(1)
  const PAGE_SIZE = 20

  const statusFilter  = searchParams.get('status') || ''
  const projectFilter = searchParams.get('project_id') || ''

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    const params: Record<string, string | number> = { page, page_size: PAGE_SIZE }
    if (statusFilter) params.status = statusFilter
    if (projectFilter) params.project_id = projectFilter
    return jobsApi.list(params)
      .then(r => { setJobs(r.items); setTotal(r.total); setLastRefresh(Date.now()) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, statusFilter, projectFilter])
  useEffect(() => { projectsApi.list().then(r => setProjects(r.items)).catch(() => {}) }, [])
  useEffect(() => {
    if (form.project_id) schemasApi.list(form.project_id).then(r => setSchemas(Array.isArray(r) ? r : [])).catch(() => setSchemas([]))
    else setSchemas([])
  }, [form.project_id])

  // Poll every 5s when active jobs exist
  useEffect(() => {
    const hasActive = jobs.some(j => ACTIVE_STATES.includes(j.status))
    if (!hasActive) return
    const iv = setInterval(() => load(true), 5000)
    return () => clearInterval(iv)
  }, [jobs.map(j => j.status).join(',')])

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !form.project_id || !form.schema_id || !form.job_name) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('job_name', form.job_name)
      fd.append('schema_id', form.schema_id)
      const newJob = await jobsApi.upload(form.project_id, fd)
      toast.success('Job created — extraction starting…')
      setShowUpload(false); setFile(null)
      setForm({ project_id: '', schema_id: '', job_name: '' })
      await load()
      if (newJob?.id) navigate(`/jobs/${newJob.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Upload failed')
    } finally { setUploading(false) }
  }

  const filteredJobs = jobs.filter(j =>
    !search || j.name.toLowerCase().includes(search.toLowerCase()) ||
    (j.source_file_name ?? '').toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeCount = jobs.filter(j => ACTIVE_STATES.includes(j.status)).length
  const awaitingReview = jobs.filter(j => REVIEW_STATES.includes(j.status)).length

  return (
    <div className="p-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-gray-500">{total} total</span>
            {activeCount > 0 && <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">⚡ {activeCount} running</span>}
            {awaitingReview > 0 && <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">👁 {awaitingReview} awaiting your review</span>}
            {activeCount === 0 && <span className="text-xs text-gray-400">Last refresh {new Date(lastRefresh).toLocaleTimeString()}</span>}
            {activeCount > 0 && <span className="text-xs text-purple-500 flex items-center gap-1"><RefreshCw size={10} className="animate-spin"/>Auto-refreshing every 5s</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => load()} title="Refresh now">
            <RefreshCw className="w-4 h-4" />
          </Button>
          {canUpload && (
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline explainer */}
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 14, padding: '12px 20px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', margin: '0 0 6px' }}>📋 How the Job Pipeline Works</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#0369a1' }}>
          <span>1️⃣ <strong>Extract</strong> — file is parsed and records created</span>
          <span>→</span>
          <span>2️⃣ <strong>AI Check</strong> — Claude reviews for quality issues</span>
          <span>→</span>
          <span>3️⃣ <strong>Human Review</strong> — reviewer approves each record</span>
          <span>→</span>
          <span>4️⃣ <strong>Submit</strong> — approved records exported and locked</span>
        </div>
        <p style={{ fontSize: 11, color: '#0369a1', margin: '6px 0 0', opacity: 0.8 }}>
          ⚠ <strong>"Awaiting Review"</strong> means the AI has finished — a human reviewer still needs to open the job and approve the records before submission.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: '', label: 'All' },
            { key: 'extracting', label: '⚡ Running' },
            { key: 'ready_for_review', label: '👁 Needs Review' },
            { key: 'in_review', label: '🔍 In Review' },
            { key: 'submitted', label: '✓ Submitted' },
            { key: 'parse_failed', label: '✗ Failed' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => { setSearchParams(key ? { status: key } : {}); setPage(1) }}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                statusFilter === key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}>
              {label}
            </button>
          ))}
        </div>
        <Select value={projectFilter}
          onChange={e => { setSearchParams(e.target.value ? { project_id: e.target.value } : {}); setPage(1) }}
          className="w-44 ml-auto">
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input type="text" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 w-44" />
        </div>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        ) : filteredJobs.length === 0 ? (
          <EmptyState title="No jobs found"
            description={canUpload ? "Upload a document to start your first extraction." : "No jobs match your filters."}
            action={canUpload ? <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4" /> New Job</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Job', 'Status', 'Pipeline', 'Records', 'Created', ''].map((h, i) => (
                    <th key={h+i} className={cn('text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide', i > 1 && 'hidden md:table-cell')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredJobs.map(job => {
                  const isActive = ACTIVE_STATES.includes(job.status)
                  const isFailed = FAILED_STATES.includes(job.status)
                  const needsReview = REVIEW_STATES.includes(job.status)
                  const isSubmitted = job.status === 'submitted'
                  return (
                    <tr key={job.id}
                      style={{ borderLeft: `3px solid ${isFailed ? '#ef4444' : isSubmitted ? '#10b981' : needsReview ? '#f59e0b' : isActive ? '#8b5cf6' : '#e2e8f0'}` }}
                      className="hover:bg-slate-50 transition cursor-pointer"
                      onClick={() => navigate(`/jobs/${job.id}`)}>

                      {/* Job name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: isFailed ? '#fef2f2' : '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {isFailed ? <AlertCircle size={16} color="#ef4444"/> : <FileText size={16} color="#4f46e5"/>}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate max-w-[200px]">{job.name}</p>
                            <p className="text-xs text-gray-400 truncate">{job.source_file_name ?? job.source_type?.toUpperCase()}</p>
                            {isActive && (job.total_raw_records ?? 0) > 0 && (
                              <div className="mt-1 w-32">
                                <ProgressBar value={job.total_extracted} max={job.total_raw_records ?? job.total_extracted} />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4"><StatusPill status={job.status} /></td>

                      {/* Pipeline stages */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        <PipelineStages status={job.status}
                          extracted={job.total_extracted} approved={job.total_approved} submitted={job.total_submitted ?? 0} />
                      </td>

                      {/* Counts */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        <div className="flex items-center gap-2 text-xs">
                          <span style={{ padding: '2px 8px', borderRadius: 20, background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>{job.total_extracted} extracted</span>
                          {job.total_approved > 0 && <span style={{ padding: '2px 8px', borderRadius: 20, background: '#ecfdf5', color: '#059669', fontWeight: 600 }}>✓ {job.total_approved} approved</span>}
                        </div>
                      </td>

                      {/* Created */}
                      <td className="px-4 py-4 text-xs text-gray-400 hidden md:table-cell whitespace-nowrap">{safeFromNow(job.created_at)}</td>

                      {/* Action */}
                      <td className="px-4 py-4 text-right">
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                          background: needsReview ? '#fffbeb' : '#eff6ff',
                          color: needsReview ? '#d97706' : '#2563eb',
                          border: `1px solid ${needsReview ? '#fcd34d' : '#bfdbfe'}` }}>
                          {needsReview ? '👁 Review' : 'Open →'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages} · {total} jobs</span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}><ChevronLeft className="w-3.5 h-3.5"/></Button>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}><ChevronRight className="w-3.5 h-3.5"/></Button>
          </div>
        </div>
      )}

      {/* Upload modal */}
      <Modal open={showUpload} onClose={() => { if (!uploading) setShowUpload(false) }} title="New Extraction Job" description="Upload a document to extract structured records.">
        <form onSubmit={handleUpload} className="space-y-4">
          <Select label="Project" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value, schema_id: '' }))} required>
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="Schema" value={form.schema_id} onChange={e => setForm(f => ({ ...f, schema_id: e.target.value }))} required disabled={!form.project_id || schemas.length === 0}>
            <option value="">{!form.project_id ? 'Select a project first' : schemas.length === 0 ? 'No schemas in this project' : 'Select a schema…'}</option>
            {schemas.filter(s => !s.is_archived).map(s => <option key={s.id} value={s.id}>{s.name} (v{s.current_version})</option>)}
          </Select>
          <Input label="Job name" value={form.job_name} onChange={e => setForm(f => ({ ...f, job_name: e.target.value }))} placeholder="e.g. BGS DMQ 2020 — Run 1" required />
          <div onClick={() => !uploading && fileRef.current?.click()}
            className={cn('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition',
              file ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
              uploading && 'opacity-60 cursor-not-allowed')}>
            <input ref={fileRef} type="file" accept=".pdf,.csv,.xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
            {file ? <div><p className="text-sm font-medium text-brand-700">{file.name}</p><p className="text-xs text-gray-500">{(file.size/1024).toFixed(1)} KB</p></div>
              : <div><p className="text-sm text-gray-600 font-medium">Drop a file or click to browse</p><p className="text-xs text-gray-400 mt-1">PDF, CSV, XLSX — max 100MB</p></div>}
          </div>
          {uploading && <div className="flex items-center gap-3 text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3"><Spinner className="w-4 h-4"/>Uploading and queuing extraction…</div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</Button>
            <Button type="submit" loading={uploading} disabled={!file || !form.project_id || !form.schema_id || !form.job_name}><Upload className="w-4 h-4"/> Start Extraction</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
