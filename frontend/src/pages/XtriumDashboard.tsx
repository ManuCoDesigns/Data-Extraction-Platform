import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, Database, Clock, CheckCircle, Send, RefreshCw, ArrowUpRight,
  Globe, Archive, AlertTriangle, Inbox, X, ExternalLink,
} from 'lucide-react'
import { xtriumApi } from '@/api/client'
import { cn } from '@/components/ui'

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

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
      style={{ background: `${color}15`, color }}>
      {label}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, grad }: any) {
  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden p-4">
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

function DetailDrawer({ source, onClose }: { source: any; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const item = source.xtrium
  const ours = STATUS_META[source.status] ?? { label: source.status, color: '#64748b' }
  const extras = item ? Object.keys(item).filter(k => !KNOWN_KEYS.has(k)) : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[540px] bg-white h-full shadow-float overflow-y-auto scrollbar-thin">
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

          <Link to={`/projects/${source.project_id}/sources/${source.id}`}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25 hover:opacity-95 transition">
            Open this source <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export function XtriumDashboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
  const sources = data.sources ?? []
  const activity = data.activity ?? []
  const live = data.live_availability
  // Derived on every render so an open drawer stays current when data refreshes.
  const selected = selectedId ? sources.find((s: any) => s.id === selectedId) : null

  const inProgress = ['extracting', 'needs_fixes', 'ready_for_review', 'in_review', 'changes_requested', 'llm_verification']
    .reduce((a, k) => a + (byStatus[k] ?? 0), 0)

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
        <button onClick={() => load({ silent: true })} disabled={refreshing}
          className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

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
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Linked" value={data.total_linked ?? 0} icon={Database} grad="from-blue-500 to-blue-600" />
        <StatCard label="In Progress" value={inProgress} icon={Clock} grad="from-amber-500 to-orange-600" />
        <StatCard label="Approved" value={byStatus['approved'] ?? 0} icon={CheckCircle} grad="from-emerald-500 to-emerald-600" />
        <StatCard label="Submitted" value={data.submitted_count ?? 0} icon={Send} grad="from-purple-500 to-purple-600" />
      </div>

      {/* Sources table — full width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 m-0">Xtrium-Linked Sources</h2>
          <p className="text-xs text-gray-400 m-0">Click a row to see it exactly as Xtrium shows it</p>
        </div>
        <div className="overflow-x-auto scrollbar-thin" style={{ maxHeight: 520 }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 sticky top-0">
                {['Source', 'Item #', 'Xtrium Status', 'Our Status', 'Submitted', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">No Xtrium-linked sources yet</td></tr>
              ) : sources.map((s: any) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: '#64748b' }
                const xStatus = s.xtrium?.status
                return (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)}
                    className="border-b border-gray-50 hover:bg-gray-50/60 transition cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900 truncate max-w-[280px]">{s.name}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[280px]">{s.project_name ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">#{s.external_ref_id}</td>
                    <td className="px-4 py-3">
                      {xStatus
                        ? <Pill label={String(xStatus)} color={xtriumStatusColor(String(xStatus))} />
                        : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3"><Pill label={meta.label} color={meta.color} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {s.xtrium_submitted_at ? timeAgo(s.xtrium_submitted_at) : '—'}
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

      {selected && <DetailDrawer source={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
