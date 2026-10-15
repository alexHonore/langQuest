import type { ProgressEventPayload } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/store/document-store';
import { BookmarkStore, type AudioBookmarkCreateRequest } from './bookmarks';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lesson = uuid(1);

class NetError extends Error {}

function setup(opts: { online?: boolean; create?: (body: AudioBookmarkCreateRequest) => Promise<{ id: string; lessonId: string; positionMs: number; note: string | null; segmentId: string | null; createdAt: string; replayed: boolean }> } = {}) {
  const store = new MemoryDocumentStore();
  let ids = 0;
  const outbox: ProgressEventPayload[] = [];
  const create = vi.fn(opts.create ?? (async (body: AudioBookmarkCreateRequest) => ({ id: uuid(500 + ids), lessonId: body.lessonId, positionMs: body.positionMs, note: body.note, segmentId: body.segmentId, createdAt: '2026-10-14T00:00:00Z', replayed: false })));
  const bookmarks = new BookmarkStore({ store, newId: () => uuid(100 + ++ids), now: () => '2026-10-14T00:00:00Z', create, enqueueOutbox: async (p) => void outbox.push(p), isOnline: () => opts.online ?? true, isConnectivityError: (e) => e instanceof NetError });
  return { bookmarks, create, outbox };
}

describe('BookmarkStore', () => {
  it('creates a bookmark with a client event id and adopts the server id', async () => {
    const { bookmarks, create } = setup();
    const b = await bookmarks.add({ lessonId: lesson, positionMs: 4_200 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ clientEventId: uuid(101), positionMs: 4_200, segmentId: null }));
    expect(b.sync).toBe('synced');
    expect(b.id).toBe(uuid(501));
    expect(await bookmarks.list(lesson)).toHaveLength(1);
  });

  it('saves an expression as a segment-anchored bookmark and lists it under saved expressions', async () => {
    const { bookmarks } = setup();
    await bookmarks.add({ lessonId: lesson, positionMs: 1_000, segmentId: uuid(9), expressionText: 'labas, hamdullah', expressionTranslation: 'ça va, merci' });
    const saved = await bookmarks.savedExpressions();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ expressionText: 'labas, hamdullah', note: 'labas, hamdullah', segmentId: uuid(9) });
  });

  it('queues in the outbox when offline and keeps the local record pending', async () => {
    const { bookmarks, outbox, create } = setup({ online: false });
    const b = await bookmarks.add({ lessonId: lesson, positionMs: 7_000, note: 'remember' });
    expect(create).not.toHaveBeenCalled();
    expect(outbox[0]).toMatchObject({ type: 'bookmark_created', lessonId: lesson, positionMs: 7_000, note: 'remember' });
    expect(b.sync).toBe('queued');
  });

  it('retries a rejected segment anchor without the anchor and merges server bookmarks', async () => {
    let calls = 0;
    const { bookmarks, create } = setup({
      create: async (body) => {
        calls += 1;
        if (body.segmentId) throw new Error('Unknown segment');
        return { id: uuid(777), lessonId: body.lessonId, positionMs: body.positionMs, note: body.note, segmentId: null, createdAt: '2026-10-14T00:00:00Z', replayed: false };
      },
    });
    const b = await bookmarks.add({ lessonId: lesson, positionMs: 3_000, segmentId: uuid(42), expressionText: 'w nta?' });
    expect(calls).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(b.sync).toBe('synced');
    const merged = await bookmarks.mergeServer(lesson, [
      { id: uuid(777), positionMs: 3_000, note: 'w nta?' },
      { id: uuid(778), positionMs: 9_000, note: null },
    ]);
    expect(merged.map((m) => m.id).sort()).toEqual([uuid(777), uuid(778)]);
  });
});
