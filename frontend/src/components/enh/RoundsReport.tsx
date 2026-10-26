import { Fragment, useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Blank, Chip, Panel, Skeletons, Tile, type Tone } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

/** What changed between the kept first round (v1) and the records now (v2): per source, per field, with who did each round. */

const pc = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v}%`)
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const RES: Record<string, { label: string; tone: Tone }> = {
  fixed: { label: 'Fixed in v2', tone: 'green' }, regressed: { label: 'Worse in v2', tone: 'red' }, still_wrong: { label: 'Still wrong', tone: 'red' }, unchecked: { label: 'Not checked', tone: 'gray' },
}

export function RoundsReport({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [only, setOnly] = useState('')

  useEffect(() => {
    setBusy(true)
    qualityApi.rounds({ projectId, sourceId }).then(setRes).catch(e => toast.error(e?.response?.data?.detail || "Couldn't load the comparison")).finally(() => setBusy(false))
  }, [projectId, sourceId])

  if (busy) return <Skeletons />
  const t = res?.totals
  if (!t || t.sources === 0) return <Blank title="No earlier round kept yet" text="When you re-extract sources with Start over ticked, the first round (v1) is kept here. Once the new extraction (v2) has records, this page shows what changed." />

  const download = async () => { try { await qualityApi.roundsDownload({ projectId, sourceId }) } catch { toast.error("Couldn't make the download") } }
  return (
    <div className="space-y-5">
      <Panel title="v1 compared with v2" subtitle="v1 is the first extraction, kept when the source was re-extracted. v2 is the records now. Records are matched by name, and every field is compared."
        actions={<Button variant="secondary" onClick={download}>Download Excel</Button>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Sources" value={t.sources} hint={`${t.v1_records} records in v1, ${t.v2_records} in v2`} />
          <Tile label="Fields changed" value={pc(t.change_pct)} tone={t.change_pct ? 'amber' : 'green'} hint={`${t.changed} changed, ${t.added} added, ${t.removed} removed of ${t.fields}`} />
          <Tile label="Fixed in v2" value={t.fixed} tone="green" hint="Checked wrong in v1, right now" />
          <Tile label="Worse in v2" value={t.regressed + t.still_wrong} tone={t.regressed + t.still_wrong ? 'red' : 'green'} hint={`${t.regressed} were right in v1, ${t.still_wrong} wrong in both`} />
          <Tile label="v1 error rate" value={pc(t.v1_error_pct)} hint={`${t.v1_wrong} wrong of ${t.v1_checked} fields checked`} />
          <Tile label="v2 error rate" value={pc(t.v2_error_pct)} hint={`${t.v2_wrong} wrong of ${t.v2_checked} fields checked`} />
          <Tile label="Dropped records" value={t.records_dropped} tone={t.records_dropped ? 'amber' : 'green'} hint="In v1, not in v2" />
          <Tile label="New records" value={t.records_new} hint="In v2, not in v1" />
        </div>
        <p className="text-xs text-gray-500 mt-3 mb-0">Error rates use the fields you checked against the source in each round. "Not checked" changes have no verdict, so they say a field changed but not which round was right.</p>
      </Panel>

      <Panel title="By source" subtitle="Open a row to see each changed field." flush>
        <div className="flex items-center gap-2 px-3 pt-2 flex-wrap">
          {['', 'fixed', 'regressed', 'still_wrong', 'unchecked'].map(k => (
            <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k}
              className={`text-xs font-semibold rounded-lg border px-2.5 py-1 ${only === k ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{k ? RES[k].label : 'All changes'}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">
              {['Source', 'v1 extractor', 'v2 extractor', 'Records', 'Changed', 'Added', 'Removed', 'Changed %', 'Fixed', 'Worse'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {res.sources.map((s: any) => {
                const rows = s.changes.filter((c: any) => !only || c.result === only)
                return (
                  <Fragment key={s.source_id}>
                    <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [s.source_id]: !o[s.source_id] }))}>
                      <td className="px-3 py-2 font-semibold text-gray-900">{open[s.source_id] ? '▾' : '▸'} {s.name}</td>
                      <td className="px-3 py-2 text-gray-700">{s.v1_extractor}</td>
                      <td className="px-3 py-2 text-gray-700">{s.v2_extractor}</td>
                      <td className="px-3 py-2 tabular-nums">{s.v1_records} → {s.v2_records}</td>
                      <td className="px-3 py-2 tabular-nums">{s.changed}</td>
                      <td className="px-3 py-2 tabular-nums">{s.added}</td>
                      <td className="px-3 py-2 tabular-nums">{s.removed}</td>
                      <td className="px-3 py-2 tabular-nums">{pc(s.change_pct)}</td>
                      <td className="px-3 py-2 tabular-nums">{s.fixed}</td>
                      <td className="px-3 py-2 tabular-nums">{s.regressed + s.still_wrong}</td>
                    </tr>
                    {open[s.source_id] && (
                      <tr><td colSpan={10} className="px-3 pb-3 bg-gray-50">
                        <p className="m-0 pt-2 text-xs text-gray-500">v1 reviewers: {s.v1_reviewers.join(', ') || '–'}. v2 reviewers: {s.v2_reviewers.join(', ') || '–'}.</p>
                        {rows.length === 0 && <p className="m-0 py-2 text-sm text-emerald-700">{only ? 'Nothing in this group.' : 'No field changed between the rounds.'}</p>}
                        {rows.length > 0 && (
                          <table className="w-full text-[13px] border-collapse mt-2">
                            <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 pr-3">Record</th><th className="pr-3">Field</th><th className="pr-3">v1</th><th className="pr-3">v2</th><th>Result</th></tr></thead>
                            <tbody>{rows.map((c: any, i: number) => (
                              <tr key={i} className="border-t border-gray-100 align-top">
                                <td className="py-1.5 pr-3 text-gray-700">{c.record}</td>
                                <td className="pr-3 font-mono text-[12px]">{c.field}</td>
                                <td className="pr-3 text-gray-700 break-words max-w-[260px]">{show(c.v1_value)}</td>
                                <td className="pr-3 text-gray-900 break-words max-w-[260px]">{show(c.v2_value)}</td>
                                <td><Chip tone={RES[c.result].tone}>{RES[c.result].label}</Chip></td>
                              </tr>))}</tbody>
                          </table>
                        )}
                        {(s.dropped_records.length > 0 || s.new_records.length > 0) && (
                          <p className="m-0 mt-2 text-xs text-amber-800">
                            {s.dropped_records.length > 0 && <>In v1 only (dropped): {s.dropped_records.join(', ')}. </>}
                            {s.new_records.length > 0 && <>In v2 only (new): {s.new_records.join(', ')}.</>}
                          </p>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
