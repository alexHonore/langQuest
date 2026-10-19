import { describe, expect, it } from 'vitest';
import { timelineHasValues } from './analytics';

describe('timelineHasValues', () => {
  it('is false for an empty series and for all-null series (metric not computed)', () => {
    expect(timelineHasValues([])).toBe(false);
    expect(timelineHasValues([{ period: '2026-10-01', value: null }, { period: '2026-10-02', value: null, value2: null }])).toBe(false);
  });

  it('is true when any point of either series carries a number, including 0', () => {
    expect(timelineHasValues([{ period: 'a', value: null }, { period: 'b', value: 0 }])).toBe(true);
    expect(timelineHasValues([{ period: 'a', value: null, value2: 0.4 }])).toBe(true);
  });
});
