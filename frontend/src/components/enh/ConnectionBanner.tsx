import { WifiOff } from 'lucide-react'
import { useServerDown } from '@/lib/net'

/** Shown on top of every page when the server cannot be reached, and gone again when it answers. */
export function ConnectionBanner() {
  const down = useServerDown()
  if (!down) return null
  return (
    <div role="alert" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-medium px-4 py-2">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Can't reach the server. Your work on this page is safe. We'll keep trying.</span>
      <button type="button" onClick={() => window.location.reload()} className="ml-2 underline underline-offset-2 hover:no-underline">Reload</button>
    </div>
  )
}
