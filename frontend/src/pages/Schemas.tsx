import { useEffect, useState } from 'react'
import { Plus, Database, Lock } from 'lucide-react'
import { schemasApi, projectsApi } from '@/api/client'
import type { Schema, Project } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, EmptyState, Spinner } from '@/components/ui'
import { formatDistanceToNow } from 'date-fns'

const STARTER_SCHEMA = {
  name: "Xtrium Supplier Graph Schema",
  version: "1.0",
  grouping_key: "company_name",
  deduplication_key: "canonical_name",
  fields: [
    { name: "company_name", type: "string", required: true, source_field: "company_name" },
    { name: "canonical_name", type: "string", required: true, source_field: "company_name", transform: "canonical_name_transform" },
    { name: "is_verified", type: "boolean", required: true, fixed_value: false },
    { name: "supply_chain_tier", type: "integer", required: true, enum: [1, 2, 3] },
    { name: "headquarters_location", type: "string", required: false, source_field: "address" },
    { name: "phone", type: "string", required: false },
    { name: "email", type: "string", required: false },
    { name: "website", type: "string", required: false },
    { name: "category", type: "string", required: false }
  ],
  transformation_functions: {
    canonical_name_transform: "lowercase → replace & with 'and' → replace spaces with hyphens → strip punctuation"
  }
}

export function SchemasPage() {
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ project_id: '', name: '', definition: JSON.stringify(STARTER_SCHEMA, null, 2) })
  const [jsonError, setJsonError] = useState('')

  const load = () =>
    Promise.all([
      schemasApi.list().then(setSchemas),
      projectsApi.list().then(r => setProjects(r.items)),
    ]).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    let parsed
    try {
      parsed = JSON.parse(form.definition)
      setJsonError('')
    } catch {
      setJsonError('Invalid JSON — check your schema definition')
      return
    }
    setCreating(true)
    try {
      await schemasApi.create(form.project_id, { name: form.name, definition: parsed })
      setShowCreate(false)
      setForm({ project_id: '', name: '', definition: JSON.stringify(STARTER_SCHEMA, null, 2) })
      load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schemas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Define the data structure for each extraction project.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Schema
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
      ) : schemas.length === 0 ? (
        <EmptyState
          title="No schemas yet"
          description="Create a schema to define what fields to extract."
          action={<Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Create Schema</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {schemas.map(s => (
            <Card key={s.id} className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Database className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="gray">v{s.current_version}</Badge>
                  {s.is_archived && <Badge variant="red">Archived</Badge>}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{s.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Created {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="mt-auto pt-3 border-t border-gray-100 flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1">
                  View Versions
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Schema">
        <form onSubmit={handleCreate} className="space-y-4">
          <Select
            label="Project"
            value={form.project_id}
            onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
            required
          >
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>

          <Input
            label="Schema name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Xtrium Supplier Graph Schema"
            required
          />

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Schema Definition (JSON)
            </label>
            <textarea
              className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none ${jsonError ? 'border-red-400' : 'border-gray-300'}`}
              rows={12}
              value={form.definition}
              onChange={e => { setForm(f => ({ ...f, definition: e.target.value })); setJsonError('') }}
              spellCheck={false}
            />
            {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={creating}>Create Schema</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
