'use client';
/**
 * Generic data table with optional row selection, keyboard navigation (arrow keys move the
 * focused row, Space toggles selection), sticky header and cursor/offset pagination controls.
 * Rendering is plain HTML `<table>` for screen readers; large lists use `VirtualList` instead.
 */
import clsx from 'clsx';
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui';
import { useI18n } from '@/src/lib/i18n/client';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  className?: string;
  width?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
  loading?: boolean;
  caption?: string;
  /** Pagination: `hasNext` + `onNext`/`onPrev`; `page` for display. */
  pagination?: { page: number; hasNext: boolean; hasPrev: boolean; onNext: () => void; onPrev: () => void; total?: number | null };
  dense?: boolean;
}

export function DataTable<Row>({ columns, rows, rowKey, selectable, selected, onSelectionChange, onRowClick, empty, loading, caption, pagination, dense }: DataTableProps<Row>) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const allKeys = rows.map(rowKey);
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selected?.has(k));
  const someSelected = selectable && allKeys.some((k) => selected?.has(k));

  const toggle = useCallback(
    (key: string) => {
      if (!onSelectionChange) return;
      const next = new Set(selected ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSelectionChange(next);
    },
    [onSelectionChange, selected],
  );

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const next = new Set(selected ?? []);
    if (allSelected) for (const k of allKeys) next.delete(k);
    else for (const k of allKeys) next.add(k);
    onSelectionChange(next);
  };

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, index: number, row: Row) => {
    const trs = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[tabindex]');
    if (!trs) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      trs[Math.min(index + 1, trs.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      trs[Math.max(index - 1, 0)]?.focus();
    } else if (e.key === ' ' && selectable) {
      e.preventDefault();
      toggle(rowKey(row));
    } else if (e.key === 'Enter' && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              {selectable ? (
                <th scope="col" className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('admin.ui.selectAllRows')}
                    checked={Boolean(allSelected)}
                    ref={(el) => {
                      if (el) el.indeterminate = Boolean(someSelected && !allSelected);
                    }}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-accent"
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined} className={clsx('px-3 py-2 text-start font-medium', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-8 text-center text-fg-muted">
                  {loading ? t('admin.ui.loading') : (empty ?? t('admin.ui.empty'))}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const key = rowKey(row);
                const isSelected = selected?.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    tabIndex={0}
                    aria-selected={selectable ? isSelected : undefined}
                    onKeyDown={(e) => onKey(e, index, row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={clsx('border-t border-border focus:outline-none focus-visible:bg-accent-soft', isSelected && 'bg-accent-soft/60', onRowClick && 'cursor-pointer hover:bg-surface-muted')}
                  >
                    {selectable ? (
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={t('admin.ui.selectRow')} checked={isSelected} onChange={() => toggle(key)} className="h-4 w-4 accent-accent" />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td key={c.key} className={clsx('px-3 align-top', dense ? 'py-1' : 'py-2', c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-fg-muted">
          <span>
            {t('admin.ui.page', { page: pagination.page })}
            {pagination.total != null ? ` · ${pagination.total}` : ''}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={!pagination.hasPrev} onClick={pagination.onPrev} icon={<ChevronLeft size={14} className="rtl:rotate-180" />}>
              {t('admin.ui.previous')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!pagination.hasNext} onClick={pagination.onNext}>
              {t('admin.ui.nextPage')}
              <ChevronRight size={14} className="rtl:rotate-180" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Floating bar shown while rows are selected. */
export function BulkActionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (count === 0) return null;
  return (
    <div role="toolbar" aria-label={t('admin.ui.actions')} className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-elevated px-3 py-2 shadow-lg">
      <span className="text-sm font-medium">{t('admin.ui.rowsSelected', { count })}</span>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t('admin.ui.clearSelection')}
      </Button>
      <span className="mx-1 h-5 w-px bg-border" />
      {children}
    </div>
  );
}
