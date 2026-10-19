/**
 * `POST /v1/conversations/:id/turn` replay semantics (contracts `ROUTES.conversationTurn`): a turn whose
 * `clientTurnId` is still being processed answers `turn_in_progress` (409) with `Retry-After` seconds and
 * `details.retryAfterSeconds`. The client must retry the SAME `clientTurnId` after that delay — never mint a
 * new id (that would run the LLM twice for one learner utterance). Pure TS so it is unit-tested.
 */

export interface TurnInProgressRetryOptions {
  /** Upper bound on the total time spent waiting on 409s before the error is surfaced (default 60 s). */
  maxWaitMs?: number;
  /** Delay used when the server sent neither `Retry-After` nor `details.retryAfterSeconds` (default 2 s). */
  defaultDelayMs?: number;
  /** Longest single wait (default 30 s, matching the API's own `Retry-After` cap). */
  maxDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const isTurnInProgress = (error: unknown): error is { kind: 'turn_in_progress'; retryAfterMs: number | null } => {
  const e = error as { kind?: unknown } | null;
  return Boolean(e && e.kind === 'turn_in_progress');
};

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const abortError = (): Error => {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

/**
 * Run `send()` (the SAME request body every time) until it succeeds or fails for another reason. Each
 * `turn_in_progress` answer waits `retryAfterMs` (header or details), bounded by `maxDelayMs`, until
 * `maxWaitMs` of waiting has accumulated; then the last 409 is thrown so the UI can offer a manual retry
 * (which re-sends the same id again).
 */
export async function retryWhileTurnInProgress<T>(send: () => Promise<T>, options: TurnInProgressRetryOptions = {}): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const defaultDelayMs = options.defaultDelayMs ?? 2_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? abortableSleep;
  let waited = 0;
  while (true) {
    try {
      return await send();
    } catch (error) {
      if (!isTurnInProgress(error) || options.signal?.aborted) throw error;
      const suggested = error.retryAfterMs !== null && error.retryAfterMs > 0 ? error.retryAfterMs : defaultDelayMs;
      const delay = Math.min(maxDelayMs, suggested);
      if (waited + delay > maxWaitMs) throw error;
      waited += delay;
      await sleep(delay, options.signal);
    }
  }
}
