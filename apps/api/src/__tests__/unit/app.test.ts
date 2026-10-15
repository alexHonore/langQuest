/**
 * Offline tests of the app surface: route registration from `ROUTES`, envelope/404, public catalog,
 * validation before any DB call, JWT verification (HS256), role enforcement, CORS allowlist and security headers.
 */
import { ROUTES, type RouteKey } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { call, offlineApp, signTestToken } from '../harness';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const EDITOR = '33333333-3333-4333-8333-333333333333';

describe('app surface', () => {
  const ctx = offlineApp({ [ADMIN]: ['admin'], [EDITOR]: ['content_editor'] });

  it('registers every route from the contracts ROUTES constants', () => {
    const missing = (Object.keys(ROUTES) as RouteKey[]).filter((k) => !ctx.registered.has(k));
    expect(missing).toEqual([]);
    expect(ctx.registered.size).toBe(Object.keys(ROUTES).length);
  });

  it('answers unknown paths with the error envelope and a request id', async () => {
    const res = await call(ctx, '/v1/nope');
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(res.json.error.traceId).toBeTruthy();
    expect(res.headers.get('x-request-id')).toBe(res.json.error.traceId);
  });

  it('serves the static language catalog publicly with cache headers', async () => {
    const res = await call(ctx, '/v1/languages');
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.data.tracks).toHaveLength(30);
    expect(res.json.data.tracks.find((t: { id: string }) => t.id === 'arabic-moroccan').targetVarietyId).toBe('ary');
    expect(res.json.data.sourceLanguages).toHaveLength(23);
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('rejects learner routes without a token', async () => {
    const res = await call(ctx, '/v1/me');
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
  });

  it('rejects tampered, expired and anon-role tokens', async () => {
    const forged = await signTestToken(LEARNER, { secret: 'another-secret-that-is-long-enough-xxxxx' });
    expect((await call(ctx, '/v1/me', { token: forged })).json.error.code).toBe('unauthorized');
    const expired = await signTestToken(LEARNER, { expiresInSeconds: -60 });
    const expiredRes = await call(ctx, '/v1/me', { token: expired });
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.json.error.message).toMatch(/expired/i);
    const anon = await signTestToken(LEARNER, { role: 'anon' });
    expect((await call(ctx, '/v1/me', { token: anon })).status).toBe(401);
    expect((await call(ctx, '/v1/me', { headers: { authorization: 'Bearer not.a.jwt' } })).status).toBe(401);
  });

  it('validates bodies with the contracts schemas before touching the database', async () => {
    const token = await signTestToken(LEARNER);
    const res = await call(ctx, '/v1/me/enrollments', { token, body: { courseTrackId: 'arabic-moroccan' } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('validation_failed');
    expect(JSON.stringify(res.json.error.details)).toContain('sourceLanguageCode');
    const unknownTrack = await call(ctx, '/v1/me/enrollments', { token, body: { courseTrackId: 'klingon', sourceLanguageCode: 'fr' } });
    expect(unknownTrack.status).toBe(422);
    const badJson = await ctx.app.request('/v1/me/enrollments', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{not json' });
    expect(badJson.status).toBe(422);
  });

  it('validates query parameters', async () => {
    const res = await call(ctx, '/v1/courses?target=not-a-variety');
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('validation_failed');
  });

  it('enforces staff roles on admin routes (403, never a leak)', async () => {
    const learner = await signTestToken(LEARNER);
    const forbidden = await call(ctx, '/v1/admin/models');
    expect(forbidden.status).toBe(401);
    const learnerRes = await call(ctx, '/v1/admin/models', { token: learner });
    expect(learnerRes.status).toBe(403);
    expect(learnerRes.json.error.code).toBe('forbidden');
    // content_editor may not change model routing (admin only) …
    const editor = await signTestToken(EDITOR);
    const editorPut = await call(ctx, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: editor, body: {} });
    expect(editorPut.status).toBe(403);
    // … but an admin reaches validation (the body is invalid, so no DB call happens).
    const admin = await signTestToken(ADMIN);
    const adminPut = await call(ctx, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: admin, body: {} });
    expect(adminPut.status).toBe(422);
    const editorUpload = await call(ctx, '/v1/admin/uploads/initiate', { token: editor, body: { filename: 'x.mp3' } });
    expect(editorUpload.status).toBe(422);
  });

  it('rejects oversized and non-JSON bodies', async () => {
    const token = await signTestToken(LEARNER);
    const big = await ctx.app.request('/v1/me/enrollments', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) }, body: '{}' });
    expect(big.status).toBe(413);
    const form = await ctx.app.request('/v1/me/enrollments', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', 'content-length': '2' }, body: 'hi' });
    expect(form.status).toBe(415);
  });

  it('applies the CORS allowlist (reflects allowed origins only)', async () => {
    const allowed = await ctx.app.request('/v1/languages', { headers: { origin: 'https://admin.example.test' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://admin.example.test');
    const denied = await ctx.app.request('/v1/languages', { headers: { origin: 'https://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await ctx.app.request('/v1/me', { method: 'OPTIONS', headers: { origin: 'https://admin.example.test', 'access-control-request-method': 'PATCH' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    const localhost = await ctx.app.request('/v1/languages', { headers: { origin: 'http://localhost:3000' } });
    expect(localhost.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('never leaks internal details for a provider-less AI route', async () => {
    const token = await signTestToken(LEARNER);
    // The offline env has no OPENROUTER key → honest capability_unsupported before any model call.
    const res = await call(ctx, '/v1/ai/model-capabilities?trackId=arabic-moroccan', { token });
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.json.data.pronunciationScoring).toBe('none');
      expect(res.json.data.realtimeLatencyEstimateMs).toBeNull();
    }
  });
});
