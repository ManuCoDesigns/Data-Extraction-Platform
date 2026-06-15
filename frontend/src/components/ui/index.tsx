import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}

// ─── Button ───────────────────────────────────────────────────────────────────
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary', size = 'md', loading, children, className, disabled, ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-brand-500',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
interface BadgeProps { children: ReactNode; variant?: 'green' | 'amber' | 'red' | 'blue' | 'gray'; className?: string }

export function Badge({ children, variant = 'gray', className }: BadgeProps) {
  const variants = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
    gray: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 shadow-sm', className)}>
      {children}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-brand-600', className)} />
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
interface StatCardProps { label: string; value: number | string; sub?: string; icon?: ReactNode; color?: string }

export function StatCard({ label, value, sub, icon, color = 'brand' }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
          {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2 rounded-lg bg-${color}-50 text-${color}-600`}>{icon}</div>
        )}
      </div>
    </Card>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-lg font-medium text-gray-700">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string }

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <input
        className={cn(
          'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition',
          error ? 'border-red-400 focus:ring-red-400' : 'border-gray-300',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: string; children: ReactNode }

export function Select({ label, children, className, ...props }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <select
        className={cn('w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500', className)}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  )
}

// ─── Job status badge ─────────────────────────────────────────────────────────
export function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, 'green' | 'amber' | 'red' | 'blue' | 'gray']> = {
    queued: ['Queued', 'gray'],
    parsing: ['Parsing', 'blue'],
    extracting: ['Extracting', 'blue'],
    llm_review: ['LLM Review', 'blue'],
    ready_for_review: ['Ready', 'amber'],
    in_review: ['In Review', 'amber'],
    validated: ['Validated', 'green'],
    submitted: ['Submitted', 'green'],
    archived: ['Archived', 'gray'],
    parse_failed: ['Parse Failed', 'red'],
    extraction_failed: ['Extract Failed', 'red'],
    llm_failed: ['LLM Failed', 'amber'],
    validation_failed: ['Validation Failed', 'red'],
    submission_failed: ['Submit Failed', 'red'],
  }
  const [label, variant] = map[status] ?? [status, 'gray']
  return <Badge variant={variant}>{label}</Badge>
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const map: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
    high: 'green', medium: 'amber', low: 'red', flagged: 'red',
  }
  return <Badge variant={map[confidence] ?? 'gray'}>{confidence}</Badge>
}

// ─── LLM verdict badge ────────────────────────────────────────────────────────
export function LLMVerdictBadge({ verdict, skipped }: { verdict?: string; skipped?: boolean }) {
  if (skipped) return <Badge variant="gray">LLM Skipped</Badge>
  if (!verdict) return <Badge variant="gray">Pending</Badge>
  const map: Record<string, 'green' | 'amber' | 'red'> = { PASS: 'green', REVIEW: 'amber', REJECT: 'red' }
  return <Badge variant={map[verdict] ?? 'gray'}>{verdict}</Badge>
}
