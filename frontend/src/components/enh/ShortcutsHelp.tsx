import { useEffect } from 'react'
import { X } from 'lucide-react'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = MAC ? '⌘' : 'Ctrl'

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Anywhere', rows: [
    [[MOD, 'K'], 'Quick search: jump to a source, project or page'],
    [[MOD, 'B'], 'Collapse or expand the sidebar'],
    [['?'], 'Show this list'],
  ] },
  { title: 'Go to (press G, then a letter)', rows: [
    [['G', 'D'], 'Dashboard'], [['G', 'S'], 'Sources'], [['G', 'P'], 'Projects'],
    [['G', 'H'], 'Data health'], [['G', 'Q'], 'Client questions'], [['G', 'I'], 'Insights'],
  ] },
  { title: 'In the sources list', rows: [
    [['↑', '↓'], 'Move through the list'], [['Enter'], 'Open the highlighted source'], [['/'], 'Search sources'],
  ] },
]

function Key({ k }: { k: string }) {
  return <kbd className="min-w-[24px] text-center text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 border-b-2 rounded-md px-1.5 py-0.5">{k}</kbd>
}

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] animate-fade-in" aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="relative w-full max-w-lg bg-white rounded-2xl shadow-float border border-gray-100 animate-slide-up max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 m-0">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h3 className="text-xs font-semibold text-gray-500 m-0 mb-2">{g.title}</h3>
              <ul className="m-0 p-0 list-none space-y-2">
                {g.rows.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-4 text-sm text-gray-700">
                    <span>{label}</span>
                    <span className="flex items-center gap-1 shrink-0">{keys.map((k, i) => <span key={i} className="flex items-center gap-1">{i > 0 && keys[0] === 'G' && <span className="text-[10px] text-gray-300">then</span>}<Key k={k} /></span>)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
