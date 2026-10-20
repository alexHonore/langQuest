'use client';
import { useMemo, useState } from 'react';
import { ROLE_VALUES, type Role } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, shortId } from '@/src/lib/format';
import { Button, Field, Input, Notice, Select } from '@/src/components/ui';
import { RoleBadge } from '@/src/components/badges';

interface RoleRow {
  id: string;
  user_id: string;
  role: string;
  granted_by: string | null;
  expires_at: string | null;
  created_at: string;
}

export function UsersScreen({ rows, currentUserId }: { rows: RoleRow[]; currentUserId: string }) {
  const { t, locale } = useI18n();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<Role>('content_editor');
  const [expiresAt, setExpiresAt] = useState('');
  const grant = useAction(async () => browserApi().call('adminUserRoleGrant', { params: { userId }, body: { role, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null } }), { successMessage: t('admin.users.roleGranted') });
  const revoke = useAction(async (uid: string, r: string) => browserApi().call('adminUserRoleRevoke', { params: { userId: uid, role: r } }), { successMessage: t('admin.ui.saved') });
  const byUser = useMemo(() => {
    const map = new Map<string, RoleRow[]>();
    for (const r of rows) map.set(r.user_id, [...(map.get(r.user_id) ?? []), r]);
    return [...map.entries()];
  }, [rows]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Field label={t('admin.ui.usUserId')} className="min-w-80">
          {(id) => <Input id={id} value={userId} onChange={(e) => setUserId(e.target.value.trim())} placeholder="00000000-0000-0000-0000-000000000000" />}
        </Field>
        <Field label={t('admin.ui.roles')}>
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.usExpires')}>{(id) => <Input id={id} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}</Field>
        <Button variant="primary" disabled={userId.length !== 36} loading={grant.busy} onClick={() => void grant.run()}>
          {t('admin.users.grantRole')}
        </Button>
      </div>
      {grant.error ? <Notice tone="error">{grant.error}</Notice> : null}
      {byUser.length === 0 ? <Notice tone="info">{t('admin.ui.usNoRoles')}</Notice> : null}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.ui.usEmail')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.roles')}</th>
            </tr>
          </thead>
          <tbody>
            {byUser.map(([uid, list]) => (
              <tr key={uid} className="border-t border-border">
                <td className="px-3 py-2 align-top">
                  <code className="font-mono text-xs">{uid}</code>
                  {uid === currentUserId ? <span className="ms-1 text-xs text-fg-muted">(you)</span> : null}
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-1">
                    {list.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <RoleBadge role={r.role} />
                        <span className="text-fg-muted">
                          {t('admin.ui.usGrantedBy')} {r.granted_by ? shortId(r.granted_by) : '—'} · {formatDateTime(r.created_at, locale)}
                          {r.expires_at ? ` · ${t('admin.ui.usExpires')} ${formatDateTime(r.expires_at, locale)}` : ''}
                        </span>
                        <Button size="sm" variant="ghost" disabled={uid === currentUserId && r.role === 'super_admin'} title={uid === currentUserId && r.role === 'super_admin' ? t('admin.ui.usSelfRevoke') : undefined} loading={revoke.busy} onClick={() => window.confirm(t('admin.ui.confirmTitle')) && void revoke.run(uid, r.role)}>
                          {t('admin.users.revokeRole')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
