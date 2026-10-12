import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Notification } from '@/types'
import { cn } from '@/components/ui'
import { byImportance, isAction, noticeMeta } from '@/lib/notices'

interface Props {
  items: Notification[]            // unread notices
  total: number                    // how many unread there are in all (items may be a recent slice)
  onOpen: (n: Notification) => void
  onAck: (n: Notification) => void
  onAckAll: () => void
  onViewAll: () => void
}

// A banner across the top of every page for as long as something unread is waiting. It cannot be
// closed, only acknowledged ("Got it"), so a notice is never missed just because the bell was not
// opened. Notices that need action are red and listed first. With several waiting, it rotates
// through them (paused while the pointer or keyboard is on it).
export function NotificationBanner({ items, total, onOpen, onAck, onAckAll, onViewAll }: Props) {
  const sorted = useMemo(() => [...items].sort(byImportance), [items])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [flash, setFlash] = useState(false)
  const seen = useRef<Set<string> | null>(null)

  // A notice that arrives while the page is open gets a short attention animation.
  useEffect(() => {
    const ids = new Set(sorted.map(n => n.id))
    if (seen.current && [...ids].some(id => !seen.current!.has(id))) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1800)
      seen.current = ids
      return () => clearTimeout(t)
    }
    seen.current = ids
  }, [sorted])

  const idx = Math.max(0, sorted.findIndex(n => n.id === currentId))
  const cur = sorted[idx]

  useEffect(() => {
    if (sorted.length < 2 || paused) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setCurrentId(sorted[(idx + 1) % sorted.length].id), 8000)
    return () => clearInterval(t)
  }, [sorted, idx, paused])

  if (!cur) return null
  const urgent = isAction(cur)
  const actionCount = sorted.filter(isAction).length
  const shownTotal = Math.max(total, sorted.length)
  const { label, Icon } = noticeMeta(cur)
  const headline = actionCount > 0
    ? `${actionCount} ${actionCount === 1 ? 'update needs' : 'updates need'} your attention`
    : `${shownTotal} new ${shownTotal === 1 ? 'update' : 'updates'}`
  const go = (d: number) => setCurrentId(sorted[(idx + d + sorted.length) % sorted.length].id)

  return (
    <div role="alert" aria-live="assertive" data-banner
      className="sticky top-14 md:top-0 z-40"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <style>{`@keyframes nb-in{0%{transform:translateY(-8px);opacity:.6}100%{transform:none;opacity:1}}
@keyframes nb-flash{0%,100%{filter:none}25%,75%{filter:brightness(1.35)}50%{filter:brightness(1)}}
@media (prefers-reduced-motion: reduce){.nb-anim{animation:none!important}}`}</style>
      <div className={cn('nb-anim flex items-center gap-3 px-4 sm:px-6 py-3 text-white shadow-lg',
        urgent ? 'bg-gradient-to-r from-red-600 via-red-600 to-orange-500' : 'bg-gradient-to-r from-indigo-600 to-brand-600')}
        style={{ animation: flash ? 'nb-flash .6s ease 3' : 'nb-in .3s ease-out' }}>
        <span className="relative flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-white/20">
          {urgent && <span className="absolute inset-0 rounded-full bg-white/30 motion-safe:animate-ping" aria-hidden />}
          <Icon className="relative w-4 h-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11px] font-semibold opacity-90 truncate">{headline}<span className="opacity-75"> &middot; {label}</span></p>
          <p className="m-0 text-sm font-bold truncate">{cur.title}</p>
          {cur.body && <p className="m-0 text-xs opacity-90 truncate">{cur.body}</p>}
        </div>

        {sorted.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => go(-1)} aria-label="Previous update" className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs tabular-nums font-semibold min-w-[34px] text-center">{idx + 1} / {sorted.length}</span>
            <button type="button" onClick={() => go(1)} aria-label="Next update" className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {cur.link && (
            <button type="button" onClick={() => onOpen(cur)}
              className="px-3.5 py-2 rounded-lg bg-white text-gray-900 text-xs font-bold hover:bg-white/90 transition">Open</button>
          )}
          <button type="button" onClick={() => onAck(cur)}
            className="px-3.5 py-2 rounded-lg bg-black/25 hover:bg-black/35 text-xs font-bold transition">Got it</button>
        </div>
      </div>
      {(sorted.length > 1 || shownTotal > sorted.length) && (
        <div className="bg-gray-900/90 text-white/90 text-[11px] px-4 sm:px-6 py-1 flex items-center gap-3">
          <button type="button" onClick={onViewAll} className="font-semibold hover:underline">View all {shownTotal}</button>
          <button type="button" onClick={onAckAll} className="font-semibold hover:underline">Mark all as seen</button>
        </div>
      )}
    </div>
  )
}
