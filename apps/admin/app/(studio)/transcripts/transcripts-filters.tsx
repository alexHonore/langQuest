'use client';
import { useI18n } from '@/src/lib/i18n/client';
import { FilterBar, FilterSelect, UrlPager, useUrlFilters } from '@/src/components/filters';

export function TranscriptsFilters({ statuses, page, hasNext }: { statuses: string[]; page: number; hasNext: boolean }) {
  const { t } = useI18n();
  const { set } = useUrlFilters();
  return (
    <>
      <FilterBar onClear={() => set({ status: null })}>
        <FilterSelect name="status" label={t('admin.ui.status')} options={statuses.map((s) => ({ value: s, label: t(`admin.transcripts.status.${s}`) }))} />
      </FilterBar>
      <div className="mb-2">
        <UrlPager page={page} hasNext={hasNext} />
      </div>
    </>
  );
}
