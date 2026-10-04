import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, Database, Clock, CheckCircle, Send, RefreshCw, ArrowUpRight,
  Globe, Archive, AlertTriangle, Inbox, X, ExternalLink,
  Search, Check, ChevronDown, ChevronUp, Copy,
} from 'lucide-react'
import { xtriumApi } from '@/api/client'
import { cn, toast } from '@/components/ui'

// ── Our own internal statuses ────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string }> = {
  not_started:        { label: 'Not Started',       color: '#64748b' },
  extracting:         { label: 'Extracting',        color: '#2563eb' },
  needs_fixes:        { label: 'Needs Fixes',       color: '#d97706' },
  ready_for_review:   { label: 'Ready for Review',  color: '#4f46e5' },
  in_review:          { label: 'In Review',         color: '#7c3aed' },
  changes_requested:  { label: 'Changes Requested', color: '#dc2626' },
  llm_verification:   { label: 'LLM Verification',  color: '#7c3aed' },
  approved:           { label: 'Approved',          color: '#059669' },
}

const IN_PROGRESS_STATUSES = ['extracting', 'needs_fixes', 'ready_for_review', 'in_review', 'changes_requested', 'llm_verification']
const REVIEW_REACHED = ['in_review', 'llm_verification', 'changes_requested', 'approved']
const ATTENTION_STATUSES = ['needs_fixes', 'changes_requested']

// ── Xtrium's own status wording, shown verbatim (colour is just a hint) ──────
function xtriumStatusColor(status?: string): string {
  const s = (status ?? '').toLowerCase()
  if (s.includes('ingest') || s.includes('approved')) return '#059669'
  if (s.includes('scraped')) return '#7c3aed'
  if (s.includes('progress')) return '#d97706'
  if (s.includes('queued') || s.includes('assigned')) return '#2563eb'
  if (s.includes('fail') || s.includes('reject')) return '#dc2626'
  if (s.includes('archiv')) return '#64748b'
  return '#64748b'
}

const xtriumStatusOf = (s: any): string => String(s.xtrium?.status ?? s._verified_status ?? '')

// Our backend passes Xtrium's error text through (e.g. "Status check failed for
// item 70: 404 — {"detail":"Catalog item #70 not found."}"), usually wrapped in
// a 502, so recognise it from the text rather than the HTTP status.
function isItemNotFound(detail: unknown): boolean {
  const t = String(detail ?? '')
  return /\b404\b/.test(t) && /not found/i.test(t)
}

// ── Derived per-source state ─────────────────────────────────────────────────
const isReady = (s: any): boolean => s.status === 'approved' && !s.xtrium_submitted_at
const isSubmitted = (s: any): boolean => !!s.xtrium_submitted_at

function needsAttention(s: any): boolean {
  if (s._missing) return true
  if (s._rework) return true
  if (ATTENTION_STATUSES.includes(s.status)) return true
  const xs = xtriumStatusOf(s).toLowerCase()
  if (xs.includes('fail') || xs.includes('reject')) return true
  return /rework/i.test(String(s.xtrium?.notes ?? ''))
}

const STAGE_NAMES = ['Pulled', 'Extracted', 'In review', 'Approved', 'Submitted', 'Ingested']
const WAITING_ON = ['', 'Needs extraction', 'Awaiting review', 'Awaiting approval', 'Ready to submit', 'Awaiting Xtrium']

function stageSummary(s: any) {
  const xs = xtriumStatusOf(s).toLowerCase()
  const done: boolean[] = [
    true,
    (s.total_records ?? 0) > 0,
    REVIEW_REACHED.includes(s.status),
    s.status === 'approved',
    isSubmitted(s),
    xs.includes('ingest') || xs.includes('approved'),
  ]
  const idx = done.indexOf(false)
  const attention = needsAttention(s)
  const text = s._missing ? 'Not on Xtrium' : s._rework ? 'Rework requested' : attention ? 'Needs attention' : idx === -1 ? 'Complete' : WAITING_ON[idx]
  return { done, idx, attention, text }
}

type FilterKey = 'all' | 'inprogress' | 'ready' | 'submitted' | 'attention'
type SortKey = 'recent' | 'name' | 'item' | 'submitted'

const FILTERS: [FilterKey, string][] = [
  ['all', 'All'],
  ['inprogress', 'In progress'],
  ['ready', 'Ready to submit'],
  ['submitted', 'Submitted'],
  ['attention', 'Needs attention'],
]

function matchesFilter(s: any, f: FilterKey): boolean {
  switch (f) {
    case 'inprogress': return IN_PROGRESS_STATUSES.includes(s.status)
    case 'ready': return isReady(s)
    case 'submitted': return isSubmitted(s)
    case 'attention': return needsAttention(s)
    default: return true
  }
}

function sortRows(rows: any[], key: SortKey): any[] {
  const copy = [...rows]
  if (key === 'name') {
    copy.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } else if (key === 'item') {
    copy.sort((a, b) => (Number(a.external_ref_id) || 0) - (Number(b.external_ref_id) || 0))
  } else if (key === 'submitted') {
    const t = (s: any) => (s.xtrium_submitted_at ? Date.parse(s.xtrium_submitted_at) : 0)
    copy.sort((a, b) => t(b) - t(a))
  }
  return copy // 'recent' keeps the server's most-recently-updated-first order
}

// ── Small UI pieces ──────────────────────────────────────────────────────────
function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
      style={{ background: `${color}15`, color }}>
      {label}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, grad, onClick, active }: any) {
  const clickable = !!onClick
  return (
    <div onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
      className={cn(
        'relative bg-white rounded-2xl border shadow-card overflow-hidden p-4 transition',
        active ? 'border-brand-300 ring-2 ring-brand-100' : 'border-gray-100',
        clickable && 'cursor-pointer hover:shadow-float',
      )}>
      <div className={cn('absolute top-0 left-0 right-0 h-1 bg-gradient-to-r', grad)} />
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br shadow-sm', grad)}>
          <Icon className="w-[18px] h-[18px] text-white" />
        </div>
        <div>
          <p className="text-2xl font-extrabold text-gray-900 leading-none">{value}</p>
          <p className="text-xs text-gray-400 mt-1">{label}</p>
        </div>
      </div>
    </div>
  )
}

function StageBar({ s }: { s: any }) {
  const { done, idx, attention, text } = stageSummary(s)
  return (
    <div className="min-w-[132px]">
      <div className="flex gap-1">
        {done.map((d, i) => (
          <div key={i} title={STAGE_NAMES[i]}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              d ? 'bg-emerald-500' : i === idx ? (attention ? 'bg-red-500' : 'bg-amber-400') : 'bg-gray-200',
            )} />
        ))}
      </div>
      <p className={cn(
        'text-[11px] mt-1 font-semibold',
        attention ? 'text-red-600' : idx === -1 ? 'text-emerald-600' : 'text-gray-500',
      )}>{text}</p>
    </div>
  )
}

function StageStepper({ s }: { s: any }) {
  const { done, idx, attention } = stageSummary(s)
  return (
    <div className="flex items-start">
      {STAGE_NAMES.map((name, i) => {
        const isDone = done[i]
        const isCurrent = i === idx
        return (
          <div key={name} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div className={cn(
                'absolute top-3 right-1/2 w-full h-0.5',
                done[i - 1] && isDone ? 'bg-emerald-500' : 'bg-gray-200',
              )} />
            )}
            <div className={cn(
              'relative z-10 w-6 h-6 rounded-full flex items-center justify-center border-2',
              isDone ? 'bg-emerald-500 border-emerald-500'
                : isCurrent ? (attention ? 'bg-white border-red-500' : 'bg-white border-amber-400')
                : 'bg-white border-gray-200',
            )}>
              {isDone
                ? <Check className="w-3.5 h-3.5 text-white" />
                : isCurrent
                  ? <span className={cn('w-2 h-2 rounded-full', attention ? 'bg-red-500' : 'bg-amber-400')} />
                  : null}
            </div>
            <p className={cn(
              'text-[10px] mt-1.5 text-center font-semibold',
              isDone ? 'text-emerald-700' : isCurrent ? (attention ? 'text-red-600' : 'text-amber-600') : 'text-gray-300',
            )}>{name}</p>
          </div>
        )
      })}
    </div>
  )
}

const ACTIVITY_ICON: Record<string, any> = {
  'Pulled from Xtrium':         { icon: Inbox, grad: 'from-blue-500 to-blue-600' },
  'Submitted to Xtrium':        { icon: Send, grad: 'from-emerald-500 to-emerald-600' },
  'Archived by Xtrium':         { icon: Archive, grad: 'from-gray-400 to-gray-500' },
  'Rejected by Xtrium':         { icon: AlertTriangle, grad: 'from-red-500 to-rose-600' },
  'Escalated — no data found':  { icon: AlertTriangle, grad: 'from-amber-500 to-orange-600' },
}

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// ── Xtrium's fields, in the order and wording Xtrium uses ────────────────────
const XTRIUM_FIELDS: [string, string][] = [
  ['id', 'Item ID'],
  ['name', 'Name'],
  ['url', 'URL'],
  ['resolved_link', 'Resolved Link'],
  ['category', 'Category'],
  ['kg_node', 'KG Node'],
  ['type', 'Type'],
  ['sub_type', 'Sub-type'],
  ['sub_products', 'Sub-products'],
  ['country_of_origin', 'Country of Origin'],
  ['priority_rank', 'Priority Rank'],
  ['status', 'Status'],
  ['claimed_at', 'Claimed At'],
  ['notes', 'Notes'],
]
const LINK_FIELDS = new Set(['url', 'resolved_link'])
const KNOWN_KEYS = new Set(XTRIUM_FIELDS.map(([k]) => k))

const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function FieldRow({ label, children }: { label: string; children: any }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pt-0.5">{label}</p>
      <div className="col-span-2 text-sm text-gray-800 break-words">{children}</div>
    </div>
  )
}

function renderXtriumValue(key: string, value: any) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-300">—</span>
  if (key === 'status') return <Pill label={String(value)} color={xtriumStatusColor(String(value))} />
  if (key === 'claimed_at') return <span>{formatDate(String(value))}</span>
  if (LINK_FIELDS.has(key) && typeof value === 'string') {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return (
      <a href={href} target="_blank" rel="noreferrer"
        className="text-brand-600 hover:text-brand-700 inline-flex items-start gap-1">
        <span className="break-all">{value}</span> <ExternalLink className="w-3 h-3 mt-1 shrink-0" />
      </a>
    )
  }
  if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>
  return <span className="whitespace-pre-wrap">{String(value)}</span>
}

// ── Detail drawer ────────────────────────────────────────────────────────────
function DetailDrawer({ source, onClose, onChanged, onMissing, onFound }: {
  source: any; onClose: () => void; onChanged: () => void
  onMissing: (id: string) => void; onFound: (id: string) => void
}) {
  const [busy, setBusy] = useState<'status' | 'submit' | null>(null)
  const [statusResult, setStatusResult] = useState<any>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const item = source.xtrium
  const ours = STATUS_META[source.status] ?? { label: source.status, color: '#64748b' }
  const extras = item ? Object.keys(item).filter(k => !KNOWN_KEYS.has(k)) : []
  const canSubmit = source.status === 'approved'
  const alreadySubmitted = isSubmitted(source)

  // Xtrium answering "not found" is a distinct, explainable situation — say so
  // plainly instead of surfacing their raw JSON, and flag the row.
  const reportError = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail
    if (isItemNotFound(detail)) {
      onMissing(source.id)
      toast.error(`Xtrium no longer has item #${source.external_ref_id} (404 not found) — it may have expired or been released. See the notice at the top of this panel.`)
    } else {
      toast.error(detail || fallback)
    }
  }

  const copyMissingMessage = async () => {
    const msg = `Hi — our status check for Xtrium catalog item #${source.external_ref_id} ("${item?.name ?? source.name}") returns 404 "Catalog item #${source.external_ref_id} not found". Could you confirm whether this item still exists and is assigned to our API key, and re-assign it or tell us how to handle finished work for items that have lapsed?`
    try {
      await navigator.clipboard.writeText(msg)
      toast.success('Message copied')
    } catch {
      toast.error("Couldn't copy — select the text manually")
    }
  }

  const checkStatus = async () => {
    setBusy('status')
    try {
      const r = await xtriumApi.checkStatus(source.id)
      onFound(source.id)
      setStatusResult(r)
      if (r?.rework_applied_to_source) toast.success('Xtrium requested rework — the source was sent back to the extractor')
      else toast.success('Status checked')
      onChanged()
    } catch (err: any) {
      reportError(err, 'Status check failed')
    } finally {
      setBusy(null)
    }
  }

  const submit = async (confirmResubmit = false): Promise<void> => {
    setBusy('submit')
    let retryConfirmed = false
    try {
      const r = await xtriumApi.submitWithConfirm(source.id, confirmResubmit)
      onFound(source.id)
      const bundleNote = r?.bundled ? ` (${r.records_submitted} records bundled into one payload)` : ''
      toast.success(`Submitted to Xtrium Catalog IQ — item #${r?.item_id} now "${r?.item_status}"${bundleNote}`)
      onChanged()
    } catch (err: any) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 409 && window.confirm(`${detail}\n\nSubmit again anyway?`)) {
        retryConfirmed = true
      } else if (status !== 409) {
        reportError(err, 'Submit to Xtrium failed')
      }
    } finally {
      setBusy(null)
    }
    // Retried outside try/finally so the busy state isn't clobbered.
    if (retryConfirmed) await submit(true)
  }

  const togglePreview = async () => {
    const next = !showPreview
    setShowPreview(next)
    if (next && !preview && !previewLoading) {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        setPreview(await xtriumApi.payloadPreview(source.id))
      } catch (err: any) {
        setPreviewError(err?.response?.data?.detail || "Couldn't build the payload preview")
      } finally {
        setPreviewLoading(false)
      }
    }
  }

  const payloadText = preview?.payload != null ? JSON.stringify(preview.payload, null, 2) : ''
  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(payloadText)
      toast.success('Payload copied')
    } catch {
      toast.error("Couldn't copy — select the text manually")
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[600px] bg-white h-full shadow-float overflow-y-auto scrollbar-thin">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              Xtrium item #{source.external_ref_id}
            </p>
            <h2 className="text-base font-extrabold text-gray-900 m-0 mt-0.5 break-words">
              {item?.name ?? source.name}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Xtrium answered "not found" for this item */}
          {source._missing && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
              <p className="text-sm font-bold text-red-700 m-0">Xtrium no longer has this item</p>
              <p className="text-xs text-red-700/80 mt-1.5 m-0">
                Xtrium reports item #{source.external_ref_id} as not found. It may have expired or been released from our
                API key. Checking status or submitting will keep failing until Xtrium re-assigns it — so finished work
                here can't be delivered yet. Ask Xtrium whether the item still exists and is assigned to us.
              </p>
              <button onClick={copyMissingMessage}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-100 transition">
                <Copy className="w-3.5 h-3.5" /> Copy message for Xtrium
              </button>
            </div>
          )}

          {/* Pipeline stage */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-5 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 m-0">Pipeline stage</h3>
              <p className={cn('text-xs font-semibold m-0', stageSummary(source).attention ? 'text-red-600' : 'text-gray-500')}>
                {stageSummary(source).text}
              </p>
            </div>
            <StageStepper s={source} />
          </div>

          {/* Actions */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-5 py-4">
            <h3 className="text-sm font-bold text-gray-900 m-0 mb-3">Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={checkStatus} disabled={busy !== null}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition">
                <RefreshCw className={cn('w-3.5 h-3.5', busy === 'status' && 'animate-spin')} />
                {busy === 'status' ? 'Checking…' : 'Check Xtrium status'}
              </button>
              <button onClick={() => submit(false)} disabled={busy !== null || !canSubmit}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25 hover:opacity-95 disabled:opacity-40 disabled:shadow-none transition">
                <Send className="w-3.5 h-3.5" />
                {busy === 'submit' ? 'Submitting…' : alreadySubmitted ? 'Submit again' : 'Submit to Xtrium'}
              </button>
            </div>
            {!canSubmit && (
              <p className="text-xs text-gray-400 mt-2.5 m-0">Only fully approved sources can be submitted.</p>
            )}
            {canSubmit && alreadySubmitted && (
              <p className="text-xs text-gray-400 mt-2.5 m-0">
                Already submitted {timeAgo(source.xtrium_submitted_at)} — submitting again asks you to confirm first.
              </p>
            )}
            {statusResult && (
              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1.5">
                <p className="m-0 flex items-center gap-2">
                  <span className="font-semibold text-gray-800">Xtrium says:</span>
                  {statusResult.status
                    ? <Pill label={String(statusResult.status)} color={xtriumStatusColor(String(statusResult.status))} />
                    : <span className="text-gray-400">no status returned</span>}
                </p>
                {statusResult.rework_notes && (
                  <p className="m-0"><span className="font-semibold text-gray-800">Rework notes:</span> {String(statusResult.rework_notes)}</p>
                )}
                {statusResult.rework_applied_to_source && (
                  <p className="m-0 font-semibold text-amber-700">Rework was applied — the source went back to the extractor.</p>
                )}
              </div>
            )}
          </div>

          {/* As shown in Xtrium */}
          <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-500 to-brand-700" />
            <div className="px-5 pt-5 pb-1">
              <h3 className="text-sm font-bold text-gray-900 m-0">As shown in Xtrium</h3>
              <p className="text-xs text-gray-400 mt-0.5">Live from Xtrium Catalog IQ — their field names and values</p>
            </div>
            <div className="px-5 pb-3">
              {item ? (
                <>
                  {XTRIUM_FIELDS.map(([key, label]) => (
                    <FieldRow key={key} label={label}>{renderXtriumValue(key, item[key])}</FieldRow>
                  ))}
                  {extras.map(key => (
                    <FieldRow key={key} label={humanize(key)}>{renderXtriumValue(key, item[key])}</FieldRow>
                  ))}
                </>
              ) : (
                <p className="text-sm text-gray-400 py-4">
                  Xtrium's live record for this item isn't available right now — it may be outside the latest 100 items
                  Xtrium returned, or Xtrium couldn't be reached. Our own data for it is shown below.
                </p>
              )}
            </div>
          </div>

          {/* In our platform */}
          <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
            <div className="px-5 pt-5 pb-1">
              <h3 className="text-sm font-bold text-gray-900 m-0">In our platform</h3>
              <p className="text-xs text-gray-400 mt-0.5">Where this item stands on our side</p>
            </div>
            <div className="px-5 pb-3">
              <FieldRow label="Status"><Pill label={ours.label} color={ours.color} /></FieldRow>
              <FieldRow label="Project">{source.project_name ?? <span className="text-gray-300">—</span>}</FieldRow>
              <FieldRow label="Records">
                {source.approved_records} approved of {source.total_records}
              </FieldRow>
              <FieldRow label="Country">{source.country ?? <span className="text-gray-300">—</span>}</FieldRow>
              <FieldRow label="Type">{source.type ?? <span className="text-gray-300">—</span>}</FieldRow>
              <FieldRow label="Submitted">
                {source.xtrium_submitted_at
                  ? <span>{formatDate(source.xtrium_submitted_at)} <span className="text-gray-400">({timeAgo(source.xtrium_submitted_at)})</span></span>
                  : <span className="text-gray-400">Not submitted yet</span>}
              </FieldRow>
              <FieldRow label="Last synced">
                {source.external_synced_at
                  ? <span>{formatDate(source.external_synced_at)}</span>
                  : <span className="text-gray-300">—</span>}
              </FieldRow>
            </div>
          </div>

          {/* Payload preview */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
            <button onClick={togglePreview}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50/60 transition">
              <div>
                <h3 className="text-sm font-bold text-gray-900 m-0">Submitted payload preview</h3>
                <p className="text-xs text-gray-400 mt-0.5 m-0">The exact JSON Submit sends to Xtrium — nothing is sent from here</p>
              </div>
              {showPreview ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showPreview && (
              <div className="px-5 pb-5 border-t border-gray-50">
                {previewLoading && <p className="text-sm text-gray-400 py-4 m-0">Building preview…</p>}
                {previewError && <p className="text-sm text-red-600 py-4 m-0">{previewError}</p>}
                {preview && !previewLoading && (
                  preview.payload == null ? (
                    <p className="text-sm text-gray-400 py-4 m-0">
                      No approved records yet, so there's nothing to send.
                      {preview.not_approved_excluded > 0 && ` (${preview.not_approved_excluded} record(s) are still awaiting approval.)`}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3 py-3">
                        <p className="text-xs text-gray-500 m-0">
                          {preview.record_count} approved record{preview.record_count !== 1 ? 's' : ''}
                          {preview.bundled ? ' bundled into one payload' : ' sent as-is'}
                          {' · '}{payloadText.length.toLocaleString()} characters
                          {preview.not_approved_excluded > 0 && ` · ${preview.not_approved_excluded} not-yet-approved excluded`}
                        </p>
                        <button onClick={copyPayload}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition shrink-0">
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                      </div>
                      <pre className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-xs text-gray-700 overflow-auto m-0"
                        style={{ maxHeight: 360 }}>{payloadText}</pre>
                      <p className="text-[11px] text-gray-400 mt-2.5 m-0">
                        Built from the currently approved records. If records changed after this source was submitted,
                        this can differ from what was originally sent.
                      </p>
                    </>
                  )
                )}
              </div>
            )}
          </div>

          <Link to={`/projects/${source.project_id}/sources/${source.id}`}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25 hover:opacity-95 transition">
            Open this source <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function XtriumDashboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  // Items Xtrium has actually answered "not found" for (this session only).
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set())
  // Results of the last "Verify with Xtrium" run (this session only).
  const [verifying, setVerifying] = useState(false)
  const [verifyInfo, setVerifyInfo] = useState<Record<string, any>>({})
  const [verifySummary, setVerifySummary] = useState<any>(null)

  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    else setRefreshing(true)
    xtriumApi.dashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => {
    load()
    const interval = setInterval(() => load({ silent: true }), 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
  }

  if (!data) {
    return (
      <div className="px-7 py-6 max-w-[1200px] mx-auto">
        <p className="text-sm text-gray-400">Couldn't load the Xtrium dashboard. Try refreshing.</p>
      </div>
    )
  }

  const byStatus = data.by_status ?? {}
  const sources: any[] = (data.sources ?? []).map((s: any) => {
    const v = verifyInfo[s.id]
    return {
      ...s,
      _missing: missingIds.has(s.id) || undefined,
      _verified_status: v?.state === 'found' ? v.xtrium_status : undefined,
      _rework: v?.state === 'found' ? v.rework_pending : undefined,
    }
  })
  const activity = data.activity ?? []
  const live = data.live_availability
  // Derived on every render so an open drawer stays current when data refreshes.
  const selected = selectedId ? sources.find((s: any) => s.id === selectedId) : null

  const inProgress = IN_PROGRESS_STATUSES.reduce((a, k) => a + (byStatus[k] ?? 0), 0)
  const readyCount = sources.filter(isReady).length

  const counts: Record<FilterKey, number> = {
    all: sources.length,
    inprogress: sources.filter(s => matchesFilter(s, 'inprogress')).length,
    ready: readyCount,
    submitted: sources.filter(s => matchesFilter(s, 'submitted')).length,
    attention: sources.filter(s => matchesFilter(s, 'attention')).length,
  }

  const q = search.trim().toLowerCase()
  const filtered = sources.filter(s => matchesFilter(s, filter)).filter(s =>
    !q
    || String(s.name ?? '').toLowerCase().includes(q)
    || String(s.external_ref_id ?? '').toLowerCase().includes(q)
    || String(s.project_name ?? '').toLowerCase().includes(q)
    || xtriumStatusOf(s).toLowerCase().includes(q),
  )
  const rows = sortRows(filtered, sort)
  const clearFilters = () => { setSearch(''); setFilter('all') }
  const runVerify = async () => {
    setVerifying(true)
    try {
      const r = await xtriumApi.verify()
      const results: any[] = r?.results ?? []
      const info: Record<string, any> = {}
      results.forEach(x => { info[x.source_id] = x })
      setVerifyInfo(info)
      setMissingIds(prev => {
        const next = new Set(prev)
        results.forEach(x => {
          if (x.state === 'not_found') next.add(x.source_id)
          else if (x.state === 'found') next.delete(x.source_id)
        })
        return next
      })
      const byId: Record<string, any> = {}
      ;(data.sources ?? []).forEach((src: any) => { byId[src.id] = src })
      setVerifySummary({
        at: new Date().toLocaleTimeString(),
        checked: r?.checked ?? results.length,
        found: r?.found ?? 0,
        errors: r?.errors ?? 0,
        lapsed: results.filter(x => x.state === 'not_found').map(x => ({
          ref: x.external_ref_id,
          name: byId[x.source_id]?.xtrium?.name ?? byId[x.source_id]?.name ?? `Item #${x.external_ref_id}`,
        })),
      })
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Couldn't verify with Xtrium — try again")
    } finally {
      setVerifying(false)
    }
  }

  const copyLapsedList = async () => {
    if (!verifySummary) return
    const lines = verifySummary.lapsed.map((l: any) => `• #${l.ref} — ${l.name}`).join('\n')
    const msg = `Hi — a status check on these Xtrium catalog items returns 404 "not found". Could you confirm whether they still exist and are assigned to our API key, and re-assign them or tell us how to handle finished work for items that have lapsed?\n\n${lines}`
    try {
      await navigator.clipboard.writeText(msg)
      toast.success('Message copied')
    } catch {
      toast.error("Couldn't copy — select the text manually")
    }
  }

  const markMissing = (id: string) => setMissingIds(prev => new Set(prev).add(id))
  const markFound = (id: string) => setMissingIds(prev => {
    if (!prev.has(id)) return prev
    const next = new Set(prev)
    next.delete(id)
    return next
  })
  const toggleFilter = (f: FilterKey) => setFilter(cur => (cur === f ? 'all' : f))

  return (
    <div className="px-7 py-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25 shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900 m-0">Xtrium Integration</h1>
            <p className="text-xs text-gray-400 mt-0.5">Live progress across the Xtrium Catalog IQ pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runVerify} disabled={verifying}
            title="Asks Xtrium about every unsubmitted item. Read-only — changes nothing."
            className="flex items-center gap-2 text-xs font-semibold text-brand-700 px-3 py-2 rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 disabled:opacity-60 transition">
            <CheckCircle className={cn('w-3.5 h-3.5', verifying && 'animate-pulse')} />
            {verifying ? 'Verifying…' : 'Verify with Xtrium'}
          </button>
          <button onClick={() => load({ silent: true })} disabled={refreshing}
            className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition">
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* Result of the last Verify run */}
      {verifySummary && (
        <div className={cn(
          'rounded-2xl border px-5 py-4 mb-5',
          verifySummary.lapsed.length > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200',
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={cn('text-sm font-bold m-0', verifySummary.lapsed.length > 0 ? 'text-red-700' : 'text-emerald-700')}>
                Verified {verifySummary.checked} item{verifySummary.checked !== 1 ? 's' : ''} with Xtrium · {verifySummary.at}
              </p>
              <p className="text-xs text-gray-600 mt-1 m-0">
                {verifySummary.found} still on Xtrium · {verifySummary.lapsed.length} not on Xtrium
                {verifySummary.errors > 0 ? ` · ${verifySummary.errors} couldn't be checked` : ''}
                {' · '}only items not yet submitted are checked
              </p>
              {verifySummary.lapsed.length > 0 && (
                <>
                  <ul className="text-xs text-red-700 mt-2.5 mb-0 pl-4 list-disc space-y-0.5">
                    {verifySummary.lapsed.map((l: any) => <li key={l.ref}>#{l.ref} — {l.name}</li>)}
                  </ul>
                  <button onClick={copyLapsedList}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-100 transition">
                    <Copy className="w-3.5 h-3.5" /> Copy list for Xtrium
                  </button>
                </>
              )}
              {verifySummary.errors > 0 && (
                <p className="text-xs text-gray-500 mt-2.5 m-0">
                  Items that couldn't be checked weren't flagged — Xtrium didn't give a clear answer. Try again in a moment.
                </p>
              )}
            </div>
            <button onClick={() => setVerifySummary(null)} aria-label="Dismiss"
              className="p-1.5 rounded-lg hover:bg-white/70 text-gray-400 hover:text-gray-600 transition shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Live availability banner */}
      {live && (
        <div className="relative bg-white border border-gray-100 rounded-2xl pl-5 pr-5 py-3.5 mb-5 flex items-center gap-4 shadow-card overflow-hidden">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-gradient-to-b from-brand-500 to-brand-700" />
          <Globe className="w-4 h-4 text-brand-600 shrink-0" />
          <p className="text-sm text-gray-600">
            <span className="font-bold text-brand-700">{live.queued ?? live.assigned ?? 0}</span> available to pull right now
            {' · '}
            <span className="font-bold text-gray-700">{live.in_progress ?? 0}</span> currently in progress on Xtrium's side
          </p>
        </div>
      )}

      {/* Couldn't reach Xtrium for live item details */}
      {data.xtrium_items_error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-xs text-amber-700">
          Couldn't load live item details from Xtrium right now, so the "Xtrium status" column and the detail panel
          fall back to our own data. This clears up on its own when Xtrium responds again.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Linked" value={data.total_linked ?? 0} icon={Database} grad="from-blue-500 to-blue-600"
          onClick={() => setFilter('all')} active={filter === 'all'} />
        <StatCard label="In Progress" value={inProgress} icon={Clock} grad="from-purple-500 to-purple-600"
          onClick={() => toggleFilter('inprogress')} active={filter === 'inprogress'} />
        <StatCard label="Approved" value={byStatus['approved'] ?? 0} icon={CheckCircle} grad="from-emerald-500 to-emerald-600" />
        <StatCard label="Ready to Submit" value={readyCount} icon={Send} grad="from-amber-500 to-orange-600"
          onClick={() => toggleFilter('ready')} active={filter === 'ready'} />
        <StatCard label="Submitted" value={data.submitted_count ?? 0} icon={Check} grad="from-brand-500 to-brand-700"
          onClick={() => toggleFilter('submitted')} active={filter === 'submitted'} />
      </div>

      {/* Sources table — full width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900 m-0">Xtrium-Linked Sources</h2>
            <p className="text-xs text-gray-400 m-0">
              Showing {rows.length} of {sources.length} · click a row to see it as Xtrium shows it
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search name, item #, project, status…"
                className="w-[270px] pl-8 pr-3 py-2 text-xs rounded-xl border border-gray-200 outline-none focus:border-brand-400 transition" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold transition',
                    filter === key ? 'bg-brand-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100',
                  )}>
                  {label} <span className={cn('ml-1', filter === key ? 'text-white/70' : 'text-gray-400')}>{counts[key]}</span>
                </button>
              ))}
            </div>
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="ml-auto text-xs font-semibold text-gray-600 rounded-xl border border-gray-200 px-3 py-2 outline-none bg-white">
              <option value="recent">Recently updated</option>
              <option value="name">Name (A–Z)</option>
              <option value="item">Item # (low → high)</option>
              <option value="submitted">Recently submitted</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin" style={{ maxHeight: 520 }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 sticky top-0">
                {['Source', 'Item #', 'Stage', 'Xtrium Status', 'Submitted', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">No Xtrium-linked sources yet</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                    No sources match these filters.{' '}
                    <button onClick={clearFilters} className="text-brand-600 font-semibold hover:text-brand-700">Clear filters</button>
                  </td>
                </tr>
              ) : rows.map((s: any) => {
                const xStatus = xtriumStatusOf(s)
                return (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)}
                    className="border-b border-gray-50 hover:bg-gray-50/60 transition cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900 truncate max-w-[260px]">{s.name}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[260px]">{s.project_name ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">#{s.external_ref_id}</td>
                    <td className="px-4 py-3"><StageBar s={s} /></td>
                    <td className="px-4 py-3">
                      {s._missing
                        ? <Pill label="Not on Xtrium" color="#dc2626" />
                        : xStatus
                          ? <Pill label={xStatus} color={xtriumStatusColor(xStatus)} />
                          : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {isSubmitted(s)
                        ? timeAgo(s.xtrium_submitted_at)
                        : isReady(s)
                          ? <Pill label="Ready" color="#d97706" />
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/projects/${s.project_id}/sources/${s.id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                        Open <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity feed */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="text-sm font-bold text-gray-900 m-0">Recent Activity</h2>
        </div>
        <div className="overflow-y-auto scrollbar-thin px-5 py-4" style={{ maxHeight: 360 }}>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No recent Xtrium activity</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {activity.map((a: any) => {
                const meta = ACTIVITY_ICON[a.label] ?? { icon: Zap, grad: 'from-gray-400 to-gray-500' }
                const Icon = meta.icon
                return (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br', meta.grad)}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{a.label}</p>
                      <p className="text-xs text-gray-400 truncate">{a.source_name ?? 'Unknown source'}</p>
                      <p className="text-[11px] text-gray-300 mt-0.5">
                        {a.user_name ? `${a.user_name} · ` : ''}{timeAgo(a.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <DetailDrawer key={selected.id} source={selected}
          onClose={() => setSelectedId(null)} onChanged={() => load({ silent: true })}
          onMissing={markMissing} onFound={markFound} />
      )}
    </div>
  )
}
