import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useEffect, useState, useRef } from 'react'
import { usePrefs } from '@/lib/prefs'
import {
  LayoutDashboard, FolderKanban, Database, Layers,
  Users, Bell, LogOut, Settings, BookOpen, ChevronDown,
  Menu, X, Shield, Activity, AlertTriangle,
  Zap, ShieldCheck, HeartPulse, CircleHelp, MessageCircle, CalendarCheck, PackageCheck, ChartColumn, History, Search, PanelLeftClose, PanelLeftOpen, Sun, Moon, ClipboardList, ListChecks, Link2Off } from 'lucide-react'
import { cn, ToastContainer, toast } from '@/components/ui'
import { notificationsApi, sourcesApi } from '@/api/client'
import { useCapability } from '@/lib/permissions'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { NotificationBanner } from '@/components/NotificationBanner'
import { IdleGuard } from '@/components/enh/IdleGuard'
import { CommandPalette } from '@/components/enh/CommandPalette'
import { enhApi } from '@/api/client'
import { UndoBanner } from '@/components/enh/UndoBanner'
import { ConnectionBanner } from '@/components/enh/ConnectionBanner'
import { ErrorBoundary } from '@/components/enh/ErrorBoundary'
import { useTheme } from '@/lib/theme'
import { recordVisit } from '@/lib/recent'
import { ShortcutsHelp } from '@/components/enh/ShortcutsHelp'
import { ConfirmHost } from '@/components/enh/ConfirmHost'

export function AppLayout() {
  const { user, logout, fetchMe } = useAuthStore()
  const navigate   = useNavigate()
  const location   = useLocation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [showNotif, setShowNotif] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [escalationCount, setEscalationCount] = useState(0)
  const [counts, setCounts] = useState({ open_questions: 0, link_problems: 0, unread_messages: 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('dep_sidebar') === 'mini' } catch { return false } })
  const toggleSidebar = () => setCollapsed(c => { const n = !c; try { localStorage.setItem('dep_sidebar', n ? 'mini' : 'full') } catch { /* ignore */ } return n })
  const { dark, toggle: toggleTheme } = useTheme()
  // Tracks notification ids already seen, so a genuinely new one arriving
  // between polls can get its own toast — without spamming a toast for
  // every item already in the mailbox on first load.
  const seenNotifIds = useRef<Set<string> | null>(null)

  const canManageUsers   = useCapability('manage_users')
  const canManageSchemas = useCapability('manage_schemas')
  const isAdmin          = canManageSchemas || canManageUsers
  const isTeamLead       = ['org_admin', 'project_admin', 'qa_lead'].some(r => user?.roles?.includes(r))

  useEffect(() => { fetchMe() }, [])
  useEffect(() => { if (user?.id) usePrefs.getState().load() }, [user?.id])
  useEffect(() => { setMobileOpen(false); recordVisit(location.pathname) }, [location.pathname])
  // "?" opens the shortcut list; "g" then a letter jumps to a page. Ignored while typing in a field.
  useEffect(() => {
    let armed = 0
    const GO: Record<string, string> = { d: '/', s: '/sources', p: '/projects', h: '/data-health', q: '/client-questions', i: '/insights' }
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const k = e.key.toLowerCase()
      if (e.key === '?') { e.preventDefault(); setHelpOpen(o => !o); return }
      if (armed && Date.now() - armed < 1200 && GO[k]) { e.preventDefault(); armed = 0; navigate(GO[k]); return }
      armed = k === 'g' ? Date.now() : 0
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    if (!user?.id) return
    const load = () => enhApi.counts().then(setCounts).catch(() => {})
    load()
    const iv = setInterval(load, 120000)
    return () => clearInterval(iv)
  }, [user?.id, location.pathname])

  useEffect(() => {
    if (!showNotif) return
    const h = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showNotif])

  useEffect(() => {
    if (!user) return
    const loadNotifications = () => {
      notificationsApi.list().then((r: any) => {
        const items: Notification[] = r?.items ?? []
        if (seenNotifIds.current === null) {
          // First load this session — establish the baseline silently,
          // no toasts for a backlog of notifications from before now.
          seenNotifIds.current = new Set(items.map(n => n.id))
        } else {
          const fresh = items.filter(n => !n.is_read && !seenNotifIds.current!.has(n.id))
          fresh.forEach(n => toast.info(n.title))
          items.forEach(n => seenNotifIds.current!.add(n.id))
        }
        setNotifications(items)
      }).catch(() => {})
      notificationsApi.unreadCount().then((c: any) => setUnreadTotal(c?.unread_count ?? 0)).catch(() => {})
    }
    loadNotifications()
    // Check every 30 seconds, and straight away when the person comes back to this tab.
    const iv = setInterval(loadNotifications, 30000)
    const onVisible = () => { if (!document.hidden) loadNotifications() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', loadNotifications)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', loadNotifications)
    }
  }, [user])

  // The browser tab shows the unread count, and blinks while the tab is in the background.
  const unreadNow = notifications.filter(n => !n.is_read).length
  useEffect(() => {
    const base = (document.title || 'Data Extraction Platform').replace(/^(\(\d+\) |● \d+ new updates? - )/, '')
    if (unreadNow === 0) { document.title = base; return }
    let on = true
    const tick = () => {
      document.title = document.hidden && on
        ? `● ${unreadNow} new ${unreadNow === 1 ? 'update' : 'updates'} - ${base}`
        : `(${unreadNow}) ${base}`
      on = !on
    }
    tick()
    const iv = setInterval(tick, 1200)
    return () => { clearInterval(iv); document.title = base }
  }, [unreadNow])

  useEffect(() => {
    if (!user) return
    const loadEscalations = () => sourcesApi.escalations(true).then((d: any) => setEscalationCount(d?.count ?? 0)).catch(() => {})
    loadEscalations()
    const iv = setInterval(loadEscalations, 60000)
    return () => clearInterval(iv)
  }, [user])

  const handleNotifClick = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      setUnreadTotal(t => Math.max(0, t - 1))
      notificationsApi.markRead(n.id).catch(() => {})
    }
    setShowNotif(false)
    if (n.link) navigate(n.link)
  }

  // "Got it" on the banner: mark one notice read without leaving the page.
  const handleAck = (n: Notification) => {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    setUnreadTotal(t => Math.max(0, t - 1))
    notificationsApi.markRead(n.id).catch(() => {})
  }

  const handleMarkAllRead = async () => {
    setUnreadTotal(0)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    try { await notificationsApi.markAllRead() } catch { /* local state already optimistic */ }
  }

  if (!user) return null
  const unread = notifications.filter(n => !n.is_read).length

  // Sources and Projects share a URL prefix — a specific source lives at
  // /projects/:projectId/sources/:sourceId, which starts with "/projects".
  // React Router's default NavLink prefix-matching would light up
  // "Projects" for that URL and never "Sources", even though the person
  // is clearly viewing a source. These two checks resolve that overlap
  // explicitly instead of relying on prefix matching for either of them.
  const isSourcesPath = /^\/sources(\/|$)/.test(location.pathname)
    || /^\/projects\/[^/]+\/sources(\/|$)/.test(location.pathname)
  const isProjectsPath = location.pathname.startsWith('/projects') && !isSourcesPath

  const mainNav = [
    { to: '/',            icon: LayoutDashboard, label: 'Dashboard',    show: true },
    { to: '/sources',     icon: Database,        label: 'Sources',      show: true, forceActive: isSourcesPath },
    { to: '/triage', icon: Link2Off, label: 'Link triage', show: true },
    { to: '/escalations', icon: AlertTriangle,   label: 'Escalations',  show: true, badge: escalationCount },
    { to: '/xtrium',      icon: Zap,             label: 'Xtrium Integration', show: isAdmin },
    { to: '/projects',    icon: FolderKanban,    label: 'Projects',     show: true, forceActive: isProjectsPath },
    { to: '/workload',    icon: Activity,        label: 'Team Workload', show: isTeamLead },
    { to: '/digest',      icon: CalendarCheck,   label: 'Daily Digest', show: isTeamLead },
    { to: '/delivery',    icon: PackageCheck,    label: 'Delivery Summary', show: isTeamLead },
    { to: '/messages',   icon: MessageCircle,   label: 'Messages',     show: true, badge: counts.unread_messages },
    { to: '/quality',    icon: ShieldCheck,    label: 'Quality',      show: isTeamLead },
    { to: '/observations', icon: ClipboardList, label: 'Observations', show: isTeamLead },
    { to: '/sop-assign', icon: ListChecks, label: 'SOP assignment', show: isTeamLead },
    { to: '/data-health', icon: HeartPulse,      label: 'Data Health',  show: true, badge: counts.link_problems, badgeColor: '#d97706' },
    { to: '/client-questions', icon: CircleHelp, label: 'Client Questions', show: true, badge: counts.open_questions, badgeColor: '#d97706' },
    { to: '/insights',    icon: ChartColumn,     label: isTeamLead ? 'Insights' : 'My Stats', show: true },
    { to: '/schemas',     icon: Layers,          label: 'Schemas',      show: isAdmin && canManageSchemas },
  ].filter(n => n.show)

  const adminNav = [
    { to: '/audit',       icon: History,  label: 'Audit Trail', show: isTeamLead },
    { to: '/admin/users', icon: Users,    label: 'Users',    show: canManageUsers },
    { to: '/settings',    icon: Settings, label: 'Settings', show: canManageUsers },
    { to: '/help',        icon: BookOpen, label: 'Help',     show: true },
  ].filter(n => n.show)

  const NavItem = ({ to, icon: Icon, label, exact = false, badge, badgeColor = '#dc2626', forceActive, mini }: any) => (
    <NavLink to={to} end={exact} title={mini ? label : undefined} className="dep-nav" aria-label={mini ? label : undefined}
      style={({ isActive }) => {
        const active = forceActive !== undefined ? forceActive : isActive
        return {
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : undefined, gap: 10,
          padding: mini ? '10px 0' : '9px 14px',
          borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 500,
          transition: 'background .12s, color .12s',
          background: active ? 'var(--bg-eff6ff)' : undefined,
          color: active ? 'var(--tx-2563eb)' : 'var(--tx-64748b)',
        }
      }}>
      <Icon style={{ width: mini ? 18 : 16, height: mini ? 18 : 16, flexShrink: 0 }} />
      {!mini && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
      {badge > 0 && (mini ? (
        <span style={{ position: 'absolute', top: 6, right: 12, width: 9, height: 9, borderRadius: 99, background: badgeColor, border: '2px solid var(--bg-fff)' }}
          aria-label={`${badge} need attention`} />
      ) : (
        <span style={{
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 20,
          background: badgeColor, color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} aria-label={`${badge} need attention`}>{badge > 99 ? '99+' : badge}</span>
      ))}
    </NavLink>
  )

  const Sidebar = ({ mini = false }: { mini?: boolean }) => (
    <aside style={{
      width: mini ? 68 : 240, transition: 'width .18s ease', background: 'var(--bg-fff)', borderRight: '1px solid var(--bd-e2e8f0)',
      display: 'flex', flexDirection: 'column', height: '100vh',
      position: 'sticky', top: 0, flexShrink: 0,
    }}>
      {/* Logo and collapse button */}
      <div style={{ padding: mini ? '16px 0 12px' : '18px 14px 14px 18px', borderBottom: '1px solid var(--bd-f1f5f9)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : undefined, gap: 10, flexDirection: mini ? 'column' : 'row' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Database style={{ width: 17, height: 17, color: '#fff' }} />
          </div>
          {!mini && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-0f172a)', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Data Extraction
              </p>
              <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>Platform · Careerflow</p>
            </div>
          )}
          <button type="button" onClick={toggleSidebar} className="dep-iconbtn dep-collapse"
            aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'} title={`${mini ? 'Expand' : 'Collapse'} sidebar (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+B)`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: '#94a3b8', display: 'flex' }}>
            {mini ? <PanelLeftOpen style={{ width: 17, height: 17 }} /> : <PanelLeftClose style={{ width: 17, height: 17 }} />}
          </button>
        </div>
      </div>

      <div style={{ padding: mini ? '10px 12px 0' : '10px 10px 0' }}>
        <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Quick search" title={mini ? 'Quick search' : undefined}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : undefined, gap: 8, padding: mini ? '9px 0' : '8px 12px', borderRadius: 10, border: '1px solid var(--bd-e2e8f0)', background: 'var(--bg-f8fafc)', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
          <Search style={{ width: 14, height: 14 }} />
          {!mini && <><span style={{ flex: 1, textAlign: 'left' }}>Quick search</span>
          <kbd style={{ fontSize: 10, fontWeight: 600, border: '1px solid var(--bd-e2e8f0)', borderRadius: 4, padding: '1px 5px', background: 'var(--bg-fff)' }}>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd></>}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: mini ? '12px 10px' : '12px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ marginBottom: 8 }}>
          {!mini && <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
            letterSpacing: '.07em', padding: '4px 14px', margin: '0 0 4px' }}>Main</p>}
          {mainNav.map(n => <NavItem key={n.to} {...n} mini={mini} exact={n.to === '/'} />)}
        </div>

        {adminNav.length > 0 && (
          <div style={{ marginTop: mini ? 10 : 16, paddingTop: mini ? 10 : 0, borderTop: mini ? '1px solid var(--bd-f1f5f9)' : undefined }}>
            {!mini && <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
              letterSpacing: '.07em', padding: '4px 14px', margin: '0 0 4px' }}>Admin</p>}
            {adminNav.map(n => <NavItem key={n.to} {...n} mini={mini} />)}
          </div>
        )}
      </nav>

      {/* User footer */}
      <div style={{ padding: mini ? '12px 10px' : '12px 14px', borderTop: '1px solid var(--bd-f1f5f9)' }}>
        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative', marginBottom: 8 }}>
          <button onClick={() => setShowNotif(!showNotif)} title={mini ? 'Notifications' : undefined} aria-label="Notifications" className="dep-nav" style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : undefined, gap: 10,
            padding: mini ? '10px 0' : '8px 10px', borderRadius: 10, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 13, color: 'var(--tx-64748b)',
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
            {!mini && <span>Notifications</span>}
            {!mini && unread > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                background: 'var(--bg-fef2f2)', color: 'var(--tx-dc2626)', padding: '1px 6px', borderRadius: 20 }}>
                {unread} new
              </span>
            )}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: mini ? undefined : 0, width: mini ? 320 : undefined, marginBottom: 4,
              background: 'var(--bg-fff)', border: '1px solid var(--bd-e2e8f0)', borderRadius: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 380, display: 'flex', flexDirection: 'column', zIndex: 50,
            }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd-f1f5f9)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-0f172a)' }}>Notifications</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {unread > 0 && (
                    <button onClick={handleMarkAllRead}
                      style={{ fontSize: 11, color: 'var(--tx-2563eb)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Mark all read
                    </button>
                  )}
                  {unread > 0 && <span style={{ fontSize: 11, color: 'var(--tx-dc2626)', fontWeight: 600 }}>{unread} unread</span>}
                </div>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }} className="scrollbar-thin">
                {notifications.length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No notifications</div>
                  : notifications.slice(0, 10).map(n => (
                    <div key={n.id} onClick={() => handleNotifClick(n)}
                      style={{
                        position: 'relative', padding: '10px 14px 10px 18px', borderBottom: '1px solid var(--bd-f8fafc)',
                        background: n.is_read ? 'var(--bg-fff)' : 'var(--bg-eff6ff)', cursor: 'pointer', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = n.is_read ? 'var(--bg-f8fafc)' : 'var(--bg-dbeafe)'}
                      onMouseLeave={e => e.currentTarget.style.background = n.is_read ? 'var(--bg-fff)' : 'var(--bg-eff6ff)'}>
                      {!n.is_read && (
                        <span style={{ position: 'absolute', left: 6, top: 14, width: 6, height: 6, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }} />
                      )}
                      <p style={{ fontSize: 13, color: 'var(--tx-1e293b)', margin: '0 0 2px', fontWeight: n.is_read ? 400 : 600 }}>
                        {n.title}
                      </p>
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
              </div>
              <button onClick={() => { setShowNotif(false); navigate('/notifications') }}
                style={{ padding: '9px 14px', borderTop: '1px solid var(--bd-f1f5f9)', background: 'var(--bg-f8fafc)', border: 'none',
                  borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--bd-f1f5f9)', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: 'var(--tx-2563eb)', flexShrink: 0, width: '100%', textAlign: 'center' }}>
                View all notifications →
              </button>
            </div>
          )}
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: mini ? '4px 0' : '8px 10px', flexDirection: mini ? 'column' : 'row' }}>
          <div title={mini ? (user.full_name ?? user.email) : undefined} style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
          </div>
          {!mini && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1e293b)', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.full_name ?? user.email}
              </p>
              <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>
                {Array.isArray(user.roles) ? user.roles[0] : 'member'}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: mini ? 'column' : 'row', gap: 2 }}>
            <button onClick={toggleTheme} className="dep-iconbtn" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6,
                color: '#94a3b8', borderRadius: 8, display: 'flex', alignItems: 'center' }}>
              {dark ? <Sun style={{ width: 15, height: 15 }} /> : <Moon style={{ width: 15, height: 15 }} />}
            </button>
            <button onClick={() => { logout(); navigate('/login') }} className="dep-iconbtn"
              title="Sign out" aria-label="Sign out"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6,
                color: '#94a3b8', borderRadius: 8, display: 'flex', alignItems: 'center' }}>
              <LogOut style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--page)' }}>
      {/* Desktop sidebar */}
      <div style={{ display: 'none' }} className="dep-sidebar">
        <style>{`@media(min-width:768px){.dep-sidebar{display:block!important}}.dep-nav:hover{background:var(--bg-f8fafc)}.dep-iconbtn:hover{background:var(--bg-f1f5f9);color:var(--tx-0f172a)}@media(prefers-reduced-motion:reduce){aside{transition:none!important}}`}</style>
        <Sidebar mini={collapsed} />
      </div>

      {/* Mobile header */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 56, zIndex: 40,
        background: 'var(--bg-fff)', borderBottom: '1px solid var(--bd-e2e8f0)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }} className="dep-mobile-hdr">
        <style>{`@media(min-width:768px){.dep-mobile-hdr{display:none!important}}`}</style>
        <button onClick={() => setMobileOpen(!mobileOpen)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-64748b)', padding: 4 }}>
          {mobileOpen ? <X style={{ width: 20, height: 20 }} /> : <Menu style={{ width: 20, height: 20 }} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database style={{ width: 14, height: 14, color: '#fff' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-0f172a)' }}>Data Extraction Platform</span>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}
          className="dep-mobile-overlay">
          <style>{`@media(min-width:768px){.dep-mobile-overlay{display:none!important}}.dep-mobile-overlay .dep-collapse{display:none!important}`}</style>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setMobileOpen(false)} />
          <div style={{ position: 'relative', width: 240 }}>
            <Sidebar mini={false} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, paddingTop: 0 }} className="dep-main">
        <style>{`@media(max-width:767px){.dep-main{padding-top:56px!important}}`}</style>
        {location.pathname !== '/notifications' && (
          <NotificationBanner
            items={notifications.filter(n => !n.is_read)} total={unreadTotal}
            onOpen={handleNotifClick} onAck={handleAck} onAckAll={handleMarkAllRead}
            onViewAll={() => navigate('/notifications')}
            pinned={!location.pathname.startsWith('/quality')}
          />
        )}
        <ConnectionBanner />
        <ErrorBoundary resetKey={location.pathname}><Outlet /></ErrorBoundary>
      </main>

      <ToastContainer />
      <UndoBanner />
      <ConfirmHost />
      <IdleGuard onTimeout={() => { logout() }} />
      <CommandPalette pages={[...mainNav, ...adminNav].map(n => ({ to: n.to, label: n.label }))} open={paletteOpen} onClose={() => setPaletteOpen(false)}
        actions={[
          { id: 'theme', label: dark ? 'Switch to light mode' : 'Switch to dark mode', hint: 'Appearance', run: toggleTheme },
          { id: 'sidebar', label: collapsed ? 'Expand the sidebar' : 'Collapse the sidebar', hint: 'Ctrl+B', run: toggleSidebar },
          { id: 'keys', label: 'Keyboard shortcuts', hint: 'Press ? anywhere', run: () => setHelpOpen(true) },
        ]} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
