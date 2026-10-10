import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
  tone?: 'default' | 'warn' | 'danger'
  loading?: boolean
  hidden?: boolean
  // Draw a thin line above this item (used to set destructive actions apart).
  divider?: boolean
}

const TONE: Record<string, string> = {
  default: 'text-gray-700 hover:bg-gray-50',
  warn: 'text-amber-700 hover:bg-amber-50',
  danger: 'text-red-600 hover:bg-red-50',
}

// A "More ⋯" dropdown for the less-used and destructive actions, so the
// header keeps only the buttons people use every day.
export function ActionMenu({ items, label = 'More' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const visible = items.filter(i => !i.hidden)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (visible.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition">
        <MoreHorizontal className="w-4 h-4" /> {label}
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-gray-100 bg-white shadow-lg py-1.5 z-30">
          {visible.map(i => (
            <div key={i.key}>
              {i.divider && <div className="my-1 border-t border-gray-100" />}
              <button type="button" role="menuitem" disabled={i.loading}
                onClick={() => { setOpen(false); i.onClick() }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium disabled:opacity-50 transition ${TONE[i.tone ?? 'default']}`}>
                <span className="w-4 h-4 shrink-0 inline-flex items-center justify-center">{i.icon}</span>
                {i.loading ? `${i.label}…` : i.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
