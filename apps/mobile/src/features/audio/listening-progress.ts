/**
 * Listening progress (§4.5, §14.1 A23): every position update is written to
 * the local store first (so "continue listening" and resume work offline),
 * then pushed with an idempotent `PUT /v1/me/audio-progress/:lessonId`. When
 * the device is offline or the PUT fails on connectivity, the same event
 * (same `clientEventId`, same per-lesson `revision`) is queued in the progress
 * outbox as an `audio_progress` event so it syncs later without double-applying.
 *
 * Conflict model (mirrors `apply_audio_progress` on the server): the revision
 * is a per-lesson, per-device counter, so the server only compares it against
 * the last write from THIS device; across devices the skew-corrected event
 * time decides. A `superseded` answer therefore means another write is newer
 * and the device adopts the server's position (unless it has typed more since).
 */
import type { AudioProgressPutRequestSchema, AudioProgressPutResponseSchema, ProgressEventPayload } from '@langquest/contracts';
import type { z } from 'zod';
import type { DocumentStore } from '@/store/document-store';

export type AudioProgressPutRequest = z.infer<typeof AudioProgressPutRequestSchema>;
export type AudioProgressPutResponse = z.infer<typeof AudioProgressPutResponseSchema>;

export const LISTENING_PROGRESS_COLLECTION = 'audio_positions';

export interface ListeningItemMeta {
  title: string;
  subtitle: string | null;
  collectionId: string;
  chapterId: string;
  artworkUri: string | null;
  courseTrackId: string | null;
}

export interface LocalListeningProgress {
  lessonId: string;
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
  /** Per-lesson monotonic revision for this device. */
  revision: number;
  /** Highest revision acknowledged by the server. */
  syncedRevision: number;
  /** Stable id of the unsynced update (reused until acknowledged → idempotent replay). */
  pendingClientEventId: string | null;
  /** True once the pending event has been handed to the outbox (avoid double queueing). */
  queuedInOutbox: boolean;
  updatedAt: string;
  lastPlayedAt: string;
  meta: ListeningItemMeta;
}

export interface ListeningProgressDeps {
  store: DocumentStore;
  deviceId: string;
  newId: () => string;
  now: () => string;
  put: (lessonId: string, body: AudioProgressPutRequest) => Promise<AudioProgressPutResponse>;
  /**
   * Queue an outbox event (used when the PUT cannot reach the server). `options` carries the identity the
   * PUT would have sent: the pending `clientEventId` (server-side dedupe if the PUT did land) and the
   * per-lesson `revision` the server compares per device — never the outbox's device-wide counter.
   */
  enqueueOutbox: (payload: ProgressEventPayload, options: { clientEventId: string; revision: number; occurredAt: string }) => Promise<unknown>;
  isOnline: () => boolean;
  /** Classify a PUT error: connectivity errors fall back to the outbox, others are dropped (logged). */
  isConnectivityError: (error: unknown) => boolean;
  /** Minimum time between server PUTs for the same lesson (default 15 s); the final pause/stop always flushes. */
  throttleMs?: number;
}

export class ListeningProgressSync {
  private readonly lastPutAt = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();
  constructor(private readonly deps: ListeningProgressDeps) {}

  get(lessonId: string): Promise<LocalListeningProgress | null> {
    return this.deps.store.get<LocalListeningProgress>(LISTENING_PROGRESS_COLLECTION, lessonId);
  }

  /** Most recently played lessons that are not finished ("continue listening"). */
  async continueListening(limit = 10): Promise<LocalListeningProgress[]> {
    const docs = await this.deps.store.list<LocalListeningProgress>(LISTENING_PROGRESS_COLLECTION, { order: 'desc' });
    return docs
      .map((d) => d.doc)
      .filter((p) => !p.completed && p.positionMs > 0)
      .slice(0, limit);
  }

  async listAll(): Promise<LocalListeningProgress[]> {
    return (await this.deps.store.list<LocalListeningProgress>(LISTENING_PROGRESS_COLLECTION, { order: 'desc' })).map((d) => d.doc);
  }

  /**
   * Record a position. Writes locally immediately; pushes to the server
   * (throttled unless `flush`), falling back to the outbox on connectivity loss.
   */
  async record(input: { lessonId: string; positionMs: number; durationMs: number | null; completed: boolean; meta: ListeningItemMeta }, options: { flush?: boolean } = {}): Promise<LocalListeningProgress> {
    const existing = await this.get(input.lessonId);
    const now = this.deps.now();
    const revision = (existing?.revision ?? 0) + 1;
    const record: LocalListeningProgress = {
      lessonId: input.lessonId,
      positionMs: Math.max(0, Math.round(input.positionMs)),
      durationMs: input.durationMs,
      completed: input.completed,
      revision,
      syncedRevision: existing?.syncedRevision ?? 0,
      pendingClientEventId: existing?.pendingClientEventId ?? this.deps.newId(),
      queuedInOutbox: false,
      updatedAt: now,
      lastPlayedAt: now,
      meta: input.meta,
    };
    await this.save(record);
    void this.push(input.lessonId, Boolean(options.flush));
    return record;
  }

  /**
   * Push the pending update for a lesson (deduplicated per lesson). When newer local writes landed
   * while a PUT was in flight, they are pushed right after it (once the in-flight slot is free).
   */
  push(lessonId: string, flush: boolean): Promise<void> {
    const pending = this.inflight.get(lessonId);
    if (pending) return pending;
    const p = this.doPush(lessonId, flush)
      .finally(() => this.inflight.delete(lessonId))
      .then((again) => (again ? this.push(lessonId, true) : undefined));
    this.inflight.set(lessonId, p);
    return p;
  }

  /** Returns true when a newer local write is still pending and must be pushed again. */
  private async doPush(lessonId: string, flush: boolean): Promise<boolean> {
    const record = await this.get(lessonId);
    if (!record || record.pendingClientEventId === null || record.revision <= record.syncedRevision) return false;
    const nowMs = Date.parse(this.deps.now());
    const last = this.lastPutAt.get(lessonId) ?? 0;
    const throttle = this.deps.throttleMs ?? 15_000;
    if (!flush && nowMs - last < throttle) return false;
    if (!this.deps.isOnline()) {
      await this.queueInOutbox(record);
      return false;
    }
    this.lastPutAt.set(lessonId, nowMs);
    const body: AudioProgressPutRequest = {
      clientEventId: record.pendingClientEventId,
      deviceId: this.deps.deviceId,
      revision: record.revision,
      positionMs: record.positionMs,
      durationMs: record.durationMs,
      completed: record.completed,
      occurredAt: record.updatedAt,
    };
    try {
      const response = await this.deps.put(lessonId, body);
      const latest = await this.get(lessonId);
      if (!latest) return false;
      // Newer local writes since we sent → keep them pending under a fresh event id.
      const stillDirty = latest.revision > record.revision;
      if (response.resolution === 'superseded' && !stillDirty) {
        // Another write (other device, or an older counter of ours the server already saw) is newer:
        // the server's position is the truth. Lifting our revision to the server's keeps a same-device
        // counter that fell behind from being superseded forever.
        const revision = Math.max(latest.revision, response.revision);
        await this.save({ ...latest, positionMs: response.positionMs, completed: latest.completed || response.completed, revision, syncedRevision: revision, pendingClientEventId: null, queuedInOutbox: false, updatedAt: this.deps.now() });
        return false;
      }
      const revision = response.resolution === 'superseded' ? Math.max(latest.revision, response.revision) : latest.revision;
      await this.save({ ...latest, revision, syncedRevision: Math.max(latest.syncedRevision, record.revision), pendingClientEventId: stillDirty ? this.deps.newId() : null, queuedInOutbox: false });
      return stillDirty;
    } catch (error) {
      if (this.deps.isConnectivityError(error)) {
        const latest = (await this.get(lessonId)) ?? record;
        await this.queueInOutbox(latest);
      }
      // Validation/rejection errors are not retried: the local position stays authoritative on-device.
      return false;
    }
  }

  private async queueInOutbox(record: LocalListeningProgress): Promise<void> {
    if (record.queuedInOutbox || record.pendingClientEventId === null) return;
    await this.deps.enqueueOutbox(
      { type: 'audio_progress', lessonId: record.lessonId, positionMs: record.positionMs, durationMs: record.durationMs, completed: record.completed },
      { clientEventId: record.pendingClientEventId, revision: record.revision, occurredAt: record.updatedAt },
    );
    // The outbox owns delivery now; the next local write starts a new pending event.
    await this.save({ ...record, queuedInOutbox: true, syncedRevision: record.revision, pendingClientEventId: null });
  }

  /** Flush every pending lesson (reconnect / app background). */
  async flushAll(): Promise<void> {
    const all = await this.listAll();
    await Promise.all(all.filter((p) => p.pendingClientEventId !== null && p.revision > p.syncedRevision).map((p) => this.push(p.lessonId, true)));
  }

  /**
   * Merge the server's copy (from `GET /v1/audio/lessons/:id`). The server
   * wins only when the device has nothing pending; otherwise the local
   * (newer, unsynced) position is kept.
   */
  async mergeServer(lessonId: string, server: { positionMs: number; completed: boolean; revision: number } | null, meta: ListeningItemMeta, durationMs: number | null): Promise<LocalListeningProgress | null> {
    const local = await this.get(lessonId);
    if (!server) return local;
    if (local && local.revision > local.syncedRevision) return local;
    if (local && local.positionMs === server.positionMs && local.completed === server.completed) return local;
    const merged: LocalListeningProgress = {
      lessonId,
      positionMs: server.positionMs,
      durationMs: durationMs ?? local?.durationMs ?? null,
      completed: server.completed,
      revision: local?.revision ?? 0,
      syncedRevision: local?.revision ?? 0,
      pendingClientEventId: null,
      queuedInOutbox: false,
      updatedAt: this.deps.now(),
      lastPlayedAt: local?.lastPlayedAt ?? this.deps.now(),
      meta,
    };
    await this.save(merged);
    return merged;
  }

  async remove(lessonId: string): Promise<void> {
    await this.deps.store.remove(LISTENING_PROGRESS_COLLECTION, lessonId);
  }

  private save(record: LocalListeningProgress): Promise<void> {
    return this.deps.store.put(LISTENING_PROGRESS_COLLECTION, record.lessonId, record, Date.parse(record.lastPlayedAt));
  }
}
