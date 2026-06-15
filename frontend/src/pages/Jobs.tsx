import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Upload, FileText, RefreshCw } from 'lucide-react'
import { jobsApi, projectsApi, schemasApi } from '@/api/client'
import type { Job, Project, Schema } from '@/types'
import {
  Button, Card, JobStatusBadge, Modal, Input, Select, EmptyState, Spinner, cn
} from '@/components/ui'
import { formatDistanceToNow, format } from 'date-fns'

const STATUSES = [
  'queued', 'parsing', 'extracting', 'llm_review', 'ready_for_review',
  'in_review', 'validated', 'submitted', 'parse_failed', 'extraction_failed',
]

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ project_id: '', schema_id: '', job_name: '' })
  const [file, setFile] = useState<File | null>(null)
  const [page, setPage] = useState(1)

  const statusFilter = searchParams.get('status') || ''
  const projectFilter = searchParams.get('project_id') || ''

  const load = () => {
    setLoading(true)
    const params: Record<string, string | number> = { page, page_size: 25 }
    if (statusFilter) params.status = statusFilter
    if (projectFilter) params.project_id = projectFilter
    jobsApi.list(params)
      .then(r => { setJobs(r.items); setTotal(r.total) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, statusFilter, projectFilter])

  useEffect(() => {
    projectsApi.list().then(r => setProjects(r.items)).catch(() => {})
  }, [])

  useEffect(() => {
    if (form.project_id) {
      schemasApi.list(form.project_id).then(setSchemas).catch(() => {})
    }
  }, [form.project_id])

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !form.project_id || !form.schema_id || !form.job_name) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('job_name', form.job_name)
    fd.append('schema_id', form.schema_id)
    try {
      await jobsApi.upload(form.project_id, fd)
      setShowUpload(false)
      setFile(null)
      setForm({ project_id: '', schema_id: '', job_name: '' })
      load()
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">{total} total jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="w-4 h-4" /> New Extraction Job
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setSearchParams({}); setPage(1) }}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm font-medium border transition',
            !statusFilter ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          )}
        >
          All
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => { setSearchParams({ status: s }); setPage(1) }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition',
              statusFilter === s
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            )}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No jobs found"
            description="Upload a document to start your first extraction."
            action={
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="w-4 h-4" /> New Job
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Extracted</th>
                  <th className="text-right px-4 py-3 font-medium">Approved</th>
                  <th className="text-right px-4 py-3 font-medium">Submitted</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map(job => (
                  <tr key={job.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        <div>
                          <p className="font-medium text-gray-900">{job.name}</p>
                          <p className="text-xs text-gray-400">
                            {job.source_file_name ?? job.source_type.toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 font-medium">
                      {job.total_extracted}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-medium">
                      {job.total_approved}
                    </td>
                    <td className="px-4 py-3 text-right text-brand-700 font-medium">
                      {job.total_submitted}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-brand-600 hover:text-brand-700 font-medium text-xs"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Upload modal */}
      <Modal open={showUpload} onClose={() => setShowUpload(false)} title="New Extraction Job">
        <form onSubmit={handleUpload} className="space-y-4">
          <Select
            label="Project"
            value={form.project_id}
            onChange={e => setForm(f => ({ ...f, project_id: e.target.value, schema_id: '' }))}
            required
          >
            <option value="">Select a project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
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
            {schemas.map(s => (
              <option key={s.id} value={s.id}>{s.name} (v{s.current_version})</option>
            ))}
          </Select>

          <Input
            label="Job name"
            value={form.job_name}
            onChange={e => setForm(f => ({ ...f, job_name: e.target.value }))}
            placeholder="BGS DMQ 2020 — Run 1"
            required
          />

          {/* File drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition',
              file ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'
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

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={uploading} disabled={!file}>
              <Upload className="w-4 h-4" /> Start Extraction
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
