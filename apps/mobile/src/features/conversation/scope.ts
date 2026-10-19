/**
 * What a conversation session practises (contracts `ConversationSessionScopeSchema`), derived from the route
 * params the entry points pass to `/conversation`:
 * - "Practice this with AI" from the audio library → `audio_lesson` (+ the transcript segments the learner
 *   picked, comma-joined in the URL) so the character is grounded in exactly that lesson;
 * - a mission link → `mission`;
 * - nothing → `undefined`, and the server derives `free`.
 */
import type { ConversationSessionScope } from '@langquest/contracts';

export interface ConversationScopeParams {
  missionId?: string;
  audioLessonId?: string;
  /** Comma-joined transcript segment UUIDs (at most 200 are sent). */
  transcriptSegmentIds?: string;
}

export const MAX_SCOPE_SEGMENT_IDS = 200;

export function sessionScopeFromParams(params: ConversationScopeParams): ConversationSessionScope | undefined {
  if (params.audioLessonId) {
    const ids = [...new Set((params.transcriptSegmentIds ?? '').split(',').map((id) => id.trim()).filter((id) => id.length > 0))].slice(0, MAX_SCOPE_SEGMENT_IDS);
    return { kind: 'audio_lesson', audioLessonId: params.audioLessonId, ...(ids.length > 0 ? { transcriptSegmentIds: ids } : {}) };
  }
  if (params.missionId) return { kind: 'mission', missionId: params.missionId };
  return undefined;
}
