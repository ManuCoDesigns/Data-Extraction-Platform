import { useState } from 'react'
import { Save, Settings2, Bell, Palette, Cloud, ExternalLink, CheckCircle2, Info } from 'lucide-react'
import { Button, Input, Select, toast } from '@/components/ui'
import { useAuthStore } from '@/store/auth'

type Tab = 'general' | 'notifications' | 'appearance' | 'storage'

const TABS: { id: Tab; icon: any; label: string; adminOnly?: boolean }[] = [
  { id: 'general',       icon: Settings2, label: 'General' },
  { id: 'notifications', icon: Bell,      label: 'Notifications' },
  { id: 'appearance',    icon: Palette,   label: 'Appearance' },
  { id: 'storage',       icon: Cloud,     label: 'Storage',    adminOnly: true },
]

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</p>
        {description && <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>{description}</p>}
      </div>
      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      style={{ width: 40, height: 22, borderRadius: 99, border: 'none', cursor: 'pointer', position: 'relative', background: checked ? '#2563eb' : '#e2e8f0', transition: 'background 0.2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', left: checked ? 21 : 3, transition: 'left 0.2s' }} />
    </button>
  )
}

// ── General Settings ──────────────────────────────────────────────────────────
function GeneralSettings() {
  const [form, setForm] = useState({ platform_name: 'Data Extraction', timezone: 'Africa/Nairobi', date_format: 'DD/MM/YYYY' })
  const [saved, setSaved] = useState(false)

  const save = () => { setSaved(true); toast.success('General settings saved'); setTimeout(() => setSaved(false), 2000) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionCard title="Platform" description="Basic configuration for the platform display.">
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Platform name</label>
          <input value={form.platform_name} onChange={e => setForm(f => ({ ...f, platform_name: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Timezone</label>
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }}>
              <option value="Africa/Nairobi">Africa/Nairobi (EAT +3)</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST +4)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Date format</label>
            <select value={form.date_format} onChange={e => setForm(f => ({ ...f, date_format: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO 8601)</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
          <button onClick={save}
            style={{ padding: '8px 20px', background: saved ? '#059669' : '#2563eb', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.2s' }}>
            {saved ? <><CheckCircle2 style={{ width: 14, height: 14 }} /> Saved</> : <><Save style={{ width: 14, height: 14 }} /> Save Changes</>}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Platform Info" description="Read-only system information.">
        {[
          { label: 'Version',   value: 'Data Extraction v2.0' },
          { label: 'Built by',  value: 'Emmanuel Otieno · otienoemmanuel683@gmail.com' },
          { label: 'Backend',   value: 'FastAPI + PostgreSQL (Railway)' },
          { label: 'Frontend',  value: 'React + Vite + TypeScript (Vercel)' },
          { label: 'AI Engine', value: 'Claude (Anthropic) — extraction + LLM verify' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f8fafc', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: 12, color: '#1e293b', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

// ── Notification Settings ─────────────────────────────────────────────────────
function NotificationSettings() {
  const [prefs, setPrefs] = useState({
    source_ready:    { inapp: true,  email: false, label: 'Source ready for review' },
    record_rejected: { inapp: true,  email: false, label: 'Record sent back for fixes' },
    source_approved: { inapp: true,  email: true,  label: 'Source approved' },
    batch_submitted: { inapp: true,  email: true,  label: 'Records submitted to client' },
    llm_flagged:     { inapp: true,  email: false, label: 'LLM verification flagged records' },
    schema_error:    { inapp: true,  email: false, label: 'Schema validation errors on upload' },
  })

  const toggle = (key: string, channel: 'inapp' | 'email') => {
    setPrefs(p => ({ ...p, [key]: { ...p[key as keyof typeof p], [channel]: !p[key as keyof typeof p][channel] } }))
  }

  return (
    <SectionCard title="Notification Preferences" description="Choose which events trigger notifications.">
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8, display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Event</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center' }}>In-app</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center' }}>Email</span>
      </div>
      {Object.entries(prefs).map(([key, val]) => (
        <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f8fafc' }}>
          <span style={{ fontSize: 13, color: '#374151' }}>{val.label}</span>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle checked={val.inapp} onChange={v => toggle(key, 'inapp')} /></div>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle checked={val.email} onChange={v => toggle(key, 'email')} /></div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
        <button onClick={() => toast.success('Notification preferences saved')}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Save style={{ width: 14, height: 14 }} /> Save Preferences
        </button>
      </div>
    </SectionCard>
  )
}

// ── Appearance ────────────────────────────────────────────────────────────────
function AppearanceSettings() {
  const [theme, setTheme]     = useState('light')
  const [density, setDensity] = useState('comfortable')

  const THEMES = [
    { id: 'light', label: 'Light', top: '#fff', bottom: '#f8fafc' },
    { id: 'dark',  label: 'Dark',  top: '#0f172a', bottom: '#1e293b' },
    { id: 'auto',  label: 'System', top: '#fff', bottom: '#0f172a' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionCard title="Theme" description="Choose your preferred colour scheme.">
        <div style={{ display: 'flex', gap: 12 }}>
          {THEMES.map(t => (
            <button key={t.id} onClick={() => { setTheme(t.id); if (t.id !== 'light') toast.info('Dark mode coming soon — stay tuned!') }}
              style={{ flex: 1, padding: '4px', border: `2px solid ${theme === t.id ? '#2563eb' : '#e2e8f0'}`, borderRadius: 14, background: 'none', cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s' }}>
              <div style={{ height: 70, borderRadius: 10, overflow: 'hidden', background: `linear-gradient(180deg, ${t.top} 50%, ${t.bottom} 100%)`, border: '1px solid #e2e8f0' }}>
                {/* Mini sidebar + content preview */}
                <div style={{ display: 'flex', height: '100%' }}>
                  <div style={{ width: 24, background: theme === t.id ? '#1e293b' : '#f1f5f9', borderRight: `1px solid ${theme === t.id ? '#334155' : '#e2e8f0'}' ` }} />
                  <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, width: '70%' }} />
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, width: '50%' }} />
                    <div style={{ height: 6, background: '#bfdbfe', borderRadius: 3, width: '60%', marginTop: 4 }} />
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: theme === t.id ? '#2563eb' : '#64748b', margin: '6px 0 2px', textAlign: 'center' }}>{t.label}</p>
              {theme === t.id && <CheckCircle2 style={{ position: 'absolute', top: 8, right: 8, width: 16, height: 16, color: '#2563eb' }} />}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Display Density" description="Control spacing and table row height.">
        <div style={{ display: 'flex', gap: 8 }}>
          {['Compact', 'Comfortable', 'Spacious'].map(d => (
            <button key={d} onClick={() => { setDensity(d.toLowerCase()); toast.success(`Density set to ${d}`) }}
              style={{ flex: 1, padding: '10px', border: `2px solid ${density === d.toLowerCase() ? '#2563eb' : '#e2e8f0'}`, borderRadius: 10, background: density === d.toLowerCase() ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: density === d.toLowerCase() ? '#2563eb' : '#64748b', transition: 'all 0.15s' }}>
              {d}
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ── Storage Settings ──────────────────────────────────────────────────────────
function StorageSettings() {
  const [form, setForm] = useState({ provider: 'r2', endpoint_url: '', access_key_id: '', bucket: 'xtrium-uploads', region: 'auto' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10 }}>
        <Info style={{ width: 16, height: 16, color: '#d97706', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#92400e', margin: '0 0 3px' }}>Set these in Railway environment variables</p>
          <p style={{ fontSize: 12, color: '#b45309', margin: 0, lineHeight: 1.5 }}>This panel helps you draft values. The actual storage config must be set directly in Railway → backend service → Variables — not through this UI.</p>
        </div>
      </div>

      <SectionCard title="Object Storage" description="Configure Cloudflare R2 or AWS S3 for file uploads.">
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Storage provider</label>
          <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }}>
            <option value="r2">Cloudflare R2 (recommended)</option>
            <option value="s3">AWS S3</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Endpoint URL</label>
          <input value={form.endpoint_url} onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
            placeholder={form.provider === 'r2' ? 'https://<account_id>.r2.cloudflarestorage.com' : 'https://s3.<region>.amazonaws.com'}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Bucket name</label>
            <input value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Region</label>
            <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
              placeholder="auto (R2) or us-east-1 (S3)"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Railway Variables Block" description="Copy this directly into Railway → backend → Variables.">
        <pre style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: 10, padding: '14px 16px', fontSize: 12, fontFamily: 'monospace', margin: 0, lineHeight: 1.8, overflowX: 'auto' }}>
{`STORAGE_PROVIDER=${form.provider === 'r2' ? 's3' : 's3'}
S3_ENDPOINT_URL=${form.endpoint_url || '<your-endpoint>'}
S3_ACCESS_KEY_ID=<paste-from-provider>
S3_SECRET_ACCESS_KEY=<paste-from-provider>
S3_BUCKET_NAME=${form.bucket}
S3_REGION=${form.region}`}
        </pre>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href={form.provider === 'r2' ? 'https://developers.cloudflare.com/r2/' : 'https://docs.aws.amazon.com/s3/'} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ExternalLink style={{ width: 12, height: 12 }} /> Provider docs
          </a>
          <button onClick={() => { navigator.clipboard.writeText(`STORAGE_PROVIDER=s3\nS3_ENDPOINT_URL=${form.endpoint_url || '<your-endpoint>'}\nS3_ACCESS_KEY_ID=<paste>\nS3_SECRET_ACCESS_KEY=<paste>\nS3_BUCKET_NAME=${form.bucket}\nS3_REGION=${form.region}`); toast.success('Copied to clipboard') }}
            style={{ padding: '7px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
            Copy block
          </button>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export function SettingsPage() {
  const { user } = useAuthStore()
  const [tab, setTab] = useState<Tab>('general')
  const isAdmin = user?.roles?.includes('org_admin')

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin)

  return (
    <div style={{ padding: '32px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0 }}>Settings</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Configure platform behaviour and preferences</p>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Sidebar */}
        <aside style={{ width: 190, flexShrink: 0 }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visibleTabs.map(({ id, icon: Icon, label, adminOnly }) => (
              <button key={id} onClick={() => setTab(id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 600, transition: 'all 0.15s', background: tab === id ? '#eff6ff' : 'transparent', color: tab === id ? '#2563eb' : '#64748b' }}>
                <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
                {label}
                {adminOnly && <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#faf5ff', color: '#7c3aed', border: '1px solid #c4b5fd' }}>Admin</span>}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === 'general'       && <GeneralSettings />}
          {tab === 'notifications' && <NotificationSettings />}
          {tab === 'appearance'    && <AppearanceSettings />}
          {tab === 'storage'       && <StorageSettings />}
        </div>
      </div>
    </div>
  )
}
