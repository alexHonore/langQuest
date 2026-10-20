import type { ConversationMode } from '@langquest/contracts';

/**
 * Which turns the live conversation lists. The character's turns always show (they are the conversation).
 * The learner's own turns follow the transcript toggle in voice modes (their speech, transcribed), but in
 * `text_only` mode they are what the learner typed and always show — device QA 2026-10-20 found typed
 * replies vanishing because the toggle defaults to off.
 */
export function showTurnInTranscript(role: 'learner' | 'character' | string, options: { transcriptOn: boolean; mode: ConversationMode }): boolean {
  if (role !== 'learner') return true;
  return options.mode === 'text_only' || options.transcriptOn;
}
