import { api } from './client'

export type ReportScope = 'this_month' | 'last_month' | 'latest' | 'all' | 'month' | 'batch'
const p = (scope: string, value?: string, projectId?: string) => ({ scope, value, project_id: projectId })

export const briefsApi = {
  periods: (projectId?: string) => api.get('/briefs/periods', { params: { project_id: projectId } }).then(r => r.data),
  report: (scope: string, value?: string, projectId?: string) => api.get('/briefs/report', { params: p(scope, value, projectId) }).then(r => r.data),
  csv: (scope: string, value: string | undefined, projectId: string | undefined, anon: boolean) =>
    api.get('/briefs/report.csv', { params: { ...p(scope, value, projectId), anon }, responseType: 'text', transformResponse: x => x }).then(r => r.data as string),
  setSubmissions: (scope: string, value: string | undefined, count: number, projectId?: string) => api.post('/briefs/submissions', { scope, value, count, project_id: projectId }).then(r => r.data),
  timelines: (scope: string, value: string | undefined, projectId: string | undefined, anon: boolean) =>
    api.get('/briefs/timelines', { params: { ...p(scope, value, projectId), anon } }).then(r => r.data),
  timelinesXlsx: (scope: string, value: string | undefined, projectId: string | undefined, anon: boolean) =>
    api.get('/briefs/timelines.xlsx', { params: { ...p(scope, value, projectId), anon }, responseType: 'blob' }).then(r => r.data as Blob),
  insights: (scope: string, value: string | undefined, projectId: string | undefined) =>
    api.get('/briefs/insights', { params: p(scope, value, projectId) }).then(r => r.data),
  trace: (scope: string, value: string | undefined, projectId: string | undefined) =>
    api.get('/briefs/trace', { params: p(scope, value, projectId) }).then(r => r.data),
  traceXlsx: (scope: string, value: string | undefined, projectId: string | undefined) =>
    api.get('/briefs/trace.xlsx', { params: p(scope, value, projectId), responseType: 'blob' }).then(r => r.data as Blob),
  addEscalation: (body: Record<string, any>) => api.post('/briefs/escalations', body).then(r => r.data),
  editEscalation: (id: string, body: Record<string, any>) => api.patch(`/briefs/escalations/${id}`, body).then(r => r.data),
  importSlack: (projectId?: string) => api.post('/briefs/escalations/import-slack', { project_id: projectId }).then(r => r.data),
  flagBatch: (body: Record<string, any>) => api.post('/briefs/trace/flag', body).then(r => r.data),
  addWait: (body: Record<string, any>) => api.post('/briefs/waits', body).then(r => r.data),
  editWait: (id: string, body: Record<string, any>) => api.patch(`/briefs/waits/${id}`, body).then(r => r.data),
  deleteWait: (id: string) => api.delete(`/briefs/waits/${id}`).then(r => r.data),
  lead: (projectId?: string) => api.get('/briefs/lead', { params: { project_id: projectId } }).then(r => r.data),
}
