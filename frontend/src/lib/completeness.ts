// How complete a record is, measured against the fields the schema marks as required.
export interface SchemaFieldLite { name: string; required?: boolean; fixed_value?: unknown; description?: string }

export const isFilled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== '' && !/^(n\/a|none|null|unknown|-)$/i.test(v.trim())
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

export function requiredOf(fields: SchemaFieldLite[] | undefined): SchemaFieldLite[] {
  return (fields ?? []).filter(f => f.required && f.fixed_value === undefined)
}

export function completeness(fields: SchemaFieldLite[] | undefined, data: Record<string, unknown> | undefined) {
  const req = requiredOf(fields)
  const d = data ?? {}
  const missing = req.filter(f => !isFilled(d[f.name])).map(f => f.name)
  return { total: req.length, filled: req.length - missing.length, missing }
}

/** Across many records: share of required cells filled, how many records are complete, and the fields most often empty. */
export function sourceCompleteness(fields: SchemaFieldLite[] | undefined, records: { extracted_fields?: Record<string, unknown>; is_escalation_only?: boolean }[]) {
  const req = requiredOf(fields)
  const real = records.filter(r => !r.is_escalation_only)
  if (!req.length || !real.length) return null
  const gaps: Record<string, number> = {}
  let filled = 0, complete = 0
  for (const r of real) {
    const c = completeness(fields, r.extracted_fields)
    filled += c.filled
    if (!c.missing.length) complete++
    c.missing.forEach(m => { gaps[m] = (gaps[m] ?? 0) + 1 })
  }
  const total = req.length * real.length
  return {
    pct: Math.round((filled / total) * 100), records: real.length, complete, incomplete: real.length - complete,
    top: Object.entries(gaps).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n })),
  }
}
