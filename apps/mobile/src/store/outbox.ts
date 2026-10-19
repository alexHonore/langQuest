/**
 * Progress-event outbox (§4.5): every learner action that must reach the
 * server is recorded locally first with an immutable client UUID and a
 * monotonic per-device revision, then synced in batches. Replaying the same
 * events after a crash or a lost response is safe because the server dedupes
 * on `clientEventId` (CONVENTIONS §3 idempotency) and the client treats
 * `duplicate`/`superseded` exactly like `applied`.
 */
import type { ProgressEventPayload, ProgressSyncEvent, ProgressSyncRequest, ProgressSyncResponse } from '@langquest/contracts';
import type { DocumentStore } from './document-store';

export const OUTBOX_COLLECTION = 'outbox';
export const OUTBOX_META_COLLECTION = 'outbox_meta';
const META_ID = 'state';

export interface OutboxEntry {
  event: ProgressSyncEvent;
  /** Attempts so far (for diagnostics / backoff). */
  attempts: number;
  /** Set when the server rejected the event; kept for inspection, never retried. */
  rejectedReason: string | null;
  /** Server resolution once acknowledged. */
  resolution: ProgressSyncResponse['results'][number]['resolution'] | null;
  enqueuedAt: string;
  /**
   * Device-wide enqueue sequence: the delivery order. Equals `event.revision` unless the caller
   * supplied its own revision (entries written before this field existed fall back to `event.revision`).
   */
  seq?: number;
}

/** Caller-controlled identity for an event (see `Outbox.enqueue`). */
export interface EnqueueOptions {
  /**
   * Reuse an id the caller already sent through another path (e.g. the audio `PUT` whose response was
   * lost): the server dedupes on it, so the replay can never double-apply. Enqueueing an id that is
   * already queued is a no-op returning the queued event.
   */
  clientEventId?: string;
  /**
   * Revision in the server's conflict-resolution space for this event type. `audio_progress` is
   * compared per lesson and per device by the server, so it must carry the lesson revision, not the
   * outbox's device-wide counter. Defaults to the device-wide counter.
   */
  revision?: number;
}

export interface OutboxMeta {
  deviceId: string;
  /** Last revision handed out on this device. */
  revision: number;
  /** Server watermark returned by the last successful sync. */
  serverRevision: number;
  estimatedClockSkewMs: number;
  lastSyncAt: string | null;
}

export interface OutboxDeps {
  store: DocumentStore;
  newId: () => string;
  now: () => string;
  /** Stable device id (generated once and persisted by the caller). */
  deviceId: string;
}

export interface FlushResult {
  sent: number;
  applied: number;
  duplicates: number;
  rejected: number;
  /** True when a network/API failure stopped the flush; remaining events stay queued. */
  failed: boolean;
  error: unknown;
}

export class Outbox {
  private metaCache: OutboxMeta | null = null;
  private flushing: Promise<FlushResult> | null = null;
  constructor(private readonly deps: OutboxDeps) {}

  async meta(): Promise<OutboxMeta> {
    if (this.metaCache) return this.metaCache;
    const stored = await this.deps.store.get<OutboxMeta>(OUTBOX_META_COLLECTION, META_ID);
    this.metaCache = stored ?? { deviceId: this.deps.deviceId, revision: 0, serverRevision: 0, estimatedClockSkewMs: 0, lastSyncAt: null };
    return this.metaCache;
  }

  private async saveMeta(patch: Partial<OutboxMeta>): Promise<OutboxMeta> {
    const next = { ...(await this.meta()), ...patch };
    this.metaCache = next;
    await this.deps.store.put(OUTBOX_META_COLLECTION, META_ID, next);
    return next;
  }

  /**
   * Record an event locally. Returns the stored event (with its client UUID and revision).
   * The device-wide counter always advances and orders delivery; `options` lets a caller pin the
   * event id and/or the revision the server compares (see `EnqueueOptions`).
   */
  async enqueue(payload: ProgressEventPayload, enrollmentId: string | null, occurredAt?: string, options: EnqueueOptions = {}): Promise<ProgressSyncEvent> {
    if (options.clientEventId) {
      const queued = await this.deps.store.get<OutboxEntry>(OUTBOX_COLLECTION, options.clientEventId);
      if (queued) return queued.event;
    }
    const meta = await this.meta();
    const seq = meta.revision + 1;
    const event: ProgressSyncEvent = {
      clientEventId: options.clientEventId ?? this.deps.newId(),
      enrollmentId,
      deviceId: meta.deviceId,
      revision: options.revision ?? seq,
      occurredAt: occurredAt ?? this.deps.now(),
      payload,
    };
    const entry: OutboxEntry = { event, attempts: 0, rejectedReason: null, resolution: null, enqueuedAt: this.deps.now(), seq };
    await this.deps.store.put(OUTBOX_COLLECTION, event.clientEventId, entry, seq);
    await this.saveMeta({ revision: seq });
    return event;
  }

  private sortKey(entry: OutboxEntry): number {
    return entry.seq ?? entry.event.revision;
  }

  /** Events still waiting to be acknowledged (oldest first). */
  async pending(limit?: number): Promise<OutboxEntry[]> {
    const all = await this.deps.store.list<OutboxEntry>(OUTBOX_COLLECTION, { order: 'asc' });
    const pending = all.map((d) => d.doc).filter((e) => e.resolution === null && e.rejectedReason === null);
    return limit !== undefined ? pending.slice(0, limit) : pending;
  }

  async pendingCount(): Promise<number> {
    return (await this.pending()).length;
  }

  /** Rejected events kept for diagnostics. */
  async rejected(): Promise<OutboxEntry[]> {
    const all = await this.deps.store.list<OutboxEntry>(OUTBOX_COLLECTION);
    return all.map((d) => d.doc).filter((e) => e.rejectedReason !== null);
  }

  /**
   * Send pending events in batches (max 100 per request) through `send`.
   * Acknowledged events are removed; rejected ones are kept with the reason;
   * on failure everything not yet acknowledged stays queued for the next flush.
   * Concurrent calls share one in-flight flush.
   */
  flush(send: (request: ProgressSyncRequest) => Promise<ProgressSyncResponse>, batchSize = 100): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush(send, batchSize).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(send: (request: ProgressSyncRequest) => Promise<ProgressSyncResponse>, batchSize: number): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, applied: 0, duplicates: 0, rejected: 0, failed: false, error: null };
    const meta = await this.meta();
    while (true) {
      const batch = await this.pending(batchSize);
      if (batch.length === 0) break;
      for (const entry of batch) {
        entry.attempts += 1;
        await this.deps.store.put(OUTBOX_COLLECTION, entry.event.clientEventId, entry, this.sortKey(entry));
      }
      let response: ProgressSyncResponse;
      try {
        response = await send({ deviceId: meta.deviceId, clientSentAt: this.deps.now(), events: batch.map((e) => e.event) });
      } catch (error) {
        result.failed = true;
        result.error = error;
        break;
      }
      result.sent += batch.length;
      const byId = new Map(batch.map((e) => [e.event.clientEventId, e] as const));
      for (const r of response.results) {
        const entry = byId.get(r.clientEventId);
        if (!entry) continue;
        if (r.resolution === 'rejected') {
          result.rejected += 1;
          entry.rejectedReason = r.reason ?? 'rejected';
          entry.resolution = 'rejected';
          await this.deps.store.put(OUTBOX_COLLECTION, entry.event.clientEventId, entry, this.sortKey(entry));
        } else {
          if (r.resolution === 'applied') result.applied += 1;
          else result.duplicates += 1;
          await this.deps.store.remove(OUTBOX_COLLECTION, entry.event.clientEventId);
        }
        byId.delete(r.clientEventId);
      }
      // Events the server did not mention stay pending (sent again next time; dedupe makes that safe).
      await this.saveMeta({ serverRevision: Math.max(meta.serverRevision, response.serverRevision), estimatedClockSkewMs: response.estimatedClockSkewMs, lastSyncAt: this.deps.now() });
      if (byId.size > 0 && batch.length === byId.size) break; // nothing acknowledged → avoid a hot loop
    }
    return result;
  }

  /** Drop everything (sign-out). */
  async clear(): Promise<void> {
    await this.deps.store.clear(OUTBOX_COLLECTION);
    await this.deps.store.clear(OUTBOX_META_COLLECTION);
    this.metaCache = null;
  }
}
