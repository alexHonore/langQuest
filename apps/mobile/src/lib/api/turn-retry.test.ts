import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, parseRetryAfter } from './client';
import { retryWhileTurnInProgress } from './turn-retry';

const inProgress = (retryAfterSeconds: number | null, headerMs: number | null = null): ApiClientError =>
  new ApiClientError('conversationTurn', 'turn_in_progress', 'still processing', 409, null, retryAfterSeconds === null ? { clientTurnId: 'c1' } : { clientTurnId: 'c1', retryAfterSeconds }, headerMs);

describe('retryWhileTurnInProgress (409 turn_in_progress → same clientTurnId)', () => {
  it('re-sends the same request after the server-suggested delay and returns the eventual reply', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw inProgress(null, 3_000); // Retry-After header
      if (calls === 2) throw inProgress(2); // details.retryAfterSeconds
      return { characterTurn: 'ok', replayed: true };
    });
    const res = await retryWhileTurnInProgress(send, { sleep: async (ms) => void sleeps.push(ms) });
    expect(res).toEqual({ characterTurn: 'ok', replayed: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([3_000, 2_000]);
  });

  it('falls back to the default delay when the server gave no hint and caps a single wait', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const send = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw inProgress(null);
      if (calls === 2) throw inProgress(90);
      return 'done';
    };
    await expect(retryWhileTurnInProgress(send, { sleep: async (ms) => void sleeps.push(ms), defaultDelayMs: 1_500, maxDelayMs: 10_000, maxWaitMs: 60_000 })).resolves.toBe('done');
    expect(sleeps).toEqual([1_500, 10_000]);
  });

  it('gives up with the last 409 once the total wait budget is exhausted', async () => {
    const send = vi.fn(async () => {
      throw inProgress(5);
    });
    await expect(retryWhileTurnInProgress(send, { sleep: async () => undefined, maxWaitMs: 12_000 })).rejects.toMatchObject({ kind: 'turn_in_progress' });
    // 5 s + 5 s fit in 12 s; the third would exceed it → 3 sends, 2 sleeps.
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not swallow other errors and stops when the caller aborts', async () => {
    const other = new ApiClientError('conversationTurn', 'validation_failed', 'bad', 422);
    await expect(retryWhileTurnInProgress(async () => { throw other; })).rejects.toBe(other);

    const controller = new AbortController();
    let calls = 0;
    const send = async (): Promise<string> => {
      calls += 1;
      controller.abort();
      throw inProgress(1);
    };
    await expect(retryWhileTurnInProgress(send, { signal: controller.signal, sleep: async () => undefined })).rejects.toMatchObject({ kind: 'turn_in_progress' });
    expect(calls).toBe(1);
  });
});

describe('ApiClientError.retryAfterMs', () => {
  it('prefers the Retry-After header and falls back to details.retryAfterSeconds', () => {
    expect(inProgress(2, 4_000).retryAfterMs).toBe(4_000);
    expect(inProgress(2).retryAfterMs).toBe(2_000);
    expect(inProgress(null).retryAfterMs).toBeNull();
  });
  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('garbage')).toBeNull();
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5_000);
  });
});
