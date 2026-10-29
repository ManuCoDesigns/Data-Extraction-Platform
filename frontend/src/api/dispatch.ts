import { api } from './client'

export const dispatchApi = {
  get: (projectId: string) => api.get(`/dispatch/${projectId}`).then(r => r.data),
  hold: (projectId: string, body: { hold: boolean; batch_key?: string; source_ids?: string[]; everything?: boolean; only_unstarted?: boolean }) =>
    api.post(`/dispatch/${projectId}/hold`, body).then(r => r.data as { changed: number; view: any }),
  share: (projectId: string, body: { batch_key?: string; source_ids?: string[] }) =>
    api.post(`/dispatch/${projectId}/share`, body).then(r => r.data as { assigned: number; left: number; reason: string | null; per_person: Record<string, number>; view: any }),
  auto: (projectId: string, auto_share: boolean) => api.put(`/dispatch/${projectId}/auto`, { auto_share }).then(r => r.data),
}
