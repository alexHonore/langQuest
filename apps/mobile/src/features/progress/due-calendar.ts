/**
 * Group review due dates into a 7-day calendar (overdue bucket first). Pure.
 *
 * `dueCalendar` keeps every day (the full grid, used by tests and by anything that wants the
 * zeros); `dueCalendarRows` is what the Progress screen renders: only the days that actually have
 * reviews, so a quiet week never shows seven identical "nothing due" rows (CONVENTIONS §8). Day
 * labels are localized: the overdue / today words come from the i18n catalogs (`labels`), the
 * other days from `Intl.DateTimeFormat` in the UI locale (a French UI never shows "Tue").
 */
export interface DueDay {
  date: string;
  label: string;
  count: number;
  overdue: boolean;
}

export interface DueCalendarLabels {
  /** `progress.review.overdue` */
  overdue: string;
  /** `progress.review.today` */
  today: string;
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Weekday + day number in the UI locale (`mar. 20`, `Tue 20`); falls back to the ISO day key when `Intl` rejects the locale. */
export function formatDueDay(date: Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).format(date);
  } catch {
    return dayKey(date);
  }
}

export function dueCalendar(dueIso: readonly string[], now: Date, days = 7, locale?: string, labels?: Partial<DueCalendarLabels>): DueDay[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets = new Map<string, number>();
  let overdue = 0;
  for (const iso of dueIso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    if (d < today) {
      overdue += 1;
      continue;
    }
    const key = dayKey(d);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const out: DueDay[] = [{ date: 'overdue', label: labels?.overdue ?? 'Overdue', count: overdue, overdue: true }];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = dayKey(d);
    out.push({ date: key, label: i === 0 ? (labels?.today ?? 'Today') : formatDueDay(d, locale), count: buckets.get(key) ?? 0, overdue: false });
  }
  return out;
}

export interface DueCalendarRows {
  /** Only the buckets with at least one review (overdue first, then the days in order). */
  rows: DueDay[];
  /** Reviews due within the window (overdue included). */
  total: number;
}

/** The calendar as the screen shows it: days with reviews only; `rows` is empty for a quiet week. */
export function dueCalendarRows(dueIso: readonly string[], now: Date, options: { days?: number; locale?: string; labels: DueCalendarLabels }): DueCalendarRows {
  const rows = dueCalendar(dueIso, now, options.days ?? 7, options.locale, options.labels).filter((d) => d.count > 0);
  return { rows, total: rows.reduce((n, d) => n + d.count, 0) };
}
