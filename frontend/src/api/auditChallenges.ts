import { api } from './client'

export interface Challenge {
  id: string; source_id: string; record_id: string | null; record: string; field: string
  status: 'waiting' | 'agreed' | 'disputed' | 'settled'
  extracted_value: unknown; current_value: unknown
  admin_verdict: 'correct' | 'incorrect'; admin_truth: string | null; admin_note: string | null
  sent_at: string; sent_by: string; sent_note: string | null
  stance: 'agree' | 'disagree' | null; finding: string | null; evidence_url: string | null; sop_ref: string | null; responded_at: string | null; responded_by: string
  ruling: 'upheld' | 'overturned' | null; ruling_note: string | null; ruled_at: string | null; ruled_by: string
  sop_hint: { sop_code?: string; required?: boolean; type?: string; allowed?: unknown; format?: string; rule?: string; section?: string; quote?: string } | null
  source?: string; extractor?: string
}
export interface Counts { waiting: number; agreed: number; disputed: number; settled: number }

export const challengeApi = {
  send: (body: { source_ids?: string[]; project_id?: string; include_correct?: boolean; note?: string }) =>
    api.post('/quality/audit-challenges/send', body).then(r => r.data as { created: number; already_sent: number; no_extractor: number; sources: number; checked: number }),
  forSource: (sourceId: string) => api.get(`/quality/audit-challenges/source/${sourceId}`).then(r => r.data as { items: Challenge[]; counts: Counts; can_respond: boolean; can_rule: boolean }),
  overview: (o: { projectId?: string; sourceId?: string }) => api.get('/quality/audit-challenges', { params: { project_id: o.projectId || undefined, source_id: o.sourceId || undefined } }).then(r => r.data as { items: Challenge[]; counts: Counts; total: number }),
  respond: (id: string, body: { stance: 'agree' | 'disagree'; finding?: string; evidence_url?: string; sop_ref?: string }) => api.post(`/quality/audit-challenges/${id}/respond`, body).then(r => r.data),
  rule: (id: string, body: { ruling: 'upheld' | 'overturned'; note?: string }) => api.post(`/quality/audit-challenges/${id}/rule`, body).then(r => r.data),
  withdraw: (id: string) => api.delete(`/quality/audit-challenges/${id}`).then(r => r.data),
}
