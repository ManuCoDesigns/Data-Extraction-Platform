import { Fragment, useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, Skeletons, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 10) / 10}%`)
const tone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'gray' : v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red')
const th = 'font-semibold py-1 pr-3 whitespace-nowrap'

function Rates({ r }: { r: any }) {
  return (
    <>
      <td className="pr-3 tabular-nums">{r.fields}</td><td className="pr-3 tabular-nums">{r.errors}</td><td className="pr-3 tabular-nums">{r.errors_per_100 ?? '–'}</td>
      <td className="pr-3"><Chip tone={tone(r.first_pass_accuracy)}>{pc(r.first_pass_accuracy)}</Chip></td><td className="pr-3"><Chip tone={tone(r.final_accuracy)}>{pc(r.final_accuracy)}</Chip></td>
      <td className="pr-3"><Chip tone={tone(r.caught_rate)}>{pc(r.caught_rate)}</Chip></td><td className="pr-3 tabular-nums">{pc(r.rework_rate)}</td>
    </>
  )
}

/** The whole process: one row per batch (the sources Xtrium gave on one day), the running total up to each batch, and the total across all of them. */
export function ProcessReport({ sourceId, projectId, from, to }: { sourceId: string; projectId: string; from?: string; to?: string }) {
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState('')
  const filt = { source_id: sourceId || undefined, project_id: projectId || undefined, date_from: from || undefined, date_to: to || undefined }
  useEffect(() => { setD(null); qualityApi.processReport(filt).then(setD).catch(() => setD({ error: true })) }, [sourceId, projectId, from, to])  // eslint-disable-line react-hooks/exhaustive-deps
  const download = async () => { setBusy(true); try { await qualityApi.exportProcessReport(filt) } catch (e: any) { toast.error(e?.response?.data?.detail || 'Nothing to download yet') } finally { setBusy(false) } }
  const c = d?.cumulative
  const pulls: any[] = d?.pulls ?? []
  return (
    <Panel title="Process report" subtitle="One row per batch: the sources pulled from Xtrium on the same day. Open a batch to see its sources, extractors and reviewers. Every error is counted once."
      actions={<Button variant="secondary" disabled={busy || !d?.batches?.length} onClick={download}>{busy ? 'Preparing…' : 'Download Excel'}</Button>}>
      {!d ? <Skeletons rows={3} /> : d.error ? <Blank title="Couldn't load the report" /> : d.batches.length === 0 ? <Blank title="Nothing to report yet" text="Sources show here once they are past extraction." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500">
              <th className={th}>Batch</th><th className={th}>Sources</th><th className={th}>Fields</th><th className={th}>Errors</th><th className={th}>Per 100</th><th className={th}>First pass</th><th className={th}>Final</th><th className={th}>Caught</th><th className={th}>Rework</th><th className={th} title="Final accuracy and catch rate across this batch and every earlier one">Total so far</th>
            </tr></thead>
            <tbody>
              {pulls.map((b: any) => (
                <Fragment key={b.key}>
                  <tr className="border-t border-gray-50 cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === b.key ? '' : b.key)}>
                    <td className="py-1.5 pr-3 text-gray-900 whitespace-nowrap"><span aria-hidden className="text-gray-400 mr-1">{open === b.key ? '▾' : '▸'}</span>{b.label}{b.confidence === 'low' && <span className="ml-1 text-[11px] text-gray-400" title="Fewer than 30 fields checked">early</span>}</td>
                    <td className="pr-3 tabular-nums">{b.sources}</td><Rates r={b} />
                    <td className="pr-3 whitespace-nowrap text-xs text-gray-600">{pc(b.cumulative.final_accuracy)} acc · {pc(b.cumulative.caught_rate)} caught</td>
                  </tr>
                  {open === b.key && (
                    <tr><td colSpan={10} className="bg-gray-50/60 px-3 py-3">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <div><p className="text-[11px] font-bold text-gray-500 m-0 mb-1">Sources</p>
                          <ul className="m-0 p-0 list-none space-y-1 text-xs">{b.sources_rows.map((s: any) => <li key={s.source_id} className="flex justify-between gap-2"><span className="truncate" title={s.source}>{s.source}</span><span className="tabular-nums text-gray-600 whitespace-nowrap">{s.errors} err · {pc(s.final_accuracy)}</span></li>)}</ul></div>
                        <div><p className="text-[11px] font-bold text-gray-500 m-0 mb-1">Extractors</p>
                          <ul className="m-0 p-0 list-none space-y-1 text-xs">{b.extractors.map((x: any) => <li key={x.user_id} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="tabular-nums text-gray-600 whitespace-nowrap">{x.sources} src · {x.errors_per_100 ?? '–'}/100 · {pc(x.first_pass_accuracy)} first pass</span></li>)}</ul></div>
                        <div><p className="text-[11px] font-bold text-gray-500 m-0 mb-1">Reviewers</p>
                          <ul className="m-0 p-0 list-none space-y-1 text-xs">{b.reviewers.length === 0 ? <li className="text-gray-400">No peer reviewers assigned</li> : b.reviewers.map((r: any) => <li key={r.user_id} className="flex justify-between gap-2"><span className="truncate">{r.name}</span><span className="tabular-nums text-gray-600 whitespace-nowrap">{r.caught}/{r.known_errors} caught · {pc(r.catch_rate)}</span></li>)}</ul></div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                <td className="py-1.5 pr-3 text-gray-900">All batches</td><td className="pr-3 tabular-nums">{c.sources}</td><Rates r={c} /><td />
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-2 mb-0">First pass: right before any rework. Final: right now. Caught: errors a peer reviewer pointed at, out of all known errors. "early" means fewer than 30 fields checked. Sources not pulled from Xtrium are listed as "Other sources".</p>
        </div>
      )}
    </Panel>
  )
}
