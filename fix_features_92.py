#!/usr/bin/env python3
"""Extractors keep the plain sidebar; grouping is for admins and leads. Run from the repo root (the folder that holds backend/ and frontend/).
Safe to run twice: files already applied are skipped."""
import os, sys, zlib, base64
sys.stdout.reconfigure(errors='replace')
NEW = {}
MOD = {'frontend/src/components/layout/AppLayout.tsx': [("    return { to: items[0].to, icon: g.icon, label: g.label, show: true, badge, badgeColor: items.some(i => i.badge && !i.badgeColor) ? '#dc2626' : '#d97706', forceActive: items.some(i => here(i.to)) }\n  }\n  const activeGroup = GROUPS.find(g => vis(g).length > 1 && vis(g).some(i => here(i.to)))\n\n  const mainNav = [\n    { to: '/',            icon: LayoutDashboard, label: 'Dashboard',    show: true },\n    { to: '/sources',     icon: Database,        label: 'Sources',      show: true, forceActive: isSourcesPath },", "    return { to: items[0].to, icon: g.icon, label: g.label, show: true, badge, badgeColor: items.some(i => i.badge && !i.badgeColor) ? '#dc2626' : '#d97706', forceActive: items.some(i => here(i.to)) }\n  }\n  const activeGroup = !isTeamLead ? undefined : GROUPS.find(g => vis(g).length > 1 && vis(g).some(i => here(i.to)))\n\n  // Extractors keep the plain list they always had (plus Link triage). Grouping is for admins and leads, who have many more pages.\n  const flatNav = [\n    { to: '/',            icon: LayoutDashboard, label: 'Dashboard',    show: true },\n    { to: '/sources',     icon: Database,        label: 'Sources',      show: true, forceActive: isSourcesPath },\n    { to: '/triage',      icon: Link2Off,        label: 'Link triage',  show: true },\n    { to: '/escalations', icon: AlertTriangle,   label: 'Escalations',  show: true, badge: escalationCount },\n    { to: '/projects',    icon: FolderKanban,    label: 'Projects',     show: true, forceActive: isProjectsPath },\n    { to: '/messages',    icon: MessageCircle,   label: 'Messages',     show: true, badge: counts.unread_messages },\n    { to: '/data-health', icon: HeartPulse,      label: 'Data Health',  show: true, badge: counts.link_problems, badgeColor: '#d97706' },\n    { to: '/client-questions', icon: CircleHelp, label: 'Client Questions', show: true, badge: counts.open_questions, badgeColor: '#d97706' },\n    { to: '/insights',    icon: ChartColumn,     label: 'My Stats',     show: true },\n  ]\n  const groupedNav = [\n    { to: '/',            icon: LayoutDashboard, label: 'Dashboard',    show: true },\n    { to: '/sources',     icon: Database,        label: 'Sources',      show: true, forceActive: isSourcesPath },"), ("    { to: '/messages',   icon: MessageCircle,   label: 'Messages',     show: true, badge: counts.unread_messages },\n    groupEntry('setup'),\n  ].filter((n): n is any => !!n && n.show)\n\n  const adminNav = [\n    groupEntry('admin'),\n    { to: '/help',        icon: BookOpen, label: 'Help',     show: true },\n  ].filter((n): n is any => !!n && n.show)", "    { to: '/messages',   icon: MessageCircle,   label: 'Messages',     show: true, badge: counts.unread_messages },\n    groupEntry('setup'),\n  ]\n  const mainNav = (isTeamLead ? groupedNav : flatNav).filter((n): n is any => !!n && n.show)\n\n  const adminNav = [\n    isTeamLead ? groupEntry('admin') : null,\n    { to: '/help',        icon: BookOpen, label: 'Help',     show: true },\n  ].filter((n): n is any => !!n && n.show)")]}
root = os.getcwd()
if not (os.path.isdir(os.path.join(root, 'backend')) and os.path.isdir(os.path.join(root, 'frontend'))):
    sys.exit('Run this from the repo root (the folder containing backend and frontend).')
def rd(p): return open(p, encoding='utf-8', newline='').read()
done = skipped = 0; bad = []
for rel, hunks in MOD.items():
    p = os.path.join(root, rel)
    if not os.path.exists(p): bad.append(rel + ' (missing)'); continue
    raw = rd(p); crlf = '\r\n' in raw; t = raw.replace('\r\n', '\n'); changed = False
    for old, new in hunks:
        if new in t: continue
        elif t.count(old) == 1: t = t.replace(old, new); changed = True
        else: bad.append(rel + ' (a section does not match; file differs from expected version)'); break
    else:
        if changed:
            open(p, 'w', encoding='utf-8', newline='').write(t.replace('\n', '\r\n') if crlf else t); done += 1; print('updated ', rel)
        else: skipped += 1
for rel, blob in NEW.items():
    p = os.path.join(root, rel); data = zlib.decompress(base64.b64decode(blob))
    if os.path.exists(p) and open(p, 'rb').read() == data: skipped += 1; continue
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(data); done += 1; print('wrote   ', rel)
print(f'\n{done} changed, {skipped} already applied.')
if bad:
    print('\nPROBLEMS:'); [print(' -', b) for b in bad]; sys.exit(1)
