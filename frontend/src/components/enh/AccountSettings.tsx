import { useEffect, useState } from 'react'
import { BellRing, Copy, KeyRound, Mail, ShieldCheck, ShieldOff } from 'lucide-react'
import { enhApi } from '@/api/client'
import { Button, Card, Input, cn, toast } from '@/components/ui'
import { Chip } from '@/components/enh/kit'

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('relative w-10 h-6 rounded-full transition shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-200', on ? 'bg-brand-600' : 'bg-gray-300', disabled && 'opacity-50')}>
      <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
    </button>
  )
}

const group = (s: string) => s.replace(/(.{4})/g, '$1 ').trim()

/** Email preferences and two-step sign-in, shown on the Profile page. */
export function AccountSettings() {
  const [s, setS] = useState<any>(null)
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { enhApi.settings().then(setS).catch(() => {}) }, [])
  if (!s) return null

  const save = async (patch: { email_alerts?: boolean; email_digest?: boolean }) => {
    setS({ ...s, ...patch })
    try { setS(await enhApi.saveSettings(patch)) } catch { toast.error("Couldn't save"); enhApi.settings().then(setS) }
  }
  const start = async () => {
    setBusy(true)
    try { setSetup(await enhApi.totpSetup()); setCode('') } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't start the setup") } finally { setBusy(false) }
  }
  const enable = async () => {
    setBusy(true)
    try { setS(await enhApi.totpEnable(code)); setSetup(null); toast.success('Two-step sign-in is on') }
    catch (e: any) { toast.error(e?.response?.data?.detail || 'That code is not right') } finally { setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    try { setS(await enhApi.totpDisable(code, pw)); setDisabling(false); setCode(''); setPw(''); toast.success('Two-step sign-in is off') }
    catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't turn it off") } finally { setBusy(false) }
  }
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success('Copied') } catch { toast.error("Couldn't copy") } }

  return (
    <>
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><BellRing className="w-4 h-4 text-gray-400" /> Email alerts</h3>
        <p className="text-xs text-gray-400 mb-4">The banner and bell always work. Email is the extra nudge for when you are not in the app.</p>
        {!s.email_configured && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">Email isn't switched on for this platform yet, so nothing is sent. Your choices are saved for when it is.</p>
        )}
        <div className="divide-y divide-gray-50">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0"><p className="text-sm font-medium text-gray-800 m-0 flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-gray-400" /> Email me when something needs my action</p>
              <p className="text-xs text-gray-400 m-0 mt-0.5">Sent back for fixes, peer review requested, ready for sign-off, reminders.</p></div>
            <Switch on={s.email_alerts} onChange={v => save({ email_alerts: v })} label="Email alerts" />
          </div>
          {s.is_lead && (
            <div className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0"><p className="text-sm font-medium text-gray-800 m-0">Send me the daily digest</p>
                <p className="text-xs text-gray-400 m-0 mt-0.5">One morning email: what is waiting on whom, and what is overdue.</p></div>
              <Switch on={s.email_digest} onChange={v => save({ email_digest: v })} label="Daily digest" />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-400" /> Two-step sign-in {s.totp_enabled && <Chip tone="green">On</Chip>}</h3>
            <p className="text-xs text-gray-400 m-0 max-w-md">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) after your password. Recommended for admins.</p>
          </div>
          {!s.totp_enabled && !setup && <Button size="sm" onClick={start} loading={busy}><KeyRound className="w-3.5 h-3.5" /> Set up</Button>}
          {s.totp_enabled && !disabling && <Button size="sm" variant="secondary" onClick={() => { setDisabling(true); setCode('') }}><ShieldOff className="w-3.5 h-3.5" /> Turn off</Button>}
        </div>

        {setup && !s.totp_enabled && (
          <ol className="mt-5 space-y-4 m-0 pl-0 list-none text-sm text-gray-700">
            <li><b>1.</b> In your authenticator app choose <i>Add account</i>, then <i>Enter a setup key</i> and type this key.
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <code className="font-mono text-sm tracking-wider bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 select-all">{group(setup.secret)}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(setup.secret)}><Copy className="w-3.5 h-3.5" /> Copy</Button>
                <a href={setup.uri} className="text-xs font-semibold text-brand-600 hover:underline">Open in app on this phone</a>
              </div>
              <p className="text-xs text-gray-400 mt-1.5 mb-0">Keep this key somewhere safe. Anyone who has it can create your codes.</p></li>
            <li><b>2.</b> Type the 6-digit code your app now shows.
              <div className="mt-2 flex items-center gap-2 max-w-xs">
                <Input value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))} placeholder="123456" inputMode="numeric" maxLength={7} className="tracking-widest" />
                <Button onClick={enable} loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>Turn on</Button>
              </div></li>
          </ol>
        )}
        {disabling && (
          <div className="mt-5 grid sm:grid-cols-2 gap-3 max-w-lg">
            <Input label="Current code" value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))} placeholder="123456" inputMode="numeric" maxLength={7} />
            <Input label="Your password" type="password" value={pw} onChange={e => setPw(e.target.value)} />
            <div className="sm:col-span-2 flex gap-2">
              <Button size="sm" onClick={disable} loading={busy} disabled={code.replace(/\D/g, '').length !== 6 || !pw}>Turn off</Button>
              <Button size="sm" variant="secondary" onClick={() => setDisabling(false)}>Cancel</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4 mb-0">Lost your phone? Ask an org admin to reset it from the Users page. After 5 wrong sign-in attempts an account is locked for 15 minutes.</p>
      </Card>
    </>
  )
}
