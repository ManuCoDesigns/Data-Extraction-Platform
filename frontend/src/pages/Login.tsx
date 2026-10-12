import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { authApi } from '@/api/client'
import { Database, ArrowRight, Lock, Mail, CheckCircle, ShieldCheck, Eye, EyeOff, TriangleAlert } from 'lucide-react'

type Stats = { records_processed: number | null; accuracy_percent: number | null; active_projects: number | null; sources_delivered: number | null; last_activity_at: string | null }

/** Counts up from 0 once when the number first arrives. Skips the animation if the person asked for less motion. */
function useCountUp(target: number | null | undefined, ms = 900) {
  const [v, setV] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    if (target == null) return
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still || done.current || target < 2) { setV(target); done.current = true; return }
    done.current = true
    const t0 = performance.now(); let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return target == null ? null : v
}

function ago(iso: string | null | undefined) {
  if (!iso) return null
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

const REMEMBER_KEY = 'dep_login_email'
const readRemembered = () => { try { return localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' } }

// 842 -> "842", 12,400 -> "12.4k", 1,200,000 -> "1.2M". Real numbers, just shortened.
function compact(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function LoginPage() {
  const [stats, setStats] = useState<Stats | null | 'failed'>(null)
  useEffect(() => { authApi.publicStats().then(setStats).catch(() => setStats('failed')) }, [])
  const [email,    setEmail]    = useState(readRemembered)
  const [remember, setRemember] = useState(() => !!readRemembered())
  const [showPw,   setShowPw]   = useState(false)
  const [caps,     setCaps]     = useState(false)
  const [password, setPassword] = useState('')
  const [code,     setCode]     = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuthStore()
  const navigate   = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password, needCode ? code : undefined)
      try { remember ? localStorage.setItem(REMEMBER_KEY, email) : localStorage.removeItem(REMEMBER_KEY) } catch { /* private window */ }
      navigate('/', { replace: true })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      if (detail === 'TWO_STEP_REQUIRED') {
        setNeedCode(true)
        setError('')
      } else {
        setError(detail || 'Invalid email or password')
      }
    } finally {
      setLoading(false)
    }
  }

  const st = stats && stats !== 'failed' ? stats : null
  const nRecords = useCountUp(st?.records_processed)
  const nProjects = useCountUp(st?.active_projects)
  const nDelivered = useCountUp(st?.sources_delivered)
  const last = ago(st?.last_activity_at)
  const statsLoading = stats === null
  const liveLine = st ? [st.sources_delivered ? `${st.sources_delivered} source${st.sources_delivered === 1 ? '' : 's'} delivered` : null, last ? `last activity ${last}` : null].filter(Boolean).join(' · ') : ''

  const features = [
    'AI-powered web scraping and data extraction',
    'Human-in-the-loop review and verification',
    'LLM quality scoring and flag detection',
    'Per-project analytics and productivity tracking',
    'Admin final approval workflow',
    'Full audit trail with time-tracking',
  ]

  const inp: React.CSSProperties = {
    width: '100%', padding: '11px 12px 11px 40px', fontSize: 14,
    border: '1px solid var(--bd-e2e8f0)', borderRadius: 10, outline: 'none',
    background: 'var(--bg-fff)', color: 'var(--tx-0f172a)', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-f8fafc)' }}>

      {/* Left branding panel */}
      <div style={{
        width: '50%', background: 'linear-gradient(145deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',
        flexDirection: 'column', justifyContent: 'space-between', padding: '48px 48px 56px',
        display: 'none', position: 'relative',
      }} className="dep-left">
        <style>{`@media(min-width:1024px){.dep-left{display:flex!important}.dep-mstats{display:none!important}}@keyframes depPulse{0%,100%{opacity:1}50%{opacity:.35}}.dep-pulse{animation:depPulse 2.4s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.dep-pulse{animation:none}}`}</style>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database style={{ width: 22, height: 22, color: '#fff' }} />
          </div>
          <div>
            <p style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>Data Extraction Platform</p>
            <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, margin: 0 }}>by Careerflow</p>
          </div>
        </div>

        <div>
          <h1 style={{ fontSize: 38, fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: 16 }}>
            Extract. Verify.<br />Submit with confidence.
          </h1>
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 16, lineHeight: 1.7, marginBottom: 40, maxWidth: 400 }}>
            AI-powered data extraction with human review, quality scoring, and full audit trails for every record.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {features.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle style={{ width: 16, height: 16, color: '#34d399', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 14 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
          {[
            [statsLoading ? '' : compact(nRecords), 'Records Processed'],
            [statsLoading ? '' : st?.accuracy_percent == null ? '—' : `${st.accuracy_percent}%`, 'Approved Without Corrections'],
            [statsLoading ? '' : compact(nProjects), 'Active Projects'],
          ].map(([v,l]) => (
            <div key={l}>
              <p aria-busy={v === ''} style={{ fontSize: 28, fontWeight: 800, color: '#fff', margin: 0, minHeight: 34, fontVariantNumeric: 'tabular-nums' }}>
                {v === '' ? <span style={{ display: 'inline-block', width: 64, height: 22, borderRadius: 6, background: 'rgba(255,255,255,.12)' }} /> : v}
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', margin: '4px 0 0' }}>{l}</p>
            </div>
          ))}
        </div>
        {liveLine && (
          <p style={{ position: 'absolute', left: 48, bottom: 20, margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,.45)' }}>
            <span className="dep-pulse" style={{ width: 7, height: 7, borderRadius: 99, background: '#34d399', display: 'inline-block' }} />
            Live · {liveLine}
          </p>
        )}
      </div>

      {/* Right form panel */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Database style={{ width: 20, height: 20, color: '#fff' }} />
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: 'var(--tx-0f172a)' }}>Data Extraction Platform</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>by Careerflow</p>
            </div>
          </div>

          <h2 style={{ fontSize: 26, fontWeight: 800, color: 'var(--tx-0f172a)', margin: '0 0 6px' }}>Welcome back</h2>
          <p style={{ fontSize: 14, color: 'var(--tx-64748b)', margin: '0 0 32px' }}>Sign in to your account to continue</p>

          <form onSubmit={submit}>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="login-email" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-374151)', display: 'block', marginBottom: 6 }}>
                Email address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
                <input id="login-email" type="email" autoComplete="username" autoFocus={!email} value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@careerflow.ai" required style={inp}
                  onFocus={e => e.target.style.borderColor='#2563eb'}
                  onBlur={e => e.target.style.borderColor='var(--bd-e2e8f0)'} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-374151)', display: 'block', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
                <input id="login-password" type={showPw ? 'text' : 'password'} autoComplete="current-password" autoFocus={!!email}
                  value={password} onChange={e => setPassword(e.target.value)}
                  onKeyUp={e => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                  placeholder="••••••••" required style={{ ...inp, paddingRight: 44 }}
                  onFocus={e => e.target.style.borderColor='#2563eb'}
                  onBlur={e => { e.target.style.borderColor='var(--bd-e2e8f0)'; setCaps(false) }} />
                <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', padding: 8, color: '#94a3b8', display: 'flex' }}>
                  {showPw ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                </button>
              </div>
              <div style={{ minHeight: 18, marginTop: 6 }}>
                {caps && <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--tx-b45309)', display: 'flex', alignItems: 'center', gap: 6 }}><TriangleAlert style={{ width: 13, height: 13 }} /> Caps Lock is on</p>}
              </div>
            </div>

            {!needCode && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--tx-475569)', marginBottom: 20, cursor: 'pointer', width: 'fit-content' }}>
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#2563eb' }} />
                Remember my email on this device
              </label>
            )}

            {needCode && (
              <div style={{ marginBottom: 24 }}>
                <label htmlFor="login-code" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-374151)', display: 'block', marginBottom: 6 }}>
                  Code from your authenticator app
                </label>
                <div style={{ position: 'relative' }}>
                  <ShieldCheck style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
                  <input id="login-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
                    value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                    placeholder="123456" required style={{ ...inp, letterSpacing: '0.3em', fontWeight: 700 }}
                    onFocus={e => e.target.style.borderColor='#2563eb'}
                    onBlur={e => e.target.style.borderColor='var(--bd-e2e8f0)'} />
                </div>
                <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>Open your authenticator app and type the 6-digit code for this account.</p>
                <button type="button" onClick={() => { setNeedCode(false); setCode(''); setPassword(''); setError('') }}
                  style={{ marginTop: 8, padding: 0, border: 'none', background: 'none', color: 'var(--tx-2563eb)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Use a different account
                </button>
              </div>
            )}

            {error && (
              <div role="alert" style={{ background: 'var(--bg-fef2f2)', border: '1px solid var(--bd-fecaca)', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--tx-dc2626)' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: 12, fontSize: 14, fontWeight: 700,
              background: loading ? '#94a3b8' : 'linear-gradient(135deg,#2563eb,#4f46e5)',
              color: '#fff', border: 'none', borderRadius: 10,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {loading ? 'Signing in…' : <><span>{needCode ? 'Verify and sign in' : 'Sign in'}</span><ArrowRight style={{ width: 16, height: 16 }} /></>}
            </button>
          </form>

          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
            Contact your admin if you need access
          </p>

          {st && (
            <div className="dep-mstats" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--bd-e2e8f0)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, textAlign: 'center' }}>
              {[[compact(st.records_processed), 'Records'], [st.accuracy_percent == null ? '—' : `${st.accuracy_percent}%`, 'No corrections'], [compact(st.active_projects), 'Projects']].map(([v, l]) => (
                <div key={l}>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--tx-0f172a)' }}>{v}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>{l}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
