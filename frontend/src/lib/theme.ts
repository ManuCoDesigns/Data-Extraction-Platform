import { create } from 'zustand'

export type ThemeChoice = 'dark' | 'light' | 'system'
const KEY = 'dep_theme'

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light' || v === 'system') return v } catch { /* storage blocked */ }
  return 'dark'   // dark is the default
}

export function isDark(choice: ThemeChoice) {
  if (choice === 'system') return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return choice === 'dark'
}

export function applyTheme(choice: ThemeChoice) {
  const dark = isDark(choice)
  const el = document.documentElement
  el.classList.toggle('dark', dark)
  el.style.colorScheme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0b1120' : '#f8fafc')
}

interface ThemeState { choice: ThemeChoice; dark: boolean; set: (c: ThemeChoice) => void; toggle: () => void }

export const useTheme = create<ThemeState>((set, get) => ({
  choice: read(),
  dark: isDark(read()),
  set: (choice) => {
    try { localStorage.setItem(KEY, choice) } catch { /* private window */ }
    applyTheme(choice)
    set({ choice, dark: isDark(choice) })
  },
  toggle: () => get().set(get().dark ? 'light' : 'dark'),
}))

// Follow the operating system when "System" is chosen.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    const { choice } = useTheme.getState()
    if (choice === 'system') { applyTheme('system'); useTheme.setState({ dark: isDark('system') }) }
  })
}

// Paper is white: print in light colours, then put the screen theme back.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => { document.documentElement.classList.remove('dark') })
  window.addEventListener('afterprint', () => { applyTheme(useTheme.getState().choice) })
}
