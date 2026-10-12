// Remembers the list of sources you were working through, so the source page can
// offer "previous / next" in the same order you saw them. Session-only (per tab).
export interface NavItem { id: string; project_id: string; name: string }
export interface NavContext { items: NavItem[]; backTo: string; label: string }

const KEY = 'dx.sourceNav'

export function saveNav(items: NavItem[], backTo = '/sources', label = 'Sources') {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      items: items.map(i => ({ id: i.id, project_id: i.project_id, name: i.name })),
      backTo, label,
    }))
  } catch { /* storage unavailable (private window): navigation just won't be offered */ }
}

export function readNav(): NavContext | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!Array.isArray(v?.items)) return null
    return { items: v.items, backTo: String(v.backTo || '/sources'), label: String(v.label || 'Sources') }
  } catch {
    return null
  }
}

// True while the person is typing, so single-key shortcuts must not fire.
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    || !!el.closest?.('.monaco-editor')
}
