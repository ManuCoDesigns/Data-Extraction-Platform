import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { Database, ArrowRight, Lock, Mail, CheckCircle } from 'lucide-react'

export function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuthStore()
  const navigate   = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

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
    border: '1px solid #e2e8f0', borderRadius: 10, outline: 'none',
    background: '#fff', color: '#0f172a', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#f8fafc' }}>

      {/* Left branding panel */}
      <div style={{
        width: '50%', background: 'linear-gradient(145deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)',
        flexDirection: 'column', justifyContent: 'space-between', padding: 48,
        display: 'none',
      }} className="dep-left">
        <style>{`@media(min-width:1024px){.dep-left{display:flex!important}}`}</style>

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
          {[['50k+','Records Processed'],['98.2%','Accuracy Rate'],['11','Active Projects']].map(([v,l]) => (
            <div key={l}>
              <p style={{ fontSize: 28, fontWeight: 800, color: '#fff', margin: 0 }}>{v}</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', margin: '4px 0 0' }}>{l}</p>
            </div>
          ))}
        </div>
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
              <p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: '#0f172a' }}>Data Extraction Platform</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>by Careerflow</p>
            </div>
          </div>

          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>Welcome back</h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 32px' }}>Sign in to your account to continue</p>

          <form onSubmit={submit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                Email address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@careerflow.ai" required style={inp}
                  onFocus={e => e.target.style.borderColor='#2563eb'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required style={inp}
                  onFocus={e => e.target.style.borderColor='#2563eb'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
              </div>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
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
              {loading ? 'Signing in…' : <><span>Sign in</span><ArrowRight style={{ width: 16, height: 16 }} /></>}
            </button>
          </form>

          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
            Contact your admin if you need access
          </p>
        </div>
      </div>
    </div>
  )
}
