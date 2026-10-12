const KEY = 'dep_recent_sources'
export interface Visit { pid: string; sid: string }

export function getRecent(): Visit[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x?.pid && x?.sid).slice(0, 8) : [] } catch { return [] }
}

/** Remember the last few sources someone opened, newest first. Kept on this device only. */
export function recordVisit(pathname: string) {
  const m = pathname.match(/^\/projects\/([^/]+)\/sources\/([^/]+)/)
  if (!m) return
  try {
    const rest = getRecent().filter(v => v.sid !== m[2])
    localStorage.setItem(KEY, JSON.stringify([{ pid: m[1], sid: m[2] }, ...rest].slice(0, 8)))
  } catch { /* storage blocked */ }
}
