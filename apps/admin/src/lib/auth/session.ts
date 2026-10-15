import 'server-only';
import { redirect } from 'next/navigation';
import type { Role } from '@langquest/contracts';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { canAccessSection, isRole, type AdminSection } from './roles';

export interface StaffSession {
  userId: string;
  email: string | null;
  roles: Role[];
  accessToken: string;
}

/**
 * Current signed-in staff member, verified server-side (`auth.getUser()` contacts Supabase;
 * we never trust the cookie payload alone) together with the active, unexpired roles.
 * Returns null for anonymous users and for learners without a role row.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const supabase = await createSupabaseServerClient();
  const [{ data: userData }, { data: sessionData }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
  const user = userData.user;
  const accessToken = sessionData.session?.access_token;
  if (!user || !accessToken) return null;
  const { data: roleRows } = await supabase.from('user_roles').select('role, expires_at').eq('user_id', user.id);
  const now = Date.now();
  const roles = (roleRows ?? [])
    .filter((r) => !r.expires_at || Date.parse(r.expires_at) > now)
    .map((r) => r.role)
    .filter(isRole);
  if (roles.length === 0) return null;
  return { userId: user.id, email: user.email ?? null, roles, accessToken };
}

/** Redirects to /login when not a staff member. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/login?reason=signin');
  return session;
}

/** Redirects to the dashboard with a reason when the role set may not open `section`. */
export async function requireSection(section: AdminSection): Promise<StaffSession> {
  const session = await requireStaff();
  if (!canAccessSection(session.roles, section)) redirect(`/?denied=${section}`);
  return session;
}
