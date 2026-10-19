/**
 * Small pure helpers for the analytics screen (§12.2). Charts must never imply a value the API
 * did not compute: a series made only of nulls is "not computed", not "0%".
 */

export interface TimelinePoint {
  period: string;
  value: number | null;
  value2?: number | null;
}

/** True when at least one point carries a real number (either series). */
export function timelineHasValues(data: readonly TimelinePoint[]): boolean {
  return data.some((p) => typeof p.value === 'number' || typeof p.value2 === 'number');
}
