import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { observationsApi } from '@/api/client'
import { Blank, Chip, Panel, Skeletons } from '@/components/enh/kit'
import { Button, cn, toast } from '@/components/ui'

type Draft = Record<string, string>   // kind -> note

/** What the extractor and each peer reviewer saw on this source. Required: list the issues, or confirm there were none. */
export function ObservationsPanel({ sourceId, onChange }: { sourceId: string; onChange?: (owe: boolean) => void }) {
  const [d, setD] = useState<any>(null)
  const [none, setNone] = useState(false)
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState(false)

  const load = () => observationsApi.forSource(sourceId).then(r => {
    setD(r); onChange?.(!!r.i_owe)
    setNone(!!r.none)
    setDraft(Object.fromEntries(r.mine.filter((m: any) => m.kind !== 'none').map((m: any) => [m.kind, m.note || ''])))
  }).catch(() => setD({ error: true }))
  useEffect(() => { setD(null); load() }, [sourceId])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <Skeletons rows={3} />
  if (d.error) return <Blank title="Couldn't load observations" text="Try again in a moment." />
  const mine = !!d.my_role && d.my_role !== null
  const can = mine
  const groups = ['Access', 'Content']
  const chosen = Object.keys(draft)
  const toggle = (k: string) => { setNone(false); setDraft(x => { const n = { ...x }; if (k in n) delete n[k]; else n[k] = ''; return n }) }
  const save = async () => {
    setBusy(true)
    try {
      const r = await observationsApi.saveMine(sourceId, { none, items: chosen.map(k => ({ kind: k, note: draft[k] || undefined })) })
      setD(r); onChange?.(!!r.i_owe); toast.success(none ? 'Recorded: no issues' : 'Observations saved')
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not save') } finally { setBusy(false) }
  }
  const owedByOthers = d.people.filter((p: any) => !p.done)

  return (
    <div className="space-y-4">
      {can && (
        <Panel title="Your observations" subtitle="Tick every issue you ran into on this source, or confirm that you found none. Everyone who works a source has to do this."
          actions={d.i_owe ? <Chip tone="red">Required</Chip> : <Chip tone="green">Done</Chip>}>
          <div className="space-y-4">
            {groups.map(g => (
              <div key={g}>
                <div className="text-xs font-semibold text-gray-500 mb-1.5">{g === 'Access' ? 'Getting to the data' : 'What the data is'}</div>
                <div className="flex flex-wrap gap-2">
                  {d.kinds.filter((k: any) => k.group === g).map((k: any) => (
                    <button key={k.key} onClick={() => toggle(k.key)} className={cn('px-3 py-1.5 rounded-full text-sm border transition', k.key in draft ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:border-brand-300')}>
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {chosen.length > 0 && (
              <div className="space-y-2">
                {chosen.map(k => (
                  <label key={k} className="block text-sm">
                    <span className="text-gray-700 font-medium">{d.kinds.find((x: any) => x.key === k)?.label}{k === 'other' ? ' (say what)' : ''}</span>
                    <input value={draft[k]} onChange={e => setDraft(x => ({ ...x, [k]: e.target.value }))} placeholder={k === 'other' ? 'Describe the issue' : 'Add detail, such as the page or what you saw (optional)'} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900" />
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap pt-1">
              <button onClick={() => { setNone(v => !v); setDraft({}) }} className={cn('px-3 py-1.5 rounded-full text-sm border inline-flex items-center gap-1.5', none ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300')}>
                <CheckCircle2 className="w-4 h-4" /> No issues found
              </button>
              <Button onClick={save} loading={busy} disabled={!none && chosen.length === 0}>{d.i_owe ? 'Save observations' : 'Update observations'}</Button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Who has recorded" subtitle="Peer reviewers cannot finish their review until the extractor and they have recorded their observations.">
        <ul className="m-0 p-0 list-none divide-y divide-gray-100">
          {d.people.map((p: any) => (
            <li key={p.user_id + p.role} className="py-2 flex items-center justify-between text-sm">
              <span className="text-gray-900">{p.name || 'Unknown'} <span className="text-gray-500">· {p.role === 'extractor' ? 'Extractor' : 'Peer reviewer'}</span></span>
              {p.done ? <Chip tone="green">Recorded</Chip> : <Chip tone="amber">Not yet</Chip>}
            </li>
          ))}
        </ul>
        {owedByOthers.length === 0 && d.people.length > 0 && <p className="text-xs text-gray-500 mt-2 mb-0">Everyone has recorded their observations.</p>}
      </Panel>

      <Panel title="What others recorded">
        {d.others.length === 0 ? <Blank title="Nothing from others yet" text="Their observations show here once they save them." /> : (
          <ul className="m-0 p-0 list-none space-y-2">
            {d.others.map((o: any) => (
              <li key={o.id} className="text-sm flex gap-2">
                <ShieldAlert className={cn('w-4 h-4 mt-0.5 shrink-0', o.kind === 'none' ? 'text-emerald-500' : 'text-amber-500')} />
                <div><b className="text-gray-900">{o.label}</b> <span className="text-gray-500">· {o.user} ({o.role})</span>{o.note ? <div className="text-gray-600">{o.note}</div> : null}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
