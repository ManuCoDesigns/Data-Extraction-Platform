import { useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { readNav, isTyping } from '@/lib/sourceNav'
import type { NavItem } from '@/lib/sourceNav'
import { cn } from '@/components/ui'

// "‹ 3 of 182 ›" for the source page. Shows only when you arrived from a list,
// and moves through that same list. Keys: [ = previous, ] = next.
export function SourceNav({ sourceId }: { sourceId: string }) {
  const navigate = useNavigate()
  const nav = useMemo(() => readNav(), [sourceId])
  const idx = nav ? nav.items.findIndex(i => i.id === sourceId) : -1
  const prev = nav && idx > 0 ? nav.items[idx - 1] : null
  const next = nav && idx >= 0 && idx < nav.items.length - 1 ? nav.items[idx + 1] : null

  useEffect(() => {
    const go = (i: NavItem) => navigate(`/projects/${i.project_id}/sources/${i.id}`)
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (e.key === '[' && prev) { e.preventDefault(); go(prev) }
      else if (e.key === ']' && next) { e.preventDefault(); go(next) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev?.id, next?.id, navigate])

  if (!nav || idx < 0 || nav.items.length < 2) return null

  const btn = (item: NavItem | null, dir: 'prev' | 'next') => (
    <button
      type="button" disabled={!item} aria-label={dir === 'prev' ? 'Previous source' : 'Next source'}
      title={item ? `${dir === 'prev' ? 'Previous' : 'Next'}: ${item.name}   (${dir === 'prev' ? '[' : ']'})` : dir === 'prev' ? 'This is the first source' : 'This is the last source'}
      onClick={() => item && navigate(`/projects/${item.project_id}/sources/${item.id}`)}
      className={cn('w-7 h-7 rounded-lg flex items-center justify-center border transition',
        item ? 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900' : 'border-transparent text-gray-300 cursor-not-allowed')}>
      {dir === 'prev' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    </button>
  )

  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <Link to={nav.backTo} className="font-medium hover:text-gray-800 transition">Back to {nav.label.toLowerCase()}</Link>
      <span className="h-4 w-px bg-gray-200" aria-hidden />
      <div className="flex items-center gap-1.5">
        {btn(prev, 'prev')}
        <span className="tabular-nums min-w-[76px] text-center text-gray-700 font-medium">{idx + 1} of {nav.items.length}</span>
        {btn(next, 'next')}
      </div>
      <span className="hidden md:inline text-gray-400">Press [ or ] to switch source</span>
    </div>
  )
}
