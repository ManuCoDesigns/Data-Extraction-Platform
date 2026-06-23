import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { JsonRecordViewer } from './JsonRecordViewer'
import {
  ArrowLeft, Globe, Upload, Download, CheckCircle, XCircle,
  Edit3, ChevronRight, AlertCircle, Save, Users as UsersIcon,
  Clock, Brain, Trash2, Search, Sparkles, Shield, Info, ChevronDown
} from 'lucide-react'
import { sourcesApi, projectsApi, schemasApi, recordsApi } from '@/api/client'
import type { Source, SourceStatus, Project, Schema, User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, Textarea, EmptyState, Spinner, Avatar, ConfirmDialog, cn, toast } from '@/components/ui'
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
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [editRecord, setEditRecord] = useState<any | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteSourceConfirm, setDeleteSourceConfirm] = useState(false)
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
    Promise.all([
      projectsApi.get(projectId).then(setProject),
      sourcesApi.get(sourceId).then(setSource),
      sourcesApi.records(sourceId, { validity: validityFilter || undefined, page_size: 200 }).then((r: any) => setRecords(r.items)),
      projectsApi.listMembers(projectId).then((m: any) => setMembers(m.map((x: any) => ({ id: x.user_id, full_name: x.full_name, email: x.email })))),
      sourcesApi.schema(sourceId).then(setSchemaDefinition).catch(() => {}),
    ]).finally(() => setLoading(false))
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
      const method = summary.extraction_method === 'llm' ? 'AI extraction' : 'schema mapping'
      toast.success(`Done via ${method}: ${summary.valid_rows} valid, ${summary.invalid_rows} need fixes`)
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

  const handleDeleteRecord = async () => {
    if (!deleteRecord || !sourceId) return
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

  const meta = STATUS_META[source.status]
  const allApproved = records.length > 0 && records.every(r => r.review_status === 'approved')
  const canApproveSource = source.status !== 'approved' && allApproved && isReviewer

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
            <Button size="sm" onClick={handleApproveSource}>
              <CheckCircle className="w-3.5 h-3.5" /> Approve Source
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
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: source.total_records, color: 'text-gray-900' },
          { label: 'Valid', value: source.valid_records, color: 'text-emerald-700' },
          { label: 'Needs Fix', value: source.invalid_records, color: 'text-amber-600' },
          { label: 'Approved', value: source.approved_records, color: 'text-brand-700' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Team assignment row */}
      <Card className="p-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-medium">Extractor:</span>
            {isAdmin ? (
              <Select value={source.assigned_extractor_id ?? ''} onChange={e => handleAssign('assigned_extractor_id', e.target.value)} className="!py-1 !text-xs w-40">
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            ) : (
              <span className="text-sm font-medium text-gray-800">{source.assigned_extractor_name ?? 'Unassigned'}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-medium">Reviewer:</span>
            {isAdmin ? (
              <Select value={source.assigned_reviewer_id ?? ''} onChange={e => handleAssign('assigned_reviewer_id', e.target.value)} className="!py-1 !text-xs w-40">
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            ) : (
              <span className="text-sm font-medium text-gray-800">{source.assigned_reviewer_name ?? 'Unassigned'}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 ml-auto">
            <Clock className="w-3.5 h-3.5" />
            Updated {formatDistanceToNow(new Date(source.updated_at), { addSuffix: true })}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6">
        {(['records', 'details'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('pb-3 text-sm font-medium border-b-2 transition capitalize',
              tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
          >
            {t === 'records' ? `Records (${records.length})` : 'Details & Notes'}
          </button>
        ))}
      </div>

      {tab === 'records' && (
        <div className="space-y-4">
          {/* Verify result banner */}
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
                    <button onClick={() => setShowSchemaPanel(false)} className="text-gray-400 hover:text-gray-600">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
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
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-5 py-3 font-medium">Record</th>
                      <th className="text-left px-4 py-3 font-medium">Schema</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Web Check</th>
                      <th className="text-left px-4 py-3 font-medium">Review</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map((r, idx) => {
                      const primaryName = r.extracted_fields?.company_name || r.extracted_fields?.material_name || r.canonical_name || r.id.slice(0, 8)
                      const webFlagCount = (r.web_check_flags || []).length
                      return (
                        <tr key={r.id}
                          className="hover:bg-gray-50/60 transition cursor-pointer"
                          onClick={() => setActiveRecordIndex(idx)}
                        >
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-900 truncate max-w-[180px]">{primaryName}</p>
                            <p className="text-xs text-gray-400">{Object.keys(r.extracted_fields || {}).length} fields</p>
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
                              <span className="text-xs text-brand-600 font-medium">Open →</span>
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
              { label: 'Created', value: format(new Date(source.created_at), 'MMM d, yyyy HH:mm') },
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
      <Modal open={showUpload} onClose={() => !uploading && setShowUpload(false)} title="Upload Data" description="Upload extracted rows as CSV, Excel, or JSON — each row will be validated against this source's schema.">
        <form onSubmit={handleUpload} className="space-y-4">
          {source.total_records > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Re-uploading replaces all {source.total_records} existing records in this source.
            </div>
          )}
          <div
            onClick={() => !uploading && fileRef.current?.click()}
            className={cn('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition',
              file ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
              uploading && 'opacity-60 cursor-not-allowed')}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.pdf,.txt" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-brand-700">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 font-medium">Drop a file or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">CSV, XLSX, JSON — or PDF/TXT for automatic AI extraction</p>
              </div>
            )}
          </div>
          {file && /\.(pdf|txt)$/i.test(file.name) && (
            <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-xl p-3">
              <Brain className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <p className="text-xs text-purple-700">
                <strong>AI extraction</strong> — Claude will read this document and extract structured records matching the schema automatically. This takes 10–30 seconds.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</Button>
            <Button type="submit" loading={uploading} disabled={!file}>
              {uploading
                ? (file && /\.(pdf|txt)$/i.test(file.name) ? 'AI extracting…' : 'Uploading…')
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

      {/* Full-screen JSON Record Viewer */}
      {activeRecordIndex !== null && records[activeRecordIndex] && (
        <JsonRecordViewer
          record={records[activeRecordIndex]}
          allRecords={records}
          currentIndex={activeRecordIndex}
          schemaFields={schemaDefinition?.fields ?? []}
          extractionInstructions={schemaDefinition?.extraction_instructions}
          schemaName={schemaDefinition?.name}
          sourceWebsiteUrl={source.website_url}
          isExtractor={isExtractor}
          isReviewer={isReviewer}
          onFix={handleFixRecord}
          onReview={handleReviewRecord}
          onNavigate={setActiveRecordIndex}
          onClose={() => { setActiveRecordIndex(null); load() }}
        />
      )}
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
