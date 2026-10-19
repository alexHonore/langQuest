import { describe, expect, it } from 'vitest';
import { sessionScopeFromParams } from './scope';

describe('sessionScopeFromParams', () => {
  it('builds an audio_lesson scope with the picked transcript segments', () => {
    expect(sessionScopeFromParams({ audioLessonId: 'L1', transcriptSegmentIds: 'a, b,,a' })).toEqual({ kind: 'audio_lesson', audioLessonId: 'L1', transcriptSegmentIds: ['a', 'b'] });
    expect(sessionScopeFromParams({ audioLessonId: 'L1' })).toEqual({ kind: 'audio_lesson', audioLessonId: 'L1' });
  });
  it('keeps a lesson scope even when a mission is linked, and a mission scope otherwise', () => {
    expect(sessionScopeFromParams({ audioLessonId: 'L1', missionId: 'M1' })?.kind).toBe('audio_lesson');
    expect(sessionScopeFromParams({ missionId: 'M1' })).toEqual({ kind: 'mission', missionId: 'M1' });
    expect(sessionScopeFromParams({})).toBeUndefined();
  });
  it('caps the segment list at 200', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`).join(',');
    expect(sessionScopeFromParams({ audioLessonId: 'L1', transcriptSegmentIds: ids })).toMatchObject({ transcriptSegmentIds: expect.arrayContaining(['s0']) });
    expect((sessionScopeFromParams({ audioLessonId: 'L1', transcriptSegmentIds: ids }) as { transcriptSegmentIds: string[] }).transcriptSegmentIds).toHaveLength(200);
  });
});
