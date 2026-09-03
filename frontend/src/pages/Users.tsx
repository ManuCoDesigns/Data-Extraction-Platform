import { useEffect, useState } from 'react'
import { Users as UsersIcon, Plus, Shield, Edit3, Trash2, Search, Mail, RotateCcw, Key, UserCheck } from 'lucide-react'
import { usersApi } from '@/api/client'
import { Modal, Input, Select, ConfirmDialog, toast, cn } from '@/components/ui'
import { useCapability } from '@/lib/permissions'
import type { User } from '@/types'

const ROLE_META: Record<string, { label: string; color: string; bg: string; grad: string }> = {
  org_admin:         { label: 'Org Admin',     color: '#dc2626', bg: '#fef2f2', grad: 'linear-gradient(135deg,#ef4444,#b91c1c)' },
  project_admin:     { label: 'Project Admin', color: '#d97706', bg: '#fffbeb', grad: 'linear-gradient(135deg,#f59e0b,#b45309)' },
  qa_lead:           { label: 'QA Lead',       color: '#7c3aed', bg: '#faf5ff', grad: 'linear-gradient(135deg,#a855f7,#7c3aed)' },
  pipeline_operator: { label: 'Extractor',     color: '#2563eb', bg: '#eff6ff', grad: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' },
  reviewer:          { label: 'Reviewer',      color: '#059669', bg: '#ecfdf5', grad: 'linear-gradient(135deg,#10b981,#047857)' },
  read_only:         { label: 'Read Only',     color: '#64748b', bg: '#f1f5f9', grad: 'linear-gradient(135deg,#94a3b8,#64748b)' },
}

export function UsersPage() {
  const [users,   setUsers]   = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const canManage = useCapability('manage_users')

  const load = () => {
    setLoading(true)
    usersApi.list().then((r: any) => {
      setUsers(Array.isArray(r) ? r : r?.items ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = users.filter(u =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  )

  // ── Create ─────────────────────────────────────────────────────────────────
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'pipeline_operator' })
  const [saving, setSaving] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      // Backend expects `roles` as an array — sending the old `role` singular
      // string here silently discarded whatever role was picked, every time.
      await usersApi.create({
        full_name: form.full_name, email: form.email, password: form.password,
        roles: [form.role],
      })
      toast.success('User created successfully')
      setShowNew(false)
      setForm({ full_name: '', email: '', password: '', role: 'pipeline_operator' })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create user')
    } finally { setSaving(false) }
  }

  // ── Role change (inline dropdown) ─────────────────────────────────────────
  const updateRole = async (userId: string, role: string) => {
    try {
      // Same fix as create() — must be `roles: [role]`, not `role`.
      await usersApi.update(userId, { roles: [role] })
      toast.success('Role updated')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update role')
    }
  }

  // ── Edit (name) + password reset ──────────────────────────────────────────
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const openEdit = (u: User) => {
    setEditUser(u)
    setEditName(u.full_name ?? '')
    setNewPassword('')
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSavingEdit(true)
    try {
      const payload: any = {}
      if (editName.trim() && editName !== editUser.full_name) payload.full_name = editName.trim()
      if (newPassword.trim()) payload.password = newPassword.trim()
      if (Object.keys(payload).length > 0) {
        await usersApi.update(editUser.id, payload)
        toast.success('User updated')
      }
      setEditUser(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update user')
    } finally {
      setSavingEdit(false)
    }
  }

  // ── Deactivate / Reactivate ───────────────────────────────────────────────
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const deactivate = async (userId: string) => {
    if (!confirm('Deactivate this user? They will lose access immediately.')) return
    setTogglingId(userId)
    try {
      await usersApi.update(userId, { is_active: false })
      toast.success('User deactivated')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to deactivate user')
    } finally {
      setTogglingId(null)
    }
  }

  const reactivate = async (userId: string) => {
    setTogglingId(userId)
    try {
      await usersApi.update(userId, { is_active: true })
      toast.success('User reactivated')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to reactivate user')
    } finally {
      setTogglingId(null)
    }
  }

  // ── Permanent delete ──────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await usersApi.delete(deleteTarget.id)
      toast.success('User removed')
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to remove user')
    } finally {
      setDeleting(false)
    }
  }

  const roleCounts = users.reduce((acc, u) => {
    const role = Array.isArray(u.roles) ? u.roles[0] : (u as any).role ?? 'unknown'
    acc[role] = (acc[role] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25 shrink-0">
            <UsersIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Members</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              {users.length} member{users.length !== 1 ? 's' : ''} · manage access and roles
            </p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setShowNew(true)} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(37,99,235,0.3)', transition: 'all 0.15s',
          }}>
            <Plus style={{ width: 16, height: 16 }} /> Add Member
          </button>
        )}
      </div>

      {/* Role breakdown */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(ROLE_META).map(([role, meta]) => (
          roleCounts[role] ? (
            <div key={role} className="relative overflow-hidden" style={{
              padding: '8px 16px 8px 14px', borderRadius: 12, background: '#fff',
              border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div className="absolute top-0 left-0 bottom-0" style={{ width: 3, background: meta.grad }} />
              <span style={{ fontSize: 18, fontWeight: 800, color: meta.color, lineHeight: 1 }}>{roleCounts[role]}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{meta.label}</span>
            </div>
          ) : null
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 320 }}>
        <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          width: 15, height: 15, color: '#94a3b8' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{ width: '100%', padding: '9px 12px 9px 36px', fontSize: 13,
            border: '1px solid #e2e8f0', borderRadius: 10, outline: 'none',
            background: '#fff', color: '#1e293b', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
          onFocus={e => e.target.style.borderColor='#2563eb'}
          onBlur={e => e.target.style.borderColor='#e2e8f0'} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Member','Email','Role','Status','Joined',''].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    No members found
                  </td></tr>
                : filtered.map((u, i) => {
                  const role = Array.isArray(u.roles) ? u.roles[0] : (u as any).role ?? ''
                  const rm   = ROLE_META[role] ?? { label: role, color: '#64748b', bg: '#f1f5f9', grad: 'linear-gradient(135deg,#94a3b8,#64748b)' }
                  const isActive = (u as any).is_active !== false
                  const isToggling = togglingId === u.id
                  return (
                    <tr key={u.id}
                      style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
                        opacity: isActive ? 1 : 0.55, transition: 'background 0.12s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                            background: rm.grad, boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: '#fff' }}>
                            {(u.full_name ?? u.email ?? '?')[0].toUpperCase()}
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                            {u.full_name ?? '—'}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Mail style={{ width: 13, height: 13, color: '#94a3b8' }} />
                          <span style={{ fontSize: 13, color: '#64748b' }}>{u.email}</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {canManage ? (
                          <select value={role}
                            onChange={e => updateRole(u.id, e.target.value)}
                            style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 20,
                              background: rm.bg, color: rm.color, border: `1px solid ${rm.color}40`,
                              cursor: 'pointer', outline: 'none' }}>
                            {Object.entries(ROLE_META).map(([r, m]) => (
                              <option key={r} value={r}>{m.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px',
                            borderRadius: 20, background: rm.bg, color: rm.color }}>
                            {rm.label}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                          background: isActive ? '#ecfdf5' : '#f1f5f9',
                          color: isActive ? '#059669' : '#94a3b8' }}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                        {(u as any).created_at ? new Date((u as any).created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {canManage && (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button onClick={() => openEdit(u)} title="Edit name / reset password"
                              style={{ padding: '5px 8px', borderRadius: 8, background: '#f8fafc',
                                border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', transition: 'all 0.15s' }}>
                              <Edit3 style={{ width: 13, height: 13 }} />
                            </button>
                            {isActive ? (
                              <button onClick={() => deactivate(u.id)} disabled={isToggling} title="Deactivate"
                                style={{ padding: '5px 8px', borderRadius: 8, background: '#f8fafc',
                                  border: '1px solid #e2e8f0', color: '#94a3b8', transition: 'all 0.15s',
                                  cursor: isToggling ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                                  opacity: isToggling ? 0.5 : 1 }}>
                                <Trash2 style={{ width: 13, height: 13 }} />
                              </button>
                            ) : (
                              <button onClick={() => reactivate(u.id)} disabled={isToggling} title="Reactivate"
                                style={{ padding: '5px 8px', borderRadius: 8, background: '#ecfdf5',
                                  border: '1px solid #bbf7d0', color: '#059669', transition: 'all 0.15s',
                                  cursor: isToggling ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                                  opacity: isToggling ? 0.5 : 1 }}>
                                <RotateCcw style={{ width: 13, height: 13 }} />
                              </button>
                            )}
                            <button onClick={() => setDeleteTarget(u)} title="Permanently remove"
                              style={{ padding: '5px 8px', borderRadius: 8, background: '#fef2f2',
                                border: '1px solid #fecaca', color: '#dc2626', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', transition: 'all 0.15s' }}>
                              <Shield style={{ width: 13, height: 13 }} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* New user modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add Team Member">
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { label: 'Full name', key: 'full_name', type: 'text', placeholder: 'Sarah Wanjiku' },
            { label: 'Email address', key: 'email', type: 'email', placeholder: 'sarah@careerflow.ai' },
            { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                {label} *
              </label>
              <Input type={type} placeholder={placeholder} required
                value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Role
            </label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              style={{ width: '100%', padding: '10px 12px', fontSize: 13,
                border: '1px solid #e2e8f0', borderRadius: 10, outline: 'none',
                background: '#fff', color: '#1e293b' }}>
              {Object.entries(ROLE_META).map(([r, m]) => (
                <option key={r} value={r}>{m.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" onClick={() => setShowNew(false)}
              style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none',
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1,
                boxShadow: saving ? 'none' : '0 3px 10px rgba(37,99,235,0.3)' }}>
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit user modal — name + optional password reset */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Edit — ${editUser?.full_name ?? editUser?.email ?? ''}`}>
        <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Full name
            </label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Key style={{ width: 13, height: 13 }} /> Reset password (optional)
            </label>
            <Input type="password" placeholder="Leave blank to keep current password"
              value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" onClick={() => setEditUser(null)}
              style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none',
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button type="submit" disabled={savingEdit}
              style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? .7 : 1,
                boxShadow: savingEdit ? 'none' : '0 3px 10px rgba(37,99,235,0.3)' }}>
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Permanently Remove User"
        description={`"${deleteTarget?.full_name ?? deleteTarget?.email}" will be permanently removed and can no longer sign in. This is different from deactivating — it cannot be undone through the UI. Consider deactivating instead unless this is truly final.`}
        confirmLabel="Permanently Remove"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
