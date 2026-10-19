/**
 * Transcript segments handed to "Practice this with AI": the ones the learner saved (bookmarked) plus the
 * segment under the playhead, de-duplicated and capped at the contract's 200. Nothing is guessed when the
 * transcript is not loaded (the conversation is then scoped to the whole lesson).
 */
import { nearestSegmentIndex, type TranscriptSegment } from '@/audio/transcript-sync';
import { MAX_SCOPE_SEGMENT_IDS } from '@/features/conversation/scope';

export function practiceSegmentIds(segments: readonly TranscriptSegment[] | null, positionMs: number, saved: ReadonlySet<string>): string[] {
  const ids = new Set<string>();
  if (segments) {
    for (const s of segments) if (saved.has(s.id)) ids.add(s.id);
    const idx = nearestSegmentIndex(segments, positionMs);
    const current = idx >= 0 ? segments[idx] : undefined;
    if (current) ids.add(current.id);
  }
  return [...ids].slice(0, MAX_SCOPE_SEGMENT_IDS);
}
