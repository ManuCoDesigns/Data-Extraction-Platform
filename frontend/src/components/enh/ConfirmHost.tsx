import { useEffect, useRef } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { useConfirm } from '@/lib/confirm'
import { Button, cn } from '@/components/ui'

/** The dialog behind ask(). Mounted once in the app layout. Escape cancels, Enter confirms. */
export function ConfirmHost() {
  const { pending, close } = useConfirm()
  const yes = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pending) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(false) } }
    document.addEventListener('keydown', h)
    const t = setTimeout(() => yes.current?.querySelector('button')?.focus(), 30)
    return () => { document.removeEventListener('keydown', h); clearTimeout(t) }
  }, [pending, close])
  if (!pending) return null

  const { message, opts } = pending
  const tone = opts.tone ?? 'brand'
  const paras = message.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const title = opts.title ?? (paras.shift() ?? 'Are you sure?')
  const isList = (p: string) => p.split('\n').every(l => /^\s*[•\-]/.test(l))
  const Icon = tone === 'brand' ? HelpCircle : AlertTriangle
  const ring = tone === 'danger' ? 'bg-red-100 text-red-600' : tone === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-brand-50 text-brand-600'
  const confirmCls = tone === 'danger' ? '!bg-red-600 hover:!bg-red-700 focus:!ring-red-500' : tone === 'warning' ? '!bg-amber-500 hover:!bg-amber-600 focus:!ring-amber-400' : ''

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => close(false)} />
      <div className="relative bg-white rounded-2xl shadow-float w-full max-w-md animate-slide-up overflow-hidden">
        <div className="p-6 flex gap-4">
          <span className={cn('shrink-0 w-10 h-10 rounded-full flex items-center justify-center', ring)}><Icon className="w-5 h-5" /></span>
          <div className="min-w-0 space-y-2">
            <h2 className="text-base font-semibold text-gray-900 m-0">{title}</h2>
            {paras.map((p, i) => isList(p)
              ? <ul key={i} className="m-0 pl-0 list-none rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 max-h-48 overflow-y-auto space-y-0.5">{p.split('\n').map((l, j) => <li key={j} className="text-[13px] text-gray-700">{l.replace(/^\s*[•\-]\s*/, '')}</li>)}</ul>
              : <p key={i} className="text-sm text-gray-600 m-0 whitespace-pre-line leading-relaxed">{p}</p>)}
            {(opts.details ?? []).length > 0 && <ul className="m-0 pl-4 text-[13px] text-gray-600">{opts.details!.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50/60">
          <Button variant="secondary" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</Button>
          <div ref={yes}><Button onClick={() => close(true)} className={confirmCls}>{opts.confirmLabel ?? 'Confirm'}</Button></div>
        </div>
      </div>
    </div>
  )
}
