/**
 * `PATCH /v1/me/settings` (R-6.1-03) end to end through the real app: auth, contract validation, the learner-client
 * (RLS) write path, the `/v1/me` response envelope, and the merge rule for nested option groups — a patch that names
 * one privacy / accessibility / notification / download option changes only that option. (Zod 4 re-applies field
 * defaults inside `.partial()`, so the parsed body alone would silently reset every option the client did not send.)
 */
import { apiEnvelope } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeResponseNullableSchema } from '../../routes/learner/account';
import { enrollmentRow, profileRow, routeHarness, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PATH = '/v1/me/settings';
const MeEnvelope = apiEnvelope(MeResponseNullableSchema);

describe('PATCH /v1/me/settings', () => {
  let h: RouteHarness;
  let token: string;

  beforeEach(async () => {
    h = routeHarness();
    token = await h.token(LEARNER);
    h.db.seed('profiles', [
      profileRow(LEARNER, { privacy_options: { store_speech_recordings: 'opt_in_30_days', analytics_opt_out: true }, accessibility_options: { reduce_motion: true, text_scale: 1.5, mascot_enabled: false } }),
      profileRow(OTHER, { display_name: 'Someone else' }),
    ]);
    h.db.seed('account_settings', [
      { user_id: LEARNER, audio_speed: 1, conversation_mode: 'push_to_talk', default_hint_behavior: 'on_request', notification_preferences: { daily_reminder: true, review_due: false, story_updates: true }, offline_download_settings: { auto_download: true, wifi_only: false, max_storage_mb: 512 }, retention_settings: {}, script_preferences: {}, transliteration_preferences: {}, preferred_input_device: null, preferred_output_device: null },
    ]);
  });
  afterEach(() => h.restore());

  const profile = (id = LEARNER) => h.db.rows('profiles').find((p) => p.user_id === id)!;
  const settings = () => h.db.rows('account_settings').find((s) => s.user_id === LEARNER)!;

  it('requires a learner token (401 envelope, nothing read)', async () => {
    const res = await h.call(PATH, { method: 'PATCH', body: { displayName: 'x' } });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(h.db.requests).toHaveLength(0);
  });

  it('validates the body with PatchSettingsRequestSchema (422 validation_failed, no write)', async () => {
    for (const body of [{}, { audioSpeed: 3 }, { privacyOptions: { store_speech_recordings: 'forever' } }, { conversationMode: 'telepathy' }, { defaultSourceLanguageCode: 'xx' }, { accessibilityOptions: { text_scale: 9 } }]) {
      const res = await h.call(PATH, { method: 'PATCH', token, body });
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.json.ok).toBe(false);
      expect(res.json.error.code).toBe('validation_failed');
      expect(Array.isArray(res.json.error.details)).toBe(true);
    }
    expect(h.db.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });

  it('applies profile and account-setting fields through the learner (RLS) client and answers the /v1/me envelope', async () => {
    const res = await h.call(PATH, { method: 'PATCH', token, body: { displayName: 'Nadia', uiLocale: 'fr-FR', timeZone: 'Europe/Paris', audioSpeed: 0.8, conversationMode: 'text_only', defaultHintBehavior: 'after_pause' } });
    expect(res.status).toBe(200);
    const parsed = MeEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data).toMatchObject({ userId: LEARNER, displayName: 'Nadia', uiLocale: 'fr-FR', timeZone: 'Europe/Paris', roles: [] });
    expect(profile()).toMatchObject({ display_name: 'Nadia', ui_locale: 'fr-FR', time_zone: 'Europe/Paris' });
    expect(settings()).toMatchObject({ audio_speed: 0.8, conversation_mode: 'text_only', default_hint_behavior: 'after_pause' });
    // Every write ran as the learner (RLS in force), never with the service role.
    const writes = [...h.db.writes('profiles'), ...h.db.writes('account_settings')];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.every((w) => w.client === 'user' && w.sub === LEARNER)).toBe(true);
    // The other learner's row is untouched.
    expect(profile(OTHER).display_name).toBe('Someone else');
  });

  it('a one-option privacy patch changes only that option (consent choices are never reset to defaults)', async () => {
    const res = await h.call(PATH, { method: 'PATCH', token, body: { privacyOptions: { store_raw_transcripts: true } } });
    expect(res.status).toBe(200);
    expect(profile().privacy_options).toEqual({ store_speech_recordings: 'opt_in_30_days', store_raw_transcripts: true, personalize_from_interests: false, analytics_opt_out: true, leaderboard_opt_in: false });
    expect(res.json.data.privacyOptions).toMatchObject({ store_speech_recordings: 'opt_in_30_days', store_raw_transcripts: true, analytics_opt_out: true });
  });

  it('one-option accessibility / notification / download patches keep every other stored option', async () => {
    expect((await h.call(PATH, { method: 'PATCH', token, body: { accessibilityOptions: { high_contrast: true } } })).status).toBe(200);
    expect(profile().accessibility_options).toMatchObject({ high_contrast: true, reduce_motion: true, text_scale: 1.5, mascot_enabled: false });

    expect((await h.call(PATH, { method: 'PATCH', token, body: { notificationPreferences: { story_updates: false } } })).status).toBe(200);
    expect(settings().notification_preferences).toEqual({ daily_reminder: true, review_due: false, story_updates: false });

    expect((await h.call(PATH, { method: 'PATCH', token, body: { offlineDownloadSettings: { wifiOnly: true } } })).status).toBe(200);
    expect(settings().offline_download_settings).toEqual({ auto_download: true, wifi_only: true, max_storage_mb: 512 });
  });

  it('defaultSourceLanguageCode only changes the prefill: existing enrollments keep their own source language', async () => {
    const [enrollment] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'arabic-moroccan', { source_language_code: 'fr' })]);
    const res = await h.call(PATH, { method: 'PATCH', token, body: { defaultSourceLanguageCode: 'en' } });
    expect(res.status).toBe(200);
    expect(profile().default_source_language_code).toBe('en');
    expect(res.json.data.defaultSourceLanguageCode).toBe('en');
    expect(res.json.data.enrollments).toHaveLength(1);
    expect(res.json.data.enrollments[0]).toMatchObject({ id: enrollment!.id, courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary' });
    expect(h.db.writes('user_course_enrollments')).toHaveLength(0);
    // `null` clears the prefill (nullable in the contract).
    const cleared = await h.call(PATH, { method: 'PATCH', token, body: { defaultSourceLanguageCode: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.json.data.defaultSourceLanguageCode).toBeNull();
  });

  it('a learner without a profile row gets 404 and nothing is created', async () => {
    const stranger = await h.token('33333333-3333-4333-8333-333333333333');
    const res = await h.call(PATH, { method: 'PATCH', token: stranger, body: { displayName: 'x' } });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('not_found');
    expect(h.db.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });
});
