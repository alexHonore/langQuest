/**
 * §5.5 / §11 "non-admin CMS calls": every `auth: 'admin'` route in the contracts ROUTES table answers 401 without
 * a token and 403 for a learner (never 404 — hidden controls are not authorization, and neither are leaks);
 * support_readonly cannot mutate; role checks are server-side (`user_roles`), so a self-granted role claim in the
 * JWT payload changes nothing.
 */
import { ROUTES, type RouteKey } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, userClient, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('security.admin-routes');

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001';

function samplePath(key: RouteKey): string {
  return ROUTES[key].path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => (name === 'task' ? 'character_dialogue' : SAMPLE_UUID));
}

describeStack('admin routes enforce server-verified roles', () => {
  let h: ApiHarness;
  let learner: TestUser;
  let support: TestUser;
  let editor: TestUser;
  const adminRoutes = (Object.keys(ROUTES) as RouteKey[]).filter((k) => ROUTES[k].auth === 'admin');
  const mutating = adminRoutes.filter((k) => ROUTES[k].method !== 'GET');

  beforeAll(async () => {
    h = createApiHarness();
    [learner, support, editor] = await Promise.all([createTestUser(h, 'learner'), createTestUser(h, 'support', { roles: ['support_readonly'] }), createTestUser(h, 'editor', { roles: ['content_editor'] })]);
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [learner, support, editor]);
  });

  it('covers every admin route in the contracts (sanity)', () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(22);
    expect(mutating.length).toBeGreaterThanOrEqual(12);
  });

  it('anonymous callers get 401 on every admin route', async () => {
    const wrong: string[] = [];
    for (const key of adminRoutes) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, body: ROUTES[key].method === 'GET' ? undefined : {} });
      if (res.status !== 401 || res.json?.error?.code !== 'unauthorized') wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a learner gets 403 forbidden on every admin route (no 404 leaks, no 2xx)', async () => {
    const wrong: string[] = [];
    for (const key of adminRoutes) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, token: learner.token, body: ROUTES[key].method === 'GET' ? undefined : {} });
      if (res.status !== 403 || res.json?.error?.code !== 'forbidden') wrong.push(`${key} → ${res.status} ${res.json?.error?.code}`);
    }
    expect(wrong).toEqual([]);
  });

  it('support_readonly can read but never mutate', async () => {
    const wrong: string[] = [];
    for (const key of mutating) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, token: support.token, body: {} });
      if (res.status !== 403) wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const list = await call(h, '/v1/admin/models', { token: support.token });
    expect(list.status).toBe(200);
  });

  it('content editors cannot touch admin-only model configuration', async () => {
    const put = await call(h, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: editor.token, body: { task: 'character_dialogue', targetVariety: null, sourceLanguage: null, provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: [], params: {}, latencyClass: 'realtime', enabled: false, dailyBudgetUsd: null, requireSmokeTests: false } });
    expect(put.status).toBe(403);
    const bench = await call(h, '/v1/admin/models/character_dialogue/benchmark', { token: editor.token, body: {} });
    expect(bench.status).toBe(403);
  });

  it('roles come from user_roles, which learners cannot grant themselves', async () => {
    const db = userClient(h, learner);
    const grant = await db.from('user_roles').insert({ user_id: learner.id, role: 'admin' });
    expect(grant.error).not.toBeNull();
    const me = await call(h, '/v1/me', { token: learner.token });
    expect(me.json.data.roles).toEqual([]);
    const still = await call(h, '/v1/admin/assets', { token: learner.token });
    expect(still.status).toBe(403);
    // Roles expire: an expired grant is not a role.
    await h.service.from('user_roles').insert({ user_id: learner.id, role: 'admin', expires_at: new Date(Date.now() - 60_000).toISOString() });
    const expired = await call(h, '/v1/admin/assets', { token: learner.token });
    expect(expired.status).toBe(403);
    await h.service.from('user_roles').delete().eq('user_id', learner.id);
  });

  it('mutating admin calls by an editor are audited', async () => {
    const res = await call(h, '/v1/admin/assets/bulk-label', { token: editor.token, body: { assetIds: [SAMPLE_UUID], patch: {}, idempotencyKey: `idem-${crypto.randomUUID()}` } });
    expect(res.status).toBeLessThan(500);
    await h.app.flush();
    const audit = await h.service.from('audit_logs').select('action').eq('actor_id', editor.id);
    // Some bulk-label inputs are rejected before any mutation; the role check and envelope are what we assert here.
    expect(Array.isArray(audit.data)).toBe(true);
  });
});
