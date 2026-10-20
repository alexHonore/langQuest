/**
 * Network guard for the stack-bound suites (CONVENTIONS §7: a test run never reaches a provider unless
 * `LANGQUEST_LIVE_TESTS=1`). Shared by the three stack harnesses: `packages/db/src/__tests__/stack.ts`,
 * `apps/api/src/__tests__/harness.ts` and `tests/src/harness/*` (imported as `@langquest/db/__tests__/network-guard`).
 *
 * - `installNetworkGuard()` wraps `globalThis.fetch` once per process. A request to any host other than the loopback
 *   names (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`) and the hosts registered with
 *   `allowNetworkHost()` (the local stack's own URL) is refused BEFORE it leaves the process and recorded.
 * - `guardFetch(base)` applies the same rule to a fetch handed to a component explicitly (the API harnesses pass it to
 *   `createApp`, whose AI, media and token-verifier clients use it).
 * - `registerNetworkGuardHooks(scope)` (called by each harness's `describeWithStack`) fails the test that made a
 *   blocked call (`afterEach`), and the file for a call made from `beforeAll` / `afterAll` (`afterAll`). The fetch
 *   itself rejects too, but a route may catch that and still answer, so the hooks are what make the test fail.
 *
 * Only the method, origin and path of a blocked call are kept (never headers, bodies or query strings).
 * With `LANGQUEST_LIVE_TESTS=1` nothing is blocked or recorded: live suites call real providers on purpose.
 */
import { afterAll, afterEach, expect } from 'vitest';

export const LIVE_TESTS_ENV = 'LANGQUEST_LIVE_TESTS';

export interface BlockedNetworkCall {
  method: string;
  /** `origin + pathname` of the refused request. */
  url: string;
  /** Vitest test that was running when the call was made (null in hooks / background work after a test). */
  test: string | null;
}

/** Thrown by a guarded fetch (and by `assertNoExternalNetwork`) for a request to a non-local host. */
export class ExternalNetworkError extends Error {
  override name = 'ExternalNetworkError';
}

interface GuardState {
  allowHosts: Set<string>;
  blocked: BlockedNetworkCall[];
}

// Kept on globalThis so every module instance in a worker (vitest re-evaluates modules per file) shares one record.
const STATE_KEY = Symbol.for('langquest.tests.networkGuard.state');
const GUARDED = Symbol.for('langquest.tests.networkGuard.guarded');

function guardState(): GuardState {
  const g = globalThis as unknown as Record<symbol, GuardState | undefined>;
  return (g[STATE_KEY] ??= { allowHosts: new Set<string>(), blocked: [] });
}

/** Live suites only: the same `=== '1'` gate the live tests use. */
export const externalNetworkAllowed = (): boolean => process.env[LIVE_TESTS_ENV] === '1';

const normaliseHost = (host: string): string => host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

/** Allow one more host (a URL or a bare host name), e.g. a local stack reached through a LAN name. */
export function allowNetworkHost(urlOrHost: string | null | undefined): void {
  if (!urlOrHost) return;
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    // a bare host name
  }
  if (host) guardState().allowHosts.add(normaliseHost(host));
}

/** True for loopback / local development names and for hosts registered with `allowNetworkHost`. */
export function isLocalHost(hostname: string): boolean {
  const host = normaliseHost(hostname);
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host) || guardState().allowHosts.has(host);
}

function targetOf(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null; // relative / malformed: the underlying fetch rejects it on its own
  }
}

function currentTestName(): string | null {
  try {
    return expect.getState().currentTestName ?? null;
  } catch {
    return null;
  }
}

const describeCall = (c: BlockedNetworkCall): string => `${c.method} ${c.url}${c.test ? ` (test: "${c.test}")` : ' (outside a test: hook or background work)'}`;

/** Wrap `base` so requests to non-local hosts are refused and recorded. Idempotent. */
export function guardFetch(base: typeof fetch): typeof fetch {
  if ((base as unknown as Record<symbol, unknown>)[GUARDED]) return base;
  const guarded = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = targetOf(input);
    if (url && /^(?:https?|wss?):$/.test(url.protocol) && !isLocalHost(url.hostname) && !externalNetworkAllowed()) {
      const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
      const call: BlockedNetworkCall = { method, url: `${url.origin}${url.pathname}`, test: currentTestName() };
      guardState().blocked.push(call);
      return Promise.reject(new ExternalNetworkError(`[network-guard] blocked ${describeCall(call)}: stack tests never leave the machine; use a fake (FakeReasoner / mockFetch) or run live suites with ${LIVE_TESTS_ENV}=1`));
    }
    return base(input, init);
  }) as typeof fetch;
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

/** Wrap `globalThis.fetch` (once per process) and allow the given local URLs/hosts. */
export function installNetworkGuard(options: { allow?: Array<string | null | undefined> } = {}): void {
  for (const entry of options.allow ?? []) allowNetworkHost(entry);
  if (typeof globalThis.fetch !== 'function') return;
  globalThis.fetch = guardFetch(globalThis.fetch);
}

/** Blocked calls recorded so far, removed from the record. */
export function takeBlockedNetworkCalls(): BlockedNetworkCall[] {
  return guardState().blocked.splice(0);
}

/** Throw when any call was blocked since the last check (drains the record). */
export function assertNoExternalNetwork(scope: string): void {
  const calls = takeBlockedNetworkCalls();
  if (!calls.length) return;
  throw new ExternalNetworkError(`[${scope}] ${calls.length} request(s) to a non-local host were blocked: ${calls.map(describeCall).join('; ')}. Stack tests must use fakes; only ${LIVE_TESTS_ENV}=1 suites may reach a provider.`);
}

/**
 * Fail the running test (or, for calls made from hooks, the file) when it attempted a non-local request.
 * Call at collection time (the harnesses' `describeWithStack` runs at the top of each test file).
 */
export function registerNetworkGuardHooks(scope: string): void {
  afterEach(() => assertNoExternalNetwork(scope));
  afterAll(() => assertNoExternalNetwork(scope));
}
