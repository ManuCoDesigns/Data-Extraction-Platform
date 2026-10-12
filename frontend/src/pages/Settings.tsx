import { useEffect, useState } from 'react'
import { Bell, Check, Clock, Cloud, ExternalLink, Info, Settings2 } from 'lucide-react'
import { toast } from '@/components/ui'
import { AccountSettings } from '@/components/enh/AccountSettings'
import { Panel, SelectBox, PageHeader, PAGE } from '@/components/enh/kit'
import { TIMEZONES, fmtDateTime, usePrefs, type Prefs } from '@/lib/prefs'
import { useAuthStore } from '@/store/auth'
import { useTheme, type ThemeChoice } from '@/lib/theme'

type Tab = 'general' | 'notifications' | 'storage'

const TABS: { id: Tab; icon: any; label: string; adminOnly?: boolean }[] = [
  { id: 'general',       icon: Settings2, label: 'Display' },
  { id: 'notifications', icon: Bell,      label: 'Alerts and security' },
  { id: 'storage',       icon: Cloud,     label: 'Storage', adminOnly: true },
]

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--bd-f1f5f9)' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-0f172a)', margin: 0 }}>{title}</p>
        {description && <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>{description}</p>}
      </div>
      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  )
}


// ── Display: timezone, date and time format, saved on your account ────────────
function DisplaySettings() {
  const { prefs, save } = usePrefs()
  const [draft, setDraft] = useState<Prefs>(prefs)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(prefs) }, [prefs])
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs)
  const zones = TIMEZONES.some(z => z.value === draft.timezone) ? TIMEZONES : [{ value: draft.timezone, label: draft.timezone }, ...TIMEZONES]
  const sample = fmtDateTime(new Date(), draft)

  const submit = async () => {
    setSaving(true)
    try { await save(draft); toast.success('Display settings saved') }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't save your settings") }
    finally { setSaving(false) }
  }

  const radio = (label: string, selected: boolean, onPick: () => void, hint?: string) => (
    <button key={label} type="button" role="radio" aria-checked={selected} onClick={onPick}
      className={'flex items-center gap-3 text-left px-4 py-3 rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-brand-200 ' +
        (selected ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:bg-gray-50')}>
      <span className={'w-4 h-4 rounded-full border-2 grid place-items-center shrink-0 ' + (selected ? 'border-brand-600' : 'border-gray-300')}>
        {selected && <span className="w-2 h-2 rounded-full bg-brand-600" />}
      </span>
      <span className="min-w-0"><span className="block text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="block text-xs text-gray-400 tabular-nums">{hint}</span>}</span>
    </button>
  )
  const today = new Date()
  const theme = useTheme()
  return (
    <div className="space-y-5">
    <Panel title="Appearance" subtitle="Dark is the default. This is saved on this device, so each browser can have its own.">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {([['dark', 'Dark', 'Easier on the eyes at night'], ['light', 'Light', 'Bright, like paper'], ['system', 'Match my device', 'Follows your system setting']] as [ThemeChoice, string, string][]).map(([k, label, hint]) =>
          radio(label, theme.choice === k, () => theme.set(k), hint))}
      </div>
      <p className="text-xs text-gray-400 mt-3 mb-0">Tip: press Ctrl+B (or ⌘B) to collapse the sidebar into icons.</p>
    </Panel>
    <Panel title="Dates and times" subtitle="Used for every date and time you see in the platform. Saved to your account, so it follows you to any device.">
      <div className="space-y-6">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5" htmlFor="tz">Timezone</label>
          <SelectBox label="Timezone" value={draft.timezone} onChange={v => setDraft({ ...draft, timezone: v })} className="w-full sm:w-80">
            {zones.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
          </SelectBox>
        </div>
        <div role="radiogroup" aria-label="Date format">
          <p className="text-xs font-semibold text-gray-600 mb-1.5 m-0">Date format</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([['DMY', 'Day first'], ['MDY', 'Month first'], ['YMD', 'Year first']] as const).map(([k, label]) =>
              radio(label, draft.date_format === k, () => setDraft({ ...draft, date_format: k }), fmtDateTime(today, { ...draft, date_format: k }).split(' ')[0]))}
          </div>
        </div>
        <div role="radiogroup" aria-label="Time format">
          <p className="text-xs font-semibold text-gray-600 mb-1.5 m-0">Time format</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([['24h', '24-hour'], ['12h', '12-hour']] as const).map(([k, label]) =>
              radio(label, draft.time_format === k, () => setDraft({ ...draft, time_format: k }), fmtDateTime(today, { ...draft, time_format: k }).split(' ').slice(1).join(' ')))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 m-0 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-gray-400" /> Right now this reads <b className="text-gray-700 tabular-nums">{sample}</b></p>
          <button type="button" onClick={submit} disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition focus:outline-none focus:ring-2 focus:ring-brand-200">
            <Check className="w-4 h-4" /> {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      </div>
    </Panel>
    </div>
  )
}

// ── Storage Settings ──────────────────────────────────────────────────────────
function StorageSettings() {
  const [form, setForm] = useState({ provider: 'r2', endpoint_url: '', access_key_id: '', bucket: '-uploads', region: 'auto' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--bg-fff7ed)', border: '1px solid var(--bd-fed7aa)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10 }}>
        <Info style={{ width: 16, height: 16, color: 'var(--tx-d97706)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-92400e)', margin: '0 0 3px' }}>Set these in Railway environment variables</p>
          <p style={{ fontSize: 12, color: 'var(--tx-b45309)', margin: 0, lineHeight: 1.5 }}>This panel helps you draft values. The actual storage config must be set directly in Railway → backend service → Variables — not through this UI.</p>
        </div>
      </div>

      <SectionCard title="Object Storage" description="Configure Cloudflare R2 or AWS S3 for file uploads.">
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>Storage provider</label>
          <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, fontSize: 13, outline: 'none' }}>
            <option value="r2">Cloudflare R2 (recommended)</option>
            <option value="s3">AWS S3</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>Endpoint URL</label>
          <input value={form.endpoint_url} onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
            placeholder={form.provider === 'r2' ? 'https://<account_id>.r2.cloudflarestorage.com' : 'https://s3.<region>.amazonaws.com'}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>Bucket name</label>
            <input value={form.bucket} onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)', marginBottom: 6 }}>Region</label>
            <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
              placeholder="auto (R2) or us-east-1 (S3)"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
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
            style={{ fontSize: 12, color: 'var(--tx-2563eb)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ExternalLink style={{ width: 12, height: 12 }} /> Provider docs
          </a>
          <button onClick={() => { navigator.clipboard.writeText(`STORAGE_PROVIDER=s3\nS3_ENDPOINT_URL=${form.endpoint_url || '<your-endpoint>'}\nS3_ACCESS_KEY_ID=<paste>\nS3_SECRET_ACCESS_KEY=<paste>\nS3_BUCKET_NAME=${form.bucket}\nS3_REGION=${form.region}`); toast.success('Copied to clipboard') }}
            style={{ padding: '7px 16px', background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--tx-374151)' }}>
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
    <div className={PAGE} style={{ maxWidth: 960 }}>
      <PageHeader title="Settings" subtitle="Your display choices, alerts and sign-in security." />
      <div className="flex flex-col md:flex-row gap-5">
        <nav className="md:w-52 shrink-0 flex md:flex-col gap-1 overflow-x-auto" aria-label="Settings sections">
          {visibleTabs.map(({ id, icon: Icon, label, adminOnly }) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
              className={'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-left whitespace-nowrap transition focus:outline-none focus:ring-2 focus:ring-brand-200 ' +
                (tab === id ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100')}>
              <Icon className="w-4 h-4 shrink-0" /> {label}
              {adminOnly && <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">Admin</span>}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 space-y-5">
          {tab === 'general' && <DisplaySettings />}
          {tab === 'notifications' && <AccountSettings />}
          {tab === 'storage' && <StorageSettings />}
        </div>
      </div>
    </div>
  )
}
