import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listAuditLogs } from '@/src/lib/queries/ops';
import { parsePage } from '@/src/lib/queries';
import { formatDateTime, shortId } from '@/src/lib/format';
import { Notice, PageHeader } from '@/src/components/ui';
import { AuditFilters } from './audit-filters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log' };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSection('auditLog');
  const sp = await searchParams;
  const { t, locale } = await serverTranslator();
  const page = parsePage(sp.page);
  const logs = await listAuditLogs(page, { action: sp.action || undefined, entityTable: sp.table || undefined });
  return (
    <div>
      <PageHeader title={t('admin.audit.title')} />
      <AuditFilters page={page} hasNext={logs.ok ? logs.data.hasNext : false} />
      {!logs.ok ? <Notice tone="warning">{logs.forbidden ? t('admin.ui.auNoAccess') : logs.error}</Notice> : null}
      {logs.ok && logs.data.rows.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">{t('admin.ui.auEmptyHint')}</p> : null}
      {logs.ok && logs.data.rows.length === 0 ? null : (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.audit.when')}</th>
              <th className="px-3 py-2 text-start">{t('admin.audit.actor')}</th>
              <th className="px-3 py-2 text-start">{t('admin.audit.action')}</th>
              <th className="px-3 py-2 text-start">{t('admin.audit.target')}</th>
              <th className="px-3 py-2 text-start">{t('admin.audit.details')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.ok
              ? logs.data.rows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDateTime(row.created_at, locale)}</td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs">{row.actor_id ? shortId(row.actor_id) : '—'}</code>
                      {row.actor_role ? <span className="ms-1 text-xs text-fg-muted">{row.actor_role}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-medium">{row.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.entity_table ?? '—'}
                      {row.entity_id ? `:${row.entity_id.slice(0, 8)}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer text-xs text-accent-text">{t('admin.audit.details')}</summary>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <pre className="max-h-40 overflow-auto rounded bg-surface-muted p-1 text-[11px]">{t('admin.ui.auBefore')}: {JSON.stringify(row.before, null, 1)}</pre>
                          <pre className="max-h-40 overflow-auto rounded bg-surface-muted p-1 text-[11px]">{t('admin.ui.auAfter')}: {JSON.stringify(row.after, null, 1)}</pre>
                        </div>
                        {row.request_id ? <p className="text-[11px] text-fg-muted">{t('admin.ui.auRequest')}: {row.request_id}</p> : null}
                      </details>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
