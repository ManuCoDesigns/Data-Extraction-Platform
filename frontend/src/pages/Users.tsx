import { useEffect, useState } from 'react'
import { Users as UsersIcon, Plus, Shield, Edit3, Trash2, Search, Mail } from 'lucide-react'
import { usersApi } from '@/api/client'
import { Modal, Input, Select, toast } from '@/components/ui'
import { useCapability } from '@/lib/permissions'
import type { User } from '@/types'

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  org_admin:        { label: 'Org Admin',        color: '#dc2626', bg: '#fef2f2' },
  project_admin:    { label: 'Project Admin',    color: '#d97706', bg: '#fffbeb' },
  qa_lead:          { label: 'QA Lead',          color: '#7c3aed', bg: '#faf5ff' },
  pipeline_operator:{ label: 'Extractor',        color: '#2563eb', bg: '#eff6ff' },
  reviewer:         { label: 'Reviewer',         color: '#059669', bg: '#ecfdf5' },
  read_only:        { label: 'Read Only',        color: '#64748b', bg: '#f1f5f9' },
}

export function UsersPage() {
  const [users,   setUsers]   = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'pipeline_operator' })
  const [saving, setSaving] = useState(false)
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

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await usersApi.create(form)
      toast.success('User created successfully')
      setShowNew(false)
      setForm({ full_name: '', email: '', password: '', role: 'pipeline_operator' })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create user')
    } finally { setSaving(false) }
  }

  const updateRole = async (userId: string, role: string) => {
    try {
      await usersApi.updateRole(userId, role)
      toast.success('Role updated')
      load()
    } catch { toast.error('Failed to update role') }
  }

  const deactivate = async (userId: string) => {
    if (!confirm('Deactivate this user?')) return
    try {
      await usersApi.deactivate(userId)
      toast.success('User deactivated')
      load()
    } catch { toast.error('Failed to deactivate user') }
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
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Members</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {users.length} member{users.length !== 1 ? 's' : ''} · manage access and roles
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowNew(true)} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)', color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            <Plus style={{ width: 16, height: 16 }} /> Add Member
          </button>
        )}
      </div>

      {/* Role breakdown */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(ROLE_META).map(([role, meta]) => (
          roleCounts[role] ? (
            <div key={role} style={{ padding: '6px 14px', borderRadius: 20,
              background: meta.bg, border: `1px solid ${meta.color}30`,
              fontSize: 12, fontWeight: 600, color: meta.color }}>
              {meta.label}: {roleCounts[role]}
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
            background: '#fff', color: '#1e293b', boxSizing: 'border-box' }}
          onFocus={e => e.target.style.borderColor='#2563eb'}
          onBlur={e => e.target.style.borderColor='#e2e8f0'} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Member','Email','Role','Status','Joined',''].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em' }}>
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
                  const rm   = ROLE_META[role] ?? { label: role, color: '#64748b', bg: '#f1f5f9' }
                  const isActive = (u as any).is_active !== false
                  return (
                    <tr key={u.id}
                      style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
                        opacity: isActive ? 1 : 0.5 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                            background: `linear-gradient(135deg,${rm.color},${rm.color}99)`,
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
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#94a3b8' }}>
                        {(u as any).created_at ? new Date((u as any).created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {canManage && isActive && (
                          <button onClick={() => deactivate(u.id)}
                            title="Deactivate user"
                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                              color: '#94a3b8', padding: 4, borderRadius: 6 }}>
                            <Trash2 style={{ width: 15, height: 15 }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
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
              style={{ padding: '9px 18px', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1 }}>
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
