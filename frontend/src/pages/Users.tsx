import { useEffect, useState } from 'react'
import { Plus, Search, Trash2, Edit3, UserCheck, UserX, Info } from 'lucide-react'
import { usersApi } from '@/api/client'
import type { User } from '@/types'
import { Button, Card, Badge, Modal, Input, Select, EmptyState, Spinner, ConfirmDialog, Avatar, cn, toast } from '@/components/ui'
import { ROLE_META, getRoleLabel } from '@/lib/permissions'
import { formatDistanceToNow } from 'date-fns'

const ROLES = ['org_admin', 'project_admin', 'qa_lead', 'pipeline_operator', 'reviewer', 'read_only']

const BADGE_VARIANT: Record<string, 'red'|'amber'|'blue'|'green'|'purple'|'gray'> = {
  org_admin:        'red',
  project_admin:    'amber',
  qa_lead:          'blue',
  pipeline_operator:'green',
  reviewer:         'purple',
  read_only:        'gray',
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'pipeline_operator', is_active: true })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showRoleInfo, setShowRoleInfo] = useState(false)

  const load = () => usersApi.list().then(setUsers).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const filtered = users.filter(u => {
    const matchesSearch =
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = !roleFilter || u.roles.includes(roleFilter)
    return matchesSearch && matchesRole
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await usersApi.create({ ...form, roles: [form.role] })
      toast.success(`${form.full_name} added as ${getRoleLabel(form.role)}`)
      setShowCreate(false)
      resetForm()
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create user')
    } finally { setSaving(false) }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSaving(true)
    try {
      await usersApi.update(editUser.id, {
        full_name: form.full_name,
        roles: [form.role],
        is_active: form.is_active,
        ...(form.password ? { password: form.password } : {}),
      })
      toast.success('User updated')
      setEditUser(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update user')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await usersApi.delete(deleteTarget.id)
      toast.success(`${deleteTarget.full_name} deactivated`)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to deactivate user')
    } finally { setDeleting(false) }
  }

  const openEdit = (u: User) => {
    setEditUser(u)
    setForm({ full_name: u.full_name, email: u.email, password: '', role: u.roles[0] ?? 'pipeline_operator', is_active: u.is_active ?? true })
  }

  const resetForm = () => setForm({ full_name: '', email: '', password: '', role: 'pipeline_operator', is_active: true })

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>

  const activeCount = users.filter(u => u.is_active !== false).length

  // Group counts by role for the summary row
  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.roles.includes(r) && u.is_active !== false).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">{activeCount} active · {users.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRoleInfo(true)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
            title="About roles"
          >
            <Info className="w-4 h-4" />
          </button>
          <Button onClick={() => { resetForm(); setShowCreate(true) }}>
            <Plus className="w-4 h-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Role summary chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRoleFilter('')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
            roleFilter === '' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          )}
        >
          All ({activeCount})
        </button>
        {ROLES.filter(r => roleCounts[r] > 0).map(r => (
          <button
            key={r}
            onClick={() => setRoleFilter(roleFilter === r ? '' : r)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition',
              roleFilter === r
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {getRoleLabel(r)} ({roleCounts[r]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text" placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="No users found" description={search || roleFilter ? 'Try clearing your filters.' : 'Add your first team member.'} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Role</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Added</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(u => {
                const isInactive = u.is_active === false
                return (
                  <tr key={u.id} className={cn('hover:bg-gray-50/60 transition', isInactive && 'opacity-50')}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.full_name} size="sm" />
                        <div>
                          <p className="font-medium text-gray-900">{u.full_name}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map(r => (
                          <Badge key={r} variant={BADGE_VARIANT[r] ?? 'gray'}>
                            {getRoleLabel(r)}
                          </Badge>
                        ))}
                        {u.roles.length === 0 && <span className="text-xs text-gray-400">No role</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      {!isInactive
                        ? <Badge variant="green"><UserCheck className="w-3 h-3" /> Active</Badge>
                        : <Badge variant="gray"><UserX className="w-3 h-3" /> Inactive</Badge>}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400 hidden lg:table-cell">
                      {u.created_at ? formatDistanceToNow(new Date(u.created_at), { addSuffix: true }) : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(u)}
                          className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition"
                          title="Edit user">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(u)}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                          title="Deactivate user">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Add user modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Team Member" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" required autoFocus />
            <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" required />
          </div>
          <Input label="Temporary password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="They can change this after logging in" required />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {ROLES.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
            </select>
            {ROLE_META[form.role] && (
              <p className="text-xs text-gray-500 mt-1.5 pl-1">{ROLE_META[form.role].description}</p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.full_name || !form.email || !form.password}>
              <Plus className="w-4 h-4" /> Add User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit user modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Edit User" size="md">
        <form onSubmit={handleEdit} className="space-y-4">
          <Input label="Full name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required autoFocus />
          <div className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
            Email: <strong className="text-gray-700">{editUser?.email}</strong> — cannot be changed
          </div>
          <Input label="New password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank to keep current password" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {ROLES.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
            </select>
            {ROLE_META[form.role] && (
              <p className="text-xs text-gray-500 mt-1.5 pl-1">{ROLE_META[form.role].description}</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-gray-700 font-medium">Account active</span>
            <span className="text-gray-400">(uncheck to suspend access)</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!form.full_name}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* Role reference modal */}
      <Modal open={showRoleInfo} onClose={() => setShowRoleInfo(false)} title="Role Reference" size="md">
        <div className="space-y-3">
          {ROLES.map(r => (
            <div key={r} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
              <Badge variant={BADGE_VARIANT[r] ?? 'gray'} className="shrink-0 mt-0.5">{getRoleLabel(r)}</Badge>
              <p className="text-sm text-gray-600">{ROLE_META[r]?.description}</p>
            </div>
          ))}
        </div>
      </Modal>

      {/* Deactivate confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Deactivate User"
        description={`${deleteTarget?.full_name} (${deleteTarget?.email}) will lose access immediately. You can restore them later by editing the account and setting it back to active.`}
        confirmLabel="Deactivate"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
