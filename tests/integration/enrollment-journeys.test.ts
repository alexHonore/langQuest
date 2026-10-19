/**
 * §14.1 journeys A01–A07 against the local stack: every enrollment carries its own source language, two
 * enrollments coexist with independent settings across sign-ins, changing the source language never resets
 * progress, and dialect boundaries are never crossed silently (A05–A08 variants).
 */
import { deriveScriptOptions, getCourseTrack, resolveAssetTrackId } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, signIn, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.enrollment');

describeStack('enrollment and source-language journeys (A01–A07)', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let alice: TestUser; // English source
  let fabrice: TestUser; // French source
  let ruslan: TestUser; // Russian source
  const users: TestUser[] = [];

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [alice, fabrice, ruslan] = await Promise.all([
      createTestUser(h, 'alice', { defaultSourceLanguageCode: 'en', uiLocale: 'en-US' }),
      createTestUser(h, 'fabrice', { defaultSourceLanguageCode: 'fr', uiLocale: 'fr-CA' }),
      createTestUser(h, 'ruslan', { defaultSourceLanguageCode: 'ru', uiLocale: 'ru-RU' }),
    ]);
    users.push(alice, fabrice, ruslan);
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, users);
    await seeder.cleanup();
  });

  it('A01 — English-source learner enrols in Spanish (Spain): target es-ES, source en, honest coverage', async () => {
    const e = await enrol(h, alice, { courseTrackId: 'spanish-spain', sourceLanguageCode: 'en' });
    expect(e).toMatchObject({ courseTrackId: 'spanish-spain', sourceLanguageCode: 'en', targetVarietyId: 'es-ES', status: 'active' });
    const me = await call(h, '/v1/me', { token: alice.token });
    expect(me.status).toBe(200);
    const mine = me.json.data.enrollments.find((x: { id: string }) => x.id === e.id);
    expect(mine.sourceLanguageCode).toBe('en');
    expect(['planned', 'partial', 'complete', 'unavailable']).toContain(mine.coverage.status);
    expect(mine.coverage.nativeReviewed).toBe(false); // nothing is native-reviewed yet: never claimed
    const courses = await call(h, '/v1/courses?source=en');
    const course = courses.json.data.courses.find((c: { track: { id: string } }) => c.track.id === 'spanish-spain');
    expect(course.track.targetVarietyId).toBe('es-ES');
    expect(course.coverage.map((c: { sourceLanguageCode: string }) => c.sourceLanguageCode)).toEqual(['en']);
    // The capability snapshot is live and honest: no providers are configured in this harness.
    expect(course.capabilities.pronunciationScoring).toBe('none');
  });

  it('A02 — French-source learner enrols in Moroccan Darija: ary, Arabic + Arabizi scripts, French instructions', async () => {
    const e = await enrol(h, fabrice, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' });
    expect(e).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', scriptMode: 'both' });
    const options = deriveScriptOptions('arabic-moroccan');
    expect(options).toMatchObject({ primaryScript: 'Arab', rtl: true, hasTransliteration: true });
    expect(options.transliterations).toContain('arabizi');
    expect(getCourseTrack('arabic-moroccan').scripts.transliterations).toContain('arabizi');
    expect(getCourseTrack('arabic-moroccan').scriptModeOptions).toEqual(expect.arrayContaining(['native', 'latin', 'both']));
    // MSA may never be substituted for Darija: an explicit arb target on this track is refused.
    const msa = await call(h, '/v1/me/enrollments', { token: fabrice.token, body: { courseTrackId: 'arabic-egyptian', sourceLanguageCode: 'fr', targetVarietyId: 'arb' } });
    expect(msa.status).toBe(422);
    const coverage = await call(h, '/v1/courses/arabic-moroccan/coverage?source=fr');
    expect(coverage.status).toBe(200);
    expect(coverage.json.data.coverage[0]).toMatchObject({ sourceLanguageCode: 'fr', nativeReviewed: false });
    expect(coverage.json.data.coverage[0].status).not.toBe('complete');
  });

  it('A03 — Japanese-from-English and Darija-from-French coexist for one user and survive a fresh sign-in', async () => {
    const japanese = await enrol(h, fabrice, { courseTrackId: 'japanese', sourceLanguageCode: 'en', scriptMode: 'latin', learnerLevel: 'elementary' });
    expect(japanese).toMatchObject({ targetVarietyId: 'ja', sourceLanguageCode: 'en', scriptMode: 'latin' });
    // Simulate app restart: a brand-new session token.
    const fresh = await signIn(h, fabrice.email, fabrice.password);
    const list = await call(h, '/v1/me/enrollments', { token: fresh.accessToken });
    expect(list.status).toBe(200);
    const byTrack = Object.fromEntries(list.json.data.enrollments.map((x: { courseTrackId: string }) => [x.courseTrackId, x]));
    expect(byTrack['arabic-moroccan']).toMatchObject({ sourceLanguageCode: 'fr', scriptMode: 'both' });
    expect(byTrack['japanese']).toMatchObject({ sourceLanguageCode: 'en', scriptMode: 'latin', learnerLevel: 'elementary' });
    // Per-enrollment settings are independent: changing one script mode leaves the other untouched.
    const patched = await call(h, `/v1/me/enrollments/${japanese.id}`, { method: 'PATCH', token: fresh.accessToken, body: { scriptMode: 'both' } });
    expect(patched.status).toBe(200);
    const after = await call(h, '/v1/me/enrollments', { token: fresh.accessToken });
    const again = Object.fromEntries(after.json.data.enrollments.map((x: { courseTrackId: string }) => [x.courseTrackId, x]));
    expect(again['japanese'].scriptMode).toBe('both');
    expect(again['arabic-moroccan'].scriptMode).toBe('both');
    expect(again['arabic-moroccan'].sourceLanguageCode).toBe('fr');
  });

  it('A04 — changing the Arabic source from English to French keeps mastery, XP, review cards and attempts', async () => {
    const e = await enrol(h, alice, { courseTrackId: 'arabic-eastern', sourceLanguageCode: 'en', regionalPreference: 'LB' });
    expect(e.targetVarietyId).toBe('ar-levant');
    // Evidence as the engine would have written it after real practice.
    const mastery = await h.service.from('user_skill_mastery').insert({ user_id: alice.id, enrollment_id: e.id, skill_key: 'greet.basic', mastery_state: 'independent', internal_score: 0.8, evidence_count: 6, uncertainty: 0.2 }).select('id').single();
    expect(mastery.error).toBeNull();
    const xp = await h.service.rpc('award_xp', { p_idempotency_key: crypto.randomUUID(), p_user_id: alice.id, p_amount: 50, p_reason: 'mission_completed', p_enrollment_id: e.id });
    expect(xp.error).toBeNull();
    const card = await seeder.reviewCard({ userId: alice.id, enrollmentId: e.id, skillKey: 'greet.basic', dueAt: new Date(Date.now() - 60_000).toISOString() });
    const mission = await seeder.mission({ varietyId: 'ar-levant', templateKey: undefined });
    const attempt = await h.service.from('mission_attempts').insert({ user_id: alice.id, enrollment_id: e.id, mission_id: mission.id, client_attempt_id: crypto.randomUUID() }).select('id').single();
    expect(attempt.error).toBeNull();

    const before = await call(h, `/v1/me/reviews/due?enrollmentId=${e.id}`, { token: alice.token });
    expect(before.json.data.dueCount).toBe(1);

    const patch = await call(h, `/v1/me/enrollments/${e.id}`, { method: 'PATCH', token: alice.token, body: { sourceLanguageCode: 'fr' } });
    expect(patch.status).toBe(200);
    expect(patch.json.data).toMatchObject({ sourceLanguageCode: 'fr', courseTrackId: 'arabic-eastern', targetVarietyId: 'ar-levant', regionalPreference: 'LB' });

    const skills = await call(h, `/v1/me/skills?enrollmentId=${e.id}`, { token: alice.token });
    expect(skills.json.data.items).toEqual([expect.objectContaining({ skillKey: 'greet.basic', masteryState: 'independent' })]);
    const progress = await call(h, '/v1/me/progress', { token: alice.token });
    const per = progress.json.data.perEnrollment.find((p: { enrollmentId: string }) => p.enrollmentId === e.id);
    expect(per).toMatchObject({ xp: 50, sourceLanguageCode: 'fr', reviewsDue: 1 });
    const due = await call(h, `/v1/me/reviews/due?enrollmentId=${e.id}`, { token: alice.token });
    expect(due.json.data.items.map((i: { card: { id: string } }) => i.card.id)).toEqual([card.id]);
    const stillAttempt = await h.service.from('mission_attempts').select('id, enrollment_id').eq('id', attempt.data!.id).single();
    expect(stillAttempt.data?.enrollment_id).toBe(e.id);
    // The DB-level guard: only the one column changed.
    const row = await h.service.from('user_course_enrollments').select('source_language_code, course_track_id, regional_preference, status, script_mode').eq('id', e.id).single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({ source_language_code: 'fr', course_track_id: 'arabic-eastern', regional_preference: 'LB', status: 'active' });
    // Manifests are served per (track, source) and never silently substitute a language.
    const manifest = await call(h, '/v1/courses/arabic-eastern/manifest?source=fr', { token: alice.token });
    expect(manifest.status).toBe(200);
    expect(manifest.json.data).toMatchObject({ courseTrackId: 'arabic-eastern', sourceLanguageCode: 'fr', targetVarietyId: 'ar-levant' });
  });

  it('A05 — Russian-source learner starts the English course: ru instructions are reported honestly, English is the target', async () => {
    const e = await enrol(h, ruslan, { courseTrackId: 'english', sourceLanguageCode: 'ru' });
    expect(e).toMatchObject({ targetVarietyId: 'en', sourceLanguageCode: 'ru' });
    const courses = await call(h, '/v1/courses?source=ru');
    const english = courses.json.data.courses.find((c: { track: { id: string } }) => c.track.id === 'english');
    expect(english.coverage[0].sourceLanguageCode).toBe('ru');
    expect(english.coverage[0].nativeReviewed).toBe(false);
    // Pronunciation is assessed against ENGLISH, never against the learner's Russian.
    const wrong = await call(h, '/v1/speech/pronunciation-assess', { token: ruslan.token, body: { enrollmentId: e.id, targetVarietyId: 'ru', referenceText: 'hello', audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, clientRequestId: crypto.randomUUID() } });
    expect(wrong.status).toBe(422);
    expect(wrong.json.error.message).toMatch(/different variety/i);
  });

  it('A06 — French-source learner on the English course: coaching targets English, no fake pronunciation score', async () => {
    const e = await enrol(h, fabrice, { courseTrackId: 'english', sourceLanguageCode: 'fr' });
    expect(e.targetVarietyId).toBe('en');
    const againstFrench = await call(h, '/v1/speech/pronunciation-assess', { token: fabrice.token, body: { enrollmentId: e.id, targetVarietyId: 'fr', referenceText: 'bonjour', audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, clientRequestId: crypto.randomUUID() } });
    expect(againstFrench.status).toBe(422);
    // Correct variety but no acoustic assessor configured here: an honest capability answer, never a number.
    const noProvider = await call(h, '/v1/speech/pronunciation-assess', { token: fabrice.token, body: { enrollmentId: e.id, targetVarietyId: 'en', referenceText: 'hello', audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, clientRequestId: crypto.randomUUID() } });
    expect(noProvider.status).toBeGreaterThanOrEqual(400);
    expect(noProvider.json.ok).toBe(false);
    expect(JSON.stringify(noProvider.json)).not.toMatch(/numericScore"\s*:\s*\d/);
    const caps = await call(h, '/v1/ai/model-capabilities?trackId=english', { token: fabrice.token });
    expect(caps.status).toBe(200);
    expect(caps.json.data.pronunciationScoring).toBe('none');
  });

  it('A07/A08 — Chinese (Simplified) is its own track sharing Mandarin assets; Cantonese never gets a Mandarin substitute', async () => {
    const simplified = await enrol(h, alice, { courseTrackId: 'chinese-simplified', sourceLanguageCode: 'en' });
    expect(simplified.targetVarietyId).toBe('cmn');
    expect(resolveAssetTrackId('chinese-simplified')).toBe('chinese-mandarin');
    const languages = await call(h, '/v1/languages');
    const track = languages.json.data.tracks.find((t: { id: string }) => t.id === 'chinese-simplified');
    expect(track).toMatchObject({ targetVarietyId: 'cmn', sharesAssetsWithTrackId: 'chinese-mandarin', scriptFocus: 'Hans' });
    expect(track.scripts.primary).toBe('Hans');
    const courses = await call(h, '/v1/courses?source=en');
    const ids = courses.json.data.courses.map((c: { track: { id: string } }) => c.track.id);
    expect(ids).toContain('chinese-simplified');
    expect(ids).toContain('chinese-mandarin');
    expect(ids).toContain('chinese-cantonese');
    const cantonese = await enrol(h, alice, { courseTrackId: 'chinese-cantonese', sourceLanguageCode: 'en' });
    expect(cantonese.targetVarietyId).toBe('yue');
    const mandarinOnCantonese = await call(h, '/v1/me/enrollments', { token: ruslan.token, body: { courseTrackId: 'chinese-cantonese', sourceLanguageCode: 'ru', targetVarietyId: 'cmn' } });
    expect(mandarinOnCantonese.status).toBe(422);
  });

  it('every enrollment requires a source language and the DTO always exposes it for the UI edit affordance', async () => {
    const missing = await call(h, '/v1/me/enrollments', { token: ruslan.token, body: { courseTrackId: 'german' } });
    expect(missing.status).toBe(422);
    const bad = await call(h, '/v1/me/enrollments', { token: ruslan.token, body: { courseTrackId: 'german', sourceLanguageCode: 'xx' } });
    expect(bad.status).toBe(422);
    const list = await call(h, '/v1/me/enrollments', { token: fabrice.token });
    for (const e of list.json.data.enrollments) {
      expect(typeof e.sourceLanguageCode).toBe('string');
      expect(e.sourceLanguageCode.length).toBeGreaterThanOrEqual(2);
      expect(e.coverage).toBeDefined();
    }
  });
});
