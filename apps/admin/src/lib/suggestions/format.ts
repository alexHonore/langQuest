/**
 * Presentation helpers for the §7.4 asset-suggestion review queue. A suggestion's `suggestion`
 * payload is a free-form object whose shape depends on `kind`; reviewers see every proposed field
 * next to the current value, exactly as produced (no normalisation that could hide a change).
 * Confidence is shown as the model reported it, or as "not reported" when null: never a score.
 */
import type { JsonValue } from '@langquest/contracts';

export interface ProposedField {
  key: string;
  value: string;
}

/** Stable, readable rendering of a JSON value (arrays joined, objects as compact JSON). */
export function renderJsonValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.map((v) => renderJsonValue(v)).join(', ');
  return JSON.stringify(value);
}

/** Flatten the proposal into (field, rendered value) rows, sorted by key for a stable diff. */
export function proposedFields(suggestion: Record<string, JsonValue>): ProposedField[] {
  return Object.keys(suggestion)
    .sort()
    .map((key) => ({ key, value: renderJsonValue(suggestion[key]) }));
}

/**
 * Current value of the field(s) a suggestion targets, keyed like the proposal when the server
 * returned an object; a scalar current value is shown under the single proposed key.
 */
export function currentFields(currentValue: JsonValue | null, proposal: Record<string, JsonValue>): Record<string, string> {
  const out: Record<string, string> = {};
  if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    for (const [k, v] of Object.entries(currentValue)) out[k] = renderJsonValue(v);
    return out;
  }
  const keys = Object.keys(proposal);
  if (keys.length === 1) out[keys[0]!] = renderJsonValue(currentValue);
  return out;
}

/** True when the proposal changes something (string-level comparison of the rendered values). */
export function proposalChanges(suggestion: Record<string, JsonValue>, currentValue: JsonValue | null): boolean {
  const current = currentFields(currentValue, suggestion);
  return proposedFields(suggestion).some((f) => current[f.key] !== f.value);
}

/** Parse an edited proposal; only a JSON object is a valid override (null = unparsable / not an object). */
export function parseOverride(text: string): Record<string, JsonValue> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, JsonValue>;
  } catch {
    return null;
  }
}

/** Percent string for a reported confidence, or null when the model reported none. */
export function formatConfidence(confidence: number | null, locale = 'en'): string | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(confidence);
}
