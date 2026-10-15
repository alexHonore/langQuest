/** Group review due dates into a 7-day calendar (overdue bucket first). Pure. */
export interface DueDay {
  date: string;
  label: string;
  count: number;
  overdue: boolean;
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dueCalendar(dueIso: readonly string[], now: Date, days = 7, locale?: string): DueDay[] {
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
  const out: DueDay[] = [{ date: 'overdue', label: 'Overdue', count: overdue, overdue: true }];
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = dayKey(d);
    out.push({ date: key, label: i === 0 ? 'Today' : fmt.format(d), count: buckets.get(key) ?? 0, overdue: false });
  }
  return out;
}
