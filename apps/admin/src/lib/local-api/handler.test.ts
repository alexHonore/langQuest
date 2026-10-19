import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));

const getStaffSession = vi.fn();
vi.mock('@/src/lib/auth/session', () => ({ getStaffSession: (...args: unknown[]) => getStaffSession(...args) }));
vi.mock('@/src/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));

import { LocalApiError, SAFE_MESSAGES, adminRoute, throwDb } from './handler';

const staff = { userId: 'u1', email: 'staff@example.test', roles: ['super_admin'], accessToken: 't' };
const RAW_PG = 'new row for relation "speakers" violates check constraint "speakers_name_check"';

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://admin.test/api/admin/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
}
const ctx = { params: Promise.resolve({}) };

describe('throwDb', () => {
  it.each([
    ['42501', 'forbidden', SAFE_MESSAGES.forbidden],
    ['23505', 'conflict', SAFE_MESSAGES.conflict],
    ['PGRST116', 'not_found', SAFE_MESSAGES.notFound],
    ['23503', 'validation_failed', SAFE_MESSAGES.reference],
    ['23514', 'validation_failed', SAFE_MESSAGES.constraint],
    ['XX000', 'internal', SAFE_MESSAGES.database],
    [undefined, 'internal', SAFE_MESSAGES.database],
  ])('maps code %s to a fixed client message', (code, expectedCode, expectedMessage) => {
    let caught: unknown;
    try {
      throwDb({ code, message: RAW_PG, details: 'Failing row contains (…)' }, 'speakers');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LocalApiError);
    const err = caught as LocalApiError;
    expect(err.code).toBe(expectedCode);
    expect(err.message).toBe(expectedMessage);
    expect(err.message).not.toContain('speakers');
    expect(err.details).toBeUndefined();
    // The raw text survives server-side only.
    expect(err.internal).toContain(RAW_PG);
    expect(err.internal).toContain('speakers');
  });
});

describe('adminRoute error envelope', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    getStaffSession.mockResolvedValue(staff);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides unknown error messages and logs them with the request id', async () => {
    const route = adminRoute('library', null, async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await route(post(null, { 'x-request-id': 'req-123' }), ctx);
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: { code: 'internal', message: SAFE_MESSAGES.internal, traceId: 'req-123' } });
    expect(JSON.stringify(json)).not.toContain('secret_table');
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls[0]);
    expect(logged).toContain('req-123');
    expect(logged).toContain('secret_table');
  });

  it('never echoes a PostgREST message thrown through throwDb', async () => {
    const route = adminRoute('library', null, async () => throwDb({ code: '42501', message: 'permission denied for table speakers' }, 'speakers'));
    const res = await route(post(null), ctx);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error.code).toBe('forbidden');
    expect(json.error.message).toBe(SAFE_MESSAGES.forbidden);
    expect(JSON.stringify(json)).not.toContain('permission denied');
    expect(typeof json.error.traceId).toBe('string');
    expect(json.error.traceId.length).toBeGreaterThan(0);
  });

  it('keeps curated LocalApiError messages (they are authored, not database text)', async () => {
    const route = adminRoute('library', null, async () => {
      throw new LocalApiError('precondition_failed', 'Unpublish before changing the editorial decision.');
    });
    const res = await route(post(null), ctx);
    const json = await res.json();
    expect(res.status).toBe(412);
    expect(json.error.message).toBe('Unpublish before changing the editorial decision.');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('replaces the message of a LocalApiError with code internal', async () => {
    const route = adminRoute('library', null, async () => {
      throw new LocalApiError('internal', 'enqueue_processing_job returned no row');
    });
    const json = await (await route(post(null), ctx)).json();
    expect(json.error.message).toBe(SAFE_MESSAGES.internal);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed upstream x-request-id and mints its own', async () => {
    const route = adminRoute('library', null, async () => {
      throw new Error('boom');
    });
    const json = await (await route(post(null, { 'x-request-id': 'bad id <script>' }), ctx)).json();
    expect(json.error.traceId).not.toContain('<');
    expect(json.error.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns compact Zod issues for an invalid body', async () => {
    const route = adminRoute('library', z.object({ name: z.string().min(1) }), async () => ({}));
    const res = await route(post({ name: '' }), ctx);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe('validation_failed');
    expect(json.error.details).toEqual([{ path: 'name', message: expect.any(String), code: 'too_small' }]);
  });

  it('answers unauthorized when there is no staff session', async () => {
    getStaffSession.mockResolvedValue(null);
    const route = adminRoute('library', null, async () => ({}));
    const res = await route(post(null), ctx);
    expect(res.status).toBe(401);
  });
});

describe('adminRoute provider error mapping', () => {
  beforeEach(() => {
    getStaffSession.mockResolvedValue(staff);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns an OpenRouterError into provider_unavailable without echoing the provider body', async () => {
    const error = new Error('402 {"error":{"message":"Insufficient credits for key sk-or-v1-abc"}}');
    error.name = 'OpenRouterError';
    const route = adminRoute('aiModels', null, async () => {
      throw error;
    });
    const res = await route(post(null), ctx);
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error.code).toBe('provider_unavailable');
    expect(JSON.stringify(json)).not.toContain('sk-or-v1');
  });

  it('keeps the authored message of a capability_unsupported error', async () => {
    const error = Object.assign(new Error('Text-to-speech is not available for ht-HT.'), { code: 'capability_unsupported' });
    const route = adminRoute('aiModels', null, async () => {
      throw error;
    });
    const json = await (await route(post(null), ctx)).json();
    expect(json.error).toMatchObject({ code: 'capability_unsupported', message: 'Text-to-speech is not available for ht-HT.' });
  });
});
