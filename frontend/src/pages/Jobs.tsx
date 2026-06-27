import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Plus, Upload, FileText, RefreshCw, Search,
  ChevronLeft, ChevronRight, AlertCircle
} from 'lucide-react'
import { jobsApi, projectsApi, schemasApi } from '@/api/client'
import type { Job, Project, Schema } from '@/types'
import {
  Button, Card, JobStatusBadge, Modal, Input, Select,
  EmptyState, Spinner, ProgressBar, cn, toast, safeFromNow, safeFormat,
} from '@/components/ui'
import { useCapability } from '@/lib/permissions'

const TERMINAL_STATES = [
  'ready_for_review', 'in_review', 'validated', 'submitted', 'archived',
  'parse_failed', 'extraction_failed', 'llm_failed', 'validation_failed', 'submission_failed'
]
const ACTIVE_STATES = ['queued', 'parsing', 'extracting', 'llm_review']
const STATUSES = [...ACTIVE_STATES, ...TERMINAL_STATES]

export function JobsPage() {
  const navigate = useNavigate()
  const canUpload = useCapability('upload_extraction_jobs')
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ project_id: '', schema_id: '', job_name: '' })
  const [file, setFile] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const statusFilter = searchParams.get('status') || ''
  const projectFilter = searchParams.get('project_id') || ''

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    const params: Record<string, string | number> = { page, page_size: PAGE_SIZE }
    if (statusFilter) params.status = statusFilter
    if (projectFilter) params.project_id = projectFilter
    return jobsApi.list(params)
      .then(r => { setJobs(r.items); setTotal(r.total) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, statusFilter, projectFilter])

  useEffect(() => {
    projectsApi.list().then(r => setProjects(r.items)).catch(() => {})
  }, [])

  useEffect(() => {
    if (form.project_id) schemasApi.list(form.project_id).then(r => setSchemas(Array.isArray(r) ? r : [])).catch(() => setSchemas([]))
    else setSchemas([])
  }, [form.project_id])

  // Poll active jobs every 4 seconds
  useEffect(() => {
    const hasActive = jobs.some(j => ACTIVE_STATES.includes(j.status))
    if (!hasActive) return
    const iv = setInterval(() => load(true), 4000)
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
      setShowUpload(false)
      setFile(null)
      setForm({ project_id: '', schema_id: '', job_name: '' })
      await load()
      // Navigate to the new job detail page
      if (newJob?.id) navigate(`/jobs/${newJob.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const filteredJobs = jobs.filter(j =>
    !search || j.name.toLowerCase().includes(search.toLowerCase()) ||
    (j.source_file_name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeCount = jobs.filter(j => ACTIVE_STATES.includes(j.status)).length

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} total jobs{activeCount > 0 && <span className="ml-2 text-brand-600 font-medium">· {activeCount} running</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => load()} title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
          {canUpload && (
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => { setSearchParams({}); setPage(1) }}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
              !statusFilter ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >All</button>
          {['queued', 'extracting', 'ready_for_review', 'in_review', 'submitted', 'parse_failed'].map(s => (
            <button
              key={s}
              onClick={() => { setSearchParams({ status: s }); setPage(1) }}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                statusFilter === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Project filter */}
        <Select
          value={projectFilter}
          onChange={e => { setSearchParams(projectFilter ? { project_id: e.target.value } : {}); setPage(1) }}
          className="w-44 ml-auto"
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search jobs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 w-44"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            title="No jobs found"
            description={canUpload ? "Upload a document to start your first extraction." : "No jobs match your filters."}
            action={canUpload ? <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4" /> New Job</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Extracted</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Approved</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredJobs.map(job => {
                  const isActive = ACTIVE_STATES.includes(job.status)
                  const isFailed = job.status.includes('failed')
                  return (
                    <tr key={job.id} className={cn('hover:bg-gray-50/60 transition', isFailed && 'bg-red-50/30')}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                            isFailed ? 'bg-red-50' : 'bg-brand-50'
                          )}>
                            {isFailed
                              ? <AlertCircle className="w-4 h-4 text-red-500" />
                              : <FileText className="w-4 h-4 text-brand-600" />
                            }
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{job.name}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {job.source_file_name ?? job.source_type?.toUpperCase()}
                            </p>
                            {isActive && job.total_raw_records && job.total_raw_records > 0 && (
                              <div className="mt-1 w-32">
                                <ProgressBar value={job.total_extracted} max={job.total_raw_records} />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium hidden sm:table-cell">
                        {job.total_extracted}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-700 font-medium hidden sm:table-cell">
                        {job.total_approved}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap hidden md:table-cell">
                        {safeFromNow(job.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/jobs/${job.id}`} className="text-brand-600 hover:text-brand-700 font-medium text-xs whitespace-nowrap">
                          Open →
                        </Link>
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
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Upload modal */}
      <Modal open={showUpload} onClose={() => { if (!uploading) setShowUpload(false) }} title="New Extraction Job" description="Upload a document to extract structured records.">
        <form onSubmit={handleUpload} className="space-y-4">
          <Select
            label="Project"
            value={form.project_id}
            onChange={e => setForm(f => ({ ...f, project_id: e.target.value, schema_id: '' }))}
            required
          >
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>

          <Select
            label="Schema"
            value={form.schema_id}
            onChange={e => setForm(f => ({ ...f, schema_id: e.target.value }))}
            required
            disabled={!form.project_id || schemas.length === 0}
          >
            <option value="">
              {!form.project_id ? 'Select a project first' : schemas.length === 0 ? 'No schemas in this project' : 'Select a schema…'}
            </option>
            {schemas.filter(s => !s.is_archived).map(s => (
              <option key={s.id} value={s.id}>{s.name} (v{s.current_version})</option>
            ))}
          </Select>

          <Input
            label="Job name"
            value={form.job_name}
            onChange={e => setForm(f => ({ ...f, job_name: e.target.value }))}
            placeholder="e.g. BGS DMQ 2020 — Run 1"
            required
          />

          {/* File drop zone */}
          <div
            onClick={() => !uploading && fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition',
              file ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
              uploading && 'opacity-60 cursor-not-allowed'
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,.xlsx,.xls"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-brand-700">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 font-medium">Drop a file or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">PDF, CSV, XLSX — max 100MB</p>
              </div>
            )}
          </div>

          {uploading && (
            <div className="flex items-center gap-3 text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3">
              <Spinner className="w-4 h-4" />
              Uploading and queuing extraction…
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" loading={uploading} disabled={!file || !form.project_id || !form.schema_id || !form.job_name}>
              <Upload className="w-4 h-4" /> Start Extraction
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
