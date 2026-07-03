import { create } from 'zustand'
import type { User } from '@/types'
import { authApi } from '@/api/client'

interface AuthState {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
  hasRole: (role: string) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,

  login: async (email, password) => {
    const data = await authApi.login(email, password)
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    const me = await authApi.me()
    set({ user: me, isLoading: false })
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    set({ user: null, isLoading: false })
    window.location.href = '/login'
  },

  fetchMe: async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      set({ isLoading: false })
      return
    }
    try {
      const me = await authApi.me()
      set({ user: me, isLoading: false })
    } catch (err: any) {
      // 401 — try to refresh the token first
      const refreshToken = localStorage.getItem('refresh_token')
      if (refreshToken) {
        try {
          const refreshed = await authApi.refresh(refreshToken)
          localStorage.setItem('access_token', refreshed.access_token)
          if (refreshed.refresh_token) {
            localStorage.setItem('refresh_token', refreshed.refresh_token)
          }
          const me = await authApi.me()
          set({ user: me, isLoading: false })
          return
        } catch {
          // Refresh also failed — full logout
        }
      }
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isLoading: false })
    }
  },

  hasRole: (role) => {
    const { user } = get()
    return user?.roles.includes(role) ?? false
  },
}))
