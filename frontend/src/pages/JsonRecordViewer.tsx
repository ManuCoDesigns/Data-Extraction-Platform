/**
 * JsonRecordViewer — VS Code-style JSON viewer embedded in the review workflow.
 *
 * Opens as a full-page overlay when a reviewer clicks any record.
 * Shows extracted fields as syntax-highlighted JSON with:
 *   - Red highlight on fields failing schema validation
 *   - Amber highlight on fields flagged by LLM web-check
 *   - Green border on verified fields
 *   - Inline editing — click any value to fix it, press Enter to re-validate
 *   - Schema reference panel on the right
 *   - One-click approve / send back at the bottom
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, CheckCircle, XCircle, AlertTriangle, Edit3, Save,
  ArrowLeft, Globe, Shield, Info, ChevronDown, ChevronRight, Copy, Check
} from 'lucide-react'
import type { ExtractedRecord } from '@/types'
import { cn, toast } from '@/components/ui'

interface SchemaField {
  name: string
  type?: string
  required?: boolean
  description?: string
  enum?: string[]
  fixed_value?: unknown
}

interface JsonRecordViewerProps {
  record: ExtractedRecord
  allRecords: ExtractedRecord[]
  currentIndex: number
  schemaFields: SchemaField[]
  extractionInstructions?: string
  schemaName?: string
  sourceWebsiteUrl?: string
  isExtractor: boolean
  isReviewer: boolean
  onFix: (recordId: string, fields: Record<string, unknown>) => Promise<void>
  onReview: (recordId: string, action: 'approve' | 'reject', note?: string) => Promise<void>
  onNavigate: (index: number) => void
  onClose: () => void
}

// ── VS Code colour palette ────────────────────────────────────────────────────
const C = {
  key:    '#569cd6',
  str:    '#6a9955',
  num:    '#b5cea8',
  bool:   '#569cd6',
  null:   '#808080',
  brace:  'var(--color-text-secondary)',
  punct:  'var(--color-text-tertiary)',
}

function JsonToken({ type, value }: { type: keyof typeof C; value: string }) {
  return <span style={{ color: C[type] }}>{value}</span>
}

function renderValueInline(v: unknown): JSX.Element {
  if (v === null)      return <JsonToken type="null"  value="null" />
  if (typeof v === 'boolean') return <JsonToken type="bool"  value={String(v)} />
  if (typeof v === 'number')  return <JsonToken type="num"   value={String(v)} />
  if (typeof v === 'string')  return <JsonToken type="str"   value={JSON.stringify(v)} />
  if (Array.isArray(v)) {
    if (v.length === 0) return <><JsonToken type="brace" value="[" /><JsonToken type="brace" value="]" /></>
    return <JsonToken type="brace" value={`[…${v.length}]`} />
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
    return <JsonToken type="brace" value={`{…${keys.length} keys}`} />
  }
  return <span>{String(v)}</span>
}

// ── Individual field row ──────────────────────────────────────────────────────
function FieldRow({
  fieldKey, value, lineNum, schemaField,
  validationError, webFlag, isEditing,
  onStartEdit, onSaveEdit, canEdit, isFixed,
}: {
  fieldKey: string
  value: unknown
  lineNum: number
  schemaField?: SchemaField
  validationError?: { field: string; error: string }
  webFlag?: { field: string; issue: string; suggested_value?: string; confidence?: number }
  isEditing: boolean
  onStartEdit: () => void
  onSaveEdit: (newVal: unknown) => void
  canEdit: boolean
  isFixed: boolean
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      const raw = value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value)
      setDraft(raw)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isEditing, value])

  const commit = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch {
      // treat as string if can't parse
      parsed = draft
    }
    onSaveEdit(parsed)
  }

  const hasProblem = !!validationError || !!webFlag
  const isWebFlagged = !!webFlag && !validationError

  const rowBg = validationError
    ? 'rgba(239,68,68,0.06)'
    : webFlag
    ? 'rgba(245,158,11,0.06)'
    : 'transparent'

  const borderLeft = validationError
    ? '2px solid #ef4444'
    : webFlag
    ? '2px solid #f59e0b'
    : isFixed
    ? '2px solid #10b981'
    : '2px solid transparent'

  return (
    <div style={{ background: rowBg, borderLeft, paddingLeft: 8, marginLeft: -10, transition: 'background 0.15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
        <span style={{ color: C.punct, minWidth: 28, textAlign: 'right', fontSize: 11, userSelect: 'none', flexShrink: 0 }}>
          {lineNum}
        </span>
        <span style={{ paddingLeft: 16, display: 'flex', alignItems: 'center', gap: 0, flex: 1, minWidth: 0 }}>
          <span style={{ color: C.key }}>&quot;{fieldKey}&quot;</span>
          <span style={{ color: C.brace }}>: </span>
          {isEditing ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onSaveEdit(value) }}
                style={{
                  flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5,
                  border: '1px solid #569cd6', borderRadius: 4, padding: '1px 6px',
                  background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)',
                  outline: 'none', minWidth: 80,
                }}
              />
              <button onClick={commit} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #10b981', background: 'rgba(16,185,129,0.1)', color: '#059669', cursor: 'pointer', flexShrink: 0 }}>
                save
              </button>
              <button onClick={() => onSaveEdit(value)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}>
                ✕
              </button>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              {renderValueInline(value)}
              <span style={{ color: C.punct }}>,</span>
              {canEdit && !isFixed && (
                <button
                  onClick={onStartEdit}
                  style={{ opacity: 0, marginLeft: 'auto', fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}
                  className="edit-btn"
                >
                  edit
                </button>
              )}
            </span>
          )}
        </span>
      </div>

      {/* Error / flag callouts */}
      {validationError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, paddingLeft: 60, paddingBottom: 4 }}>
          <AlertTriangle size={11} color="#ef4444" style={{ marginTop: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#ef4444', lineHeight: 1.5 }}>{validationError.error}</span>
        </div>
      )}
      {webFlag && (
        <div style={{ paddingLeft: 60, paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <Shield size={11} color="#f59e0b" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#b45309', lineHeight: 1.5 }}>{webFlag.issue}</span>
          </div>
          {webFlag.suggested_value && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', paddingLeft: 17 }}>website says →</span>
              <span style={{ fontSize: 11, color: '#059669', fontFamily: 'var(--font-mono)' }}>&quot;{webFlag.suggested_value}&quot;</span>
              {canEdit && (
                <button
                  onClick={() => onSaveEdit(webFlag.suggested_value)}
                  style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid #10b981', background: 'rgba(16,185,129,0.1)', color: '#059669', cursor: 'pointer' }}
                >
                  use this
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main viewer ───────────────────────────────────────────────────────────────
export function JsonRecordViewer({
  record, allRecords, currentIndex, schemaFields,
  extractionInstructions, schemaName, sourceWebsiteUrl,
  isExtractor, isReviewer,
  onFix, onReview, onNavigate, onClose,
}: JsonRecordViewerProps) {
  const [fields, setFields] = useState<Record<string, unknown>>({ ...record.extracted_fields })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [showSchemaPanel, setShowSchemaPanel] = useState(true)
  const [copiedJSON, setCopiedJSON] = useState(false)
  const [activeSchemaField, setActiveSchemaField] = useState<string | null>(null)

  // Reset when record changes
  useEffect(() => {
    setFields({ ...record.extracted_fields })
    setPendingChanges({})
    setEditingKey(null)
    setShowRejectInput(false)
    setRejectNote('')
  }, [record.id])

  const validationMap = Object.fromEntries(
    (record.validation_errors || []).map(e => [e.field, e])
  )
  const webFlagMap = Object.fromEntries(
    (record.web_check_flags || []).map(f => [f.field, f])
  )

  const fieldKeys = Object.keys(fields)
  const errorCount = (record.validation_errors || []).length
  const webFlagCount = (record.web_check_flags || []).length
  const hasChanges = Object.keys(pendingChanges).length > 0

  const handleFieldSave = (key: string, newVal: unknown) => {
    const current = fields[key]
    setEditingKey(null)
    if (newVal === current) return
    setFields(f => ({ ...f, [key]: newVal }))
    setPendingChanges(p => ({ ...p, [key]: newVal }))
  }

  const handleSaveAll = async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      await onFix(record.id, fields)
      setPendingChanges({})
      toast.success('Record saved and re-validated')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  const handleApprove = async () => {
    setApproving(true)
    try {
      if (hasChanges) await onFix(record.id, fields)
      await onReview(record.id, 'approve')
      if (currentIndex < allRecords.length - 1) onNavigate(currentIndex + 1)
      else onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Approve failed')
    } finally { setApproving(false) }
  }

  const handleReject = async () => {
    setRejecting(true)
    try {
      await onReview(record.id, 'reject', rejectNote || undefined)
      setShowRejectInput(false)
      setRejectNote('')
      if (currentIndex < allRecords.length - 1) onNavigate(currentIndex + 1)
      else onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Reject failed')
    } finally { setRejecting(false) }
  }

  const copyJSON = () => {
    navigator.clipboard.writeText(JSON.stringify(fields, null, 2))
    setCopiedJSON(true)
    setTimeout(() => setCopiedJSON(false), 2000)
  }

  const primaryName = String(
    fields.company_name || fields.material_name || fields.operator_name ||
    record.canonical_name || `Record ${currentIndex + 1}`
  )

  const statusColor = ({
    approved:    { bg: '#ecfdf5', text: '#059669', border: '#6ee7b7' },
    rejected:    { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },
    pending:     { bg: '#f0f9ff', text: '#0284c7', border: '#7dd3fc' },
    quarantined: { bg: '#fff7ed', text: '#ea580c', border: '#fdba74' },
    escalated:   { bg: '#faf5ff', text: '#7c3aed', border: '#c4b5fd' },
    skipped:     { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
  } as Record<string, { bg: string; text: string; border: string }>)[record.review_status]
    ?? { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--color-background-tertiary)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--color-background-primary)', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 13 }}>
          <ArrowLeft size={14} /> Back
        </button>

        <div style={{ width: '0.5px', height: 20, background: 'var(--color-border-tertiary)' }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }} className="truncate">{primaryName}</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: statusColor.bg, color: statusColor.text, border: `1px solid ${statusColor.border}`, flexShrink: 0 }}>
              {record.review_status}
            </span>
            {errorCount > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', flexShrink: 0 }}>
                ✗ {errorCount} schema error{errorCount !== 1 ? 's' : ''}
              </span>
            )}
            {webFlagCount > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fff7ed', color: '#b45309', border: '1px solid #fcd34d', flexShrink: 0 }}>
                ⚠ {webFlagCount} web flag{webFlagCount !== 1 ? 's' : ''}
              </span>
            )}
            {record.web_verified && webFlagCount === 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', flexShrink: 0 }}>
                ✓ website verified
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-sans)' }}>
            {currentIndex + 1} / {allRecords.length}
          </span>
          <button
            disabled={currentIndex === 0}
            onClick={() => onNavigate(currentIndex - 1)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', opacity: currentIndex === 0 ? 0.4 : 1, fontSize: 12, color: 'var(--color-text-primary)' }}
          >← prev</button>
          <button
            disabled={currentIndex === allRecords.length - 1}
            onClick={() => onNavigate(currentIndex + 1)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', cursor: currentIndex === allRecords.length - 1 ? 'not-allowed' : 'pointer', opacity: currentIndex === allRecords.length - 1 ? 0.4 : 1, fontSize: 12, color: 'var(--color-text-primary)' }}
          >next →</button>
        </div>

        <button onClick={onClose} style={{ padding: 6, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: showSchemaPanel ? '1fr 300px' : '1fr', overflow: 'hidden' }}>

        {/* JSON panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
          {/* JSON toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#1e1e2e', borderBottom: '0.5px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#808080', fontFamily: 'var(--font-mono)' }}>extracted_record.json</span>
            <div style={{ flex: 1 }} />
            {hasChanges && (
              <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 8px', borderRadius: 4, border: '1px solid rgba(245,158,11,0.3)' }}>
                ● unsaved changes
              </span>
            )}
            <button onClick={copyJSON} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#cccccc', cursor: 'pointer' }}>
              {copiedJSON ? <Check size={11} color="#6a9955" /> : <Copy size={11} />}
              {copiedJSON ? 'copied' : 'copy JSON'}
            </button>
            <button onClick={() => setShowSchemaPanel(p => !p)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: showSchemaPanel ? 'rgba(86,156,214,0.15)' : 'rgba(255,255,255,0.06)', color: showSchemaPanel ? '#569cd6' : '#cccccc', cursor: 'pointer' }}>
              schema ref
            </button>
          </div>

          {/* JSON body */}
          <div style={{ flex: 1, overflow: 'auto', background: '#1e1e2e', padding: '16px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.8 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).querySelectorAll('.edit-btn').forEach((b: any) => { b.style.opacity = '1' }) }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).querySelectorAll('.edit-btn').forEach((b: any) => { b.style.opacity = '0' }) }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: '#808080', minWidth: 28, textAlign: 'right', fontSize: 11, userSelect: 'none', paddingRight: 12 }}>1</span>
              <span style={{ color: C.brace }}>{'{'}</span>
            </div>

            {fieldKeys.map((key, i) => {
              const isFixed = schemaFields.find(f => f.name === key && 'fixed_value' in f) !== undefined
              return (
                <FieldRow
                  key={key}
                  fieldKey={key}
                  value={fields[key]}
                  lineNum={i + 2}
                  schemaField={schemaFields.find(f => f.name === key)}
                  validationError={validationMap[key]}
                  webFlag={webFlagMap[key]}
                  isEditing={editingKey === key}
                  onStartEdit={() => { setEditingKey(key); setActiveSchemaField(key) }}
                  onSaveEdit={(v) => handleFieldSave(key, v)}
                  canEdit={isExtractor || isReviewer}
                  isFixed={isFixed}
                />
              )
            })}

            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: '#808080', minWidth: 28, textAlign: 'right', fontSize: 11, userSelect: 'none', paddingRight: 12 }}>{fieldKeys.length + 2}</span>
              <span style={{ color: C.brace }}>{'}'}</span>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 16px', background: '#1e1e2e', borderTop: '0.5px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
            {[
              { color: '#ef4444', label: 'schema error' },
              { color: '#f59e0b', label: 'web flag' },
              { color: '#10b981', label: 'fixed / verified' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.7 }} />
                <span style={{ fontSize: 10, color: '#808080' }}>{label}</span>
              </div>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#808080' }}>{fieldKeys.length} fields</span>
          </div>
        </div>

        {/* Schema reference panel */}
        {showSchemaPanel && (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-background-secondary)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {schemaName || 'Schema Reference'}
              </p>
              {sourceWebsiteUrl && (
                <a href={sourceWebsiteUrl} target="_blank" rel="noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4, textDecoration: 'none' }}>
                  <Globe size={10} />
                  <span className="truncate" style={{ maxWidth: 200 }}>{sourceWebsiteUrl.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
            </div>

            {extractionInstructions && (
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', background: '#eff6ff', flexShrink: 0 }}>
                <p style={{ fontSize: 10, color: '#1d4ed8', lineHeight: 1.6 }}>{extractionInstructions}</p>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              {schemaFields.map(f => {
                const hasError = !!validationMap[f.name]
                const hasFlag = !!webFlagMap[f.name]
                const isActive = activeSchemaField === f.name
                const isFixed = 'fixed_value' in f

                return (
                  <div
                    key={f.name}
                    onClick={() => setActiveSchemaField(f.name === activeSchemaField ? null : f.name)}
                    style={{
                      padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer', transition: 'background 0.1s',
                      background: isActive ? 'var(--color-background-primary)' : 'transparent',
                      border: `0.5px solid ${hasError ? '#fca5a5' : hasFlag ? '#fcd34d' : isActive ? 'var(--color-border-secondary)' : 'transparent'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#569cd6', fontWeight: 500 }}>{f.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{f.type || 'string'}</span>
                      {f.required && <span style={{ fontSize: 9, color: '#dc2626', background: '#fef2f2', padding: '1px 5px', borderRadius: 4, border: '1px solid #fca5a5' }}>required</span>}
                      {isFixed && <span style={{ fontSize: 9, color: '#7c3aed', background: '#f5f3ff', padding: '1px 5px', borderRadius: 4, border: '1px solid #c4b5fd' }}>fixed</span>}
                      {hasError && <AlertTriangle size={10} color="#dc2626" style={{ marginLeft: 'auto' }} />}
                      {hasFlag && !hasError && <Shield size={10} color="#b45309" style={{ marginLeft: 'auto' }} />}
                    </div>
                    {isActive && f.description && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5 }}>{f.description}</p>
                    )}
                    {isActive && f.enum && f.enum.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', width: '100%', marginBottom: 2 }}>Allowed values:</span>
                        {f.enum.map(v => (
                          <span key={v} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-secondary)', padding: '1px 6px', borderRadius: 4, color: '#6a9955', cursor: isActive ? 'pointer' : 'default' }}
                            onClick={e => { e.stopPropagation(); if (isExtractor || isReviewer) handleFieldSave(f.name, v) }}
                          >{v}</span>
                        ))}
                      </div>
                    )}
                    {isActive && isFixed && (
                      <p style={{ fontSize: 10, color: '#7c3aed', marginTop: 4 }}>Always: {JSON.stringify((f as any).fixed_value)}</p>
                    )}
                    {hasError && validationMap[f.name] && (
                      <p style={{ fontSize: 10, color: '#dc2626', marginTop: 4, lineHeight: 1.5 }}>✗ {validationMap[f.name].error}</p>
                    )}
                    {hasFlag && webFlagMap[f.name] && (
                      <p style={{ fontSize: 10, color: '#b45309', marginTop: 4, lineHeight: 1.5 }}>⚠ {webFlagMap[f.name].issue}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Action bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--color-background-primary)', borderTop: '0.5px solid var(--color-border-tertiary)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Left: error summary */}
        <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {errorCount > 0 && (
            <span style={{ fontSize: 12, color: '#dc2626', fontFamily: 'var(--font-sans)' }}>
              {errorCount} schema error{errorCount !== 1 ? 's' : ''} — fix before approving
            </span>
          )}
          {webFlagCount > 0 && (
            <span style={{ fontSize: 12, color: '#b45309', fontFamily: 'var(--font-sans)' }}>
              {webFlagCount} web flag{webFlagCount !== 1 ? 's' : ''} need review
            </span>
          )}
          {errorCount === 0 && webFlagCount === 0 && (
            <span style={{ fontSize: 12, color: '#059669', fontFamily: 'var(--font-sans)' }}>✓ no errors detected</span>
          )}
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {hasChanges && (isExtractor || isReviewer) && (
            <button
              onClick={handleSaveAll} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: '1px solid #d97706', background: 'rgba(217,119,6,0.08)', color: '#b45309', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' }}
            >
              <Save size={13} />{saving ? 'Saving…' : 'Save changes'}
            </button>
          )}

          {isReviewer && record.review_status !== 'approved' && (
            <>
              {showRejectInput ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    placeholder="Reason for sending back (optional)"
                    onKeyDown={e => { if (e.key === 'Enter') handleReject(); if (e.key === 'Escape') setShowRejectInput(false) }}
                    autoFocus
                    style={{ fontFamily: 'var(--font-sans)', fontSize: 12, border: '1px solid var(--color-border-secondary)', borderRadius: 8, padding: '5px 10px', outline: 'none', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', width: 220 }}
                  />
                  <button
                    onClick={handleReject} disabled={rejecting}
                    style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: rejecting ? 'not-allowed' : 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)' }}
                  >
                    {rejecting ? 'Sending…' : 'Send back'}
                  </button>
                  <button onClick={() => setShowRejectInput(false)} style={{ padding: '5px 8px', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)' }}>Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowRejectInput(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' }}
                >
                  <XCircle size={13} /> Send back
                </button>
              )}

              <button
                onClick={handleApprove}
                disabled={approving || errorCount > 0}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 18px', borderRadius: 8, border: errorCount > 0 ? '1px solid var(--color-border-secondary)' : '1px solid #6ee7b7', background: errorCount > 0 ? 'var(--color-background-secondary)' : '#ecfdf5', color: errorCount > 0 ? 'var(--color-text-tertiary)' : '#059669', cursor: (approving || errorCount > 0) ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500, opacity: errorCount > 0 ? 0.6 : 1 }}
                title={errorCount > 0 ? 'Fix schema errors before approving' : 'Approve this record'}
              >
                <CheckCircle size={13} />{approving ? 'Approving…' : 'Approve'}
              </button>
            </>
          )}

          {record.review_status === 'approved' && (
            <span style={{ fontSize: 12, color: '#059669', background: '#ecfdf5', padding: '4px 12px', borderRadius: 8, border: '1px solid #6ee7b7', fontFamily: 'var(--font-sans)' }}>
              ✓ approved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
