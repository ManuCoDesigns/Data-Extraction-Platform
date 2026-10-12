import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Layers, Archive, Trash2, Edit3, ChevronDown, ChevronRight, Code, Eye, Copy, Check } from 'lucide-react'
import { schemasApi, projectsApi } from '@/api/client'
import type { Schema, Project } from '@/types'
import { Button, Modal, Input, EmptyState, Spinner, ConfirmDialog, cn, toast, safeFromNow } from '@/components/ui'
import { useCapability } from '@/lib/permissions'

// ── Field type badge colours ──────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  string:  { bg: 'var(--bg-eff6ff)', color: 'var(--tx-2563eb)' },
  integer: { bg: 'var(--bg-faf5ff)', color: 'var(--tx-7c3aed)' },
  number:  { bg: 'var(--bg-faf5ff)', color: 'var(--tx-7c3aed)' },
  boolean: { bg: 'var(--bg-fff7ed)', color: 'var(--tx-ea580c)' },
  array:   { bg: 'var(--bg-ecfdf5)', color: 'var(--tx-059669)' },
  object:  { bg: 'var(--bg-f0fdf4)', color: '#16a34a' },
}

// ── Schema Field Card ─────────────────────────────────────────────────────────
function FieldCard({ field }: { field: any }) {
  const tc = TYPE_COLORS[field.type] || { bg: 'var(--bg-f8fafc)', color: 'var(--tx-64748b)' }
  return (
    <div style={{ background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: field.description ? 6 : 0 }}>
        <code style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1e293b)', background: 'var(--bg-f8fafc)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--bd-e2e8f0)' }}>
          {field.name}
        </code>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: tc.bg, color: tc.color }}>
          {field.type || 'string'}
        </span>
        {field.required && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'var(--bg-fef2f2)', color: 'var(--tx-dc2626)' }}>
            required
          </span>
        )}
        {'fixed_value' in field && (
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'var(--bg-fffbeb)', color: 'var(--tx-d97706)' }}>
            fixed: {String(field.fixed_value)}
          </span>
        )}
      </div>
      {field.description && (
        <p style={{ fontSize: 12, color: 'var(--tx-64748b)', margin: '4px 0 0', lineHeight: 1.5 }}>{field.description}</p>
      )}
      {field.enum?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {field.enum.map((v: string) => (
            <span key={v} style={{ fontSize: 10, background: 'var(--bg-f1f5f9)', color: 'var(--tx-475569)', padding: '2px 7px', borderRadius: 6, fontFamily: 'monospace' }}>{v}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Schema detail panel (expanded) ────────────────────────────────────────────
function SchemaDetailPanel({ schema, canManage, onRefresh }: { schema: Schema; canManage: boolean; onRefresh: () => void }) {
  const [versions, setVersions]   = useState<any[]>([])
  const [activeVer, setActiveVer] = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [view, setView]           = useState<'fields' | 'json'>('fields')
  const [copied, setCopied]       = useState(false)
  const [showAddVer, setShowAddVer] = useState(false)
  const [newDef, setNewDef]       = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    schemasApi.versions(schema.id)
      .then((vv: any[]) => {
        setVersions(vv)
        // Show latest version by default
        const latest = vv.reduce((a, b) => (b.version > a.version ? b : a), vv[0] || null)
        setActiveVer(latest)
      })
      .finally(() => setLoading(false))
  }, [schema.id])

  const def = activeVer?.definition || {}
  const fields: any[] = def.fields || []
  const instructions: string = def.extraction_instructions || ''

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(def, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleAddVersion = async () => {
    setSaving(true)
    try {
      const parsed = JSON.parse(newDef)
      await schemasApi.addVersion(schema.id, { name: `v${versions.length + 1}`, definition: parsed })
      toast.success('New version added')
      const vv: any[] = await schemasApi.versions(schema.id)
      setVersions(vv)
      setActiveVer(vv[vv.length - 1])
      setShowAddVer(false)
      setNewDef('')
      onRefresh()
    } catch (err: any) {
      toast.error(err?.message?.includes('JSON') ? 'Invalid JSON' : (err?.response?.data?.detail || 'Failed to add version'))
    } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Spinner className="w-5 h-5" /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Version selector */}
        {versions.length > 0 && (
          <select value={activeVer?.id || ''} onChange={e => setActiveVer(versions.find(v => v.id === e.target.value))}
            style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, background: 'var(--bg-fff)', color: 'var(--tx-374151)', cursor: 'pointer' }}>
            {versions.map(v => (
              <option key={v.id} value={v.id}>v{v.version} · {new Date(v.created_at).toLocaleDateString()}</option>
            ))}
          </select>
        )}

        {/* View toggle */}
        <div style={{ display: 'flex', background: 'var(--bg-f1f5f9)', borderRadius: 8, padding: 3, gap: 2 }}>
          {(['fields', 'json'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all 0.15s', background: view === v ? 'var(--bg-fff)' : 'transparent', color: view === v ? 'var(--tx-2563eb)' : 'var(--tx-64748b)', boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {v === 'fields' ? <><Eye style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />Fields</> : <><Code style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />JSON</>}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={handleCopy}
            style={{ padding: '5px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, background: copied ? 'var(--bg-ecfdf5)' : 'var(--bg-fff)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: copied ? 'var(--tx-059669)' : 'var(--tx-64748b)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {copied ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
          {canManage && (
            <button onClick={() => setShowAddVer(v => !v)}
              style={{ padding: '5px 12px', border: '1px solid var(--bd-bfdbfe)', borderRadius: 8, background: 'var(--bg-eff6ff)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--tx-2563eb)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Plus style={{ width: 12, height: 12 }} /> New Version
            </button>
          )}
        </div>
      </div>

      {/* Add version form */}
      {showAddVer && (
        <div style={{ background: 'var(--bg-f8fafc)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-374151)', margin: '0 0 8px' }}>Paste new schema definition JSON:</p>
          <textarea value={newDef} onChange={e => setNewDef(e.target.value)} rows={6}
            placeholder='{"fields": [{"name": "company_name", "type": "string", "required": true}], "extraction_instructions": "..."}'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: '10px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleAddVersion} disabled={!newDef.trim() || saving}
              style={{ padding: '7px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: !newDef.trim() ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save Version'}
            </button>
            <button onClick={() => { setShowAddVer(false); setNewDef('') }}
              style={{ padding: '7px 16px', background: 'var(--bg-fff)', color: 'var(--tx-64748b)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats row */}
      {activeVer && (
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Fields', value: fields.length, color: 'var(--tx-2563eb)', bg: 'var(--bg-eff6ff)' },
            { label: 'Required', value: fields.filter(f => f.required).length, color: 'var(--tx-dc2626)', bg: 'var(--bg-fef2f2)' },
            { label: 'Optional', value: fields.filter(f => !f.required).length, color: 'var(--tx-64748b)', bg: 'var(--bg-f8fafc)' },
            { label: 'With Enum', value: fields.filter(f => f.enum?.length).length, color: 'var(--tx-d97706)', bg: 'var(--bg-fffbeb)' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '10px 8px', background: s.bg, borderRadius: 10, border: `1px solid ${s.color}20` }}>
              <p style={{ fontSize: 20, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
              <p style={{ fontSize: 10, color: s.color, margin: '2px 0 0', fontWeight: 600 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Extraction instructions */}
      {instructions && (
        <div style={{ background: 'var(--bg-eff6ff)', border: '1px solid var(--bd-bfdbfe)', borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-1d4ed8)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Extraction Instructions</p>
          <p style={{ fontSize: 12, color: 'var(--tx-1e40af)', margin: 0, lineHeight: 1.6 }}>{instructions}</p>
        </div>
      )}

      {/* Fields view */}
      {view === 'fields' && (
        <div>
          {fields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
              <Layers style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No fields defined in this version</p>
              {canManage && <p style={{ fontSize: 12, margin: '4px 0 0' }}>Add a new version with fields defined</p>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {fields.map((f: any, i: number) => <FieldCard key={f.name || i} field={f} />)}
            </div>
          )}
        </div>
      )}

      {/* JSON view */}
      {view === 'json' && (
        <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }}>schema_definition.json</span>
            <span style={{ fontSize: 10, color: 'var(--tx-475569)' }}>{JSON.stringify(def).length} chars</span>
          </div>
          <pre style={{ margin: 0, padding: '16px', fontSize: 11, lineHeight: 1.7, color: '#e2e8f0', fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace', overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            {JSON.stringify(def, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main Schemas Page ─────────────────────────────────────────────────────────
export function SchemasPage() {
  const [searchParams] = useSearchParams()
  const projectIdFilter = searchParams.get('project_id') || undefined
  const [schemas, setSchemas]   = useState<Schema[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading]   = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editSchema, setEditSchema] = useState<Schema | null>(null)
  const [deleteSchema, setDeleteSchema] = useState<Schema | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', project_id: projectIdFilter || '', definition: '' })
  const [saving, setSaving]   = useState(false)
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
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [projectIdFilter])

  const visible = schemas.filter(s => showArchived ? true : !s.is_archived)
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      let def = {}
      if (form.definition.trim()) def = JSON.parse(form.definition)
      await schemasApi.create(form.project_id, { name: form.name, definition: def })
      toast.success('Schema created')
      setShowCreate(false)
      setForm({ name: '', project_id: projectIdFilter || '', definition: '' })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Invalid JSON or missing fields')
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
      toast.error(err?.response?.data?.detail || 'Failed')
    } finally { setSaving(false) }
  }

  const handleArchive = async (s: Schema) => {
    try { await schemasApi.archive(s.id); toast.success('Schema archived'); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed') }
  }

  const handleDelete = async () => {
    if (!deleteSchema) return
    setDeleting(true)
    try { await schemasApi.delete(deleteSchema.id); toast.success('Deleted'); setDeleteSchema(null); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Cannot delete — schema may be in use') }
    finally { setDeleting(false) }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}><Spinner className="w-8 h-8" /></div>

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--tx-0f172a)', margin: 0 }}>Schemas</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {visible.length} schema{visible.length !== 1 ? 's' : ''} · defines the structure of extracted records
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowArchived(v => !v)}
            style={{ padding: '8px 14px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, background: showArchived ? 'var(--bg-f1f5f9)' : 'var(--bg-fff)', cursor: 'pointer', fontSize: 12, color: 'var(--tx-64748b)', fontWeight: 600 }}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          {canManage && (
            <Button onClick={() => { setForm({ name: '', project_id: projectIdFilter || '', definition: '' }); setShowCreate(true) }}
              style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', border: 'none', color: '#fff', borderRadius: 12 }}>
              <Plus className="w-4 h-4" /> New Schema
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No schemas yet" description="Create a schema to define the structure and field rules for your extracted data." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map(s => {
            const isOpen = expandedId === s.id
            return (
              <div key={s.id} style={{ background: 'var(--bg-fff)', border: `1px solid ${isOpen ? 'var(--bd-bfdbfe)' : 'var(--bd-e2e8f0)'}`, borderRadius: 16, overflow: 'hidden', boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 4px rgba(0,0,0,0.04)', transition: 'all 0.2s' }}>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', gap: 12, cursor: 'pointer' }}
                  onClick={() => setExpandedId(isOpen ? null : s.id)}>
                  {/* Expand icon */}
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: isOpen ? 'var(--bg-eff6ff)' : 'var(--bg-f8fafc)', border: `1px solid ${isOpen ? 'var(--bd-bfdbfe)' : 'var(--bd-e2e8f0)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isOpen
                      ? <ChevronDown style={{ width: 14, height: 14, color: 'var(--tx-2563eb)' }} />
                      : <ChevronRight style={{ width: 14, height: 14, color: '#94a3b8' }} />}
                  </div>

                  {/* Schema icon */}
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: isOpen ? 'var(--bg-eff6ff)' : 'var(--bg-f8fafc)', border: `1px solid ${isOpen ? 'var(--bd-bfdbfe)' : 'var(--bd-e2e8f0)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Layers style={{ width: 16, height: 16, color: isOpen ? 'var(--tx-2563eb)' : '#94a3b8' }} />
                  </div>

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-0f172a)', margin: 0 }}>{s.name}</p>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-eff6ff)', color: 'var(--tx-2563eb)', border: '1px solid var(--bd-bfdbfe)' }}>
                        v{s.current_version}
                      </span>
                      {s.is_archived && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-f8fafc)', color: '#94a3b8', border: '1px solid var(--bd-e2e8f0)' }}>Archived</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                      {projectMap[s.project_id] && !projectIdFilter && (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>📁 {projectMap[s.project_id]}</span>
                      )}
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>Updated {safeFromNow(s.updated_at ?? s.created_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {canManage && !s.is_archived && (
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditSchema(s); setForm(f => ({ ...f, name: s.name })) }}
                        style={{ padding: '6px 8px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--tx-2563eb)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-eff6ff)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-fff)' }}>
                        <Edit3 style={{ width: 13, height: 13 }} />
                      </button>
                      <button onClick={() => handleArchive(s)}
                        style={{ padding: '6px 8px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
                        title="Archive"
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--tx-d97706)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-fffbeb)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-fff)' }}>
                        <Archive style={{ width: 13, height: 13 }} />
                      </button>
                      <button onClick={() => setDeleteSchema(s)}
                        style={{ padding: '6px 8px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--tx-ef4444)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-fef2f2)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-fff)' }}>
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded detail panel */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid #eff6ff', padding: '20px 20px 20px' }}>
                    <SchemaDetailPanel schema={s} canManage={canManage} onRefresh={load} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Schema" size="md">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!projectIdFilter && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>Project</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} required
                style={{ width: '100%', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none' }}>
                <option value="">Select a project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <Input label="Schema name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. BGS Supplier Graph Schema v1.0" required autoFocus />
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>
              Definition JSON <span style={{ fontWeight: 400, color: '#94a3b8' }}>— optional, can add later via New Version</span>
            </label>
            <textarea value={form.definition} onChange={e => setForm(f => ({ ...f, definition: e.target.value }))} rows={7}
              placeholder={'{\n  "extraction_instructions": "Extract supplier data...",\n  "fields": [\n    {"name": "canonical_name", "type": "string", "required": true}\n  ]\n}'}
              style={{ width: '100%', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim() || (!projectIdFilter && !form.project_id)}>
              <Plus className="w-4 h-4" /> Create Schema
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editSchema} onClose={() => setEditSchema(null)} title="Rename Schema">
        <form onSubmit={handleEditSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input label="Schema name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setEditSchema(null)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim()}>Save</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteSchema} title="Delete Schema"
        description={`"${deleteSchema?.name}" will be permanently deleted. Blocked if any sources use this schema.`}
        confirmLabel="Delete Schema" variant="danger" loading={deleting}
        onConfirm={handleDelete} onCancel={() => setDeleteSchema(null)} />
    </div>
  )
}
