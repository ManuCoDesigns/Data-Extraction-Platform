import { useCallback, useEffect, useState } from 'react'
import { adminUploadApi } from '@/api/adminUpload'
import { Button, toast } from '@/components/ui'

export type UploadMode = 'draft' | 'reference' | 'submit'

const OPTIONS: { key: UploadMode; title: string; text: string }[] = [
  { key: 'draft', title: 'Save as a draft', text: 'The records are saved but the source stays in extraction. The reviewers see nothing and it does not count as submitted. You send it for review when it is ready.' },
  { key: 'reference', title: 'Keep as a reference copy', text: 'The file is kept under Versions to compare with the extractor’s data. The records on the source are not changed.' },
  { key: 'submit', title: 'Submit for review now', text: 'The normal upload: the source goes to Ready for review straight away.' },
]

/** What an admin's upload should be. Nothing is final unless the admin picks the last option. */
export function AdminModePicker({ mode, setMode, hasRecords }: { mode: UploadMode; setMode: (m: UploadMode) => void; hasRecords: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
      <p className="text-sm font-semibold text-gray-900 m-0">What is this upload?</p>
      {OPTIONS.map(o => (
        <label key={o.key} className="flex items-start gap-2 cursor-pointer text-xs">
          <input type="radio" name="admin-upload-mode" checked={mode === o.key} onChange={() => setMode(o.key)} className="mt-0.5" />
          <span><b className="text-gray-900">{o.title}</b><br /><span className="text-gray-600">{o.text}</span></span>
        </label>
      ))}
      {hasRecords && mode === 'draft' && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-1.5 m-0">This source already has records. A draft replaces them, and the current data is kept under Versions. To check them against this file instead, choose a reference copy.</p>}
    </div>
  )
}

/** Shown on a source whose data is an admin draft. */
export function AdminDraftBanner({ sourceId, reloadKey, onSubmitted }: { sourceId: string; reloadKey?: string; onSubmitted?: () => void }) {
  const [st, setSt] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { adminUploadApi.state(sourceId).then(setSt).catch(() => setSt(null)) }, [sourceId])
  useEffect(load, [load, reloadKey])
  if (!st?.draft) return null
  const submit = async () => {
    setBusy(true)
    try {
      const r = await adminUploadApi.submit(sourceId)
      toast.success(r.invalid ? `Sent back to extraction: ${r.invalid} records still need fixes.` : 'Submitted for review.')
      load(); onSubmitted?.()
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not submit') } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="text-sm text-indigo-900 flex-1 min-w-[16rem]">
        <b>Admin draft, not submitted.</b> {st.records} records{st.invalid ? `, ${st.invalid} need fixes` : ''} loaded{st.by ? ` by ${st.by}` : ''}. The reviewers cannot see it, and it does not count in the reports until it is submitted.
      </div>
      {st.can_submit && <Button size="sm" loading={busy} onClick={submit}>Submit for review</Button>}
    </div>
  )
}
