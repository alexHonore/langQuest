'use client';
/**
 * Fixed-row-height windowed list: renders only the rows inside the scroll viewport (plus an
 * overscan), so queues with thousands of uploads stay fluid. No external dependency.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  height: number;
  render: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => string;
  overscan?: number;
  role?: string;
  ariaLabel?: string;
}

export function VirtualList<T>({ items, rowHeight, height, render, itemKey, overscan = 6, role = 'list', ariaLabel }: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const onScroll = useCallback(() => {
    if (ref.current) setScrollTop(ref.current.scrollTop);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const slice = items.slice(start, end);

  return (
    <div ref={ref} role={role} aria-label={ariaLabel} style={{ height, overflowY: 'auto', position: 'relative' }} className="rounded-lg border border-border bg-surface">
      <div style={{ height: total, position: 'relative' }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div key={itemKey(item, index)} role={role === 'list' ? 'listitem' : undefined} style={{ position: 'absolute', top: index * rowHeight, height: rowHeight, left: 0, right: 0 }}>
              {render(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
