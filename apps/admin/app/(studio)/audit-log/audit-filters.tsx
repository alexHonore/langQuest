'use client';
import { useI18n } from '@/src/lib/i18n/client';
import { FilterBar, FilterSearch, UrlPager, useUrlFilters } from '@/src/components/filters';

export function AuditFilters({ page, hasNext }: { page: number; hasNext: boolean }) {
  const { t } = useI18n();
  const { set } = useUrlFilters();
  return (
    <>
      <FilterBar onClear={() => set({ action: null, table: null })}>
        <FilterSearch name="action" label={t('admin.audit.action')} />
        <FilterSearch name="table" label={t('admin.audit.target')} />
      </FilterBar>
      <div className="mb-2">
        <UrlPager page={page} hasNext={hasNext} />
      </div>
    </>
  );
}
