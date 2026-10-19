/**
 * Middleware and helper units: idempotency replay/conflict, token-bucket abuse control, request timeout,
 * JWT verification paths (HS256 secret, ES256 via JWKS with an injected fetch, remote fallback), media stream
 * tokens, envelope mapping and the event dispatcher's idempotent handlers.
 */
import { ApiProblem } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { toProblem } from '../../http/envelope';
import { createTokenVerifier, TokenError } from '../../middleware/auth';
import { idempotency, MemoryIdempotencyStore } from '../../middleware/idempotency';
import { createLogger } from '../../middleware/logging';
import { MemoryRateLimitStore, takeToken } from '../../middleware/rate-limit';
import { bodyLimit, requestTimeout } from '../../middleware/security';
import { mediaStreamSecret, signStreamToken, streamSubject, verifyStreamToken } from '../../lib/media-token';
import { uuidFrom } from '../../lib/learning';
import { createEventDispatcher } from '../../services/events';
import { createEdgeCache } from '../../services/cache';
import { computeStreak } from '../../routes/learner/progress';
import type { AppEnv } from '../../types';
import { signTestToken, TEST_JWT_SECRET } from '../harness';

const baseApp = () => {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-1');
    c.set('clientKey', 'client-a');
    c.set('log', createLogger('error', {}, () => undefined));
    await next();
  });
  return app;
};

describe('idempotency middleware', () => {
  it('replays the first response for the same key+body and conflicts on a different body', async () => {
    const app = baseApp();
    let calls = 0;
    app.post('/x', idempotency(new MemoryIdempotencyStore()), async (c) => {
      calls += 1;
      return c.json({ ok: true, data: { n: calls } });
    });
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': 'abc12345-key' };
    const first = await app.request('/x', { method: 'POST', headers, body: '{"a":1}' });
    const second = await app.request('/x', { method: 'POST', headers, body: '{"a":1}' });
    expect(await first.json()).toEqual({ ok: true, data: { n: 1 } });
    expect(await second.json()).toEqual({ ok: true, data: { n: 1 } });
    expect(second.headers.get('X-Idempotent-Replay')).toBe('true');
    expect(calls).toBe(1);
    const conflict = await app.request('/x', { method: 'POST', headers, body: '{"a":2}' });
    expect(conflict.status).toBe(409);
    const badKey = await app.request('/x', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'x' }, body: '{}' });
    expect(badKey.status).toBe(422);
  });
});

describe('rate limiting (abuse control, not a quota)', () => {
  it('refills tokens over time and reports retry-after when empty', async () => {
    const store = new MemoryRateLimitStore();
    const policy = { perMinute: 60, burst: 2 };
    let now = 1_000_000;
    expect((await takeToken(store, 'k', policy, now)).allowed).toBe(true);
    expect((await takeToken(store, 'k', policy, now)).allowed).toBe(true);
    const blocked = await takeToken(store, 'k', policy, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    now += 1_500; // one token refills every second at 60/min
    expect((await takeToken(store, 'k', policy, now)).allowed).toBe(true);
    expect((await takeToken(store, 'other', policy, now)).allowed).toBe(true);
  });
});

describe('timeouts and body limits', () => {
  it('maps a slow handler to provider_unavailable', async () => {
    const app = baseApp();
    app.get('/slow', requestTimeout(20), async (c) => {
      await new Promise((r) => setTimeout(r, 80));
      return c.json({ ok: true });
    });
    const res = await app.request('/slow');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('provider_unavailable');
  });

  it('rejects chunked bodies above the limit while reading', async () => {
    const app = baseApp();
    app.post('/b', bodyLimit(16), async (c) => c.json({ len: (await c.req.text()).length }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"0123456789"}'));
        controller.enqueue(new TextEncoder().encode('0123456789'));
        controller.close();
      },
    });
    const res = await app.request('/b', { method: 'POST', body: stream, headers: { 'content-type': 'application/json' }, duplex: 'half' } as RequestInit);
    expect(res.status).toBe(413);
    const ok = await app.request('/b', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
    expect(ok.status).toBe(200);
  });
});

describe('token verifier', () => {
  it('verifies HS256 with the configured secret', async () => {
    const v = createTokenVerifier({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon', SUPABASE_JWT_SECRET: TEST_JWT_SECRET });
    const token = await signTestToken('u-1', { email: 'a@b.c' });
    const out = await v.verify(token);
    expect(out).toMatchObject({ userId: 'u-1', email: 'a@b.c', role: 'authenticated' });
    await expect(v.verify(await signTestToken('u-1', { secret: 'wrong-secret-long-enough-for-hs256-xxx' }))).rejects.toMatchObject({ reason: 'bad_signature' });
    await expect(v.verify(await signTestToken('u-1', { expiresInSeconds: -5 }))).rejects.toMatchObject({ reason: 'expired' });
  });

  it('verifies ES256 through the project JWKS endpoint', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/auth/v1/.well-known/jwks.json')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const v = createTokenVerifier({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' }, { fetch: fetchImpl });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject('u-es').setIssuedAt(now).setExpirationTime(now + 60).sign(privateKey);
    expect((await v.verify(token)).userId).toBe('u-es');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('falls back to the auth service when no HS256 secret is configured', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      if (url.endsWith('/auth/v1/user')) return auth.includes('good') ? new Response(JSON.stringify({ id: 'u-remote', email: 'r@x.y', role: 'authenticated' }), { headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 401 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const v = createTokenVerifier({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' }, { fetch: fetchImpl });
    const good = (await signTestToken('u-remote')) + '';
    // Header says HS256 but we have no secret → remote verification decides.
    const result = await v.verify(good.replace(/\.[^.]+$/, '.good'));
    expect(result.userId).toBe('u-remote');
    await expect(v.verify(good.replace(/\.[^.]+$/, '.bad'))).rejects.toBeInstanceOf(TokenError);
  });
});

describe('media stream tokens', () => {
  it('round-trips a pseudonymous subject (never the raw user id) and rejects tampering/expiry', () => {
    const secret = 'stream-secret-32-characters-long-xxxxxxx';
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signStreamToken(secret, 'asset-1', 'user-1', exp);
    expect(token).not.toContain('user-1');
    expect(verifyStreamToken(secret, token)).toEqual({ assetId: 'asset-1', subject: streamSubject(secret, 'user-1'), expiresAtSec: exp });
    expect(token.split('.')[3]).toHaveLength(64); // full HMAC-SHA256 digest, not a truncated prefix
    expect(verifyStreamToken(secret, token.replace('asset-1', 'asset-2'))).toBeNull();
    expect(verifyStreamToken(secret, token.replace(streamSubject(secret, 'user-1'), streamSubject(secret, 'user-2')))).toBeNull();
    expect(verifyStreamToken('other-secret-32-characters-long-xxxx', token)).toBeNull();
    expect(verifyStreamToken(secret, signStreamToken(secret, 'a', 'u', exp - 120))).toBeNull();
    expect(verifyStreamToken(secret, 'garbage')).toBeNull();
  });

  it('fails closed when no dedicated stream secret is configured (never a Supabase key)', () => {
    expect(() => mediaStreamSecret({ MEDIA_STREAM_SECRET: undefined, AI_SESSION_TICKET_SECRET: undefined })).toThrow(ApiProblem);
    expect(mediaStreamSecret({ MEDIA_STREAM_SECRET: undefined, AI_SESSION_TICKET_SECRET: 'ticket-secret-32-characters-long-xxxxx' })).toBe('ticket-secret-32-characters-long-xxxxx');
    expect(mediaStreamSecret({ MEDIA_STREAM_SECRET: 'media-secret-32-characters-long-xxxxxx', AI_SESSION_TICKET_SECRET: 'ticket-secret-32-characters-long-xxxxx' })).toBe('media-secret-32-characters-long-xxxxxx');
  });
});

describe('error envelope mapping', () => {
  it('hides internals and maps DB/RLS errors to safe codes', () => {
    expect(toProblem(new Error('boom')).toFailure().error).toEqual({ code: 'internal', message: 'Something went wrong on our side' });
    expect(toProblem(new ApiProblem('rights_blocked', 'no')).code).toBe('rights_blocked');
    expect(toProblem(new DbError({ code: '42501', message: 'rls', details: '', hint: '', name: 'PostgrestError' } as never)).code).toBe('forbidden');
    expect(toProblem(new DbError({ code: '23505', message: 'dup', details: '', hint: '', name: 'PostgrestError' } as never)).code).toBe('conflict');
    expect(toProblem(new DbError({ code: 'PGRST116', message: 'none', details: '', hint: '', name: 'PostgrestError' } as never)).code).toBe('not_found');
    expect(toProblem({ code: 'capability_unsupported', message: 'x' }).status).toBe(501);
  });
});

describe('event dispatcher', () => {
  it('runs handlers once per idempotency key and persists hinted jobs', async () => {
    const enqueue = vi.fn(async (input: { jobType: string; idempotencyKey: string }) => ({ id: 'job-1', state: 'pending', job_type: input.jobType }) as never);
    const handler = vi.fn();
    const pending: Promise<unknown>[] = [];
    const d = createEventDispatcher({ jobs: { enqueue } as never, backend: 'postgres', log: createLogger('error', {}, () => undefined), waitUntil: (p) => void pending.push(p) });
    d.on('manifest.invalidated', handler);
    const payload = { kind: 'course' as const, courseTrackId: 'french' as const, collectionId: null, sourceLanguageCode: null, newVersion: 2, reason: 'published' as const };
    await d.emit('manifest.invalidated', payload, { idempotencyKey: 'k1' });
    await d.emit('manifest.invalidated', payload, { idempotencyKey: 'k1' });
    await d.emit('upload.finalized', { uploadId: uuidFrom('u'), assetId: uuidFrom('a'), storageKey: 'media/x', checksumSha256: 'a'.repeat(64), byteLength: 10, mimeType: 'audio/mpeg', uploaderId: uuidFrom('p') }, { idempotencyKey: 'k2' });
    await Promise.all(pending);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    // Same key scheme as the upload route / `apps/jobs` handlers, so producer + dispatcher converge on ONE row.
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ jobType: 'verify', idempotencyKey: `verify:${uuidFrom('u')}:${'a'.repeat(64)}`, params: { uploadId: uuidFrom('u'), assetId: uuidFrom('a') } });
  });

  it('mirrors the upload pipeline: exactly one job per type, no verify job when verified inline, transcode never re-enqueued', async () => {
    interface JobRow { id: string; job_type: string; params: unknown }
    const rows = new Map<string, JobRow>();
    const enqueue = vi.fn(async (input: { jobType: string; idempotencyKey: string; params?: unknown }): Promise<JobRow> => {
      const existing = rows.get(input.idempotencyKey);
      if (existing) return existing;
      const row: JobRow = { id: uuidFrom(`job-${rows.size + 1}`), job_type: input.jobType, params: input.params ?? {} };
      rows.set(input.idempotencyKey, row);
      return row;
    });
    const pending: Promise<unknown>[] = [];
    const d = createEventDispatcher({ jobs: { enqueue } as never, backend: 'postgres', log: createLogger('error', {}, () => undefined), waitUntil: (p) => void pending.push(p) });
    const assetId = uuidFrom('asset');
    const uploadId = uuidFrom('upload');
    const sha = 'b'.repeat(64);
    // What `adminUploadComplete` does for a small audio object verified in the Worker:
    await enqueue({ jobType: 'extract_metadata', idempotencyKey: `extract_metadata:${assetId}:${sha}`, params: { assetId } });
    await d.emit('asset.verified', { assetId, durationMs: null, mimeType: 'audio/mpeg', checksumSha256: sha, duplicateOfAssetId: null, state: 'imported_draft' }, { idempotencyKey: `asset.verified:${assetId}:${sha}` });
    const transcode = await enqueue({ jobType: 'transcode', idempotencyKey: `transcode:${assetId}:${sha}`, params: { assetId, formats: ['aac', 'opus'] } });
    await d.emit('transcode.requested', { assetId, jobId: transcode.id, targetFormats: ['aac', 'opus'], priority: 5 }, { idempotencyKey: `transcode.requested:${transcode.id}` });
    await d.emit('upload.finalized', { uploadId, assetId, storageKey: 'media/x', checksumSha256: sha, byteLength: 10, mimeType: 'audio/mpeg', uploaderId: uuidFrom('p') }, { idempotencyKey: `upload.finalized:${uploadId}`, enqueueJob: false });
    await Promise.all(pending);
    const types = [...rows.values()].map((r) => r.job_type).sort();
    expect(types).toEqual(['extract_metadata', 'transcode']);
    expect([...rows.values()].find((r) => r.job_type === 'transcode')!.params).toEqual({ assetId, formats: ['aac', 'opus'] });

    // Large object: the route enqueues `verify` itself and the event converges on the same row.
    rows.clear();
    await enqueue({ jobType: 'verify', idempotencyKey: `verify:${uploadId}:${sha}`, params: { uploadId, assetId, storageKey: 'media/x', expectedChecksum: sha } });
    await d.emit('upload.finalized', { uploadId, assetId, storageKey: 'media/x', checksumSha256: sha, byteLength: 10, mimeType: 'audio/mpeg', uploaderId: uuidFrom('p') }, { idempotencyKey: `upload.finalized:${uploadId}:large` });
    await Promise.all(pending);
    expect([...rows.values()].map((r) => r.job_type)).toEqual(['verify']);
  });
});

describe('edge cache + helpers', () => {
  it('invalidates every source language of a track', async () => {
    const cache = createEdgeCache({ cache: null });
    await cache.put('manifest:course:french:en', '{}', 60, '"e"');
    await cache.put('manifest:course:french:fr', '{}', 60, '"f"');
    expect(await cache.get('manifest:course:french:fr')).toMatchObject({ etag: '"f"' });
    expect(await cache.invalidateCourse('french', null)).toBeGreaterThan(20);
    expect(await cache.get('manifest:course:french:fr')).toBeNull();
  });

  it('derives stable uuids and counts streaks without punishing gaps', () => {
    expect(uuidFrom('a')).toBe(uuidFrom('a'));
    expect(uuidFrom('a')).not.toBe(uuidFrom('b'));
    expect(uuidFrom('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const today = new Date('2026-10-14T12:00:00Z');
    const rows = [
      { activity_date: '2026-10-14', minutes_active: 5 },
      { activity_date: '2026-10-13', minutes_active: 3 },
      { activity_date: '2026-10-10', minutes_active: 3 },
      { activity_date: '2026-10-09', minutes_active: 0 },
    ];
    expect(computeStreak(rows, today)).toEqual({ current: 2, longest: 2 });
  });
});
