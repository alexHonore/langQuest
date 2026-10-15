import type { ProgressEventPayload } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/store/document-store';
import { ListeningProgressSync, type AudioProgressPutRequest } from './listening-progress';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lesson = uuid(1);
const meta = { title: 'Les légumes', subtitle: null, collectionId: uuid(2), chapterId: uuid(3), artworkUri: null, courseTrackId: 'arabic-moroccan' };

class NetError extends Error {
  readonly connectivity = true;
}

function setup(opts: { online?: boolean; put?: (lessonId: string, body: AudioProgressPutRequest) => Promise<{ lessonId: string; positionMs: number; completed: boolean; revision: number; resolution: 'applied' | 'duplicate' | 'superseded' }> } = {}) {
  const store = new MemoryDocumentStore();
  let ids = 0;
  let t = 1_700_000_000_000;
  const outbox: ProgressEventPayload[] = [];
  const put = vi.fn(opts.put ?? (async (lessonId: string, body: AudioProgressPutRequest) => ({ lessonId, positionMs: body.positionMs, completed: body.completed, revision: body.revision, resolution: 'applied' as const })));
  let online = opts.online ?? true;
  const sync = new ListeningProgressSync({
    store,
    deviceId: 'device-1',
    newId: () => uuid(100 + ++ids),
    now: () => new Date((t += 20_000)).toISOString(),
    put,
    enqueueOutbox: async (payload) => void outbox.push(payload),
    isOnline: () => online,
    isConnectivityError: (e) => e instanceof NetError,
    throttleMs: 15_000,
  });
  return { sync, put, outbox, store, setOnline: (v: boolean) => (online = v) };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ListeningProgressSync', () => {
  it('writes locally first and PUTs an idempotent update with device id and revision', async () => {
    const { sync, put } = setup();
    const rec = await sync.record({ lessonId: lesson, positionMs: 12_345, durationMs: 180_000, completed: false, meta }, { flush: true });
    expect(rec.revision).toBe(1);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    const body = put.mock.calls[0]![1];
    expect(body).toMatchObject({ clientEventId: uuid(101), deviceId: 'device-1', revision: 1, positionMs: 12_345, completed: false });
    const after = await sync.get(lesson);
    expect(after?.syncedRevision).toBe(1);
    expect(after?.pendingClientEventId).toBeNull();
    expect((await sync.continueListening()).map((p) => p.lessonId)).toEqual([lesson]);
  });

  it('falls back to the outbox when offline and does not queue the same update twice', async () => {
    const { sync, put, outbox } = setup({ online: false });
    await sync.record({ lessonId: lesson, positionMs: 5_000, durationMs: null, completed: false, meta }, { flush: true });
    await tick();
    await sync.flushAll();
    expect(put).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'audio_progress', lessonId: lesson, positionMs: 5_000 });
    const rec = await sync.get(lesson);
    expect(rec?.queuedInOutbox).toBe(true);
    expect(rec?.pendingClientEventId).toBeNull();
  });

  it('queues in the outbox when the PUT fails on connectivity, keeps the position locally otherwise', async () => {
    const net = setup({
      put: async () => {
        throw new NetError('offline');
      },
    });
    await net.sync.record({ lessonId: lesson, positionMs: 9_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    expect(net.outbox).toHaveLength(1);
    const rejected = setup({
      put: async () => {
        throw new Error('validation_failed');
      },
    });
    await rejected.sync.record({ lessonId: lesson, positionMs: 9_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    expect(rejected.outbox).toHaveLength(0);
    expect((await rejected.sync.get(lesson))?.positionMs).toBe(9_000);
  });

  it('throttles ticks but always flushes pauses, and never reuses an acknowledged event id', async () => {
    const { sync, put } = setup();
    await sync.record({ lessonId: lesson, positionMs: 1_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    await sync.record({ lessonId: lesson, positionMs: 2_000, durationMs: 60_000, completed: false, meta });
    await tick();
    expect(put).toHaveBeenCalledTimes(1); // throttled tick
    await sync.record({ lessonId: lesson, positionMs: 3_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    const ids = put.mock.calls.map((c) => c[1].clientEventId);
    expect(new Set(ids).size).toBe(2);
    expect(put.mock.calls[1]![1].revision).toBe(3);
  });

  it('merges the server copy only when nothing is pending locally', async () => {
    const { sync, setOnline } = setup({ online: false });
    const merged = await sync.mergeServer(lesson, { positionMs: 40_000, completed: false, revision: 7 }, meta, 60_000);
    expect(merged?.positionMs).toBe(40_000);
    setOnline(false);
    await sync.record({ lessonId: lesson, positionMs: 50_000, durationMs: 60_000, completed: false, meta });
    const kept = await sync.mergeServer(lesson, { positionMs: 10_000, completed: false, revision: 8 }, meta, 60_000);
    expect(kept?.positionMs).toBe(50_000);
  });
});
