import { api } from './client'

export type ReportScope = 'this_month' | 'last_month' | 'latest' | 'all' | 'month' | 'batch'
const p = (scope: string, value?: string, projectId?: string) => ({ scope, value, project_id: projectId })

export const briefsApi = {
  periods: (projectId?: string) => api.get('/briefs/periods', { params: { project_id: projectId } }).then(r => r.data),
  report: (scope: string, value?: string, projectId?: string) => api.get('/briefs/report', { params: p(scope, value, projectId) }).then(r => r.data),
  csv: (scope: string, value: string | undefined, projectId: string | undefined, anon: boolean) =>
    api.get('/briefs/report.csv', { params: { ...p(scope, value, projectId), anon }, responseType: 'text', transformResponse: x => x }).then(r => r.data as string),
  setSubmissions: (scope: string, value: string | undefined, count: number, projectId?: string) => api.post('/briefs/submissions', { scope, value, count, project_id: projectId }).then(r => r.data),
  lead: (projectId?: string) => api.get('/briefs/lead', { params: { project_id: projectId } }).then(r => r.data),
}
