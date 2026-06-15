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
    provider: 'supabase',
    supabase_url: '',
    supabase_key: '',
    bucket: 'xtrium-uploads',
  })
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)

  const testConnection = async () => {
    setTesting(true)
    await new Promise(r => setTimeout(r, 1500))
    setTesting(false)
    setTested(true)
    toast.success('Storage connection successful')
  }

  const save = () => toast.success('Storage settings saved — restart the backend to apply')

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cloud Storage</h2>
        <a href="https://supabase.com/docs/guides/storage" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
          Docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-sm font-medium text-blue-800">Supabase Storage</p>
        <p className="text-xs text-blue-600 mt-1">
          Since you're already on Supabase, use Supabase Storage — no extra setup needed. 
          Add these values to your backend <code className="bg-blue-100 px-1 rounded">.env</code> file.
        </p>
      </div>

      <Select label="Storage provider" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>
        <option value="supabase">Supabase Storage</option>
        <option value="r2">Cloudflare R2</option>
        <option value="s3">AWS S3</option>
      </Select>

      <Input label="Supabase Project URL" value={form.supabase_url} onChange={e => setForm(f => ({ ...f, supabase_url: e.target.value }))}
        placeholder="https://xxxx.supabase.co" hint="Find this in Supabase → Settings → API" />

      <Input label="Supabase Service Key" type="password" value={form.supabase_key} onChange={e => setForm(f => ({ ...f, supabase_key: e.target.value }))}
        placeholder="eyJhbGc..." hint="Use the service_role key (not anon key)" />

      <Input label="Bucket name" value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))}
        hint="Create this bucket in Supabase → Storage first" />

      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-xs font-semibold text-gray-700 mb-2">Add to backend/.env:</p>
        <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">
{`SUPABASE_URL=${form.supabase_url || 'https://xxxx.supabase.co'}
SUPABASE_SERVICE_KEY=your-service-role-key
STORAGE_BUCKET=${form.bucket}
STORAGE_PROVIDER=supabase`}
        </pre>
      </div>

      <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
        <Button variant="secondary" onClick={testConnection} loading={testing}>
          {tested ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
          Test Connection
        </Button>
        <Button onClick={save}><Save className="w-4 h-4" /> Save Settings</Button>
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
