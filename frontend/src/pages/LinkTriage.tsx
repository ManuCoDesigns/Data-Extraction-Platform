import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi } from '@/api/client'
import { triageApi } from '@/api/triage'
import { Blank, Chip, PAGE, PageHeader, Panel, SelectBox, Skeletons, Tabs, Tile } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'

type Show = 'todo' | 'flagged' | 'all'
const LINK: Record<string, { label: string; tone: any }> = { ok: { label: 'Opens', tone: 'green' }, login: { label: 'Login wall', tone: 'amber' }, blocked: { label: 'Blocks bots', tone: 'amber' }, dead: { label: 'Broken', tone: 'red' }, error: { label: 'Failed to load', tone: 'red' }, unchecked: { label: 'Not checked', tone: 'gray' } }

/** The first thing to do with a new batch: open each link, and flag the ones that are broken, blank, behind a login or otherwise not workable,
 *  so leads can decide before anyone spends time on them. Flags are saved as observations, so they feed the reports. */
export function LinkTriagePage() {
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState('')
  const [show, setShow] = useState<Show>('todo')
  const [d, setD] = useState<any>(null)
  const [kind, setKind] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { projectsApi.list().then((r: any) => setProjects(Array.isArray(r) ? r : r.items ?? [])).catch(() => {}) }, [])
  const load = () => { setD(null); triageApi.list({ project_id: projectId || undefined }).then(r => { setD(r); setKind({}); setNote({}) }).catch(() => setD({ error: true })) }
  useEffect(load, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = useMemo(() => (d?.kinds ?? []).filter((k: any) => k.blocking || k.key === 'other'), [d])
  const rows = useMemo(() => (d?.items ?? []).filter((i: any) => show === 'all' ? true : show === 'flagged' ? i.flags.length > 0 : i.flags.length === 0), [d, show])
  const pending = Object.entries(kind).filter(([, v]) => v)
  const needNote = pending.find(([id, v]) => v === 'other' && !(note[id] || '').trim())

  const save = async () => {
    if (!pending.length) return
    if (needNote) { toast.error('Say what the issue is when you choose "Something else".'); return }
    setBusy(true)
    try {
      const r = await triageApi.save(pending.map(([source_id, k]) => ({ source_id, kind: k, note: (note[source_id] || '').trim() || undefined })))
      toast.success(`${r.saved} ${r.saved === 1 ? 'source' : 'sources'} flagged${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`)
      load()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not save') } finally { setBusy(false) }
  }

  return (
    <div className={PAGE}>
      <PageHeader title="Link triage" subtitle="Before you start extracting, open each link and flag the ones that will not work: broken, blank, behind a login, blocked, or nothing to extract. Your lead sees them straight away and decides, so no time is lost on them."
        actions={<Button onClick={save} disabled={busy || !pending.length}>{busy ? 'Saving…' : `Flag ${pending.length || ''} selected`}</Button>} />
      <div className="flex gap-3 flex-wrap items-end">
        <SelectBox label="Project" value={projectId} onChange={setProjectId}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectBox>
        <Tabs value={show} onChange={setShow} items={[{ key: 'todo', label: 'Not flagged' }, { key: 'flagged', label: 'Flagged', count: d?.flagged }, { key: 'all', label: 'All' }]} />
      </div>
      {!d ? <Skeletons rows={6} /> : d.error ? <Blank title="Couldn't load your sources" /> : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="Sources" value={d.total} tone="blue" hint="Not yet approved" />
            <Tile label="Flagged" value={d.flagged} tone={d.flagged ? 'amber' : 'gray'} hint="Will not work as they are" />
            <Tile label="Broken or failing" value={(d.items as any[]).filter(i => ['dead', 'error'].includes(i.link.status)).length} tone="red" hint="By the automatic link check" />
            <Tile label="Not flagged" value={d.total - d.flagged} tone="green" hint="Still to open and check" />
          </div>
          <Panel title="Your sources" subtitle="Open the link, then pick what is wrong if anything. Sources you leave alone are treated as working.">
            {rows.length === 0 ? <Blank title={show === 'flagged' ? 'Nothing flagged yet' : 'Nothing to show'} text="Sources assigned to you show up here." /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-semibold">Source</th><th className="pr-3 font-semibold">Link</th><th className="pr-3 font-semibold">Automatic check</th><th className="pr-3 font-semibold">What is wrong?</th><th className="font-semibold">Note</th></tr></thead>
                <tbody>{rows.map((i: any) => (
                  <tr key={i.source_id} className="border-t border-gray-50 align-top">
                    <td className="py-2 pr-3"><Link to={`/projects/${i.project_id}/sources/${i.source_id}`} className="text-brand-600 hover:underline">{i.name}</Link>{i.item_no ? <span className="text-gray-400"> #{i.item_no}</span> : null}
                      {i.flags.length > 0 && <div className="flex gap-1 flex-wrap mt-1">{i.flags.map((f: any, n: number) => <Chip key={n} tone="amber" title={f.note || ''}>{f.label}</Chip>)}</div>}</td>
                    <td className="pr-3">{i.url ? <a href={/^https?:/i.test(i.url) ? i.url : `https://${i.url}`} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">Open link</a> : <span className="text-gray-400">No link</span>}</td>
                    <td className="pr-3"><Chip tone={LINK[i.link.status]?.tone || 'gray'} title={i.link.detail || ''}>{LINK[i.link.status]?.label || i.link.status}</Chip>
                      {i.link.suggest && !i.flags.length && kind[i.source_id] !== i.link.suggest && <button className="block text-xs text-brand-600 hover:underline mt-1" onClick={() => setKind(k => ({ ...k, [i.source_id]: i.link.suggest }))}>Flag as suggested</button>}</td>
                    <td className="pr-3 min-w-[200px]">
                      <select value={kind[i.source_id] || ''} onChange={e => setKind(k => ({ ...k, [i.source_id]: e.target.value }))} className="w-full border border-gray-200 rounded-md py-1 px-2 text-sm bg-white" aria-label={`What is wrong with ${i.name}`}>
                        <option value="">{i.flags.length ? 'Add another issue…' : 'Nothing, it works'}</option>
                        {kinds.map((k: any) => <option key={k.key} value={k.key}>{k.label}</option>)}
                      </select></td>
                    <td className="min-w-[180px]">{kind[i.source_id] ? <input value={note[i.source_id] || ''} onChange={e => setNote(n => ({ ...n, [i.source_id]: e.target.value }))} placeholder={kind[i.source_id] === 'other' ? 'Required' : 'Optional, for example 404 or "sign in to view"'} className="w-full border border-gray-200 rounded-md py-1 px-2 text-sm bg-white" /> : null}</td>
                  </tr>))}</tbody></table></div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
