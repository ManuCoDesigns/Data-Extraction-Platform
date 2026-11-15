/** Plain-text progress summary for pasting into Slack or email. No markdown, so nothing shows stray symbols. */
export interface SummaryInput {
  scope: string
  days: number
  withNames: boolean
  stages: { label: string; count: number }[]
  totals: Record<string, number>
  projects: { name: string; sources: number; delivered: number; records: number; approved: number }[]
  stuck: { name: string; project: string; days: number }[]
  people: { name: string; extracting: number; waiting: number; delivered: number; sentBack?: number }[]
  /** Sums of the activity series over the chosen period. */
  activity?: { extracted: number; peers: number; sentBack: number; delivered: number }
  /** Every source not yet delivered, so the reader sees which ones are behind the stage counts. */
  sources?: { name: string; extractor: string | null; stage: string; peersDone: number; peersTotal: number; records: number; sentBack: number; toFix?: number; days: number | null }[]
  now?: Date
}

// Some accounts are stored in capitals (SARAH IRUSH); show them as names.
const nice = (n: string) => (n && n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : n)
const rec = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`

export function buildSummary(i: SummaryInput): string {
  const t = i.totals
  const date = (i.now ?? new Date()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const sentPct = t.records ? Math.round((100 * t.records_sent_back) / t.records) : 0
  const peerPct = t.peers_total ? Math.round((100 * t.peers_done) / t.peers_total) : 0
  const out: string[] = []
  out.push(`Progress summary: ${i.scope}`)
  out.push(`Status as of ${date}`)
  out.push('')
  out.push(`Sources: ${t.sources} in total, ${t.delivered} delivered (${t.percent}%)`)
  for (const s of i.stages) out.push(`• ${s.label}: ${s.count}`)
  out.push('')
  const open = t.records_to_fix
  out.push(`Records: ${t.records} extracted, ${t.records_approved} approved, ${t.records_sent_back} sent back for fixes (${sentPct}%)` + (open != null && t.records_sent_back ? `, ${open} still to fix` : ''))
  out.push(`Peer reviews: ${t.peers_done} of ${t.peers_total} submitted${t.peers_total ? ` (${peerPct}%)` : ''}`)
  out.push(`Sent to the client: ${t.submitted_to_client ?? 0}`)
  out.push(`Waiting 7+ days without an update: ${t.stuck}`)
  if (i.activity) {
    const a = i.activity
    out.push('')
    out.push(`Last ${i.days} days: ${a.extracted} records extracted, ${a.peers} peer reviews submitted, ${a.sentBack} records sent back, ${a.delivered} ${a.delivered === 1 ? 'source' : 'sources'} delivered`)
  }
  if (i.sources && i.sources.length) {
    out.push('')
    out.push('Sources still open:')
    for (const s of i.sources.slice(0, 12)) {
      const bits = [s.stage]
      if (s.extractor) bits.push(`extractor ${nice(s.extractor)}`)
      if (s.peersTotal) bits.push(`peer reviews ${s.peersDone} of ${s.peersTotal}`)
      bits.push(s.records ? rec(s.records) + (s.sentBack ? `, ${s.sentBack} sent back${s.toFix != null ? ` (${s.toFix} still to fix)` : ''}` : '') : 'no records')
      if (s.stage === 'needs fixes' && s.sentBack && s.toFix === 0) bits.push('fixes done, not yet sent back to the reviewers')
      out.push(`• ${s.name}: ${bits.join(', ')}`)
    }
    if (i.sources.length > 12) out.push(`• and ${i.sources.length - 12} more`)
  }
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
    for (const p of i.people) out.push(`• ${nice(p.name)}: ${p.extracting} ${p.extracting === 1 ? 'source' : 'sources'} open, ${p.waiting} peer ${p.waiting === 1 ? 'review' : 'reviews'} waiting, ${p.delivered} delivered`)
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
