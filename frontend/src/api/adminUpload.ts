import { api } from './client'

export interface BatchFile {
  file: string; error?: string | null; records: number; names: string[]; source_id: string | null; source_name: string | null; status: string | null
  existing_records: number; suggested_mode: 'draft' | 'reference'; valid: number; invalid: number; errors: string[]
  candidates: { id: string; name: string; status: string; score: number }[]
}

export const adminUploadApi = {
  state: (sourceId: string) => api.get(`/admin-upload/${sourceId}`).then(r => r.data as { draft: boolean; records?: number; invalid?: number; since?: string; by?: string; file?: string; can_submit?: boolean }),
  submit: (sourceId: string) => api.post(`/admin-upload/${sourceId}/submit`).then(r => r.data),
  preview: (file: File, projectId?: string) => {
    const fd = new FormData(); fd.append('file', file); if (projectId) fd.append('project_id', projectId)
    return api.post('/admin-upload/batch/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }).then(r => r.data as { files: BatchFile[]; sources: { id: string; name: string; status: string }[] })
  },
  apply: (file: File, plan: { file: string; source_id: string; mode: string }[], projectId?: string) => {
    const fd = new FormData(); fd.append('file', file); fd.append('plan', JSON.stringify(plan)); if (projectId) fd.append('project_id', projectId)
    return api.post('/admin-upload/batch/apply', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
      .then(r => r.data as { results: { file: string; source_id: string; source_name?: string; mode: string; ok: boolean; records?: number; valid?: number; invalid?: number; error?: string }[]; done: number; failed: number })
  },
}
