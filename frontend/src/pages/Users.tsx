import { useEffect, useState } from 'react'
import { Plus, Search, Trash2, Edit3, UserCheck, UserX, Info, Shield, Mail, Calendar } from 'lucide-react'
import { usersApi } from '@/api/client'
import type { User } from '@/types'
import { Button, Card, Badge, Modal, Input, EmptyState, Spinner, ConfirmDialog, Avatar, cn, toast, safeFromNow } from '@/components/ui'
import { getRoleLabel } from '@/lib/permissions'

const ROLES = ['org_admin', 'project_admin', 'qa_lead', 'pipeline_operator', 'reviewer', 'read_only']

const ROLE_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  org_admin:         { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Org Admin' },
  project_admin:     { color: '#d97706', bg: '#fffbeb', border: '#fcd34d', label: 'Project Admin' },
  qa_lead:           { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'QA Lead' },
  pipeline_operator: { color: '#059669', bg: '#ecfdf5', border: '#6ee7b7', label: 'Extractor' },
  reviewer:          { color: '#7c3aed', bg: '#faf5ff', border: '#c4b5fd', label: 'Reviewer' },
  read_only:         { color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', label: 'Read Only' },
}

// Avatar color by role
const AVATAR_COLORS: Record<string, string> = {
  org_admin: '#dc2626', project_admin: '#d97706', qa_lead: '#2563eb',
  pipeline_operator: '#059669', reviewer: '#7c3aed', read_only: '#64748b',
}

export function UsersPage() {
  const [users, setUsers]     = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser]     = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', roles: ['pipeline_operator'] as string[], is_active: true })
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    usersApi.list()
      .then((data: any) => setUsers(Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []))
      .catch((err: any) => toast.error('Failed to load users: ' + (err?.response?.data?.detail || 'Unknown error')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = users.filter(u => {
    const matchSearch = u.full_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole   = !roleFilter || u.roles.includes(roleFilter)
    return matchSearch && matchRole
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await usersApi.create({ ...form, roles: form.roles })
      toast.success(`${form.full_name} added with ${form.roles.length} role${form.roles.length !== 1 ? 's' : ''}`)
      setShowCreate(false)
      setForm({ full_name: '', email: '', password: '', roles: ['pipeline_operator'], is_active: true })
      load()
    } catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed to create user') }
    finally { setSaving(false) }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSaving(true)
    try {
      await usersApi.update(editUser.id, { full_name: form.full_name, roles: form.roles, is_active: form.is_active, ...(form.password ? { password: form.password } : {}) })
      toast.success('User updated')
      setEditUser(null)
      load()
    } catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed to update user') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try { await usersApi.delete(deleteTarget.id); toast.success(`${deleteTarget.full_name} removed`); setDeleteTarget(null); load() }
    catch (err: any) { toast.error(err?.response?.data?.detail || 'Failed') }
    finally { setDeleting(false) }
  }

  const openEdit = (u: User) => {
    setEditUser(u)
    setForm({ full_name: u.full_name, email: u.email, password: '', roles: u.roles?.length ? u.roles : ['read_only'], is_active: u.is_active ?? true })
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  return (
    <div style={{ padding: '32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Members</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {users.length} member{users.length !== 1 ? 's' : ''} · manage roles and access
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}
          style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 12, fontWeight: 600 }}>
          <Plus className="w-4 h-4" /> Add Member
        </Button>
      </div>

      {/* Role summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => setRoleFilter('')}
          style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${!roleFilter ? '#2563eb' : '#e2e8f0'}`, background: !roleFilter ? '#eff6ff' : '#fff', color: !roleFilter ? '#2563eb' : '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          All ({users.length})
        </button>
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
          const count = users.filter(u => u.roles.includes(role)).length
          if (!count) return null
          const active = roleFilter === role
          return (
            <button key={role} onClick={() => setRoleFilter(active ? '' : role)}
              style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${active ? cfg.color : cfg.border}`, background: active ? cfg.bg : '#fff', color: cfg.color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 380, marginBottom: 20 }}>
        <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#94a3b8' }} />
        <input type="text" placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', paddingLeft: 40, paddingRight: 16, paddingTop: 9, paddingBottom: 9, border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', boxSizing: 'border-box' }} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={search ? 'No members match' : 'No team members yet'} description="Add team members to assign them to projects." />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 140px 100px', padding: '10px 20px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <span>Member</span><span>Email</span><span>Role</span><span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {filtered.map((u, i) => {
            const role = u.roles?.[0] || 'read_only'
            const cfg  = ROLE_CONFIG[role] || ROLE_CONFIG.read_only
            // For dual-role users, pick the most privileged role for avatar colour
            const initial = u.full_name?.[0]?.toUpperCase() || '?'
            const avatarColor = AVATAR_COLORS[role] || '#64748b'
            const isActive = u.is_active !== false
            return (
              <div key={u.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 200px 140px 100px',
                padding: '14px 20px', alignItems: 'center',
                borderBottom: i < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
                transition: 'background 0.1s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>

                {/* Member info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, position: 'relative' }}>
                    {initial}
                    {isActive && <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, background: '#10b981', borderRadius: '50%', border: '2px solid #fff' }} />}
                    {!isActive && <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, background: '#94a3b8', borderRadius: '50%', border: '2px solid #fff' }} />}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>{u.full_name}</p>
                    {!isActive && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>Inactive</span>}
                  </div>
                </div>

                {/* Email */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail style={{ width: 12, height: 12, color: '#94a3b8', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                </div>

                {/* Role badge */}
                <div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(u.roles?.length ? u.roles : ['read_only']).map(r => {
                      const rc = ROLE_CONFIG[r] || ROLE_CONFIG.read_only
                      return <span key={r} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>{rc.label}</span>
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => openEdit(u)}
                    style={{ padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', color: '#2563eb', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Edit3 style={{ width: 11, height: 11 }} /> Edit
                  </button>
                  <button onClick={() => setDeleteTarget(u)}
                    style={{ padding: '6px 8px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#ef4444' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.borderColor = '#fecaca' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0' }}>
                    <Trash2 style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Team Member" description="Add a new member and assign their role.">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Full name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required autoFocus />
          <Input label="Email address" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <Input label="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Roles <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>— select one or more (dual role supported)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ROLES.map(role => {
                const cfg = ROLE_CONFIG[role]
                const active = form.roles.includes(role)
                return (
                  <label key={role} style={{ padding: '10px 12px', border: `2px solid ${active ? cfg.color : '#e2e8f0'}`, borderRadius: 10, background: active ? cfg.bg : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={active} onChange={e => {
                      setForm(f => ({ ...f, roles: e.target.checked ? [...f.roles, role] : f.roles.filter(r => r !== role) }))
                    }} style={{ width: 15, height: 15, accentColor: cfg.color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: active ? cfg.color : '#374151' }}>{cfg.label}</span>
                  </label>
                )
              })}
            </div>
            {form.roles.includes('pipeline_operator') && (form.roles.includes('reviewer') || form.roles.includes('qa_lead')) && (
              <p style={{ fontSize: 11, color: '#7c3aed', background: '#faf5ff', border: '1px solid #c4b5fd', padding: '6px 10px', borderRadius: 8, marginTop: 8 }}>
                ⚡ Dual role — this user can extract AND review. They still cannot approve sources they personally extracted.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.full_name || !form.email || !form.password || form.roles.length === 0}>
              <Plus className="w-4 h-4" /> Add Member
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Edit — ${editUser?.full_name}`}>
        <form onSubmit={handleEdit} className="space-y-4">
          <Input label="Full name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
          <Input label="New password (leave blank to keep current)" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Roles <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>— multi-select supported</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ROLES.map(role => {
                const cfg = ROLE_CONFIG[role]
                const active = form.roles.includes(role)
                return (
                  <label key={role} style={{ padding: '10px 12px', border: `2px solid ${active ? cfg.color : '#e2e8f0'}`, borderRadius: 10, background: active ? cfg.bg : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={active} onChange={e => {
                      setForm(f => ({ ...f, roles: e.target.checked ? [...f.roles, role] : f.roles.filter(r => r !== role) }))
                    }} style={{ width: 15, height: 15, accentColor: cfg.color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: active ? cfg.color : '#374151' }}>{cfg.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 16, height: 16 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: 0 }}>Active account</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>Inactive users cannot log in</p>
            </div>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Remove Member"
        description={`Remove ${deleteTarget?.full_name} from the platform? They will no longer be able to log in.`}
        confirmLabel="Remove Member" variant="danger" loading={deleting}
        onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  )
}
