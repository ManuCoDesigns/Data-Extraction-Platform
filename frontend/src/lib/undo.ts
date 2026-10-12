import { create } from 'zustand'

export interface UndoItem { id: number; label: string; run: () => Promise<string | void> }

interface UndoState { item: UndoItem | null; offer: (label: string, run: UndoItem['run']) => void; clear: () => void }

let n = 0
/** One "Undo" offer at a time. A new action replaces the old offer. */
export const useUndo = create<UndoState>(set => ({
  item: null,
  offer: (label, run) => set({ item: { id: ++n, label, run } }),
  clear: () => set({ item: null }),
}))
