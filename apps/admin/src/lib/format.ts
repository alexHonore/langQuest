/** Small, locale-aware formatting helpers shared by admin screens. */

export function formatBytes(bytes: number | null | undefined, locale = 'en'): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : value < 10 ? 2 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[i]}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** `mm:ss.mmm` for transcript timelines. */
export function formatTimecode(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const frac = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`;
}

export function formatDateTime(value: string | number | Date | null | undefined, locale = 'en'): string {
  if (!value) return '—';
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatUsd(value: number | null | undefined, locale = 'en'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

export function formatPercent(value: number | null | undefined, locale = 'en', fractionDigits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: fractionDigits }).format(value);
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

/** Pick a localized string from a `{ [locale]: text }` JSON column. */
export function pickLocalized(value: unknown, locale: string, fallbacks: readonly string[] = ['en', 'fr']): string {
  if (!value || typeof value !== 'object') return '';
  const map = value as Record<string, unknown>;
  for (const key of [locale, ...fallbacks]) {
    const v = map[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  const first = Object.values(map).find((v) => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? first : '';
}

/** ISO date (YYYY-MM-DD) in UTC for analytics queries. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Random idempotency key (≥ 8 chars, ≤ 128) using the platform RNG. */
export function newIdempotencyKey(prefix = 'adm'): string {
  const rnd = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rnd}`;
}
