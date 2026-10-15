import { describe, expect, it } from 'vitest';
import { detectLocalStack, parseSupabaseStatus } from './local-stack';

describe('parseSupabaseStatus', () => {
  it('reads the CLI 2.x JSON (legacy and new key names)', () => {
    const legacy = parseSupabaseStatus(JSON.stringify({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'svc', DB_URL: 'postgresql://x' }));
    expect(legacy).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon', serviceRoleKey: 'svc', dbUrl: 'postgresql://x' });
    const modern = parseSupabaseStatus(JSON.stringify({ API_URL: 'http://127.0.0.1:54321', PUBLISHABLE_KEY: 'pk', SECRET_KEY: 'sk' }));
    expect(modern?.anonKey).toBe('pk');
    expect(modern?.serviceRoleKey).toBe('sk');
    expect(modern?.dbUrl).toBeNull();
  });
  it('returns null on garbage or missing keys', () => {
    expect(parseSupabaseStatus('not json')).toBeNull();
    expect(parseSupabaseStatus('{"API_URL":"x"}')).toBeNull();
  });
});

describe('detectLocalStack', () => {
  it('prefers explicit env and never shells out when LANGQUEST_SKIP_LOCAL_STACK=1', () => {
    expect(detectLocalStack({ env: { SUPABASE_LOCAL_URL: 'http://l', SUPABASE_LOCAL_ANON_KEY: 'a', SUPABASE_LOCAL_SERVICE_ROLE_KEY: 's' } })).toEqual({ url: 'http://l', anonKey: 'a', serviceRoleKey: 's', dbUrl: null });
    expect(detectLocalStack({ env: { LANGQUEST_SKIP_LOCAL_STACK: '1' } })).toBeNull();
  });
});
