import { useEffect, useState } from 'react'

/** Whether the server is currently unreachable. api/client.ts flips this; the banner reads it. */
let down = typeof navigator !== 'undefined' ? navigator.onLine === false : false
const listeners = new Set<(v: boolean) => void>()

export function setServerDown(v: boolean) {
  if (v === down) return
  down = v
  listeners.forEach(fn => fn(v))
}

export function useServerDown(): boolean {
  const [v, setV] = useState(down)
  useEffect(() => {
    listeners.add(setV)
    const off = () => setServerDown(true)
    const on = () => setServerDown(false)
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    setV(down)
    return () => { listeners.delete(setV); window.removeEventListener('offline', off); window.removeEventListener('online', on) }
  }, [])
  return v
}
