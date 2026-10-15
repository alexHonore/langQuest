/**
 * Role model for LangQuest Studio (spec §7.1, §11, CONVENTIONS §2.4).
 *
 * Learners have no `user_roles` row and are refused at the door. Each admin section lists
 * the roles that may open it; `super_admin` opens everything. Writes are additionally
 * enforced by the API (role-checked) and by RLS, so this matrix is the UX gate, not the
 * security boundary.
 */
import { ROLE_VALUES, type Role } from '@langquest/contracts';

export const ADMIN_SECTIONS = [
  'dashboard',
  'uploads',
  'library',
  'collections',
  'chapters',
  'lessons',
  'speakers',
  'languages',
  'transcripts',
  'rights',
  'contentFactory',
  'aiModels',
  'qualityReview',
  'jobQueue',
  'publishing',
  'analytics',
  'users',
  'settings',
  'auditLog',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** URL path for each section (relative to the studio root). */
export const SECTION_PATHS: Readonly<Record<AdminSection, string>> = {
  dashboard: '/',
  uploads: '/uploads',
  library: '/library',
  collections: '/collections',
  chapters: '/chapters',
  lessons: '/lessons',
  speakers: '/speakers',
  languages: '/languages',
  transcripts: '/transcripts',
  rights: '/rights',
  contentFactory: '/content-factory',
  aiModels: '/ai-models',
  qualityReview: '/quality-review',
  jobQueue: '/jobs',
  publishing: '/publishing',
  analytics: '/analytics',
  users: '/users',
  settings: '/settings',
  auditLog: '/audit-log',
};

const EDITOR: readonly Role[] = ['super_admin', 'admin', 'content_editor'];
const EDITOR_OR_REVIEWER: readonly Role[] = ['super_admin', 'admin', 'content_editor', 'language_reviewer'];
const ALL_STAFF: readonly Role[] = [...ROLE_VALUES];
const ADMINS: readonly Role[] = ['super_admin', 'admin'];

/** Which roles may open each section. */
export const SECTION_ACCESS: Readonly<Record<AdminSection, readonly Role[]>> = {
  dashboard: ALL_STAFF,
  uploads: EDITOR,
  library: EDITOR_OR_REVIEWER,
  collections: EDITOR,
  chapters: EDITOR,
  lessons: EDITOR,
  speakers: EDITOR,
  languages: EDITOR_OR_REVIEWER,
  transcripts: EDITOR_OR_REVIEWER,
  rights: EDITOR,
  contentFactory: EDITOR_OR_REVIEWER,
  aiModels: ADMINS,
  qualityReview: EDITOR_OR_REVIEWER,
  jobQueue: EDITOR_OR_REVIEWER,
  publishing: EDITOR,
  analytics: ['super_admin', 'admin', 'support_readonly'],
  users: ['super_admin'],
  settings: ADMINS,
  auditLog: ADMINS,
};

/** Resolve the section a pathname belongs to (longest matching prefix). */
export function sectionForPath(pathname: string): AdminSection | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'dashboard';
  let best: AdminSection | null = null;
  let bestLen = 0;
  for (const section of ADMIN_SECTIONS) {
    const p = SECTION_PATHS[section];
    if (p === '/') continue;
    if ((clean === p || clean.startsWith(`${p}/`)) && p.length > bestLen) {
      best = section;
      bestLen = p.length;
    }
  }
  return best;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_VALUES as readonly string[]).includes(value);
}

/** True when any of `roles` may open `section`. */
export function canAccessSection(roles: readonly Role[], section: AdminSection): boolean {
  if (roles.includes('super_admin')) return true;
  return roles.some((r) => SECTION_ACCESS[section].includes(r));
}

/** Sections visible to a role set, in IA order. */
export function visibleSections(roles: readonly Role[]): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => canAccessSection(roles, s));
}

/** True when the role set may mutate content (uploads, labels, publishing). */
export const canEditContent = (roles: readonly Role[]): boolean => roles.some((r) => EDITOR.includes(r));
/** True when the role set may review language quality. */
export const canReviewLanguage = (roles: readonly Role[]): boolean => roles.some((r) => EDITOR_OR_REVIEWER.includes(r));
export const isAdminRole = (roles: readonly Role[]): boolean => roles.some((r) => ADMINS.includes(r));
export const isSuperAdmin = (roles: readonly Role[]): boolean => roles.includes('super_admin');
