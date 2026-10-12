import type { ReactNode } from 'react'
import { cn } from '@/components/ui'

// Small building blocks shared by the newer pages, so they all look and behave the same way.

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 m-0">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1 mb-0 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'indigo' | 'purple'
const TONES: Record<Tone, { chip: string; bar: string; text: string; soft: string }> = {
  gray: { chip: 'bg-gray-100 text-gray-600', bar: 'bg-gray-300', text: 'text-gray-600', soft: 'bg-gray-50' },
  green: { chip: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500', text: 'text-emerald-600', soft: 'bg-emerald-50' },
  amber: { chip: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500', text: 'text-amber-600', soft: 'bg-amber-50' },
  red: { chip: 'bg-red-50 text-red-700', bar: 'bg-red-500', text: 'text-red-600', soft: 'bg-red-50' },
  blue: { chip: 'bg-blue-50 text-blue-700', bar: 'bg-blue-500', text: 'text-blue-600', soft: 'bg-blue-50' },
  indigo: { chip: 'bg-indigo-50 text-indigo-700', bar: 'bg-indigo-500', text: 'text-indigo-600', soft: 'bg-indigo-50' },
  purple: { chip: 'bg-purple-50 text-purple-700', bar: 'bg-purple-500', text: 'text-purple-600', soft: 'bg-purple-50' },
}
export const tone = (t: Tone) => TONES[t]

export function Chip({ tone: t = 'gray', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return <span title={title} className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', TONES[t].chip, className)}>{children}</span>
}

/** A number with a label. Doubles as a filter when onClick is given. */
export function Tile({ label, value, hint, tone: t = 'gray', active, onClick, disabled }: {
  label: string; value: ReactNode; hint?: string; tone?: Tone; active?: boolean; onClick?: () => void; disabled?: boolean
}) {
  const body = (
    <>
      <span className={cn('absolute top-0 left-0 right-0 h-1', TONES[t].bar)} />
      <span className="flex items-baseline gap-2">
        <span className={cn('text-2xl font-extrabold tabular-nums leading-none', disabled ? 'text-gray-300' : TONES[t].text)}>{value}</span>
        <span className="text-sm font-semibold text-gray-800 truncate">{label}</span>
      </span>
      {hint && <span className="block text-[11px] text-gray-400 mt-1.5 leading-snug">{hint}</span>}
    </>
  )
  const cls = cn('relative text-left bg-white rounded-2xl border px-4 pt-4 pb-3 shadow-card overflow-hidden transition w-full',
    active ? 'border-transparent ring-2 ring-brand-400' : 'border-gray-100', onClick && !disabled && 'hover:border-gray-200 hover:-translate-y-px cursor-pointer',
    disabled && 'opacity-60')
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={!!active} disabled={disabled} className={cls}>{body}</button>
    : <div className={cls}>{body}</div>
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string; count?: number; tone?: Tone }[] }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-gray-100 gap-1 max-w-full overflow-x-auto" role="tablist">
      {items.map(i => (
        <button key={i.key} type="button" role="tab" aria-selected={value === i.key} onClick={() => onChange(i.key)}
          className={cn('px-3.5 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap inline-flex items-center gap-2',
            value === i.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
          {i.label}
          {i.count !== undefined && (
            <span className={cn('text-[11px] tabular-nums px-1.5 rounded-full', value === i.key ? (i.tone ? TONES[i.tone].chip : 'bg-gray-100 text-gray-600') : 'bg-gray-200/70 text-gray-500')}>{i.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Panel({ title, subtitle, actions, children, className, flush }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('bg-white rounded-2xl border border-gray-100 shadow-card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-50">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-bold text-gray-900 m-0">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-400 m-0 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

export function Blank({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      {icon && <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400">{icon}</div>}
      <p className="text-sm font-semibold text-gray-800 m-0">{title}</p>
      {text && <p className="text-sm text-gray-400 mt-1 mb-0 max-w-sm mx-auto">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function SelectBox({ value, onChange, children, label, className }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; className?: string }) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}
      className={cn('text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-200 max-w-full', className)}>
      {children}
    </select>
  )
}

export function Skeletons({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}</div>
}

/** "5m", "3h", "2d": short enough to stay on one line. */
export function shortAgo(iso?: string | null): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`
}
export const PAGE = 'p-6 lg:p-8 max-w-[1200px] mx-auto space-y-5 animate-fade-in'
export const dayLabel = (d: number) => (d < 1 ? 'today' : d < 2 ? '1 day' : `${Math.floor(d)} days`)
export const levelTone = (l?: string): Tone => (l === 'red' ? 'red' : l === 'amber' ? 'amber' : 'gray')
