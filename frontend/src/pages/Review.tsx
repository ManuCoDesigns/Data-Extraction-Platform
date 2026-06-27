import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowLeft, CheckCircle, XCircle, SkipForward, AlertTriangle,
  ChevronLeft, ChevronRight, List, Layers, Clock
} from 'lucide-react'
import { recordsApi, jobsApi } from '@/api/client'
import type { ExtractedRecord, Job, LLMFieldFlag } from '@/types'
import { Button, Badge, ConfidenceBadge, LLMVerdictBadge, cn, Spinner, EmptyState, toast } from '@/components/ui'

type Mode = 'single' | 'bulk'

export function ReviewPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [job, setJob]             = useState<Job | null>(null)
  const [records, setRecords]     = useState<ExtractedRecord[]>([])
  const [allCounts, setAllCounts] = useState({ pending: 0, approved: 0, rejected: 0, all: 0 })
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [mode, setMode]           = useState<Mode>('single')
  const [cursor, setCursor]       = useState(0)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving]       = useState(false)

  // Read filter from URL — ?filter=pending|approved|rejected|all
  const filter = searchParams.get('filter') || 'pending'
  const setFilter = (f: string) => { setSearchParams({ filter: f }); setCursor(0) }

  // Use Element (not HTMLDivElement) so the virtualizer types align
  const bulkParentRef = useRef<Element>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [jobData, recordData, pendingData, approvedData, rejectedData, allData] = await Promise.all([
        jobsApi.get(jobId!),
        recordsApi.list(jobId!, { review_status: filter === 'all' ? undefined : filter, page_size: 100 }),
        recordsApi.list(jobId!, { review_status: 'pending',  page_size: 1 }),
        recordsApi.list(jobId!, { review_status: 'approved', page_size: 1 }),
        recordsApi.list(jobId!, { review_status: 'rejected', page_size: 1 }),
        recordsApi.list(jobId!, { page_size: 1 }),
      ])
      setJob(jobData)
      setRecords(recordData.items)
      setTotal(recordData.total)
      setAllCounts({
        pending:  pendingData.total,
        approved: approvedData.total,
        rejected: rejectedData.total,
        all:      allData.total,
      })
      setCursor(0)
    } finally {
      setLoading(false)
    }
  }, [jobId, filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mode !== 'single') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'a' || e.key === 'A') doAction('approve')
      if (e.key === 'r' || e.key === 'R') doAction('reject')
      if (e.key === 's' || e.key === 'S') doAction('skip')
      if (e.key === 'ArrowLeft') setCursor(c => Math.max(0, c - 1))
      if (e.key === 'ArrowRight') setCursor(c => Math.min(records.length - 1, c + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, records, cursor])

  const currentRecord = records[cursor]

  const doAction = async (action: 'approve' | 'reject' | 'skip') => {
    if (!currentRecord) return
    setSaving(true)
    try {
      await recordsApi.review(currentRecord.id, action, undefined, overrides[currentRecord.id] as Record<string, unknown>)
      toast[action === 'approve' ? 'success' : action === 'reject' ? 'error' : 'info'](`Record ${action}d`)
      setRecords(prev => prev.map(r =>
        r.id === currentRecord.id
          ? { ...r, review_status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'skipped' }
          : r
      ))
      if (cursor < records.length - 1) setCursor(c => c + 1)
      else load()
    } catch {
      toast.error('Action failed')
    } finally {
      setSaving(false)
    }
  }

  const doBulkAction = async (action: 'approve' | 'reject') => {
    const ids = Array.from(selected)
    if (!ids.length) return
    if (!confirm(`${action} ${ids.length} records?`)) return
    setSaving(true)
    try {
      await recordsApi.bulkReview(ids, action)
      toast.success(`${ids.length} records ${action}d`)
      setSelected(new Set())
      load()
    } catch {
      toast.error('Bulk action failed')
    } finally {
      setSaving(false)
    }
  }

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => bulkParentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <Link to={`/jobs/${jobId}`} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="font-semibold text-gray-900 text-sm">{job?.name}</span>
        </div>

        {/* Clear status filter buttons with counts */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: 'pending',  label: 'Pending Review', icon: '⏳', count: allCounts.pending,  activeColor: '#d97706', activeBg: '#fffbeb', activeBorder: '#fcd34d' },
            { key: 'approved', label: 'Approved',       icon: '✅', count: allCounts.approved, activeColor: '#059669', activeBg: '#ecfdf5', activeBorder: '#6ee7b7' },
            { key: 'rejected', label: 'Rejected',       icon: '❌', count: allCounts.rejected, activeColor: '#dc2626', activeBg: '#fef2f2', activeBorder: '#fca5a5' },
            { key: 'all',      label: 'All Records',    icon: '📋', count: allCounts.all,      activeColor: '#4f46e5', activeBg: '#eff6ff', activeBorder: '#c7d2fe' },
          ].map(({ key, label, icon, count, activeColor, activeBg, activeBorder }) => {
            const isActive = filter === key
            return (
              <button key={key} onClick={() => setFilter(key)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 20, border: `2px solid ${isActive ? activeBorder : '#e2e8f0'}`,
                background: isActive ? activeBg : '#fff',
                color: isActive ? activeColor : '#64748b',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
              }}>
                <span>{icon}</span>
                <span>{label}</span>
                <span style={{ background: isActive ? activeBorder : '#f1f5f9', color: isActive ? activeColor : '#475569', borderRadius: 20, padding: '0 7px', fontSize: 11 }}>
                  {count}
                </span>
              </button>
            )
          })}

          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 ml-2">
            {([['single', Layers, 'Single'], ['bulk', List, 'Bulk']] as const).map(([id, Icon, label]) => (
              <button key={id} onClick={() => setMode(id as Mode)}
                className={cn('px-3 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                  mode === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status explanation banner */}
      {filter === 'pending' && allCounts.pending === 0 && allCounts.approved > 0 && (
        <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: '12px 16px', margin: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle size={16} color="#059669" />
          <p style={{ fontSize: 13, color: '#065f46', margin: 0 }}>
            No pending records — all {allCounts.approved} records have been approved! Click <strong>Approved</strong> above to view them, or go back to submit.
          </p>
        </div>
      )}

      {records.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title={filter === 'pending' ? 'No pending records' : filter === 'approved' ? 'No approved records yet' : 'No records found'}
            description={filter === 'pending' && allCounts.approved > 0
              ? `All ${allCounts.approved} records are already approved. Switch to the Approved tab above.`
              : 'No records match this filter.'}
          />
        </div>
      ) : mode === 'single' ? (
        <SinglePanel
          record={currentRecord} cursor={cursor} total={records.length}
          overrides={overrides[currentRecord?.id] ?? {}} saving={saving}
          onOverride={(f, v) => setOverrides(p => ({ ...p, [currentRecord.id]: { ...(p[currentRecord.id] ?? {}), [f]: v } }))}
          onApprove={() => doAction('approve')}
          onReject={() => doAction('reject')}
          onSkip={() => doAction('skip')}
          onPrev={() => setCursor(c => Math.max(0, c - 1))}
          onNext={() => setCursor(c => Math.min(records.length - 1, c + 1))}
        />
      ) : (
        <BulkPanel
          records={records} selected={selected}
          onToggle={id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })}
          onToggleAll={() => setSelected(selected.size === records.length ? new Set() : new Set(records.map(r => r.id)))}
          onApprove={() => doBulkAction('approve')}
          onReject={() => doBulkAction('reject')}
          saving={saving}
          parentRef={bulkParentRef}
          virtualizer={rowVirtualizer}
        />
      )}
    </div>
  )
}

// ─── Single panel ─────────────────────────────────────────────────────────────
function SinglePanel({ record, cursor, total, overrides, saving, onOverride, onApprove, onReject, onSkip, onPrev, onNext }: {
  record: ExtractedRecord; cursor: number; total: number
  overrides: Record<string, string>; saving: boolean
  onOverride: (f: string, v: string) => void
  onApprove: () => void; onReject: () => void
  onSkip: () => void; onPrev: () => void; onNext: () => void
}) {
  if (!record) return null
  const isPending = record.review_status === 'pending'
  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-2/5 border-r border-gray-100 flex flex-col bg-slate-50">
        <div className="px-5 py-3 border-b border-gray-100 bg-white flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Source Text</p>
          <div className="flex items-center gap-2">
            <ConfidenceBadge confidence={record.extraction_confidence} />
            <LLMVerdictBadge verdict={record.llm_verdict} skipped={record.llm_skipped} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed">
            {record.raw_text || '(no raw text captured)'}
          </pre>
        </div>
        {record.llm_reason && (
          <div className="p-4 border-t border-gray-100 bg-amber-50">
            <p className="text-xs font-semibold text-amber-700 mb-1">LLM Note</p>
            <p className="text-xs text-amber-800">{record.llm_reason}</p>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-thin">
          {record.llm_field_flags.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {record.llm_field_flags.length} field(s) flagged
              </p>
              {record.llm_field_flags.map((f: LLMFieldFlag) => (
                <p key={f.field} className="text-xs text-amber-800">
                  <span className="font-mono font-semibold">{f.field}</span>: {f.issue}
                </p>
              ))}
            </div>
          )}
          {Object.entries(record.extracted_fields).map(([key, value]) => {
            const flag = record.llm_field_flags.find((f: LLMFieldFlag) => f.field === key)
            const override = overrides[key]
            const isFixed = key === 'is_verified' || key === 'cross_graph_material_id'
            return (
              <div key={key} className={cn('rounded-xl border p-3.5', flag ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white')}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-mono">{key}</label>
                  <div className="flex items-center gap-1">
                    {flag && <Badge variant="amber">Flagged</Badge>}
                    {override && <Badge variant="blue">Edited</Badge>}
                    {isFixed && <Badge variant="gray">Fixed</Badge>}
                  </div>
                </div>
                {isFixed ? (
                  <p className="text-sm text-gray-400 italic">{String(value)}</p>
                ) : (
                  <input
                    type="text"
                    value={override ?? String(value ?? '')}
                    onChange={e => onOverride(key, e.target.value)}
                    className={cn(
                      'w-full text-sm px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand-500 transition',
                      flag ? 'border-amber-200 bg-white' : 'border-gray-200 bg-slate-50',
                      override && 'border-blue-300 bg-blue-50'
                    )}
                  />
                )}
                {flag?.suggested_value && (
                  <button onClick={() => onOverride(key, flag.suggested_value!)}
                    className="mt-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
                    Use suggestion: "{flag.suggested_value}"
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="border-t border-gray-100 bg-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <button onClick={onPrev} disabled={cursor === 0} className="p-1 hover:text-gray-600 disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-medium text-gray-600">{cursor + 1} / {total}</span>
            <button onClick={onNext} disabled={cursor === total - 1} className="p-1 hover:text-gray-600 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onSkip} disabled={!isPending || saving}>
              <SkipForward className="w-3.5 h-3.5" /> Skip
            </Button>
            <Button variant="danger" size="sm" onClick={onReject} disabled={!isPending || saving}>
              <XCircle className="w-3.5 h-3.5" /> Reject
            </Button>
            <Button size="sm" onClick={onApprove} disabled={!isPending || saving} loading={saving}>
              <CheckCircle className="w-3.5 h-3.5" /> Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk panel ───────────────────────────────────────────────────────────────
// parentRef and virtualizer both use Element (not HTMLDivElement) — this is the key fix
function BulkPanel({ records, selected, onToggle, onToggleAll, onApprove, onReject, saving, parentRef, virtualizer }: {
  records: ExtractedRecord[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onApprove: () => void
  onReject: () => void
  saving: boolean
  parentRef: React.RefObject<Element>
  virtualizer: ReturnType<typeof useVirtualizer>
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {selected.size > 0 && (
        <div className="bg-brand-50 border-b border-brand-100 px-6 py-3 flex items-center gap-3">
          <span className="text-sm font-semibold text-brand-800">{selected.size} selected</span>
          <Button size="sm" onClick={onApprove} loading={saving}>
            <CheckCircle className="w-3.5 h-3.5" /> Approve all
          </Button>
          <Button size="sm" variant="danger" onClick={onReject} loading={saving}>
            <XCircle className="w-3.5 h-3.5" /> Reject all
          </Button>
        </div>
      )}
      <div className="border-b border-gray-100 bg-white px-5 py-2.5 flex items-center gap-4 text-xs text-gray-400 uppercase tracking-wide font-medium shrink-0">
        <input type="checkbox"
          checked={selected.size === records.length && records.length > 0}
          onChange={onToggleAll} className="rounded" />
        <span className="flex-1">Entity</span>
        <span className="w-24">Confidence</span>
        <span className="w-24">LLM</span>
        <span className="w-24">Status</span>
      </div>
      <div ref={parentRef as React.RefObject<HTMLDivElement>} className="flex-1 overflow-y-auto scrollbar-thin">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => {
            const r = records[vRow.index]
            if (!r) return null
            const isSelected = selected.has(r.id)
            return (
              <div
                key={r.id}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)`, height: `${vRow.size}px` }}
                className={cn('flex items-center gap-4 px-5 border-b border-gray-50 cursor-pointer transition',
                  isSelected ? 'bg-brand-50' : 'hover:bg-slate-50')}
                onClick={() => onToggle(r.id)}
              >
                <input type="checkbox" checked={isSelected}
                  onChange={() => onToggle(r.id)}
                  onClick={e => e.stopPropagation()} className="rounded" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {(r.extracted_fields.company_name as string) || r.canonical_name || '—'}
                  </p>
                </div>
                <div className="w-24"><ConfidenceBadge confidence={r.extraction_confidence} /></div>
                <div className="w-24"><LLMVerdictBadge verdict={r.llm_verdict} skipped={r.llm_skipped} /></div>
                <div className="w-24">
                  <Badge variant={r.review_status === 'approved' ? 'green' : r.review_status === 'rejected' ? 'red' : 'gray'}>
                    {r.review_status}
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}