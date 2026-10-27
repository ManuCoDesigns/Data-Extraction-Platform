import { create } from 'zustand'

export type AskTone = 'brand' | 'danger' | 'warning'
export interface AskOptions { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: AskTone; details?: string[] }
interface Pending { message: string; opts: AskOptions; resolve: (ok: boolean) => void }
interface State { pending: Pending | null; open: (p: Pending) => void; close: (ok: boolean) => void }

export const useConfirm = create<State>((set, get) => ({
  pending: null,
  open: p => { get().pending?.resolve(false); set({ pending: p }) },
  close: ok => { const p = get().pending; set({ pending: null }); p?.resolve(ok) },
}))

/**
 * A styled replacement for window.confirm. Usage: `if (!await ask('Delete this message?\n\nIt goes for everyone.', { tone: 'danger', confirmLabel: 'Delete' })) return`
 * The first paragraph is the title, the rest is the explanation. Lines starting with "•" or "-" become a list.
 */
export function ask(message: string, opts: AskOptions = {}): Promise<boolean> {
  return new Promise(resolve => useConfirm.getState().open({ message, opts, resolve }))
}
