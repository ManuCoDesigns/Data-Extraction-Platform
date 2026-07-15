import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useEffect, useState, useRef } from 'react'
import {
  LayoutDashboard, FolderKanban, Database, Layers,
  Users, Bell, LogOut, Settings, BookOpen,
  Zap, ChevronLeft, ChevronRight
} from 'lucide-react'
import { cn, Badge, ToastContainer } from '@/components/ui'
import { notificationsApi } from '@/api/client'
import { useCapability } from '@/lib/permissions'
import type { Notification } from '@/types'

export function AppLayout() {
  const { user, logout, fetchMe } = useAuthStore()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotif, setShowNotif]         = useState(false)
  const [collapsed, setCollapsed]         = useState(false)
  const [showProfile, setShowProfile]       = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showNotif) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) { setShowNotif(false); setShowProfile(false) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotif])

  const canManageUsers   = useCapability('manage_users')
  const canManageSchemas = useCapability('manage_schemas')
  const isAdminish       = canManageSchemas || canManageUsers

  useEffect(() => { fetchMe() }, [])
  useEffect(() => {
    if (!user) return
    notificationsApi.list().then(setNotifications).catch(() => {})
    const iv = setInterval(() => notificationsApi.list().then(setNotifications).catch(() => {}), 60_000)
    return () => clearInterval(iv)
  }, [user])

  if (!user) return null
  const unread = notifications.filter(n => !n.is_read).length

  const mainNav = isAdminish
    ? [
        { to: '/',         icon: LayoutDashboard, label: 'Dashboard',  exact: true  },
        { to: '/projects', icon: FolderKanban,    label: 'Projects',   exact: false },
        { to: '/sources',  icon: Database,        label: 'Sources',    exact: false },
        { to: '/schemas',  icon: Layers,          label: 'Schemas',    exact: false, show: canManageSchemas },
      ].filter(n => n.show !== false)
    : [
        { to: '/',         icon: LayoutDashboard, label: 'Dashboard',  exact: true  },
        { to: '/projects', icon: FolderKanban,    label: 'Projects',   exact: false },
        { to: '/sources',  icon: Database,        label: 'Sources',    exact: false },
      ]

  const adminNav = [
    { to: '/admin/users', icon: Users,    label: 'Users',      show: canManageUsers },
    { to: '/help',        icon: BookOpen, label: 'Help Guide', show: true },
    { to: '/settings',    icon: Settings, label: 'Settings',   show: canManageUsers },
  ].filter(n => n.show)

  const initial = user.full_name?.[0]?.toUpperCase() || '?'
  const roleLabel = user.roles?.[0]?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f8fafc', overflow: 'hidden' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{
        width: collapsed ? 64 : 240,
        minWidth: collapsed ? 64 : 240,
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
        transition: 'width 0.25s ease, min-width 0.25s ease',
        position: 'relative', zIndex: 20,
        boxShadow: '4px 0 20px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}>

        {/* Logo area */}
        <div style={{
          height: 64, display: 'flex', alignItems: 'center',
          padding: collapsed ? '0 16px' : '0 20px', gap: 12,
          borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
          }}>
            <Zap style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden' }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}></p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: 0, letterSpacing: '0.05em', textTransform: 'uppercase' }}>DataOps Platform</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto', overflowX: 'hidden' }}>

          {/* Main nav label */}
          {!collapsed && (
            <p style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '4px 12px 8px', margin: 0 }}>
              Workspace
            </p>
          )}

          {mainNav.map(({ to, icon: Icon, label, exact }) => (
            <NavLink key={to} to={to} end={exact} title={collapsed ? label : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '10px' : '9px 12px',
                borderRadius: 10, marginBottom: 2,
                textDecoration: 'none', fontSize: 13, fontWeight: 500,
                transition: 'all 0.15s',
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
                color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
              })}
            >
              <Icon style={{ width: 17, height: 17, flexShrink: 0 }} />
              {!collapsed && label}
            </NavLink>
          ))}

          {/* Admin section */}
          {adminNav.length > 0 && (
            <>
              <div style={{ margin: '14px 0 8px', height: 1, background: 'rgba(255,255,255,0.07)' }} />
              {!collapsed && (
                <p style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 12px 8px', margin: 0 }}>
                  Admin
                </p>
              )}
              {adminNav.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} title={collapsed ? label : undefined}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: collapsed ? '10px' : '9px 12px',
                    borderRadius: 10, marginBottom: 2,
                    textDecoration: 'none', fontSize: 13, fontWeight: 500,
                    transition: 'all 0.15s',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
                    color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.4)',
                    borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
                  })}>
                  <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
                  {!collapsed && label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User profile + collapse at bottom */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          {/* User info */}
          <div style={{
            padding: collapsed ? '12px 8px' : '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: '#fff',
            }}>
              {initial}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{roleLabel}</p>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ padding: '0 8px 10px', display: 'flex', gap: 4, justifyContent: collapsed ? 'center' : 'space-between', alignItems: 'center' }}>
            {!collapsed && (
              <div style={{ display: 'flex', gap: 2 }}>
                {/* Notifications */}
                <button onClick={() => setShowNotif(v => !v)}
                  style={{ padding: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', borderRadius: 8, position: 'relative', display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}>
                  <Bell style={{ width: 15, height: 15 }} />
                  {unread > 0 && (
                    <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, background: '#ef4444', borderRadius: '50%', border: '1.5px solid #1e293b' }} />
                  )}
                </button>
                {/* Logout */}
                <button onClick={() => { logout(); navigate('/login') }}
                  style={{ padding: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', borderRadius: 8, display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)'; (e.currentTarget as HTMLElement).style.color = '#fca5a5' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}>
                  <LogOut style={{ width: 15, height: 15 }} />
                </button>
              </div>
            )}
            {/* Collapse toggle */}
            <button onClick={() => setCollapsed(v => !v)}
              style={{ padding: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', borderRadius: 8, display: 'flex', alignItems: 'center' }}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)' }}>
              {collapsed ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronLeft style={{ width: 14, height: 14 }} />}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Top bar */}
        <header style={{
          height: 64, display: 'flex', alignItems: 'center',
          padding: '0 28px', background: '#fff', flexShrink: 0,
          borderBottom: '1px solid #f1f5f9',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          gap: 12, justifyContent: 'space-between',
        }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#94a3b8' }}>
            <span style={{ fontWeight: 700, color: '#1e293b' }}></span>
          </div>

          {/* Right side: notifications + profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} ref={notifRef}>

            {/* Bell */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => { setShowNotif(v => !v); setShowProfile(false) }}
                style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid #e2e8f0', background: showNotif ? '#eff6ff' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: showNotif ? '#2563eb' : '#64748b', transition: 'all 0.15s' }}>
                <Bell style={{ width: 16, height: 16 }} />
                {unread > 0 && (
                  <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, background: '#ef4444', borderRadius: '50%', border: '2px solid #fff' }} />
                )}
              </button>

              {showNotif && (
                <div style={{ position: 'absolute', top: 44, right: 0, width: 340, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 9999, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0 }}>Notifications</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {unread > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#ef4444', color: '#fff', padding: '2px 7px', borderRadius: 20 }}>{unread} new</span>}
                      {unread > 0 && (
                        <button onClick={() => notificationsApi.markAllRead().then(() => notificationsApi.list().then(setNotifications))}
                          style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                          Mark all read
                        </button>
                      )}
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center' }}>
                      <Bell style={{ width: 32, height: 32, color: '#e2e8f0', margin: '0 auto 8px', display: 'block' }} />
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>All caught up ✓</p>
                    </div>
                  ) : (
                    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                      {notifications.map(n => (
                        <div key={n.id}
                          onClick={() => !n.is_read && notificationsApi.markRead(n.id).then(() => notificationsApi.list().then(setNotifications))}
                          style={{ padding: '12px 16px', borderBottom: '1px solid #f8fafc', background: n.is_read ? '#fff' : '#f0f9ff', cursor: n.is_read ? 'default' : 'pointer', transition: 'background 0.1s' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            {!n.is_read && <div style={{ width: 6, height: 6, background: '#3b82f6', borderRadius: '50%', marginTop: 5, flexShrink: 0 }} />}
                            <div style={{ flex: 1, paddingLeft: n.is_read ? 16 : 0 }}>
                              <p style={{ fontSize: 12, fontWeight: n.is_read ? 500 : 700, color: '#1e293b', margin: '0 0 2px' }}>{n.title}</p>
                              <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.4 }}>{n.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Profile */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => { setShowProfile(v => !v); setShowNotif(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 12px 5px 6px', background: showProfile ? '#eff6ff' : '#f8fafc', borderRadius: 10, border: `1px solid ${showProfile ? '#bfdbfe' : '#f1f5f9'}`, cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                  {initial}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', margin: 0, lineHeight: 1.2 }}>{user.full_name}</p>
                  <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{roleLabel}</p>
                </div>
              </button>

              {showProfile && (
                <div style={{ position: 'absolute', top: 44, right: 0, width: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 9999, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', margin: 0 }}>{user.full_name}</p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{user.email}</p>
                  </div>
                  {[
                    { label: 'My Profile', to: '/profile', icon: '👤' },
                    { label: 'Settings', to: '/settings', icon: '⚙️' },
                    { label: 'Help Guide', to: '/help', icon: '📖' },
                  ].map(item => (
                    <a key={item.to} href={item.to} onClick={e => { e.preventDefault(); setShowProfile(false); navigate(item.to) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', textDecoration: 'none', color: '#374151', fontSize: 13, transition: 'background 0.1s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <span style={{ fontSize: 14 }}>{item.icon}</span> {item.label}
                    </a>
                  ))}
                  <div style={{ borderTop: '1px solid #f1f5f9' }}>
                    <button onClick={() => { logout(); navigate('/login') }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13, textAlign: 'left', transition: 'background 0.1s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <LogOut style={{ width: 14, height: 14 }} /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: '#f8fafc' }}>
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  )
}
