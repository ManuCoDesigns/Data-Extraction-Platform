import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { JsonRecordViewer } from './JsonRecordViewer'
import {
  Globe, Upload, Download, CheckCircle, XCircle,
  Edit3, ChevronRight, AlertCircle, Save, Users as UsersIcon,
  Clock, Brain, Trash2, Search, Shield, Info, ChevronDown, RotateCcw, Code, Send, Eye,
  Lock, Unlock, MoreHorizontal, ArrowRight,
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi, recordsApi, submissionApi, jobsApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, ConfirmDialog, cn, toast, safeFromNow, safeFormat } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { format, formatDistanceToNow } from 'date-fns'

// ── Step pipeline definition ───────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Upload',  icon: '📤', desc: 'Add company data to the source' },
  { id: 2, label: 'Review',  icon: '🔍', desc: 'Approve every record individually' },
  { id: 3, label: 'Approve', icon: '✅', desc: 'Lock the source as complete' },
  { id: 4, label: 'Submit',  icon: '🚀', desc: 'Deliver records to the client' },
]

/**
 * Derive the active pipeline step from source status + records.
 *
 * Step 1 — Upload:   no data, or schema errors, or upload in progress
 * Step 2 — Review:   records exist, review underway (any review status)
 * Step 3 — Approve:  all records approved, waiting for explicit source approval
 * Step 4 — Submit:   source approved, submitting to client
 * Step 5 — Done:     source approved + all records submitted
 */
function getStep(status: string, records: any[]): number {
  // Step 1: no records yet, or upload issues
  if (records.length === 0) return 1
  if (['not_started', 'extracting', 'needs_fixes'].includes(status)) return 1

  // Done: approved and all submitted
  if (status === 'approved') {
    const submitted = records.filter(r => r.is_submitted).length
    const approvedRecs = records.filter(r => r.review_status === 'approved').length
    return (submitted > 0 && submitted >= approvedRecs) ? 5 : 4
  }

  // Step 3: all records individually approved, source not yet approved
  const allApproved = records.every(r => r.review_status === 'approved')
  if (allApproved && records.length > 0) return 3

  // Step 2: any other state with records = review in progress
  // covers: ready_for_review, in_review, changes_requested, llm_verification
  return 2
}

// ── Pipeline header component ──────────────────────────────────────────────────
function StepPipeline({ currentStep }: { currentStep: number }) {
  const isDone = currentStep === 5
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '20px 24px', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {STEPS.map((step, i) => {
        const done = isDone || currentStep > step.id
        const active = !isDone && currentStep === step.id
        const locked = !done && !active
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 80 }}>
              {/* Circle */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                background: done ? '#ecfdf5' : active ? '#eff6ff' : '#f8fafc',
                border: `2px solid ${done ? '#10b981' : active ? '#3b82f6' : '#e2e8f0'}`,
                boxShadow: active ? '0 0 0 4px #dbeafe' : 'none',
                transition: 'all 0.3s',
                position: 'relative',
              }}>
                {done ? <span style={{ fontSize: 20 }}>✓</span> : <span style={{ opacity: locked ? 0.35 : 1 }}>{step.icon}</span>}
                {active && <div style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '2px solid #93c5fd', animation: 'pulse 2s infinite' }} />}
              </div>
              {/* Label */}
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 11, fontWeight: 700, margin: 0, color: done ? '#059669' : active ? '#1d4ed8' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Step {step.id}
                </p>
                <p style={{ fontSize: 12, fontWeight: 600, margin: '1px 0 0', color: done ? '#065f46' : active ? '#1e40af' : '#cbd5e1' }}>
                  {step.label}
                </p>
              </div>
            </div>
            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#10b981' : '#e2e8f0', margin: '0 4px', marginBottom: 28, transition: 'background 0.3s' }} />
            )}
          </div>
        )
      })}
      {isDone && (
        <div style={{ marginLeft: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 64 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ecfdf5', border: '2px solid #10b981' }}>
            <span style={{ fontSize: 22 }}>🎉</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 11, fontWeight: 700, margin: 0, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Done</p>
            <p style={{ fontSize: 12, fontWeight: 600, margin: '1px 0 0', color: '#065f46' }}>Complete</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Primary action panel ───────────────────────────────────────────────────────
function PrimaryActionPanel({
  step, source, records, isExtractor, isReviewer, isAdmin,
  onUpload, onReview, onApprove, onSubmit, onExport,
  scraping, verifying, onScrape, onVerify,
}: any) {
  const pendingCount = records.filter((r: any) => r.review_status === 'pending').length
  const approvedCount = records.filter((r: any) => r.review_status === 'approved').length
  const submittedCount = records.filter((r: any) => r.is_submitted).length
  const total = records.length

  // Step 1 — Upload
  if (step === 1) return (
    <div style={{ background: '#eff6ff', border: '2px solid #3b82f6', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1e40af', margin: 0 }}>
            📤 Step 1 of 4 — Upload Company Data
          </p>
          <p style={{ fontSize: 13, color: '#3b82f6', margin: '4px 0 0' }}>
            {records.length === 0
              ? 'No data yet. Upload a file or auto-scrape the company website to get started.'
              : `${records.length} records uploaded but some need fixing. Review errors or re-upload.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {source.website_url && isExtractor && (
            <Button variant="secondary" size="sm" onClick={onScrape} loading={scraping}>
              <Search className="w-3.5 h-3.5" /> Auto-Scrape Website
            </Button>
          )}
          {isExtractor && (
            <Button size="sm" onClick={onUpload} style={{ background: '#2563eb', border: 'none', color: '#fff' }}>
              <Upload className="w-3.5 h-3.5" />
              {records.length > 0 ? 'Re-Upload Data' : 'Upload Data'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  // Step 2 — Review records
  if (step === 2) return (
    <div style={{ background: '#faf5ff', border: '2px solid #8b5cf6', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#5b21b6', margin: 0 }}>
            🔍 Step 2 of 4 — Review Each Record
          </p>
          <p style={{ fontSize: 13, color: '#7c3aed', margin: '4px 0 8px' }}>
            {pendingCount > 0
              ? `${pendingCount} record${pendingCount !== 1 ? 's' : ''} still pending review · ${approvedCount} of ${total} approved`
              : `All ${total} records approved — ready to approve the source`}
          </p>
          {/* Progress bar */}
          <div style={{ background: '#ede9fe', borderRadius: 99, height: 8, overflow: 'hidden', maxWidth: 300 }}>
            <div style={{ background: '#8b5cf6', height: '100%', borderRadius: 99, width: `${total > 0 ? Math.round((approvedCount / total) * 100) : 0}%`, transition: 'width 0.5s ease' }} />
          </div>
          <p style={{ fontSize: 11, color: '#7c3aed', margin: '4px 0 0' }}>
            {total > 0 ? Math.round((approvedCount / total) * 100) : 0}% complete
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {source.website_url && isReviewer && (
            <Button variant="secondary" size="sm" onClick={onVerify} loading={verifying}>
              <Shield className="w-3.5 h-3.5" /> LLM Verify
            </Button>
          )}
          {(isReviewer || isAdmin) && (
            <Button size="sm" onClick={onReview} style={{ background: '#7c3aed', border: 'none', color: '#fff' }}>
              <Eye className="w-3.5 h-3.5" /> Review Records →
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  // Step 3 — Approve source
  if (step === 3) return (
    <div style={{ background: '#f0fdf4', border: '2px solid #10b981', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#065f46', margin: 0 }}>
            ✅ Step 3 of 4 — Approve the Source
          </p>
          <p style={{ fontSize: 13, color: '#059669', margin: '4px 0 0' }}>
            All {total} records are approved. Click to lock this source and unlock the Submit step.
          </p>
        </div>
        {(isReviewer || isAdmin) && (
          <Button size="sm" onClick={onApprove} style={{ background: '#10b981', border: 'none', color: '#fff', fontSize: 14, padding: '10px 24px' }}>
            <CheckCircle className="w-4 h-4" /> Approve Source
          </Button>
        )}
      </div>
    </div>
  )

  // Step 4 — Submit
  const s4submittedCount = records.filter((r: any) => r.is_submitted).length
  const pendingSubmit     = records.filter((r: any) => !r.is_submitted && r.review_status === 'approved').length
  if (step === 4) return (
    <div style={{ background: '#fff7ed', border: '2px solid #f97316', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#9a3412', margin: 0 }}>
            🚀 Step 4 of 4 — Submit Records to Client
          </p>
          <p style={{ fontSize: 13, color: '#ea580c', margin: '4px 0 0' }}>
            {pendingSubmit > 0
              ? `${pendingSubmit} approved record${pendingSubmit !== 1 ? 's' : ''} ready to submit${s4submittedCount > 0 ? ` · ${s4submittedCount} already submitted` : ''}.`
              : `All ${s4submittedCount} record${s4submittedCount !== 1 ? 's' : ''} have been submitted. Use Unlock Records to re-submit if needed.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={onExport}>
              <Download className="w-3.5 h-3.5" /> Export Package
            </Button>
          )}
          {pendingSubmit > 0 ? (
            <Button size="sm" onClick={onSubmit} style={{ background: '#ea580c', border: 'none', color: '#fff', fontSize: 14, padding: '10px 24px' }}>
              <Send className="w-4 h-4" /> Submit {pendingSubmit} Record{pendingSubmit !== 1 ? 's' : ''} →
            </Button>
          ) : (
            <span style={{ fontSize: 12, background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', padding: '8px 16px', borderRadius: 20, fontWeight: 700 }}>
              🎉 All records submitted
            </span>
          )}
        </div>
      </div>
    </div>
  )

  // Step 5 — Done
  return (
    <div style={{ background: '#f0fdf4', border: '2px solid #10b981', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#065f46', margin: 0 }}>
            🎉 Complete — {submittedCount} record{submittedCount !== 1 ? 's' : ''} submitted
          </p>
          <p style={{ fontSize: 13, color: '#059669', margin: '4px 0 0' }}>
            This source is fully delivered. Download the export package for the client.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={onExport} style={{ background: '#059669', border: 'none', color: '#fff' }}>
            <Download className="w-4 h-4" /> Download Export
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Status meta ────────────────────────────────────────────────────────────────
const STATUS_META: Record<SourceStatus, { label: string; color: 'gray'|'amber'|'red'|'blue'|'purple'|'green'|'indigo' }> = {
  not_started:       { label: 'Not Started',           color: 'gray'   },
  extracting:        { label: 'Uploading…',             color: 'blue'   },
  needs_fixes:       { label: 'Schema Errors',          color: 'amber'  },
  ready_for_review:  { label: 'Awaiting Review',        color: 'indigo' },
  in_review:         { label: 'In Review',              color: 'purple' },
  changes_requested: { label: 'Corrections Needed',     color: 'red'    },
  llm_verification:  { label: 'LLM Check Done',         color: 'purple' },
  approved:          { label: 'Approved ✓',             color: 'green'  },
}

type Tab = 'records' | 'details'

export function SourceDetailPage() {
  const { projectId, sourceId } = useParams<{ projectId: string; sourceId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [project, setProject] = useState<Project | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [records, setRecords] = useState<any[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('records')
  const [validityFilter, setValidityFilter] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showEditSource, setShowEditSource] = useState(false)
  const [editSourceForm, setEditSourceForm] = useState({ name: '', description: '', website_url: '' })
  const [showSchemaJson, setShowSchemaJson] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [editRecord, setEditRecord] = useState<any | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteSourceConfirm, setDeleteSourceConfirm] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetClearRecords, setResetClearRecords] = useState(true)
  const [deleteRecord, setDeleteRecord] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [schemaDefinition, setSchemaDefinition] = useState<any>(null)
  const [showSchemaPanel, setShowSchemaPanel] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const [showVerifyResult, setShowVerifyResult] = useState(false)
  const [activeRecordIndex, setActiveRecordIndex] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showAdminActions, setShowAdminActions] = useState(false)

  const load = () => {
    if (!projectId || !sourceId) return
    projectsApi.get(projectId).then(setProject).catch(() => {})
    sourcesApi.get(sourceId).then(setSource).catch(() => {})
    sourcesApi.records(sourceId, { validity: validityFilter || undefined, page_size: 200 })
      .then((r: any) => setRecords(r?.items ?? []))
      .catch(() => toast.error('Could not load records — refresh to retry'))
    projectsApi.listMembers(projectId)
      .then((m: any) => setMembers(m.map((x: any) => ({ id: x.user_id, full_name: x.full_name, email: x.email }))))
      .catch(() => {})
    sourcesApi.schema(sourceId).then(setSchemaDefinition).catch(() => {})
    setLoading(false)
  }
  useEffect(() => {
    load()
    // Poll every 20s — source status, record counts and review statuses can change
    const iv = setInterval(load, 20_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load() })
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [projectId, sourceId, validityFilter])

  const userRoles = user?.roles ?? []
  const isAdmin = userRoles.includes('org_admin') || userRoles.includes('project_admin')
  const isExtractor = source?.assigned_extractor_id === user?.id || isAdmin
  const isReviewer = source?.assigned_reviewer_id === user?.id || isAdmin || userRoles.includes('qa_lead')

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !sourceId) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const summary = await sourcesApi.upload(sourceId, fd)
      const isZip = file.name.toLowerCase().endsWith('.zip')
      const isAI = summary.extraction_method === 'llm'
      const method = isAI ? 'AI extraction' : isZip ? `${summary.files_processed} file${summary.files_processed !== 1 ? 's' : ''} from ZIP` : 'schema mapping'
      toast.success(`Uploaded via ${method}: ${summary.valid_rows} valid, ${summary.invalid_rows} need fixes`)
      setShowUpload(false)
      setFile(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Upload failed')
    } finally { setUploading(false) }
  }

  const handleAssign = async (field: 'assigned_extractor_id' | 'assigned_reviewer_id', value: string) => {
    if (!sourceId) return
    try { await sourcesApi.update(sourceId, { [field]: value }); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed to assign') }
  }

  const handleFixRecord = async (recordId: string, fields: Record<string, unknown>) => {
    if (!sourceId) return
    await sourcesApi.fixRecord(sourceId, recordId, fields)
    load()
  }

  const handleReviewRecord = async (recordId: string, action: 'approve' | 'reject', note?: string) => {
    if (!sourceId) return
    await sourcesApi.reviewRecord(sourceId, recordId, action, note)
    load()
  }

  const openEdit = (record: any) => {
    setEditRecord(record)
    const strFields: Record<string, string> = {}
    Object.entries(record.extracted_fields || {}).forEach(([k, v]) => { strFields[k] = String(v ?? '') })
    setEditFields(strFields)
  }

  const saveEdit = async () => {
    if (!editRecord || !sourceId) return
    setSavingEdit(true)
    try {
      await sourcesApi.fixRecord(sourceId, editRecord.id, editFields)
      toast.success('Record updated')
      setEditRecord(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to save')
    } finally { setSavingEdit(false) }
  }

  const handleApproveSource = async () => {
    if (!sourceId) return
    try { await sourcesApi.approve(sourceId); toast.success('Source approved!'); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Cannot approve yet — check that all records are approved') }
  }

  const handleExport = async () => {
    if (!sourceId || !source) return
    try { await sourcesApi.export(sourceId, `${source.name.replace(/[^a-z0-9]/gi, '_')}_export.zip`); toast.success('Export downloaded') }
    catch (err: any) { toast.error('Export failed — source must be approved first') }
  }

  const handleDeleteSource = async () => {
    if (!sourceId || !projectId) return
    setDeleting(true)
    try { await sourcesApi.delete(sourceId); toast.success('Source deleted'); navigate(`/projects/${projectId}/sources`) }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Cannot delete this source'); setDeleting(false); setDeleteSourceConfirm(false) }
  }

  const handleSubmitSource = async () => {
    if (!sourceId) return
    setSubmitting(true)
    try {
      const jobs = await jobsApi.list({ source_id: sourceId, page_size: 10 })
      const sourceJobs = (jobs.items || jobs || []).filter((j: any) => j.source_id === sourceId || j.project_id)
      let submitted = false
      for (const job of sourceJobs) {
        try {
          const resp = await submissionApi.submit(job.id)
          const blob = new Blob([resp.data], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const cn = source?.canonical_name || source?.name?.toLowerCase().replace(/\s+/g, '-') || 'submission'
          a.download = `${cn}_submission.json`
          a.click()
          URL.revokeObjectURL(url)
          submitted = true
          toast.success('Submission complete — file downloaded with SHA256 audit trail')
          load()
          break
        } catch { continue }
      }
      if (!submitted) toast.error('No approved records found to submit. Approve records first then approve the source.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Submission failed')
    } finally { setSubmitting(false) }
  }

  const handleUpdateSource = async () => {
    if (!sourceId) return
    try {
      await sourcesApi.update(sourceId, { name: editSourceForm.name, description: editSourceForm.description || null, website_url: editSourceForm.website_url || null })
      toast.success('Source updated')
      setShowEditSource(false)
      load()
    } catch (err: any) { toast.error(err?.response?.data?.detail || 'Update failed') }
  }

  const handleReset = async () => {
    if (!sourceId) return
    setResetting(true)
    try {
      await sourcesApi.reset(sourceId, resetClearRecords)
      toast.success(`Source reset to "Not Started"${resetClearRecords ? ' — all records cleared' : ''}`)
      setShowReset(false)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Reset failed')
    } finally { setResetting(false) }
  }

  const handleDeleteRecord = async () => {
    if (!deleteRecord || !sourceId) return
    setDeleting(true)
    try { await sourcesApi.deleteRecord(sourceId, deleteRecord.id); toast.success('Record deleted'); setDeleteRecord(null); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed to delete record') }
    finally { setDeleting(false) }
  }

  const handleScrape = async () => {
    if (!sourceId) return
    setScraping(true)
    try { const summary = await sourcesApi.scrape(sourceId); toast.success(`Scraped: ${summary.valid_rows} records extracted, ${summary.invalid_rows} need fixes`); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Scraping failed — check the website URL is accessible') }
    finally { setScraping(false) }
  }

  const handleVerify = async () => {
    if (!sourceId) return
    setVerifying(true)
    setVerifyResult(null)
    try {
      const result = await sourcesApi.verify(sourceId)
      setVerifyResult(result)
      setShowVerifyResult(true)
      toast.success(`Verification complete — ${result.verified} pass, ${result.flagged} flagged`)
      load()
    } catch (err: any) { toast.error(err?.response?.data?.detail || 'Verification failed') }
    finally { setVerifying(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  if (!source) return <EmptyState title="Source not found" />

  if (activeRecordIndex !== null && records[activeRecordIndex]) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden' }}>
        <JsonRecordViewer
          record={records[activeRecordIndex]}
          allRecords={records}
          currentIndex={activeRecordIndex}
          schemaFields={schemaDefinition?.fields ?? []}
          extractionInstructions={schemaDefinition?.extraction_instructions}
          schemaName={schemaDefinition?.name}
          sourceWebsiteUrl={source.website_url}
          sourceId={sourceId!}
          isExtractor={isExtractor}
          isReviewer={isReviewer}
          onFix={handleFixRecord}
          onReview={handleReviewRecord}
          onNavigate={setActiveRecordIndex}
          onClose={() => { setActiveRecordIndex(null); load() }}
        />
      </div>
    )
  }

  const meta = STATUS_META[source.status]
  const pendingCount = records.filter(r => r.review_status === 'pending').length
  const approvedCount = records.filter(r => r.review_status === 'approved').length
  const allRecordsApproved = records.length > 0 && records.every(r => r.review_status === 'approved')
  const currentStep = getStep(source.status, records)

  // Open first pending record for review
  const handleReviewNext = () => {
    const firstPendingIdx = records.findIndex(r => r.review_status === 'pending')
    if (firstPendingIdx !== -1) setActiveRecordIndex(firstPendingIdx)
    else if (records.length > 0) setActiveRecordIndex(0)
  }

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">

      {/* ── Breadcrumb + title ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link to={`/projects/${projectId}`} className="hover:text-gray-600 font-medium">{project?.name}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link to={`/projects/${projectId}/sources`} className="hover:text-gray-600">Sources</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-700 font-semibold truncate max-w-[220px]">{source.name}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{source.name}</h1>
            <Badge variant={meta.color}>{meta.label}</Badge>
            {source.website_url && (
              <a href={source.website_url} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> {source.website_url}
              </a>
            )}
          </div>
        </div>

        {/* Admin actions dropdown */}
        {isAdmin && (
          <div style={{ position: 'relative' }}>
            <Button variant="secondary" size="sm" onClick={() => setShowAdminActions(v => !v)}>
              <MoreHorizontal className="w-4 h-4" /> Admin Actions <ChevronDown className="w-3.5 h-3.5" />
            </Button>
            {showAdminActions && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowAdminActions(false)} />
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 200, overflow: 'hidden' }}>
                  {[
                    { icon: Edit3, label: 'Edit Source', action: () => { setEditSourceForm({ name: source.name, description: source.description || '', website_url: source.website_url || '' }); setShowEditSource(true); setShowAdminActions(false) }, color: '#374151' },
                    { icon: Trash2, label: 'Clear Records', action: async () => { setShowAdminActions(false); if (!window.confirm(`Clear all ${records.length} records from "${source.name}"?`)) return; try { const r = await sourcesApi.clearRecords(sourceId!); toast.success(r.message || 'Records cleared'); load() } catch (err: any) { toast.error(err?.response?.data?.detail || 'Clear failed') } }, color: '#d97706', show: records.length > 0 },
                    { icon: RotateCcw, label: 'Reset Source', action: () => { setShowReset(true); setShowAdminActions(false) }, color: '#d97706' },
                    { icon: source.status === 'approved' ? Unlock : undefined, label: source.status === 'approved' ? 'Unlock Records' : undefined, action: async () => { setShowAdminActions(false); if (!window.confirm('Unlock submitted records for re-review?')) return; try { const r = await sourcesApi.unlockRecords(sourceId!); toast.success(r.message || 'Unlocked'); load() } catch (err: any) { toast.error(err?.response?.data?.detail || 'Unlock failed') } }, color: '#d97706', show: source.status === 'approved' },
                    { icon: Trash2, label: 'Delete Source', action: () => { setDeleteSourceConfirm(true); setShowAdminActions(false) }, color: '#dc2626', show: source.status !== 'approved' },
                  ].filter(item => item.label && item.show !== false).map(({ icon: Icon, label, action, color }: any) => (
                    <button key={label} onClick={action}
                      style={{ width: '100%', padding: '10px 16px', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color, fontWeight: 500 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      {Icon && <Icon size={14} />} {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Step pipeline ─────────────────────────────────────────────────────── */}
      <StepPipeline currentStep={currentStep} />

      {/* ── Primary action panel ──────────────────────────────────────────────── */}
      <PrimaryActionPanel
        step={currentStep}
        source={source}
        records={records}
        isExtractor={isExtractor}
        isReviewer={isReviewer}
        isAdmin={isAdmin}
        onUpload={() => setShowUpload(true)}
        onReview={handleReviewNext}
        onApprove={handleApproveSource}
        onSubmit={handleSubmitSource}
        onExport={handleExport}
        scraping={scraping}
        verifying={verifying}
        onScrape={handleScrape}
        onVerify={handleVerify}
      />

      {/* ── Stats row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Records', value: source.total_records, icon: '📋', top: '#6366f1', bg: '#eef2ff', val: '#4338ca' },
          { label: 'Schema Valid', value: source.valid_records, icon: '✅', top: '#10b981', bg: '#ecfdf5', val: '#065f46' },
          { label: 'Needs Fixes', value: source.invalid_records, icon: '⚠️', top: '#f59e0b', bg: '#fffbeb', val: '#92400e' },
          { label: 'Approved', value: source.approved_records, icon: '🎯', top: '#3b82f6', bg: '#eff6ff', val: '#1d4ed8' },
        ].map(({ label, value, icon, top, bg, val }) => (
          <div key={label} style={{ background: bg, borderRadius: 14, borderTop: `3px solid ${top}`, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ fontSize: 26, fontWeight: 800, color: val, lineHeight: 1 }}>{value}</span>
            </div>
            <p style={{ fontSize: 11, fontWeight: 600, color: val, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
            {source.total_records > 0 && (
              <div style={{ marginTop: 6, background: 'rgba(255,255,255,0.6)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                <div style={{ background: top, height: '100%', borderRadius: 99, width: `${Math.min(100, Math.round((value / source.total_records) * 100))}%`, transition: 'width 0.6s ease' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Team assignment row ───────────────────────────────────────────────── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {[
          { role: 'Extractor', emoji: '⛏️', field: 'assigned_extractor_id' as const, name: source.assigned_extractor_name, id: source.assigned_extractor_id },
          { role: 'Reviewer', emoji: '🔍', field: 'assigned_reviewer_id' as const, name: source.assigned_reviewer_name, id: source.assigned_reviewer_id },
        ].map(({ role, emoji, field, name, id }) => (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{emoji}</div>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>{role}</p>
              {isAdmin ? (
                <Select value={id ?? ''} onChange={e => handleAssign(field, e.target.value)} className="!py-0.5 !text-xs !h-7 w-36">
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </Select>
              ) : (
                <p style={{ fontSize: 13, fontWeight: 600, color: name ? '#0f172a' : '#94a3b8', margin: 0 }}>{name ?? 'Unassigned'}</p>
              )}
            </div>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
          <Clock className="w-3 h-3" /> Updated {safeFromNow(source.updated_at)}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, padding: '4px', background: '#f1f5f9', borderRadius: 12, alignSelf: 'flex-start' }}>
        {(['records', 'details'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            background: tab === t ? '#fff' : 'transparent',
            color: tab === t ? '#1d4ed8' : '#64748b',
            boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
          }}>
            {t === 'records' ? `Records (${records.length})` : 'Details & Notes'}
          </button>
        ))}
      </div>

      {tab === 'records' && (
        <div className="space-y-4">
          {/* LLM verify result banner */}
          {showVerifyResult && verifyResult && (
            <div className={cn('border rounded-xl p-4 flex items-start justify-between gap-4', verifyResult.flagged > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200')}>
              <div className="flex items-start gap-3">
                <Shield className={cn('w-4 h-4 mt-0.5 shrink-0', verifyResult.flagged > 0 ? 'text-amber-600' : 'text-emerald-600')} />
                <div>
                  <p className={cn('text-sm font-semibold', verifyResult.flagged > 0 ? 'text-amber-800' : 'text-emerald-800')}>LLM Website Verification Complete</p>
                  <p className="text-xs mt-1 text-gray-600">{verifyResult.message}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-emerald-700 font-medium">✓ {verifyResult.verified} verified</span>
                    <span className="text-amber-600 font-medium">⚠ {verifyResult.flagged} flagged</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setShowVerifyResult(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {['', 'valid', 'invalid'].map(v => (
              <button key={v} onClick={() => setValidityFilter(v)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  validityFilter === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                {v === '' ? 'All' : v === 'valid' ? 'Schema-valid' : 'Needs fixes'}
              </button>
            ))}
            {schemaDefinition?.fields?.length > 0 && (
              <button onClick={() => setShowSchemaPanel(p => !p)}
                className={cn('ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  showSchemaPanel ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                <Info className="w-3.5 h-3.5" /> Schema Reference
              </button>
            )}
          </div>

          <div className={cn('flex gap-4', showSchemaPanel ? 'items-start' : '')}>
            {showSchemaPanel && schemaDefinition && (
              <div className="w-72 shrink-0">
                <Card className="p-4 sticky top-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{schemaDefinition.name || 'Schema'} Fields</h4>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowSchemaJson(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                        <Code className="w-3 h-3" /> Full JSON
                      </button>
                      <button onClick={() => setShowSchemaPanel(false)} className="text-gray-400 hover:text-gray-600"><XCircle className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  {schemaDefinition.extraction_instructions && (
                    <div className="mb-3 p-2 bg-brand-50 rounded-lg text-xs text-brand-700 leading-relaxed">{schemaDefinition.extraction_instructions}</div>
                  )}
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
                    {(schemaDefinition.fields || []).map((f: any) => (
                      <div key={f.name} className={cn('p-2.5 rounded-lg border text-xs', 'fixed_value' in f ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200')}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-semibold text-gray-800">{f.name}</span>
                          <span className="text-gray-400">{f.type || 'string'}</span>
                          {f.required && <span className="text-red-500 font-medium">required</span>}
                          {'fixed_value' in f && <span className="text-blue-500">fixed: {String(f.fixed_value)}</span>}
                        </div>
                        {f.description && <p className="text-gray-500 mt-1 leading-relaxed">{f.description}</p>}
                        {f.enum?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {f.enum.map((v: string) => (<span key={v} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs font-mono">{v}</span>))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            <div className="flex-1 min-w-0">
              {records.length === 0 ? (
                <EmptyState title="No records yet"
                  description={isExtractor ? 'Upload a file or use Auto-Scrape Website to extract records.' : 'Waiting for the extractor to upload data.'}
                  action={isExtractor ? (
                    <div className="flex gap-2 flex-wrap justify-center">
                      <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4" /> Upload File</Button>
                      {source.website_url && (<Button variant="secondary" onClick={handleScrape} loading={scraping}><Search className="w-4 h-4" /> Auto-Scrape Website</Button>)}
                    </div>
                  ) : undefined}
                />
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                          {['Company', 'Sites', 'Products', 'Schema', 'Web Check', 'Review', ''].map((h, i) => (
                            <th key={h + i} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
                              className={i > 0 && i < 5 && i !== 3 ? 'hidden md:table-cell' : ''}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {records.map((r, idx) => {
                          const ef = r.extracted_fields || {}
                          const primaryName = String(ef.company_name || ef.material_name || r.canonical_name || r.id.slice(0, 8))
                          const sector = ef.industry_sector as string | undefined
                          const tier = ef.supply_chain_tier as number | undefined
                          const sites = Array.isArray(ef.manufacturing_sites) ? ef.manufacturing_sites.length : 0
                          const products = Array.isArray(ef.products_offered) ? ef.products_offered.length : 0
                          const webFlagCount = (r.web_check_flags || []).length
                          return (
                            <tr key={r.id}
                              style={{ borderLeft: `3px solid ${r.review_status === 'approved' ? '#10b981' : r.review_status === 'rejected' ? '#ef4444' : r.is_schema_valid ? '#6366f1' : '#f59e0b'}`, cursor: 'pointer', transition: 'background 0.1s' }}
                              className="hover:bg-slate-50 transition"
                              onClick={() => setActiveRecordIndex(idx)}>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-gray-900 truncate max-w-[200px]">{primaryName}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {sector && <span className="text-xs text-gray-400">{sector}</span>}
                                  {tier && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 rounded">tier {tier}</span>}
                                </div>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                {sites > 0 ? <span className="text-sm font-medium text-gray-700">🏭 {sites} site{sites !== 1 ? 's' : ''}</span> : <span className="text-xs text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                {products > 0 ? <span className="text-sm font-medium text-gray-700">📦 {products} product{products !== 1 ? 's' : ''}</span> : <span className="text-xs text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-3">
                                {r.is_schema_valid ? (
                                  <Badge variant="green"><CheckCircle className="w-3 h-3" /> Valid</Badge>
                                ) : (
                                  <div>
                                    <Badge variant="amber"><AlertCircle className="w-3 h-3" /> {r.validation_errors.length} error{r.validation_errors.length !== 1 ? 's' : ''}</Badge>
                                    <div className="mt-1 space-y-0.5">
                                      {r.validation_errors.slice(0, 2).map((e: any, i: number) => (<p key={i} className="text-xs text-amber-600">{e.field}: {e.error}</p>))}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                {r.web_verified === null || r.web_verified === undefined ? (
                                  <span className="text-xs text-gray-300">Not run</span>
                                ) : r.web_verified ? (
                                  <Badge variant="green"><CheckCircle className="w-3 h-3" /> Verified</Badge>
                                ) : (
                                  <div>
                                    <Badge variant="red"><AlertCircle className="w-3 h-3" /> {webFlagCount} issue{webFlagCount !== 1 ? 's' : ''}</Badge>
                                    {(r.web_check_flags || []).slice(0, 1).map((f: any, i: number) => (
                                      <p key={i} className="text-xs text-red-600 mt-0.5"><span className="font-mono">{f.field}</span>: {f.issue}</p>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <ReviewBadge status={r.review_status} submitted={r.is_submitted} />
                                {r.review_note && <p className="text-xs text-gray-400 mt-0.5 max-w-[160px] truncate">"{r.review_note}"</p>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center gap-2 justify-end">
                                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', whiteSpace: 'nowrap' }}>Open →</span>
                                  {isExtractor && (
                                    <button onClick={e => { e.stopPropagation(); setDeleteRecord(r) }} className="p-1 text-gray-300 hover:text-red-500 transition">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Source Information</h3>
            {[
              { label: 'Schema', value: source.schema_name },
              { label: 'Description', value: source.description || '(none)' },
              { label: 'Website', value: source.website_url || '(none)' },
              { label: 'Created', value: safeFormat(source.created_at, 'MMM d, yyyy HH:mm') },
              { label: 'Extraction started', value: source.extraction_started_at ? format(new Date(source.extraction_started_at), 'MMM d, HH:mm') : '—' },
              { label: 'Review started', value: source.review_started_at ? format(new Date(source.review_started_at), 'MMM d, HH:mm') : '—' },
              { label: 'Approved', value: source.approved_at ? format(new Date(source.approved_at), 'MMM d, HH:mm') : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-800 text-right max-w-[60%] truncate">{value}</span>
              </div>
            ))}
          </Card>
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes & Assumptions</h3>
            <p className="text-xs text-gray-400 mb-3">Visible on the final export cover sheet.</p>
            <NotesEditor source={source} canEdit={isExtractor || isReviewer} onSave={load} />
          </Card>
        </div>
      )}

      {/* ── Upload modal ───────────────────────────────────────────────────────── */}
      <Modal open={showUpload} onClose={() => !uploading && setShowUpload(false)} title="Upload Data" description="Upload extracted data to this source — individual files or a ZIP bundle.">
        <form onSubmit={handleUpload} className="space-y-4">
          {source.total_records > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Re-uploading replaces all {source.total_records} existing records in this source.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { icon: '🗂️', label: 'ZIP of JSONs', desc: 'Bundle from extractor script' },
              { icon: '📄', label: 'JSON / CSV / Excel', desc: 'Single structured file' },
              { icon: '📋', label: 'PDF / TXT', desc: 'AI extracts records automatically' },
              { icon: '⚡', label: 'Auto-Scrape', desc: 'Use the scrape button instead', highlight: true },
            ].map(({ icon, label, desc, highlight }) => (
              <div key={label} className={cn('flex items-start gap-2 p-2.5 rounded-lg border', highlight ? 'bg-brand-50 border-brand-100' : 'bg-gray-50 border-gray-100')}>
                <span className="text-base leading-none mt-0.5">{icon}</span>
                <div>
                  <p className={cn('font-medium', highlight ? 'text-brand-700' : 'text-gray-700')}>{label}</p>
                  <p className={cn('leading-relaxed mt-0.5', highlight ? 'text-brand-500' : 'text-gray-400')}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div onClick={() => !uploading && fileRef.current?.click()}
            className={cn('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition',
              file ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
              uploading && 'opacity-60 cursor-not-allowed')}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.pdf,.txt,.zip" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
            {file ? (
              <div>
                <p className="text-sm font-semibold text-brand-700">{file.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 font-medium">Drop a file or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">ZIP · JSON · CSV · Excel · PDF · TXT</p>
              </div>
            )}
          </div>
          {file && /\.(pdf|txt)$/i.test(file.name) && (
            <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-xl p-3">
              <Brain className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <p className="text-xs text-purple-700"><strong>AI extraction</strong> — Claude will read this document and extract records matching the schema. Takes 10–30 seconds.</p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</Button>
            <Button type="submit" loading={uploading} disabled={!file}>
              {uploading ? (file?.name.toLowerCase().endsWith('.zip') ? 'Processing ZIP…' : file && /\.(pdf|txt)$/i.test(file.name) ? 'AI extracting…' : 'Uploading…') : <><Upload className="w-4 h-4" /> Upload & Validate</>}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit record modal ─────────────────────────────────────────────────── */}
      <Modal open={!!editRecord} onClose={() => setEditRecord(null)} title="Fix Record" size="md">
        {editRecord && (
          <div className="space-y-4">
            {!editRecord.is_schema_valid && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                {editRecord.validation_errors.map((e: any, i: number) => (<p key={i} className="text-xs text-amber-700"><strong>{e.field}:</strong> {e.error}</p>))}
              </div>
            )}
            <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-thin">
              {Object.entries(editFields).map(([key, value]) => (
                <Input key={key} label={key} value={value} onChange={e => setEditFields(f => ({ ...f, [key]: e.target.value }))} />
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditRecord(null)}>Cancel</Button>
              <Button onClick={saveEdit} loading={savingEdit}><Save className="w-4 h-4" /> Save & Revalidate</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={deleteSourceConfirm} title="Delete Source"
        description={`"${source.name}" and all its records will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete Source" variant="danger" loading={deleting}
        onConfirm={handleDeleteSource} onCancel={() => setDeleteSourceConfirm(false)} />
      <ConfirmDialog open={!!deleteRecord} title="Delete Record"
        description="This record will be permanently deleted from the source."
        confirmLabel="Delete Record" variant="danger" loading={deleting}
        onConfirm={handleDeleteRecord} onCancel={() => setDeleteRecord(null)} />

      {/* Edit Source modal */}
      <Modal open={showEditSource} onClose={() => setShowEditSource(false)} title="Edit Source" description="Update the source name, description, or website URL.">
        <div className="space-y-4">
          <Input label="Source Name" value={editSourceForm.name} onChange={e => setEditSourceForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="Website URL" value={editSourceForm.website_url} placeholder="https://www.company.com" onChange={e => setEditSourceForm(f => ({ ...f, website_url: e.target.value }))} />
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
            <textarea value={editSourceForm.description} rows={3} onChange={e => setEditSourceForm(f => ({ ...f, description: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Brief description…" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowEditSource(false)}>Cancel</Button>
            <Button onClick={handleUpdateSource} disabled={!editSourceForm.name.trim()}><Save className="w-4 h-4" /> Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Schema JSON modal */}
      <Modal open={showSchemaJson} onClose={() => setShowSchemaJson(false)} title={schemaDefinition?.name || 'Schema Definition'} size="lg">
        <div style={{ height: 500, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <textarea readOnly value={JSON.stringify(schemaDefinition, null, 2)}
            style={{ width: '100%', height: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 16, border: 'none', outline: 'none', resize: 'none', background: '#0f172a', color: '#e2e8f0', lineHeight: 1.6 }} />
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(JSON.stringify(schemaDefinition, null, 2)); toast.success('Copied') }}>Copy JSON</Button>
        </div>
      </Modal>

      {/* Reset modal */}
      <Modal open={showReset} onClose={() => !resetting && setShowReset(false)} title="Reset Source" description="Undo all extraction progress and start from scratch.">
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
            <p className="font-semibold mb-1">⚠ Admin Action — "{source?.name}"</p>
            <p>Resets status to <strong>Not Started</strong>. Use this to recover from bad data.</p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-gray-50 rounded-xl border border-gray-200">
            <input type="checkbox" checked={resetClearRecords} onChange={e => setResetClearRecords(e.target.checked)} className="w-4 h-4 text-orange-500" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Clear all records ({source?.total_records} records)</p>
              <p className="text-xs text-gray-500">Recommended — removes incorrect records</p>
            </div>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowReset(false)} disabled={resetting}>Cancel</Button>
            <Button onClick={handleReset} loading={resetting} className="!bg-orange-500 hover:!bg-orange-600">
              <RotateCcw className="w-4 h-4" /> Reset{resetClearRecords ? ' & Clear Records' : ' Status Only'}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}

function ReviewBadge({ status, submitted }: { status: string; submitted?: boolean }) {
  if (submitted) return <Badge variant="green">🚀 Submitted</Badge>
  const map: Record<string, { variant: 'green' | 'red' | 'gray' | 'amber'; label: string }> = {
    pending: { variant: 'gray', label: 'Pending' },
    approved: { variant: 'green', label: '✓ Approved' },
    rejected: { variant: 'red', label: 'Sent back' },
  }
  const m = map[status] ?? map.pending
  return <Badge variant={m.variant}>{m.label}</Badge>
}

function NotesEditor({ source, canEdit, onSave }: { source: Source; canEdit: boolean; onSave: () => void }) {
  const [notes, setNotes] = useState(source.notes ?? '')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try { await sourcesApi.update(source.id, { notes }); toast.success('Notes saved'); onSave() }
    catch { toast.error('Failed to save notes') }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-3">
      <Textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit}
        placeholder="Any assumptions made during extraction, known data gaps, or context for the next person…" />
      {canEdit && (
        <Button size="sm" onClick={save} loading={saving} disabled={notes === (source.notes ?? '')}>
          <Save className="w-3.5 h-3.5" /> Save Notes
        </Button>
      )}
    </div>
  )
}
