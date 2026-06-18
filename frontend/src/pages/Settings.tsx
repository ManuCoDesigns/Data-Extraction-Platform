import { useState } from 'react'
import { Card, Button, Input, Select, Badge, toast } from '@/components/ui'
import { Settings2, Database, Cloud, Bell, Palette, Shield, Save, CheckCircle2, ExternalLink } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

type Tab = 'general' | 'storage' | 'notifications' | 'appearance'

export function SettingsPage() {
  const { user } = useAuthStore()
  const [tab, setTab] = useState<Tab>('general')
  const isAdmin = user?.roles.includes('org_admin')

  const tabs: { id: Tab; icon: any; label: string; adminOnly?: boolean }[] = [
    { id: 'general',       icon: Settings2, label: 'General' },
    { id: 'storage',       icon: Cloud,     label: 'Storage',       adminOnly: true },
    { id: 'notifications', icon: Bell,      label: 'Notifications' },
    { id: 'appearance',    icon: Palette,   label: 'Appearance' },
  ]

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure platform behaviour and integrations</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <aside className="w-48 shrink-0">
          <nav className="space-y-1">
            {tabs.filter(t => !t.adminOnly || isAdmin).map(({ id, icon: Icon, label, adminOnly }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  tab === id
                    ? 'bg-brand-50 text-brand-700 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {adminOnly && <Badge variant="purple" className="ml-auto text-xs px-1.5 py-0">Admin</Badge>}
              </button>
            ))}
          </nav>
        </aside>

        {/* Panel */}
        <div className="flex-1 min-w-0">
          {tab === 'general'       && <GeneralSettings />}
          {tab === 'storage'       && <StorageSettings />}
          {tab === 'notifications' && <NotificationSettings />}
          {tab === 'appearance'    && <AppearanceSettings />}
        </div>
      </div>
    </div>
  )
}

function GeneralSettings() {
  const [form, setForm] = useState({ platform_name: 'Xtrium DataOps', timezone: 'UTC', date_format: 'DD/MM/YYYY' })
  const save = () => toast.success('Settings saved')
  return (
    <Card className="p-6 space-y-5">
      <h2 className="text-base font-semibold text-gray-900">General</h2>
      <Input label="Platform name" value={form.platform_name} onChange={e => setForm(f => ({ ...f, platform_name: e.target.value }))} />
      <Select label="Timezone" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}>
        <option value="UTC">UTC</option>
        <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
        <option value="Europe/London">Europe/London</option>
        <option value="America/New_York">America/New_York</option>
        <option value="Asia/Dubai">Asia/Dubai</option>
      </Select>
      <Select label="Date format" value={form.date_format} onChange={e => setForm(f => ({ ...f, date_format: e.target.value }))}>
        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
        <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
      </Select>
      <div className="pt-2 border-t border-gray-100 flex justify-end">
        <Button onClick={save}><Save className="w-4 h-4" /> Save Changes</Button>
      </div>
    </Card>
  )
}

function StorageSettings() {
  const [form, setForm] = useState({
    provider: 'r2',
    endpoint_url: '',
    access_key_id: '',
    secret_access_key: '',
    bucket: 'xtrium-uploads',
    region: 'auto',
  })

  const save = () => toast.info('This panel is a copy-paste helper, not a live integration — set these as actual Railway environment variables')

  const providerHint = form.provider === 'r2'
    ? 'Cloudflare dashboard → R2 → your bucket → Manage API tokens'
    : 'AWS Console → IAM → your access key, and S3 → your bucket region'

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <h2 className="text-base font-semibold text-gray-900">Object Storage</h2>
        <a href={form.provider === 'r2' ? 'https://developers.cloudflare.com/r2/' : 'https://docs.aws.amazon.com/s3/'} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
          Docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <p className="text-sm font-medium text-amber-800">This panel doesn't save anything yet</p>
        <p className="text-xs text-amber-700 mt-1">
          There's no backend endpoint wired to this form. Use it to draft the values, then copy the
          generated block below into your actual Railway environment variables.
        </p>
      </div>

      <Select label="Storage provider" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>
        <option value="r2">Cloudflare R2</option>
        <option value="s3">AWS S3</option>
      </Select>

      <Input label="Endpoint URL" value={form.endpoint_url} onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
        placeholder={form.provider === 'r2' ? 'https://<account_id>.r2.cloudflarestorage.com' : 'https://s3.<region>.amazonaws.com'}
        hint={providerHint} />

      <Input label="Access Key ID" value={form.access_key_id} onChange={e => setForm(f => ({ ...f, access_key_id: e.target.value }))}
        placeholder="AKIA... or R2 token key" />

      <Input label="Secret Access Key" type="password" value={form.secret_access_key} onChange={e => setForm(f => ({ ...f, secret_access_key: e.target.value }))}
        placeholder="••••••••" />

      <Input label="Bucket name" value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))}
        hint="Create this bucket with your provider first" />

      <Input label="Region" value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
        hint="R2 uses 'auto'; AWS S3 needs the real region (e.g. us-east-1)" />

      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-xs font-semibold text-gray-700 mb-2">Set these in Railway → backend service → Variables:</p>
        <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">
{`STORAGE_PROVIDER=s3
S3_ENDPOINT_URL=${form.endpoint_url || '(see hint above)'}
S3_ACCESS_KEY_ID=${form.access_key_id || 'your-access-key'}
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=${form.bucket}
S3_REGION=${form.region}`}
        </pre>
      </div>

      <div className="pt-2 border-t border-gray-100 flex justify-end">
        <Button onClick={save}><Save className="w-4 h-4" /> Copy Reminder</Button>
      </div>
    </Card>
  )
}

function NotificationSettings() {
  const [prefs, setPrefs] = useState({
    job_ready:     { inapp: true,  email: false },
    record_flagged:{ inapp: true,  email: true  },
    submission:    { inapp: true,  email: true  },
    llm_failed:    { inapp: true,  email: false },
  })

  const labels: Record<string, string> = {
    job_ready:      'Job ready for review',
    record_flagged: 'Record escalated / flagged',
    submission:     'Batch submitted',
    llm_failed:     'LLM review failed',
  }

  const toggle = (key: string, channel: 'inapp' | 'email') => {
    setPrefs(p => ({ ...p, [key]: { ...p[key as keyof typeof p], [channel]: !p[key as keyof typeof p][channel] } }))
  }

  return (
    <Card className="p-6 space-y-5">
      <h2 className="text-base font-semibold text-gray-900">Notification Preferences</h2>
      <div className="space-y-1">
        <div className="grid grid-cols-3 text-xs font-medium text-gray-400 uppercase tracking-wide pb-2 border-b border-gray-100">
          <span>Event</span>
          <span className="text-center">In-app</span>
          <span className="text-center">Email</span>
        </div>
        {Object.entries(prefs).map(([key, val]) => (
          <div key={key} className="grid grid-cols-3 items-center py-3 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-700">{labels[key]}</span>
            {(['inapp', 'email'] as const).map(ch => (
              <div key={ch} className="flex justify-center">
                <button
                  onClick={() => toggle(key, ch)}
                  className={`w-10 h-5.5 rounded-full transition-all duration-200 relative ${val[ch] ? 'bg-brand-600' : 'bg-gray-200'}`}
                  style={{ height: 22 }}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${val[ch] ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="pt-2 flex justify-end">
        <Button onClick={() => toast.success('Notification preferences saved')}><Save className="w-4 h-4" /> Save</Button>
      </div>
    </Card>
  )
}

function AppearanceSettings() {
  const [theme, setTheme] = useState('light')
  const [density, setDensity] = useState('comfortable')

  return (
    <Card className="p-6 space-y-6">
      <h2 className="text-base font-semibold text-gray-900">Appearance</h2>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Theme</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'light', label: 'Light', bg: 'bg-white', border: 'border-gray-200' },
            { id: 'dark',  label: 'Dark',  bg: 'bg-slate-900', border: 'border-slate-700' },
            { id: 'auto',  label: 'System', bg: 'bg-gradient-to-br from-white to-slate-900', border: 'border-gray-300' },
          ].map(t => (
            <button key={t.id} onClick={() => { setTheme(t.id); toast.info('Theme switching coming soon') }}
              className={`relative p-3 rounded-xl border-2 transition ${theme === t.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className={`h-12 rounded-lg mb-2 ${t.bg} border ${t.border}`} />
              <p className="text-xs font-medium text-gray-700">{t.label}</p>
              {theme === t.id && <CheckCircle2 className="absolute top-2 right-2 w-4 h-4 text-brand-600" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Display density</p>
        <Select value={density} onChange={e => setDensity(e.target.value)}>
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </Select>
      </div>

      <div className="pt-2 border-t border-gray-100 flex justify-end">
        <Button onClick={() => toast.success('Appearance settings saved')}><Save className="w-4 h-4" /> Save</Button>
      </div>
    </Card>
  )
}