/**
 * Domain event dispatcher (§6.4): at-least-once delivery with idempotent handlers.
 *
 * - In-process handlers (cache invalidation, logging) run immediately, deduplicated per isolate by
 *   `idempotencyKey`; every handler is written to be safe on replay.
 * - Events that imply background work (`EVENT_JOB_HINTS`: upload.finalized → verify, asset.verified →
 *   extract_metadata, transcode.requested → transcode) are persisted as `processing_jobs` rows through the
 *   idempotent `enqueue_processing_job` RPC (ADR-005, default `JOBS_BACKEND=postgres`). With
 *   `JOBS_BACKEND=cloudflare_queues` and a bound `JOBS_QUEUE`, the job id is additionally pushed to the queue
 *   so a consumer can wake the same handlers without polling.
 */
import { EVENT_JOB_HINTS, createDomainEvent, type DomainEvent, type DomainEventPayload, type DomainEventType } from '@langquest/contracts';
import type { ProcessingJobsRepository } from '@langquest/db/repositories/uploads-jobs';
import type { QueueLike } from '../env';
import type { Logger } from '../middleware/logging';

export type EventHandler<T extends DomainEventType = DomainEventType> = (event: Extract<DomainEvent, { type: T }>) => Promise<void> | void;

export interface DispatcherDeps {
  jobs: ProcessingJobsRepository;
  queue?: QueueLike | null;
  backend: 'postgres' | 'cloudflare_queues';
  log: Logger;
  /** Defer work past the response (Worker `ctx.waitUntil`). */
  waitUntil: (p: Promise<unknown>) => void;
  now?: () => Date;
  newId?: () => string;
}

export interface EventDispatcher {
  on<T extends DomainEventType>(type: T, handler: EventHandler<T>): void;
  /** Build + emit; returns the event (already validated). */
  emit<T extends DomainEventType>(type: T, payload: DomainEventPayload<T>, meta: { idempotencyKey: string; traceId?: string | null }): Promise<Extract<DomainEvent, { type: T }>>;
  /** Emit an already built event. */
  dispatch(event: DomainEvent): Promise<void>;
}

export function createEventDispatcher(deps: DispatcherDeps): EventDispatcher {
  const handlers = new Map<DomainEventType, EventHandler[]>();
  const seen = new Set<string>();
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  const persist = async (event: DomainEvent): Promise<void> => {
    const jobType = EVENT_JOB_HINTS[event.type];
    if (!jobType) return;
    const payload = event.payload as Record<string, unknown>;
    const parentAssetId = typeof payload.assetId === 'string' ? payload.assetId : null;
    const job = await deps.jobs.enqueue({
      jobType,
      idempotencyKey: `event:${event.type}:${event.idempotencyKey}`,
      params: { event },
      parentAssetId,
      priority: 5,
      requestedBy: null,
    });
    if (deps.backend === 'cloudflare_queues' && deps.queue) {
      await deps.queue.send({ jobId: job.id, jobType, eventType: event.type, eventId: event.eventId });
    }
  };

  const run = async (event: DomainEvent): Promise<void> => {
    if (seen.has(event.idempotencyKey)) {
      deps.log.debug('events.duplicate', { type: event.type, idempotencyKey: event.idempotencyKey });
    } else {
      if (seen.size > 5000) seen.clear();
      seen.add(event.idempotencyKey);
      for (const h of handlers.get(event.type) ?? []) {
        try {
          await h(event as never);
        } catch (error) {
          deps.log.error('events.handler_failed', { type: event.type, error });
        }
      }
    }
    try {
      await persist(event);
    } catch (error) {
      deps.log.error('events.persist_failed', { type: event.type, error });
    }
    deps.log.info('events.emitted', { type: event.type, eventId: event.eventId, idempotencyKey: event.idempotencyKey });
  };

  return {
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler as unknown as EventHandler]);
    },
    async emit(type, payload, meta) {
      const event = createDomainEvent(type, payload, { eventId: newId(), idempotencyKey: meta.idempotencyKey, occurredAt: now().toISOString(), producer: 'api', traceId: meta.traceId ?? null });
      deps.waitUntil(run(event));
      return event;
    },
    async dispatch(event) {
      deps.waitUntil(run(event));
    },
  };
}
