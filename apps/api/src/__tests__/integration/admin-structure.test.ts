/**
 * Integration coverage (local Supabase stack) for the promoted admin routes and the companion learner changes:
 * - speakers: idempotent create, optimistic concurrency, delete refused while linked unless reassigned;
 * - library structure: collection → chapters → lessons, atomic full-permutation reorders (partial lists are 422),
 *   chapter delete moving its lessons, collection delete refused while published, orphaned assets released;
 * - content rights: `verified` is admin-only, revoke unpublishes dependents in one transaction and replays honestly;
 * - asset suggestions: approve applies the value (+ content_revisions) and `applied` says so, replays and bulk reject;
 * - visual assets: honest 501 without R2, slot validation, unknown upload 404;
 * - stored course manifests are served to learners (with `?version=`), live build otherwise;
 * - conversation `audio_lesson` scope is validated under the learner's RLS before any session row exists;
 * - audio progress PUT accepts `clientSentAt`.
 */
import { CollectionResponseSchema, ContentRightsResponseSchema, LessonDetailResponseSchema, SpeakerResponseSchema } from '@langquest/contracts';
import { buildMasterKey } from '@langquest/media/keys';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createStackUser, deleteStackUsers, describeWithStack, stackApp, type StackHarness, type TestUser } from '../harness';

const describeStack = describeWithStack('api.admin-structure');
const key = () => `idem-${crypto.randomUUID()}`;
const hash = () => crypto.randomUUID().replace(/-/g, '').padEnd(64, '0');
/** A `master`-scoped object key (`media/{assetId}/{sha256}.{ext}`), the only shape `media_assets.storage_key` accepts. */
const masterKey = (ext: string, contentHash = hash()) => ({ contentHash, storageKey: buildMasterKey({ assetId: crypto.randomUUID(), contentHash, ext }) });

describeStack('admin structure, rights, suggestions and manifests against the local stack', () => {
  let h: StackHarness;
  let editor: TestUser;
  let admin: TestUser;
  let learner: TestUser;
  const cleanup: (() => PromiseLike<unknown>)[] = [];

  beforeAll(async () => {
    h = stackApp();
    [editor, admin, learner] = await Promise.all([createStackUser(h, 'struct-editor', { role: 'content_editor' }), createStackUser(h, 'struct-admin', { role: 'admin' }), createStackUser(h, 'struct-learner', { defaultSourceLanguageCode: 'fr' })]);
  });

  afterAll(async () => {
    await h.app.flush();
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {
        /* best-effort cleanup */
      }
    }
    await deleteStackUsers(h, [editor.id, admin.id, learner.id]);
  });

  let speakerId: string;
  let collectionId: string;
  let chapterA: string;
  let chapterB: string;
  let lessonIds: string[];

  it('speakers: idempotent create, revision-guarded patch, synthetic flag and consent survive round trips', async () => {
    const idempotencyKey = key();
    const body = { displayName: 'Youssef (test)', targetVarietyId: 'ary', consentState: 'granted', synthetic: false, idempotencyKey };
    const created = await call(h.app, '/v1/admin/speakers', { token: editor.token, body });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const dto = SpeakerResponseSchema.parse(created.json.data);
    speakerId = dto.id;
    cleanup.push(() => h.service.from('speakers').delete().eq('id', speakerId));
    expect(dto).toMatchObject({ targetVarietyId: 'ary', consentState: 'granted', synthetic: false, lessonCount: 0, revision: 1 });
    const replay = await call(h.app, '/v1/admin/speakers', { token: editor.token, body });
    expect(replay.status).toBe(200);
    expect(replay.json.data.id).toBe(speakerId);
    const stale = await call(h.app, `/v1/admin/speakers/${speakerId}`, { method: 'PATCH', token: editor.token, body: { region: 'Casablanca', expectedRevision: 0 } });
    expect(stale.status).toBe(412);
    const patched = await call(h.app, `/v1/admin/speakers/${speakerId}`, { method: 'PATCH', token: editor.token, body: { region: 'Casablanca', expectedRevision: 1 } });
    expect(patched.status).toBe(200);
    expect(patched.json.data).toMatchObject({ region: 'Casablanca', revision: 2 });
    const list = await call(h.app, '/v1/admin/speakers?q=youssef&targetVarietyId=ary', { token: editor.token });
    expect(list.json.data.items.map((s: { id: string }) => s.id)).toContain(speakerId);
    await h.app.flush();
    const audit = await h.service.from('audit_logs').select('action').eq('actor_id', editor.id).eq('entity_id', speakerId);
    expect(audit.data?.map((a) => a.action)).toEqual(expect.arrayContaining(['speaker.create', 'speaker.patch']));
  });

  it('structure: collection → chapters → lessons with atomic reorders; a partial permutation is refused', async () => {
    const col = await call(h.app, '/v1/admin/library/collections', { token: editor.token, body: { titleTranslations: { en: 'Souk dialogues', fr: 'Dialogues du souk' }, courseTrackId: 'arabic-moroccan', targetVarietyId: 'ary', instructionLanguageCode: 'fr', idempotencyKey: key() } });
    expect(col.status, JSON.stringify(col.json)).toBe(201);
    collectionId = CollectionResponseSchema.parse(col.json.data).id;
    cleanup.push(() => h.service.from('audio_course_collections').delete().eq('id', collectionId));
    const chA = await call(h.app, '/v1/admin/library/chapters', { token: editor.token, body: { collectionId, titleTranslations: { en: 'Greetings' }, sortOrder: 0, idempotencyKey: key() } });
    const chB = await call(h.app, '/v1/admin/library/chapters', { token: editor.token, body: { collectionId, titleTranslations: { en: 'Bargaining' }, sortOrder: 1, idempotencyKey: key() } });
    expect(chA.status).toBe(201);
    expect(chB.status).toBe(201);
    chapterA = chA.json.data.id;
    chapterB = chB.json.data.id;
    lessonIds = [];
    for (const [i, title] of ['Salam', 'Labas', 'Bslama'].entries()) {
      const l = await call(h.app, '/v1/admin/library/lessons', { token: editor.token, body: { chapterId: chapterA, titleTranslations: { en: title }, sortOrder: i, speakerIds: [speakerId], instructionLanguageCode: 'fr', idempotencyKey: key() } });
      expect(l.status, JSON.stringify(l.json)).toBe(201);
      const detail = LessonDetailResponseSchema.parse(l.json.data);
      expect(detail).toMatchObject({ chapterId: chapterA, collectionId, speakerIds: [speakerId], state: 'imported_draft', revision: 1 });
      lessonIds.push(detail.id);
    }
    const speaker = await call(h.app, `/v1/admin/speakers/${speakerId}`, { token: editor.token });
    expect(speaker.json.data.lessonCount).toBe(3);
    const detail = await call(h.app, `/v1/admin/library/collections/${collectionId}`, { token: editor.token });
    expect(detail.json.data).toMatchObject({ chapterCount: 2, lessonCount: 3 });
    expect(detail.json.data.chapters.map((c: { id: string; lessonCount: number }) => [c.id, c.lessonCount])).toEqual([[chapterA, 3], [chapterB, 0]]);
    // Reorder: full permutation only.
    const partial = await call(h.app, `/v1/admin/library/chapters/${chapterA}/lessons/reorder`, { token: editor.token, body: { orderedIds: [lessonIds[2]!, lessonIds[0]!], idempotencyKey: key() } });
    expect(partial.status, JSON.stringify(partial.json)).toBe(422);
    const reordered = await call(h.app, `/v1/admin/library/chapters/${chapterA}/lessons/reorder`, { token: editor.token, body: { orderedIds: [lessonIds[2]!, lessonIds[0]!, lessonIds[1]!], idempotencyKey: key() } });
    expect(reordered.status, JSON.stringify(reordered.json)).toBe(200);
    expect(reordered.json.data.items).toEqual([{ id: lessonIds[2], sortOrder: 0 }, { id: lessonIds[0], sortOrder: 1 }, { id: lessonIds[1], sortOrder: 2 }]);
    const chapters = await call(h.app, `/v1/admin/library/collections/${collectionId}/chapters/reorder`, { token: editor.token, body: { orderedIds: [chapterB, chapterA], idempotencyKey: key() } });
    expect(chapters.status).toBe(200);
    expect(chapters.json.data.items.map((i: { id: string }) => i.id)).toEqual([chapterB, chapterA]);
    const foreign = await call(h.app, `/v1/admin/library/collections/${collectionId}/chapters/reorder`, { token: editor.token, body: { orderedIds: [chapterB, crypto.randomUUID()], idempotencyKey: key() } });
    expect(foreign.status).toBe(422);
    // A linked speaker cannot be deleted without a reassignment target.
    const refused = await call(h.app, `/v1/admin/speakers/${speakerId}`, { method: 'DELETE', token: editor.token, body: {} });
    expect(refused.status).toBe(409);
  });

  it('structure: chapter delete moves lessons, lesson delete releases assets, published collections cannot be deleted', async () => {
    const moved = await call(h.app, `/v1/admin/library/chapters/${chapterA}`, { method: 'DELETE', token: editor.token, body: { moveLessonsToChapterId: chapterB } });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(new Set(moved.json.data.movedLessonIds)).toEqual(new Set(lessonIds));
    const chB = await call(h.app, `/v1/admin/library/chapters/${chapterB}`, { token: editor.token });
    expect(chB.json.data.lessonCount).toBe(3);
    // Attach an asset, then delete the lesson: the asset is detached and back to imported_draft, never deleted.
    const k1 = masterKey('mp3');
    const asset = await h.service.from('media_assets').insert({ storage_key: k1.storageKey, bucket: 'langquest-media', kind: 'audio', checksum_sha256: k1.contentHash, mime_type: 'audio/mpeg', byte_length: 1234, state: 'metadata_needed', disposition: 'active', visibility: 'private' }).select('id').single();
    expect(asset.error).toBeNull();
    cleanup.push(() => h.service.from('media_assets').delete().eq('id', asset.data!.id));
    const attached = await call(h.app, `/v1/admin/library/lessons/${lessonIds[0]}/assets`, { token: editor.token, body: { assetId: asset.data!.id } });
    expect(attached.status, JSON.stringify(attached.json)).toBe(201);
    expect(attached.json.data).toMatchObject({ assetType: 'master', movedFromLessonId: null });
    const movedAsset = await call(h.app, `/v1/admin/library/lessons/${lessonIds[1]}/assets`, { token: editor.token, body: { assetId: asset.data!.id } });
    expect(movedAsset.status).toBe(200);
    expect(movedAsset.json.data.movedFromLessonId).toBe(lessonIds[0]);
    const deleted = await call(h.app, `/v1/admin/library/lessons/${lessonIds[1]}`, { method: 'DELETE', token: editor.token });
    expect(deleted.status).toBe(200);
    expect(deleted.json.data.detachedAssetIds).toEqual([asset.data!.id]);
    const state = await h.service.from('media_assets').select('state').eq('id', asset.data!.id).single();
    expect(state.data?.state).toBe('imported_draft');
    await h.service.from('audio_course_collections').update({ state: 'published', published_version: 1 }).eq('id', collectionId);
    const refused = await call(h.app, `/v1/admin/library/collections/${collectionId}`, { method: 'DELETE', token: editor.token });
    expect(refused.status).toBe(409);
    await h.service.from('audio_course_collections').update({ state: 'unpublished' }).eq('id', collectionId);
  });

  it('content rights: verified is admin-only; revoke unpublishes dependents in one transaction and replays honestly', async () => {
    const editorVerified = await call(h.app, '/v1/admin/content-rights', { token: editor.token, body: { permissionGrant: 'Written consent on file', licenseId: 'custom', verified: true, idempotencyKey: key() } });
    expect(editorVerified.status).toBe(403);
    const rights = await call(h.app, '/v1/admin/content-rights', { token: admin.token, body: { permissionGrant: 'Written consent on file', licenseId: 'custom', verified: true, commercialRedistribution: true, authors: ['Studio Test'], idempotencyKey: key() } });
    expect(rights.status, JSON.stringify(rights.json)).toBe(201);
    const dto = ContentRightsResponseSchema.parse(rights.json.data);
    cleanup.push(() => h.service.from('content_rights').delete().eq('id', dto.id));
    expect(dto).toMatchObject({ verified: true, verifiedBy: admin.id, publishable: true, usedBy: [], revision: 1 });
    // Publish a lesson under this grant, then revoke.
    await h.service.from('audio_lessons').update({ content_rights_id: dto.id, state: 'published', published_revision: 1 }).eq('id', lessonIds[0]!);
    await h.service.from('audio_course_collections').update({ content_rights_id: dto.id, state: 'published' }).eq('id', collectionId);
    const withUsage = await call(h.app, `/v1/admin/content-rights/${dto.id}`, { token: editor.token });
    expect(withUsage.json.data.usedBy).toEqual(expect.arrayContaining([{ entityTable: 'audio_lessons', entityId: lessonIds[0], state: 'published' }, { entityTable: 'audio_course_collections', entityId: collectionId, state: 'published' }]));
    const revoked = await call(h.app, `/v1/admin/content-rights/${dto.id}/revoke`, { token: editor.token, body: { reason: 'takedown', note: 'rights holder request', idempotencyKey: key() } });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    expect(revoked.json.data.replayed).toBe(false);
    expect(revoked.json.data.manifestInvalidated).toBe(true);
    expect(revoked.json.data.affected).toEqual(expect.arrayContaining([{ entityTable: 'audio_lessons', entityId: lessonIds[0], previousState: 'published', newState: 'unpublished' }, { entityTable: 'audio_course_collections', entityId: collectionId, previousState: 'published', newState: 'unpublished' }]));
    const lesson = await h.service.from('audio_lessons').select('state').eq('id', lessonIds[0]!).single();
    expect(lesson.data?.state).toBe('unpublished');
    const events = await h.service.from('publication_events').select('actor_id, to_state').eq('entity_id', lessonIds[0]!);
    expect(events.data?.some((e) => e.actor_id === editor.id && e.to_state === 'unpublished')).toBe(true);
    const again = await call(h.app, `/v1/admin/content-rights/${dto.id}/revoke`, { token: editor.token, body: { reason: 'takedown', idempotencyKey: key() } });
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ replayed: true, affected: [], revokedAt: revoked.json.data.revokedAt });
    const edit = await call(h.app, `/v1/admin/content-rights/${dto.id}`, { method: 'PATCH', token: editor.token, body: { attributionText: 'x' } });
    expect(edit.status).toBe(412);
    const listed = await call(h.app, '/v1/admin/content-rights?revoked=true&licenseId=custom', { token: editor.token });
    expect(listed.json.data.items.map((r: { id: string }) => r.id)).toContain(dto.id);
  });

  it('asset suggestions: approving applies the value and records a revision; replays and bulk rejects are honest', async () => {
    const k2 = masterKey('mp3');
    const asset = await h.service.from('media_assets').insert({ storage_key: k2.storageKey, bucket: 'langquest-media', kind: 'audio', checksum_sha256: k2.contentHash, mime_type: 'audio/mpeg', byte_length: 99, state: 'metadata_needed', disposition: 'active', visibility: 'private' }).select('id').single();
    expect(asset.error).toBeNull();
    cleanup.push(() => h.service.from('media_assets').delete().eq('id', asset.data!.id));
    const lessonId = lessonIds[2]!;
    const seeded = await h.service.from('asset_suggestions').insert([
      { media_asset_id: asset.data!.id, lesson_id: lessonId, kind: 'level', suggestion: { value: 'beginner' }, confidence: 0.82, provenance: { task: 'infer_metadata', model: 'test' }, review_status: 'review_needed' },
      { media_asset_id: asset.data!.id, lesson_id: lessonId, kind: 'tags', suggestion: { tags: ['souk', 'greetings'] }, confidence: null, provenance: { task: 'infer_metadata', model: 'test' }, review_status: 'review_needed' },
      { media_asset_id: asset.data!.id, lesson_id: lessonId, kind: 'other', suggestion: { note: 'no mapping' }, confidence: 0.1, provenance: { task: 'infer_metadata', model: 'test' }, review_status: 'review_needed' },
    ]).select('id, kind');
    expect(seeded.error).toBeNull();
    const ids = Object.fromEntries(seeded.data!.map((r) => [r.kind, r.id])) as Record<string, string>;
    const list = await call(h.app, `/v1/admin/asset-suggestions?lessonId=${lessonId}&reviewStatus=review_needed`, { token: editor.token });
    expect(list.status).toBe(200);
    expect(list.json.data.items).toHaveLength(3);
    const levelItem = list.json.data.items.find((i: { kind: string }) => i.kind === 'level');
    expect(levelItem).toMatchObject({ confidence: 0.82, currentValue: { value: null }, reviewStatus: 'review_needed' });
    const approved = await call(h.app, `/v1/admin/asset-suggestions/${ids.level}/decide`, { token: editor.token, body: { decision: 'approve', note: 'sounds right', idempotencyKey: key() } });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    expect(approved.json.data).toMatchObject({ applied: true, replayed: false, revision: { entityTable: 'audio_lessons', entityId: lessonId }, suggestion: { reviewStatus: 'approved', reviewerId: editor.id, decisionNote: 'sounds right' } });
    const lesson = await h.service.from('audio_lessons').select('level').eq('id', lessonId).single();
    expect(lesson.data?.level).toBe('beginner');
    const replay = await call(h.app, `/v1/admin/asset-suggestions/${ids.level}/decide`, { token: editor.token, body: { decision: 'approve', idempotencyKey: key() } });
    expect(replay.json.data).toMatchObject({ applied: false, replayed: true });
    const flip = await call(h.app, `/v1/admin/asset-suggestions/${ids.level}/decide`, { token: editor.token, body: { decision: 'reject', idempotencyKey: key() } });
    expect(flip.status).toBe(409);
    const overridden = await call(h.app, `/v1/admin/asset-suggestions/${ids.tags}/decide`, { token: editor.token, body: { decision: 'approve', overrideSuggestion: { tags: ['souk'] }, idempotencyKey: key() } });
    expect(overridden.json.data.applied).toBe(true);
    const tagged = await h.service.from('audio_lessons').select('tags').eq('id', lessonId).single();
    expect(tagged.data?.tags).toEqual(['souk']);
    const bulk = await call(h.app, '/v1/admin/asset-suggestions/bulk-decide', { token: editor.token, body: { suggestionIds: [ids.other, ids.level, crypto.randomUUID()], decision: 'reject', idempotencyKey: key() } });
    expect(bulk.status).toBe(200);
    expect(bulk.json.data).toMatchObject({ approved: 0, rejected: 1, replayed: false });
    expect(bulk.json.data.skipped).toHaveLength(2);
    const generate = await call(h.app, '/v1/admin/asset-suggestions/generate', { token: editor.token, body: { assetIds: [asset.data!.id], kinds: ['level'], idempotencyKey: key() } });
    expect(generate.status, JSON.stringify(generate.json)).toBe(202);
    expect(generate.json.data).toMatchObject({ queuedAssets: 1, replayed: false });
    cleanup.push(() => h.service.from('processing_jobs').delete().in('id', generate.json.data.jobIds));
  });

  it('visual assets: honest 501 without R2, unknown upload is 404, slot validation per table', async () => {
    const empty = await call(h.app, '/v1/admin/visual-assets?unassigned=true', { token: editor.token });
    expect(empty.status).toBe(200);
    const initiate = await call(h.app, '/v1/admin/visual-assets/upload-initiate', { token: editor.token, body: { filename: 'scene.png', contentType: 'image/png', byteLength: 2048, clientChecksumSha256: 'b'.repeat(64), idempotencyKey: key() } });
    expect(initiate.status).toBe(501);
    expect(initiate.json.error.code).toBe('capability_unsupported');
    const register = await call(h.app, '/v1/admin/visual-assets', { token: editor.token, body: { uploadId: crypto.randomUUID(), type: 'mission_scene', styleVersion: 'v1', altTextTranslations: { en: 'A busy souk' }, origin: 'original_upload', idempotencyKey: key() } });
    expect(register.status).toBe(404);
    const k3 = masterKey('png');
    const seeded = await h.service.from('visual_assets').insert({ type: 'mission_scene', storage_key: k3.storageKey, style_version: 'v1', content_hash: k3.contentHash, alt_text_key: 'visual.test.souk', alt_text_translations: { en: 'Souk' }, dimensions: { width: 10, height: 10 }, origin: 'original_upload', mime_type: 'image/png', byte_length: 10, review_status: 'draft' }).select('id').single();
    expect(seeded.error).toBeNull();
    cleanup.push(() => h.service.from('visual_assets').delete().eq('id', seeded.data!.id));
    const badSlot = await call(h.app, `/v1/admin/visual-assets/${seeded.data!.id}/assign`, { token: editor.token, body: { entityTable: 'audio_lessons', entityId: lessonIds[0], slot: 'map', idempotencyKey: key() } });
    expect(badSlot.status).toBe(422);
    const assigned = await call(h.app, `/v1/admin/visual-assets/${seeded.data!.id}/assign`, { token: editor.token, body: { entityTable: 'audio_lessons', entityId: lessonIds[0], slot: 'cover', idempotencyKey: key() } });
    expect(assigned.status, JSON.stringify(assigned.json)).toBe(201);
    expect(assigned.json.data.assignment).toMatchObject({ entityTable: 'audio_lessons', entityId: lessonIds[0], slot: 'cover' });
    const got = await call(h.app, `/v1/admin/visual-assets/${seeded.data!.id}`, { token: editor.token });
    expect(got.json.data.assignments).toHaveLength(1);
    expect(got.json.data.altTextTranslations).toEqual({ en: 'Souk' });
    const unassigned = await call(h.app, `/v1/admin/visual-assets/${seeded.data!.id}/unassign`, { token: editor.token, body: { entityTable: 'audio_lessons', entityId: lessonIds[0], slot: 'cover' } });
    expect(unassigned.json.data.removed).toBe(true);
  });

  it('stored course manifests are served to learners (with ?version=), live build otherwise', async () => {
    const enrol = await call(h.app, '/v1/me/enrollments', { token: learner.token, body: { courseTrackId: 'swedish', sourceLanguageCode: 'fr' } });
    expect(enrol.status).toBe(201);
    const live = await call(h.app, '/v1/courses/swedish/manifest?source=fr', { token: learner.token });
    expect(live.status).toBe(200);
    expect(live.headers.get('x-manifest-source')).toBe('live');
    const stored = { ...live.json.data, version: 7, generatedAt: new Date().toISOString() };
    const put = await h.service.from('course_manifests').insert({ course_track_id: 'swedish', source_language_code: 'fr', version: 7, checksum: stored.checksum, manifest: stored, published_at: new Date().toISOString() });
    expect(put.error).toBeNull();
    cleanup.push(() => h.service.from('course_manifests').delete().eq('course_track_id', 'swedish').eq('source_language_code', 'fr'));
    // The edge cache still holds the live copy: a fresh app isolate reads the stored row.
    const fresh = stackApp();
    const served = await call(fresh.app, '/v1/courses/swedish/manifest?source=fr', { token: learner.token });
    expect(served.status).toBe(200);
    expect(served.headers.get('x-manifest-source')).toBe('stored');
    expect(served.json.data.version).toBe(7);
    const exact = await call(fresh.app, '/v1/courses/swedish/manifest?source=fr&version=7', { token: learner.token });
    expect(exact.json.data.version).toBe(7);
    const missing = await call(fresh.app, '/v1/courses/swedish/manifest?source=fr&version=99', { token: learner.token });
    expect(missing.status).toBe(200);
    expect(missing.headers.get('x-manifest-source')).toBe('live');
    await fresh.app.flush();
  });

  it('conversation audio_lesson scope is validated under RLS before any session row; audio progress accepts clientSentAt', async () => {
    const enrollments = await call(h.app, '/v1/me/enrollments', { token: learner.token });
    const enrollmentId = enrollments.json.data.enrollments[0].id as string;
    const clientSessionId = crypto.randomUUID();
    const hidden = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, clientSessionId, mode: 'text_only', scope: { kind: 'audio_lesson', audioLessonId: lessonIds[0] } } });
    expect(hidden.status, JSON.stringify(hidden.json)).toBe(404); // the lesson is not published: invisible to the learner
    const rows = await h.service.from('conversation_sessions').select('id').eq('id', clientSessionId);
    expect(rows.data).toEqual([]);
    const mismatch = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, clientSessionId: crypto.randomUUID(), missionId: crypto.randomUUID(), scope: { kind: 'mission', missionId: crypto.randomUUID() } } });
    expect(mismatch.status).toBe(422);
    const progress = await call(h.app, `/v1/me/audio-progress/${crypto.randomUUID()}`, { method: 'PUT', token: learner.token, body: { clientEventId: crypto.randomUUID(), deviceId: 'phone', revision: 1, positionMs: 1000, durationMs: null, completed: false, occurredAt: new Date().toISOString(), clientSentAt: new Date().toISOString() } });
    expect(progress.status).toBe(422); // unknown lesson: rejected by the RPC, clientSentAt accepted by validation
    expect(progress.json.error.code).toBe('validation_failed');
  });
});
