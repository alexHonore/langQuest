import { describe, expect, it } from 'vitest';
import { dueCalendar, dueCalendarRows, formatDueDay } from './due-calendar';

const NOW = new Date(2026, 9, 19, 10, 30); // Monday 19 October 2026, local time
const iso = (dayOffset: number, hour = 9): string => new Date(2026, 9, 19 + dayOffset, hour).toISOString();
const LABELS = { overdue: 'En retard', today: 'Aujourd’hui' };

describe('dueCalendar', () => {
  it('keeps the full 7-day grid with an overdue bucket first', () => {
    const grid = dueCalendar([iso(-1), iso(0), iso(2), iso(2)], NOW, 7, 'fr', LABELS);
    expect(grid).toHaveLength(8);
    expect(grid[0]).toMatchObject({ date: 'overdue', label: 'En retard', count: 1, overdue: true });
    expect(grid[1]).toMatchObject({ label: 'Aujourd’hui', count: 1 });
    expect(grid[3]?.count).toBe(2);
    expect(grid.slice(4).every((d) => d.count === 0)).toBe(true);
  });

  it('ignores unparsable dates', () => {
    expect(dueCalendar(['garbage'], NOW, 7, 'en', { overdue: 'Overdue', today: 'Today' }).every((d) => d.count === 0)).toBe(true);
  });
});

describe('dueCalendarRows (what the Progress screen renders)', () => {
  it('collapses a quiet week to no rows (never eight identical "nothing due" lines)', () => {
    const { rows, total } = dueCalendarRows([], NOW, { locale: 'fr', labels: LABELS });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('lists only the days that have reviews, overdue first, and counts them', () => {
    const { rows, total } = dueCalendarRows([iso(-3), iso(-1), iso(1), iso(1), iso(5)], NOW, { locale: 'fr', labels: LABELS });
    expect(rows.map((r) => [r.date, r.count])).toEqual([
      ['overdue', 2],
      ['2026-10-20', 2],
      ['2026-10-24', 1],
    ]);
    expect(total).toBe(5);
    expect(rows[0]?.label).toBe('En retard');
  });

  it('drops reviews beyond the window from the rows and the total', () => {
    const { rows, total } = dueCalendarRows([iso(9)], NOW, { locale: 'fr', labels: LABELS });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('localizes the day labels through the i18n labels and Intl in the UI locale (no English in a French UI)', () => {
    const fr = dueCalendarRows([iso(0), iso(1), iso(2)], NOW, { locale: 'fr', labels: LABELS });
    expect(fr.rows[0]?.label).toBe('Aujourd’hui');
    expect(fr.rows[1]?.label).toBe(formatDueDay(new Date(2026, 9, 20), 'fr'));
    expect(fr.rows[1]?.label).toMatch(/mar/i);
    expect(fr.rows[2]?.label).toMatch(/mer/i);
    for (const r of fr.rows) expect(r.label).not.toMatch(/\b(Today|Overdue|Tue|Wed)\b/);
    const en = dueCalendarRows([iso(1)], NOW, { locale: 'en', labels: { overdue: 'Overdue', today: 'Today' } });
    expect(en.rows[0]?.label).toMatch(/Tue/);
  });

  it('falls back to the ISO day when Intl rejects the locale', () => {
    expect(formatDueDay(new Date(2026, 9, 20), 'not a locale')).toBe('2026-10-20');
  });
});
