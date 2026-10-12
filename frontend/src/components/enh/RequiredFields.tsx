import { CheckCircle2, CircleAlert } from 'lucide-react'
import { cn } from '@/components/ui'
import { completeness, sourceCompleteness, type SchemaFieldLite } from '@/lib/completeness'

const label = (n: string) => n.replace(/_/g, ' ')

/** One record: a slim strip showing how many required fields are filled and which are missing. */
export function RecordRequiredBar({ fields, data }: { fields: SchemaFieldLite[]; data: Record<string, unknown> }) {
  const c = completeness(fields, data)
  if (!c.total) return null
  const done = c.missing.length === 0
  const pct = Math.round((c.filled / c.total) * 100)
  return (
    <div style={{ background: done ? '#f0fdf4' : '#fffbeb', borderBottom: `1px solid ${done ? '#bbf7d0' : '#fde68a'}`, padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}
      role="status" aria-label={`Required fields: ${c.filled} of ${c.total} filled`}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: done ? '#047857' : '#b45309' }}>
        {done ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
        Required fields {c.filled} of {c.total}
      </span>
      <span style={{ width: 120, height: 6, borderRadius: 6, background: done ? '#bbf7d0' : '#fde68a', overflow: 'hidden', flexShrink: 0 }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: done ? '#10b981' : '#f59e0b', transition: 'width .3s' }} />
      </span>
      {done ? <span style={{ fontSize: 12, color: '#047857' }}>Every required field has a value.</span> : (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#92400e' }}>Missing:</span>
          {c.missing.map(m => <span key={m} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#fff', border: '1px solid #fcd34d', color: '#92400e' }}>{label(m)}</span>)}
        </span>
      )}
    </div>
  )
}

/** A whole source: share of required cells filled, records with gaps, and the fields left empty most often. */
export function SourceRequiredCard({ fields, records }: { fields: SchemaFieldLite[]; records: any[] }) {
  const s = sourceCompleteness(fields, records)
  if (!s) return null
  const good = s.pct >= 95, mid = s.pct >= 75
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-5 py-4 flex items-center gap-5 flex-wrap" role="status" aria-label={`Required fields ${s.pct} percent complete`}>
      <div className="min-w-[180px]">
        <p className="text-xs font-semibold text-gray-400 m-0">Required fields filled</p>
        <p className="m-0 mt-0.5 flex items-baseline gap-2">
          <span className={cn('text-2xl font-extrabold tabular-nums leading-none', good ? 'text-emerald-600' : mid ? 'text-amber-600' : 'text-red-600')}>{s.pct}%</span>
          <span className="text-xs text-gray-400">{s.complete} of {s.records} records complete</span>
        </p>
        <span className="block mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className={cn('block h-full rounded-full', good ? 'bg-emerald-500' : mid ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${s.pct}%` }} /></span>
      </div>
      {s.top.length > 0 ? (
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-400 m-0 mb-1.5">Most often empty</p>
          <div className="flex flex-wrap gap-1.5">
            {s.top.map(t => <span key={t.name} className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">{label(t.name)} <span className="tabular-nums text-amber-500">x{t.n}</span></span>)}
          </div>
        </div>
      ) : <p className="text-sm text-emerald-700 m-0 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Every required field has a value in every record.</p>}
    </div>
  )
}
