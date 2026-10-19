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
  const outboxOptions: { clientEventId: string; revision: number; occurredAt: string }[] = [];
  const put = vi.fn(opts.put ?? (async (lessonId: string, body: AudioProgressPutRequest) => ({ lessonId, positionMs: body.positionMs, completed: body.completed, revision: body.revision, resolution: 'applied' as const })));
  let online = opts.online ?? true;
  const sync = new ListeningProgressSync({
    store,
    deviceId: 'device-1',
    newId: () => uuid(100 + ++ids),
    now: () => new Date((t += 5_000)).toISOString(),
    put,
    enqueueOutbox: async (payload, options) => {
      outbox.push(payload);
      outboxOptions.push(options);
    },
    isOnline: () => online,
    isConnectivityError: (e) => e instanceof NetError,
    throttleMs: 15_000,
  });
  return { sync, put, outbox, outboxOptions, store, setOnline: (v: boolean) => (online = v) };
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
    const { sync, put, outbox, outboxOptions } = setup({ online: false });
    await sync.record({ lessonId: lesson, positionMs: 5_000, durationMs: null, completed: false, meta }, { flush: true });
    await tick();
    await sync.flushAll();
    expect(put).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'audio_progress', lessonId: lesson, positionMs: 5_000 });
    const rec = await sync.get(lesson);
    expect(rec?.queuedInOutbox).toBe(true);
    expect(rec?.pendingClientEventId).toBeNull();
    // The queued event carries the LESSON revision and the id the PUT would have used (server dedupe).
    expect(outboxOptions[0]).toMatchObject({ clientEventId: uuid(101), revision: 1, occurredAt: rec?.updatedAt });
  });

  it('hands the outbox the same event id and lesson revision the failed PUT sent', async () => {
    const net = setup({
      put: async () => {
        throw new NetError('offline');
      },
    });
    await net.sync.record({ lessonId: lesson, positionMs: 1_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    net.setOnline(true);
    await net.sync.record({ lessonId: lesson, positionMs: 2_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    expect(net.put).toHaveBeenCalledTimes(2);
    const sent = net.put.mock.calls[1]![1];
    expect(net.outboxOptions[1]).toMatchObject({ clientEventId: sent.clientEventId, revision: sent.revision });
    expect(net.outboxOptions.map((o) => o.revision)).toEqual([1, 2]);
  });

  it('adopts the server position when the PUT is superseded by a newer write elsewhere', async () => {
    const { sync, put } = setup({
      put: async (lessonId) => ({ lessonId, positionMs: 42_000, completed: false, revision: 9, resolution: 'superseded' as const }),
    });
    await sync.record({ lessonId: lesson, positionMs: 3_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    const rec = await sync.get(lesson);
    expect(rec?.positionMs).toBe(42_000);
    expect(rec?.pendingClientEventId).toBeNull();
    // Lifted to the server's revision so a same-device counter that fell behind cannot be superseded forever.
    expect(rec?.revision).toBe(9);
    expect(rec?.syncedRevision).toBe(9);
    expect((await sync.continueListening())[0]?.positionMs).toBe(42_000);
  });

  it('keeps a newer local write when the superseded answer races it, and re-pushes it above the server revision', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const put = vi.fn(async (lessonId: string, body: AudioProgressPutRequest) => {
      if (body.revision === 1) {
        await gate;
        return { lessonId, positionMs: 42_000, completed: false, revision: 9, resolution: 'superseded' as const };
      }
      return { lessonId, positionMs: body.positionMs, completed: body.completed, revision: body.revision, resolution: 'applied' as const };
    });
    const { sync } = setup({ put });
    await sync.record({ lessonId: lesson, positionMs: 3_000, durationMs: 60_000, completed: false, meta }, { flush: true });
    await tick();
    await sync.record({ lessonId: lesson, positionMs: 4_000, durationMs: 60_000, completed: false, meta }); // typed more while in flight
    release();
    await tick();
    await tick();
    const rec = await sync.get(lesson);
    expect(rec?.positionMs).toBe(4_000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]![1].revision).toBe(9);
    expect(rec?.syncedRevision).toBe(9);
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
