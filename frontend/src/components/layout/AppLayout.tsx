import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, FolderKanban, Briefcase, Database, Layers,
  Users, Bell, LogOut, ChevronRight, Settings,
  BarChart3, Shield, Zap, Upload, ClipboardCheck
} from 'lucide-react'
import { cn, Avatar, Badge, ToastContainer } from '@/components/ui'
import { notificationsApi } from '@/api/client'
import { useCapability } from '@/lib/permissions'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'

export function AppLayout() {
  const { user, logout, fetchMe } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotif, setShowNotif] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Capabilities
  const canManageUsers    = useCapability('manage_users')
  const canUploadJobs     = useCapability('upload_extraction_jobs')
  const canManageSchemas  = useCapability('manage_schemas')
  const canReview         = useCapability('review_submissions')
  // Admins (org_admin / project_admin) get the full toolset. Everyone else
  // (extractor, reviewer, qa_lead, read_only) gets a minimal nav — Sources
  // is their whole job, so it's the only thing in front of them.
  const isAdminish = canManageSchemas || canManageUsers

  useEffect(() => { fetchMe() }, [])

  useEffect(() => {
    if (!user) return
    notificationsApi.list().then(setNotifications).catch(() => {})
    const iv = setInterval(() => notificationsApi.list().then(setNotifications).catch(() => {}), 60000)
    return () => clearInterval(iv)
  }, [user])

  if (!user) return null

  const unread = notifications.filter(n => !n.is_read).length
  const crumbs = location.pathname.split('/').filter(Boolean)

  // Build nav dynamically based on capabilities
  const mainNav = isAdminish
    ? [
        { to: '/sources',  icon: Database,        label: 'Sources',    exact: false, show: true },
        { to: '/',         icon: LayoutDashboard, label: 'Dashboard',  exact: true,  show: true },
        { to: '/projects', icon: FolderKanban,    label: 'Projects',   exact: false, show: true },
        { to: '/jobs',     icon: Briefcase,       label: 'Jobs',       exact: false, show: canUploadJobs },
        { to: '/schemas',  icon: Layers,          label: 'Schemas',    exact: false, show: canManageSchemas },
      ].filter(n => n.show)
    : [
        { to: '/sources',  icon: Database,        label: 'Sources',    exact: false, show: true },
        { to: '/projects', icon: FolderKanban,    label: 'Projects',   exact: false, show: true },
      ].filter(n => n.show)

  const adminNav = [
    { to: '/admin/users', icon: Users,    label: 'Users',    show: canManageUsers },
    { to: '/settings',    icon: Settings, label: 'Settings', show: canManageUsers },
  ].filter(n => n.show)

  const showAdminSection = adminNav.length > 0

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className={cn(
        'flex flex-col shrink-0 transition-all duration-300 ease-in-out',
        'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800',
        collapsed ? 'w-16' : 'w-64'
      )}>
        {/* Logo */}
        <div className={cn('h-16 flex items-center border-b border-white/10 shrink-0', collapsed ? 'justify-center px-0' : 'px-5 gap-3')}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div>
              <p className="font-bold text-white text-sm leading-tight">Xtrium</p>
              <p className="text-white/40 text-xs">DataOps Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
          {mainNav.map(({ to, icon: Icon, label, exact }) => (
            <NavLink key={to} to={to} end={exact}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-white/60 hover:bg-white/8 hover:text-white/90'
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}

          {showAdminSection && (
            <>
              <div className={cn('pt-5 pb-1', collapsed ? 'px-0' : 'px-3')}>
                {!collapsed && <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Admin</p>}
                {collapsed && <div className="w-6 h-px bg-white/20 mx-auto" />}
              </div>
              {adminNav.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white/90'
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className={cn('border-t border-white/10 p-3 shrink-0', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <button onClick={logout} title="Sign out"
              className="p-2 text-white/50 hover:text-red-400 hover:bg-white/10 rounded-xl transition">
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <div
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/8 group transition cursor-pointer"
              onClick={() => navigate('/profile')}
            >
              <Avatar name={user.full_name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.full_name}</p>
                <p className="text-xs text-white/40 truncate">{user.roles[0]?.replace(/_/g, ' ')}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); logout() }}
                className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 rounded-lg transition"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0 shadow-sm">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setCollapsed(c => !c)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition mr-2"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <span className="text-gray-400">Xtrium</span>
            {crumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2">
                <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                <span className={cn(
                  'capitalize font-medium',
                  i === crumbs.length - 1 ? 'text-gray-800' : 'text-gray-400'
                )}>
                  {crumb.replace(/-/g, ' ')}
                </span>
              </span>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Notifications bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotif(v => !v)}
                className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition"
              >
                <Bell className="w-5 h-5" />
                {unread > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
                )}
              </button>

              {showNotif && (
                <div className="absolute right-0 top-12 w-80 bg-white border border-gray-100 rounded-2xl shadow-float z-50 overflow-hidden animate-slide-up">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">Notifications</p>
                    {unread > 0 && <Badge variant="indigo">{unread} new</Badge>}
                  </div>
                  <div className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-gray-50">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center">
                        <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">All caught up!</p>
                      </div>
                    ) : notifications.map(n => (
                      <div
                        key={n.id}
                        className={cn('px-4 py-3 hover:bg-gray-50 cursor-pointer transition', !n.is_read && 'bg-blue-50/50')}
                        onClick={() => {
                          notificationsApi.markRead(n.id)
                          if (n.link) navigate(n.link)
                          setShowNotif(false)
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          {!n.is_read && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-1.5 shrink-0" />}
                          <div className={!n.is_read ? '' : 'ml-4'}>
                            <p className="text-sm font-medium text-gray-900">{n.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Profile */}
            <button onClick={() => navigate('/profile')} className="hover:opacity-80 transition">
              <Avatar name={user.full_name} size="sm" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin page-enter">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  )
}
