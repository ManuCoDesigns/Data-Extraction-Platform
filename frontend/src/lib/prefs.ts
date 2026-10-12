import { create } from 'zustand'
import { enhApi } from '@/api/client'

export type Prefs = { timezone: string; date_format: 'DMY' | 'MDY' | 'YMD'; time_format: '12h' | '24h' }
const DEFAULTS: Prefs = { timezone: 'Africa/Nairobi', date_format: 'DMY', time_format: '24h' }
const KEY = 'display_prefs'

function cached(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULTS }
}

interface PrefsState {
  prefs: Prefs
  load: () => Promise<void>
  save: (patch: Partial<Prefs>) => Promise<void>
}

/** Display choices (timezone, date and time format). Saved on the server, cached here so pages render at once. */
export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: cached(),
  load: async () => {
    try {
      const s = await enhApi.settings()
      const p = { ...DEFAULTS, ...(s.prefs || {}) }
      localStorage.setItem(KEY, JSON.stringify(p)); set({ prefs: p })
    } catch { /* keep the cached copy */ }
  },
  save: async patch => {
    const s = await enhApi.saveSettings({ prefs: patch } as any)
    const p = { ...DEFAULTS, ...(s.prefs || {}) }
    try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* ignore */ }
    set({ prefs: p })
  },
}))

function asDate(v: any): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function parts(d: Date, p: Prefs, opts: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {}
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, ...opts }).formatToParts(d).forEach(x => { out[x.type] = x.value })
  } catch {
    new Intl.DateTimeFormat('en-GB', opts).formatToParts(d).forEach(x => { out[x.type] = x.value })
  }
  return out
}

export function fmtDate(v: any, p: Prefs = usePrefs.getState().prefs): string {
  const d = asDate(v); if (!d) return '—'
  const x = parts(d, p, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return p.date_format === 'MDY' ? `${x.month}/${x.day}/${x.year}` : p.date_format === 'YMD' ? `${x.year}-${x.month}-${x.day}` : `${x.day}/${x.month}/${x.year}`
}

export function fmtTime(v: any, p: Prefs = usePrefs.getState().prefs): string {
  const d = asDate(v); if (!d) return ''
  const x = parts(d, p, { hour: '2-digit', minute: '2-digit', hour12: p.time_format === '12h' })
  return p.time_format === '12h' ? `${x.hour}:${x.minute} ${(x.dayPeriod || '').toLowerCase()}`.trim() : `${x.hour}:${x.minute}`
}

export function fmtDateTime(v: any, p: Prefs = usePrefs.getState().prefs): string {
  const d = asDate(v); if (!d) return '—'
  return `${fmtDate(d, p)} ${fmtTime(d, p)}`
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Africa/Nairobi', label: 'Nairobi (EAT, UTC+3)' },
  { value: 'Africa/Lagos', label: 'Lagos (WAT, UTC+1)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST, UTC+2)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin / Central Europe' },
  { value: 'Asia/Dubai', label: 'Dubai (UTC+4)' },
  { value: 'Asia/Kolkata', label: 'India (UTC+5:30)' },
  { value: 'Asia/Dhaka', label: 'Dhaka (UTC+6)' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
]
