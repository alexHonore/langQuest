import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, SourceResolutionError, type NativePlayer, type NativePlayerStatus, type ProgressReport } from './AudioEngine';
import type { QueueItem, ResolvedSource } from './engine-state';

const item = (id: string, durationMs = 60_000): QueueItem => ({ id, collectionId: 'c', chapterId: 'ch', title: `Lesson ${id}`, subtitle: 'Collection · Chapter', artworkUri: null, assetId: `asset-${id}`, durationMs, attributionText: null, courseTrackId: null });

/** Fake native player: records calls and lets tests push status updates. */
function fakePlayer() {
  const calls: string[] = [];
  let listener: ((s: NativePlayerStatus) => void) | null = null;
  let position = 0;
  let playing = false;
  const player: NativePlayer = {
    load: (uri) => calls.push(`load:${uri}`),
    play: () => {
      playing = true;
      calls.push('play');
    },
    pause: () => {
      playing = false;
      calls.push('pause');
    },
    seekTo: async (ms) => {
      position = ms;
      calls.push(`seek:${ms}`);
    },
    setRate: (rate) => calls.push(`rate:${rate}`),
    setLockScreen: (active, meta) => calls.push(`lock:${active}:${meta?.title ?? ''}`),
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    release: () => calls.push('release'),
  };
  const emit = (patch: Partial<NativePlayerStatus> = {}): void => {
    listener?.({ playing, positionMs: position, durationMs: 60_000, loaded: true, buffering: false, didJustFinish: false, error: null, ...patch });
  };
  return { player, calls, emit, setPosition: (ms: number) => (position = ms), isPlaying: () => playing };
}

interface Clock {
  now: () => number;
  advance: (ms: number) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}
function fakeClock(start = 1_700_000_000_000): Clock {
  let now = start;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      id += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    advance: (ms) => {
      now += ms;
      for (const [k, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(k);
          t.fn();
        }
      }
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeEngine(opts: { resolve?: (item: QueueItem, o: { renewal: boolean; afterFailure: boolean }) => Promise<ResolvedSource>; clock?: Clock } = {}) {
  const fp = fakePlayer();
  const clock = opts.clock ?? fakeClock();
  const reports: ProgressReport[] = [];
  const events: string[] = [];
  const resolve = vi.fn(opts.resolve ?? (async (it: QueueItem) => ({ uri: `file:///${it.id}.mp3`, kind: 'local' as const, expiresAt: null, assetId: it.assetId })));
  const engine = new AudioEngine({ player: fp.player, resolveSource: resolve, onProgress: (r) => reports.push(r), onEvent: (e) => events.push(e.type), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, progressIntervalMs: 5_000 });
  return { engine, fp, clock, reports, events, resolve };
}

describe('AudioEngine', () => {
  it('loads, seeks to the resume position, sets lock-screen metadata and plays', async () => {
    const { engine, fp } = makeEngine();
    await engine.setQueue([item('a'), item('b')], 0, { positionMs: 12_000, autoplay: true });
    expect(fp.calls).toEqual(['load:file:///a.mp3', 'rate:1', 'lock:true:Lesson a', 'seek:12000', 'play']);
    expect(engine.getState().status).toBe('playing');
    fp.setPosition(13_000);
    fp.emit();
    expect(engine.getState().positionMs).toBe(13_000);
  });

  it('skips ±, clamps seeks, changes rate with pitch correction and toggles', async () => {
    const { engine, fp } = makeEngine();
    await engine.setQueue([item('a')], 0, { autoplay: false });
    expect(engine.getState().status).toBe('paused');
    await engine.skipForward();
    expect(engine.getState().positionMs).toBe(15_000);
    await engine.skipBack();
    expect(engine.getState().positionMs).toBe(5_000);
    await engine.seekTo(500_000);
    expect(engine.getState().positionMs).toBe(60_000);
    engine.setRate(1.5);
    expect(fp.calls).toContain('rate:1.5');
    await engine.toggle();
    expect(engine.getState().status).toBe('playing');
    await engine.toggle();
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().pauseReason).toBe('user');
  });

  it('advances through the chapter queue when an item finishes and finishes at the end', async () => {
    const { engine, fp, events } = makeEngine();
    await engine.setQueue([item('a'), item('b')], 0, { autoplay: true });
    fp.emit({ didJustFinish: true });
    await flush();
    expect(engine.getState().index).toBe(1);
    expect(engine.getState().status).toBe('playing');
    expect(events).toContain('item_finished');
    fp.emit({ didJustFinish: true });
    await flush();
    expect(engine.getState().status).toBe('ended');
  });

  it('marks an OS interruption honestly instead of pretending to play', async () => {
    const { engine, fp, events, reports } = makeEngine();
    await engine.setQueue([item('a')], 0, { autoplay: true });
    fp.setPosition(20_000);
    fp.emit({ playing: false });
    const s = engine.getState();
    expect(s.status).toBe('paused');
    expect(s.pauseReason).toBe('interrupted');
    expect(events).toContain('interrupted');
    expect(reports.at(-1)).toMatchObject({ reason: 'pause', positionMs: 20_000 });
  });

  it('renews an expired signed URL proactively and resumes at the same position (A22)', async () => {
    const clock = fakeClock();
    let n = 0;
    const resolve = async (it: QueueItem, o: { renewal: boolean }): Promise<ResolvedSource> => {
      n += 1;
      return { uri: `https://media/${it.id}?v=${n}&renewal=${o.renewal}`, kind: 'remote', expiresAt: new Date(clock.now() + 10 * 60_000).toISOString(), assetId: it.assetId };
    };
    const { engine, fp, events } = makeEngine({ resolve, clock });
    await engine.setQueue([item('a', 3_600_000)], 0, { autoplay: true });
    fp.setPosition(30_000);
    fp.emit();
    // 8.5 minutes later we are inside the renewal window and playback outlives the URL → swap.
    clock.advance(8.5 * 60_000);
    await flush();
    await flush();
    expect(events).toContain('url_renewed');
    expect(fp.calls).toContain('load:https://media/a?v=2&renewal=true');
    expect(fp.calls.at(-2)).toBe('seek:30000');
    expect(fp.calls.at(-1)).toBe('play');
    expect(engine.getState().status).toBe('playing');
    expect(engine.getState().renewals).toBe(1);
  });

  it('recovers from a mid-stream playback error on a remote source by renewing reactively', async () => {
    const clock = fakeClock();
    let n = 0;
    const resolve = async (it: QueueItem): Promise<ResolvedSource> => {
      n += 1;
      return { uri: `https://media/${it.id}?v=${n}`, kind: 'remote', expiresAt: new Date(clock.now() + 60 * 60_000).toISOString(), assetId: it.assetId };
    };
    const { engine, fp, resolve: spy } = makeEngine({ resolve, clock });
    await engine.setQueue([item('a')], 0, { autoplay: true });
    fp.setPosition(45_000);
    fp.emit();
    fp.emit({ error: 'HTTP 403' });
    await flush();
    await flush();
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), { renewal: true, afterFailure: true });
    expect(fp.calls).toContain('load:https://media/a?v=2');
    expect(engine.getState().positionMs).toBe(45_000);
    expect(engine.getState().status).toBe('playing');
  });

  it('surfaces honest errors when the source cannot be resolved (no fake player)', async () => {
    const { engine } = makeEngine({
      resolve: async () => {
        throw new SourceResolutionError('unsupported', 'Media storage not enabled');
      },
    });
    await engine.setQueue([item('a')], 0, { autoplay: true });
    expect(engine.getState().status).toBe('error');
    expect(engine.getState().error).toEqual({ code: 'unsupported', message: 'Media storage not enabled' });
  });

  it('sleep timer pauses after N minutes; end-of-item stops auto-advance', async () => {
    const clock = fakeClock();
    const { engine, fp, events } = makeEngine({ clock });
    await engine.setQueue([item('a'), item('b')], 0, { autoplay: true });
    engine.setSleepTimer(15);
    expect(engine.sleepRemaining()).toBe(15 * 60_000);
    clock.advance(15 * 60_000);
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().pauseReason).toBe('sleep_timer');
    expect(events).toContain('sleep_fired');
    await engine.play();
    engine.setSleepTimer('end_of_item');
    fp.emit({ didJustFinish: true });
    await flush();
    expect(engine.getState().index).toBe(0);
    expect(engine.getState().status).toBe('ended');
    expect(engine.getState().sleep.kind).toBe('off');
  });

  it('A/B loop keeps replaying the segment and reports progress ticks at most every interval', async () => {
    const clock = fakeClock();
    const { engine, fp, reports } = makeEngine({ clock });
    await engine.setQueue([item('a')], 0, { autoplay: true });
    engine.setLoop({ startMs: 10_000, endMs: 12_000 });
    await flush();
    expect(fp.calls).toContain('seek:10000');
    fp.setPosition(12_100);
    fp.emit();
    await flush();
    expect(fp.calls.at(-1)).toBe('seek:10000');
    const ticks = () => reports.filter((r) => r.reason === 'tick').length;
    const before = ticks();
    fp.setPosition(10_500);
    fp.emit();
    expect(ticks()).toBe(before);
    clock.advance(5_000);
    fp.setPosition(11_000);
    fp.emit();
    expect(ticks()).toBe(before + 1);
  });

  it('stop releases the lock screen and reports a final position', async () => {
    const { engine, fp, reports } = makeEngine();
    await engine.setQueue([item('a')], 0, { autoplay: true });
    fp.setPosition(40_000);
    fp.emit();
    await engine.stop();
    expect(reports.at(-1)).toMatchObject({ reason: 'stop', positionMs: 40_000 });
    expect(fp.calls.at(-1)).toBe('lock:false:');
    expect(engine.getState().index).toBe(-1);
  });
});
