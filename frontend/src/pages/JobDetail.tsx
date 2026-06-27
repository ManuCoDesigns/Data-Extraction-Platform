import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Send, RotateCcw, CheckCircle,
  AlertCircle, Download, Eye, Globe, Clock, Zap, ChevronRight, SkipForward
} from 'lucide-react'
import { jobsApi, recordsApi, submissionApi } from '@/api/client'
import type { Job, JobStateHistory, ExtractedRecord } from '@/types'
import {
  Button, Card, Badge, Spinner, EmptyState, Modal,
  ProgressBar, cn, toast, safeFromNow, safeFormat,
} from '@/components/ui'
import { differenceInSeconds } from 'date-fns'

const POLL_STATES   = ['queued', 'parsing', 'extracting', 'llm_review']
const FAILED_STATES = ['parse_failed', 'extraction_failed', 'llm_failed', 'validation_failed', 'submission_failed']
type Tab = 'overview' | 'records' | 'submissions' | 'history'

// ── Pipeline step ─────────────────────────────────────────────────────────────
function PipelineStep({ n, label, sublabel, done, active, failed }: {
  n: number; label: string; sublabel?: string
  done?: boolean; active?: boolean; failed?: boolean
}) {
  const color = failed ? '#ef4444' : done ? '#10b981' : active ? '#8b5cf6' : '#cbd5e1'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 90 }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: failed ? '#fef2f2' : done ? '#ecfdf5' : active ? '#f5f3ff' : '#f8fafc', border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {active && !failed && <RefreshCw size={16} color={color} className="animate-spin" />}
        {done && !active && <CheckCircle size={18} color={color} />}
        {failed && <AlertCircle size={18} color={color} />}
        {!done && !active && !failed && <span style={{ fontSize: 14, fontWeight: 700, color }}>{n}</span>}
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: done ? '#059669' : active ? '#7c3aed' : failed ? '#dc2626' : '#64748b', margin: 0 }}>{label}</p>
        {sublabel && <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{sublabel}</p>}
      </div>
    </div>
  )
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob]             = useState<Job | null>(null)
  const [history, setHistory]     = useState<JobStateHistory[]>([])
  const [records, setRecords]     = useState<ExtractedRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [submissions, setSubmissions]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [reviewFilter, setReviewFilter] = useState('')
  const [showSubmit, setShowSubmit]     = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [retrying, setRetrying]         = useState(false)
  const [skippingLlm, setSkippingLlm]   = useState(false)

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
    setRetrying(true)
    try { await jobsApi.retry(jobId!); toast.success('Job queued for retry'); loadJob() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Retry failed') }
    finally { setRetrying(false) }
  }

  const handleSkipLlm = async () => {
    setSkippingLlm(true)
    try {
      await jobsApi.skipLlm(jobId!)
      toast.success('LLM check skipped — job moved to Ready for Review')
      loadJob()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Skip failed')
    } finally { setSkippingLlm(false) }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const response = await submissionApi.submit(jobId!)
      const blob = new Blob([response.data], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `xtrium_${jobId!.slice(0,8)}_submission.json`; a.click()
      URL.revokeObjectURL(url)
      toast.success('Submission package downloaded — records are now locked')
      setShowSubmit(false); loadJob(); setSubmissions(await submissionApi.list(jobId!).catch(() => []))
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Submission failed')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  if (!job)    return <EmptyState title="Job not found" />

  const isActive   = POLL_STATES.includes(job.status)
  const isFailed   = FAILED_STATES.includes(job.status)
  const canReview  = ['ready_for_review', 'in_review'].includes(job.status)
  const canSubmit  = job.total_approved > 0 && job.status !== 'submitted'
  const isSubmitted = job.status === 'submitted'

  // Record stats
  const pending  = records.filter(r => r.review_status === 'pending').length
  const approved = records.filter(r => r.review_status === 'approved').length
  const rejected = records.filter(r => r.review_status === 'rejected').length
  const webVerified = records.filter(r => r.web_verified === true).length
  const webFlagged  = records.filter(r => r.web_verified === false).length

  // Pipeline stages
  const stages = [
    { n: 1, label: 'Extract',     sublabel: `${job.total_extracted} records`,
      done: !['queued','parsing','extracting'].includes(job.status) && job.total_extracted > 0,
      active: ['queued','parsing','extracting'].includes(job.status), failed: false },
    { n: 2, label: 'AI Review',   sublabel: 'Claude checks quality',
      done: !['queued','parsing','extracting','llm_review'].includes(job.status),
      active: job.status === 'llm_review', failed: job.status === 'llm_failed' },
    { n: 3, label: 'Human Review', sublabel: `${approved}/${job.total_extracted} approved`,
      done: approved > 0 || isSubmitted,
      active: ['ready_for_review','in_review'].includes(job.status), failed: false },
    { n: 4, label: 'Submit',      sublabel: isSubmitted ? `${job.total_submitted} sent` : 'Export & lock',
      done: isSubmitted, active: false, failed: job.status === 'submission_failed' },
  ]

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview',     label: 'Overview' },
    { id: 'records',      label: 'Records', badge: recordsTotal },
    { id: 'submissions',  label: 'Submissions', badge: submissions.length || undefined },
    { id: 'history',      label: 'History' },
  ]

  return (
    <div className="p-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/jobs" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{job.name}</h1>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: isSubmitted ? '#ecfdf5' : isFailed ? '#fef2f2' : isActive ? '#f5f3ff' : canReview ? '#fffbeb' : '#f1f5f9',
                color: isSubmitted ? '#059669' : isFailed ? '#dc2626' : isActive ? '#7c3aed' : canReview ? '#d97706' : '#64748b',
                border: `1px solid ${isSubmitted ? '#6ee7b7' : isFailed ? '#fca5a5' : isActive ? '#c4b5fd' : canReview ? '#fcd34d' : '#e2e8f0'}` }}>
                {isActive && <RefreshCw size={10} className="animate-spin" style={{ display: 'inline', marginRight: 4 }}/>}
                {job.status.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-0.5 truncate">
              {job.source_file_name}{job.source_file_size_bytes ? ` · ${(job.source_file_size_bytes/1024).toFixed(0)} KB` : ''} · Created {safeFromNow(job.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {isFailed && <Button variant="secondary" onClick={handleRetry} loading={retrying} size="sm"><RotateCcw className="w-3.5 h-3.5"/> Retry</Button>}
          {job.status === 'llm_review' && (
            <Button variant="secondary" size="sm" onClick={handleSkipLlm} loading={skippingLlm}
              style={{ borderColor: '#f59e0b', color: '#d97706' }}
              title="Bypass the AI check and move straight to human review">
              <SkipForward className="w-3.5 h-3.5"/> Skip LLM Check
            </Button>
          )}
          {(canReview || job.total_approved > 0) && (
            <>
              {pending > 0 && (
                <Link to={`/jobs/${jobId}/review?filter=pending`}>
                  <Button variant="secondary" size="sm" style={{ borderColor: '#f59e0b', color: '#d97706' }}>
                    <Eye className="w-3.5 h-3.5"/> Review Pending ({pending})
                  </Button>
                </Link>
              )}
              {approved > 0 && (
                <Link to={`/jobs/${jobId}/review?filter=approved`}>
                  <Button variant="secondary" size="sm" style={{ borderColor: '#10b981', color: '#059669' }}>
                    <CheckCircle className="w-3.5 h-3.5"/> View Approved ({approved})
                  </Button>
                </Link>
              )}
            </>
          )}
          {canSubmit && (
            <Button onClick={() => setShowSubmit(true)} size="sm"
              style={{ background: '#10b981', border: 'none' }}>
              <Send className="w-3.5 h-3.5"/> Submit {job.total_approved} Approved Records
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline visual */}
      <Card className="p-6">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Extraction Pipeline</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0, overflowX: 'auto', padding: '0 8px' }}>
          {stages.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <PipelineStep {...s} />
              {i < stages.length - 1 && (
                <div style={{ height: 2, width: 48, background: s.done ? '#10b981' : '#e2e8f0', margin: '0 4px', marginTop: -24, flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        {/* Status explanation */}
        {canReview && (
          <div style={{ marginTop: 20, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <Eye size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }}/>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#92400e', margin: 0 }}>Action Required — Human Review Needed</p>
              <p style={{ fontSize: 12, color: '#b45309', margin: '4px 0 0' }}>
                The AI extraction is complete. A reviewer needs to open each record, check it's correct, and click <strong>Approve</strong>.
                Once all records are approved, the <strong>Submit</strong> button becomes active to export and lock the final data.
              </p>
            </div>
          </div>
        )}

        {/* Web verified vs approved clarifier */}
        {(webVerified > 0 || webFlagged > 0) && !isSubmitted && (
          <div style={{ marginTop: 12, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <Globe size={16} color="#0369a1" style={{ flexShrink: 0, marginTop: 1 }}/>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', margin: 0 }}>About Web Verification vs Approval</p>
              <p style={{ fontSize: 12, color: '#0369a1', margin: '4px 0 0' }}>
                🌐 <strong>Web Verified ({webVerified})</strong> means the AI checked the data against the company's website — this is automatic.
                ✓ <strong>Approved ({approved})</strong> means a human reviewer has read and signed off on the record — this is required before submission.
                These are <strong>two separate steps</strong>. A web-verified record still needs human approval.
              </p>
            </div>
          </div>
        )}

        {isSubmitted && (
          <div style={{ marginTop: 20, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <CheckCircle size={16} color="#059669" style={{ flexShrink: 0, marginTop: 1 }}/>
            <p style={{ fontSize: 13, color: '#065f46', margin: 0 }}>
              <strong>{job.total_submitted} records submitted</strong> — the data has been exported and locked. See the Submissions tab for the download history.
            </p>
          </div>
        )}
      </Card>

      {/* Active progress */}
      {isActive && (
        <Card className="p-4 border-purple-200 bg-purple-50/40">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-purple-700 font-medium flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin"/>
              {job.status.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}… auto-refreshing every 4s
            </span>
            <span className="text-purple-600 font-medium">
              {job.total_extracted}{job.total_raw_records ? ` / ${job.total_raw_records}` : ''} records
            </span>
          </div>
          {job.total_raw_records
            ? <ProgressBar value={job.total_extracted} max={job.total_raw_records} />
            : <div className="w-full bg-purple-200 rounded-full h-1.5 overflow-hidden"><div className="h-full bg-purple-500 rounded-full animate-pulse w-1/3" /></div>
          }
        </Card>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 12, alignSelf: 'flex-start', width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            background: activeTab === t.id ? '#fff' : 'transparent',
            color: activeTab === t.id ? '#1d4ed8' : '#64748b',
            boxShadow: activeTab === t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            {t.badge !== undefined && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '0 6px', borderRadius: 20,
                background: activeTab === t.id ? '#dbeafe' : '#e2e8f0',
                color: activeTab === t.id ? '#1d4ed8' : '#64748b' }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Extracted',  value: job.total_extracted,   icon: '📋', color: '#4f46e5', bg: '#eef2ff' },
            { label: 'Approved',   value: job.total_approved,    icon: '✅', color: '#059669', bg: '#ecfdf5' },
            { label: 'Submitted',  value: job.total_submitted ?? 0, icon: '📤', color: '#0891b2', bg: '#ecfeff' },
            { label: 'Pending Review', value: pending,           icon: '⏳', color: '#d97706', bg: '#fffbeb' },
          ].map(({ label, value, icon, color, bg }) => (
            <div key={label} style={{ background: bg, borderRadius: 14, border: `1px solid ${color}20`, borderTop: `3px solid ${color}`, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
              </div>
              <p style={{ fontSize: 11, fontWeight: 700, color, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── RECORDS ── */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {/* Review status clarifier */}
          <div style={{ background: '#fafafa', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', margin: '0 0 8px' }}>Record Status Guide</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
              <span>⏳ <strong style={{ color: '#d97706' }}>Pending</strong> — waiting for a reviewer to approve</span>
              <span>✓ <strong style={{ color: '#059669' }}>Approved</strong> — human reviewer signed off</span>
              <span>✗ <strong style={{ color: '#dc2626' }}>Rejected</strong> — sent back to extractor for fixes</span>
              <span>🌐 <strong style={{ color: '#0369a1' }}>Web Verified</strong> — AI checked vs website (separate from approval)</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            {[['', 'All'], ['pending', '⏳ Pending'], ['approved', '✓ Approved'], ['rejected', '✗ Rejected']].map(([v, l]) => (
              <button key={v} onClick={() => setReviewFilter(v)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  reviewFilter === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                {l}
              </button>
            ))}
          </div>

          {records.length === 0
            ? <EmptyState title={recordsTotal === 0 ? "No records yet" : "No records match filter"} />
            : (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Company / Record', 'Review Status', 'Web Check', 'Schema', ''].map((h, i) => (
                        <th key={h+i} className={cn('text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide', i > 1 && 'hidden md:table-cell')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map(r => {
                      const name = r.extracted_fields?.company_name || r.extracted_fields?.material_name || r.canonical_name || r.id.slice(0,8)
                      const rs = r.review_status
                      const rsColor = rs === 'approved' ? '#059669' : rs === 'rejected' ? '#dc2626' : '#d97706'
                      const rsBg = rs === 'approved' ? '#ecfdf5' : rs === 'rejected' ? '#fef2f2' : '#fffbeb'
                      return (
                        <tr key={r.id} style={{ borderLeft: `3px solid ${rsColor}20` }} className="hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <p className="font-semibold text-gray-900 truncate max-w-[200px]">{String(name)}</p>
                            <p className="text-xs text-gray-400">{r.extracted_fields?.industry_sector as string || ''}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: rsBg, color: rsColor, border: `1px solid ${rsColor}30` }}>
                              {rs === 'approved' ? '✓ Approved' : rs === 'rejected' ? '✗ Rejected' : '⏳ Pending Review'}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {r.web_verified === null || r.web_verified === undefined
                              ? <span className="text-xs text-gray-300">Not run</span>
                              : r.web_verified
                              ? <span style={{ fontSize: 11, fontWeight: 600, color: '#059669' }}>🌐 Verified</span>
                              : <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b' }}>⚠ {(r.web_check_flags || []).length} flags</span>
                            }
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {r.is_schema_valid
                              ? <span style={{ fontSize: 11, color: '#059669' }}>✓ Valid</span>
                              : <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ {(r.validation_errors || []).length} errors</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs text-brand-600 font-medium">View</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {recordsTotal > records.length && (
                  <p className="text-xs text-center text-gray-400 py-3 border-t">Showing {records.length} of {recordsTotal} records</p>
                )}
              </Card>
            )
          }
        </div>
      )}

      {/* ── SUBMISSIONS ── */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          {/* What is submission */}
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '14px 18px' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', margin: '0 0 4px' }}>📤 What is Submission?</p>
            <p style={{ fontSize: 12, color: '#0369a1', margin: 0 }}>
              Submission is the final step. It packages all approved records into a signed JSON file, locks them (they can't be edited after this), and records the submission in the audit log.
              Each submission generates a SHA-256 hash for data integrity verification.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{submissions.length} submission batch{submissions.length !== 1 ? 'es' : ''}</p>
            {canSubmit && (
              <Button onClick={() => setShowSubmit(true)} size="sm" style={{ background: '#10b981', border: 'none' }}>
                <Send className="w-3.5 h-3.5"/> Submit {job.total_approved} Approved Records
              </Button>
            )}
          </div>

          {submissions.length === 0 ? (
            <EmptyState title="No submissions yet"
              description="Once records are approved by a reviewer, click Submit to export and lock them."
              action={canSubmit
                ? <Button onClick={() => setShowSubmit(true)} style={{ background: '#10b981', border: 'none' }}>
                    <Send className="w-4 h-4"/> Submit {job.total_approved} Approved Records
                  </Button>
                : pending > 0
                ? <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
                    <p>⏳ <strong>{pending} records</strong> are still awaiting human review.</p>
                    <p style={{ marginTop: 4 }}>A reviewer needs to open the Records tab and approve them.</p>
                  </div>
                : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {submissions.map((s: any) => (
                <Card key={s.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div style={{ width: 40, height: 40, background: '#ecfdf5', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Download size={18} color="#059669"/>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Batch {s.id.slice(0,8)} — {s.record_count} records</p>
                        <p className="text-xs text-gray-400">{safeFromNow(s.created_at)} · Schema v{s.schema_version}</p>
                        {s.payload_sha256 && (
                          <p className="text-xs text-gray-300 font-mono mt-1">SHA-256: {s.payload_sha256.slice(0,20)}…</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={s.status === 'completed' ? 'green' : 'gray'}>{s.status}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      {activeTab === 'history' && (
        <Card className="p-6">
          {history.length === 0
            ? <EmptyState title="No history yet" />
            : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-100"/>
                <div className="space-y-6">
                  {history.map(h => {
                    const duration = h.exited_at ? differenceInSeconds(new Date(h.exited_at), new Date(h.entered_at)) : null
                    const isFailed  = h.state.includes('failed')
                    const isRunning = !h.exited_at
                    return (
                      <div key={h.id} className="relative flex gap-4 pl-10">
                        <div className={cn('absolute left-2.5 w-3 h-3 rounded-full border-2 border-white ring-1',
                          isFailed ? 'bg-red-500 ring-red-200' : isRunning ? 'bg-purple-500 ring-purple-200 animate-pulse' : 'bg-emerald-500 ring-emerald-200')} />
                        <div className="flex-1 pb-1">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-gray-900 capitalize">{h.state.replace(/_/g,' ')}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{safeFormat(h.entered_at,'MMM d, yyyy · HH:mm:ss')}{h.triggered_by && ` · ${h.triggered_by}`}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isRunning && <span className="text-xs text-purple-600 font-medium">Running…</span>}
                              {duration !== null && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{duration < 60 ? `${duration}s` : `${Math.floor(duration/60)}m ${duration%60}s`}</span>}
                            </div>
                          </div>
                          {h.error && <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-xs text-red-700 font-mono whitespace-pre-wrap">{h.error}</p></div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }
        </Card>
      )}

      {/* Submit modal */}
      <Modal open={showSubmit} onClose={() => setShowSubmit(false)} title="Submit Approved Records" description="Records will be exported as a signed JSON file and permanently locked.">
        <div className="space-y-4">
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 13, color: '#065f46', margin: 0 }}>
              You are about to submit <strong>{job.total_approved} approved records</strong> from <strong>{job.name}</strong>.
            </p>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>
              ⚠ <strong>This action cannot be undone.</strong> Submitted records are locked and cannot be re-submitted.
              Make sure all records have been reviewed and approved before proceeding.
            </p>
          </div>
          {[
            { label: 'Records to submit',   value: String(job.total_approved) },
            { label: 'Format',             value: 'JSON (schema-conformant, SHA-256 signed)' },
            { label: 'Schema version',     value: `v${job.schema_version}` },
            { label: 'Previously submitted', value: String(job.total_submitted ?? 0) },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="font-semibold text-gray-900">{value}</span>
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting} style={{ background: '#10b981', border: 'none' }}>
              <Download className="w-4 h-4"/> Export & Submit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
