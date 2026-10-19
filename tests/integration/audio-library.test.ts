/**
 * §6.3 / §7.6 / A21–A23: the audio library is read through the learner's RLS client, so only PUBLISHED collections,
 * chapters and lessons (with `visibility = 'authenticated'`) are visible; bookmarks and listening progress are
 * per-learner, idempotent on client event ids and revision-guarded; download packs and playback URLs are refused
 * honestly when rights are not verified or storage is not configured.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.audio');

describeStack('audio library — published-only reads, bookmarks, progress', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let alice: TestUser;
  let bob: TestUser;
  let publishedCollectionId: string;
  let draftCollectionId: string;
  let publishedLessonId: string;
  let draftLessonId: string;
  let privateLessonId: string;
  let assetId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [alice, bob] = await Promise.all([createTestUser(h, 'audio-alice', { defaultSourceLanguageCode: 'fr' }), createTestUser(h, 'audio-bob')]);
    await enrol(h, alice, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr' });
    const rights = await seeder.rights({ verified: true, commercialRedistribution: true, licenseId: 'CC-BY-4.0', attributionText: 'Narrated by Test Narrator' });
    const published = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', instructionLanguage: 'fr', rightsId: rights.id, titles: { fr: 'Darija au quotidien', en: 'Everyday Darija' } });
    publishedCollectionId = published.id;
    const chapter = await seeder.audioChapter(published.id);
    const lesson = await seeder.audioLesson({ chapterId: chapter.id, rightsId: rights.id, varietyId: 'ary', instructionLanguage: 'fr', titles: { fr: 'Épisode 1', en: 'Episode 1' } });
    publishedLessonId = lesson.id;
    const asset = await seeder.mediaAsset({ rightsId: rights.id });
    assetId = asset.id;
    await seeder.linkLessonAsset(lesson.id, asset.id, 'mobile_encoded');
    const draftLesson = await seeder.audioLesson({ chapterId: chapter.id, state: 'review_needed', titles: { en: 'Draft episode' } });
    draftLessonId = draftLesson.id;
    const privateLesson = await seeder.audioLesson({ chapterId: chapter.id, visibility: 'private', titles: { en: 'Private episode' } });
    privateLessonId = privateLesson.id;
    const draft = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', state: 'imported_draft', titles: { en: 'Unreviewed import' } });
    draftCollectionId = draft.id;
    const draftChapter = await seeder.audioChapter(draft.id);
    await seeder.audioLesson({ chapterId: draftChapter.id, titles: { en: 'Published lesson inside a draft collection' } });
  });

  afterAll(async () => {
    await h.app.flush();
    await seeder.cleanup();
    await deleteTestUsers(h, [alice, bob]);
  });

  it('lists only published collections, localized to the requested instruction language, with honest counts', async () => {
    const res = await call(h, '/v1/audio/collections?language=ary&instructionLanguage=fr&limit=100', { token: alice.token });
    expect(res.status).toBe(200);
    const ids = res.json.data.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(publishedCollectionId);
    expect(ids).not.toContain(draftCollectionId);
    const col = res.json.data.items.find((c: { id: string }) => c.id === publishedCollectionId);
    expect(col.title).toBe('Darija au quotidien');
    expect(col.lessonCount).toBe(1); // drafts and private lessons are not counted for learners
    expect(col.chapterCount).toBe(1);
    expect(col.attributionText).toMatch(/Test Narrator/);
    expect(col.offlineEligible).toBe(true);
    expect(res.json.data.total).toBeNull(); // no fabricated totals
    const anonymous = await call(h, '/v1/audio/collections');
    expect(anonymous.status).toBe(401);
  });

  it('hides draft and private lessons from chapter manifests and lesson detail', async () => {
    const chapters = await call(h, `/v1/audio/collections/${publishedCollectionId}/chapters?instructionLanguage=fr`, { token: alice.token });
    expect(chapters.status).toBe(200);
    const lessonIds = chapters.json.data.manifest.chapters.flatMap((c: { lessons: Array<{ id: string }> }) => c.lessons.map((l) => l.id));
    expect(lessonIds).toEqual([publishedLessonId]);
    const detail = await call(h, `/v1/audio/lessons/${publishedLessonId}?instructionLanguage=fr`, { token: alice.token });
    expect(detail.status).toBe(200);
    expect(detail.json.data).toMatchObject({ id: publishedLessonId, collectionId: publishedCollectionId, title: 'Épisode 1', targetVarietyId: 'ary' });
    expect(detail.json.data.assets.map((a: { ref: { assetId: string }; type: string }) => [a.ref.assetId, a.type])).toEqual([[assetId, 'mobile_encoded']]);
    expect(detail.json.data.assets[0].ref.publicUrl).toBeNull(); // private originals are never exposed by URL
    expect((await call(h, `/v1/audio/lessons/${draftLessonId}`, { token: alice.token })).status).toBe(404);
    expect((await call(h, `/v1/audio/lessons/${privateLessonId}`, { token: alice.token })).status).toBe(404);
    expect((await call(h, `/v1/audio/collections/${draftCollectionId}/chapters`, { token: alice.token })).status).toBe(404);
    const transcript = await call(h, `/v1/audio/lessons/${publishedLessonId}/transcript`, { token: alice.token });
    expect(transcript.status).toBe(404); // no transcript seeded: honest, no empty fake transcript
  });

  it('playback URLs and download packs are refused honestly without object storage, never fabricated', async () => {
    const playback = await call(h, `/v1/audio/assets/${assetId}/playback-url`, { token: alice.token, body: {} });
    expect([501, 404]).toContain(playback.status);
    expect(playback.json.ok).toBe(false);
    expect(JSON.stringify(playback.json)).not.toMatch(/https?:\/\//);
    const pack = await call(h, `/v1/me/audio-download-pack/${publishedLessonId}?deviceId=phone`, { token: alice.token });
    expect(pack.status).toBe(501);
    expect(pack.json.error.code).toBe('capability_unsupported');
  });

  it('bookmarks are idempotent on clientEventId, scoped to the learner and refused for invisible lessons', async () => {
    const clientEventId = crypto.randomUUID();
    const body = { clientEventId, lessonId: publishedLessonId, positionMs: 61_000, note: 'mint tea phrase', segmentId: null };
    const first = await call(h, '/v1/me/audio-bookmarks', { token: alice.token, body });
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({ lessonId: publishedLessonId, positionMs: 61_000, replayed: false });
    const replay = await call(h, '/v1/me/audio-bookmarks', { token: alice.token, body });
    expect(replay.status).toBe(200);
    expect(replay.json.data).toMatchObject({ id: first.json.data.id, replayed: true });
    const rows = await h.service.from('bookmarks').select('id').eq('user_id', alice.id).eq('lesson_id', publishedLessonId);
    expect(rows.data).toHaveLength(1);
    const draft = await call(h, '/v1/me/audio-bookmarks', { token: alice.token, body: { ...body, clientEventId: crypto.randomUUID(), lessonId: draftLessonId } });
    expect(draft.status).toBe(404);
    const unknownSegment = await call(h, '/v1/me/audio-bookmarks', { token: alice.token, body: { ...body, clientEventId: crypto.randomUUID(), segmentId: crypto.randomUUID() } });
    expect(unknownSegment.status).toBe(422);
    // Bob never sees Alice's bookmark, even with her client event id.
    const bobReplay = await call(h, '/v1/me/audio-bookmarks', { token: bob.token, body });
    expect(bobReplay.status).toBe(201);
    expect(bobReplay.json.data.id).not.toBe(first.json.data.id);
  });

  it('listening progress is revision-guarded per device and rejected for unknown lessons', async () => {
    const put = (revision: number, positionMs: number, clientEventId = crypto.randomUUID()) => call(h, `/v1/me/audio-progress/${publishedLessonId}`, { method: 'PUT', token: alice.token, body: { clientEventId, deviceId: 'phone', revision, positionMs, durationMs: 45 * 60 * 1000, completed: false, occurredAt: new Date().toISOString() } });
    const first = await put(1, 10_000);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ lessonId: publishedLessonId, positionMs: 10_000, resolution: 'applied' });
    const newer = await put(3, 30_000);
    expect(newer.json.data).toMatchObject({ positionMs: 30_000, resolution: 'applied' });
    const stale = await put(2, 20_000);
    expect(stale.json.data.resolution).toBe('superseded');
    expect(stale.json.data.positionMs).toBe(30_000);
    const unknown = await call(h, `/v1/me/audio-progress/${crypto.randomUUID()}`, { method: 'PUT', token: alice.token, body: { clientEventId: crypto.randomUUID(), deviceId: 'phone', revision: 1, positionMs: 1, durationMs: null, completed: false, occurredAt: new Date().toISOString() } });
    expect(unknown.status).toBe(422);
    const bobView = await h.service.from('user_audio_progress').select('user_id').eq('lesson_id', publishedLessonId);
    expect(bobView.data?.map((r) => r.user_id)).toEqual([alice.id]);
  });
});
