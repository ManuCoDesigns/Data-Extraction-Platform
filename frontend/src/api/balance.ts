import { api } from './client'

export const balanceApi = {
  get: (projectId: string) => api.get(`/balance/${projectId}`).then(r => r.data),
  update: (projectId: string, body: { enabled?: boolean; set_aside?: string[] }) => api.put(`/balance/${projectId}`, body).then(r => r.data),
  run: (projectId: string) => api.post(`/balance/${projectId}/run`).then(r => r.data as { moved: number; view: any }),
}
