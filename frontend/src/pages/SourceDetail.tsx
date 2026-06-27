import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { JsonRecordViewer } from './JsonRecordViewer'
import {
  ArrowLeft, Globe, Upload, Download, CheckCircle, XCircle,
  Edit3, ChevronRight, AlertCircle, Save, Users as UsersIcon,
  Clock, Brain, Trash2, Search, Sparkles, Shield, Info, ChevronDown, RotateCcw, Code, Eye
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi, recordsApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, ConfirmDialog, cn, toast, safeFromNow, safeFormat } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { format, formatDistanceToNow } from 'date-fns'

const STATUS_META: Record<SourceStatus, { label: string; color: 'gray'|'amber'|'red'|'blue'|'purple'|'green'|'indigo' }> = {
  not_started:       { label: 'Not Started',      color: 'gray' },
  extracting:        { label: 'Extracting',       color: 'blue' },
  needs_fixes:       { label: 'Needs Fixes',       color: 'amber' },
  ready_for_review:  { label: 'Ready for Review',  color: 'indigo' },
  in_review:         { label: 'In Review',         color: 'purple' },
  changes_requested: { label: 'Changes Requested', color: 'red' },
  llm_verification:  { label: 'LLM Verification',  color: 'purple' },
  approved:          { label: 'Approved',          color: 'green' },
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
  // New capabilities
  const [schemaDefinition, setSchemaDefinition] = useState<any>(null)
  const [showSchemaPanel, setShowSchemaPanel] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const [showVerifyResult, setShowVerifyResult] = useState(false)
  // JSON Record Viewer
  const [activeRecordIndex, setActiveRecordIndex] = useState<number | null>(null)

  const load = () => {
    if (!projectId || !sourceId) return
    // Load each piece independently so one failure doesn't wipe all data
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
  useEffect(() => { load() }, [projectId, sourceId, validityFilter])

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
    } finally {
      setUploading(false)
    }
  }

  const handleAssign = async (field: 'assigned_extractor_id' | 'assigned_reviewer_id', value: string) => {
    if (!sourceId) return
    try {
      await sourcesApi.update(sourceId, { [field]: value })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to assign')
    }
  }

  const handleReview = async (recordId: string, action: 'approve' | 'reject', note?: string) => {
    if (!sourceId) return
    try {
      await sourcesApi.reviewRecord(sourceId, recordId, action, note)
      toast.success(action === 'approve' ? 'Record approved' : 'Sent back to extractor')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Review action failed')
    }
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
    } finally {
      setSavingEdit(false)
    }
  }

  const handleApproveSource = async () => {
    if (!sourceId) return
    try {
      await sourcesApi.approve(sourceId)
      toast.success('Source approved!')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Cannot approve yet — check that all records are approved')
    }
  }

  const handleExport = async () => {
    if (!sourceId || !source) return
    try {
      await sourcesApi.export(sourceId, `${source.name.replace(/[^a-z0-9]/gi, '_')}_export.zip`)
      toast.success('Export downloaded')
    } catch (err: any) {
      toast.error('Export failed — source must be approved first')
    }
  }

  const handleDeleteSource = async () => {
    if (!sourceId || !projectId) return
    setDeleting(true)
    try {
      await sourcesApi.delete(sourceId)
      toast.success('Source deleted')
      navigate(`/projects/${projectId}/sources`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Cannot delete this source')
      setDeleting(false)
      setDeleteSourceConfirm(false)
    }
  }

  const handleUpdateSource = async () => {
    if (!sourceId) return
    try {
      await sourcesApi.update(sourceId, {
        name: editSourceForm.name,
        description: editSourceForm.description || null,
        website_url: editSourceForm.website_url || null,
      })
      toast.success('Source updated')
      setShowEditSource(false)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Update failed')
    }
  }

  const handleReset = async () => {    if (!sourceId) return
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

  const handleDeleteRecord = async () => {    if (!deleteRecord || !sourceId) return
    setDeleting(true)
    try {
      await sourcesApi.deleteRecord(sourceId, deleteRecord.id)
      toast.success('Record deleted')
      setDeleteRecord(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete record')
    } finally { setDeleting(false) }
  }

  const handleScrape = async () => {
    if (!sourceId) return
    setScraping(true)
    try {
      const summary = await sourcesApi.scrape(sourceId)
      toast.success(`Scraped: ${summary.valid_rows} records extracted, ${summary.invalid_rows} need fixes`)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Scraping failed — check the website URL is accessible')
    } finally { setScraping(false) }
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
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Verification failed')
    } finally { setVerifying(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
  if (!source) return <EmptyState title="Source not found" />

  // ── If a record is open, portal the viewer to <body> so app shell can't clip it ──
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
  // Show Approve button for any reviewer/admin whenever source is not yet approved
  // Don't gatekeep on source.total_records (counter can lag) — backend validates
  const canApproveSource = (isReviewer || isAdmin) && source.status !== 'approved'
  const allRecordsApproved = records.length > 0 && records.every(r => r.review_status === 'approved')
  const pendingCount = records.filter(r => r.review_status === 'pending').length
  const approvedCount = records.filter(r => r.review_status === 'approved').length

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link to={`/projects/${projectId}`} className="hover:text-gray-600">{project?.name}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link to={`/projects/${projectId}/sources`} className="hover:text-gray-600">Sources</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-600 truncate max-w-[200px]">{source.name}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{source.name}</h1>
            <Badge variant={meta.color}>{meta.label}</Badge>
          </div>
          {source.website_url && (
            <a href={source.website_url} target="_blank" rel="noopener noreferrer"
              className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1 mt-1">
              <Globe className="w-3.5 h-3.5" /> {source.website_url}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isExtractor && source.status !== 'approved' && (
            <Button variant="secondary" size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="w-3.5 h-3.5" /> Upload Data
            </Button>
          )}
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => {
              setEditSourceForm({ name: source.name, description: source.description || '', website_url: source.website_url || '' })
              setShowEditSource(true)
            }}>
              <Edit3 className="w-3.5 h-3.5" /> Edit Source
            </Button>
          )}
          {isAdmin && records.length > 0 && (
            <Button variant="secondary" size="sm"
              className="!text-orange-600 !border-orange-200 hover:!bg-orange-50"
              onClick={async () => {
                if (!window.confirm(`Clear all ${records.length} records from "${source.name}"? This cannot be undone.`)) return
                try {
                  const r = await sourcesApi.clearRecords(sourceId!)
                  toast.success(r.message || 'Records cleared')
                  load()
                } catch (err: any) {
                  toast.error(err?.response?.data?.detail || 'Clear failed')
                }
              }}>
              <Trash2 className="w-3.5 h-3.5" /> Clear Records
            </Button>
          )}
          {isExtractor && source.website_url && source.status !== 'approved' && (
            <Button variant="secondary" size="sm" onClick={handleScrape} loading={scraping}>
              <Search className="w-3.5 h-3.5" />
              {scraping ? 'Scraping…' : 'Auto-Scrape Website'}
            </Button>
          )}
          {isReviewer && records.length > 0 && source.status !== 'not_started' && (
            <Button variant="secondary" size="sm" onClick={handleVerify} loading={verifying}
              className={verifyResult ? '!border-emerald-300 !text-emerald-700' : ''}>
              <Shield className="w-3.5 h-3.5" />
              {verifying ? 'Verifying…' : 'LLM Verify vs Website'}
            </Button>
          )}
          {canApproveSource && (
            <Button size="sm" onClick={handleApproveSource}
              style={{ background: '#10b981', border: 'none', color: '#fff' }}>
              <CheckCircle className="w-3.5 h-3.5" />
              {source.approved_records === source.total_records && source.total_records > 0
                ? 'Approve Source'
                : `Approve Source ${source.approved_records > 0 ? `(${source.approved_records}/${source.total_records} approved)` : ''}`}
            </Button>
          )}
          {source.status === 'approved' && isAdmin && (
            <Button size="sm" onClick={handleExport}>
              <Download className="w-3.5 h-3.5" /> Export Package
            </Button>
          )}
          {isAdmin && source.status !== 'approved' && (
            <Button variant="secondary" size="sm" onClick={() => setDeleteSourceConfirm(true)}
              className="!text-red-600 !border-red-200 hover:!bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setShowReset(true)}
              className="!text-orange-600 !border-orange-200 hover:!bg-orange-50">
              <RotateCcw className="w-3.5 h-3.5" /> Reset Source
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Records', value: source.total_records, icon: '📋', top: '#6366f1', bg: '#eef2ff', val: '#4338ca' },
          { label: 'Schema Valid', value: source.valid_records, icon: '✅', top: '#10b981', bg: '#ecfdf5', val: '#065f46' },
          { label: 'Needs Fixes', value: source.invalid_records, icon: '⚠️', top: '#f59e0b', bg: '#fffbeb', val: '#92400e' },
          { label: 'Approved', value: source.approved_records, icon: '🎯', top: '#3b82f6', bg: '#eff6ff', val: '#1d4ed8' },
        ].map(({ label, value, icon, top, bg, val }) => (
          <div key={label} style={{ background: bg, borderRadius: 14, borderTop: `3px solid ${top}`, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: val, lineHeight: 1 }}>{value}</span>
            </div>
            <p style={{ fontSize: 11, fontWeight: 600, color: val, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
            {source.total_records > 0 && (
              <div style={{ marginTop: 8, background: 'rgba(255,255,255,0.6)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                <div style={{ background: top, height: '100%', borderRadius: 99, width: `${Math.min(100, Math.round((value / source.total_records) * 100))}%`, transition: 'width 0.6s ease' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Team assignment row */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {[
          { role: 'Extractor', emoji: '⛏️', field: 'assigned_extractor_id' as const, name: source.assigned_extractor_name, id: source.assigned_extractor_id },
          { role: 'Reviewer', emoji: '🔍', field: 'assigned_reviewer_id' as const, name: source.assigned_reviewer_name, id: source.assigned_reviewer_id },
        ].map(({ role, emoji, field, name, id }) => (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{emoji}</div>
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
          <Clock className="w-3 h-3" />
          Updated {safeFromNow(source.updated_at)}
        </div>
      </div>

      {/* Tabs */}
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

          {/* ── Workflow next-step banner ── */}
          {source.status === 'approved' ? (
            <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={16} color="#059669" />
              <p style={{ fontSize: 13, color: '#065f46', margin: 0, flex: 1 }}>
                <strong>Source Approved</strong> — all records have been reviewed. Use <strong>Export Package</strong> to download.
              </p>
              <Button size="sm" onClick={handleExport} style={{ background: '#059669', border: 'none', color: '#fff', flexShrink: 0 }}>
                <Download className="w-3.5 h-3.5" /> Export Package
              </Button>
            </div>
          ) : records.length > 0 && (isReviewer || isAdmin) ? (
            <div style={{ background: allRecordsApproved ? '#ecfdf5' : '#fffbeb', border: `1px solid ${allRecordsApproved ? '#6ee7b7' : '#fcd34d'}`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: allRecordsApproved ? 10 : 8 }}>
                <Eye size={16} color={allRecordsApproved ? '#059669' : '#d97706'} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: allRecordsApproved ? '#065f46' : '#92400e', margin: 0 }}>
                    {allRecordsApproved
                      ? `All ${records.length} records approved — ready to approve source`
                      : `${pendingCount} record${pendingCount !== 1 ? 's' : ''} pending review · ${approvedCount} approved`}
                  </p>
                  <p style={{ fontSize: 12, color: allRecordsApproved ? '#059669' : '#b45309', margin: '3px 0 0' }}>
                    {allRecordsApproved
                      ? 'Click "Approve Source" to mark this source as complete and unlock export.'
                      : 'Click any record below to open the review panel. Use ✓ Approve or ✗ Send Back on each record.'}
                  </p>
                </div>
              </div>
              {allRecordsApproved && (
                <Button size="sm" onClick={handleApproveSource}
                  style={{ background: '#10b981', border: 'none', color: '#fff' }}>
                  <CheckCircle className="w-3.5 h-3.5" /> Approve Source & Unlock Export
                </Button>
              )}
            </div>
          ) : null}
          {showVerifyResult && verifyResult && (
            <div className={cn(
              'border rounded-xl p-4 flex items-start justify-between gap-4',
              verifyResult.flagged > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
            )}>
              <div className="flex items-start gap-3">
                <Shield className={cn('w-4 h-4 mt-0.5 shrink-0', verifyResult.flagged > 0 ? 'text-amber-600' : 'text-emerald-600')} />
                <div>
                  <p className={cn('text-sm font-semibold', verifyResult.flagged > 0 ? 'text-amber-800' : 'text-emerald-800')}>
                    LLM Website Verification Complete
                  </p>
                  <p className="text-xs mt-1 text-gray-600">{verifyResult.message}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-emerald-700 font-medium">✓ {verifyResult.verified} verified</span>
                    <span className="text-amber-600 font-medium">⚠ {verifyResult.flagged} flagged</span>
                    {verifyResult.truncated && <span className="text-gray-400">· Page was large, truncated to 80k chars</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setShowVerifyResult(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {['', 'valid', 'invalid'].map(v => (
              <button key={v} onClick={() => setValidityFilter(v)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  validityFilter === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                )}
              >
                {v === '' ? 'All' : v === 'valid' ? 'Schema-valid' : 'Needs fixes'}
              </button>
            ))}
            {schemaDefinition?.fields?.length > 0 && (
              <button
                onClick={() => setShowSchemaPanel(p => !p)}
                className={cn('ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  showSchemaPanel ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                )}
              >
                <Info className="w-3.5 h-3.5" /> Schema Reference
              </button>
            )}
          </div>

          <div className={cn('flex gap-4', showSchemaPanel ? 'items-start' : '')}>
            {/* Schema reference panel */}
            {showSchemaPanel && schemaDefinition && (
              <div className="w-72 shrink-0">
                <Card className="p-4 sticky top-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      {schemaDefinition.name || 'Schema'} Fields
                    </h4>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowSchemaJson(true)}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                        <Code className="w-3 h-3" /> Full JSON
                      </button>
                      <button onClick={() => setShowSchemaPanel(false)} className="text-gray-400 hover:text-gray-600">
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {schemaDefinition.extraction_instructions && (
                    <div className="mb-3 p-2 bg-brand-50 rounded-lg text-xs text-brand-700 leading-relaxed">
                      {schemaDefinition.extraction_instructions}
                    </div>
                  )}
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
                    {(schemaDefinition.fields || []).map((f: any) => (
                      <div key={f.name} className={cn(
                        'p-2.5 rounded-lg border text-xs',
                        'fixed_value' in f ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'
                      )}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-semibold text-gray-800">{f.name}</span>
                          <span className="text-gray-400">{f.type || 'string'}</span>
                          {f.required && <span className="text-red-500 font-medium">required</span>}
                          {'fixed_value' in f && <span className="text-blue-500">fixed: {String(f.fixed_value)}</span>}
                        </div>
                        {f.description && <p className="text-gray-500 mt-1 leading-relaxed">{f.description}</p>}
                        {f.enum?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {f.enum.map((v: string) => (
                              <span key={v} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs font-mono">{v}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Records table */}
            <div className="flex-1 min-w-0">

          {records.length === 0 ? (
            <EmptyState
              title="No records yet"
              description={isExtractor ? 'Upload a file or use Auto-Scrape Website to extract records.' : 'Waiting for the extractor to upload data.'}
              action={isExtractor ? (
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4" /> Upload File</Button>
                  {source.website_url && (
                    <Button variant="secondary" onClick={handleScrape} loading={scraping}>
                      <Search className="w-4 h-4" /> Auto-Scrape Website
                    </Button>
                  )}
                </div>
              ) : undefined}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Company','Sites','Products','Schema','Web Check','Review',''].map((h, i) => (
                        <th key={h+i} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
                          className={i > 0 && i < 5 && i !== 3 ? 'hidden md:table-cell' : ''}>
                          {h}
                        </th>
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
                          style={{
                            borderLeft: `3px solid ${r.review_status === 'approved' ? '#10b981' : r.review_status === 'rejected' ? '#ef4444' : r.is_schema_valid ? '#6366f1' : '#f59e0b'}`,
                            cursor: 'pointer', transition: 'background 0.1s',
                          }}
                          className="hover:bg-slate-50 transition"
                          onClick={() => setActiveRecordIndex(idx)}
                        >
                          <td className="px-5 py-3">
                            <p className="font-semibold text-gray-900 truncate max-w-[200px]">{primaryName}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {sector && <span className="text-xs text-gray-400">{sector}</span>}
                              {tier && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 rounded">tier {tier}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {sites > 0
                              ? <span className="text-sm font-medium text-gray-700">🏭 {sites} site{sites !== 1 ? 's' : ''}</span>
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {products > 0
                              ? <span className="text-sm font-medium text-gray-700">📦 {products} product{products !== 1 ? 's' : ''}</span>
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                          <td className="px-4 py-3">
                            {r.is_schema_valid ? (
                              <Badge variant="green"><CheckCircle className="w-3 h-3" /> Valid</Badge>
                            ) : (
                              <div>
                                <Badge variant="amber"><AlertCircle className="w-3 h-3" /> {r.validation_errors.length} error{r.validation_errors.length !== 1 ? 's' : ''}</Badge>
                                <div className="mt-1 space-y-0.5">
                                  {r.validation_errors.slice(0, 2).map((e: any, i: number) => (
                                    <p key={i} className="text-xs text-amber-600">{e.field}: {e.error}</p>
                                  ))}
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
                                {r.web_check_summary && (
                                  <p className="text-xs text-gray-500 mt-0.5 max-w-[160px] truncate">{r.web_check_summary}</p>
                                )}
                                {(r.web_check_flags || []).slice(0, 2).map((f: any, i: number) => (
                                  <p key={i} className="text-xs text-red-600 mt-0.5">
                                    <span className="font-mono">{f.field}</span>: {f.issue}
                                    {f.suggested_value && <span className="text-green-600"> → {f.suggested_value}</span>}
                                  </p>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <ReviewBadge status={r.review_status} />
                            {r.review_note && <p className="text-xs text-gray-400 mt-0.5 max-w-[160px] truncate">"{r.review_note}"</p>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                                background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                                whiteSpace: 'nowrap',
                              }}>Open →</span>
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
            </div>{/* end flex-1 records table */}
          </div>{/* end schema panel + records flex row */}
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
              { label: 'Extraction completed', value: source.extraction_completed_at ? format(new Date(source.extraction_completed_at), 'MMM d, HH:mm') : '—' },
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

      {/* Upload modal */}
      <Modal open={showUpload} onClose={() => !uploading && setShowUpload(false)} title="Upload Data" description="Upload extracted data to this source — individual files or a ZIP bundle.">
        <form onSubmit={handleUpload} className="space-y-4">
          {source.total_records > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Re-uploading replaces all {source.total_records} existing records in this source.
            </div>
          )}

          {/* File type legend */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { icon: '🗂️', label: 'ZIP of JSONs', desc: 'Bundle from extractor script — all files processed at once' },
              { icon: '📄', label: 'JSON / CSV / Excel', desc: 'Single structured file with multiple records' },
              { icon: '📋', label: 'PDF / TXT', desc: 'Raw document — AI extracts records automatically' },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-base leading-none mt-0.5">{icon}</span>
                <div>
                  <p className="font-medium text-gray-700">{label}</p>
                  <p className="text-gray-400 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 p-2.5 bg-brand-50 rounded-lg border border-brand-100">
              <span className="text-base leading-none mt-0.5">⚡</span>
              <div>
                <p className="font-medium text-brand-700">Auto-Scrape</p>
                <p className="text-brand-500 leading-relaxed mt-0.5">Use the scrape button to pull directly from the source URL</p>
              </div>
            </div>
          </div>

          {/* Drop zone */}
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
              accept=".csv,.xlsx,.xls,.json,.pdf,.txt,.zip"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
            {file ? (
              <div>
                <p className="text-sm font-semibold text-brand-700">{file.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                {file.name.toLowerCase().endsWith('.zip') && (
                  <p className="text-xs text-brand-600 mt-1.5 font-medium">ZIP detected — all JSON/CSV/Excel files inside will be processed</p>
                )}
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
              <p className="text-xs text-purple-700">
                <strong>AI extraction</strong> — Claude will read this document and extract records matching the schema. Takes 10–30 seconds.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</Button>
            <Button type="submit" loading={uploading} disabled={!file}>
              {uploading
                ? (file?.name.toLowerCase().endsWith('.zip') ? 'Processing ZIP…' : file && /\.(pdf|txt)$/i.test(file.name) ? 'AI extracting…' : 'Uploading…')
                : <><Upload className="w-4 h-4" /> Upload & Validate</>
              }
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit record modal */}
      <Modal open={!!editRecord} onClose={() => setEditRecord(null)} title="Fix Record" size="md">
        {editRecord && (
          <div className="space-y-4">
            {!editRecord.is_schema_valid && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                {editRecord.validation_errors.map((e: any, i: number) => (
                  <p key={i} className="text-xs text-amber-700"><strong>{e.field}:</strong> {e.error}</p>
                ))}
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

      <ConfirmDialog
        open={deleteSourceConfirm}
        title="Delete Source"
        description={`"${source.name}" and all its records will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete Source"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteSource}
        onCancel={() => setDeleteSourceConfirm(false)}
      />
      <ConfirmDialog
        open={!!deleteRecord}
        title="Delete Record"
        description="This record will be permanently deleted from the source."
        confirmLabel="Delete Record"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteRecord}
        onCancel={() => setDeleteRecord(null)}
      />

      {/* Edit Source modal */}
      <Modal open={showEditSource} onClose={() => setShowEditSource(false)} title="Edit Source" description="Update the source name, description, or website URL.">
        <div className="space-y-4">
          <Input label="Source Name" value={editSourceForm.name}
            onChange={e => setEditSourceForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="Website URL" value={editSourceForm.website_url} placeholder="https://www.company.com"
            onChange={e => setEditSourceForm(f => ({ ...f, website_url: e.target.value }))} />
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
            <textarea value={editSourceForm.description} rows={3}
              onChange={e => setEditSourceForm(f => ({ ...f, description: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Brief description of this source…" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowEditSource(false)}>Cancel</Button>
            <Button onClick={handleUpdateSource} disabled={!editSourceForm.name.trim()}>
              <Save className="w-4 h-4" /> Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Schema full JSON view modal */}
      <Modal open={showSchemaJson} onClose={() => setShowSchemaJson(false)} title={schemaDefinition?.name || 'Schema Definition'} size="lg">
        <div style={{ height: 500, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <textarea readOnly value={JSON.stringify(schemaDefinition, null, 2)}
            style={{ width: '100%', height: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 16, border: 'none', outline: 'none', resize: 'none', background: '#0f172a', color: '#e2e8f0', lineHeight: 1.6 }} />
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="secondary" size="sm" onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(schemaDefinition, null, 2))
            toast.success('Schema JSON copied to clipboard')
          }}>Copy JSON</Button>
        </div>
      </Modal>

      {/* Reset Source modal */}
      <Modal open={showReset} onClose={() => !resetting && setShowReset(false)} title="Reset Source" description="This will undo all extraction progress and allow the source to be re-extracted from scratch.">
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
            <p className="font-semibold mb-1">⚠ Admin Action — "{source?.name}"</p>
            <p>This resets the source status back to <strong>Not Started</strong>. Use this to recover from bad test data or incorrect extractions.</p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-gray-50 rounded-xl border border-gray-200">
            <input type="checkbox" checked={resetClearRecords} onChange={e => setResetClearRecords(e.target.checked)} className="w-4 h-4 text-orange-500" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Clear all records ({source?.total_records} records)</p>
              <p className="text-xs text-gray-500">Recommended — removes test/incorrect records so the extractor starts clean</p>
            </div>
          </label>
          {!resetClearRecords && (
            <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">Records will be kept but the status, review progress, and timestamps will be reset.</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowReset(false)} disabled={resetting}>Cancel</Button>
            <Button onClick={handleReset} loading={resetting} className="!bg-orange-500 hover:!bg-orange-600">
              <RotateCcw className="w-4 h-4" /> Reset{resetClearRecords ? ' & Clear Records' : ' Status Only'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Full-screen JSON Record Viewer */}

    </div>
  )
}

function ReviewBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'green'|'red'|'gray'|'amber'; label: string }> = {
    pending: { variant: 'gray', label: 'Pending' },
    approved: { variant: 'green', label: 'Approved' },
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
    try {
      await sourcesApi.update(source.id, { notes })
      toast.success('Notes saved')
      onSave()
    } catch {
      toast.error('Failed to save notes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit}
        placeholder="Any assumptions made during extraction, known data gaps, or context the next person should know…" />
      {canEdit && (
        <Button size="sm" onClick={save} loading={saving} disabled={notes === (source.notes ?? '')}>
          <Save className="w-3.5 h-3.5" /> Save Notes
        </Button>
      )}
    </div>
  )
}