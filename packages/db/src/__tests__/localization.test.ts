/**
 * Language-independence invariants against the LOCAL Supabase stack (§2.1, §2.3, §10.1):
 *
 * - script_mode is derived from the TARGET track (catalog default, validated options) both in the
 *   repository and by the `resolve_enrollment_script_mode` trigger (migration 090);
 * - the course manifest never silently substitutes English (or any language) for a missing
 *   source-language title — only the coverage row's declared fallback, and always labelled.
 *
 * Skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then the file fails).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServiceClient, type DbClient } from '../client';
import { createRepositories } from '../repositories';
import {
  createTestUser,
  deleteTestUsers,
  describeWithStack,
  stackEnv,
  testKey,
  type TestUser,
} from './stack';

const describeStack = describeWithStack('localization.test');

describeStack('script mode and honest manifest localization (local stack)', () => {
  let service: DbClient;
  let svc: ReturnType<typeof createRepositories>;
  let userA: TestUser;
  const createdUserIds: string[] = [];
  const TRACK = 'arabic-moroccan';
  let lessonCourseId: string;
  let chapterId: string;
  let missionId: string;

  beforeAll(async () => {
    service = createServiceClient(stackEnv);
    svc = createRepositories(service);
    userA = await createTestUser(service, 'loc-a');
    createdUserIds.push(userA.id);

    // Published Darija course whose editorial titles exist in English and Spanish only (no French).
    const course = await service
      .from('lesson_courses')
      .insert({
        course_track_id: TRACK,
        title_translations: { en: 'Darija basics' },
        state: 'published',
        published_revision: 1,
        sort_order: 900,
      })
      .select('id')
      .single();
    if (course.error) throw course.error;
    lessonCourseId = course.data.id;
    const chapter = await service
      .from('chapters')
      .insert({
        lesson_course_id: lessonCourseId,
        title_translations: { en: 'At the café', es: 'En el café' },
        description_translations: { en: 'Ordering' },
        state: 'published',
        sort_index: 0,
      })
      .select('id')
      .single();
    if (chapter.error) throw chapter.error;
    chapterId = chapter.data.id;
    const mission = await service
      .from('missions')
      .insert({
        chapter_id: chapterId,
        target_variety_id: 'ary',
        title_translations: { en: 'Order tea', es: 'Pedir té' },
        state: 'published',
        published_revision: 1,
        template_key: testKey('test.mission'),
      })
      .select('id')
      .single();
    if (mission.error) throw mission.error;
    missionId = mission.data.id;
  }, 60000);

  afterAll(async () => {
    await service
      .from('course_source_localizations')
      .update({ fallback_source_language_code: null })
      .eq('course_track_id', TRACK)
      .eq('source_language_code', 'fr');
    if (lessonCourseId) await service.from('lesson_courses').delete().eq('id', lessonCourseId);
    await deleteTestUsers(service, createdUserIds);
  });

  it('stores the catalog default script mode of the TARGET track when the client omits it', async () => {
    const asA = createRepositories(userA.client);
    const darija = await asA.enrollments.create({
      userId: userA.id,
      courseTrackId: 'arabic-moroccan',
      sourceLanguageCode: 'fr',
    });
    expect(darija.script_mode).toBe('both'); // Arabic + Arabizi both first-class, regardless of source 'fr'
    const cantonese = await asA.enrollments.create({
      userId: userA.id,
      courseTrackId: 'chinese-cantonese',
      sourceLanguageCode: 'en',
    });
    expect(cantonese.script_mode).toBe('both'); // Traditional characters + Jyutping
    const french = await asA.enrollments.create({
      userId: userA.id,
      courseTrackId: 'french',
      sourceLanguageCode: 'en',
    });
    expect(french.script_mode).toBe('native');
  });

  it('the DB trigger fills an omitted script_mode from course_tracks.default_script_mode for any writer', async () => {
    const raw = await service
      .from('user_course_enrollments')
      .insert({
        user_id: userA.id,
        course_track_id: 'arabic-eastern',
        source_language_code: 'en',
      } as never)
      .select('script_mode')
      .single();
    expect(raw.error).toBeNull();
    expect(raw.data?.script_mode).toBe('both');
  });

  it('rejects a script mode the track does not offer, in the repository and in the DB', async () => {
    const asA = createRepositories(userA.client);
    await expect(
      asA.enrollments.create({
        userId: userA.id,
        courseTrackId: 'german',
        sourceLanguageCode: 'fr',
        scriptMode: 'latin',
      }),
    ).rejects.toThrow(/not supported by track 'german'/);
    const raw = await service
      .from('user_course_enrollments')
      .insert({
        user_id: userA.id,
        course_track_id: 'german',
        source_language_code: 'fr',
        script_mode: 'latin',
      });
    expect(raw.error?.code).toBe('23514'); // check_violation from resolve_enrollment_script_mode()
    expect(raw.error?.message).toMatch(/not supported by course track german/);
    // Updates are validated too (repository + trigger).
    const darija = (await asA.enrollments.listForUser(userA.id)).find(
      (e) => e.course_track_id === 'arabic-moroccan',
    )!;
    expect((await asA.enrollments.update(darija.id, { script_mode: 'latin' })).script_mode).toBe(
      'latin',
    );
    await expect(asA.enrollments.update(darija.id, { script_mode: 'arabizi' })).rejects.toThrow(
      /not supported/,
    );
    const rawUpd = await service
      .from('user_course_enrollments')
      .update({ script_mode: 'both' })
      .eq(
        'id',
        (await asA.enrollments.listForUser(userA.id)).find((e) => e.course_track_id === 'french')!
          .id,
      );
    expect(rawUpd.error?.code).toBe('23514');
  });

  it('manifest for a source without titles returns empty, labelled titles — never English', async () => {
    const manifest = await svc.curriculum.buildManifest(TRACK, 'fr', 'ary');
    const chapter = manifest.chapters.find((c) => c.id === chapterId);
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe('');
    expect(chapter!.titleLanguageCode).toBeNull();
    expect(chapter!.localizationComplete).toBe(false);
    expect(chapter!.description).toBeNull();
    const mission = chapter!.missions.find((m) => m.id === missionId)!;
    expect(mission.title).toBe('');
    expect(mission.titleLanguageCode).toBeNull();
    expect(mission.localizationComplete).toBe(false);
    // The English title was available and was deliberately NOT used.
    expect(JSON.stringify(chapter)).not.toContain('At the café');
    expect(JSON.stringify(mission)).not.toContain('Order tea');
  });

  it('uses only the fallback language the coverage row declares, and labels it', async () => {
    await svc.catalog.updateCoverage(TRACK, 'fr', { fallback_source_language_code: 'en' });
    const manifest = await svc.curriculum.buildManifest(TRACK, 'fr', 'ary');
    const chapter = manifest.chapters.find((c) => c.id === chapterId)!;
    expect(chapter.title).toBe('At the café');
    expect(chapter.titleLanguageCode).toBe('en');
    expect(chapter.localizationComplete).toBe(false);
    const mission = chapter.missions.find((m) => m.id === missionId)!;
    expect(mission.title).toBe('Order tea');
    expect(mission.titleLanguageCode).toBe('en');
    expect(mission.localizationComplete).toBe(false);

    // A Spanish fallback must not leak English either.
    await svc.catalog.updateCoverage(TRACK, 'fr', { fallback_source_language_code: 'es' });
    const es = (await svc.curriculum.buildManifest(TRACK, 'fr', 'ary')).chapters.find(
      (c) => c.id === chapterId,
    )!;
    expect(es.title).toBe('En el café');
    expect(es.titleLanguageCode).toBe('es');
    expect(es.missions.find((m) => m.id === missionId)!.title).toBe('Pedir té');
  });

  it('a French mission localization and chapter title make the manifest complete for fr', async () => {
    await svc.curriculum.upsertMissionLocalization({
      mission_id: missionId,
      source_language_code: 'fr',
      title: 'Commander un thé',
      instructions: 'Commandez un thé à la menthe.',
      qa_state: 'approved',
    });
    await service
      .from('chapters')
      .update({ title_translations: { en: 'At the café', es: 'En el café', fr: 'Au café' } })
      .eq('id', chapterId);
    await svc.catalog.updateCoverage(TRACK, 'fr', { fallback_source_language_code: null });
    const manifest = await svc.curriculum.buildManifest(TRACK, 'fr', 'ary');
    const chapter = manifest.chapters.find((c) => c.id === chapterId)!;
    expect(chapter.title).toBe('Au café');
    expect(chapter.titleLanguageCode).toBe('fr');
    expect(chapter.localizationComplete).toBe(true);
    const mission = chapter.missions.find((m) => m.id === missionId)!;
    expect(mission.title).toBe('Commander un thé');
    expect(mission.titleLanguageCode).toBe('fr');
    expect(mission.localizationComplete).toBe(true);
    // A different source stays honest at the same time (no cross-contamination from fr/en).
    const ru = (await svc.curriculum.buildManifest(TRACK, 'ru', 'ary')).chapters.find(
      (c) => c.id === chapterId,
    )!;
    expect(ru.title).toBe('');
    expect(ru.titleLanguageCode).toBeNull();
    expect(ru.missions.find((m) => m.id === missionId)!.title).toBe('');
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceLanguageCode).toBe('fr');
    expect(randomUUID()).not.toBe(manifest.checksum);
  });
});
