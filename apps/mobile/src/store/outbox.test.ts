import type { ProgressSyncRequest, ProgressSyncResponse } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from './document-store';
import { Outbox } from './outbox';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const enrollment = uuid(999);

function makeOutbox() {
  let ids = 0;
  let t = 0;
  const store = new MemoryDocumentStore();
  const outbox = new Outbox({ store, newId: () => uuid(++ids), now: () => new Date(1_700_000_000_000 + ++t * 1000).toISOString(), deviceId: 'device-1' });
  return { store, outbox };
}

const applyAll = (resolution: 'applied' | 'duplicate' = 'applied') =>
  vi.fn(async (req: ProgressSyncRequest): Promise<ProgressSyncResponse> => ({
    results: req.events.map((e) => ({ clientEventId: e.clientEventId, resolution, reason: null, xpCredited: null, card: null })),
    serverTime: new Date().toISOString(),
    estimatedClockSkewMs: 0,
    serverRevision: req.events[req.events.length - 1]?.revision ?? 0,
  }));

describe('Outbox', () => {
  it('assigns immutable client ids and monotonic revisions', async () => {
    const { outbox } = makeOutbox();
    const a = await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    const b = await outbox.enqueue({ type: 'activity_minutes', activityDate: '2026-10-14', minutesActive: 5, speakingSeconds: 60 }, enrollment);
    expect(a.clientEventId).not.toBe(b.clientEventId);
    expect(b.revision).toBe(a.revision + 1);
    expect(a.deviceId).toBe('device-1');
    expect(await outbox.pendingCount()).toBe(2);
  });

  it('lets a caller pin the event id and revision without disturbing delivery order', async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    const audio = { type: 'audio_progress' as const, lessonId: uuid(7), positionMs: 1000, durationMs: null, completed: false };
    const pinned = await outbox.enqueue(audio, null, '2026-10-19T10:00:00.000Z', { clientEventId: uuid(500), revision: 3 });
    expect(pinned).toMatchObject({ clientEventId: uuid(500), revision: 3, occurredAt: '2026-10-19T10:00:00.000Z' });
    const later = await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    expect(later.revision).toBe(3); // the device-wide counter kept advancing underneath the pinned revision
    expect((await outbox.pending()).map((e) => e.event.clientEventId)).toEqual([uuid(1), uuid(500), uuid(2)]);
    // Re-enqueueing an id that is already queued is idempotent.
    const again = await outbox.enqueue({ ...audio, positionMs: 9999 }, null, undefined, { clientEventId: uuid(500) });
    expect(again.payload).toMatchObject({ positionMs: 1000 });
    expect(await outbox.pendingCount()).toBe(3);
    const send = applyAll();
    await outbox.flush(send);
    expect(send.mock.calls[0]?.[0].events.map((e) => e.revision)).toEqual([1, 3, 3]);
  });

  it('flushes in order, removes acknowledged events and records the server watermark', async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    await outbox.enqueue({ type: 'xp_claim', reason: 'mission_completed', referenceId: uuid(5), amount: 0 }, enrollment);
    const send = applyAll();
    const result = await outbox.flush(send);
    expect(result).toMatchObject({ sent: 2, applied: 2, duplicates: 0, rejected: 0, failed: false });
    expect(send.mock.calls[0]?.[0].events.map((e) => e.revision)).toEqual([1, 2]);
    expect(await outbox.pendingCount()).toBe(0);
    expect((await outbox.meta()).serverRevision).toBe(2);
  });

  it('keeps events queued when the network fails and replays the SAME client ids afterwards (idempotent replay)', async () => {
    const { outbox } = makeOutbox();
    const first = await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    const failed = await outbox.flush(failing);
    expect(failed.failed).toBe(true);
    expect(await outbox.pendingCount()).toBe(1);

    const send = applyAll('duplicate'); // server already applied it before the response was lost
    const ok = await outbox.flush(send);
    expect(ok).toMatchObject({ sent: 1, applied: 0, duplicates: 1, failed: false });
    expect(send.mock.calls[0]?.[0].events[0]?.clientEventId).toBe(first.clientEventId);
    expect(await outbox.pendingCount()).toBe(0);
    expect((await outbox.pending()).length).toBe(0);
  });

  it('keeps rejected events for diagnostics without retrying them', async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: 'xp_claim', reason: 'achievement', referenceId: null, amount: 0 }, enrollment);
    const send = vi.fn(async (req: ProgressSyncRequest): Promise<ProgressSyncResponse> => ({
      results: req.events.map((e) => ({ clientEventId: e.clientEventId, resolution: 'rejected' as const, reason: 'xp_claim must reference an owned attempt', xpCredited: 0, card: null })),
      serverTime: new Date().toISOString(),
      estimatedClockSkewMs: -120,
      serverRevision: 1,
    }));
    const result = await outbox.flush(send);
    expect(result.rejected).toBe(1);
    expect(await outbox.pendingCount()).toBe(0);
    expect((await outbox.rejected())[0]?.rejectedReason).toContain('owned attempt');
    await outbox.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await outbox.meta()).estimatedClockSkewMs).toBe(-120);
  });

  it('batches large queues and shares one in-flight flush between concurrent callers', async () => {
    const { outbox } = makeOutbox();
    for (let i = 0; i < 7; i++) await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: enrollment }, enrollment);
    const send = applyAll();
    const [a, b] = await Promise.all([outbox.flush(send, 3), outbox.flush(send, 3)]);
    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((c) => c[0].events.length)).toEqual([3, 3, 1]);
    expect(await outbox.pendingCount()).toBe(0);
  });
});
