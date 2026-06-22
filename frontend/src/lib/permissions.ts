// Capability-based permissions, mirroring app/core/permissions.py on the backend.
// Add a new role? Define its capability set here — that's the only file that needs to change.
// Components should check capabilities (useCapability / hasCapability), not role names.

import { useAuthStore } from '@/store/auth'

export type Capability =
  | 'manage_users'
  | 'manage_projects'
  | 'manage_project_members'
  | 'manage_project_resources'
  | 'manage_schemas'
  | 'upload_extraction_jobs'
  | 'submit_work'
  | 'review_submissions'
  | 'review_records'
  | 'view_all_projects'

const ALL_CAPABILITIES: Capability[] = [
  'manage_users', 'manage_projects', 'manage_project_members', 'manage_project_resources',
  'manage_schemas', 'upload_extraction_jobs', 'submit_work', 'review_submissions',
  'review_records', 'view_all_projects',
]

export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  org_admin: ALL_CAPABILITIES,
  project_admin: [
    'manage_project_members', 'manage_project_resources', 'manage_schemas',
    'upload_extraction_jobs', 'review_submissions', 'submit_work',
  ],
  qa_lead: ['review_submissions', 'review_records'],
  pipeline_operator: ['upload_extraction_jobs', 'submit_work'],
  reviewer: ['review_submissions', 'review_records'],
  read_only: [],
}

export function capabilitiesForRoles(roles: string[]): Set<Capability> {
  const caps = new Set<Capability>()
  for (const role of roles) {
    for (const cap of ROLE_CAPABILITIES[role] ?? []) caps.add(cap)
  }
  return caps
}

export function hasCapability(roles: string[], capability: Capability): boolean {
  return capabilitiesForRoles(roles).has(capability)
}

/** Use inside components: const canManageUsers = useCapability('manage_users') */
export function useCapability(capability: Capability): boolean {
  const user = useAuthStore(s => s.user)
  if (!user) return false
  return hasCapability(user.roles, capability)
}

// ─── Project-scoped checks ──────────────────────────────────────────────────
// A user's role on a specific project (via project membership) is a separate
// dimension from their global role — someone can be globally "reviewer" but
// locally "project_admin" on one project. These helpers take the project's
// member list (already returned alongside project detail, see ProjectMember
// type) plus the current user, for screens that need project-scoped checks.

export interface ProjectMemberLite {
  user_id: string
  role: string
}

export function isProjectAdmin(globalRoles: string[], userId: string, members: ProjectMemberLite[]): boolean {
  if (globalRoles.includes('org_admin')) return true
  return members.some(m => m.user_id === userId && m.role === 'project_admin')
}

export function canReviewProject(globalRoles: string[], userId: string, members: ProjectMemberLite[]): boolean {
  if (globalRoles.includes('org_admin') || globalRoles.includes('qa_lead')) return true
  return members.some(m => m.user_id === userId && (m.role === 'project_admin' || m.role === 'reviewer'))
}

// ─── Role display metadata ────────────────────────────────────────────────────
// Use these everywhere in the UI instead of hardcoded strings, so renaming a
// role in future only requires changing it here.

export const ROLE_META: Record<string, { label: string; description: string; color: string }> = {
  org_admin: {
    label: 'Admin',
    description: 'Full access — manages users, projects, schemas, and can download exports.',
    color: 'red',
  },
  project_admin: {
    label: 'Project Admin',
    description: 'Manages one project — assigns extractors and reviewers, sees project stats.',
    color: 'amber',
  },
  qa_lead: {
    label: 'QA Lead',
    description: 'Cross-project review access — can approve or reject records in any project.',
    color: 'blue',
  },
  pipeline_operator: {
    label: 'Extractor',
    description: 'Uploads source files and fixes validation errors on assigned sources.',
    color: 'green',
  },
  reviewer: {
    label: 'Reviewer',
    description: 'Reviews extracted records against the source website on assigned sources.',
    color: 'purple',
  },
  read_only: {
    label: 'Read Only',
    description: 'Can view projects and sources but cannot make any changes.',
    color: 'gray',
  },
}

export function getRoleLabel(role: string): string {
  return ROLE_META[role]?.label ?? role
}
