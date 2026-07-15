import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Send, RotateCcw, FileText,
  Brain, Clock, CheckCircle, XCircle, AlertTriangle,
  ChevronRight, Download, Eye, BarChart3, List
} from 'lucide-react'
import { jobsApi, recordsApi, submissionApi } from '@/api/client'
import type { Job, JobStateHistory, ExtractedRecord } from '@/types'
import {
  Button, Card, JobStatusBadge, ConfidenceBadge, LLMVerdictBadge,
  Badge, Spinner, EmptyState, Modal, ProgressBar, cn, toast,
  safeFromNow, safeFormat,
} from '@/components/ui'
import { differenceInSeconds } from 'date-fns'

const POLL_STATES = ['queued', 'parsing', 'extracting', 'llm_review']
const FAILED_STATES = ['parse_failed', 'extraction_failed', 'llm_failed', 'validation_failed', 'submission_failed']
type Tab = 'overview' | 'records' | 'llm' | 'submissions' | 'history'

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<JobStateHistory[]>([])
  const [records, setRecords] = useState<ExtractedRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [reviewFilter, setReviewFilter] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const loadJob = () =>
    Promise.all([
      jobsApi.get(jobId!).then(setJob),
      jobsApi.history(jobId!).then(setHistory),
      submissionApi.list(jobId!).then(setSubmissions).catch(() => {}),
    ])

  const loadRecords = () =>
    recordsApi.list(jobId!, { review_status: reviewFilter || undefined, page_size: 100 })
      .then(r => { setRecords(r.items); setRecordsTotal(r.total) })

  useEffect(() => {
    Promise.all([loadJob(), loadRecords()]).finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    if (!job || !POLL_STATES.includes(job.status)) return
    const iv = setInterval(() => { loadJob(); loadRecords() }, 4000)
    return () => clearInterval(iv)
  }, [job?.status])

  useEffect(() => { loadRecords() }, [reviewFilter])

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
      a.download = `_${jobId.slice(0, 8)}_submission.json`
      a.click()
      toast.success('Submission downloaded')
      setShowSubmit(false)
      loadJob()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  if (!job) return <EmptyState title="Job not found" />

  const isActive = POLL_STATES.includes(job.status)
  const isFailed = FAILED_STATES.includes(job.status)
  const canReview = ['ready_for_review', 'in_review'].includes(job.status)
  // Only show Submit if there are approved records that haven't been submitted yet
  const pendingSubmitCount = Math.max(0, (job.total_approved || 0) - (job.total_submitted || 0))
  const canSubmit = pendingSubmitCount > 0 && !['submitted'].includes(job.status)

  // LLM stats derived from records
  const llmPass = records.filter(r => r.llm_verdict === 'PASS').length
  const llmReview = records.filter(r => r.llm_verdict === 'REVIEW').length
  const llmReject = records.filter(r => r.llm_verdict === 'REJECT').length
  const llmSkipped = records.filter(r => r.llm_skipped).length
  const flaggedRecords = records.filter(r => r.llm_field_flags?.length > 0)
  const avgConfidence = records.length
    ? records.reduce((s, r) => s + (r.llm_confidence || 0), 0) / records.length
    : 0

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Records', count: recordsTotal },
    { id: 'llm', label: 'LLM Review', count: flaggedRecords.length || undefined },
    { id: 'submissions', label: 'Submissions', count: submissions.length || undefined },
    { id: 'history', label: 'History' },
  ]

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link to="/jobs" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{job.name}</h1>
              <JobStatusBadge status={job.status} />
              {isActive && <RefreshCw className="w-4 h-4 text-brand-500 animate-spin" />}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {job.source_file_name}
              {job.source_file_size_bytes ? ` · ${(job.source_file_size_bytes / 1024).toFixed(0)} KB` : ''}
              {' · '}Created {safeFromNow(job.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isFailed && (
            <Button variant="secondary" onClick={handleRetry} loading={retrying} size="sm">
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </Button>
          )}
          {canReview && (
            <Link to={`/jobs/${jobId}/review`}>
              <Button variant="secondary" size="sm">
                <Eye className="w-3.5 h-3.5" /> Open Review
              </Button>
            </Link>
          )}
          {canSubmit && (
            <Button onClick={() => setShowSubmit(true)} size="sm">
              <Send className="w-3.5 h-3.5" /> Submit {pendingSubmitCount} Record{pendingSubmitCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>

      {/* Active job progress */}
      {isActive && (
        <Card className="p-4 border-brand-200 bg-brand-50/40">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-brand-700 font-medium flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {job.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}…
            </span>
            <span className="text-brand-600 font-medium">
              {job.total_extracted}
              {job.total_raw_records ? ` / ${job.total_raw_records}` : ''} records
            </span>
          </div>
          {job.total_raw_records ? (
            <ProgressBar value={job.total_extracted} max={job.total_raw_records} />
          ) : (
            <div className="w-full bg-brand-200 rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full animate-pulse w-1/3" />
            </div>
          )}
          <p className="text-xs text-brand-600 mt-1.5">Auto-refreshing every 4 seconds…</p>
        </Card>
      )}

      {/* Error banner */}
      {isFailed && job.error_message && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">{job.status.replace(/_/g, ' ')}</p>
              <pre className="text-xs text-red-700 mt-1 whitespace-pre-wrap font-mono">{job.error_message}</pre>
            </div>
            <Button variant="secondary" size="sm" onClick={handleRetry} loading={retrying}>
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </Button>
          </div>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Extracted', value: job.total_extracted, color: 'text-gray-900', bg: 'bg-gray-50' },
          { label: 'Approved', value: job.total_approved, color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'Rejected', value: job.total_rejected, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Submitted', value: job.total_submitted, color: 'text-brand-700', bg: 'bg-brand-50' },
        ].map(({ label, value, color, bg }) => (
          <Card key={label} className={`p-4 text-center ${bg}`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'pb-3 text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-1.5',
              activeTab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                activeTab === t.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" /> Job Details
            </h3>
            {[
              { label: 'Job ID', value: job.id, mono: true },
              { label: 'Source type', value: job.source_type?.toUpperCase() },
              { label: 'Schema version', value: `v${job.schema_version}` },
              { label: 'File size', value: job.source_file_size_bytes ? `${(job.source_file_size_bytes / 1024).toFixed(1)} KB` : '—' },
              { label: 'Raw records parsed', value: job.total_raw_records ?? (isActive ? 'Processing…' : '—') },
              { label: 'Created', value: safeFormat(job.created_at, 'MMM d, yyyy HH:mm') },
              { label: 'Last updated', value: safeFromNow(job.updated_at) },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                <span className="text-gray-500">{label}</span>
                <span className={cn('font-medium text-gray-800', mono && 'font-mono text-xs bg-gray-100 px-2 py-0.5 rounded')}>{value}</span>
              </div>
            ))}
          </Card>

          <div className="space-y-4">
            {/* LLM summary card */}
            {records.length > 0 && (
              <Card className="p-6">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-4">
                  <Brain className="w-4 h-4 text-purple-500" /> LLM Review Summary
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'PASS', value: llmPass, color: 'text-emerald-700', bg: 'bg-emerald-50' },
                    { label: 'REVIEW', value: llmReview, color: 'text-amber-700', bg: 'bg-amber-50' },
                    { label: 'REJECT', value: llmReject, color: 'text-red-600', bg: 'bg-red-50' },
                    { label: 'Skipped', value: llmSkipped, color: 'text-gray-500', bg: 'bg-gray-50' },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Avg confidence</span>
                  <span className="font-semibold text-gray-800">{(avgConfidence * 100).toFixed(0)}%</span>
                </div>
              </Card>
            )}

            {/* Quick actions */}
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                {canReview && (
                  <Link to={`/jobs/${jobId}/review`} className="flex items-center justify-between p-3 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-brand-600" />
                      <span className="text-sm font-medium text-brand-700">Open Review Interface</span>
                    </div>
                    <span className="text-xs text-brand-600">{recordsTotal} records pending</span>
                  </Link>
                )}
                {canSubmit && (
                  <button onClick={() => setShowSubmit(true)} className="w-full flex items-center justify-between p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                    <div className="flex items-center gap-2">
                      <Download className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-700">Submit & Download JSON</span>
                    </div>
                    <span className="text-xs text-emerald-600">{job.total_approved} approved</span>
                  </button>
                )}
                {isFailed && (
                  <button onClick={handleRetry} className="w-full flex items-center justify-between p-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 transition">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">Retry Failed Job</span>
                    </div>
                    <span className="text-xs text-red-500">re-run extraction</span>
                  </button>
                )}
                {!canReview && !canSubmit && !isFailed && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    {isActive ? 'Actions available once extraction completes.' : 'No actions available for this job status.'}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── RECORDS TAB ── */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-wrap gap-1.5">
              {['', 'pending', 'approved', 'rejected', 'quarantined', 'skipped'].map(s => (
                <button
                  key={s}
                  onClick={() => setReviewFilter(s)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                    reviewFilter === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  )}
                >
                  {s || 'All'}
                </button>
              ))}
            </div>
            {canReview && (
              <Link to={`/jobs/${jobId}/review`}>
                <Button size="sm"><Eye className="w-3.5 h-3.5" /> Open Review UI</Button>
              </Link>
            )}
          </div>

          <Card className="overflow-hidden">
            {records.length === 0 ? (
              <EmptyState
                title="No records"
                description={isActive ? 'Records will appear here as extraction runs.' : 'No records match this filter.'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-5 py-3 font-medium">Entity</th>
                      <th className="text-left px-4 py-3 font-medium">Fields</th>
                      <th className="text-left px-4 py-3 font-medium">Confidence</th>
                      <th className="text-left px-4 py-3 font-medium">LLM</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map(r => {
                      const primaryName =
                        (r.extracted_fields?.company_name as string) ||
                        (r.extracted_fields?.material_name as string) ||
                        (r.extracted_fields?.operator_name as string) ||
                        r.canonical_name || '—'
                      const fieldCount = Object.keys(r.extracted_fields || {}).length
                      const flagCount = r.llm_field_flags?.length ?? 0
                      return (
                        <tr key={r.id} className="hover:bg-gray-50/60 transition">
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-900 truncate max-w-[200px]">{primaryName}</p>
                            {r.canonical_name && r.canonical_name !== primaryName && (
                              <p className="text-xs text-gray-400 font-mono truncate">{r.canonical_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{fieldCount} fields</td>
                          <td className="px-4 py-3">
                            <ConfidenceBadge confidence={r.extraction_confidence} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <LLMVerdictBadge verdict={r.llm_verdict} skipped={r.llm_skipped} />
                              {flagCount > 0 && (
                                <span className="text-xs text-amber-600 font-medium">{flagCount} flag{flagCount > 1 ? 's' : ''}</span>
                              )}
                            </div>
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
                      )
                    })}
                  </tbody>
                </table>
                {recordsTotal > records.length && (
                  <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400 text-center">
                    Showing {records.length} of {recordsTotal} records
                    <button
                      className="ml-2 text-brand-600 font-medium"
                      onClick={() => setActiveTab('records')}
                    >
                      — Open Review UI to see all →
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── LLM REVIEW TAB ── */}
      {activeTab === 'llm' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Passed', value: llmPass, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100' },
              { label: 'Needs Review', value: llmReview, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100' },
              { label: 'Rejected', value: llmReject, color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
              { label: 'Avg confidence', value: `${(avgConfidence * 100).toFixed(0)}%`, color: 'text-brand-700', bg: 'bg-brand-50 border-brand-100' },
            ].map(({ label, value, color, bg }) => (
              <Card key={label} className={`p-4 text-center border ${bg}`}>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </Card>
            ))}
          </div>

          {/* Flagged records */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Flagged Records ({flaggedRecords.length})
              </h3>
              {flaggedRecords.length > 0 && canReview && (
                <Link to={`/jobs/${jobId}/review`}>
                  <Button size="sm" variant="secondary"><Eye className="w-3.5 h-3.5" /> Review flagged</Button>
                </Link>
              )}
            </div>
            {flaggedRecords.length === 0 ? (
              <EmptyState
                title="No flagged records"
                description={records.length === 0 ? 'Records will appear here after LLM review runs.' : 'All records passed LLM review without field flags.'}
              />
            ) : (
              <div className="divide-y divide-gray-50">
                {flaggedRecords.map(r => {
                  const name = (r.extracted_fields?.company_name as string) || r.canonical_name || r.id.slice(0, 8)
                  return (
                    <div key={r.id} className="px-6 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">{name}</p>
                            <LLMVerdictBadge verdict={r.llm_verdict} skipped={r.llm_skipped} />
                            <span className="text-xs text-gray-400">
                              {(r.llm_confidence ? r.llm_confidence * 100 : 0).toFixed(0)}% confidence
                            </span>
                          </div>
                          {r.llm_reason && (
                            <p className="text-xs text-gray-500 mt-1">{r.llm_reason}</p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {(r.llm_field_flags || []).map((flag: any, i: number) => (
                              <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs">
                                <span className="font-mono font-semibold text-amber-800">{flag.field}</span>
                                <span className="text-amber-700 ml-1">— {flag.issue}</span>
                                {flag.suggested_value && (
                                  <span className="text-amber-600 ml-1">→ "{flag.suggested_value}"</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        <Link
                          to={`/jobs/${jobId}/review`}
                          state={{ recordId: r.id }}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap shrink-0"
                        >
                          Review →
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* All records LLM breakdown */}
          {records.length > 0 && (
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">LLM Verdict Breakdown</h3>
              <div className="space-y-2">
                {[
                  { label: 'PASS', count: llmPass, color: 'bg-emerald-500', total: records.length },
                  { label: 'REVIEW', count: llmReview, color: 'bg-amber-400', total: records.length },
                  { label: 'REJECT', count: llmReject, color: 'bg-red-500', total: records.length },
                  { label: 'Skipped', count: llmSkipped, color: 'bg-gray-300', total: records.length },
                ].map(({ label, count, color, total }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-16">{label}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${color} transition-all duration-700`}
                        style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── SUBMISSIONS TAB ── */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{submissions.length} submission batch{submissions.length !== 1 ? 'es' : ''}</p>
            {canSubmit && (
              <Button onClick={() => setShowSubmit(true)} size="sm">
                <Send className="w-3.5 h-3.5" /> New Submission
              </Button>
            )}
          </div>

          {submissions.length === 0 ? (
            <EmptyState
              title="No submissions yet"
              description="Approve records and submit them to generate a JSON export."
              action={canSubmit ? (
                <Button onClick={() => setShowSubmit(true)}>
                  <Send className="w-4 h-4" /> Submit {job.total_approved} Approved Records
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-3">
              {submissions.map((s: any) => (
                <Card key={s.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                          <Download className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            Batch {s.id.slice(0, 8)} · {s.record_count} records
                          </p>
                          <p className="text-xs text-gray-400">
                            {safeFromNow(s.created_at)}
                            {' · '}Schema v{s.schema_version}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={s.status === 'completed' ? 'green' : 'gray'}>{s.status}</Badge>
                      {s.payload_sha256 && (
                        <p className="text-xs text-gray-400 font-mono mt-1">
                          sha256: {s.payload_sha256.slice(0, 12)}…
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === 'history' && (
        <Card className="p-6">
          {history.length === 0 ? (
            <EmptyState title="No history yet" />
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-100" />
              <div className="space-y-6">
                {history.map((h) => {
                  const duration = h.exited_at
                    ? differenceInSeconds(new Date(h.exited_at), new Date(h.entered_at))
                    : null
                  const isFailed = h.state.includes('failed')
                  const isRunning = !h.exited_at
                  return (
                    <div key={h.id} className="relative flex gap-4 pl-10">
                      <div className={cn(
                        'absolute left-2.5 w-3 h-3 rounded-full border-2 border-white ring-1',
                        isFailed ? 'bg-red-500 ring-red-200' :
                        isRunning ? 'bg-brand-500 ring-brand-200 animate-pulse' :
                        'bg-emerald-500 ring-emerald-200'
                      )} />
                      <div className="flex-1 pb-1">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 capitalize">
                              {h.state.replace(/_/g, ' ')}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {safeFormat(h.entered_at, 'MMM d, yyyy · HH:mm:ss')}
                              {h.triggered_by && ` · ${h.triggered_by}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isRunning && (
                              <span className="text-xs text-brand-600 font-medium">Running…</span>
                            )}
                            {duration !== null && (
                              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                                {duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}
                              </span>
                            )}
                          </div>
                        </div>
                        {h.error && (
                          <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3">
                            <p className="text-xs text-red-700 font-mono whitespace-pre-wrap">{h.error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Submit modal */}
      <Modal open={showSubmit} onClose={() => setShowSubmit(false)} title="Confirm Submission" description="Approved records will be exported as JSON and locked.">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800">
              Submitting <strong>{job.total_approved} approved records</strong> from <strong>{job.name}</strong>.
              Records will be marked as submitted and cannot be re-submitted.
            </p>
          </div>
          <div className="space-y-2.5 text-sm">
            {[
              { label: 'Records to export', value: String(job.total_approved) },
              { label: 'Format', value: 'JSON (structured, schema-conformant)' },
              { label: 'Schema version', value: `v${job.schema_version}` },
              { label: 'Previously submitted', value: String(job.total_submitted) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-900">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting}>
              <Download className="w-4 h-4" /> Export & Download
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
