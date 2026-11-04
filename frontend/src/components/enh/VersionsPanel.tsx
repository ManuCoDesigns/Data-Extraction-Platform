import { useCallback, useEffect, useState } from 'react'
import { versionsApi } from '@/api/versions'
import { Blank, Chip, Skeletons } from '@/components/enh/kit'
import { Button, toast } from '@/components/ui'
import { downloadText } from '@/lib/csv'

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/** Every earlier copy of this source's data. Replacing data keeps the old copy here, so nothing is lost. */
export function VersionsPanel({ sourceId, onRestored }: { sourceId: string; onRestored?: () => void }) {
  const [info, setInfo] = useState<any>(null)
  const [diff, setDiff] = useState<Record<string, any>>({})
  const [restoring, setRestoring] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { versionsApi.list(sourceId).then(setInfo).catch(() => setInfo({ error: true })) }, [sourceId])
  useEffect(load, [load])

  if (!info) return <Skeletons rows={3} />
  if (info.error) return <Blank title="Couldn't load the versions" text="Try again in a moment." />
  const need = info.replace?.needs_reason
  const compare = async (id: string) => {
    if (diff[id]) { setDiff(d => { const n = { ...d }; delete n[id]; return n }); return }
    try { const r = await versionsApi.compare(sourceId, id); setDiff(d => ({ ...d, [id]: r })) } catch { toast.error('Could not compare') }
  }
  const download = async (v: any) => {
    try { downloadText(`version_${v.round}.json`, await versionsApi.download(sourceId, v.id), 'application/json') } catch { toast.error('Could not download') }
  }
  const restore = async (v: any) => {
    setBusy(true)
    try {
      await versionsApi.restore(sourceId, v.id, reason.trim() || undefined)
      toast.success(`Version ${v.round} is back. The data it replaced is kept as a new version.`)
      setRestoring(null); setReason(''); load(); onRestored?.()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not restore') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 m-0">The source has <b>{info.records}</b> records now. When the data is replaced, the old copy is kept here with its reviewer comments and flags. You can compare it, download it as a file, or bring it back.</p>
      {info.replace?.blocked && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 m-0">{info.replace.blocked}</p>}
      {!info.versions.length && <Blank title="No earlier versions" text="The first time the data is replaced, the old copy shows up here." />}
      {info.versions.map((v: any) => (
        <div key={v.id} className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-sm">Version {v.round}</b>
            <Chip tone={v.kind === 'replaced' ? 'amber' : v.kind === 'restored' ? 'blue' : 'gray'}>{v.kind === 'replaced' ? 'replaced' : v.kind === 'restored' ? 'restored over' : 'earlier round'}</Chip>
            <span className="text-xs text-gray-500">{v.records} records · kept {when(v.created_at)}{v.by ? ` · by ${v.by}` : ''}</span>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => compare(v.id)}>{diff[v.id] ? 'Hide' : 'Compare'}</Button>
              <Button size="sm" variant="secondary" onClick={() => download(v)}>Download</Button>
              {info.can_edit && <Button size="sm" variant="secondary" onClick={() => { setRestoring(restoring === v.id ? null : v.id); setReason('') }}>Restore</Button>}
            </div>
          </div>
          {v.reason && <p className="text-sm text-gray-700 mt-1.5 mb-0">{v.reason.replace(/^Replaced: /, '')}</p>}
          {v.reviewers.length > 0 && <p className="text-xs text-gray-500 mt-1 mb-0">Reviewers then: {v.reviewers.map((r: any) => `${r.name} (${r.status})`).join(', ')}{v.findings ? ` · ${v.findings} flags kept` : ''}</p>}
          {diff[v.id] && (
            <div className="mt-2 text-xs text-gray-700 space-y-1 bg-gray-50 rounded-lg p-2.5">
              <p className="m-0"><b>Compared with now:</b> {diff[v.id].counts.changed} changed, {diff[v.id].counts.added} new, {diff[v.id].counts.removed} gone, {diff[v.id].counts.same} the same.</p>
              {diff[v.id].changed.slice(0, 8).map((c: any) => <p key={c.name} className="m-0">{c.name}: {c.fields.join(', ')}{c.more ? ` and ${c.more} more` : ''}</p>)}
              {diff[v.id].removed.length > 0 && <p className="m-0">Gone now: {diff[v.id].removed.slice(0, 6).join(', ')}{diff[v.id].removed.length > 6 ? '…' : ''}</p>}
              {diff[v.id].added.length > 0 && <p className="m-0">New now: {diff[v.id].added.slice(0, 6).join(', ')}{diff[v.id].added.length > 6 ? '…' : ''}</p>}
            </div>
          )}
          {restoring === v.id && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-600 m-0">The data there now is kept as a new version, and the peer reviews start again. Reviewer comments stay with the version they were written on.</p>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={need ? `Why are you restoring this? (at least ${info.replace.min_reason} characters)` : 'Why? (optional)'} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" />
              <Button size="sm" loading={busy} disabled={need && reason.trim().length < info.replace.min_reason} onClick={() => restore(v)}>Restore version {v.round}</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
