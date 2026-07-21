import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useEffect, useState, useRef } from 'react'
import {
  LayoutDashboard, FolderKanban, Database, Layers,
  Users, Bell, LogOut, Settings, BookOpen, ChevronDown,
  Menu, X, Shield,
} from 'lucide-react'
import { cn, ToastContainer } from '@/components/ui'
import { notificationsApi } from '@/api/client'
import { useCapability } from '@/lib/permissions'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'

export function AppLayout() {
  const { user, logout, fetchMe } = useAuthStore()
  const navigate   = useNavigate()
  const location   = useLocation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotif, setShowNotif] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  const canManageUsers   = useCapability('manage_users')
  const canManageSchemas = useCapability('manage_schemas')
  const isAdmin          = canManageSchemas || canManageUsers

  useEffect(() => { fetchMe() }, [])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!showNotif) return
    const h = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showNotif])

  useEffect(() => {
    if (!user) return
    notificationsApi.list().then(setNotifications).catch(() => {})
    const iv = setInterval(() => notificationsApi.list().then(setNotifications).catch(() => {}), 60000)
    return () => clearInterval(iv)
  }, [user])

  if (!user) return null
  const unread = notifications.filter(n => !n.is_read).length

  const mainNav = [
    { to: '/',         icon: LayoutDashboard, label: 'Dashboard',  show: true },
    { to: '/sources',  icon: Database,        label: 'Sources',    show: true },
    { to: '/projects', icon: FolderKanban,    label: 'Projects',   show: true },
    { to: '/schemas',  icon: Layers,          label: 'Schemas',    show: isAdmin && canManageSchemas },
  ].filter(n => n.show)

  const adminNav = [
    { to: '/admin/users', icon: Users,    label: 'Users',    show: canManageUsers },
    { to: '/settings',    icon: Settings, label: 'Settings', show: canManageUsers },
    { to: '/help',        icon: BookOpen, label: 'Help',     show: true },
  ].filter(n => n.show)

  const NavItem = ({ to, icon: Icon, label, exact = false }: any) => (
    <NavLink to={to} end={exact}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
        borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 500,
        transition: 'all 0.12s',
        background: isActive ? '#eff6ff' : 'transparent',
        color: isActive ? '#2563eb' : '#64748b',
      })}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; if (!el.style.background.includes('eff6ff')) el.style.background = '#f8fafc' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; if (!el.style.background.includes('eff6ff')) el.style.background = 'transparent' }}>
      <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
      {label}
    </NavLink>
  )

  const Sidebar = () => (
    <aside style={{
      width: 240, background: '#fff', borderRight: '1px solid #e2e8f0',
      display: 'flex', flexDirection: 'column', height: '100vh',
      position: 'sticky', top: 0, flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Database style={{ width: 17, height: 17, color: '#fff' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Data Extraction
            </p>
            <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>Platform · Careerflow</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
            letterSpacing: '.07em', padding: '4px 14px', margin: '0 0 4px' }}>Main</p>
          {mainNav.map(n => <NavItem key={n.to} {...n} exact={n.to === '/'} />)}
        </div>

        {adminNav.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
              letterSpacing: '.07em', padding: '4px 14px', margin: '0 0 4px' }}>Admin</p>
            {adminNav.map(n => <NavItem key={n.to} {...n} />)}
          </div>
        )}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #f1f5f9' }}>
        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative', marginBottom: 8 }}>
          <button onClick={() => setShowNotif(!showNotif)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 13, color: '#64748b',
          }}>
            <div style={{ position: 'relative' }}>
              <Bell style={{ width: 16, height: 16 }} />
              {unread > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4, width: 14, height: 14,
                  background: '#dc2626', borderRadius: '50%', fontSize: 9, fontWeight: 700,
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{unread > 9 ? '9+' : unread}</span>
              )}
            </div>
            <span>Notifications</span>
            {unread > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                background: '#fef2f2', color: '#dc2626', padding: '1px 6px', borderRadius: 20 }}>
                {unread} new
              </span>
            )}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto', zIndex: 50,
            }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Notifications</span>
                {unread > 0 && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>{unread} unread</span>}
              </div>
              {notifications.length === 0
                ? <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No notifications</div>
                : notifications.slice(0, 10).map(n => (
                  <div key={n.id} style={{
                    padding: '10px 14px', borderBottom: '1px solid #f8fafc',
                    background: n.is_read ? '#fff' : '#eff6ff',
                  }}>
                    <p style={{ fontSize: 13, color: '#1e293b', margin: '0 0 2px', fontWeight: n.is_read ? 400 : 600 }}>
                      {n.message}
                    </p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.full_name ?? user.email}
            </p>
            <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>
              {Array.isArray(user.roles) ? user.roles[0] : 'member'}
            </p>
          </div>
          <button onClick={() => { logout(); navigate('/login') }}
            title="Sign out"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: '#94a3b8', borderRadius: 6, display: 'flex', alignItems: 'center' }}>
            <LogOut style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Desktop sidebar */}
      <div style={{ display: 'none' }} className="dep-sidebar">
        <style>{`@media(min-width:768px){.dep-sidebar{display:block!important}}`}</style>
        <Sidebar />
      </div>

      {/* Mobile header */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 56, zIndex: 40,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }} className="dep-mobile-hdr">
        <style>{`@media(min-width:768px){.dep-mobile-hdr{display:none!important}}`}</style>
        <button onClick={() => setMobileOpen(!mobileOpen)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
          {mobileOpen ? <X style={{ width: 20, height: 20 }} /> : <Menu style={{ width: 20, height: 20 }} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database style={{ width: 14, height: 14, color: '#fff' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Data Extraction Platform</span>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}
          className="dep-mobile-overlay">
          <style>{`@media(min-width:768px){.dep-mobile-overlay{display:none!important}}`}</style>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setMobileOpen(false)} />
          <div style={{ position: 'relative', width: 240 }}>
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, paddingTop: 0 }} className="dep-main">
        <style>{`@media(max-width:767px){.dep-main{padding-top:56px!important}}`}</style>
        <Outlet />
      </main>

      <ToastContainer />
    </div>
  )
}
