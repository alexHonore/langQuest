import { describe, expect, it } from 'vitest';
import { clipName } from './synthesize-bundle-audio';
import { NARRATOR_VOICES, narrationMap } from './synthesize-narration';

describe('synthesize-narration', () => {
  it('has a narrator for each instruction language, unlike any course voice', () => {
    expect(Object.keys(NARRATOR_VOICES).sort()).toEqual(['en', 'fr']);
    for (const voice of Object.values(NARRATOR_VOICES)) {
      expect(['Aoede', 'Orus', 'Puck', 'Kore', 'Charon']).not.toContain(voice.voice);
      expect(voice.model).toMatch(/^google\//);
    }
  });

  it('maps each recorded sentence to its clip, and leaves out the ones not recorded yet', () => {
    const fr = NARRATOR_VOICES.fr!;
    const recorded = clipName(fr, 'Anas dit');
    const map = narrationMap(['Comment dit-on « Merci » ?', 'Anas dit'], fr, (file) => file === recorded);
    expect(map).toEqual({ 'Anas dit': `assets/audio/narration/${recorded}` });
  });

  it('names a clip by its voice and words, so a changed sentence gets a new clip', () => {
    const en = NARRATOR_VOICES.en!;
    expect(clipName(en, 'Your line')).toMatch(/^narrator-en-sulafat-[0-9a-f]{16}\.mp3$/);
    expect(clipName(en, 'Your line')).not.toBe(clipName(en, 'Your line!'));
  });
});
