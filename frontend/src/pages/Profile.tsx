import { useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { usersApi } from '@/api/client'
import { Card, Button, Input, Avatar, Badge, toast } from '@/components/ui'
import { User, Mail, Shield, Clock, Edit3, Save, X, Key } from 'lucide-react'
import { format } from 'date-fns'

const ROLE_INFO: Record<string, { label: string; color: 'red'|'blue'|'amber'|'green'|'gray'|'purple'; desc: string }> = {
  org_admin:        { label: 'Org Admin',        color: 'red',    desc: 'Full platform access' },
  project_admin:    { label: 'Project Admin',    color: 'blue',   desc: 'Manage assigned projects' },
  qa_lead:          { label: 'QA Lead',          color: 'purple', desc: 'Review + quarantine access' },
  pipeline_operator:{ label: 'Pipeline Operator',color: 'amber',  desc: 'Upload and trigger jobs' },
  reviewer:         { label: 'Reviewer',         color: 'green',  desc: 'Review and approve records' },
  read_only:        { label: 'Read Only',        color: 'gray',   desc: 'View only' },
}

export function ProfilePage() {
  const { user, fetchMe } = useAuthStore()
  const [editingName, setEditingName] = useState(false)
  const [editingPassword, setEditingPassword] = useState(false)
  const [name, setName] = useState(user?.full_name ?? '')
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [pwError, setPwError] = useState('')

  if (!user) return null

  const saveName = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await usersApi.update(user.id, { full_name: name })
      await fetchMe()
      setEditingName(false)
      toast.success('Name updated successfully')
    } catch {
      toast.error('Failed to update name')
    } finally {
      setSaving(false)
    }
  }

  const savePassword = async () => {
    setPwError('')
    if (passwords.new !== passwords.confirm) { setPwError('Passwords do not match'); return }
    if (passwords.new.length < 8) { setPwError('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await usersApi.update(user.id, { password: passwords.new })
      setEditingPassword(false)
      setPasswords({ current: '', new: '', confirm: '' })
      toast.success('Password updated successfully')
    } catch {
      toast.error('Failed to update password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account details and preferences</p>
      </div>

      {/* Identity card */}
      <Card className="p-6">
        <div className="flex items-start gap-5">
          <div className="relative">
            <Avatar name={user.full_name} size="lg" />
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between">
              {editingName ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="max-w-xs"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                  />
                  <Button size="sm" onClick={saveName} loading={saving}><Save className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setName(user.full_name) }}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ) : (
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{user.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                    <Mail className="w-3.5 h-3.5" />
                    {user.email}
                  </div>
                </div>
              )}
              {!editingName && (
                <Button variant="ghost" size="sm" onClick={() => setEditingName(true)}>
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {user.roles.map(role => {
                const info = ROLE_INFO[role]
                return info ? (
                  <div key={role} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-1.5 border border-gray-100">
                    <Badge variant={info.color}>{info.label}</Badge>
                    <span className="text-xs text-gray-500">{info.desc}</span>
                  </div>
                ) : null
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Account info */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-400" /> Account Details
        </h3>
        <div className="space-y-4">
          {[
            { label: 'User ID',       value: user.id,         mono: true },
            { label: 'Email address', value: user.email },
            { label: 'Account status',value: user.is_active ? 'Active' : 'Inactive' },
            { label: 'Member since',  value: format(new Date(user.created_at || Date.now()), 'MMMM d, yyyy') },
          ].map(({ label, value, mono }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-500">{label}</span>
              <span className={`text-sm font-medium text-gray-900 ${mono ? 'font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-lg' : ''}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Security */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" /> Security
        </h3>

        {editingPassword ? (
          <div className="space-y-4 max-w-sm">
            <Input label="New password" type="password" value={passwords.new} onChange={e => setPasswords(p => ({ ...p, new: e.target.value }))} placeholder="Min 8 characters" />
            <Input label="Confirm new password" type="password" value={passwords.confirm} onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat password" error={pwError} />
            <div className="flex gap-2">
              <Button size="sm" onClick={savePassword} loading={saving}><Save className="w-3.5 h-3.5" /> Save</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditingPassword(false); setPwError(''); setPasswords({ current:'',new:'',confirm:'' }) }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Password</p>
              <p className="text-xs text-gray-400 mt-0.5">Last changed: unknown</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditingPassword(true)}>
              <Key className="w-3.5 h-3.5" /> Change Password
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
