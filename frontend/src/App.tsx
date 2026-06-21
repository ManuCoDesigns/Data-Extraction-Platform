import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/Login'
import { DashboardPage } from '@/pages/Dashboard'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectDetailPage } from '@/pages/ProjectDetail'
import { SourcesPage } from '@/pages/Sources'
import { SourceDetailPage } from '@/pages/SourceDetail'
import { JobsPage } from '@/pages/Jobs'
import { JobDetailPage } from '@/pages/JobDetail'
import { ReviewPage } from '@/pages/Review'
import { SchemasPage } from '@/pages/Schemas'
import { UsersPage } from '@/pages/Users'
import { ProfilePage } from '@/pages/Profile'
import { SettingsPage } from '@/pages/Settings'
import { useAuthStore } from '@/store/auth'

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

export function App() {
  const fetchMe = useAuthStore((state) => state.fetchMe)

  useEffect(() => {
    fetchMe()
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
            element={<DashboardPage />}
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
            path="jobs"
            element={<JobsPage />}
          />

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