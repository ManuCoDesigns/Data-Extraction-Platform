/**
 * What to mark in the source text when a field is clicked. The value alone is not always what is written there: a country code
 * is spelled out, a web address loses its https://, a date is written in words, a list is several separate values, and a long
 * description may be quoted only in part. Yes/no flags and empty values are not written anywhere, so they have no text to match.
 */
const REGION = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }) } catch { return null } })()

function leaves(v: unknown, out: string[] = [], depth = 0): string[] {
  if (v == null || depth > 3 || out.length >= 24) return out
  if (Array.isArray(v)) { v.forEach(x => leaves(x, out, depth + 1)); return out }
  if (typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(x => leaves(x, out, depth + 1)); return out }
  if (typeof v === 'boolean') return out
  out.push(String(v))
  return out
}

export function highlightTerms(value: unknown, field = ''): string[] {
  const terms: string[] = []
  const add = (s: string) => { const t = s.trim(); if (t.length >= 3 && !terms.includes(t)) terms.push(t) }
  for (const raw of leaves(value)) {
    const s = raw.trim()
    if (!s) continue
    add(s)
    if (/^[A-Z]{2}$/.test(s) && /country|region|nation/i.test(field)) { try { const n = REGION?.of(s); if (n && n !== s) add(n) } catch { /* ignore */ } }
    if (/^https?:\/\//i.test(s)) add(s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, ''))
    const d = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/)
    if (d) {
      add(`${d[1]}-${d[2]}-${d[3]}`)
      try {
        const dt = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]))
        add(dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }))
        add(dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))
      } catch { /* ignore */ }
    }
    if (/^-?\d+(\.\d+)?$/.test(s) && Math.abs(Number(s)) >= 1000) add(Number(s).toLocaleString('en-US'))
    if (s.length > 90) add(s.slice(0, 60).replace(/\s+\S*$/, '')) // a long description is often quoted only from its start
  }
  return terms
}

const SAME: Record<string, string> = { "'": "['’‘]", '’': "['’‘]", '‘': "['’‘]", '"': '["“”]', '“': '["“”]', '”': '["“”]', '-': '[-–—]', '–': '[-–—]', '—': '[-–—]', '&': '&(?:amp;)?' }

/** A pattern (no capture group) that matches any term, ignoring case, spacing, curly quotes, dash kinds and &amp;. */
export function termsPattern(terms: string[]): string {
  return [...terms].sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+').replace(/['’‘"“”\-–—&]/g, c => SAME[c]))
    .join('|')
}

/** Why a field has nothing to mark, in words for the reader. */
export function noTextReason(value: unknown): string {
  if (typeof value === 'boolean') return `${value ? 'Yes' : 'No'} is a yes/no flag. It is decided from the page, not written on it.`
  if (value == null || (typeof value === 'string' && !value.trim())) return 'This field is empty, so there is nothing to find.'
  return 'This value is too short to search for without marking unrelated words.'
}
