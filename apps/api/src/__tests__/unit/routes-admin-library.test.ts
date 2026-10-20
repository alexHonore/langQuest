/**
 * Admin library routes through the real app (role gates, contract validation, repositories, the
 * `enqueue_processing_job` RPC semantics) against the in-memory PostgREST fake:
 * - `POST /v1/admin/library/import-manifest` (R-6.4-06): dry-run plan vs enqueued `import_manifest` job, matching by
 *   storage key / legacy path / asset id, uploaded CSV manifests read from R2, honest 501 without R2;
 * - `POST /v1/admin/assets/bulk-label` (R-6.4-07): reversible revisions, tag add/remove, transition guards, and no
 *   publication outside the rights-gated publish endpoint;
 * - `PATCH /v1/admin/audio/lessons/:id` (R-6.4-09): optimistic concurrency on `content_revisions` (a stale
 *   `expectedRevision` is refused with 412 and writes nothing);
 * - `POST /v1/admin/assets/:id/process` (R-6.4-10): jobs deduplicated by content hash, `force` re-runs, rights block;
 * - `POST /v1/admin/content/generate` (R-6.4-12): enqueues a `content_generate` draft job (never a model call inline),
 *   replays by idempotency key.
 */
import { AssetProcessResponseSchema, AudioLessonPatchResponseSchema, BulkLabelResponseSchema, ContentGenerateResponseSchema, ImportManifestResponseSchema, apiEnvelope } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { audioLessonRow, mediaAssetRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '33333333-3333-4333-8333-333333333333';
const REVIEWER = '55555555-5555-4555-8555-555555555555';
const SUPPORT = '44444444-4444-4444-8444-444444444444';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [EDITOR]: ['content_editor' as const], [REVIEWER]: ['language_reviewer' as const], [SUPPORT]: ['support_readonly' as const], [ADMIN]: ['admin' as const] };
const KEY = 'route-test-key-0001';

/** Anonymous 401, learner / support / reviewer 403 (content-editor routes), all as error envelopes. */
async function expectEditorGate(h: RouteHarness, method: string, path: string, body: unknown): Promise<void> {
  const anon = await h.call(path, { method, body });
  expect(anon.status, `${method} ${path} anonymous`).toBe(401);
  expect(anon.json).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  for (const user of [LEARNER, SUPPORT, REVIEWER]) {
    const res = await h.call(path, { method, token: await h.token(user), body });
    expect(res.status, `${method} ${path} as ${user}`).toBe(403);
    expect(res.json.error.code).toBe('forbidden');
  }
  expect(h.db.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
}

describe('admin library routes', () => {
  let h: RouteHarness;
  let editor: string;
  beforeEach(async () => {
    h = routeHarness({ roles: ROLES });
    editor = await h.token(EDITOR);
  });
  afterEach(() => h.restore());
  const jobs = () => h.db.rows('processing_jobs');

  describe('POST /v1/admin/library/import-manifest', () => {
    const PATH = '/v1/admin/library/import-manifest';
    let byId: DbRow;
    beforeEach(() => {
      [, , byId] = h.db.seed('media_assets', [mediaAssetRow({ storage_key: 'masters/a.mp3' }), mediaAssetRow({ legacy_path: 'old/b.mp3' }), mediaAssetRow()]) as [DbRow, DbRow, DbRow];
    });
    const rows = () => [{ storageKey: 'masters/a.mp3', lessonTitle: 'A', targetVarietyId: 'fr' }, { legacyPath: 'old/b.mp3', tags: ['x'] }, { assetId: byId.id }, { storageKey: 'masters/missing.mp3' }];

    it('is gated to content editors', async () => {
      await expectEditorGate(h, 'POST', PATH, { format: 'json', rows: rows(), idempotencyKey: KEY });
    });

    it('validates the request (422) — rows or uploadId, known format, every inline row addressable', async () => {
      for (const body of [{ format: 'json', idempotencyKey: KEY }, { format: 'xml', rows: rows(), idempotencyKey: KEY }, { format: 'json', rows: [{ lessonTitle: 'no key' }], idempotencyKey: KEY }, { format: 'json', rows: rows(), idempotencyKey: 'short' }]) {
        const res = await h.call(PATH, { token: editor, body });
        expect(res.status).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
    });

    it('dry run (default) reports matches and enqueues nothing; the plan id is deterministic per key', async () => {
      const res = await h.call(PATH, { token: editor, body: { format: 'json', rows: rows(), idempotencyKey: KEY } });
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(ImportManifestResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data).toMatchObject({ dryRun: true, rowCount: 4, matched: 3, unmatched: [{ row: 3, reason: expect.stringContaining('no media asset') }], validationErrors: [] });
      const again = await h.call(PATH, { token: editor, body: { format: 'json', rows: rows(), idempotencyKey: KEY } });
      expect(again.json.data.jobId).toBe(parsed.data.jobId);
      const other = await h.call(PATH, { token: editor, body: { format: 'json', rows: rows(), idempotencyKey: 'route-test-key-0002' } });
      expect(other.json.data.jobId).not.toBe(parsed.data.jobId);
      expect(jobs()).toHaveLength(0);
      await h.flush();
      expect(h.db.rows('audit_logs')).toHaveLength(0);
    });

    it('a real run enqueues one import_manifest job with the validated rows (202), idempotent on the key', async () => {
      const res = await h.call(PATH, { token: editor, body: { format: 'json', rows: rows(), dryRun: false, idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      expect(res.json.data).toMatchObject({ dryRun: false, rowCount: 4, matched: 3 });
      expect(jobs()).toHaveLength(1);
      expect(jobs()[0]).toMatchObject({ id: res.json.data.jobId, job_type: 'import_manifest', idempotency_key: `import_manifest:${KEY}`, requested_by: EDITOR, state: 'pending' });
      expect((jobs()[0]!.params as { rows: unknown[] }).rows).toHaveLength(4);
      const replay = await h.call(PATH, { token: editor, body: { format: 'json', rows: rows(), dryRun: false, idempotencyKey: KEY } });
      expect(replay.json.data.jobId).toBe(res.json.data.jobId);
      expect(jobs()).toHaveLength(1);
      await h.flush();
      expect(h.db.rows('audit_logs')).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'import.manifest', entity_table: 'processing_jobs', entity_id: res.json.data.jobId, actor_id: EDITOR })]));
    });

    it('an uploaded manifest without R2 answers capability_unsupported (501) — never a pretend import', async () => {
      const [upload] = h.db.seed('uploads', [{ storage_key: 'manifests/m.csv', status: 'completed', declared_mime_type: 'text/csv' }]);
      const res = await h.call(PATH, { token: editor, body: { format: 'csv', uploadId: upload!.id, idempotencyKey: KEY } });
      expect(res.status).toBe(501);
      expect(res.json.error.code).toBe('capability_unsupported');
      expect(jobs()).toHaveLength(0);
    });

    it('reads an uploaded CSV manifest from R2 and reports per-row parse errors; incomplete or unknown uploads are refused', async () => {
      h.restore();
      h = routeHarness({ roles: ROLES, media: true });
      editor = await h.token(EDITOR);
      h.db.seed('media_assets', [mediaAssetRow({ storage_key: 'masters/a.mp3' })]);
      h.bucket!.putText('manifests/m.csv', 'storage_key,lesson_order,target_variety_id\nmasters/a.mp3,1,fr\nmasters/nope.mp3,x,fr\nmasters/z.mp3,2,fr\n', 'text/csv');
      const [done, pending] = h.db.seed('uploads', [{ storage_key: 'manifests/m.csv', status: 'completed', declared_mime_type: 'text/csv' }, { storage_key: 'manifests/m.csv', status: 'uploading', declared_mime_type: 'text/csv' }]);
      const res = await h.call(PATH, { token: editor, body: { format: 'csv', uploadId: done!.id, idempotencyKey: KEY } });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ rowCount: 2, matched: 1 });
      expect(res.json.data.validationErrors).toEqual([expect.objectContaining({ field: 'lessonOrder' })]);
      const notReady = await h.call(PATH, { token: editor, body: { format: 'csv', uploadId: pending!.id, idempotencyKey: KEY } });
      expect(notReady.status).toBe(412);
      const unknown = await h.call(PATH, { token: editor, body: { format: 'csv', uploadId: crypto.randomUUID(), idempotencyKey: KEY } });
      expect(unknown.status).toBe(404);
    });
  });

  describe('POST /v1/admin/assets/bulk-label', () => {
    const PATH = '/v1/admin/assets/bulk-label';
    let asset: DbRow;
    let deleted: DbRow;
    let lesson: DbRow;
    let publishedLesson: DbRow;
    beforeEach(() => {
      [lesson, publishedLesson] = h.db.seed('audio_lessons', [audioLessonRow({ tags: ['old', 'keep'], state: 'metadata_needed' }), audioLessonRow({ state: 'published' })]) as [DbRow, DbRow];
      [asset, deleted] = h.db.seed('media_assets', [mediaAssetRow({ state: 'metadata_needed', legacy_path: 'old/a.mp3' }), mediaAssetRow({ disposition: 'deleted', legacy_path: 'old/gone.mp3' })]) as [DbRow, DbRow];
      h.db.seed('audio_lesson_assets', [{ asset_id: asset.id, lesson_id: lesson.id, asset_type: 'master', audio_lessons: { id: lesson.id, title_translations: lesson.title_translations, chapter_id: lesson.chapter_id, target_variety_id: 'fr', instruction_language_code: 'en', transcript_status: 'none', audio_chapters: { collection_id: crypto.randomUUID() } } }]);
    });

    it('is gated to content editors', async () => {
      await expectEditorGate(h, 'POST', PATH, { assetIds: [crypto.randomUUID()], patch: { topic: 'x' }, idempotencyKey: KEY });
    });

    it('validates the request (422): a target selector and a non-empty patch are required', async () => {
      for (const body of [{ patch: { topic: 'x' }, idempotencyKey: KEY }, { assetIds: [asset.id], patch: {}, idempotencyKey: KEY }, { assetIds: [asset.id], patch: { state: 'live' }, idempotencyKey: KEY }, { assetIds: ['nope'], patch: { topic: 'x' }, idempotencyKey: KEY }]) {
        const res = await h.call(PATH, { token: editor, body });
        expect(res.status).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
    });

    it('labels the assets and their linked lessons, records a reversible revision and an audit row', async () => {
      const res = await h.call(PATH, { token: editor, body: { assetIds: [asset.id, deleted.id], patch: { state: 'review_needed', targetVarietyId: 'fr', instructionLanguage: 'en', addTags: ['greetings'], removeTags: ['old'] }, idempotencyKey: KEY } });
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(BulkLabelResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data.affected).toBe(2); // the active asset + its lesson
      expect(parsed.data.revisionIds).toEqual([lesson.id]);
      expect(parsed.data.skipped).toEqual([{ id: deleted.id, reason: 'asset is deleted' }]);
      expect(asset.state).toBe('review_needed');
      expect(deleted.state).toBe('imported_draft');
      expect(lesson).toMatchObject({ state: 'review_needed', target_variety_id: 'fr', instruction_language_code: 'en', tags: ['keep', 'greetings'] });
      const revisions = h.db.rows('content_revisions');
      expect(revisions).toEqual([expect.objectContaining({ entity_table: 'audio_lessons', entity_id: lesson.id, revision: 1, editor_id: EDITOR, note: `bulk-label ${KEY}` })]);
      expect(revisions[0]!.diff).toMatchObject({ bulk: true, patch: { addTags: ['greetings'] } });
      await h.flush();
      expect(h.db.rows('audit_logs')).toEqual([expect.objectContaining({ action: 'assets.bulk_label', actor_id: EDITOR })]);
    });

    it('selects by filter, skips illegal transitions and unknown lessons instead of failing the batch', async () => {
      const unknownLesson = crypto.randomUUID();
      const res = await h.call(PATH, { token: editor, body: { filter: { legacyPathPrefix: 'old/' }, lessonIds: [publishedLesson.id, unknownLesson], patch: { state: 'rights_unverified' }, idempotencyKey: KEY } });
      expect(res.status).toBe(200);
      expect(asset.state).toBe('rights_unverified'); // found by the legacy-path filter
      expect(publishedLesson.state).toBe('published'); // published → rights_unverified is not a legal move
      expect(res.json.data.skipped).toEqual(expect.arrayContaining([{ id: publishedLesson.id, reason: 'cannot move from published to rights_unverified' }, { id: unknownLesson, reason: 'lesson not found' }]));
    });

    it('never publishes: state "published" is refused (412) before anything is written', async () => {
      lesson.state = 'approved';
      asset.state = 'approved';
      const res = await h.call(PATH, { token: editor, body: { assetIds: [asset.id], lessonIds: [lesson.id], patch: { state: 'published' }, idempotencyKey: KEY } });
      expect(res.status).toBe(412);
      expect(res.json.error.code).toBe('precondition_failed');
      expect(res.json.error.message).toContain('/publish');
      expect(lesson.state).toBe('approved');
      expect(asset.state).toBe('approved');
      expect(h.db.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
    });
  });

  describe('PATCH /v1/admin/audio/lessons/:id', () => {
    let lesson: DbRow;
    const path = () => `/v1/admin/audio/lessons/${lesson.id}`;
    beforeEach(() => {
      [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ title_translations: { en: 'Greetings' }, state: 'metadata_needed' })]) as [DbRow];
      h.db.seed('content_revisions', [1, 2].map((revision) => ({ entity_table: 'audio_lessons', entity_id: lesson.id, revision, diff: {}, editor_id: EDITOR, note: null, snapshot: null })));
    });

    it('is gated to content editors', async () => {
      await expectEditorGate(h, 'PATCH', path(), { topic: 'x' });
    });

    it('validates the id and body (422) and 404s an unknown lesson', async () => {
      expect((await h.call('/v1/admin/audio/lessons/not-a-uuid', { method: 'PATCH', token: editor, body: { topic: 'x' } })).status).toBe(422);
      expect((await h.call(path(), { method: 'PATCH', token: editor, body: {} })).status).toBe(422);
      expect((await h.call(path(), { method: 'PATCH', token: editor, body: { state: 'live' } })).status).toBe(422);
      expect((await h.call(path(), { method: 'PATCH', token: editor, body: { expectedRevision: -1, topic: 'x' } })).status).toBe(422);
      const missing = await h.call(`/v1/admin/audio/lessons/${crypto.randomUUID()}`, { method: 'PATCH', token: editor, body: { topic: 'x' } });
      expect(missing.status).toBe(404);
      expect(missing.json.error.code).toBe('not_found');
    });

    it('applies a patch at the current revision: merged translations, speakers replaced, revision bumped', async () => {
      const speaker = crypto.randomUUID();
      h.db.seed('lesson_speakers', [{ lesson_id: lesson.id, speaker_id: crypto.randomUUID(), role: 'other' }]);
      const res = await h.call(path(), { method: 'PATCH', token: editor, body: { expectedRevision: 2, titleTranslations: { fr: 'Salutations' }, topic: 'cafe', state: 'review_needed', speakerIds: [speaker] } });
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(AudioLessonPatchResponseSchema).parse(res.json);
      expect(parsed).toEqual({ ok: true, data: { lessonId: lesson.id, revision: 3, state: 'review_needed' } });
      expect(lesson).toMatchObject({ title_translations: { en: 'Greetings', fr: 'Salutations' }, topic: 'cafe', state: 'review_needed' });
      expect(h.db.rows('lesson_speakers')).toEqual([expect.objectContaining({ lesson_id: lesson.id, speaker_id: speaker })]);
      const latest = h.db.rows('content_revisions').find((r) => r.revision === 3)!;
      expect(latest).toMatchObject({ entity_id: lesson.id, editor_id: EDITOR });
      expect(latest.diff).not.toHaveProperty('expectedRevision');
    });

    it('a stale expectedRevision is refused (412 with the current revision) and writes nothing', async () => {
      const stale = await h.call(path(), { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'overwrite' } });
      expect(stale.status).toBe(412);
      expect(stale.json.error).toMatchObject({ code: 'precondition_failed', details: { currentRevision: 2 } });
      expect(lesson.topic).toBeNull();
      expect(h.db.rows('content_revisions')).toHaveLength(2);
      // Two editors who both loaded revision 2: the first save wins, the second is now stale.
      expect((await h.call(path(), { method: 'PATCH', token: editor, body: { expectedRevision: 2, topic: 'first' } })).status).toBe(200);
      const second = await h.call(path(), { method: 'PATCH', token: await h.token(ADMIN), body: { expectedRevision: 2, topic: 'second' } });
      expect(second.status).toBe(412);
      expect(second.json.error.details.currentRevision).toBe(3);
      expect(lesson.topic).toBe('first');
    });

    it('state changes follow the content state machine and publication needs the rights-gated endpoint', async () => {
      const illegal = await h.call(path(), { method: 'PATCH', token: editor, body: { state: 'approved' } }); // metadata_needed → approved skips review
      expect(illegal.status).toBe(412);
      lesson.state = 'approved';
      const publish = await h.call(path(), { method: 'PATCH', token: editor, body: { state: 'published' } });
      expect(publish.status).toBe(412);
      expect(publish.json.error.message).toContain('/publish');
      expect(lesson.state).toBe('approved');
    });
  });

  describe('POST /v1/admin/assets/:id/process', () => {
    let asset: DbRow;
    const path = (id = asset.id as string) => `/v1/admin/assets/${id}/process`;
    beforeEach(() => {
      [asset] = h.db.seed('media_assets', [mediaAssetRow({ checksum_sha256: 'b'.repeat(64) })]) as [DbRow];
    });

    it('is gated to content editors', async () => {
      await expectEditorGate(h, 'POST', path(), { operations: ['transcribe'], idempotencyKey: KEY });
    });

    it('validates operations and the id (422) and 404s an unknown asset', async () => {
      for (const body of [{ operations: [], idempotencyKey: KEY }, { operations: ['teleport'], idempotencyKey: KEY }, { operations: ['transcribe'], priority: 11, idempotencyKey: KEY }]) {
        expect((await h.call(path(), { token: editor, body })).status).toBe(422);
      }
      expect((await h.call(path('nope'), { token: editor, body: { operations: ['transcribe'], idempotencyKey: KEY } })).status).toBe(422);
      expect((await h.call(path(crypto.randomUUID()), { token: editor, body: { operations: ['transcribe'], idempotencyKey: KEY } })).status).toBe(404);
    });

    it('enqueues one job per operation keyed by the content hash (202) and reuses them on a repeat request', async () => {
      const res = await h.call(path(), { token: editor, body: { operations: ['transcribe', 'transcode'], priority: 3, idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      const parsed = apiEnvelope(AssetProcessResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data.reusedFromHash).toBe(false);
      expect(parsed.data.jobs.map((j) => [j.type, j.state, j.parentAssetId])).toEqual([['transcribe', 'pending', asset.id], ['transcode', 'pending', asset.id]]);
      expect(jobs().map((j) => j.idempotency_key)).toEqual([`transcribe:${asset.id}:${'b'.repeat(64)}`, `transcode:${asset.id}:${'b'.repeat(64)}`]);
      expect(jobs().every((j) => j.priority === 3 && j.requested_by === EDITOR)).toBe(true);

      const again = await h.call(path(), { token: editor, body: { operations: ['transcribe'], idempotencyKey: 'route-test-key-0002' } });
      expect(again.json.data.jobs[0].id).toBe(parsed.data.jobs[0]!.id);
      expect(again.json.data.reusedFromHash).toBe(false); // still pending: same job, nothing to reuse yet
      jobs()[0]!.state = 'succeeded';
      const reused = await h.call(path(), { token: editor, body: { operations: ['transcribe'], idempotencyKey: 'route-test-key-0003' } });
      expect(reused.json.data).toMatchObject({ reusedFromHash: true, jobs: [{ id: parsed.data.jobs[0]!.id, state: 'succeeded' }] });
      expect(jobs()).toHaveLength(2);
      await h.flush();
      expect(h.db.rows('audit_logs').filter((a) => a.action === 'asset.process')).toHaveLength(3);
    });

    it('force re-runs an operation with a fresh job', async () => {
      const first = await h.call(path(), { token: editor, body: { operations: ['align'], idempotencyKey: KEY } });
      const forced = await h.call(path(), { token: editor, body: { operations: ['align'], force: true, idempotencyKey: 'route-test-key-0002' } });
      expect(forced.status).toBe(202);
      expect(forced.json.data.jobs[0].id).not.toBe(first.json.data.jobs[0].id);
      expect(jobs()).toHaveLength(2);
    });

    it('a revoked or quarantined asset is rights-blocked (451) and enqueues nothing', async () => {
      for (const disposition of ['revoked', 'quarantined']) {
        asset.disposition = disposition;
        const res = await h.call(path(), { token: editor, body: { operations: ['transcribe'], idempotencyKey: KEY } });
        expect(res.status).toBe(451);
        expect(res.json.error.code).toBe('rights_blocked');
      }
      expect(jobs()).toHaveLength(0);
    });
  });

  describe('POST /v1/admin/content/generate', () => {
    const PATH = '/v1/admin/content/generate';
    const brief = (over: DbRow = {}) => ({ targetTrack: 'arabic-moroccan', sourceLanguage: 'fr', intentKeys: ['greeting', 'order_coffee'], level: 'beginner', scene: 'cafe', count: 2, idempotencyKey: KEY, ...over });

    it('is gated to content editors', async () => {
      await expectEditorGate(h, 'POST', PATH, brief());
    });

    it('validates the brief (422)', async () => {
      for (const body of [brief({ intentKeys: [] }), brief({ targetTrack: 'klingon' }), brief({ count: 21 }), brief({ sourceLanguage: 'xx' }), brief({ level: 'guru' })]) {
        const res = await h.call(PATH, { token: editor, body });
        expect(res.status).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
      expect(jobs()).toHaveLength(0);
    });

    it('enqueues a content_generate draft job (202) and never calls a model inline, even with a provider configured', async () => {
      h.restore();
      h = routeHarness({ roles: ROLES, openRouter: true });
      editor = await h.token(EDITOR);
      const res = await h.call(PATH, { token: editor, body: brief() });
      expect(res.status).toBe(202);
      const parsed = apiEnvelope(ContentGenerateResponseSchema).parse(res.json);
      expect(parsed).toEqual({ ok: true, data: { jobId: jobs()[0]!.id, draftIds: [], replayed: false } });
      expect(jobs()[0]).toMatchObject({ job_type: 'content_generate', idempotency_key: `content_generate:${KEY}`, provider: 'openrouter', requested_by: EDITOR, state: 'pending' });
      expect(jobs()[0]!.params).toEqual({ targetTrack: 'arabic-moroccan', targetVariety: 'ary', sourceLanguage: 'fr', intentKeys: ['greeting', 'order_coffee'], level: 'beginner', scene: 'cafe', characterId: null, count: 2, publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true } });
      expect(h.openrouter.calls).toHaveLength(0);
      expect(h.blocked).toEqual([]);
    });

    it('replays by idempotency key: same job, 200, replayed=true, draft ids once the job has produced them', async () => {
      const first = await h.call(PATH, { token: editor, body: brief() });
      const job = jobs()[0]!;
      const draftId = crypto.randomUUID();
      job.output = { draftIds: [draftId] };
      const replay = await h.call(PATH, { token: editor, body: brief() });
      expect(replay.status).toBe(200);
      expect(replay.json.data).toEqual({ jobId: first.json.data.jobId, draftIds: [draftId], replayed: true });
      expect(jobs()).toHaveLength(1);
    });
  });
});
