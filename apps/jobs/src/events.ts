/**
 * Domain events emitted by the runner (§6.4): validated `DomainEvent`s with `producer: 'jobs'`, logged as
 * structured lines and — when auto-chaining is on — turned into follow-up jobs through
 * `EVENT_JOB_HINTS` (`asset.verified` → `extract_metadata`, …). Follow-ups are enqueued with a stable
 * idempotency key, so replays of the same event never create duplicate work (at-least-once delivery).
 */
import { EVENT_JOB_HINTS, createDomainEvent, type DomainEvent, type DomainEventPayload, type DomainEventType } from '@langquest/contracts';
import type { EnqueueJobInput } from '@langquest/db';
import type { Logger } from './logger';

export interface EventSink {
  publish(event: DomainEvent): Promise<void>;
}

export interface EventBusOptions {
  log: Logger;
  enqueue?: (input: EnqueueJobInput) => Promise<unknown>;
  autoChain?: boolean;
  sinks?: EventSink[];
  newId?: () => string;
  now?: () => string;
}

export class EventBus {
  readonly emitted: DomainEvent[] = [];
  private readonly log: Logger;
  private readonly enqueue: ((input: EnqueueJobInput) => Promise<unknown>) | null;
  private readonly autoChain: boolean;
  private readonly sinks: EventSink[];
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(options: EventBusOptions) {
    this.log = options.log;
    this.enqueue = options.enqueue ?? null;
    this.autoChain = options.autoChain ?? true;
    this.sinks = options.sinks ?? [];
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  build<T extends DomainEventType>(type: T, payload: DomainEventPayload<T>, idempotencyKey: string, traceId: string | null): DomainEvent {
    return createDomainEvent(type, payload, { eventId: this.newId(), idempotencyKey, occurredAt: this.now(), producer: 'jobs', traceId });
  }

  async emit<T extends DomainEventType>(type: T, payload: DomainEventPayload<T>, idempotencyKey: string, traceId: string | null = null, meta: { jobId?: string; requestedBy?: string | null } = {}): Promise<DomainEvent> {
    const event = this.build(type, payload, idempotencyKey, traceId);
    this.emitted.push(event);
    this.log.info('event', { type: event.type, idempotencyKey: event.idempotencyKey, eventId: event.eventId, traceId, payload: event.payload });
    for (const sink of this.sinks) {
      try {
        await sink.publish(event);
      } catch (error) {
        this.log.warn('event.sink_failed', { type: event.type, error });
      }
    }
    await this.chain(event, meta);
    return event;
  }

  /** Enqueue the follow-up job hinted for this event (idempotent on `${hint}:${idempotencyKey}`). */
  private async chain(event: DomainEvent, meta: { jobId?: string; requestedBy?: string | null }): Promise<void> {
    if (!this.autoChain || !this.enqueue) return;
    const hint = EVENT_JOB_HINTS[event.type];
    if (!hint) return;
    const assetId = 'assetId' in event.payload ? (event.payload as { assetId: string }).assetId : null;
    try {
      await this.enqueue({
        jobType: hint,
        idempotencyKey: `${hint}:${event.idempotencyKey}`,
        params: { sourceEventId: event.eventId, sourceEventType: event.type, sourceJobId: meta.jobId ?? null },
        parentAssetId: assetId,
        requestedBy: meta.requestedBy ?? null,
      });
      this.log.info('event.chained', { type: event.type, jobType: hint, assetId });
    } catch (error) {
      this.log.warn('event.chain_failed', { type: event.type, jobType: hint, error });
    }
  }
}
