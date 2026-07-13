import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { Button, Input } from '@/components/ui'
import { Zap, ArrowRight, Lock, Mail } from 'lucide-react'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

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

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-white text-lg">Data Extraction Platform</span>
        </div>

        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Extract. Review.<br />Submit with confidence.
          </h1>
          <p className="text-white/50 text-lg leading-relaxed max-w-md">
            Careerflow team AI-powered data extraction platform with human-in-the-loop review,
            LLM verification, and validated submission.
          </p>

          <div className="mt-12 grid grid-cols-3 gap-6">
            {[
              { label: 'Records Processed', value: '50k+' },
              { label: 'Accuracy Rate', value: '98.2%' },
              { label: 'Projects Active', value: '12' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-3xl font-bold text-white">{value}</p>
                <p className="text-white/40 text-sm mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/20 text-sm">Internal use only · Careerflow © 2026</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">Data Extraction Platform</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 mt-1">Sign in to your account</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-8">
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@xtrium.ai"
                    required
                    autoFocus
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent hover:border-gray-300 transition placeholder:text-gray-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent hover:border-gray-300 transition placeholder:text-gray-400"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" loading={loading} size="lg">
                Sign in <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Internal platform · Contact your admin for access
          </p>
        </div>
      </div>
    </div>
  )
}
