import { useEffect, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { useUndo } from '@/lib/undo'
import { toast } from '@/components/ui'

/** Small bar at the bottom left that lets you take back the last bulk change for 20 seconds. */
export function UndoBanner() {
  const { item, clear } = useUndo()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!item) return
    const t = setTimeout(clear, 20000)
    return () => clearTimeout(t)
  }, [item?.id])

  if (!item) return null
  const go = async () => {
    setBusy(true)
    try {
      const msg = await item.run()
      toast.success(msg || 'Change undone')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Couldn't undo that change")
    } finally { setBusy(false); clear() }
  }
  return (
    <div role="status" className="fixed bottom-5 left-5 z-50 flex items-center gap-3 bg-gray-900 text-white rounded-2xl shadow-float pl-4 pr-2 py-2.5 max-w-[92vw] animate-slide-up">
      <span className="text-sm">{item.label}</span>
      <button onClick={go} disabled={busy}
        className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 hover:bg-white/20 disabled:opacity-60 rounded-xl px-3 py-1.5 transition">
        <Undo2 className="w-3.5 h-3.5" /> {busy ? 'Undoing…' : 'Undo'}
      </button>
      <button onClick={clear} aria-label="Dismiss" className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}
