import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Layers, Archive, Trash2, Edit3, ChevronDown, ChevronRight, Eye, Code } from 'lucide-react'
import { schemasApi, projectsApi } from '@/api/client'
import type { Schema, Project } from '@/types'
import { Button, Card, Badge, Modal, Input, Textarea, EmptyState, Spinner, ConfirmDialog, cn, toast, safeFromNow, safeFormat } from '@/components/ui'
import { useCapability } from '@/lib/permissions'

export function SchemasPage() {
  const [searchParams] = useSearchParams()
  const projectIdFilter = searchParams.get('project_id') || undefined
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editSchema, setEditSchema] = useState<Schema | null>(null)
  const [deleteSchema, setDeleteSchema] = useState<Schema | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', project_id: projectIdFilter || '', definition: '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const canManage = useCapability('manage_schemas')

  const load = () =>
    Promise.all([
      schemasApi.list(projectIdFilter).then(setSchemas),
      projectsApi.list().then((r: any) => setProjects(r.items || r)),
    ]).finally(() => setLoading(false))

  useEffect(() => {
    load()
    const iv = setInterval(load, 60_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [projectIdFilter])

  const visible = schemas.filter(s => showArchived ? true : !s.is_archived)
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      let def = {}
      if (form.definition.trim()) {
        def = JSON.parse(form.definition)
      }
      await schemasApi.create(form.project_id, { name: form.name, definition: def })
      toast.success('Schema created')
      setShowCreate(false)
      setForm({ name: '', description: '', project_id: projectIdFilter || '', definition: '' })
      load()
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Failed to create schema'
      toast.error(msg.includes('JSON') ? 'Invalid JSON in definition' : msg)
    } finally { setSaving(false) }
  }

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editSchema) return
    setSaving(true)
    try {
      await schemasApi.update(editSchema.id, { name: form.name })
      toast.success('Schema renamed')
      setEditSchema(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update schema')
    } finally { setSaving(false) }
  }

  const handleArchive = async (s: Schema) => {
    try {
      await schemasApi.archive(s.id)
      toast.success('Schema archived')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to archive schema')
    }
  }

  const handleDelete = async () => {
    if (!deleteSchema) return
    setDeleting(true)
    try {
      await schemasApi.delete(deleteSchema.id)
      toast.success('Schema deleted')
      setDeleteSchema(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete schema')
    } finally { setDeleting(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schemas</h1>
          <p className="text-sm text-gray-500 mt-1">{visible.length} schema{visible.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived(v => !v)}
            className={cn('text-xs px-3 py-1.5 rounded-lg border transition',
              showArchived ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          {canManage && (
            <Button onClick={() => { setForm({ name: '', description: '', project_id: projectIdFilter || '', definition: '' }); setShowCreate(true) }}>
              <Plus className="w-4 h-4" /> New Schema
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No schemas yet" description="Create a schema to define the structure of your extracted data." />
      ) : (
        <div className="space-y-3">
          {visible.map(s => (
            <Card key={s.id} className="overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    className="text-gray-400 hover:text-gray-600 transition shrink-0">
                    {expandedId === s.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 truncate">{s.name}</p>
                      <Badge variant="gray">v{s.current_version}</Badge>
                      {s.is_archived && <Badge variant="gray"><Archive className="w-3 h-3" /> Archived</Badge>}
                    </div>
                    {!projectIdFilter && projectMap[s.project_id] && (
                      <p className="text-xs text-gray-400 mt-0.5">{projectMap[s.project_id]}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canManage && !s.is_archived && (
                    <>
                      <button onClick={() => { setEditSchema(s); setForm(f => ({ ...f, name: s.name })) }}
                        className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleArchive(s)}
                        className="p-1.5 text-gray-400 hover:text-amber-500 rounded-lg hover:bg-amber-50 transition" title="Archive">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteSchema(s)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expandedId === s.id && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <SchemaVersionsPanel schemaId={s.id} canManage={canManage} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Schema" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          {!projectIdFilter && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" required>
                <option value="">Select a project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <Input label="Schema name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. BGS Supplier Graph Schema" required autoFocus />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Definition (JSON) <span className="text-gray-400 font-normal">— optional, can add fields later</span>
            </label>
            <textarea
              value={form.definition}
              onChange={e => setForm(f => ({ ...f, definition: e.target.value }))}
              placeholder='{"fields": [], "extraction_instructions": ""}'
              rows={6}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim() || (!projectIdFilter && !form.project_id)}>
              <Plus className="w-4 h-4" /> Create Schema
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit (rename) modal */}
      <Modal open={!!editSchema} onClose={() => setEditSchema(null)} title="Rename Schema">
        <form onSubmit={handleEditSave} className="space-y-4">
          <Input label="Schema name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditSchema(null)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim()}>Save</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteSchema}
        title="Delete Schema"
        description={`"${deleteSchema?.name}" will be permanently deleted. This cannot be undone. If any jobs use this schema, deletion will be blocked.`}
        confirmLabel="Delete Schema"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteSchema(null)}
      />
    </div>
  )
}

function SchemaVersionsPanel({ schemaId, canManage }: { schemaId: string; canManage: boolean }) {
  const [versions, setVersions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newDef, setNewDef] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    schemasApi.versions(schemaId).then(setVersions).finally(() => setLoading(false))
  }, [schemaId])

  const handleAdd = async () => {
    setSaving(true)
    try {
      const def = JSON.parse(newDef)
      await schemasApi.addVersion(schemaId, { name: `v${versions.length + 1}`, definition: def })
      toast.success('New version added')
      schemasApi.versions(schemaId).then(setVersions)
      setShowAdd(false)
      setNewDef('')
    } catch (err: any) {
      toast.error(err?.message?.includes('JSON') ? 'Invalid JSON' : (err?.response?.data?.detail || 'Failed'))
    } finally { setSaving(false) }
  }

  if (loading) return <div className="py-4 flex justify-center"><Spinner className="w-4 h-4" /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{versions.length} version{versions.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <Button variant="secondary" onClick={() => setShowAdd(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> Add version
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="space-y-2">
          <textarea value={newDef} onChange={e => setNewDef(e.target.value)} rows={5}
            placeholder='{"fields": [{"name": "company_name", "type": "string", "required": true}], "extraction_instructions": "..."}'
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <div className="flex gap-2">
            <Button onClick={handleAdd} loading={saving} disabled={!newDef.trim()}>Save version</Button>
            <Button variant="secondary" onClick={() => { setShowAdd(false); setNewDef('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {versions.map(v => (
        <div key={v.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
          <Code className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">v{v.version}</span>
              {v.is_locked && <Badge variant="amber">Locked</Badge>}
              <span className="text-xs text-gray-400 ml-auto">
                {safeFromNow(v.created_at)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 font-mono truncate">
              {JSON.stringify(v.definition).slice(0, 120)}…
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
