import { api } from './client'

export const sopAssignApi = {
  library: () => api.get('/sop-assign/library').then(r => r.data as { version: string; sops: { code: string; title: string; use_when: string }[] }),
  suggestions: (params: { project_id?: string; scope?: string }) => api.get('/sop-assign/suggestions', { params }).then(r => r.data),
  apply: (items: { source_id: string; sop_code: string }[]) => api.post('/sop-assign/apply', { items }).then(r => r.data as { applied: number; skipped: any[] }),
  clear: (sourceId: string) => api.delete(`/sop-assign/${sourceId}`).then(r => r.data),
}
