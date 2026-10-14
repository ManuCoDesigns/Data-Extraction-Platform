import { Link } from 'react-router-dom'
import { Chip, Panel, Tile, type Tone } from '@/components/enh/kit'

export type Signal = { kind: string; severity?: string; text?: string; by?: string }
export const SIGNAL_LABEL: Record<string, { label: string; tone: Tone }> = {
  comment: { label: 'Peer comment', tone: 'red' }, mention: { label: 'Peer mentioned', tone: 'red' }, finding: { label: 'Error logged', tone: 'amber' },
  sop: { label: 'SOP', tone: 'indigo' }, system: { label: 'System check', tone: 'blue' }, ai: { label: 'AI or web flag', tone: 'purple' }, note: { label: 'Admin note', tone: 'indigo' },
}
const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`)

/** Quality signals for one source, shown on the source page itself. `data` comes from GET /quality/sources/{id}/signals. */
export function SourceQuality({ data, isLead, sourceId, projectId, onOpenRecord }: { data: any; isLead: boolean; sourceId: string; projectId: string; onOpenRecord?: (recordId: string) => void }) {
  if (!data || !data.records) return null
  const t = data.totals
  const tone = (v: number | null): Tone => (v === null ? 'gray' : v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red')
  const rows = (data.records as any[]).filter(r => r.fields.some((f: any) => f.signals.length)).slice(0, 5)
  return (
    <Panel title="Quality check" subtitle={isLead ? 'What the system and the peer reviewers doubt in this source, before you check it against the real site.' : 'Fields the automatic checks doubt. Look at these first.'}
      actions={isLead ? <Link to={`/quality?source=${sourceId}&project=${projectId}`} className="text-sm font-semibold text-brand-600 hover:underline">Open the review desk</Link> : undefined}>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Follow the SOP" value={pc(data.sop_rate)} tone={tone(data.sop_rate)} hint={data.sop_code ? `Required fields in ${data.sop_code}` : 'No SOP saved for this source'} />
        <Tile label="Fields doubted" value={t.flagged} tone={t.flagged ? 'amber' : 'green'} hint={`of ${t.fields} filled`} />
        {isLead ? <Tile label="Peer pointers" value={t.comments + t.mentions} tone={t.comments + t.mentions ? 'red' : 'gray'} hint="Comments and mentions" /> : <Tile label="Records" value={data.records.length} hint="In this source" />}
        {isLead ? <Tile label="Checked at source" value={t.audited} tone="blue" hint="Fields settled by an admin" /> : <Tile label="Needing a look" value={rows.length} tone={rows.length ? 'amber' : 'green'} hint="Records with doubted fields" />}
      </div>
      {rows.length > 0 && (
        <ul className="m-0 mt-4 p-0 list-none divide-y divide-gray-50">
          {rows.map(r => {
            const hot = r.fields.filter((f: any) => f.signals.length)
            return (
              <li key={r.record_id} className="py-2 flex items-center gap-2 flex-wrap text-sm">
                {onOpenRecord ? <button type="button" onClick={() => onOpenRecord(r.record_id)} className="font-semibold text-gray-900 hover:underline">{r.record}</button> : <span className="font-semibold text-gray-900">{r.record}</span>}
                {hot.slice(0, 5).map((f: any) => <Chip key={f.name} tone={SIGNAL_LABEL[f.signals[0].kind]?.tone ?? 'gray'} title={f.signals.map((s: Signal) => SIGNAL_LABEL[s.kind]?.label).join(', ')}>{f.name}</Chip>)}
                {hot.length > 5 && <span className="text-xs text-gray-400">+{hot.length - 5} more</span>}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
