/**
 * Offline unit tests for the stack-suite network guard (`./network-guard`): non-local requests are refused before
 * they leave the process and recorded without secrets; local ones pass; `LANGQUEST_LIVE_TESTS=1` lifts the guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExternalNetworkError,
  LIVE_TESTS_ENV,
  allowNetworkHost,
  assertNoExternalNetwork,
  guardFetch,
  installNetworkGuard,
  isLocalHost,
  takeBlockedNetworkCalls,
} from './network-guard';

const ok = () => vi.fn<typeof fetch>(async () => new Response('ok'));

describe('network guard', () => {
  const originalFetch = globalThis.fetch;
  const originalLive = process.env[LIVE_TESTS_ENV];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLive === undefined) delete process.env[LIVE_TESTS_ENV];
    else process.env[LIVE_TESTS_ENV] = originalLive;
    takeBlockedNetworkCalls();
  });

  it('treats loopback and *.localhost names as local, everything else as external', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0.0.0.0', 'api.localhost']) expect(isLocalHost(host), host).toBe(true);
    for (const host of ['openrouter.ai', 'api.openai.com', 'example.com', '10.0.0.1', '192.168.1.20', 'localhost.evil.com', '127.0.0.1.nip.io']) expect(isLocalHost(host), host).toBe(false);
    expect(isLocalHost('stack.lan.example')).toBe(false);
    allowNetworkHost('http://stack.lan.example:54321');
    expect(isLocalHost('stack.lan.example')).toBe(true);
  });

  it('refuses a provider request before it leaves the process and records method, origin and path only', async () => {
    const base = ok();
    const guarded = guardFetch(base);
    await expect(guarded('https://openrouter.ai/api/v1/chat/completions?key=sk-or-v1-in-query', { method: 'post', headers: { authorization: 'Bearer sk-or-v1-not-a-real-key-for-tests' }, body: '{}' })).rejects.toBeInstanceOf(ExternalNetworkError);
    await expect(guarded(new URL('https://api.example.com/v1/x'))).rejects.toThrow(/blocked GET https:\/\/api\.example\.com\/v1\/x/);
    await expect(guarded(new Request('https://r2.example.com/bucket/key', { method: 'PUT', body: 'x' }))).rejects.toThrow(ExternalNetworkError);
    expect(base).not.toHaveBeenCalled();

    const calls = takeBlockedNetworkCalls();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://openrouter.ai/api/v1/chat/completions', 'GET https://api.example.com/v1/x', 'PUT https://r2.example.com/bucket/key']);
    expect(calls[0]!.test).toContain('refuses a provider request');
    expect(JSON.stringify(calls)).not.toMatch(/sk-or|key=/);
  });

  it('passes local requests and non-network schemes through to the wrapped fetch', async () => {
    const base = ok();
    const guarded = guardFetch(base);
    await guarded('http://127.0.0.1:54321/rest/v1/profiles');
    await guarded('http://localhost:8787/v1/health');
    await guarded('http://[::1]:54321/auth/v1/health');
    await guarded('data:text/plain,hello');
    expect(base).toHaveBeenCalledTimes(4);
    expect(takeBlockedNetworkCalls()).toEqual([]);
  });

  it(`lets live suites (${LIVE_TESTS_ENV}=1) reach providers and records nothing`, async () => {
    process.env[LIVE_TESTS_ENV] = '1';
    const base = ok();
    await guardFetch(base)('https://openrouter.ai/api/v1/models');
    expect(base).toHaveBeenCalledTimes(1);
    expect(takeBlockedNetworkCalls()).toEqual([]);
    // Only the exact live gate lifts it (the live suites themselves run only on '1').
    process.env[LIVE_TESTS_ENV] = 'true';
    await expect(guardFetch(base)('https://openrouter.ai/api/v1/models')).rejects.toThrow(ExternalNetworkError);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('assertNoExternalNetwork fails once per batch of blocked calls, naming each, then starts clean', async () => {
    expect(() => assertNoExternalNetwork('unit')).not.toThrow();
    await guardFetch(ok())('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' }).catch(() => undefined);
    expect(() => assertNoExternalNetwork('unit')).toThrow(/\[unit\] 1 request\(s\) to a non-local host were blocked: POST https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
    expect(() => assertNoExternalNetwork('unit')).not.toThrow();
  });

  it('installNetworkGuard wraps globalThis.fetch once (idempotent) and guardFetch never double-wraps', async () => {
    const base = ok();
    globalThis.fetch = base;
    installNetworkGuard({ allow: ['http://127.0.0.1:54321', null, undefined] });
    const first = globalThis.fetch;
    installNetworkGuard();
    expect(globalThis.fetch).toBe(first);
    expect(first).not.toBe(base);
    expect(guardFetch(first)).toBe(first);
    await expect(globalThis.fetch('https://openrouter.ai/api/v1/chat/completions')).rejects.toThrow(ExternalNetworkError);
    await globalThis.fetch('http://127.0.0.1:54321/rest/v1/');
    expect(base).toHaveBeenCalledTimes(1);
  });
});
