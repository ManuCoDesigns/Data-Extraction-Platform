import { api } from './client'

export interface BatchFile {
  saved_copies?: number
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
  library: () => api.get('/admin-upload/library').then(r => r.data as { batches: { batch_id: string; label: string; created_at: string; copies: CopyMeta[] }[] }),
  copies: (sourceId: string) => api.get(`/admin-upload/source/${sourceId}/copies`).then(r => r.data as { copies: CopyMeta[] }),
  compareCopy: (copyId: string, sourceId?: string) => api.get(`/admin-upload/copy/${copyId}/compare`, { params: { source_id: sourceId } }).then(r => r.data),
  downloadCopy: (copyId: string) => api.get(`/admin-upload/copy/${copyId}/download`, { responseType: 'text', transformResponse: x => x }).then(r => r.data as string),
  applyCopy: (copyId: string, mode: 'draft' | 'submit', sourceId?: string) => api.post(`/admin-upload/copy/${copyId}/apply`, { mode, source_id: sourceId }).then(r => r.data),
  deleteCopy: (copyId: string) => api.delete(`/admin-upload/copy/${copyId}`).then(r => r.data),
  applyBatch: (batchId: string, mode: 'draft' | 'submit') => api.post(`/admin-upload/library/${batchId}/apply`, { mode }).then(r => r.data as { results: any[]; done: number; failed: number }),
  deleteBatch: (batchId: string) => api.delete(`/admin-upload/library/${batchId}`).then(r => r.data),
  recordCompare: (sourceId: string, recordId: string) => api.get(`/admin-upload/source/${sourceId}/record/${recordId}`).then(r => r.data as { found: boolean; copy?: CopyMeta; differs?: number; same?: number; diff?: { field: string; live: any; copy: any }[]; copies?: number }),
}

export interface CopyMeta {
  id: string; source_id: string | null; source_name: string; batch_id: string; batch_label: string; file: string; records: number; valid: number; invalid: number
  created_at: string; applied_at: string | null; source_present?: boolean; current_source_id?: string | null; current_status?: string | null
}
