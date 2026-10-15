import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, activeWindowIndex, karaokeWindows, loopBoundsFor, loopBoundsForRange, nearestSegmentIndex, type TranscriptSegment } from './transcript-sync';

const seg = (index: number, startMs: number, endMs: number, text: string, words: TranscriptSegment['words'] = []): TranscriptSegment => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  index,
  startMs,
  endMs,
  text,
  transliteration: null,
  speakerLabel: null,
  languageCode: 'ary',
  confidence: null,
  translation: null,
  words,
  linkedExpressionIds: [],
});

const segments = [seg(0, 0, 2_000, 'salam, labas?'), seg(1, 2_500, 5_000, 'labas, hamdullah'), seg(2, 6_000, 9_000, 'w nta?')];

describe('transcript sync', () => {
  it('finds the active and nearest segment', () => {
    expect(activeSegmentIndex(segments, 1_000)).toBe(0);
    expect(activeSegmentIndex(segments, 2_200)).toBe(-1);
    expect(nearestSegmentIndex(segments, 2_200)).toBe(0);
    expect(nearestSegmentIndex(segments, 7_000)).toBe(2);
    expect(nearestSegmentIndex([], 10)).toBe(-1);
  });

  it('uses word alignment when present and proportional windows otherwise', () => {
    const aligned = seg(0, 0, 2_000, 'salam labas', [
      { word: 'salam', startMs: 0, endMs: 800, expressionId: null },
      { word: 'labas', startMs: 900, endMs: 2_000, expressionId: null },
    ]);
    const w = karaokeWindows(aligned);
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({ startMs: 900, charStart: 6, charEnd: 11, text: 'labas' });
    const prop = karaokeWindows(seg(0, 0, 1_000, 'ab cdef'));
    expect(prop.map((x) => x.text)).toEqual(['ab', 'cdef']);
    expect(prop[1]!.endMs).toBe(1_000);
    expect(activeWindowIndex(prop, 100)).toBe(0);
    expect(activeWindowIndex(prop, 900)).toBe(1);
  });

  it('builds A/B loop bounds clamped to neighbours and duration', () => {
    expect(loopBoundsFor(segments, 1, { durationMs: 9_000 })).toEqual({ startMs: 2_350, endMs: 5_150 });
    expect(loopBoundsFor(segments, 2, { durationMs: 9_050 })).toEqual({ startMs: 5_850, endMs: 9_050 });
    expect(loopBoundsForRange(segments, 2, 0)).toEqual({ startMs: 0, endMs: 9_150 });
    expect(loopBoundsFor(segments, 9)).toBeNull();
  });
});
