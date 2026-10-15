import { adminRoute, LocalApiError, throwDb } from '@/src/lib/local-api/handler';
import { RoleGrantSchema, RoleRevokeSchema } from '@/src/lib/local-api/schemas';

/** PUT /api/admin/users/roles — grant a role (RLS: super_admin only). */
export const PUT = adminRoute('users', RoleGrantSchema, async ({ supabase, session, body }) => {
  const { data, error } = await supabase
    .from('user_roles')
    .upsert({ user_id: body.userId, role: body.role, granted_by: session.userId, expires_at: body.expiresAt }, { onConflict: 'user_id,role' })
    .select('id')
    .single();
  if (error) throwDb(error, 'user_roles.grant');
  return { id: data.id };
});

/** DELETE /api/admin/users/roles — revoke a role; never your own super_admin. */
export const DELETE = adminRoute('users', RoleRevokeSchema, async ({ supabase, session, body }) => {
  if (body.userId === session.userId && body.role === 'super_admin') throw new LocalApiError('precondition_failed', 'You cannot revoke your own super_admin role.');
  const { error, count } = await supabase.from('user_roles').delete({ count: 'exact' }).eq('user_id', body.userId).eq('role', body.role);
  if (error) throwDb(error, 'user_roles.revoke');
  return { revoked: count ?? 0 };
});
