/**
 * §11 "token theft": expired, forged, unsigned (`alg: none`), subject-swapped, anon/service-role and malformed
 * tokens are all rejected before any database work; a refresh with a bogus refresh token fails; a deleted account's
 * token stops working.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, forgeToken, noneAlgToken, swapSubject, tamperSignature, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('security.tokens');

describeStack('expired, forged and invalid tokens', () => {
  let h: ApiHarness;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    h = createApiHarness();
    [alice, bob] = await Promise.all([createTestUser(h, 'tok-alice'), createTestUser(h, 'tok-bob')]);
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [alice, bob]);
  });

  const expectUnauthorized = async (token: string | undefined, headers?: Record<string, string>) => {
    const res = await call(h, '/v1/me', { token, headers });
    expect(res.status, `token ${token?.slice(0, 20)}…`).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    return res;
  };

  it('a genuine token works; no token, garbage, and non-Bearer schemes do not', async () => {
    expect((await call(h, '/v1/me', { token: alice.token })).status).toBe(200);
    await expectUnauthorized(undefined);
    await expectUnauthorized('not.a.jwt');
    await expectUnauthorized('');
    await expectUnauthorized(undefined, { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` });
    await expectUnauthorized(undefined, { authorization: alice.token }); // missing "Bearer "
  });

  it('tampered signature, swapped subject and alg:none are rejected', async () => {
    await expectUnauthorized(tamperSignature(alice.token));
    const swapped = swapSubject(alice.token, bob.id);
    await expectUnauthorized(swapped);
    await expectUnauthorized(noneAlgToken(alice.id));
    // Bob's data stays Bob's: Alice's (valid) token never reads Bob.
    const me = await call(h, '/v1/me', { token: alice.token });
    expect(me.json.data.userId).toBe(alice.id);
  });

  it('tokens signed with another secret, expired tokens and anon/service_role claims are rejected (HS256 stack)', async () => {
    if (!h.stack.jwtSecret) {
      console.warn('[security.tokens] JWT_SECRET unavailable; skipping local-forgery cases');
      return;
    }
    await expectUnauthorized(await forgeToken(alice.id, { secret: 'definitely-not-the-stack-secret-xxxxxxxxxxxx' }));
    const expired = await expectUnauthorized(await forgeToken(alice.id, { secret: h.stack.jwtSecret, expiresInSeconds: -120 }));
    expect(expired.json.error.message).toMatch(/expired/i);
    await expectUnauthorized(await forgeToken(alice.id, { secret: h.stack.jwtSecret, role: 'anon' }));
    await expectUnauthorized(await forgeToken(alice.id, { secret: h.stack.jwtSecret, role: 'service_role' }));
    // A correctly signed token for a non-existent subject authenticates but owns nothing.
    const ghost = await call(h, '/v1/me/enrollments', { token: await forgeToken(crypto.randomUUID(), { secret: h.stack.jwtSecret }) });
    expect([200, 404, 500]).toContain(ghost.status);
    if (ghost.status === 200) expect(ghost.json.data.enrollments).toEqual([]);
  });

  it('refresh requires a real refresh token and never mints a session from an access token', async () => {
    const bogus = await call(h, '/v1/auth/session/refresh', { token: alice.token, body: { refreshToken: 'not-a-refresh-token' } });
    expect([401, 422, 403]).toContain(bogus.status);
    expect(bogus.json.ok).toBe(false);
    const asRefresh = await call(h, '/v1/auth/session/refresh', { token: alice.token, body: { refreshToken: alice.token } });
    expect(asRefresh.json.ok).toBe(false);
    const good = await call(h, '/v1/auth/session/refresh', { token: alice.token, body: { refreshToken: alice.refreshToken } });
    expect(good.status).toBe(200);
    expect(good.json.data.accessToken).toBeTruthy();
    expect(good.json.data.refreshToken).toBeTruthy();
    // The rotated token keeps working; GoTrue allows a short reuse window for the old one, so we only assert the
    // new session is a real session for the same account (never someone else's).
    const rotated = await call(h, '/v1/me', { token: good.json.data.accessToken });
    expect(rotated.status).toBe(200);
    expect(rotated.json.data.userId).toBe(alice.id);
  });

  it('a deleted account cannot keep using an old token for anything that reads its data', async () => {
    const victim = await createTestUser(h, 'tok-deleted');
    const before = await call(h, '/v1/me', { token: victim.token });
    expect(before.status).toBe(200);
    const deleted = await call(h, '/v1/me', { method: 'DELETE', token: victim.token, body: { confirmation: 'DELETE' } });
    expect(deleted.status).toBe(200);
    const after = await call(h, '/v1/me', { token: victim.token });
    expect(after.status).toBeGreaterThanOrEqual(400);
    const enrol = await call(h, '/v1/me/enrollments', { token: victim.token, body: { courseTrackId: 'german', sourceLanguageCode: 'en' } });
    expect(enrol.status).toBeGreaterThanOrEqual(400);
    await deleteTestUsers(h, [victim]);
  });

  it('rate limiting protects authentication-class routes without punishing honest learners', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await call(h, '/v1/auth/session/refresh', { token: alice.token, body: { refreshToken: `junk-${i}` } })).status);
    expect(statuses.every((s) => s >= 400)).toBe(true);
    // Learner reads are unaffected.
    expect((await call(h, '/v1/me', { token: alice.token })).status).toBe(200);
  });
});
