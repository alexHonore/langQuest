import { describe, expect, it } from 'vitest';
import { showTurnInTranscript } from './transcript';

describe('showTurnInTranscript', () => {
  it('always lists what the learner typed in text-only mode (device QA 2026-10-20)', () => {
    expect(showTurnInTranscript('learner', { transcriptOn: false, mode: 'text_only' })).toBe(true);
  });
  it('follows the transcript toggle for spoken learner turns', () => {
    expect(showTurnInTranscript('learner', { transcriptOn: false, mode: 'push_to_talk' })).toBe(false);
    expect(showTurnInTranscript('learner', { transcriptOn: true, mode: 'hands_free' })).toBe(true);
  });
  it('always lists the character', () => {
    expect(showTurnInTranscript('character', { transcriptOn: false, mode: 'push_to_talk' })).toBe(true);
  });
});
