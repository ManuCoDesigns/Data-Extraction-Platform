import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, Clock, RefreshCw, Send, RotateCcw, AlertCircle } from 'lucide-react'
import { jobsApi, recordsApi, submissionApi } from '@/api/client'
import type { Job, JobStateHistory, ExtractedRecord } from '@/types'
import {
  Button, Card, JobStatusBadge, ConfidenceBadge, LLMVerdictBadge,
  Badge, Spinner, EmptyState, Modal, cn, toast
} from '@/components/ui'
import { format, formatDistanceToNow, differenceInSeconds } from 'date-fns'

const POLL_STATES = ['queued', 'parsing', 'extracting', 'llm_review']
const FAILED_STATES = ['parse_failed', 'extraction_failed', 'llm_failed', 'validation_failed', 'submission_failed']

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<JobStateHistory[]>([])
  const [records, setRecords] = useState<ExtractedRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'history'>('overview')
  const [reviewFilter, setReviewFilter] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadJob = () =>
    Promise.all([
      jobsApi.get(jobId!).then(setJob),
      jobsApi.history(jobId!).then(setHistory),
    ])

  const loadRecords = () =>
    recordsApi.list(jobId!, { review_status: reviewFilter || undefined, page_size: 50 })
      .then(r => { setRecords(r.items); setRecordsTotal(r.total) })

  useEffect(() => {
    Promise.all([loadJob(), loadRecords()]).finally(() => setLoading(false))
  }, [jobId])

  // Poll when job is actively running
  useEffect(() => {
    if (!job) return
    if (!POLL_STATES.includes(job.status)) return
    const interval = setInterval(() => { loadJob(); loadRecords() }, 5000)
    return () => clearInterval(interval)
  }, [job?.status])

  useEffect(() => { loadRecords() }, [reviewFilter])

  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    if (!jobId) return
    setRetrying(true)
    try {
      await jobsApi.retry(jobId)
      toast.success('Job queued for retry')
      loadJob()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  const handleSubmit = async () => {
    if (!jobId) return
    setSubmitting(true)
    try {
      const response = await submissionApi.submit(jobId)
      const blob = new Blob([response.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `xtrium_${jobId.slice(0, 8)}_submission.json`
      a.click()
      setShowSubmit(false)
      loadJob()
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  }
  if (!job) {
    return <EmptyState title="Job not found" />
  }

  const isActive = POLL_STATES.includes(job.status)
  const canReview = ['ready_for_review', 'in_review'].includes(job.status)
  const canSubmit = job.total_approved > 0 && job.status !== 'submitted'

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link to="/jobs" className="text-gray-400 hover:text-gray-600 transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{job.name}</h1>
              <JobStatusBadge status={job.status} />
              {isActive && <RefreshCw className="w-4 h-4 text-brand-500 animate-spin" />}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {job.source_file_name} · Created {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {FAILED_STATES.includes(job.status) && (
            <Button variant="secondary" onClick={handleRetry} loading={retrying}>
              <RotateCcw className="w-4 h-4" /> Retry Job
            </Button>
          )}
          {canReview && (
            <Link to={`/jobs/${jobId}/review`}>
              <Button variant="secondary">
                Open Review Interface
              </Button>
            </Link>
          )}
          {canSubmit && (
            <Button onClick={() => setShowSubmit(true)}>
              <Send className="w-4 h-4" /> Submit {job.total_approved} Records
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar for active jobs */}
      {isActive && job.total_raw_records && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600 font-medium">
              {job.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}…
            </span>
            <span className="text-gray-500">
              {job.total_extracted} / {job.total_raw_records} records
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (job.total_extracted / job.total_raw_records) * 100)}%` }}
            />
          </div>
        </Card>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Extracted', value: job.total_extracted, color: 'text-gray-900' },
          { label: 'Approved', value: job.total_approved, color: 'text-green-700' },
          { label: 'Rejected', value: job.total_rejected, color: 'text-red-600' },
          { label: 'Submitted', value: job.total_submitted, color: 'text-brand-700' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6">
        {(['overview', 'records', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'pb-3 text-sm font-medium capitalize border-b-2 transition',
              activeTab === tab
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab}
            {tab === 'records' && ` (${recordsTotal})`}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Job Info</h3>
            {[
              { label: 'Job ID', value: job.id },
              { label: 'Source type', value: job.source_type.toUpperCase() },
              { label: 'Schema version', value: `v${job.schema_version}` },
              { label: 'File size', value: job.source_file_size_bytes ? `${(job.source_file_size_bytes / 1024).toFixed(1)} KB` : '—' },
              { label: 'Raw records parsed', value: job.total_raw_records ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-800 font-mono text-xs">{value}</span>
              </div>
            ))}
          </Card>
          {job.error_message && (
            <Card className="p-6 border-red-200 bg-red-50">
              <h3 className="font-semibold text-red-700 text-sm mb-2">Error</h3>
              <pre className="text-xs text-red-800 whitespace-pre-wrap font-mono">{job.error_message}</pre>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'records' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2">
            {['', 'pending', 'approved', 'rejected', 'quarantined'].map(s => (
              <button
                key={s}
                onClick={() => setReviewFilter(s)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  reviewFilter === s
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                )}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          <Card className="overflow-hidden">
            {records.length === 0 ? (
              <EmptyState title="No records match this filter" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-5 py-3 font-medium">Entity</th>
                      <th className="text-left px-4 py-3 font-medium">Confidence</th>
                      <th className="text-left px-4 py-3 font-medium">LLM</th>
                      <th className="text-left px-4 py-3 font-medium">Review Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {records.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 transition">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900">
                            {(r.extracted_fields.company_name as string) ||
                              (r.extracted_fields.operator_name as string) ||
                              r.canonical_name || '—'}
                          </p>
                          {r.canonical_name && (
                            <p className="text-xs text-gray-400 font-mono">{r.canonical_name}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ConfidenceBadge confidence={r.extraction_confidence} />
                        </td>
                        <td className="px-4 py-3">
                          <LLMVerdictBadge verdict={r.llm_verdict} skipped={r.llm_skipped} />
                        </td>
                        <td className="px-4 py-3">
                          <ReviewStatusBadge status={r.review_status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/jobs/${jobId}/review`}
                            state={{ recordId: r.id }}
                            className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                          >
                            Review →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'history' && (
        <Card className="p-6">
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
            <div className="space-y-6">
              {history.map((h, i) => {
                const duration = h.exited_at
                  ? differenceInSeconds(new Date(h.exited_at), new Date(h.entered_at))
                  : null
                const isFailed = h.state.includes('failed')
                return (
                  <div key={h.id} className="relative flex gap-4 pl-10">
                    <div className={cn(
                      'absolute left-2.5 w-3 h-3 rounded-full border-2 border-white',
                      isFailed ? 'bg-red-500' : h.exited_at ? 'bg-green-500' : 'bg-brand-500 animate-pulse'
                    )} />
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900 text-sm capitalize">
                            {h.state.replace(/_/g, ' ')}
                          </p>
                          <p className="text-xs text-gray-500">
                            {format(new Date(h.entered_at), 'MMM d, HH:mm:ss')}
                            {h.triggered_by && ` · by ${h.triggered_by}`}
                          </p>
                        </div>
                        {duration !== null && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}
                          </span>
                        )}
                      </div>
                      {h.error && (
                        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-xs text-red-700 font-mono">{h.error}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Submit confirmation modal */}
      <Modal open={showSubmit} onClose={() => setShowSubmit(false)} title="Confirm Submission">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              You are about to submit <strong>{job.total_approved} approved records</strong> from <strong>{job.name}</strong>.
              Once submitted, records will be locked.
            </p>
          </div>
          <div className="space-y-2 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Records to submit</span>
              <span className="font-semibold">{job.total_approved}</span>
            </div>
            <div className="flex justify-between">
              <span>Destination</span>
              <span className="font-semibold">JSON Download</span>
            </div>
            <div className="flex justify-between">
              <span>Schema version</span>
              <span className="font-semibold">v{job.schema_version}</span>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting}>
              <Send className="w-4 h-4" /> Submit {job.total_approved} Records
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ReviewStatusBadge({ status }: { status: string }) {
  const map: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
    pending: 'gray', approved: 'green', rejected: 'red',
    skipped: 'gray', quarantined: 'red', escalated: 'amber',
  }
  return <Badge variant={map[status] ?? 'gray'}>{status}</Badge>
}