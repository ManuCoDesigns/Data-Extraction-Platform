import { useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, Skeletons, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 10) / 10}%`)
const tone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red')

/** The whole process on one panel: the cumulative total across every source, then one row per source (batch). */
export function ProcessReport({ sourceId, projectId, from, to }: { sourceId: string; projectId: string; from?: string; to?: string }) {
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const filt = { source_id: sourceId || undefined, project_id: projectId || undefined, date_from: from || undefined, date_to: to || undefined }
  useEffect(() => { setD(null); qualityApi.processReport(filt).then(setD).catch(() => setD({ error: true })) }, [sourceId, projectId, from, to])  // eslint-disable-line react-hooks/exhaustive-deps
  const download = async () => { setBusy(true); try { await qualityApi.exportProcessReport(filt) } catch (e: any) { toast.error(e?.response?.data?.detail || 'Nothing to download yet') } finally { setBusy(false) } }
  const th = 'font-semibold py-1 pr-3 whitespace-nowrap'
  const c = d?.cumulative
  return (
    <Panel title="Process report" subtitle="Each source is one batch. The cumulative row adds them all up, using the same counts. Every error is counted once."
      actions={<Button variant="secondary" disabled={busy || !d?.batches?.length} onClick={download}>{busy ? 'Preparing…' : 'Download Excel'}</Button>}>
      {!d ? <Skeletons rows={3} /> : d.error ? <Blank title="Couldn't load the report" /> : d.batches.length === 0 ? <Blank title="Nothing to report yet" text="Sources show here once they are past extraction." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500">
              <th className={th}>Batch (source)</th><th className={th}>Extractor</th><th className={th}>Fields</th><th className={th}>Errors</th><th className={th}>Per 100</th><th className={th}>First pass</th><th className={th}>Final</th><th className={th}>Caught</th><th className={th}>Rework</th>
            </tr></thead>
            <tbody>
              <tr className="border-t border-gray-100 bg-gray-50 font-semibold">
                <td className="py-1.5 pr-3 text-gray-900">All sources ({c.sources})</td><td className="pr-3 text-gray-400">–</td><td className="pr-3 tabular-nums">{c.fields}</td><td className="pr-3 tabular-nums">{c.errors}</td><td className="pr-3 tabular-nums">{c.errors_per_100 ?? '–'}</td>
                <td className="pr-3"><Chip tone={tone(c.first_pass_accuracy)}>{pc(c.first_pass_accuracy)}</Chip></td><td className="pr-3"><Chip tone={tone(c.final_accuracy)}>{pc(c.final_accuracy)}</Chip></td>
                <td className="pr-3"><Chip tone={tone(c.caught_rate)}>{pc(c.caught_rate)}</Chip></td><td className="pr-3 tabular-nums">{pc(c.rework_rate)}</td>
              </tr>
              {d.batches.map((b: any) => (
                <tr key={b.source_id} className="border-t border-gray-50">
                  <td className="py-1.5 pr-3 text-gray-900 max-w-[28ch] truncate" title={b.source}>{b.source}{b.confidence === 'low' && <span className="ml-1 text-[11px] text-gray-400" title="Fewer than 30 fields checked">early</span>}</td>
                  <td className="pr-3 text-gray-600">{b.extractor || '–'}</td><td className="pr-3 tabular-nums">{b.fields}</td><td className="pr-3 tabular-nums">{b.errors}</td><td className="pr-3 tabular-nums">{b.errors_per_100 ?? '–'}</td>
                  <td className="pr-3"><Chip tone={tone(b.first_pass_accuracy)}>{pc(b.first_pass_accuracy)}</Chip></td><td className="pr-3"><Chip tone={tone(b.final_accuracy)}>{pc(b.final_accuracy)}</Chip></td>
                  <td className="pr-3"><Chip tone={tone(b.caught_rate)}>{pc(b.caught_rate)}</Chip></td><td className="pr-3 tabular-nums">{pc(b.rework_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-2 mb-0">First pass: right before any rework. Final: right now. Caught: errors a peer reviewer pointed at, out of all known errors. "early" means fewer than 30 fields checked.</p>
        </div>
      )}
    </Panel>
  )
}
