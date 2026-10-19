import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/audio/transcript-sync';
import { practiceSegmentIds } from './practice-scope';

const seg = (id: string, startMs: number, endMs: number): TranscriptSegment => ({ id, startMs, endMs, text: id, speakerId: null, translation: null } as unknown as TranscriptSegment);
const segments = [seg('s1', 0, 1000), seg('s2', 1000, 2000), seg('s3', 2000, 3000)];

describe('practiceSegmentIds', () => {
  it('sends the saved segments plus the one under the playhead, without duplicates', () => {
    expect(practiceSegmentIds(segments, 1500, new Set(['s3']))).toEqual(['s3', 's2']);
    expect(practiceSegmentIds(segments, 2500, new Set(['s3']))).toEqual(['s3']);
  });
  it('sends nothing when the transcript is not loaded', () => {
    expect(practiceSegmentIds(null, 1500, new Set(['s3']))).toEqual([]);
  });
});
