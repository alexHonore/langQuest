import { describe, expect, it } from 'vitest';
import { VadDetector, levelToUnit } from './vad';

describe('VadDetector', () => {
  it('declares speech only after sustained sound and ends it after trailing silence', () => {
    const vad = new VadDetector({ thresholdDb: -35, minSpeechMs: 200, silenceMs: 600 });
    expect(vad.sample(-20, 0)).toBeNull();
    expect(vad.sample(-20, 100)).toBeNull();
    expect(vad.sample(-20, 200)).toBe('speech_start');
    expect(vad.isSpeaking).toBe(true);
    expect(vad.sample(-50, 300)).toBeNull();
    expect(vad.sample(-20, 400)).toBeNull(); // brief pause does not end the turn
    expect(vad.sample(-50, 500)).toBeNull();
    expect(vad.sample(-50, 1000)).toBeNull();
    expect(vad.sample(-50, 1100)).toBe('speech_end');
    expect(vad.isSpeaking).toBe(false);
  });

  it('ignores short blips and missing metering', () => {
    const vad = new VadDetector({ minSpeechMs: 300 });
    expect(vad.sample(-10, 0)).toBeNull();
    expect(vad.sample(-60, 100)).toBeNull();
    expect(vad.sample(-10, 200)).toBeNull();
    expect(vad.sample(undefined, 600)).toBeNull();
    expect(vad.isSpeaking).toBe(false);
  });

  it('caps a turn at maxTurnMs', () => {
    const vad = new VadDetector({ minSpeechMs: 0, maxTurnMs: 1000 });
    expect(vad.sample(-10, 0)).toBe('speech_start');
    expect(vad.sample(-10, 999)).toBeNull();
    expect(vad.sample(-10, 1000)).toBe('speech_end');
  });

  it('maps levels to a unit meter', () => {
    expect(levelToUnit(undefined)).toBe(0);
    expect(levelToUnit(-60)).toBe(0);
    expect(levelToUnit(-30)).toBeCloseTo(0.5);
    expect(levelToUnit(5)).toBe(1);
  });
});
