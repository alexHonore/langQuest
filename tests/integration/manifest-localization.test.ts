/**
 * ADR-004 / §2.1: the course manifest is built per (track, source) from PUBLISHED rows only, localized through
 * `mission_localizations` / editorial translations, cached by ETag per source, and never substitutes a language
 * silently (missing titles are empty with `titleLanguageCode: null`, not English).
 */
import { CourseManifestSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.manifest');

interface ManifestMissionView {
  id: string;
  title: string;
  titleLanguageCode: string | null;
  localizationComplete: boolean;
}

describeStack('course manifest localization and caching', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let publishedMissionId: string;
  let draftMissionId: string;
  const TRACK = 'haitian-creole';
  const VARIETY = 'ht';

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'manifest', { defaultSourceLanguageCode: 'fr' });
    await enrol(h, learner, { courseTrackId: TRACK, sourceLanguageCode: 'fr' });
    const course = await seeder.course({ trackId: TRACK, titles: { en: 'Creole course', fr: 'Cours de créole' } });
    const chapter = await seeder.chapter({ courseId: course.id, titles: { en: 'At the market', fr: 'Au marché' } });
    const published = await seeder.mission({ chapterId: chapter.id, varietyId: VARIETY, titles: { en: 'Buy mangoes', fr: 'Acheter des mangues' }, goals: [{ id: 'g1', skill_keys: ['shop.ask_price'] }] });
    publishedMissionId = published.id;
    await seeder.steps(published.id, ['context_listening', 'modeled_expression', 'anticipation']);
    await seeder.localization(published.id, 'fr', { title: 'Acheter des mangues (localisé)', qaState: 'reviewed' });
    await seeder.localization(published.id, 'en', { title: 'Buy mangoes (localized)', qaState: 'machine_draft' });
    const draft = await seeder.mission({ chapterId: chapter.id, varietyId: VARIETY, state: 'review_needed', titles: { en: 'Draft mission' }, sortOrder: 1 });
    draftMissionId = draft.id;
  });

  afterAll(async () => {
    await h.app.flush();
    await seeder.cleanup();
    await deleteTestUsers(h, [learner]);
  });

  const missionsOf = <M extends { id: string }>(manifest: { chapters: Array<{ missions: M[] }> }): M[] => manifest.chapters.flatMap((c) => c.missions);

  it('serves the French overlay for source=fr and validates against the contract', async () => {
    const res = await call(h, `/v1/courses/${TRACK}/manifest?source=fr`, { token: learner.token });
    expect(res.status).toBe(200);
    const manifest = CourseManifestSchema.parse(res.json.data);
    expect(manifest).toMatchObject({ courseTrackId: TRACK, sourceLanguageCode: 'fr', targetVarietyId: VARIETY });
    const chapter = manifest.chapters.find((c) => c.missions.some((m) => m.id === publishedMissionId));
    expect(chapter?.title).toBe('Au marché');
    expect(chapter?.titleLanguageCode).toBe('fr');
    const mission = missionsOf(manifest).find((m) => m.id === publishedMissionId)!;
    expect(mission.title).toBe('Acheter des mangues (localisé)');
    expect(mission.titleLanguageCode).toBe('fr');
    expect(mission.localizationComplete).toBe(true); // reviewed localization
    expect(mission.steps.map((s) => s.type)).toEqual(['context_listening', 'modeled_expression', 'anticipation']);
    expect(mission.skillKeys).toEqual(['shop.ask_price']);
  });

  it('serves the English overlay for source=en with an honest "not complete" flag for a machine draft', async () => {
    const res = await call(h, `/v1/courses/${TRACK}/manifest?source=en`, { token: learner.token });
    expect(res.status).toBe(200);
    const mission = missionsOf<ManifestMissionView>(res.json.data).find((m) => m.id === publishedMissionId)!;
    expect(mission.title).toBe('Buy mangoes (localized)');
    expect(mission.titleLanguageCode).toBe('en');
    expect(mission.localizationComplete).toBe(false);
  });

  it('never substitutes a language silently: an unlocalized source yields empty titles with a null language', async () => {
    const res = await call(h, `/v1/courses/${TRACK}/manifest?source=sw`, { token: learner.token });
    expect(res.status).toBe(200);
    const coverage = await h.service.from('course_source_localizations').select('fallback_source_language_code').eq('course_track_id', TRACK).eq('source_language_code', 'sw').maybeSingle();
    const fallback = coverage.data?.fallback_source_language_code ?? null;
    const mission = missionsOf<ManifestMissionView>(res.json.data).find((m) => m.id === publishedMissionId)!;
    expect(mission.localizationComplete).toBe(false);
    if (fallback) {
      // An opt-in fallback the coverage row declares is allowed, but it must be labelled as such.
      expect(mission.titleLanguageCode).toBe(fallback);
    } else {
      expect(mission.title).toBe('');
      expect(mission.titleLanguageCode).toBeNull();
    }
    expect(mission.title).not.toBe('Buy mangoes (localized)');
  });

  it('excludes unpublished missions and rejects unknown tracks / sources', async () => {
    const res = await call(h, `/v1/courses/${TRACK}/manifest?source=fr`, { token: learner.token });
    expect(missionsOf(res.json.data).map((m) => m.id)).not.toContain(draftMissionId);
    expect((await call(h, '/v1/courses/klingon/manifest?source=fr', { token: learner.token })).status).toBe(422);
    expect((await call(h, `/v1/courses/${TRACK}/manifest?source=zz`, { token: learner.token })).status).toBe(422);
    expect((await call(h, `/v1/courses/${TRACK}/manifest?source=fr`)).status).toBe(401);
  });

  it('is cached per source with distinct ETags and answers 304 on a matching If-None-Match', async () => {
    const fr = await call(h, `/v1/courses/${TRACK}/manifest?source=fr`, { token: learner.token });
    const en = await call(h, `/v1/courses/${TRACK}/manifest?source=en`, { token: learner.token });
    const frTag = fr.headers.get('etag');
    const enTag = en.headers.get('etag');
    expect(frTag).toBeTruthy();
    expect(enTag).toBeTruthy();
    expect(frTag).not.toBe(enTag);
    expect(fr.headers.get('cache-control')).toContain('private');
    const cached = await call(h, `/v1/courses/${TRACK}/manifest?source=fr`, { token: learner.token, headers: { 'if-none-match': frTag! } });
    expect(cached.status).toBe(304);
    const hit = await call(h, `/v1/courses/${TRACK}/manifest?source=fr`, { token: learner.token });
    expect(hit.status).toBe(200);
    expect(hit.headers.get('x-cache')).toBe('HIT');
    expect(hit.json.data.checksum).toBe(fr.json.data.checksum);
  });

  it('mission detail follows the enrollment source and refuses a mismatching source for that enrollment', async () => {
    const list = await call(h, '/v1/me/enrollments', { token: learner.token });
    const enrollmentId = list.json.data.enrollments.find((e: { courseTrackId: string }) => e.courseTrackId === TRACK).id;
    const fr = await call(h, `/v1/missions/${publishedMissionId}?source=fr&enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(fr.status).toBe(200);
    expect(fr.json.data).toMatchObject({ sourceLanguageCode: 'fr', targetVarietyId: VARIETY, title: 'Acheter des mangues (localisé)' });
    const mismatch = await call(h, `/v1/missions/${publishedMissionId}?source=en&enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(mismatch.status).toBe(422);
    const draft = await call(h, `/v1/missions/${draftMissionId}?source=fr`, { token: learner.token });
    expect(draft.status).toBe(404); // RLS: unpublished content is invisible to learners
  });
});
