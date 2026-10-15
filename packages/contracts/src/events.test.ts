import { describe, expect, it } from 'vitest';
import { DOMAIN_EVENT_TYPES, DomainEventSchema, createDomainEvent, type DomainEvent } from './events';

const uuid = '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d';
const at = '2026-10-14T10:00:00.000Z';
const meta = { eventId: uuid, idempotencyKey: 'review.due:abc', occurredAt: at, producer: 'api' as const };

describe('DomainEventSchema', () => {
  it('lists the ten §6.4 event types', () => {
    expect(DOMAIN_EVENT_TYPES).toHaveLength(10);
    expect(DOMAIN_EVENT_TYPES).toContain('manifest.invalidated');
  });

  it('discriminates on type and narrows the payload', () => {
    const event = createDomainEvent('review.due', { userId: uuid, enrollmentId: uuid, cardIds: [uuid], dueAt: at, notify: true }, meta);
    expect(event.type).toBe('review.due');
    expect(event.payload.cardIds).toHaveLength(1);
    const generic: DomainEvent = event;
    if (generic.type === 'review.due') expect(generic.payload.notify).toBe(true);
    else throw new Error('should narrow');
  });

  it('rejects a payload from a different event type', () => {
    const bad = { ...meta, schemaVersion: 1, traceId: null, type: 'upload.finalized', payload: { userId: uuid } };
    expect(DomainEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown event types and missing idempotency keys', () => {
    expect(DomainEventSchema.safeParse({ ...meta, schemaVersion: 1, traceId: null, type: 'billing.charged', payload: {} }).success).toBe(false);
    const { idempotencyKey: _k, ...noKey } = meta;
    expect(DomainEventSchema.safeParse({ ...noKey, schemaVersion: 1, traceId: null, type: 'review.due', payload: { userId: uuid, enrollmentId: uuid, cardIds: [uuid], dueAt: at, notify: false } }).success).toBe(false);
  });

  it('manifest.invalidated supports all-sources invalidation', () => {
    const event = createDomainEvent('manifest.invalidated', { kind: 'course', courseTrackId: 'french', collectionId: null, sourceLanguageCode: null, newVersion: 4, reason: 'published' }, meta);
    expect(event.payload.sourceLanguageCode).toBeNull();
  });
});
