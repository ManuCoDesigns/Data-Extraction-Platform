import { useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Check, Download, Trash2 } from 'lucide-react'
import { cn, toast } from '@/components/ui'

export interface ViewState { view: string; search: string; projectFilter: string; mineOnly: boolean }
interface Saved { id: string; name: string; state: ViewState }

const KEY = 'dx.savedViews'
const read = (): Saved[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const write = (v: Saved[]) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private window: views last until reload */ } }

const same = (a: ViewState, b: ViewState) => a.view === b.view && a.search === b.search && a.projectFilter === b.projectFilter && a.mineOnly === b.mineOnly

/** Remember a combination of view, search, project and "assigned to me", and export the list on screen to CSV. */
export function SavedViews({ current, onApply, onExport, exportCount }: {
  current: ViewState; onApply: (s: ViewState) => void; onExport: () => void; exportCount: number
}) {
  const [items, setItems] = useState<Saved[]>(read)
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setNaming(false) } }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setNaming(false) } }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const active = items.find(i => same(i.state, current))
  const save = () => {
    const n = name.trim()
    if (!n) return
    if (items.some(i => i.name.toLowerCase() === n.toLowerCase())) { toast.error('You already have a view with that name'); return }
    const next = [...items, { id: Math.random().toString(36).slice(2), name: n, state: current }]
    setItems(next); write(next); setName(''); setNaming(false); toast.success(`Saved view "${n}"`)
  }
  const remove = (id: string) => { const next = items.filter(i => i.id !== id); setItems(next); write(next) }

  return (
    <div className="flex items-center gap-2" ref={box}>
      <div className="relative">
        <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200',
            active ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
          <Bookmark className="w-3.5 h-3.5" /> {active ? active.name : 'Views'}
        </button>
        {open && (
          <div role="menu" className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-xl border border-gray-100 shadow-float z-30 overflow-hidden animate-fade-in">
            {items.length === 0 && !naming && (
              <p className="px-4 py-4 text-xs text-gray-400 m-0 leading-relaxed">Set up the list the way you like it, such as Assigned to me with one project, then save it here to come back in one click.</p>
            )}
            <ul className="m-0 p-1 list-none max-h-60 overflow-y-auto">
              {items.map(i => (
                <li key={i.id} className="flex items-center group">
                  <button type="button" role="menuitem" onClick={() => { onApply(i.state); setOpen(false) }}
                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-gray-800 hover:bg-gray-50">
                    <Check className={cn('w-3.5 h-3.5 shrink-0', active?.id === i.id ? 'text-brand-600' : 'text-transparent')} />
                    <span className="truncate">{i.name}</span>
                  </button>
                  <button type="button" onClick={() => remove(i.id)} aria-label={`Delete view ${i.name}`}
                    className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-50 p-2">
              {naming ? (
                <form onSubmit={e => { e.preventDefault(); save() }} className="flex items-center gap-2">
                  <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Name this view" aria-label="View name"
                    className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <button type="submit" disabled={!name.trim()} className="text-xs font-semibold text-white bg-brand-600 rounded-lg px-3 py-2 disabled:opacity-40">Save</button>
                </form>
              ) : (
                <button type="button" onClick={() => setNaming(true)} disabled={!!active}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:text-gray-300 disabled:hover:bg-transparent">
                  <BookmarkPlus className="w-3.5 h-3.5" /> {active ? 'This view is already saved' : 'Save current view'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <button type="button" onClick={onExport} disabled={exportCount === 0} title={`Download the ${exportCount} source${exportCount === 1 ? '' : 's'} shown as a CSV file`}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-white text-gray-600 border-gray-200 hover:bg-gray-50 transition flex items-center gap-1.5 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-200">
        <Download className="w-3.5 h-3.5" /> Export CSV
      </button>
    </div>
  )
}
