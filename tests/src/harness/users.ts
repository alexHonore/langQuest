/**
 * Isolated test users: created through the GoTrue admin API with the service key, signed in with the anon key to
 * obtain a real access token (HS256 on the local stack). Every user gets a unique email so suites never collide;
 * deletion cascades through `auth.users` → profiles → owned rows.
 */
import type { Role } from '@langquest/contracts';
import { createUserClient, type DbClient } from '@langquest/db/client';
import { createClient } from '@supabase/supabase-js';
import type { ApiHarness } from './api';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
  refreshToken: string;
  roles: Role[];
}

export interface CreateUserOptions {
  roles?: Role[];
  defaultSourceLanguageCode?: string | null;
  uiLocale?: string;
}

export async function createTestUser(h: ApiHarness, label: string, opts: CreateUserOptions = {}): Promise<TestUser> {
  const email = `tests-${label}-${crypto.randomUUID()}@test.local`;
  const password = `pw-${crypto.randomUUID()}`;
  const metadata: Record<string, string> = { ui_locale: opts.uiLocale ?? 'en-US' };
  if (opts.defaultSourceLanguageCode !== null) metadata.default_source_language_code = opts.defaultSourceLanguageCode ?? 'en';
  const created = await h.service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
  if (created.error || !created.data.user) throw new Error(`createUser(${label}) failed: ${created.error?.message}`);
  const id = created.data.user.id;
  const roles = opts.roles ?? [];
  for (const role of roles) {
    const granted = await h.service.from('user_roles').insert({ user_id: id, role });
    if (granted.error) throw new Error(`grant ${role} failed: ${granted.error.message}`);
  }
  const session = await signIn(h, email, password);
  return { id, email, password, token: session.accessToken, refreshToken: session.refreshToken, roles };
}

export async function signIn(h: ApiHarness, email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
  const auth = createClient(h.env.SUPABASE_URL, h.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`signIn failed: ${signed.error?.message}`);
  return { accessToken: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token };
}

/** A supabase-js client acting AS the user (RLS in force) — for negative RLS tests at the DB layer. */
export function userClient(h: ApiHarness, user: TestUser): DbClient {
  return createUserClient({ SUPABASE_URL: h.env.SUPABASE_URL, SUPABASE_ANON_KEY: h.env.SUPABASE_ANON_KEY }, user.token);
}

export async function deleteTestUsers(h: ApiHarness, users: Array<Pick<TestUser, 'id'> | string>): Promise<void> {
  for (const u of users) {
    const id = typeof u === 'string' ? u : u.id;
    await h.service.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

/** Enrol a user through the API (the only supported path) and return the enrollment DTO. */
export async function enrol(h: ApiHarness, user: TestUser, body: { courseTrackId: string; sourceLanguageCode: string; scriptMode?: string; regionalPreference?: string; learnerLevel?: string }): Promise<{ id: string; courseTrackId: string; sourceLanguageCode: string; targetVarietyId: string; scriptMode: string; status: string }> {
  const res = await h.app.app.request('/v1/me/enrollments', { method: 'POST', headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; data?: never; error?: { message: string } };
  if (res.status !== 201) throw new Error(`enrol failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data as never;
}
