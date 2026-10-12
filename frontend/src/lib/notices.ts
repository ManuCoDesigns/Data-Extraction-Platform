import { AlertTriangle, Bell, CheckCircle2, ClipboardCheck, Eye, MessageSquare, Undo2, UserPlus, Zap } from 'lucide-react'
import type { Notification } from '@/types'

// How each kind of notice looks: a short label and an icon. Unknown kinds fall back to a bell.
const KINDS: Record<string, { label: string; Icon: typeof Bell }> = {
  assigned: { label: 'New assignment', Icon: UserPlus },
  sent_back: { label: 'Sent back', Icon: Undo2 },
  ready_for_review: { label: 'Needs your review', Icon: Eye },
  peer_requested: { label: 'Peer review requested', Icon: ClipboardCheck },
  peer_comment: { label: 'Peer review comment', Icon: MessageSquare },
  ready_for_signoff: { label: 'Ready for sign-off', Icon: ClipboardCheck },
  approved: { label: 'Approved', Icon: CheckCircle2 },
  xtrium_rework: { label: 'Xtrium rework', Icon: Zap },
  xtrium_rejected: { label: 'Xtrium rejected', Icon: AlertTriangle },
  submission: { label: 'Submission', Icon: CheckCircle2 },
}

export function noticeMeta(n: Pick<Notification, 'kind'>) {
  return (n.kind && KINDS[n.kind]) || { label: 'Update', Icon: Bell }
}

export const isAction = (n: Pick<Notification, 'priority'>) => n.priority === 'action'

// Things that need the person to act come first, then newest first.
export function byImportance(a: Notification, b: Notification) {
  if (isAction(a) !== isAction(b)) return isAction(a) ? -1 : 1
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}
