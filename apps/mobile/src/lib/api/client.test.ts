import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClientError, createApiClient } from './client';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const noSleep = async (): Promise<void> => {};

describe('createApiClient', () => {
  it('builds the route path, sends the bearer token and validates the envelope', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.test/v1/courses/arabic-moroccan/coverage?source=fr');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
      return jsonResponse(200, { ok: true, data: { courseTrackId: 'arabic-moroccan', coverage: [] } });
    });
    const client = createApiClient({ baseUrl: 'https://api.test/', getAccessToken: async () => 'tok', fetch: fetchMock, sleep: noSleep });
    const data = await client.call('courseCoverage', {
      params: { trackId: 'arabic-moroccan' },
      query: { source: 'fr' },
      schema: z.object({ courseTrackId: z.string(), coverage: z.array(z.unknown()) }),
    });
    expect(data.courseTrackId).toBe('arabic-moroccan');
  });

  it('attaches the bearer token on learner routes and fails fast when signed out', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
      return jsonResponse(200, { ok: true, data: { enrollments: [] } });
    });
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 'abc', fetch: fetchMock, sleep: noSleep });
    await client.call('enrollmentsList', { schema: z.object({ enrollments: z.array(z.unknown()) }) });

    const onUnauthorized = vi.fn();
    const signedOut = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => null, fetch: fetchMock, sleep: noSleep, onUnauthorized });
    await expect(signedOut.call('enrollmentsList', { schema: z.object({}) })).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends DELETE /v1/me/enrollments/:id?confirm=delete for enrollmentDelete (§15 remove a course)', async () => {
    const id = '1f7d2a9e-6c0b-4b8d-9a3e-2b5c8d1e4f6a';
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://api.test/v1/me/enrollments/${id}?confirm=delete`);
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return jsonResponse(200, { ok: true, data: { deleted: true, enrollmentId: id } });
    });
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 'tok', fetch: fetchMock, sleep: noSleep });
    const data = await client.call('enrollmentDelete', { params: { id }, query: { confirm: 'delete' }, schema: z.object({ deleted: z.literal(true), enrollmentId: z.string() }) });
    expect(data).toEqual({ deleted: true, enrollmentId: id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the API precondition when enrollmentDelete is sent without ?confirm=delete', async () => {
    const id = '1f7d2a9e-6c0b-4b8d-9a3e-2b5c8d1e4f6a';
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.test/v1/me/enrollments/${id}`);
      return jsonResponse(412, { ok: false, error: { code: 'precondition_failed', message: 'confirm', details: { requiredConfirmation: 'delete' } } });
    });
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 'tok', fetch: fetchMock, sleep: noSleep });
    const err = await client.call('enrollmentDelete', { params: { id }, schema: z.object({}) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).kind).toBe('precondition_failed');
    expect((err as ApiClientError).details).toEqual({ requiredConfirmation: 'delete' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff and surfaces the typed error afterwards', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return jsonResponse(503, { ok: false, error: { code: 'provider_unavailable', message: 'down' } });
      return jsonResponse(200, { ok: true, data: { items: [], nextCursor: null, total: 0 } });
    });
    const sleeps: number[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 't',
      fetch: fetchMock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      backoffMs: 100,
    });
    const data = await client.call('meSkills', { query: { enrollmentId: 'e' }, schema: z.object({ items: z.array(z.unknown()) }) });
    expect(data.items).toEqual([]);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([75, 150]);
  });

  it('does not retry non-idempotent POSTs without an idempotency key, but does with one', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(500, { ok: false, error: { code: 'internal', message: 'boom' } }) : jsonResponse(200, { ok: true, data: { ok: true } });
    });
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 't', fetch: fetchMock, sleep: noSleep });
    await expect(client.call('missionEvaluate', { params: { id: 'm' }, body: {}, schema: z.object({ ok: z.boolean() }) })).rejects.toBeInstanceOf(ApiClientError);
    expect(calls).toBe(1);
    calls = 0;
    const data = await client.call('missionEvaluate', { params: { id: 'm' }, body: {}, idempotencyKey: 'k', schema: z.object({ ok: z.boolean() }) });
    expect(data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('classifies network failures and timeouts as connectivity errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const onError = vi.fn();
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 't', fetch: fetchMock, sleep: noSleep, maxRetries: 1, onError });
    const err = await client.call('me', { schema: z.object({}) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).isConnectivity).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ route: 'me', code: 'network' }));
  });

  it('rejects a success envelope whose data fails the schema', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, data: { totalXp: 'lots' } }));
    const client = createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 't', fetch: fetchMock, sleep: noSleep });
    await expect(client.call('meProgress', { schema: z.object({ totalXp: z.number() }) })).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
