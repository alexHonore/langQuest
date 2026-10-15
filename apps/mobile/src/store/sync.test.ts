import type { ProgressSyncRequest, ProgressSyncResponse } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from './document-store';
import { Outbox } from './outbox';
import { SyncEngine } from './sync';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(online = true) {
  let ids = 0;
  const outbox = new Outbox({ store: new MemoryDocumentStore(), newId: () => uuid(++ids), now: () => '2026-10-14T10:00:00.000Z', deviceId: 'd' });
  const timers: { fn: () => void; ms: number }[] = [];
  let state = { online };
  const send = vi.fn(async (req: ProgressSyncRequest): Promise<ProgressSyncResponse> => ({
    results: req.events.map((e) => ({ clientEventId: e.clientEventId, resolution: 'applied' as const, reason: null, xpCredited: null, card: null })),
    serverTime: '2026-10-14T10:00:01.000Z',
    estimatedClockSkewMs: 0,
    serverRevision: 1,
  }));
  const engine = new SyncEngine({
    outbox,
    send,
    isOnline: () => state.online,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    baseDelayMs: 1000,
  });
  return { outbox, engine, send, timers, setOnline: (v: boolean) => (state = { online: v }) };
}

describe('SyncEngine', () => {
  it('reports offline and keeps events queued until reconnect', async () => {
    const { outbox, engine, send, timers, setOnline } = setup(false);
    const statuses: string[] = [];
    engine.subscribe((s) => statuses.push(s));
    await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: uuid(1) }, uuid(1));
    expect(await engine.syncNow()).toBeNull();
    expect(statuses).toEqual(['offline']);
    expect(send).not.toHaveBeenCalled();

    setOnline(true);
    engine.onReconnect();
    expect(timers.at(-1)?.ms).toBe(500);
    timers.at(-1)!.fn();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await outbox.pendingCount()).toBe(0));
  });

  it('backs off exponentially after failures and recovers', async () => {
    const { outbox, engine, send, timers } = setup(true);
    send.mockRejectedValueOnce(new Error('503')).mockRejectedValueOnce(new Error('503'));
    await outbox.enqueue({ type: 'enrollment_opened', enrollmentId: uuid(1) }, uuid(1));
    expect((await engine.syncNow())?.failed).toBe(true);
    expect(timers.at(-1)?.ms).toBe(1000);
    expect((await engine.syncNow())?.failed).toBe(true);
    expect(timers.at(-1)?.ms).toBe(2000);
    expect((await engine.syncNow())?.failed).toBe(false);
    expect(engine.currentStatus).toBe('idle');
    expect(await outbox.pendingCount()).toBe(0);
  });
});
