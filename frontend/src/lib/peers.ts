import type { Source } from '@/types'

// Is this person one of the source's peer reviewers (or its original single reviewer)?
export function isPeerOf(s: Source | null | undefined, userId: string | undefined): boolean {
  if (!s || !userId) return false
  return s.assigned_reviewer_id === userId || (s.peer_ids ?? []).includes(userId)
}
