import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/Login'
import { DashboardPage } from '@/pages/Dashboard'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectDetailPage } from '@/pages/ProjectDetail'
import { SourcesPage } from '@/pages/Sources'
import { SourceDetailPage } from '@/pages/SourceDetail'
import { ExportPreviewPage } from '@/pages/ExportPreview'
import { HelpPage } from '@/pages/Help'
import { JobsPage } from '@/pages/Jobs'
import { JobDetailPage } from '@/pages/JobDetail'
import { ReviewPage } from '@/pages/Review'
import { SchemasPage } from '@/pages/Schemas'
import { UsersPage } from '@/pages/Users'
import { ProfilePage } from '@/pages/Profile'
import { SettingsPage } from '@/pages/Settings'
import { useAuthStore } from '@/store/auth'
import { hasCapability } from '@/lib/permissions'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-600 border-t-transparent" />
          <p className="text-sm text-gray-400">
            Loading...
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()

  if (!user?.roles?.includes('org_admin')) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

// Everyone lands on their role-specific dashboard.
// DashboardPage internally routes to Admin / Reviewer / Extractor / DualRole view.
function IndexRoute() {
  const { user, isLoading } = useAuthStore()

  if (isLoading) return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', flexDirection: 'column', gap: 16 }}>
      <div style={{ position: 'relative', width: 48, height: 48 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid #e2e8f0',
          borderTopColor: '#2563eb', animation: 'spin 0.9s linear infinite' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: 0 }}>
          ⚡ Data Extraction Platform
        </p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
          Connecting to server — first load may take up to 30 seconds
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (!user) return <Navigate to="/login" replace />
  return <DashboardPage />
}

export function App() {
  const fetchMe = useAuthStore((state) => state.fetchMe)

  useEffect(() => {
    fetchMe()

    // Keep Railway backend warm — ping /ping every 4 minutes
    // This prevents the 60-90 second cold start that users experience
    const BACKEND = (import.meta.env.VITE_API_URL || 'https://-platform-production.up.railway.app/api/v1')
      .replace('/api/v1', '')
    const ping = () => fetch(`${BACKEND}/ping`).catch(() =>
      // Fallback: try /health if /ping not available yet
      fetch(`${BACKEND}/health`).catch(() => {})
    )
    ping()  // immediately on load
    const iv = setInterval(ping, 4 * 60 * 1000)
    return () => clearInterval(iv)
  }, [fetchMe])

  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/login"
          element={<LoginPage />}
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >

          <Route
            index
            element={<IndexRoute />}
          />

          <Route
            path="sources"
            element={<SourcesPage />}
          />

          <Route
            path="projects"
            element={<ProjectsPage />}
          />

          <Route
            path="projects/:projectId"
            element={<ProjectDetailPage />}
          />

          <Route
            path="projects/:projectId/sources"
            element={<SourcesPage />}
          />

          <Route
            path="projects/:projectId/sources/:sourceId"
            element={<SourceDetailPage />}
          />
          <Route
            path="projects/:projectId/export-preview"
            element={<ExportPreviewPage />}
          />

          <Route path="jobs" element={<Navigate to="/projects" replace />} />

          <Route
            path="jobs/:jobId"
            element={<JobDetailPage />}
          />

          <Route
            path="jobs/:jobId/review"
            element={<ReviewPage />}
          />

          <Route
            path="schemas"
            element={<SchemasPage />}
          />

          <Route
            path="profile"
            element={<ProfilePage />}
          />

          <Route
            path="settings"
            element={<SettingsPage />}
          />

          <Route
            path="help"
            element={<HelpPage />}
          />

          <Route
            path="admin/users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />

        </Route>

        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />

      </Routes>
    </BrowserRouter>
  )
}