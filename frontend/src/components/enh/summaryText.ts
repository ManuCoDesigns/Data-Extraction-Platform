/** Plain-text progress summary for pasting into Slack or email. No markdown, so nothing shows stray symbols. */
export interface SummaryInput {
  scope: string
  days: number
  withNames: boolean
  stages: { label: string; count: number }[]
  totals: Record<string, number>
  projects: { name: string; sources: number; delivered: number; records: number; approved: number }[]
  stuck: { name: string; project: string; days: number }[]
  people: { name: string; extracting: number; waiting: number; delivered: number }[]
  now?: Date
}

const rec = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`

export function buildSummary(i: SummaryInput): string {
  const t = i.totals
  const date = (i.now ?? new Date()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const sentPct = t.records ? Math.round((100 * t.records_sent_back) / t.records) : 0
  const peerPct = t.peers_total ? Math.round((100 * t.peers_done) / t.peers_total) : 0
  const out: string[] = []
  out.push(`Progress summary: ${i.scope}`)
  out.push(`${date}, activity from the last ${i.days} days`)
  out.push('')
  out.push(`Sources: ${t.sources} in total, ${t.delivered} delivered (${t.percent}%)`)
  for (const s of i.stages) out.push(`• ${s.label}: ${s.count}`)
  out.push('')
  out.push(`Records: ${t.records} extracted, ${t.records_approved} approved, ${t.records_sent_back} sent back for fixes (${sentPct}%)`)
  out.push(`Peer reviews: ${t.peers_done} of ${t.peers_total} submitted${t.peers_total ? ` (${peerPct}%)` : ''}`)
  out.push(`Sent to the client: ${t.submitted_to_client ?? 0}`)
  out.push(`Waiting 7+ days: ${t.stuck}`)
  if (i.stuck.length) {
    out.push('')
    out.push('Waiting longest:')
    for (const s of i.stuck.slice(0, 5)) out.push(`• ${s.name} (${s.project}), ${s.days} days`)
    if (i.stuck.length > 5) out.push(`• and ${i.stuck.length - 5} more`)
  }
  if (i.projects.length > 1) {
    out.push('')
    out.push('By project:')
    for (const p of i.projects) out.push(`• ${p.name}: ${p.delivered} of ${p.sources} delivered, ${rec(p.records)} extracted, ${p.approved} approved`)
  }
  if (i.withNames && i.people.length) {
    out.push('')
    out.push('Who has what:')
    for (const p of i.people) out.push(`• ${p.name}: extracting ${p.extracting}, peer reviews waiting ${p.waiting}, delivered ${p.delivered}`)
  }
  return out.join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch { return false }
}
