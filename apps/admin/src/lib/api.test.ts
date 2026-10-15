import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, ApiUnreachableError, createApiClient, describeApiError } from './api';

const token = async () => 'jwt-token';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createApiClient', () => {
  it('builds URLs from contract routes with params and query', () => {
    const api = createApiClient({ baseUrl: 'https://api.example.test/', getToken: token });
    expect(api.url('adminProcessingJob', { id: 'abc' })).toBe('https://api.example.test/v1/admin/processing-jobs/abc');
    expect(api.url('adminAssetsList', undefined, { status: 'published', limit: 20 })).toBe(
      'https://api.example.test/v1/admin/assets?status=published&limit=20',
    );
  });

  it('sends the bearer token, idempotency header and JSON body; validates the response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/v1/admin/uploads/u1/abort');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer jwt-token');
      expect(headers['Idempotency-Key']).toBe('key-12345678');
      expect(JSON.parse(String(init?.body))).toEqual({ reason: 'user' });
      return jsonResponse({ ok: true, data: { uploadId: '7a2a3f3e-9d3a-4a4e-9a1e-2b6a7e3c1f00', status: 'aborted' } });
    });
    const api = createApiClient({ baseUrl: 'https://api.example.test', getToken: token, fetch: fetchMock as unknown as typeof fetch });
    const result = await api.call('adminUploadAbort', { params: { id: 'u1' }, body: { reason: 'user' }, idempotencyKey: 'key-12345678' });
    expect(result.status).toBe('aborted');
  });

  it('turns contract failures into ApiClientError with the code', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: { code: 'rights_blocked', message: 'No license' } }, 451));
    const api = createApiClient({ baseUrl: 'https://api.example.test', getToken: token, fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('adminContentPublish', { params: { id: 'x' }, body: {} })).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'rights_blocked',
      status: 451,
    });
  });

  it('rejects responses that violate the contract schema', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: { uploadId: 'not-a-uuid', status: 'aborted' } }));
    const api = createApiClient({ baseUrl: 'https://api.example.test', getToken: token, fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('adminUploadAbort', { params: { id: 'u1' }, body: {} })).rejects.toBeInstanceOf(ApiClientError);
  });

  it('reports network failures as ApiUnreachableError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const api = createApiClient({ baseUrl: 'https://api.example.test', getToken: token, fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('adminAssetsList')).rejects.toBeInstanceOf(ApiUnreachableError);
    expect(describeApiError(new ApiUnreachableError('https://api.example.test')).code).toBe('unreachable');
  });

  it('refuses admin calls without a session token', async () => {
    const api = createApiClient({ baseUrl: 'https://api.example.test', getToken: async () => null, fetch: vi.fn() as unknown as typeof fetch });
    await expect(api.call('adminAssetsList')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
