/**
 * Bookmarks and saved expressions (§1.3 Audio, §7.5). Stored locally first
 * with a client event id, posted to `POST /v1/me/audio-bookmarks`
 * (idempotent on `clientEventId`), and queued in the outbox as a
 * `bookmark_created` event when the server is unreachable. A "saved
 * expression" is a bookmark anchored to a transcript segment with the
 * segment text as its note, so it is reviewable later from the lesson.
 */
import type { AudioBookmarkCreateRequestSchema, AudioBookmarkResponseSchema, ProgressEventPayload } from '@langquest/contracts';
import type { z } from 'zod';
import type { DocumentStore } from '@/store/document-store';

export type AudioBookmarkCreateRequest = z.infer<typeof AudioBookmarkCreateRequestSchema>;
export type AudioBookmarkResponse = z.infer<typeof AudioBookmarkResponseSchema>;

export const BOOKMARKS_COLLECTION = 'audio_bookmarks';

export interface LocalBookmark {
  /** Server id once known, else the client event id. */
  id: string;
  clientEventId: string;
  lessonId: string;
  positionMs: number;
  note: string | null;
  segmentId: string | null;
  /** Segment text snapshot for saved expressions (shown even when the transcript is not loaded). */
  expressionText: string | null;
  expressionTranslation: string | null;
  createdAt: string;
  sync: 'synced' | 'pending' | 'queued';
}

export interface BookmarkDeps {
  store: DocumentStore;
  newId: () => string;
  now: () => string;
  create: (body: AudioBookmarkCreateRequest) => Promise<AudioBookmarkResponse>;
  enqueueOutbox: (payload: ProgressEventPayload) => Promise<unknown>;
  isOnline: () => boolean;
  isConnectivityError: (error: unknown) => boolean;
}

const key = (lessonId: string, id: string): string => `${lessonId}:${id}`;

export class BookmarkStore {
  constructor(private readonly deps: BookmarkDeps) {}

  async list(lessonId: string): Promise<LocalBookmark[]> {
    const docs = await this.deps.store.list<LocalBookmark>(BOOKMARKS_COLLECTION, { order: 'asc' });
    return docs.map((d) => d.doc).filter((b) => b.lessonId === lessonId);
  }

  /** Saved expressions across lessons (segment-anchored bookmarks), newest first. */
  async savedExpressions(limit = 50): Promise<LocalBookmark[]> {
    const docs = await this.deps.store.list<LocalBookmark>(BOOKMARKS_COLLECTION, { order: 'desc' });
    return docs
      .map((d) => d.doc)
      .filter((b) => b.segmentId !== null && b.expressionText !== null)
      .slice(0, limit);
  }

  async add(input: { lessonId: string; positionMs: number; note?: string | null; segmentId?: string | null; expressionText?: string | null; expressionTranslation?: string | null }): Promise<LocalBookmark> {
    const clientEventId = this.deps.newId();
    const bookmark: LocalBookmark = {
      id: clientEventId,
      clientEventId,
      lessonId: input.lessonId,
      positionMs: Math.max(0, Math.round(input.positionMs)),
      note: input.note ?? input.expressionText ?? null,
      segmentId: input.segmentId ?? null,
      expressionText: input.expressionText ?? null,
      expressionTranslation: input.expressionTranslation ?? null,
      createdAt: this.deps.now(),
      sync: 'pending',
    };
    await this.save(bookmark);
    await this.push(bookmark);
    // Once synced the record lives under its server id, so look it up by client event id.
    return (await this.list(bookmark.lessonId)).find((b) => b.clientEventId === clientEventId) ?? bookmark;
  }

  private async push(bookmark: LocalBookmark): Promise<void> {
    if (!this.deps.isOnline()) {
      await this.queue(bookmark);
      return;
    }
    try {
      const res = await this.deps.create({ clientEventId: bookmark.clientEventId, lessonId: bookmark.lessonId, positionMs: bookmark.positionMs, note: bookmark.note, segmentId: bookmark.segmentId });
      await this.deps.store.remove(BOOKMARKS_COLLECTION, key(bookmark.lessonId, bookmark.clientEventId));
      await this.save({ ...bookmark, id: res.id, createdAt: res.createdAt, sync: 'synced' });
    } catch (error) {
      if (this.deps.isConnectivityError(error)) await this.queue(bookmark);
      else {
        // Segment-anchored bookmarks the server rejects (unknown segment) are retried without the anchor.
        if (bookmark.segmentId) {
          const fallback = { ...bookmark, segmentId: null };
          await this.save(fallback);
          await this.push(fallback);
        }
      }
    }
  }

  private async queue(bookmark: LocalBookmark): Promise<void> {
    if (bookmark.sync === 'queued') return;
    // The outbox payload has no segment anchor; the local record keeps it for the UI.
    await this.deps.enqueueOutbox({ type: 'bookmark_created', lessonId: bookmark.lessonId, positionMs: bookmark.positionMs, note: bookmark.note });
    await this.save({ ...bookmark, sync: 'queued' });
  }

  /** Retry pending (not yet queued or synced) bookmarks after reconnect. */
  async flushPending(): Promise<void> {
    const docs = await this.deps.store.list<LocalBookmark>(BOOKMARKS_COLLECTION);
    for (const d of docs) if (d.doc.sync === 'pending') await this.push(d.doc);
  }

  /** Merge the server's bookmark list for a lesson (adds ones created on other devices). */
  async mergeServer(lessonId: string, server: readonly { id: string; positionMs: number; note: string | null }[]): Promise<LocalBookmark[]> {
    const local = await this.list(lessonId);
    const known = new Set(local.map((b) => b.id));
    for (const s of server) {
      if (known.has(s.id)) continue;
      // Pending local bookmarks at the same position are the same bookmark coming back under its server id.
      const twin = local.find((b) => b.sync !== 'synced' && b.positionMs === s.positionMs && (b.note ?? null) === (s.note ?? null));
      if (twin) {
        await this.deps.store.remove(BOOKMARKS_COLLECTION, key(lessonId, twin.clientEventId));
        await this.save({ ...twin, id: s.id, sync: 'synced' });
        continue;
      }
      await this.save({ id: s.id, clientEventId: s.id, lessonId, positionMs: s.positionMs, note: s.note, segmentId: null, expressionText: null, expressionTranslation: null, createdAt: this.deps.now(), sync: 'synced' });
    }
    return this.list(lessonId);
  }

  async removeLocal(lessonId: string, id: string): Promise<void> {
    const docs = await this.list(lessonId);
    const b = docs.find((x) => x.id === id || x.clientEventId === id);
    if (b) await this.deps.store.remove(BOOKMARKS_COLLECTION, key(lessonId, b.sync === 'synced' ? b.id : b.clientEventId));
  }

  private save(bookmark: LocalBookmark): Promise<void> {
    return this.deps.store.put(BOOKMARKS_COLLECTION, key(bookmark.lessonId, bookmark.sync === 'synced' ? bookmark.id : bookmark.clientEventId), bookmark, Date.parse(bookmark.createdAt));
  }
}
