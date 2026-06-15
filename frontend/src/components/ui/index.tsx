import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}

// ─── Button ──────────────────────────────────────────────────────────────────
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  children: ReactNode
}
export function Button({ variant = 'primary', size = 'md', loading, children, className, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]'
  const variants = {
    primary:   'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500 shadow-sm',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus:ring-brand-500 shadow-sm',
    ghost:     'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-400',
    danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
    success:   'bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500 shadow-sm',
  }
  const sizes = {
    xs: 'px-2.5 py-1 text-xs',
    sm: 'px-3.5 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

// ─── Badge ───────────────────────────────────────────────────────────────────
interface BadgeProps { children: ReactNode; variant?: 'green'|'amber'|'red'|'blue'|'gray'|'purple'|'indigo'; dot?: boolean; className?: string }
export function Badge({ children, variant = 'gray', dot, className }: BadgeProps) {
  const variants = {
    green:  'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    amber:  'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    red:    'bg-red-50 text-red-700 ring-1 ring-red-200',
    blue:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    gray:   'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
    purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  }
  const dots = { green:'bg-emerald-500', amber:'bg-amber-500', red:'bg-red-500', blue:'bg-blue-500', gray:'bg-gray-400', purple:'bg-purple-500', indigo:'bg-indigo-500' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dots[variant])} />}
      {children}
    </span>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, className, hover }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={cn('bg-white rounded-2xl border border-gray-100 shadow-card', hover && 'hover:shadow-float hover:border-gray-200 transition-all duration-200 cursor-pointer', className)}>
      {children}
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} />
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-brand-600', className)} />
}

// ─── StatCard ────────────────────────────────────────────────────────────────
interface StatCardProps { label: string; value: number|string; sub?: string; icon?: ReactNode; trend?: number; color?: 'brand'|'green'|'amber'|'red'|'purple' }
export function StatCard({ label, value, sub, icon, trend, color = 'brand' }: StatCardProps) {
  const colors = {
    brand:  { bg: 'bg-brand-50',   text: 'text-brand-600',   ring: 'ring-brand-100' },
    green:  { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber:  { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100' },
    red:    { bg: 'bg-red-50',     text: 'text-red-600',     ring: 'ring-red-100' },
    purple: { bg: 'bg-purple-50',  text: 'text-purple-600',  ring: 'ring-purple-100' },
  }
  const c = colors[color]
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        {icon && (
          <div className={cn('p-2.5 rounded-xl ring-1', c.bg, c.text, c.ring)}>
            {icon}
          </div>
        )}
        {trend !== undefined && (
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </Card>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="text-gray-300 mb-4">{icon}</div>}
      <p className="text-base font-semibold text-gray-700">{title}</p>
      {description && <p className="mt-1.5 text-sm text-gray-400 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ─── Input ───────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; hint?: string }
export function Input({ label, error, hint, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <input
        className={cn(
          'w-full px-3.5 py-2.5 border rounded-xl text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400',
          error ? 'border-red-300 bg-red-50 focus:ring-red-400' : 'border-gray-200 bg-white hover:border-gray-300',
          className
        )}
        {...props}
      />
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}
    </div>
  )
}

// ─── Textarea ────────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; error?: string }
export function Textarea({ label, error, className, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <textarea
        className={cn(
          'w-full px-3.5 py-2.5 border rounded-xl text-sm resize-none transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400',
          error ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Select ──────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: string; hint?: string }
export function Select({ label, hint, children, className, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <select
        className={cn('w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all duration-150', className)}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, description, children, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; size?: 'sm'|'md'|'lg'
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={cn('relative bg-white rounded-2xl shadow-float w-full animate-slide-up', sizes[size])}>
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── Toast ───────────────────────────────────────────────────────────────────
type ToastType = 'success'|'error'|'warning'|'info'
interface Toast { id: string; type: ToastType; message: string }
let toastListeners: ((t: Toast) => void)[] = []

export function toast(type: ToastType, message: string) {
  const id = Math.random().toString(36).slice(2)
  toastListeners.forEach(fn => fn({ id, type, message }))
}
toast.success = (msg: string) => toast('success', msg)
toast.error   = (msg: string) => toast('error', msg)
toast.warning = (msg: string) => toast('warning', msg)
toast.info    = (msg: string) => toast('info', msg)

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const listener = (t: Toast) => {
      setToasts(prev => [...prev, t])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000)
    }
    toastListeners.push(listener)
    return () => { toastListeners = toastListeners.filter(fn => fn !== listener) }
  }, [])

  const icons = { success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, error: <XCircle className="w-4 h-4 text-red-500" />, warning: <AlertTriangle className="w-4 h-4 text-amber-500" />, info: <Info className="w-4 h-4 text-blue-500" /> }
  const styles = { success: 'border-emerald-100', error: 'border-red-100', warning: 'border-amber-100', info: 'border-blue-100' }

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn('flex items-center gap-3 px-4 py-3 bg-white rounded-xl shadow-float border animate-slide-up pointer-events-auto min-w-[280px] max-w-sm', styles[t.type])}>
          {icons[t.type]}
          <p className="text-sm font-medium text-gray-800 flex-1">{t.message}</p>
          <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ value, max, color = 'brand' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500', color === 'brand' ? 'bg-brand-600' : color === 'green' ? 'bg-emerald-500' : 'bg-amber-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm'|'md'|'lg' }) {
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-base' }
  const colors = ['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-indigo-500']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className={cn('rounded-full flex items-center justify-center text-white font-semibold shrink-0', sizes[size], color)}>
      {name[0]?.toUpperCase()}
    </div>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-gray-100" />
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 border-t border-gray-100" />
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  )
}

// ─── Status badges ────────────────────────────────────────────────────────────
export function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, BadgeProps['variant'], boolean]> = {
    queued:            ['Queued',           'gray',   false],
    parsing:           ['Parsing',          'indigo', true ],
    extracting:        ['Extracting',       'indigo', true ],
    llm_review:        ['LLM Review',       'purple', true ],
    ready_for_review:  ['Ready to Review',  'amber',  false],
    in_review:         ['In Review',        'amber',  true ],
    validated:         ['Validated',        'green',  false],
    submitted:         ['Submitted',        'green',  false],
    archived:          ['Archived',         'gray',   false],
    parse_failed:      ['Parse Failed',     'red',    false],
    extraction_failed: ['Extract Failed',   'red',    false],
    llm_failed:        ['LLM Failed',       'amber',  false],
    validation_failed: ['Validation Failed','red',    false],
    submission_failed: ['Submit Failed',    'red',    false],
  }
  const [label, variant, dot] = map[status] ?? [status, 'gray', false]
  return <Badge variant={variant} dot={dot}>{label}</Badge>
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const map: Record<string, BadgeProps['variant']> = { high: 'green', medium: 'amber', low: 'red', flagged: 'red' }
  return <Badge variant={map[confidence] ?? 'gray'}>{confidence}</Badge>
}

export function LLMVerdictBadge({ verdict, skipped }: { verdict?: string; skipped?: boolean }) {
  if (skipped) return <Badge variant="gray">Skipped</Badge>
  if (!verdict) return <Badge variant="gray">Pending</Badge>
  const map: Record<string, BadgeProps['variant']> = { PASS: 'green', REVIEW: 'amber', REJECT: 'red' }
  return <Badge variant={map[verdict] ?? 'gray'} dot>{verdict}</Badge>
}
