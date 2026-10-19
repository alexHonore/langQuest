'use client';
import Link from 'next/link';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, pickLocalized, shortId } from '@/src/lib/format';
import { Button, Card, Notice } from '@/src/components/ui';
import { Badge, StatusBadge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { FilterBar, FilterSelect, UrlPager, useUrlFilters } from '@/src/components/filters';
import { PublishControls } from '@/src/components/publish-controls';
import { SECTION_PATHS } from '@/src/lib/auth/roles';

export interface PublishableRow {
  id: string;
  title_translations: unknown;
  state: string;
  published_revision?: number | null;
  published_version?: number | null;
  content_rights_id: string | null;
  updated_at: string;
  target_variety_id?: string | null;
  course_track_id?: string | null;
  instruction_language_code: string | null;
}
export interface RevisionRow {
  id: string;
  revision: number;
  diff: unknown;
  snapshot: unknown;
  editor_id: string;
  note: string | null;
  created_at: string;
}
export interface EventRow {
  id: string;
  entity_table?: string;
  entity_id?: string;
  revision: number;
  from_state: string | null;
  to_state: string;
  actor_id: string;
  reason: string | null;
  rollback_of_event_id?: string | null;
  created_at: string;
}

export function PublishingScreen({ table, rows, page, hasNext, selectedId, revisions, entityEvents, recentEvents }: { table: 'audio_lessons' | 'audio_course_collections'; rows: PublishableRow[]; page: number; hasNext: boolean; selectedId: string | null; revisions: RevisionRow[]; entityEvents: EventRow[]; recentEvents: EventRow[] }) {
  const { t, locale } = useI18n();
  const { set } = useUrlFilters();
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const rollback = useAction(async (revision: number) => localCall<{ revision: number }>('/api/admin/publishing/rollback', { method: 'POST', body: { entityTable: table, entityId: selectedId, revision } }), { successMessage: (r) => t('admin.ui.pbRolledBack', { revision: r.revision }) });
  const currentRevision = selected ? (revisions[0]?.revision ?? selected.published_revision ?? selected.published_version ?? 0) : 0;

  const columns: Column<PublishableRow>[] = [
    { key: 'title', header: t('admin.ui.title'), render: (r) => <button type="button" className="font-medium text-accent hover:underline" onClick={() => set({ id: r.id }, { keepPage: true })}>{pickLocalized(r.title_translations, locale) || shortId(r.id)}</button> },
    { key: 'lang', header: t('admin.ui.targetVariety'), render: (r) => <span className="text-xs">{r.target_variety_id ?? r.course_track_id ?? '—'} / {r.instruction_language_code ?? '—'}</span> },
    { key: 'state', header: t('admin.ui.status'), render: (r) => <StatusBadge state={r.state} /> },
    { key: 'rev', header: t('admin.ui.pbRevisions'), render: (r) => (r.published_revision ?? r.published_version ?? '—') },
    { key: 'rights', header: t('admin.library.rightsState'), render: (r) => (r.content_rights_id ? <Link href={`/rights?id=${r.content_rights_id}`} className="text-xs text-accent hover:underline">{shortId(r.content_rights_id)}</Link> : <Badge tone="warning">{t('admin.ui.none')}</Badge>) },
    { key: 'updated', header: t('admin.ui.updated'), className: 'text-fg-muted whitespace-nowrap', render: (r) => formatDateTime(r.updated_at, locale) },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
      <div>
        <FilterBar>
          <FilterSelect name="table" label={t('admin.ui.pbFilterTable')} options={[{ value: 'audio_lessons', label: t('admin.sections.lessons') }, { value: 'audio_course_collections', label: t('admin.sections.collections') }]} allLabel={t('admin.sections.lessons')} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          caption={t('admin.ui.pbEntities')}
          empty={t('admin.ui.pbEmptyHint')}
          emptyAction={
            <Link href={SECTION_PATHS.library} className="text-sm text-accent hover:underline">
              {t('admin.sections.library')} →
            </Link>
          }
          dense
        />
        <UrlPager page={page} hasNext={hasNext} />
      </div>
      <div className="space-y-4">
        {selected ? (
          <>
            <Card title={`${pickLocalized(selected.title_translations, locale) || shortId(selected.id)}`}>
              <PublishControls entityTable={table} entityId={selected.id} state={selected.state} revision={currentRevision} canDecide />
            </Card>
            <Card title={t('admin.ui.pbRevisions')}>
              {revisions.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
              <ul className="space-y-1 text-xs">
                {revisions.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <Badge tone={r.revision === currentRevision ? 'accent' : 'neutral'}>v{r.revision}</Badge>
                    <span className="flex-1 truncate" title={r.note ?? ''}>
                      {r.note ?? '—'}
                    </span>
                    <span className="text-fg-muted">{formatDateTime(r.created_at, locale)}</span>
                    {r.snapshot && r.revision !== currentRevision ? (
                      <Button size="sm" variant="ghost" loading={rollback.busy} title={t('admin.ui.pbRollbackHint')} onClick={() => void rollback.run(r.revision)}>
                        {t('admin.ui.pbRollback')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {rollback.error ? <Notice tone="error">{rollback.error}</Notice> : null}
            </Card>
            <Card title={t('admin.ui.pbEvents')}>
              {entityEvents.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
              <ul className="space-y-1 text-xs">
                {entityEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2">
                    <span>{e.from_state ?? '∅'} → </span>
                    <StatusBadge state={e.to_state} />
                    <span className="text-fg-muted">v{e.revision} · {e.reason ?? ''} · {formatDateTime(e.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : (
          <Notice tone="info">{t('admin.ui.cfSelectDraft')}</Notice>
        )}
        <Card title={t('admin.ui.pbEvents')}>
          {recentEvents.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
          <ul className="space-y-1 text-xs">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{e.entity_table}:{shortId(e.entity_id)}</span>
                <StatusBadge state={e.to_state} />
                <span className="text-fg-muted">{formatDateTime(e.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
