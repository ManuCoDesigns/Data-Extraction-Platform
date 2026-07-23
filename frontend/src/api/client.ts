import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ─── Token refresh queue ─────────────────────────────────────────────────────
// When the access token expires, multiple concurrent requests all get 401.
// Without a queue, each one would try to refresh — causing race conditions and
// repeated refresh calls that invalidate each other.
// Solution: the first 401 starts the refresh, all others wait in a queue.
// When refresh succeeds, every queued request gets the new token and retries.

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

function processQueue(newToken: string | null, error: unknown = null) {
  refreshQueue.forEach(resolve => {
    if (newToken) resolve(newToken)
  })
  refreshQueue = []
}

function redirectToLogin() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login'
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    // Don't retry non-401 errors or requests that already retried
    if (!error.response || error.response.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    // Don't retry the refresh endpoint itself
    if (original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      redirectToLogin()
      return Promise.reject(error)
    }

    // If already refreshing — queue this request and wait
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((newToken: string) => {
          original.headers.Authorization = `Bearer ${newToken}`
          original._retry = true
          resolve(api(original))
        })
      })
    }

    // Start refresh
    original._retry = true
    isRefreshing = true

    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) {
      redirectToLogin()
      return Promise.reject(error)
    }

    try {
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
      const newToken = data.access_token
      localStorage.setItem('access_token', newToken)
      localStorage.setItem('refresh_token', data.refresh_token)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
      processQueue(newToken)
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch (refreshError) {
      processQueue(null, refreshError)
      redirectToLogin()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }).then(r => r.data),
}

// ─── Projects ─────────────────────────────────────────────────────────────────
export const projectsApi = {
  list: (page = 1) => api.get('/projects', { params: { page } }).then(r => r.data),
  get: (id: string) => api.get(`/projects/${id}`).then(r => r.data),
  create: (data: { name: string; description?: string }) =>
    api.post('/projects', data).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/projects/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/projects/${id}`).then(r => r.data),
  listMembers: (id: string) => api.get(`/projects/${id}/members`).then(r => r.data),
  addMember: (projectId: string, userId: string, role: string) =>
    api.post(`/projects/${projectId}/members`, { user_id: userId, role }).then(r => r.data),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`).then(r => r.data),
  exportProject: async (projectId: string, status = 'all', filename?: string) => {
    const r = await api.get(`/projects/${projectId}/export`, {
      params: { status },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(new Blob([r.data], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `project_export_${new Date().toISOString().slice(0,10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  },
  exportPreview: (projectId: string) =>
    api.get(`/projects/${projectId}/export-preview`).then(r => r.data),
  exportPackage: async (projectId: string, projectName = 'project') => {
    const r = await api.get(`/projects/${projectId}/export-package`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([r.data], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/[^a-z0-9]/gi, '_')}_package_${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  },
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export const jobsApi = {
  list: (params?: object) => api.get('/jobs', { params }).then(r => r.data),
  get: (id: string) => api.get(`/jobs/${id}`).then(r => r.data),
  history: (id: string) => api.get(`/jobs/${id}/history`).then(r => r.data),
  retry: (id: string) => api.post(`/jobs/${id}/retry`).then(r => r.data),
  skipLlm: (id: string) => api.post(`/jobs/${id}/skip-llm`).then(r => r.data),
  delete: (id: string) => api.delete(`/jobs/${id}`).then(r => r.data),
  upload: (projectId: string, formData: FormData) =>
    api.post(`/jobs/${projectId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
}

// ─── Records ──────────────────────────────────────────────────────────────────
export const recordsApi = {
  list: (jobId: string, params?: object) =>
    api.get('/records', { params: { job_id: jobId, ...params } }).then(r => r.data),
  get: (id: string) => api.get(`/records/${id}`).then(r => r.data),
  review: (id: string, action: string, note?: string, overrides?: Record<string, unknown>) =>
    api.post(`/records/${id}/review`, { action, note, field_overrides: overrides }).then(r => r.data),
  bulkReview: (recordIds: string[], action: string, note?: string) =>
    api.post('/records/bulk-review', { record_ids: recordIds, action, note }).then(r => r.data),
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
export const schemasApi = {
  list: (projectId?: string) =>
    api.get('/schemas', { params: { project_id: projectId } }).then(r => r.data),
  create: (projectId: string, data: { name: string; definition: object }) =>
    api.post(`/schemas/${projectId}`, data).then(r => r.data),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.patch(`/schemas/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/schemas/${id}`).then(r => r.data),
  versions: (id: string) => api.get(`/schemas/${id}/versions`).then(r => r.data),
  addVersion: (id: string, data: { name: string; definition: object }) =>
    api.post(`/schemas/${id}/versions`, data).then(r => r.data),
  archive: (id: string) => api.post(`/schemas/${id}/archive`).then(r => r.data),
}

// ─── Submission ───────────────────────────────────────────────────────────────
export const submissionApi = {
  submit: (jobId: string, recordIds?: string[]) =>
    api.post(
      `/jobs/${jobId}/submit`,
      { destination: 'json_download', record_ids: recordIds ?? null },
      { responseType: 'blob' }
    ).then(r => r),
  list: (jobId: string) => api.get(`/jobs/${jobId}/submissions`).then(r => r.data),
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export const statsApi = {
  dashboard: () => api.get('/stats/dashboard').then(r => r.data),
  sourcesSummary: () => api.get('/stats/sources-summary').then(r => r.data),
  productivity: (projectId?: string) =>
    api.get('/stats/productivity', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data),
}

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => api.get('/notifications').then(r => r.data),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.post('/notifications/read-all').then(r => r.data),
}

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => api.get('/users').then(r => r.data),
  get: (id: string) => api.get(`/users/${id}`).then(r => r.data),
  create: (data: object) => api.post('/users', data).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/users/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/users/${id}`).then(r => r.data),
}

// ─── Project Resources ────────────────────────────────────────────────────────
export const resourcesApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/resources`).then(r => r.data),
  createFile: (projectId: string, formData: FormData) =>
    api.post(`/projects/${projectId}/resources`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  createLink: (projectId: string, title: string, url: string, description?: string) => {
    const fd = new FormData()
    fd.append('type', 'link')
    fd.append('title', title)
    fd.append('url', url)
    if (description) fd.append('description', description)
    return api.post(`/projects/${projectId}/resources`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  createInstruction: (projectId: string, type: 'instruction' | 'sop', title: string, body: string, description?: string) => {
    const fd = new FormData()
    fd.append('type', type)
    fd.append('title', title)
    fd.append('body', body)
    if (description) fd.append('description', description)
    return api.post(`/projects/${projectId}/resources`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  delete: (projectId: string, resourceId: string) =>
    api.delete(`/projects/${projectId}/resources/${resourceId}`).then(r => r.data),
  download: async (projectId: string, resourceId: string, filename: string) => {
    const res = await api.get(`/projects/${projectId}/resources/${resourceId}/download`, { responseType: 'blob' })
    triggerBrowserDownload(res.data, filename)
  },
}

// ─── Work Submissions ─────────────────────────────────────────────────────────
export const workSubmissionsApi = {
  list: (projectId: string, status?: string) =>
    api.get(`/projects/${projectId}/submissions`, { params: { status } }).then(r => r.data),
  listMine: () => api.get('/submissions/me').then(r => r.data),
  create: (projectId: string, formData: FormData) =>
    api.post(`/projects/${projectId}/submissions`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  review: (submissionId: string, action: string, notes?: string) =>
    api.post(`/submissions/${submissionId}/review`, { action, notes }).then(r => r.data),
  download: async (submissionId: string, filename: string) => {
    const res = await api.get(`/submissions/${submissionId}/download`, { responseType: 'blob' })
    triggerBrowserDownload(res.data, filename)
  },
}

// ─── Sources ──────────────────────────────────────────────────────────────────
export const sourcesApi = {
  list: (projectId?: string, status?: string, assignedToMe?: boolean) =>
    api.get('/sources', { params: { project_id: projectId, status, assigned_to_me: assignedToMe || undefined } }).then(r => r.data),
  create: (projectId: string, data: object) =>
    api.post('/sources', data, { params: { project_id: projectId } }).then(r => r.data),
  get: (id: string) => api.get(`/sources/${id}`).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/sources/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/sources/${id}`).then(r => r.data),
  upload: (id: string, formData: FormData) =>
    api.post(`/sources/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  uploadMulti: (id: string, files: File[]) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f, (f as any).webkitRelativePath || f.name))
    return api.post(`/sources/${id}/upload-multi`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  workload: (projectId?: string) =>
    api.get('/sources/workload', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data),
  exportTimesheet: async (projectId?: string) => {
    const res = await api.get('/sources/export/timesheet', {
      params: projectId ? { project_id: projectId } : {},
      responseType: 'blob',
    })
    const disposition = res.headers['content-disposition'] as string | undefined
    const match = disposition?.match(/filename="?([^"]+)"?/)
    const filename = match?.[1] || `delivery_timesheet_${new Date().toISOString().slice(0, 10)}.xlsx`
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },
  records: (id: string, params?: object) =>
    api.get(`/sources/${id}/records`, { params }).then(r => r.data),
  fixRecord: (sourceId: string, recordId: string, extracted_fields: object) =>
    api.patch(`/sources/${sourceId}/records/${recordId}`, { extracted_fields }).then(r => r.data),
  deleteRecord: (sourceId: string, recordId: string) =>
    api.delete(`/sources/${sourceId}/records/${recordId}`).then(r => r.data),
  reviewRecord: (sourceId: string, recordId: string, action: 'approve' | 'reject', note?: string) =>
    api.post(`/sources/${sourceId}/records/${recordId}/review`, { action, note }).then(r => r.data),
  approve: (id: string) => api.post(`/sources/${id}/approve`).then(r => r.data),
  scrape: (id: string) => api.post(`/sources/${id}/scrape`).then(r => r.data),
  verify: (id: string) => api.post(`/sources/${id}/verify`).then(r => r.data),
  reset: (id: string, clearRecords = true) =>
    api.post(`/sources/${id}/reset`, null, { params: { clear_records: clearRecords } }).then(r => r.data),
  clearRecords: (id: string) =>
    api.delete(`/sources/${id}/records`).then(r => r.data),
  unlockRecords: (id: string) =>
    api.post(`/sources/${id}/unlock`).then(r => r.data),
  dismissFlag: (sourceId: string, recordId: string, flagIndex: number) =>
    api.delete(`/sources/${sourceId}/records/${recordId}/flags/${flagIndex}`).then(r => r.data),
  schema: (id: string) => api.get(`/sources/${id}/schema`).then(r => r.data),
  export: async (id: string, filename: string) => {
    const res = await api.get(`/sources/${id}/export`, { responseType: 'blob' })
    triggerBrowserDownload(res.data, filename)
  },
  performanceStats: (projectId?: string) =>
    api.get('/sources/stats/performance', { params: { project_id: projectId } }).then(r => r.data),
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
