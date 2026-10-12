import { useEffect, useRef, useState } from 'react'
import { LogOut, Timer } from 'lucide-react'

const KEY = 'dx.lastActive'
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

interface Props { onTimeout: () => void; idleMinutes?: number; warnSeconds?: number }

/** Signs the person out after a long time with no activity, with a visible countdown first.
 *  Activity in another tab of the same browser counts, so working in two tabs never signs you out. */
export function IdleGuard({ onTimeout, idleMinutes = 30, warnSeconds = 120 }: Props) {
  const idleMs = idleMinutes * 60_000
  const last = useRef(Date.now())
  const [left, setLeft] = useState<number | null>(null)
  const warned = useRef(false)

  useEffect(() => {
    const touch = () => {
      if (warned.current) return          // once the countdown shows, only the button keeps you in
      const now = Date.now()
      if (now - last.current < 1000) return
      last.current = now
      try { localStorage.setItem(KEY, String(now)) } catch { /* ignore */ }
    }
    EVENTS.forEach(e => window.addEventListener(e, touch, { passive: true }))
    const tick = setInterval(() => {
      let stamp = last.current
      try { stamp = Math.max(stamp, Number(localStorage.getItem(KEY)) || 0) } catch { /* ignore */ }
      if (!warned.current) last.current = stamp
      const idle = Date.now() - stamp
      if (idle >= idleMs) { clearInterval(tick); onTimeout(); return }
      if (idle >= idleMs - warnSeconds * 1000) { warned.current = true; setLeft(Math.ceil((idleMs - idle) / 1000)) }
      else if (warned.current) { warned.current = false; setLeft(null) }
    }, 1000)
    return () => { EVENTS.forEach(e => window.removeEventListener(e, touch)); clearInterval(tick) }
  }, [idleMs, warnSeconds, onTimeout])

  const stay = () => {
    const now = Date.now()
    last.current = now
    try { localStorage.setItem(KEY, String(now)) } catch { /* ignore */ }
    warned.current = false
    setLeft(null)
  }
  if (left === null) return null
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0')
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="You are about to be signed out"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-float max-w-sm w-full p-6 text-center animate-slide-up">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3"><Timer className="w-6 h-6" /></div>
        <h2 className="text-base font-bold text-gray-900 m-0">Still there?</h2>
        <p className="text-sm text-gray-500 mt-1.5 mb-0">For your security you will be signed out in</p>
        <p className="text-3xl font-extrabold tabular-nums text-gray-900 my-3">{mm}:{ss}</p>
        <div className="flex gap-2 justify-center">
          <button type="button" onClick={onTimeout} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><LogOut className="w-4 h-4" /> Sign out now</button>
          <button type="button" autoFocus onClick={stay} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-brand-500 to-brand-700 hover:opacity-95 transition">Stay signed in</button>
        </div>
      </div>
    </div>
  )
}
