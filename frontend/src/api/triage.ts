import { api } from './client'

export const triageApi = {
  list: (params: { project_id?: string }) => api.get('/observations/triage', { params }).then(r => r.data),
  save: (items: { source_id: string; kind: string; note?: string }[]) => api.post('/observations/triage', { items }).then(r => r.data as { saved: number; skipped: any[] }),
}
