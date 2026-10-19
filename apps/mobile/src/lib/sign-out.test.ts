import { describe, expect, it, vi } from 'vitest';
import { prepareSignOut } from './sign-out';

describe('prepareSignOut', () => {
  it('flushes the outbox before reporting what would be lost', async () => {
    let pending = 3;
    const syncNow = vi.fn(async () => {
      pending = 0;
    });
    const res = await prepareSignOut({ syncNow, pendingCount: async () => pending });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ pending: 0, flushFailed: false });
  });

  it('reports the remaining count when the flush fails or the device is offline', async () => {
    const res = await prepareSignOut({ syncNow: async () => { throw new Error('offline'); }, pendingCount: async () => 2 });
    expect(res).toEqual({ pending: 2, flushFailed: true });
  });
});
