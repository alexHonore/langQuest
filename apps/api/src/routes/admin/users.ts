/**
 * Staff role grant / revoke (§7.1 Users / roles, R-4.3-01). Formerly a local Next route handler writing `user_roles`
 * under the super_admin RLS policy; the Worker now requires a server-verified `super_admin` role (resolved from
 * `user_roles` by the auth middleware, never from the token payload), writes with the service client and audit-logs.
 * Nobody can revoke their own `super_admin`, so at least one super admin always remains.
 */
import { RoleSchema, UserRoleGrantRequestSchema, UserRoleGrantResponseSchema, UserRoleRevokeResponseSchema, UuidSchema } from '@langquest/contracts';
import { DbError, unwrapMaybe } from '@langquest/db/errors';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import type { RequestServices } from '../../services/context';
import type { Principal } from '../../types';

const GrantParams = z.object({ userId: UuidSchema });
const RevokeParams = z.object({ userId: UuidSchema, role: RoleSchema });

/** The route gate is the `admin` set; only `super_admin` may change roles (checked before any parsing or query). */
function requireSuperAdmin(s: RequestServices): Principal {
  const { principal } = s.requireUser();
  if (!principal.roles.includes('super_admin')) throw problem.forbidden('Only a super admin may grant or revoke staff roles');
  return principal;
}

export function registerUserRoutes(define: DefineRoute): void {
  define('adminUserRoleGrant', { role: 'admin' }, async (c) => {
    const s = c.get('services')!;
    const principal = requireSuperAdmin(s);
    const { userId } = parseParams(c, GrantParams);
    const body = await parseBody(c, UserRoleGrantRequestSchema);
    const before = unwrapMaybe(await s.service.from('user_roles').select('id, expires_at, granted_by').eq('user_id', userId).eq('role', body.role).maybeSingle(), 'user_roles.get');
    const res = await s.service.from('user_roles').upsert({ user_id: userId, role: body.role, granted_by: principal.userId, expires_at: body.expiresAt }, { onConflict: 'user_id,role' }).select('id, user_id, role, expires_at').single();
    if (res.error) {
      if (res.error.code === '23503') throw problem.validation('No Supabase Auth user has this id. Copy the user id from Supabase Auth.');
      throw new DbError(res.error, 'user_roles.grant');
    }
    s.audit({ action: 'users.role_grant', entityTable: 'user_roles', entityId: res.data.id, before: before ? { expiresAt: before.expires_at, grantedBy: before.granted_by } : null, after: { userId, role: body.role, expiresAt: body.expiresAt } });
    return respondOk(c, UserRoleGrantResponseSchema.parse({ id: res.data.id, userId: res.data.user_id, role: res.data.role, expiresAt: res.data.expires_at }), before ? 200 : 201);
  });

  define('adminUserRoleRevoke', { role: 'admin' }, async (c) => {
    const s = c.get('services')!;
    const principal = requireSuperAdmin(s);
    const { userId, role } = parseParams(c, RevokeParams);
    if (userId === principal.userId && role === 'super_admin') throw problem.precondition('You cannot revoke your own super_admin role.');
    const res = await s.service.from('user_roles').delete({ count: 'exact' }).eq('user_id', userId).eq('role', role);
    if (res.error) throw new DbError(res.error, 'user_roles.revoke');
    const revoked = res.count ?? 0;
    s.audit({ action: 'users.role_revoke', entityTable: 'user_roles', entityId: null, before: { userId, role }, after: { revoked } });
    return respondOk(c, UserRoleRevokeResponseSchema.parse({ userId, role, revoked }));
  });
}
