/**
 * Migration 120 (admin structure routes, 2026-10-19) against the LOCAL Supabase stack:
 *
 * - `reorder_audio_chapters` / `reorder_audio_lessons`: full-permutation reorders, atomic, editor-only.
 * - `revoke_content_rights`: one transaction unpublishes dependents, flags visual assets, revokes speaker
 *   consent and offline packs; learners are refused; replays are harmless.
 * - `visual_assets.alt_text_translations` + `conversation_sessions.scope` columns exist.
 * - `AudioLibraryRepository.putProgress` delegates to `apply_sync_events` (device-aware resolution, 110).
 * - Speakers / rights / visual / suggestion repository helpers behind the promoted admin routes.
 *
 * Skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then the file fails).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServiceClient, type DbClient } from '../client';
import { DbError } from '../errors';
import { createRepositories } from '../repositories';
import { createTestUser, deleteTestUsers, describeWithStack, stackEnv, type TestUser } from './stack';

const describeStack = describeWithStack('admin-structure.test');
const SHA = 'c'.repeat(64);
const masterKey = (assetId: string) => `media/${assetId}/${SHA}.mp3`;
const codeOf = (e: unknown): string | null => (e instanceof DbError ? e.code : null);

describeStack('migration 120: reorders, rights revocation, putProgress delegation (local stack)', () => {
  let service: DbClient;
  let svc: ReturnType<typeof createRepositories>;
  let learner: TestUser;
  let editor: TestUser;
  const createdUserIds: string[] = [];
  let collectionId: string;
  const chapterIds: string[] = [];
  let lessonId: string;

  beforeAll(async () => {
    service = createServiceClient(stackEnv);
    svc = createRepositories(service);
    learner = await createTestUser(service, 'struct-learner');
    editor = await createTestUser(service, 'struct-editor', { role: 'content_editor' });
    createdUserIds.push(learner.id, editor.id);

    const collection = await service.from('audio_course_collections').insert({ title_translations: { en: 'Structure collection' }, state: 'published' }).select('id').single();
    if (collection.error) throw collection.error;
    collectionId = collection.data.id;
    for (const [i, title] of ['one', 'two', 'three'].entries()) {
      const ch = await service.from('audio_chapters').insert({ collection_id: collectionId, title_translations: { en: title }, sort_order: i, state: 'published' }).select('id').single();
      if (ch.error) throw ch.error;
      chapterIds.push(ch.data.id);
    }
    const lesson = await service.from('audio_lessons').insert({ chapter_id: chapterIds[0]!, title_translations: { en: 'Lesson' }, state: 'published', visibility: 'authenticated' }).select('id').single();
    if (lesson.error) throw lesson.error;
    lessonId = lesson.data.id;
  });

  afterAll(async () => {
    await service.from('media_assets').delete().eq('checksum_sha256', SHA);
    await service.from('audio_course_collections').delete().eq('id', collectionId);
    await service.from('content_rights').delete().like('license_id', 'test-120-%');
    await service.from('speakers').delete().like('display_name', 'struct-%');
    await service.from('visual_assets').delete().like('style_version', 'test-120%');
    await deleteTestUsers(service, createdUserIds);
  });

  // -------------------------------------------------------------------------
  // 1. Reorders
  // -------------------------------------------------------------------------
  it('reorder_audio_chapters applies a full permutation atomically for editors and refuses partial lists', async () => {
    const ed = createRepositories(editor.client);
    const reversed = [...chapterIds].reverse();
    const result = await ed.audioLibrary.reorderChapters(collectionId, reversed);
    expect(result.map((r) => r.id)).toEqual(reversed);
    expect(result.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    const stored = await svc.audioLibrary.listChapters(collectionId);
    expect(stored.map((c) => c.id)).toEqual(reversed);

    // partial list, duplicate and foreign id are all refused with 23514 and nothing moves
    for (const bad of [[chapterIds[0]!], [chapterIds[0]!, chapterIds[0]!, chapterIds[1]!], [...chapterIds.slice(0, 2), randomUUID()]]) {
      const err = await ed.audioLibrary.reorderChapters(collectionId, bad).catch((e: unknown) => e);
      expect(codeOf(err), JSON.stringify(bad)).toBe('23514');
    }
    expect((await svc.audioLibrary.listChapters(collectionId)).map((c) => c.id)).toEqual(reversed);
    // restore
    await ed.audioLibrary.reorderChapters(collectionId, chapterIds);
  });

  it('reorders are editor-only: a learner JWT is refused (42501) even for published children', async () => {
    const err = await createRepositories(learner.client).audioLibrary.reorderChapters(collectionId, chapterIds).catch((e: unknown) => e);
    expect(codeOf(err)).toBe('42501');
    const err2 = await createRepositories(learner.client).audioLibrary.reorderLessons(chapterIds[0]!, [lessonId]).catch((e: unknown) => e);
    expect(codeOf(err2)).toBe('42501');
  });

  it('reorder_audio_lessons works for the service role and counts helpers see the structure', async () => {
    expect(await svc.audioLibrary.reorderLessons(chapterIds[0]!, [lessonId])).toEqual([{ id: lessonId, sortOrder: 0 }]);
    const counts = await svc.audioLibrary.countCollectionChildren([collectionId, randomUUID()]);
    expect(counts.get(collectionId)).toEqual({ chapters: 3, lessons: 1 });
    expect([...counts.values()][1]).toEqual({ chapters: 0, lessons: 0 });
    expect((await svc.audioLibrary.countChapterLessons(chapterIds)).get(chapterIds[0]!)).toBe(1);
    const page = await svc.audioLibrary.listCollectionsAdmin({ q: 'structure coll', state: 'published', limit: 5 });
    expect(page.items.some((c) => c.id === collectionId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Speakers
  // -------------------------------------------------------------------------
  it('speakers repository: list/filter, lesson counts and reassignment keep links unique', async () => {
    const ed = createRepositories(editor.client);
    const a = await ed.speakers.create({ display_name: 'struct-a', target_variety_id: 'ary', consent_state: 'granted' });
    const b = await ed.speakers.create({ display_name: 'struct-b', target_variety_id: null, synthetic: true });
    expect(b.target_variety_id).toBeNull();
    await ed.audioLibrary.setLessonSpeakers(lessonId, [a.id], 'instructor');
    expect((await ed.speakers.lessonCounts([a.id, b.id])).get(a.id)).toBe(1);
    expect((await ed.speakers.lessonCounts([a.id, b.id])).get(b.id)).toBeUndefined();
    const listed = await ed.speakers.list({ q: 'struct-', synthetic: true });
    expect(listed.items.map((s) => s.id)).toEqual([b.id]);
    expect(await ed.speakers.reassignLessons(a.id, b.id)).toBe(1);
    expect((await ed.audioLibrary.listLessonSpeakers(lessonId)).map((l) => l.speaker_id)).toEqual([b.id]);
    // learners only see granted speakers
    const seen = await learner.client.from('speakers').select('id').in('id', [a.id, b.id]);
    expect(seen.data?.map((s) => s.id)).toEqual([a.id]);
    await ed.audioLibrary.setLessonSpeakers(lessonId, [], 'instructor');
    await ed.speakers.delete(a.id);
    await ed.speakers.delete(b.id);
  });

  // -------------------------------------------------------------------------
  // 3. Rights revocation
  // -------------------------------------------------------------------------
  it('revoke_content_rights unpublishes dependents, flags art, revokes consent + offline packs in one call (editor JWT)', async () => {
    const ed = createRepositories(editor.client);
    const rights = await ed.rights.create({ permission_grant: 'written consent', license_id: `test-120-${randomUUID()}`, verified: true, commercial_redistribution: true });
    const lesson = await service.from('audio_lessons').insert({ chapter_id: chapterIds[1]!, title_translations: { en: 'Rights lesson' }, state: 'published', visibility: 'authenticated', content_rights_id: rights.id, published_revision: 3 }).select('id').single();
    if (lesson.error) throw lesson.error;
    const speaker = await ed.speakers.create({ display_name: 'struct-rights', consent_state: 'granted', content_rights_id: rights.id });
    const visual = await ed.visualAssets.insert({ storage_key: `public/image/${randomUUID()}/${SHA}.png`, type: 'course_cover', style_version: 'test-120', content_hash: SHA, alt_text_key: 'test.cover', dimensions: { width: 10, height: 10 }, origin: 'original_upload', mime_type: 'image/png', byte_length: 1, review_status: 'approved', license_id: rights.id, alt_text_translations: { en: 'A cover' } });
    expect((visual.alt_text_translations as { en: string }).en).toBe('A cover');
    const manifest = await service.from('user_download_manifests').insert({ user_id: learner.id, lesson_id: lesson.data.id, pack_id: randomUUID(), checksum: SHA, total_bytes: 1 }).select('id').single();
    if (manifest.error) throw manifest.error;

    expect((await ed.rights.listUsages(rights.id)).map((u) => u.entityTable).sort()).toEqual(['audio_lessons', 'speakers', 'visual_assets']);

    const affected = await ed.rights.revoke(rights.id, { reason: 'takedown', note: 'test' });
    const byTable = Object.fromEntries(affected.map((a) => [a.entity_table, a]));
    expect(byTable.audio_lessons).toMatchObject({ entity_id: lesson.data.id, previous_state: 'published', new_state: 'unpublished' });
    expect(byTable.visual_assets).toMatchObject({ entity_id: visual.id, previous_state: 'approved', new_state: 'review_needed' });
    expect(byTable.speakers).toMatchObject({ entity_id: speaker.id, new_state: 'revoked' });

    expect((await svc.audioLibrary.getLesson(lesson.data.id))?.lesson.state).toBe('unpublished');
    expect((await svc.speakers.getById(speaker.id))?.consent_state).toBe('revoked');
    expect((await svc.visualAssets.getById(visual.id))?.review_status).toBe('review_needed');
    expect((await svc.rights.getById(rights.id))?.revoked_at).not.toBeNull();
    expect(await svc.rights.isPublishable(rights.id)).toBe(false);
    const events = await service.from('publication_events').select('actor_id, to_state, reason').eq('entity_id', lesson.data.id);
    expect(events.data).toEqual([{ actor_id: editor.id, to_state: 'unpublished', reason: 'takedown: test' }]);
    const pack = await service.from('user_download_manifests').select('revoked_at').eq('id', manifest.data.id).single();
    expect(pack.data?.revoked_at).not.toBeNull();

    // replay: nothing left to unpublish, revoked_at unchanged
    const before = (await svc.rights.getById(rights.id))!.revoked_at;
    expect(await ed.rights.revoke(rights.id, { reason: 'takedown' })).toEqual([]);
    expect((await svc.rights.getById(rights.id))!.revoked_at).toBe(before);

    // learners are refused; the service role must name an actor
    expect(codeOf(await createRepositories(learner.client).rights.revoke(rights.id, { reason: 'takedown' }).catch((e: unknown) => e))).toBe('42501');
    expect(codeOf(await svc.rights.revoke(rights.id, { reason: 'takedown' }).catch((e: unknown) => e))).toBe('42501');
    expect(await svc.rights.revoke(rights.id, { reason: 'expired', actorId: editor.id })).toEqual([]);

    await service.from('user_download_manifests').delete().eq('id', manifest.data.id);
    await service.from('audio_lessons').delete().eq('id', lesson.data.id);
    await ed.speakers.delete(speaker.id);
    await service.from('visual_assets').delete().eq('id', visual.id);
  });

  it('rights.list filters by verified / revoked / license and pages by created_at', async () => {
    const ed = createRepositories(editor.client);
    const license = `test-120-list-${randomUUID()}`;
    const a = await ed.rights.create({ permission_grant: 'a', license_id: license, verified: false });
    const b = await ed.rights.create({ permission_grant: 'b', license_id: license, verified: true, commercial_redistribution: true });
    expect((await ed.rights.list({ licenseId: license })).items.map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await ed.rights.list({ licenseId: license, verified: true })).items.map((r) => r.id)).toEqual([b.id]);
    expect((await ed.rights.list({ licenseId: license, revoked: true })).items).toEqual([]);
    const first = await ed.rights.list({ licenseId: license, limit: 1 });
    expect(first.items.map((r) => r.id)).toEqual([a.id]);
    expect(first.nextCursor).toBe(a.created_at);
    expect((await ed.rights.list({ licenseId: license, limit: 1, cursor: first.nextCursor })).items.map((r) => r.id)).toEqual([b.id]);
    expect(codeOf(await createRepositories(learner.client).rights.list({ licenseId: license }).catch((e: unknown) => e)) ?? 'empty').toBe('empty');
    expect((await createRepositories(learner.client).rights.list({ licenseId: license })).items).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Visual slots
  // -------------------------------------------------------------------------
  it('visual slot helpers assign, list, replace and clear covers on audio structure', async () => {
    const ed = createRepositories(editor.client);
    const mk = (n: string) => ed.visualAssets.insert({ storage_key: `public/image/${randomUUID()}/${SHA}.png`, type: 'course_cover', style_version: 'test-120-slots', content_hash: SHA, alt_text_key: `test.${n}`, dimensions: { width: 1, height: 1 }, origin: 'original_upload', mime_type: 'image/png', byte_length: 1, alt_text_translations: { en: n } });
    const v1 = await mk('first');
    const v2 = await mk('second');
    const target = { entityTable: 'audio_lessons', entityId: lessonId, slot: 'cover' } as const;
    const assigned = await ed.visualAssets.assignVisualSlot(target, v1.id);
    expect(assigned).toMatchObject({ ...target, visualAssetId: v1.id });
    expect(assigned?.bindingId).not.toBeNull();
    expect((await svc.audioLibrary.getLesson(lessonId))?.lesson.cover_visual_asset_id).toBe(v1.id);
    expect(await ed.visualAssets.listAssignments(v1.id)).toHaveLength(1);
    expect((await ed.visualAssets.getSlotAssignment(target))?.visualAssetId).toBe(v1.id);
    expect(await ed.visualAssets.replaceEverywhere(v1.id, v2.id)).toBe(1);
    expect((await svc.visualAssets.getById(v1.id))?.replaced_by_asset_id).toBe(v2.id);
    expect((await ed.visualAssets.listAssignments(v2.id)).map((a) => a.entityId)).toEqual([lessonId]);
    expect((await ed.visualAssets.listPaged({ q: 'first' })).items.map((v) => v.id)).toEqual([]); // replaced assets are hidden by default
    expect((await ed.visualAssets.listPaged({ q: 'first', excludeReplaced: false })).items.map((v) => v.id)).toEqual([v1.id]);
    expect(await ed.visualAssets.assignVisualSlot(target, null)).toBeNull();
    expect(await ed.visualAssets.listAssignments(v2.id)).toEqual([]);
    expect((await service.from('audio_cover_art').select('id').eq('lesson_id', lessonId)).data).toEqual([]);
    await expect(ed.visualAssets.assignVisualSlot({ entityTable: 'characters', entityId: lessonId, slot: 'cover' } as never, v2.id)).rejects.toThrow(/not valid/);
    await service.from('visual_assets').delete().in('id', [v1.id, v2.id]);
  });

  // -------------------------------------------------------------------------
  // 5. putProgress delegates to apply_sync_events
  // -------------------------------------------------------------------------
  it('putProgress resolves conflicts like the sync path: same device by revision, other device by wall clock, duplicates by event id', async () => {
    const lr = createRepositories(learner.client);
    const t0 = Date.now() - 60_000;
    const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
    const e1 = randomUUID();
    const first = await lr.audioLibrary.putProgress({ user_id: learner.id, lesson_id: lessonId, revision: 5, position_ms: 1000, last_client_event_id: e1, last_device_id: 'phone', last_occurred_at: at(0) });
    expect(first).toMatchObject({ resolution: 'applied', superseded: false, reason: null });
    expect(first.row).toMatchObject({ position_ms: 1000, revision: 5, last_device_id: 'phone', play_count: 1 });
    // same device, lower revision → superseded (older_revision); position kept
    const stale = await lr.audioLibrary.putProgress({ user_id: learner.id, lesson_id: lessonId, revision: 3, position_ms: 500, last_device_id: 'phone', last_occurred_at: at(5000) });
    expect(stale).toMatchObject({ resolution: 'superseded', superseded: true, reason: 'older_revision' });
    expect(stale.row.position_ms).toBe(1000);
    // other device, lower revision but later time → applied (wall clock decides across devices)
    const tablet = await lr.audioLibrary.putProgress({ user_id: learner.id, lesson_id: lessonId, revision: 1, position_ms: 2000, last_device_id: 'tablet', last_occurred_at: at(10_000) });
    expect(tablet).toMatchObject({ resolution: 'applied', superseded: false });
    expect(tablet.row).toMatchObject({ position_ms: 2000, last_device_id: 'tablet', play_count: 2 });
    // other device, earlier time → superseded (older_event) but completion stays sticky
    const older = await lr.audioLibrary.putProgress({ user_id: learner.id, lesson_id: lessonId, revision: 9, position_ms: 100, completed: true, last_device_id: 'phone', last_occurred_at: at(2000) });
    expect(older).toMatchObject({ resolution: 'superseded', reason: 'older_event' });
    expect(older.row).toMatchObject({ position_ms: 2000, completed: true });
    // replayed client event id → duplicate, nothing changes
    const dup = await lr.audioLibrary.putProgress({ user_id: learner.id, lesson_id: lessonId, revision: 5, position_ms: 1, last_client_event_id: e1, last_device_id: 'phone', last_occurred_at: at(0) });
    expect(dup).toMatchObject({ resolution: 'duplicate', superseded: false });
    expect(dup.row.position_ms).toBe(2000);
    // the learner cannot write another user's progress through the RPC
    const other = await lr.audioLibrary.putProgress({ user_id: editor.id, lesson_id: lessonId, revision: 1, position_ms: 1 }).catch((e: unknown) => e);
    expect(codeOf(other)).toBe('42501');
    await service.from('user_audio_progress').delete().eq('user_id', learner.id);
    await service.from('device_sync_events').delete().eq('user_id', learner.id);
  });

  // -------------------------------------------------------------------------
  // 6. Suggestions + conversation scope column
  // -------------------------------------------------------------------------
  it('suggestions listPaged/decideMany only touch pending rows; conversation_sessions.scope stores the learner scope', async () => {
    const assetId = randomUUID();
    const asset = await service.from('media_assets').insert({ id: assetId, storage_key: masterKey(assetId), bucket: 'media', kind: 'audio', checksum_sha256: SHA, mime_type: 'audio/mpeg', byte_length: 1, visibility: 'authenticated', state: 'imported_draft' });
    if (asset.error) throw asset.error;
    const rows = await svc.assetSuggestions.insertMany([
      { media_asset_id: assetId, kind: 'level', suggestion: { level: 'beginner' }, confidence: 0.9, provenance: { task: 'scene_planning' } },
      { media_asset_id: assetId, kind: 'tags', suggestion: { tags: ['cafe'] }, confidence: null, provenance: { task: 'scene_planning' } },
    ]);
    expect((await svc.assetSuggestions.listPaged({ mediaAssetId: assetId, minConfidence: 0.5 })).items.map((r) => r.kind)).toEqual(['level']);
    const decided = await createRepositories(editor.client).assetSuggestions.decideMany(rows.map((r) => r.id), { reviewStatus: 'rejected', note: 'bulk' });
    expect(decided.map((d) => d.review_status)).toEqual(['rejected', 'rejected']);
    expect(decided.every((d) => d.reviewer_id === editor.id && d.decided_at !== null)).toBe(true);
    expect(await svc.assetSuggestions.decideMany(rows.map((r) => r.id), { reviewStatus: 'approved', reviewerId: editor.id })).toEqual([]);
    await service.from('media_assets').delete().eq('id', assetId);

    const character = await service.from('characters').insert({ character_key: `test.char.${randomUUID().replace(/-/g, '')}`, name: 'Scope', role: 'barista', personality: 'warm', home_region: 'Paris', target_variety_id: 'fr', state: 'published' }).select('id').single();
    if (character.error) throw character.error;
    const enrollment = await service.from('user_course_enrollments').insert({ user_id: learner.id, course_track_id: 'french', source_language_code: 'en', script_mode: 'native' }).select('id').single();
    if (enrollment.error) throw enrollment.error;
    const scope = { kind: 'audio_lesson', audioLessonId: lessonId, transcriptSegmentIds: [] };
    const session = await service.from('conversation_sessions').insert({ user_id: learner.id, enrollment_id: enrollment.data.id, character_id: character.data.id, target_variety_id: 'fr', source_language_code: 'en', scope }).select('scope').single();
    expect(session.data?.scope).toEqual(scope);
    await service.from('user_course_enrollments').delete().eq('id', enrollment.data.id);
    await service.from('characters').delete().eq('id', character.data.id);
  });
});
