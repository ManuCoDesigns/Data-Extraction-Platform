import { api } from './client'

export const versionsApi = {
  list: (sourceId: string) => api.get(`/versions/${sourceId}`).then(r => r.data),
  compare: (sourceId: string, roundId: string) => api.get(`/versions/${sourceId}/${roundId}/compare`).then(r => r.data),
  download: (sourceId: string, roundId: string) => api.get(`/versions/${sourceId}/${roundId}/download`, { responseType: 'text', transformResponse: x => x }).then(r => r.data as string),
  restore: (sourceId: string, roundId: string, reason?: string) => api.post(`/versions/${sourceId}/${roundId}/restore`, { reason }).then(r => r.data),
}
