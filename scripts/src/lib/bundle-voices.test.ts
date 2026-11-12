import { describe, expect, it } from 'vitest';
import { bundleLines, clipName, listenPrompt, type BundleChapter } from '../synthesize-bundle-audio';
import { BUNDLE_VOICES, voiceForLine } from './bundle-voices';
import { readBundleChapters } from './flutter-bundle';
import { repoRoot } from './io';

const chapters = readBundleChapters<BundleChapter>(repoRoot());

describe('the bundled course voices', () => {
  it('casts the character by their voice and the learner in a voice of their own', () => {
    expect(voiceForLine('spanish-spain', 'character', 'female')?.id).toBe('es-es-aoede');
    expect(voiceForLine('spanish-spain', 'character', 'male')?.id).toBe('es-es-orus');
    expect(voiceForLine('spanish-spain', 'learner', 'male')?.id).toBe('es-es-puck');
    expect(voiceForLine('klingon', 'learner', null)).toBeNull();
    // Chinese Simplified is Mandarin's lines: the same voices, so each line is recorded once.
    expect(BUNDLE_VOICES['chinese-simplified']).toEqual(BUNDLE_VOICES['chinese-mandarin']);
    for (const course of Object.values(BUNDLE_VOICES)) {
      expect(new Set([course.female.id, course.male.id, course.learner.id]).size).toBe(3);
    }
  });

  it('every bundled line has a voice; within a mission the two speakers never share one', () => {
    const lines = bundleLines(chapters);
    expect(lines.length).toBeGreaterThan(150);
    const byMission = new Map<string, { learner: Set<string>; character: Set<string> }>();
    for (const l of lines) {
      const mission = l.expressionId.split(':').slice(0, 2).join(':');
      const sides = byMission.get(mission) ?? { learner: new Set(), character: new Set() };
      (l.voice === BUNDLE_VOICES[l.trackId]!.learner ? sides.learner : sides.character).add(l.voice.id);
      byMission.set(mission, sides);
    }
    for (const [mission, sides] of byMission) expect([...sides.learner].filter((v) => sides.character.has(v)), mission).toEqual([]);
  });

  it('names a clip by its voice and what it says (a changed line gets a new clip); the listener writes what it hears first', () => {
    const v = BUNDLE_VOICES['spanish-spain']!.female;
    expect(clipName(v, 'Hola.')).toMatch(/^es-es-aoede-[0-9a-f]{16}\.mp3$/);
    expect(clipName(v, 'Hola.')).toBe(clipName(v, 'Hola.'));
    expect(clipName(v, 'Hola.')).not.toBe(clipName(v, 'Hola!'));
    const prompt = listenPrompt('Hola.');
    expect(prompt.indexOf('as if you did not know')).toBeLessThan(prompt.indexOf('"Hola."'));
  });
});
