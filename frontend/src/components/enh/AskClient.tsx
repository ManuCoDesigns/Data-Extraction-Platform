import { useEffect, useState } from 'react'
import { enhApi, projectsApi, sourcesApi } from '@/api/client'
import { Button, Modal, toast } from '@/components/ui'
import { SelectBox } from '@/components/enh/kit'

interface Props {
  open: boolean
  onClose: () => void
  onAsked?: () => void
  projectId?: string
  sourceId?: string
}

/** Raise a question for the client. Opened from the Client questions page, or from a source with the source filled in. */
export function AskClientModal({ open, onClose, onAsked, projectId, sourceId }: Props) {
  const [projects, setProjects] = useState<any[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [project, setProject] = useState(projectId ?? '')
  const [source, setSource] = useState(sourceId ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setProject(projectId ?? ''); setSource(sourceId ?? ''); setText('')
    if (!projectId) projectsApi.list().then((r: any) => { setProjects(r.items ?? []); if (!projectId && r.items?.length === 1) setProject(r.items[0].id) }).catch(() => {})
  }, [open, projectId, sourceId])

  useEffect(() => {
    if (!open || !project || sourceId) return
    sourcesApi.list(project).then((r: any) => setSources(Array.isArray(r) ? r : [])).catch(() => setSources([]))
  }, [open, project, sourceId])

  const send = async () => {
    if (!project) { toast.error('Choose a project'); return }
    if (text.trim().length < 5) { toast.error('Write the question so the client can answer it'); return }
    setBusy(true)
    try {
      await enhApi.ask({ project_id: project, source_id: source || null, question: text.trim() })
      toast.success('Question saved. Admins have been told')
      onAsked?.(); onClose()
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't save the question") }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ask the client" description="Write it so someone who hasn't seen the source can answer it.">
      <div className="space-y-4">
        {!projectId && projects.length > 1 && (
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Project</span>
            <SelectBox label="Project" value={project} onChange={v => { setProject(v); setSource('') }} className="w-full mt-1">
              <option value="">Choose a project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectBox>
          </label>
        )}
        {!sourceId && (
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Which source is it about? <span className="font-normal text-gray-400">(optional)</span></span>
            <SelectBox label="Source" value={source} onChange={setSource} className="w-full mt-1">
              <option value="">Not about one source</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectBox>
          </label>
        )}
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Your question</span>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={2000} autoFocus
            placeholder="For example: Is it fine to send several records inside one item, or must each item hold one record?"
            className="mt-1 w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={send} loading={busy}>Save question</Button>
        </div>
      </div>
    </Modal>
  )
}
