/**
 * RecordReviewer — Clean data review panel for Xtrium DataOps
 * Full-page, purpose-built for reviewing extracted supplier records.
 * Replaces the VS Code JSON editor approach with a structured review UI.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { X, CheckCircle, XCircle, AlertTriangle, Globe, ChevronLeft, ChevronRight, Edit3, Save, ExternalLink, Code } from 'lucide-react'
import type { ExtractedRecord } from '@/types'
import { toast } from '@/components/ui'
import { JsonEditor } from './JsonEditor'

interface SchemaField {
  name: string; type?: string; required?: boolean
  description?: string; enum?: string[]; fixed_value?: unknown
}
interface Props {
  record: ExtractedRecord; allRecords: ExtractedRecord[]; currentIndex: number
  schemaFields: SchemaField[]; extractionInstructions?: string; schemaName?: string
  sourceWebsiteUrl?: string; extrasFields?: string[]; extrasSource?: string
  sourceId: string
  isExtractor: boolean; isReviewer: boolean
  onFix: (id: string, fields: Record<string, unknown>) => Promise<void>
  onReview: (id: string, action: 'approve' | 'reject', note?: string) => Promise<void>
  onNavigate: (index: number) => void; onClose: () => void
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const SITE_COLORS: Record<string, string> = {
  mine: '#3b82f6', quarry: '#6366f1', pit: '#8b5cf6',
  refinery: '#f59e0b', smelter: '#ef4444', 'processing plant': '#f97316',
  'exploration site': '#10b981', laboratory: '#a855f7', wharf: '#06b6d4',
  'handling site': '#64748b', 'recycling facility': '#84cc16',
}
const SITE_ICONS: Record<string, string> = {
  mine: '⛏️', quarry: '🪨', pit: '🕳️', refinery: '🏭', smelter: '🔥',
  'processing plant': '⚙️', 'exploration site': '🔍', laboratory: '🧪',
  wharf: '⚓', 'handling site': '📦', 'recycling facility': '♻️',
}
const TIER_COLORS = ['', '#3b82f6', '#f59e0b', '#64748b']
const TIER_LABELS = ['', 'Tier 1 — Extraction', 'Tier 2 — Processing', 'Tier 3 — Trading']

// ── Editable field ─────────────────────────────────────────────────────────────
function EditField({ label, value, field, onSave, required, isExtra }: {
  label: string; value: unknown; field: string
  onSave: (field: string, val: string) => void
  required?: boolean; isExtra?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const display = value === null || value === undefined || value === '' ? null : String(value)

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 180, flexShrink: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}
          {required && <span style={{ color: '#ef4444' }}>*</span>}
          {isExtra && <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 3, background: '#f3e8ff', color: '#7c3aed', border: '1px solid #e9d5ff' }}>extra</span>}
        </p>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onSave(field, draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
              style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1.5px solid #3b82f6', borderRadius: 6, outline: 'none', fontFamily: 'var(--font-mono)' }} />
            <button onClick={() => { onSave(field, draft); setEditing(false) }}
              style={{ padding: '4px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Save</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, cursor: 'text' }}
            onClick={() => { setDraft(String(value ?? '')); setEditing(true) }}>
            {display
              ? <span style={{ fontSize: 13, color: '#0f172a', wordBreak: 'break-word', lineHeight: 1.5 }}>{display}</span>
              : <span style={{ fontSize: 13, color: '#cbd5e1', fontStyle: 'italic' }}>—</span>
            }
            <Edit3 size={11} style={{ color: '#cbd5e1', flexShrink: 0, opacity: 0 }} className="edit-icon" />
          </div>
        )}
      </div>
    </div>
  )
}

export function JsonRecordViewer({
  record, allRecords, currentIndex, schemaFields, schemaName,
  sourceWebsiteUrl, extrasFields = [], extrasSource, sourceId,
  isExtractor, isReviewer, onFix, onReview, onNavigate, onClose,
}: Props) {
  const fields = record.extracted_fields || {}
  const errors = record.validation_errors || []
  const webFlags = record.web_check_flags || []

  const [viewTab, setViewTab] = useState<'review' | 'json'>('review')
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null)
  const [localFields, setLocalFields] = useState<Record<string, unknown>>(fields)
  const [hasChanges, setHasChanges] = useState(false)

  const handleSaveField = useCallback((field: string, val: string) => {
    setLocalFields(prev => ({ ...prev, [field]: val }))
    setHasChanges(true)
  }, [])

  const handleSaveAll = async () => {
    try {
      await onFix(record.id, localFields)
      setHasChanges(false)
      toast.success('Changes saved')
    } catch { toast.error('Save failed') }
  }

  const handleApprove = async () => {
    setSaving('approve')
    try { await onReview(record.id, 'approve'); onNavigate(Math.min(currentIndex + 1, allRecords.length - 1)) }
    catch { toast.error('Approve failed') }
    finally { setSaving(null) }
  }

  const handleReject = async () => {
    if (!rejectNote.trim()) { toast.error('Add a note explaining what needs to be fixed'); return }
    setSaving('reject')
    try { await onReview(record.id, 'reject', rejectNote); setShowReject(false); setRejectNote('') }
    catch { toast.error('Reject failed') }
    finally { setSaving(null) }
  }

  // Key scalar fields to show prominently
  const SCALAR_FIELDS = [
    { field: 'company_name', label: 'Company Name', required: true },
    { field: 'canonical_name', label: 'Canonical Name', required: true },
    { field: 'headquarters_location', label: 'Headquarters' },
    { field: 'website', label: 'Website' },
    { field: 'company_description', label: 'Description' },
    { field: 'industry_sector', label: 'Industry Sector', required: true },
    { field: 'type_description', label: 'Company Type' },
    { field: 'products_raw', label: 'Products (raw)' },
    { field: 'data_transparency_level', label: 'Transparency' },
  ]

  const sites = Array.isArray(localFields.manufacturing_sites) ? localFields.manufacturing_sites as any[] : []
  const products = Array.isArray(localFields.products_offered) ? localFields.products_offered as any[] : []
  const sources = Array.isArray(localFields.sources) ? localFields.sources as any[] : []
  const extras = Array.isArray(localFields.extras) ? localFields.extras as any[] : []
  const jvStakes = Array.isArray(localFields.jv_stakes) ? localFields.jv_stakes as any[] : []
  const annualProd = Array.isArray(localFields.annual_production) ? localFields.annual_production as any[] : []

  const tier = localFields.supply_chain_tier as number
  const isApproved = record.review_status === 'approved'
  const isRejected = record.review_status === 'rejected'

  const companyName = String(localFields.company_name || localFields.material_name || 'Record')
  const website = localFields.website as string | null

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, height: 56, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => onNavigate(currentIndex - 1)} disabled={currentIndex === 0}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', opacity: currentIndex === 0 ? 0.4 : 1 }}>
            <ChevronLeft size={14} color="#64748b" />
          </button>
          <span style={{ fontSize: 12, color: '#64748b', padding: '0 4px', minWidth: 60, textAlign: 'center' }}>{currentIndex + 1} / {allRecords.length}</span>
          <button onClick={() => onNavigate(currentIndex + 1)} disabled={currentIndex === allRecords.length - 1}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: currentIndex === allRecords.length - 1 ? 'not-allowed' : 'pointer', opacity: currentIndex === allRecords.length - 1 ? 0.4 : 1 }}>
            <ChevronRight size={14} color="#64748b" />
          </button>
        </div>

        {/* Company name + status */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{companyName}</h2>
          {tier && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: `${TIER_COLORS[tier]}18`, color: TIER_COLORS[tier], border: `1px solid ${TIER_COLORS[tier]}40`, flexShrink: 0 }}>
              {TIER_LABELS[tier]}
            </span>
          )}
          {isApproved && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', flexShrink: 0 }}>✓ Approved</span>}
          {isRejected && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', flexShrink: 0 }}>✗ Sent back</span>}
          {errors.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d', flexShrink: 0 }}>⚠ {errors.length} schema error{errors.length > 1 ? 's' : ''}</span>}
          {webFlags.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', flexShrink: 0 }}>🌐 {webFlags.length} web flag{webFlags.length > 1 ? 's' : ''}</span>}
          {website && <a href={website} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#3b82f6', textDecoration: 'none', flexShrink: 0 }}><Globe size={12} />{new URL(website).hostname}</a>}
        </div>

          {/* View tabs */}
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', flexShrink: 0 }}>
            {[{ id: 'review', label: 'Review' }, { id: 'json', label: '{ } JSON Editor' }].map(t => (
              <button key={t.id} onClick={() => setViewTab(t.id as 'review' | 'json')} style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: viewTab === t.id ? '#fff' : 'transparent',
                color: viewTab === t.id ? '#1d4ed8' : '#64748b',
                boxShadow: viewTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {hasChanges && viewTab === 'review' && (
            <button onClick={handleSaveAll} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#fff', border: '1.5px solid #3b82f6', borderRadius: 8, color: '#3b82f6', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <Save size={13} /> Save changes
            </button>
          )}
          {isReviewer && !isApproved && (
            <>
              <button onClick={() => setShowReject(r => !r)}
                style={{ padding: '7px 14px', background: showReject ? '#fef2f2' : '#fff', border: `1.5px solid ${showReject ? '#ef4444' : '#e2e8f0'}`, borderRadius: 8, color: showReject ? '#dc2626' : '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {saving === 'reject' ? 'Sending…' : '✗ Send Back'}
              </button>
              <button onClick={handleApprove} disabled={saving === 'approve'}
                style={{ padding: '7px 16px', background: saving === 'approve' ? '#d1fae5' : '#10b981', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving === 'approve' ? 0.7 : 1 }}>
                {saving === 'approve' ? 'Approving…' : '✓ Approve'}
              </button>
            </>
          )}
          <button onClick={onClose} style={{ padding: '7px', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <X size={16} color="#64748b" />
          </button>
        </div>
      </div>

      {/* Reject note input */}
      {showReject && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fca5a5', padding: '12px 24px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
            placeholder="What needs to be fixed? (required)"
            style={{ flex: 1, padding: '8px 12px', border: '1.5px solid #fca5a5', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
            onKeyDown={e => e.key === 'Enter' && handleReject()} />
          <button onClick={handleReject} style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {saving === 'reject' ? 'Sending…' : 'Send Back'}
          </button>
          <button onClick={() => setShowReject(false)} style={{ padding: '8px', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} color="#ef4444" /></button>
        </div>
      )}

      {/* ── JSON EDITOR TAB ─────────────────────────────────────────────── */}
      {viewTab === 'json' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <JsonEditor
            record={record}
            sourceId={sourceId}
            canEdit={isExtractor}
            onSave={async (fields) => { await onFix(record.id, fields); }}
          />
        </div>
      )}

      {/* ── MAIN BODY ───────────────────────────────────────────────────── */}
      {viewTab === 'review' && <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignContent: 'start' }}>

        {/* ── LEFT COLUMN ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Validation errors */}
          {(errors.length > 0 || webFlags.length > 0) && (
            <div style={{ background: '#fff', border: '1px solid #fee2e2', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Issues to fix</p>
              {errors.map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}><strong>{e.field}</strong>: {e.error}</p>
                </div>
              ))}
              {webFlags.map((f: any, i: number) => (
                <div key={`w${i}`} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <Globe size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>
                    <strong>{f.field}</strong>: {f.issue}
                    {f.suggested_value && <span style={{ color: '#059669' }}> → {f.suggested_value}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Core Fields */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
            onMouseEnter={e => e.currentTarget.querySelectorAll<HTMLElement>('.edit-icon').forEach(el => el.style.opacity = '1')}
            onMouseLeave={e => e.currentTarget.querySelectorAll<HTMLElement>('.edit-icon').forEach(el => el.style.opacity = '0')}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Core Information</p>
            {SCALAR_FIELDS.map(({ field, label, required }) => {
              const isExtra = extrasFields.includes(field)
              if (localFields[field] === undefined && !isExtra) return null
              return (
                <EditField key={field} field={field} label={label}
                  value={localFields[field]} required={required} isExtra={isExtra}
                  onSave={handleSaveField} />
              )
            })}
          </div>

          {/* Any remaining scalar fields not in SCALAR_FIELDS */}
          {(() => {
            const shownFields = new Set([...SCALAR_FIELDS.map(f => f.field),
              'supplier_id','duns_number','typical_lead_time_days','is_verified','canonical_name',
              'manufacturing_sites','products_offered','sources','extras','jv_stakes','annual_production',
              'data_completeness_flags','certification_references','regulation_references','certifications_raw',
              'supply_chain_tier','industry_sector'])
            const others = Object.keys(localFields).filter(k => !shownFields.has(k) && typeof localFields[k] !== 'object')
            if (!others.length) return null
            return (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
                onMouseEnter={e => e.currentTarget.querySelectorAll<HTMLElement>('.edit-icon').forEach(el => el.style.opacity = '1')}
                onMouseLeave={e => e.currentTarget.querySelectorAll<HTMLElement>('.edit-icon').forEach(el => el.style.opacity = '0')}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Additional Fields</p>
                {others.map(field => (
                  <EditField key={field} field={field} label={field.replace(/_/g,' ')}
                    value={localFields[field]} isExtra={extrasFields.includes(field)}
                    onSave={handleSaveField} />
                ))}
              </div>
            )
          })()}

          {/* Extras */}
          {extras.length > 0 && extras[0] && Object.keys(extras[0]).length > 0 && (
            <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 14, padding: '16px 20px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                Extras {extrasSource ? `· ${extrasSource}` : ''}
              </p>
              {Object.entries(extras[0]).map(([k, v]) => v != null && (
                <div key={k} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #ede9fe' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', minWidth: 160, flexShrink: 0, fontFamily: 'var(--font-mono)', textTransform: 'none' }}>{k}</span>
                  <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Manufacturing Sites */}
          {sites.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                🏭 Manufacturing Sites <span style={{ background: '#3b82f6', color: '#fff', borderRadius: 20, padding: '0 7px', fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{sites.length}</span>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sites.map((s: any, i: number) => {
                  const color = SITE_COLORS[s.site_type] || '#94a3b8'
                  const siteData = typeof s === 'string'
                    ? { location: s, country: null, site_type: 'mine', raw: null }
                    : s
                  return (
                    <div key={i} style={{ borderLeft: `4px solid ${color}`, borderRadius: '0 10px 10px 0', background: '#f8fafc', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{SITE_ICONS[siteData.site_type] || '📍'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 4px', lineHeight: 1.3 }}>{siteData.location}</p>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {siteData.country && <span style={{ fontSize: 11, color: '#64748b' }}>📌 {siteData.country}</span>}
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 20, background: `${color}18`, color, border: `1px solid ${color}40` }}>{siteData.site_type || 'site'}</span>
                          </div>
                        </div>
                      </div>
                      {siteData.raw && (
                        <div style={{ padding: '0 14px 10px', borderTop: `1px solid ${color}20` }}>
                          <p style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, margin: '8px 0 0', fontFamily: 'var(--font-mono)', background: '#fff', padding: '8px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>{siteData.raw}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Products */}
          {products.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                📦 Products Offered <span style={{ background: '#10b981', color: '#fff', borderRadius: 20, padding: '0 7px', fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{products.length}</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 8 }}>
                {products.map((p: any, i: number) => {
                  const pd = typeof p === 'string' ? { product_name: p, grade: null, category: null, source_url: null } : p
                  return (
                    <div key={i} style={{ background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0', borderTop: '3px solid #10b981', padding: '10px 12px' }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>{pd.product_name}</p>
                      {pd.grade && <p style={{ fontSize: 11, color: '#059669', fontStyle: 'italic', margin: '0 0 6px' }}>{pd.grade}</p>}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {pd.category && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: '#fef9c3', color: '#854d0e', border: '1px solid #fef08a' }}>{pd.category}</span>}
                        {pd.product_id && <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>{pd.product_id}</span>}
                      </div>
                      {pd.source_url && (
                        <a href={pd.source_url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 10, color: '#3b82f6', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <ExternalLink size={9} /> {pd.source_url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* JV Stakes */}
          {jvStakes.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>🤝 JV Stakes</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {jvStakes.map((j: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff', borderLeft: '4px solid #7c3aed' }}>
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <p style={{ fontSize: 20, fontWeight: 800, color: '#6d28d9', margin: 0, lineHeight: 1 }}>{j.ownership_pct}%</p>
                      <p style={{ fontSize: 9, color: '#7c3aed', margin: 0 }}>ownership</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>{j.site_name}</p>
                      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 2px' }}>{j.country} · {j.commodity}</p>
                      {j.jv_partners?.length > 0 && <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>Partners: {j.jv_partners.join(', ')}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Annual Production */}
          {annualProd.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, padding: '14px 20px', background: '#fffbeb', borderBottom: '1px solid #fef3c7' }}>📊 Annual Production</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#fffbeb' }}>
                  {['Commodity','Volume','Unit','Year','Notes'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 16px', fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {annualProd.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #fef9c3', background: i % 2 === 0 ? '#fff' : '#fefce8' }}>
                      <td style={{ padding: '8px 16px', fontWeight: 700, color: '#0f172a' }}>{r.commodity}</td>
                      <td style={{ padding: '8px 16px', color: '#059669', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.volume}</td>
                      <td style={{ padding: '8px 16px', color: '#64748b' }}>{r.unit}</td>
                      <td style={{ padding: '8px 16px', color: '#64748b' }}>{r.year}</td>
                      <td style={{ padding: '8px 16px', color: '#94a3b8', fontSize: 11 }}>{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>📚 Sources</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sources.map((s: any, i: number) => {
                  if (typeof s === 'string') return (
                    <a key={i} href={s} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', padding: '8px 12px', background: '#eff6ff', borderRadius: 8, display: 'block', border: '1px solid #bfdbfe', borderLeft: '4px solid #3b82f6' }}>🔗 {s}</a>
                  )
                  const tC = s.tier === 'tier1' ? { bg: '#ecfdf5', text: '#065f46', b: '#6ee7b7', label: 'Official' }
                           : s.tier === 'tier2' ? { bg: '#eff6ff', text: '#1e40af', b: '#93c5fd', label: 'Company' }
                           : { bg: '#f8fafc', text: '#475569', b: '#cbd5e1', label: 'Web' }
                  return (
                    <div key={i} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', borderLeft: '4px solid #0ea5e9' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: tC.bg, color: tC.text, border: `1px solid ${tC.b}`, flexShrink: 0, marginTop: 1 }}>{tC.label}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {s.source_name && <p style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', margin: '0 0 3px' }}>{s.source_name}</p>}
                          {s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0ea5e9', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.source_url}</a>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>}
    </div>
  )
}
