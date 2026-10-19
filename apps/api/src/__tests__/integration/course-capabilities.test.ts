/**
 * Course capabilities against the LOCAL stack (CONVENTIONS §8 "visible means usable"): the snapshot is computed
 * from published rows + configured providers and exposed on `/v1/courses/:trackId/coverage?source=`, on every
 * enrollment DTO (`/v1/me`, create/list/patch) and on the course manifest. Two apps share the database: one without
 * any AI provider (honest `none`), one with an OpenRouter key present (no live call is made — capabilities derive
 * from the evidence matrix, never from a provider round-trip).
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { courseCapabilityCountsKey } from '../../services/cache';
import type { CourseTrackId, SourceLanguageCode } from '@langquest/contracts';
import { call, createStackUser, deleteStackUsers, describeWithStack, stackApp, type StackHarness, type TestUser } from '../harness';

const describeStack = describeWithStack('api.course-capabilities');

describeStack('course capabilities (track × instruction language)', () => {
  let plain: StackHarness;
  let withAi: StackHarness;
  let learner: TestUser;
  const created: string[] = [];

  beforeAll(async () => {
    plain = stackApp();
    withAi = stackApp({ OPENROUTER_API_KEY: 'sk-or-test-key-never-called' });
    learner = await createStackUser(withAi, 'caps-learner', { defaultSourceLanguageCode: 'fr' });
    created.push(learner.id);
  });

  afterAll(async () => {
    await plain.app.flush();
    await withAi.app.flush();
    await deleteStackUsers(withAi, created);
  });

  /** Ground truth straight from the database (the same rule the API applies), so the assertions survive other suites' seeds. */
  async function publishedMissionCount(h: StackHarness, trackId: string): Promise<number> {
    const res = await h.service.from('missions').select('id, chapters!inner(state, lesson_courses!inner(course_track_id, state))').eq('state', 'published').eq('chapters.state', 'published').eq('chapters.lesson_courses.state', 'published').eq('chapters.lesson_courses.course_track_id', trackId);
    return (res.data ?? []).length;
  }

  /**
   * Published collections of the pair, the API's own rule (`course-capabilities.ts`): `tests/integration/audio-library`
   * seeds a published arabic-moroccan × fr collection and runs concurrently under `pnpm -r test`, so the audio-library
   * expectation is read from the database right before each call instead of being hardcoded to 0. The per-pair counts
   * cache (60 s) is cleared on the app under test first, otherwise it could answer with a count from before the seed.
   */
  async function audioLibraryTruth(h: StackHarness, trackId: CourseTrackId, source: SourceLanguageCode): Promise<{ available: boolean; publishedCollections: number }> {
    await h.app.shared.cache.delete(courseCapabilityCountsKey(trackId, source));
    const res = await h.service.from('audio_course_collections').select('id', { count: 'exact', head: true }).eq('state', 'published').eq('course_track_id', trackId).eq('instruction_language_code', source);
    const publishedCollections = res.count ?? 0;
    return { available: publishedCollections > 0, publishedCollections };
  }

  it('arabic-moroccan × fr with AI configured: missions (6) available, no audio library, voice conversation, reference-comparison pronunciation', async () => {
    const audio = await audioLibraryTruth(withAi, 'arabic-moroccan', 'fr');
    const res = await call(withAi.app, '/v1/courses/arabic-moroccan/coverage?source=fr');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const caps = res.json.data.capabilities;
    expect(caps).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary' });
    const expectedMissions = await publishedMissionCount(withAi, 'arabic-moroccan');
    expect(expectedMissions).toBeGreaterThanOrEqual(6);
    expect(caps.missions).toEqual({ available: true, publishedCount: expectedMissions, localizedCount: expectedMissions });
    expect(caps.audioLibrary).toEqual(audio);
    expect(caps.liveConversation.available).toBe(true);
    expect(caps.liveConversation.characterCount).toBeGreaterThan(0);
    expect(['text_and_voice', 'text_only']).toContain(caps.liveConversation.mode);
    expect(caps.liveConversation.mode).toBe('text_and_voice'); // Darija: STT + TTS are `limited` (usable), per the matrix
    expect(caps.pronunciationScoring.mode).toBe('reference_comparison'); // no Azure assessment locale for ar-MA
    expect(caps.offlineDownloads.available).toBe(false); // no R2 in the test environment, and nothing to download
    expect(caps.instructionLanguage).toMatchObject({ status: 'partial', nativeReviewed: false });
    expect(caps.scripts.modes).toEqual(['native', 'latin', 'both']);
    expect(caps.regionalOptions.map((o: { id: string }) => o.id)).toContain('casablanca');
    const keys = caps.missing.map((m: { key: string }) => m.key);
    // No audio library → disclosed as such; a seeded library without media storage → disclosed as no offline downloads.
    expect(keys).toContain(audio.available ? 'no_offline_downloads' : 'no_audio_library');
    expect(keys).toContain('no_pronunciation_scoring');
    expect(keys).not.toContain('no_missions');
    expect(keys).not.toContain('no_live_conversation');
    expect(caps.missing.every((m: { severity: string; i18nKey: string }) => m.severity === 'info' && m.i18nKey.startsWith('enrollment.disclaimer.'))).toBe(true);
    // Coverage list itself is unchanged (backward compatible).
    expect(res.json.data.coverage).toHaveLength(1);
    expect(res.json.data.coverage[0].sourceLanguageCode).toBe('fr');
  });

  it('without any AI provider the same pair reports conversation none and no spoken feedback (never a pretend text_only)', async () => {
    const audio = await audioLibraryTruth(plain, 'arabic-moroccan', 'fr');
    const res = await call(plain.app, '/v1/courses/arabic-moroccan/coverage?source=fr');
    const caps = res.json.data.capabilities;
    expect(caps.audioLibrary).toEqual(audio);
    expect(caps.liveConversation).toMatchObject({ available: false, mode: 'none' });
    expect(caps.liveConversation.characterCount).toBeGreaterThan(0); // the count is still reported honestly
    expect(caps.pronunciationScoring.mode).toBe('none');
    expect(caps.missions.available).toBe(true); // missions do not depend on AI
    const keys = caps.missing.map((m: { key: string }) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['no_live_conversation', 'no_pronunciation_feedback', audio.available ? 'no_offline_downloads' : 'no_audio_library']));
  });

  it('swahili × en: planned pair → blocking disclaimer first, missions unavailable, scripts native only', async () => {
    const res = await call(withAi.app, '/v1/courses/swahili/coverage?source=en');
    expect(res.status).toBe(200);
    const caps = res.json.data.capabilities;
    expect(caps.targetVarietyId).toBe('sw');
    expect(caps.missions).toEqual({ available: false, publishedCount: await publishedMissionCount(withAi, 'swahili'), localizedCount: 0 });
    expect(caps.instructionLanguage.status).toBe('planned');
    expect(caps.missing[0]).toEqual({ key: 'instruction_language_planned', i18nKey: 'enrollment.disclaimer.instructionLanguagePlanned', severity: 'blocking' });
    expect(caps.missing.map((m: { key: string }) => m.key)).toContain('no_missions');
    expect(caps.scripts.modes).toEqual(['native']);
  });

  it('coverage without ?source= stays as before (no capabilities field), and the counts are cached per pair', async () => {
    const all = await call(withAi.app, '/v1/courses/japanese/coverage');
    expect(all.status).toBe(200);
    expect(all.json.data.capabilities).toBeUndefined();
    expect(all.json.data.coverage.length).toBeGreaterThanOrEqual(23);
    const key = courseCapabilityCountsKey('japanese', 'fr');
    await withAi.app.shared.cache.delete(key);
    expect(await withAi.app.shared.cache.get(key)).toBeNull();
    const one = await call(withAi.app, '/v1/courses/japanese/coverage?source=fr');
    expect(one.json.data.capabilities.instructionLanguage.status).toBe('planned');
    expect(one.json.data.capabilities.missions.available).toBe(false); // published missions exist, but the pair is planned
    const cached = await withAi.app.shared.cache.get(key);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!.body)).toMatchObject({ publishedMissions: await publishedMissionCount(withAi, 'japanese') });
    // Publish/unpublish of the course purges the counts together with the manifest keys.
    await withAi.app.shared.cache.invalidateCourse('japanese', 'fr');
    expect(await withAi.app.shared.cache.get(key)).toBeNull();
  });

  it('every enrollment DTO carries the snapshot of its own (track, source) pair, including after a source change', async () => {
    const audio = await audioLibraryTruth(withAi, 'arabic-moroccan', 'fr');
    const created = await call(withAi.app, '/v1/me/enrollments', { token: learner.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' } });
    expect(created.status).toBe(201);
    expect(created.json.data.capabilities).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', missions: { available: true }, audioLibrary: audio, liveConversation: { available: true } });
    const id = created.json.data.id as string;
    const me = await call(withAi.app, '/v1/me', { token: learner.token });
    expect(me.json.data.enrollments).toHaveLength(1);
    expect(me.json.data.enrollments[0].capabilities.missing.map((m: { key: string }) => m.key)).toContain(audio.available ? 'no_offline_downloads' : 'no_audio_library');
    const list = await call(withAi.app, '/v1/me/enrollments', { token: learner.token });
    expect(list.json.data.enrollments[0].capabilities.sourceLanguageCode).toBe('fr');
    const patched = await call(withAi.app, `/v1/me/enrollments/${id}`, { method: 'PATCH', token: learner.token, body: { sourceLanguageCode: 'es' } });
    expect(patched.status).toBe(200);
    expect(patched.json.data.capabilities.sourceLanguageCode).toBe('es');
    expect(patched.json.data.capabilities.instructionLanguage.status).toBe('planned'); // no es coverage row for Darija yet
    expect(patched.json.data.capabilities.missions.available).toBe(false);
    expect(patched.json.data.capabilities.missing.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(['instruction_language_planned', 'partial_interface_language']));
    const back = await call(withAi.app, `/v1/me/enrollments/${id}`, { method: 'PATCH', token: learner.token, body: { sourceLanguageCode: 'fr' } });
    expect(back.json.data.capabilities.missions.available).toBe(true);
  });

  it('the course manifest carries the snapshot on both cache paths, and its ETag changes with the capabilities', async () => {
    const miss = await call(withAi.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    expect(miss.status).toBe(200);
    expect(miss.json.data.capabilities).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', liveConversation: { available: true } });
    const etag = miss.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{32}-[0-9a-f]{12}"$/);
    const hit = await call(withAi.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    expect(hit.headers.get('x-cache')).toBe('HIT');
    const { computedAt: _hitAt, ...hitCaps } = hit.json.data.capabilities;
    const { computedAt: _missAt, ...missCaps } = miss.json.data.capabilities;
    expect(hitCaps).toEqual(missCaps);
    expect(hit.json.data.checksum).toBe(miss.json.data.checksum);
    expect(hit.headers.get('etag')).toBe(etag);
    const notModified = await call(withAi.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token, headers: { 'if-none-match': etag } });
    expect(notModified.status).toBe(304);
    // Same manifest bytes without AI: same checksum, different capabilities, different ETag → no stale 304.
    const plainRes = await call(plain.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token, headers: { 'if-none-match': etag } });
    expect(plainRes.status).toBe(200);
    expect(plainRes.json.data.checksum).toBe(miss.json.data.checksum);
    expect(plainRes.json.data.capabilities.liveConversation.mode).toBe('none');
    expect(plainRes.headers.get('etag')).not.toBe(etag);
    expect(plainRes.headers.get('etag')!.slice(0, 33)).toBe(etag.slice(0, 33)); // same content prefix
  });
});
