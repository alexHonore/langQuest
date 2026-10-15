'use client';
/**
 * URL-driven filter bar: each control writes to the query string so server components re-render
 * with the new filters (shareable links, back button works). `page` resets on any change.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { useI18n } from '@/src/lib/i18n/client';
import { Button, Input, Select } from './ui';

export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>, options: { keepPage?: boolean } = {}) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (!options.keepPage) next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );
  return { params, set, get: (k: string) => params.get(k) ?? '' };
}

export function FilterBar({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="search" className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      {children}
      {onClear ? (
        <Button size="sm" variant="ghost" onClick={onClear}>
          {t('common.clearFilters')}
        </Button>
      ) : null}
    </div>
  );
}

export function FilterSelect({ name, label, options, allLabel }: { name: string; label: string; options: Array<{ value: string; label: string }>; allLabel?: string }) {
  const { get, set } = useUrlFilters();
  const { t } = useI18n();
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-fg-muted">{label}</span>
      <Select className="w-auto py-1 text-xs" value={get(name)} onChange={(e) => set({ [name]: e.target.value })}>
        <option value="">{allLabel ?? t('admin.ui.all')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function FilterSearch({ name, label }: { name: string; label: string }) {
  const { get, set } = useUrlFilters();
  return (
    <form
      className="flex flex-col gap-0.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        set({ [name]: String(data.get(name) ?? '') });
      }}
    >
      <span className="text-fg-muted">{label}</span>
      <Input name={name} defaultValue={get(name)} className="w-56 py-1 text-xs" type="search" />
    </form>
  );
}

/** Offset pagination driven by `?page=`. */
export function UrlPager({ page, hasNext }: { page: number; hasNext: boolean }) {
  const { set } = useUrlFilters();
  const { t } = useI18n();
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
      <span>{t('admin.ui.page', { page })}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => set({ page: page - 1 }, { keepPage: true })}>
          {t('admin.ui.previous')}
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasNext} onClick={() => set({ page: page + 1 }, { keepPage: true })}>
          {t('admin.ui.nextPage')}
        </Button>
      </div>
    </div>
  );
}
