'use client';
import { useI18n } from '@/src/lib/i18n/client';
import { FilterBar, FilterSearch, FilterSelect, UrlPager, useUrlFilters } from '@/src/components/filters';

export function LessonsFilters({ states, page, hasNext }: { states: string[]; page: number; hasNext: boolean }) {
  const { t } = useI18n();
  const { set } = useUrlFilters();
  return (
    <>
      <FilterBar onClear={() => set({ state: null, q: null, chapter: null })}>
        <FilterSearch name="q" label={t('common.search')} />
        <FilterSelect name="state" label={t('admin.library.state')} options={states.map((s) => ({ value: s, label: t(`admin.publish.state.${s}`) }))} />
      </FilterBar>
      <div className="mb-2">
        <UrlPager page={page} hasNext={hasNext} />
      </div>
    </>
  );
}
