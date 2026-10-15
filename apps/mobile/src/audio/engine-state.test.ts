import { describe, expect, it } from 'vitest';
import { INITIAL_ENGINE_STATE, endBehaviour, isCompleted, loopJump, reduceEngine, resumePosition, type QueueItem } from './engine-state';

const item = (id: string, durationMs: number | null = 60_000): QueueItem => ({ id, collectionId: 'c', chapterId: 'ch', title: id, subtitle: null, artworkUri: null, assetId: `asset-${id}`, durationMs, attributionText: null, courseTrackId: null });

describe('engine state reducer', () => {
  it('loads the selected queue item at the requested position and clamps to duration', () => {
    const s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a'), item('b')], index: 1, positionMs: 999_999 });
    expect(s.index).toBe(1);
    expect(s.status).toBe('loading');
    expect(s.positionMs).toBe(60_000);
    expect(s.durationMs).toBe(60_000);
  });

  it('treats an unexpected native stop while playing as an interruption', () => {
    let s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a')], index: 0, positionMs: 0 });
    s = reduceEngine(s, { type: 'source_ready', source: { uri: 'file://a', kind: 'local', expiresAt: null, assetId: 'asset-a' }, renewal: false });
    s = reduceEngine(s, { type: 'play_requested' });
    s = reduceEngine(s, { type: 'native_status', playing: true, positionMs: 1_000, durationMs: 60_000, buffering: false, loaded: true });
    expect(s.status).toBe('playing');
    s = reduceEngine(s, { type: 'native_status', playing: false, positionMs: 1_500, durationMs: 60_000, buffering: false, loaded: true });
    expect(s.status).toBe('paused');
    expect(s.pauseReason).toBe('interrupted');
    expect(s.positionMs).toBe(1_500);
  });

  it('keeps the last known position while a renewed URL is swapped in', () => {
    let s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a')], index: 0, positionMs: 30_000 });
    s = reduceEngine(s, { type: 'source_ready', source: { uri: 'https://x/1', kind: 'remote', expiresAt: '2030-01-01T00:00:00Z', assetId: 'asset-a' }, renewal: false });
    s = reduceEngine(s, { type: 'play_requested' });
    s = reduceEngine(s, { type: 'recovering', value: true });
    s = reduceEngine(s, { type: 'native_status', playing: false, positionMs: 0, durationMs: 60_000, buffering: true, loaded: false });
    expect(s.positionMs).toBe(30_000);
    expect(s.status).toBe('playing');
    s = reduceEngine(s, { type: 'source_ready', source: { uri: 'https://x/2', kind: 'remote', expiresAt: '2030-01-01T01:00:00Z', assetId: 'asset-a' }, renewal: true });
    expect(s.renewals).toBe(1);
  });

  it('decides what happens at the end of an item (loop → sleep → advance → finish)', () => {
    let s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a'), item('b')], index: 0, positionMs: 0 });
    expect(endBehaviour(s)).toEqual({ kind: 'advance', toIndex: 1 });
    s = reduceEngine(s, { type: 'sleep_set', sleep: { kind: 'end_of_item' } });
    expect(endBehaviour(s)).toEqual({ kind: 'stop_sleep' });
    s = reduceEngine(s, { type: 'loop_set', loop: { startMs: 5_000, endMs: 10_000 } });
    expect(endBehaviour(s)).toEqual({ kind: 'loop_back', toMs: 5_000 });
    const last = reduceEngine(reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a')], index: 0, positionMs: 0 }), { type: 'sleep_set', sleep: { kind: 'off' } });
    expect(endBehaviour(last)).toEqual({ kind: 'finish' });
  });

  it('A/B loop jumps back to A when the playhead passes B and rejects empty loops', () => {
    let s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a')], index: 0, positionMs: 0 });
    s = reduceEngine(s, { type: 'loop_set', loop: { startMs: 12_000, endMs: 8_000 } });
    expect(s.loop).toEqual({ startMs: 8_000, endMs: 12_000 });
    expect(loopJump(s, 11_000)).toBeNull();
    expect(loopJump(s, 12_000)).toBe(8_000);
    s = reduceEngine(s, { type: 'loop_set', loop: { startMs: 5_000, endMs: 5_000 } });
    expect(s.loop).toBeNull();
  });

  it('completion margin and resume semantics', () => {
    expect(isCompleted(57_500, 60_000)).toBe(true);
    expect(isCompleted(50_000, 60_000)).toBe(false);
    expect(isCompleted(50_000, null)).toBe(false);
    expect(resumePosition(58_000, 60_000, false)).toBe(0);
    expect(resumePosition(20_000, 60_000, false)).toBe(20_000);
    expect(resumePosition(20_000, 60_000, true)).toBe(0);
  });

  it('stopped clears the queue but keeps the learner rate and a running minute timer', () => {
    let s = reduceEngine(INITIAL_ENGINE_STATE, { type: 'queue_set', queue: [item('a')], index: 0, positionMs: 0 });
    s = reduceEngine(s, { type: 'rate', rate: 1.25 });
    s = reduceEngine(s, { type: 'sleep_set', sleep: { kind: 'minutes', minutes: 15, endsAt: 1 } });
    s = reduceEngine(s, { type: 'stopped' });
    expect(s.index).toBe(-1);
    expect(s.rate).toBe(1.25);
    expect(s.sleep.kind).toBe('minutes');
    expect(reduceEngine(s, { type: 'rate', rate: 9 }).rate).toBe(2);
  });
});
