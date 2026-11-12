/**
 * Migration 100 (cross-package gaps, 2026-10-15) against the LOCAL Supabase stack:
 *
 * - `delete_account` (A28): service-role only; deletes user-owned rows and the learner's own evidence
 *   ledgers through the append-only triggers, anonymises retained ledgers, marks recordings deleted,
 *   returns the disclosed summary and leaves `auth.users` deletable by the API.
 * - `purge_test_user`: service-role only, `@langquest.test` accounts only, deletes auth.users too.
 * - Append-only ledgers stay append-only for everyone outside those functions (service role included).
 * - media_assets.storage_key is no longer unique (one blob, several logical assets).
 * - Stored manifests (ADR-004) and AI suggestions (§7.4): repositories + RLS.
 * - processing_job_type accepts the apps/jobs handler names.
 *
 * Skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then the file fails).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV5 } from '../character-uuid';
import { createServiceClient, type DbClient } from '../client';
import { DbError } from '../errors';
import { createRepositories } from '../repositories';
import { SuggestionAlreadyDecidedError } from '../repositories/asset-suggestions';
import { createTestUser, deleteTestUsers, deleteTrackedRows, describeWithStack, stackEnv, trackRow, type TestUser, type TrackedRow } from './stack';

const describeStack = describeWithStack('app-gaps.test');
const SHA = 'b'.repeat(64);
const masterKey = (assetId: string, sha = SHA) => `media/${assetId}/${sha}.mp3`;

/** RFC 4122 §C URL namespace; the name below is a `langquest.test` URL, so the id can never collide with real data. */
const RFC4122_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
/**
 * Fixed id of the opt-in recording that the first `delete_account` test hands over (UUID v5, the same on every run).
 *
 * Why fixed: `delete_account` appends a `removed` row to `asset_provenance_events`, that ledger is append-only, and the
 * asset's `ON DELETE CASCADE` onto it is refused (the `account_deletion_in_progress()` bypass only holds inside the
 * security-definer lifecycle functions). So this asset can never be deleted, and a random id left one new
 * `media_assets` row behind per run. With a fixed id, the first run inserts it and every later run upserts the same
 * row back to an active, owned, private recording, so a full run adds no `media_assets` row.
 *
 * What stays append-only (kept by design, never deleted): every run still appends one `removed` provenance event to
 * this asset, so it carries one event per run, and the test filters its assertion to this run's events. The victim's
 * `ai_requests` row and its `audit_logs` rows (`gaps.test`, the `account.delete_account` summary) stay too, anonymised.
 * The random-id assets that runs before this change left (checksum `b…b`) also stay; removing them is the owner's call.
 * Two runs of this file at the same moment against one stack would share this row (integration runs it once at a time).
 */
const OPT_IN_RECORDING_ID = uuidV5(RFC4122_URL_NAMESPACE, 'https://langquest.test/db/app-gaps/delete-account/opt-in-recording');

describeStack('migration 100: account lifecycle, blobs, manifests, suggestions (local stack)', () => {
  let service: DbClient;
  let svc: ReturnType<typeof createRepositories>;
  let learner: TestUser;
  let other: TestUser;
  let editor: TestUser;
  const createdUserIds: string[] = [];
  /** Service-role rows (assets, jobs, feedback); deleted BEFORE the users so no owner purge stamps a provenance event on them. */
  const rows: TrackedRow[] = [];
  let characterId: string;
  let collectionId: string;
  let assetId: string;

  const codeOf = (e: unknown): string | null => (e instanceof DbError ? e.code : null);

  beforeAll(async () => {
    service = createServiceClient(stackEnv);
    svc = createRepositories(service);
    learner = await createTestUser(service, 'gaps-learner');
    other = await createTestUser(service, 'gaps-other');
    editor = await createTestUser(service, 'gaps-editor', { role: 'content_editor' });
    createdUserIds.push(learner.id, other.id, editor.id);

    const character = await service
      .from('characters')
      .insert({ character_key: `test.char.${randomUUID().replace(/-/g, '')}`, name: 'Gaps', role: 'barista', personality: 'warm', home_region: 'Paris', target_variety_id: 'fr', state: 'published' })
      .select('id')
      .single();
    if (character.error) throw character.error;
    characterId = character.data.id;

    const collection = await service
      .from('audio_course_collections')
      .insert({ title_translations: { en: 'Gaps collection' }, description_translations: {}, state: 'published' })
      .select('id')
      .single();
    if (collection.error) throw collection.error;
    collectionId = collection.data.id;

    assetId = trackRow(rows, 'media_assets', randomUUID());
    const asset = await service.from('media_assets').insert({
      id: assetId,
      storage_key: masterKey(assetId),
      bucket: 'media',
      owner_id: editor.id,
      kind: 'audio',
      checksum_sha256: SHA,
      mime_type: 'audio/mpeg',
      byte_length: 10,
      visibility: 'authenticated',
      state: 'published',
    });
    if (asset.error) throw asset.error;
  });

  // Tracked rows first (the editor owns the shared asset: purging it first would append a provenance event that blocks
  // the delete for good), then the users (their sessions RESTRICT the character), then the content they referenced.
  afterAll(async () => {
    await deleteTrackedRows(service, rows);
    await deleteTestUsers(service, createdUserIds);
    if (collectionId) await service.from('audio_course_collections').delete().eq('id', collectionId);
    if (characterId) await service.from('characters').delete().eq('id', characterId);
  });

  // -------------------------------------------------------------------------
  // 1. Account deletion
  // -------------------------------------------------------------------------
  it('delete_account purges user rows and evidence ledgers, anonymises retained ledgers and leaves auth.users deletable', async () => {
    const victim = await createTestUser(service, 'gaps-victim');
    createdUserIds.push(victim.id);
    const enrollment = await service.from('user_course_enrollments').insert({ user_id: victim.id, course_track_id: 'french', source_language_code: 'en', script_mode: 'native' }).select('id').single();
    if (enrollment.error) throw enrollment.error;
    const enrollmentId = enrollment.data.id;
    const sessionId = randomUUID();
    const feedbackId = trackRow(rows, 'feedback_reports', randomUUID());
    // The ai_requests / audit_logs rows are attributed to the victim and stay (append-only), anonymised by delete_account.
    const seeds = await Promise.all([
      service.from('xp_ledger').insert({ user_id: victim.id, enrollment_id: enrollmentId, amount: 5, reason: 'mission_completed', idempotency_key: randomUUID() }),
      service.from('device_sync_events').insert({ user_id: victim.id, device_id: 'd1', client_event_id: randomUUID(), payload_type: 'activity_minutes', client_occurred_at: new Date().toISOString(), resolution: 'applied' }),
      service.from('learning_observations').insert({ user_id: victim.id, enrollment_id: enrollmentId, skill_key: 'greet.basic', observation_type: 'spoken_production', scenario_id: 'gaps', autonomy: 'unaided', outcome: 'success', scorer_kind: 'deterministic', scorer_version: '1' }),
      service.from('notification_deliveries').insert({ user_id: victim.id, channel: 'push', category: 'reminder', template_key: 'daily', locale: 'fr' }),
      service.from('conversation_sessions').insert({ id: sessionId, user_id: victim.id, enrollment_id: enrollmentId, character_id: characterId, target_variety_id: 'fr', source_language_code: 'en' }),
      service.from('ai_requests').insert({ user_id: victim.id, enrollment_id: enrollmentId, task: 'character_dialogue', provider: 'openrouter', model: 'test', success: true, trace_id: `trace-${victim.id}` }),
      service.from('audit_logs').insert({ actor_id: victim.id, action: 'gaps.test', ip_hash: 'abc' }),
      service.from('feedback_reports').insert({ id: feedbackId, user_id: victim.id, enrollment_id: enrollmentId, category: 'bug', message: `gaps-${victim.id}` }),
    ]);
    for (const s of seeds) if (s.error) throw s.error;
    const turn = await service.from('conversation_turns').insert({ session_id: sessionId, turn_index: 0, speaker: 'learner', text: null });
    if (turn.error) throw turn.error;
    // Fixed id + upsert (see OPT_IN_RECORDING_ID): the first run inserts it; later runs reset the row the previous run's
    // delete_account de-owned (disposition 'deleted', owner null) to an active recording owned by this victim. Not tracked:
    // its provenance event makes the delete fail for good, so `deleteTrackedRows` would only log a refusal.
    const recordingId = OPT_IN_RECORDING_ID;
    const recording = await service
      .from('media_assets')
      .upsert({ id: recordingId, storage_key: masterKey(recordingId), bucket: 'media', owner_id: victim.id, kind: 'audio', checksum_sha256: SHA, mime_type: 'audio/mpeg', byte_length: 3, visibility: 'private', state: 'imported_draft', disposition: 'active' }, { onConflict: 'id' })
      .select('updated_at')
      .single();
    if (recording.error) throw recording.error;
    // This run's start on the DATABASE clock (insert default or the set_updated_at trigger, both now()): the provenance
    // events delete_account appends below are written in later transactions, so created_at >= runStart picks only them.
    const runStart = recording.data.updated_at;

    const summary = await svc.accountLifecycle.deleteAccount(victim.id, { deleteOptInRecordings: true });
    expect(summary.userId).toBe(victim.id);
    expect(summary.authUserDeletable).toBe(true);
    expect(summary.recordingsDeleted).toBe(1);
    expect(summary.deletedTables).toEqual(expect.arrayContaining(['xp_ledger', 'device_sync_events', 'learning_observations', 'conversation_turns', 'profiles', 'user_course_enrollments']));
    expect(summary.anonymisedTables).toEqual(expect.arrayContaining(['ai_requests', 'audit_logs']));
    expect(summary.retainedForLegalReasons.join(' ')).toMatch(/audit_logs/);
    expect(summary.counts).toMatchObject({ xp_ledger: 1, device_sync_events: 1, learning_observations: 1, conversation_turns: 1, conversation_sessions: 1, notification_deliveries: 1, profiles: 1, user_course_enrollments: 1, media_assets: 1 });

    const [xp, sync, obs, turns, sessions, profile, ai, audit, recordingRow, provenance, feedback] = await Promise.all([
      service.from('xp_ledger').select('id').eq('user_id', victim.id),
      service.from('device_sync_events').select('id').eq('user_id', victim.id),
      service.from('learning_observations').select('id').eq('user_id', victim.id),
      service.from('conversation_turns').select('id').eq('session_id', sessionId),
      service.from('conversation_sessions').select('id').eq('user_id', victim.id),
      service.from('profiles').select('user_id').eq('user_id', victim.id),
      service.from('ai_requests').select('user_id, enrollment_id').eq('trace_id', `trace-${victim.id}`).single(),
      service.from('audit_logs').select('actor_id, ip_hash').eq('action', 'gaps.test').order('created_at', { ascending: false }).limit(1).single(),
      service.from('media_assets_staff').select('disposition, owner_id').eq('id', recordingId).single(),
      // Only this run's events: earlier runs' `removed` rows on the same fixed asset are append-only and stay.
      service.from('asset_provenance_events').select('event_type, details').eq('asset_id', recordingId).gte('created_at', runStart),
      service.from('feedback_reports').select('user_id, enrollment_id').eq('message', `gaps-${victim.id}`).single(),
    ]);
    expect(xp.data).toEqual([]);
    expect(sync.data).toEqual([]);
    expect(obs.data).toEqual([]);
    expect(turns.data).toEqual([]);
    expect(sessions.data).toEqual([]);
    expect(profile.data).toEqual([]);
    expect(ai.data).toEqual({ user_id: null, enrollment_id: null });
    expect(audit.data).toEqual({ actor_id: null, ip_hash: null });
    expect(recordingRow.data).toEqual({ disposition: 'deleted', owner_id: null });
    expect(provenance.error).toBeNull();
    // Exactly one event this run (delete_account's), whatever earlier runs appended to the same asset.
    expect(provenance.data?.map((p) => [p.event_type, (p.details as { action?: string } | null)?.action])).toEqual([['removed', 'account_deletion']]);
    expect(feedback.data).toEqual({ user_id: null, enrollment_id: null }); // retained as anonymised product feedback

    // The summary itself is audited without an actor.
    const auditRow = await service.from('audit_logs').select('actor_id, after').eq('action', 'account.delete_account').eq('entity_id', victim.id).single();
    expect(auditRow.data?.actor_id).toBeNull();
    expect((auditRow.data?.after as { deleteOptInRecordings?: boolean })?.deleteOptInRecordings).toBe(true);

    // Second call is a no-op; the auth user can now be deleted by the API's auth admin call.
    const again = await svc.accountLifecycle.deleteAccount(victim.id);
    expect(again.counts.xp_ledger).toBe(0);
    const deleted = await service.auth.admin.deleteUser(victim.id);
    expect(deleted.error).toBeNull();
    // The recording row stays by design: delete_account appended its `removed` provenance event, which is append-only, and
    // the asset's ON DELETE CASCADE onto it is refused. It is de-owned, private and disposition=deleted until the next run
    // upserts it again (one row in all, not one per run; its provenance ledger grows by one `removed` event per run).
  });

  it('delete_account keeps recordings (owner cleared) when the learner did not opt in to deleting them', async () => {
    const victim = await createTestUser(service, 'gaps-keep');
    createdUserIds.push(victim.id);
    const recordingId = trackRow(rows, 'media_assets', randomUUID());
    const recording = await service.from('media_assets').insert({ id: recordingId, storage_key: masterKey(recordingId), bucket: 'media', owner_id: victim.id, kind: 'audio', checksum_sha256: SHA, mime_type: 'audio/mpeg', byte_length: 3 });
    if (recording.error) throw recording.error;
    const summary = await svc.accountLifecycle.deleteAccount(victim.id, { deleteOptInRecordings: false });
    expect(summary.recordingsDeleted).toBe(0);
    expect(summary.retainedForLegalReasons.join(' ')).toMatch(/keep recordings/);
    const row = await service.from('media_assets_staff').select('disposition, owner_id').eq('id', recordingId).single();
    expect(row.data).toEqual({ disposition: 'active', owner_id: null });
    await service.from('media_assets').delete().eq('id', recordingId);
  });

  it('delete_account reports a staff account with editorial attribution as not auth-deletable', async () => {
    const staff = await createTestUser(service, 'gaps-staff', { role: 'content_editor' });
    createdUserIds.push(staff.id);
    const revision = await service.from('content_revisions').insert({ entity_table: 'missions', entity_id: randomUUID(), revision: 1, editor_id: staff.id, snapshot: {} });
    if (revision.error) throw revision.error;
    const summary = await svc.accountLifecycle.deleteAccount(staff.id);
    expect(summary.authUserDeletable).toBe(false);
    expect(summary.counts.editorial_rows).toBe(1);
    expect(summary.retainedForLegalReasons.join(' ')).toMatch(/content_revisions/);
    const deleted = await service.auth.admin.deleteUser(staff.id);
    expect(deleted.error).not.toBeNull(); // NOT NULL editor attribution blocks the cascade, as disclosed
  });

  it('delete_account and purge_test_user are refused for JWT sessions', async () => {
    const asLearner = createRepositories(learner.client);
    await expect(asLearner.accountLifecycle.deleteAccount(learner.id)).rejects.toSatisfy((e) => codeOf(e) === '42501');
    await expect(asLearner.accountLifecycle.purgeTestUser(learner.id)).rejects.toSatisfy((e) => codeOf(e) === '42501');
    const asEditor = createRepositories(editor.client);
    await expect(asEditor.accountLifecycle.deleteAccount(learner.id)).rejects.toSatisfy((e) => codeOf(e) === '42501');
    expect((await service.from('profiles').select('user_id').eq('user_id', learner.id)).data).toHaveLength(1);
  });

  it('purge_test_user purges only @langquest.test accounts and deletes auth.users', async () => {
    const victim = await createTestUser(service, 'gaps-purge');
    const xp = await service.from('xp_ledger').insert({ user_id: victim.id, amount: 1, reason: 'daily_goal', idempotency_key: randomUUID() });
    if (xp.error) throw xp.error;
    const summary = await svc.accountLifecycle.purgeTestUser(victim.id);
    expect(summary.authUserDeleted).toBe(true);
    expect(summary.counts.xp_ledger).toBe(1);
    const gone = await service.auth.admin.getUserById(victim.id);
    expect(gone.data.user ?? null).toBeNull();
    await expect(svc.accountLifecycle.purgeTestUser(victim.id)).rejects.toSatisfy((e) => codeOf(e) === 'P0002');

    const real = await service.auth.admin.createUser({ email: `gaps-${randomUUID()}@example.com`, password: `pw-${randomUUID()}`, email_confirm: true });
    if (real.error || !real.data.user) throw new Error(real.error?.message);
    try {
      await expect(svc.accountLifecycle.purgeTestUser(real.data.user.id)).rejects.toSatisfy((e) => codeOf(e) === '42501');
      expect((await service.from('profiles').select('user_id').eq('user_id', real.data.user.id)).data).toHaveLength(1);
    } finally {
      await service.auth.admin.deleteUser(real.data.user.id);
    }
  });

  it('append-only ledgers still reject UPDATE/DELETE outside the lifecycle functions, service role included', async () => {
    const inserted = await service.from('xp_ledger').insert({ user_id: learner.id, amount: 2, reason: 'daily_goal', idempotency_key: randomUUID() }).select('id').single();
    if (inserted.error) throw inserted.error;
    const upd = await service.from('xp_ledger').update({ amount: 999 }).eq('id', inserted.data.id);
    expect(upd.error?.code).toBe('23514');
    const del = await service.from('xp_ledger').delete().eq('id', inserted.data.id);
    expect(del.error?.code).toBe('23514');
    const sync = await service.from('device_sync_events').insert({ user_id: learner.id, device_id: 'd', client_event_id: randomUUID(), payload_type: 'activity_minutes', client_occurred_at: new Date().toISOString(), resolution: 'applied' }).select('id').single();
    if (sync.error) throw sync.error;
    expect((await service.from('device_sync_events').delete().eq('id', sync.data.id)).error?.code).toBe('23514');
    expect((await service.from('device_sync_events').update({ payload_type: 'x' }).eq('id', sync.data.id)).error?.code).toBe('23514');
    // auth.admin.deleteUser still fails for a learner with ledger rows (the API must call delete_account first)
    const blocked = await createTestUser(service, 'gaps-blocked');
    createdUserIds.push(blocked.id);
    const ledger = await service.from('xp_ledger').insert({ user_id: blocked.id, amount: 1, reason: 'daily_goal', idempotency_key: randomUUID() });
    if (ledger.error) throw ledger.error;
    expect((await service.auth.admin.deleteUser(blocked.id)).error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Physical blob vs logical asset
  // -------------------------------------------------------------------------
  it('several logical media_assets rows may point at the same blob (storage_key no longer unique)', async () => {
    const twin = await svc.rights.insertAsset({ storage_key: masterKey(assetId), bucket: 'media', kind: 'audio', checksum_sha256: SHA, mime_type: 'audio/mpeg', byte_length: 10, visibility: 'authenticated', state: 'published' });
    trackRow(rows, 'media_assets', twin.id);
    expect(twin.id).not.toBe(assetId);
    const byKey = await svc.rights.listAssetsStaffByStorageKey(masterKey(assetId));
    expect(byKey.map((a) => a.id)).toEqual([assetId, twin.id]);
    expect((await svc.rights.findAssetStaffByStorageKey(masterKey(assetId)))?.id).toBe(assetId);
    expect((await svc.rights.listAssetsStaffByChecksum(SHA)).length).toBeGreaterThanOrEqual(2);
    expect((await svc.rights.listAssetsStaffByPrefix(`media/${assetId}/`)).map((a) => a.id).sort()).toEqual([assetId, twin.id].sort());
    // non-staff JWTs get nothing through the staff view
    expect(await createRepositories(learner.client).rights.listAssetsStaffByStorageKey(masterKey(assetId))).toEqual([]);
    await service.from('media_assets').delete().eq('id', twin.id);
  });

  // -------------------------------------------------------------------------
  // 3. Stored manifests (ADR-004)
  // -------------------------------------------------------------------------
  it('stores versioned course and audio manifests; learners read published versions only', async () => {
    const ref = { kind: 'course', courseTrackId: 'french', sourceLanguageCode: 'en' } as const;
    await service.from('course_manifests').delete().eq('course_track_id', 'french').eq('source_language_code', 'en');
    const v1 = await svc.manifests.putManifest(ref, { version: 1, checksum: 'c'.repeat(64), manifest: { formatVersion: 1, chapters: [] } });
    expect(v1.published_at).not.toBeNull();
    const v2 = await svc.manifests.putManifest(ref, { version: 2, checksum: 'd'.repeat(64), manifest: { formatVersion: 1, chapters: [{ id: 'x' }] }, publishedAt: null });
    expect(v2.published_at).toBeNull();
    expect((await svc.manifests.getLatestManifest(ref))?.version).toBe(1);
    expect((await svc.manifests.getLatestManifest(ref, { includeUnpublished: true }))?.version).toBe(2);
    expect((await svc.manifests.getLatestCourseManifest('french', 'en'))?.checksum).toBe('c'.repeat(64));
    // re-put the same version: idempotent replace
    const v1b = await svc.manifests.putManifest(ref, { version: 1, checksum: 'e'.repeat(64), manifest: { formatVersion: 1, chapters: [] } });
    expect(v1b.id).toBe(v1.id);
    expect(v1b.checksum).toBe('e'.repeat(64));
    expect((await svc.manifests.listCourseManifestVersions('french', 'en')).map((m) => m.version)).toEqual([2, 1]);

    const asLearner = createRepositories(learner.client).manifests;
    expect((await asLearner.getLatestManifest(ref))?.version).toBe(1);
    expect((await asLearner.getLatestManifest(ref, { includeUnpublished: true }))?.version).toBe(1); // RLS hides drafts
    expect((await learner.client.from('course_manifests').insert({ course_track_id: 'french', source_language_code: 'en', version: 9, checksum: 'f'.repeat(64), manifest: {} })).error?.code).toBe('42501');
    const asEditor = createRepositories(editor.client).manifests;
    expect((await asEditor.getLatestManifest(ref, { includeUnpublished: true }))?.version).toBe(2);
    const published = await asEditor.setPublished(ref, 2, new Date().toISOString());
    expect(published.published_at).not.toBeNull();
    expect((await asLearner.getLatestManifest(ref))?.version).toBe(2);

    const audioRef = { kind: 'audio_collection', collectionId } as const;
    const a1 = await svc.manifests.putManifest(audioRef, { version: 1, checksum: 'a'.repeat(64), manifest: { formatVersion: 1, collectionId } });
    expect('instruction_language_code' in a1 && a1.instruction_language_code).toBe('any');
    const a1fr = await svc.manifests.putAudioCollectionManifest({ collection_id: collectionId, instruction_language_code: 'fr', version: 1, checksum: 'a'.repeat(64), manifest: {}, published_at: new Date().toISOString() });
    expect(a1fr.instruction_language_code).toBe('fr');
    expect((await svc.manifests.getLatestAudioCollectionManifest(collectionId))?.id).toBe(a1.id);
    expect((await svc.manifests.getLatestAudioCollectionManifest(collectionId, 'fr'))?.id).toBe(a1fr.id);
    expect((await asLearner.getLatestManifest(audioRef))?.id).toBe(a1.id);
    await service.from('course_manifests').delete().eq('course_track_id', 'french').eq('source_language_code', 'en');
  });

  // -------------------------------------------------------------------------
  // 4. AI suggestions (§7.4)
  // -------------------------------------------------------------------------
  it('asset_suggestions are staff-only, never auto-applied, and decisions are stamped', async () => {
    const row = await svc.assetSuggestions.insert({ media_asset_id: assetId, kind: 'language', suggestion: { likelyLanguages: [{ code: 'fr', confidence: 0.9 }] }, confidence: 0.9, provenance: { task: 'scene_planning', model: 'test', promptVersion: 'v1', traceId: 't1' } });
    expect(row.review_status).toBe('review_needed');
    expect(row.reviewer_id).toBeNull();
    expect((await svc.assetSuggestions.listPending({ kind: 'language' })).map((s) => s.id)).toContain(row.id);
    expect((await svc.assetSuggestions.listForAsset(assetId)).map((s) => s.id)).toContain(row.id);

    const asLearner = createRepositories(learner.client).assetSuggestions;
    expect(await asLearner.listForAsset(assetId)).toEqual([]);
    expect(await asLearner.getById(row.id)).toBeNull();
    expect((await learner.client.from('asset_suggestions').update({ review_status: 'approved' }).eq('id', row.id).select('id')).data).toEqual([]);
    expect((await learner.client.from('asset_suggestions').insert({ media_asset_id: assetId, kind: 'tags', suggestion: {} })).error?.code).toBe('42501');

    const asEditor = createRepositories(editor.client).assetSuggestions;
    expect((await asEditor.getById(row.id))?.id).toBe(row.id);
    const decided = await asEditor.decide(row.id, { reviewStatus: 'approved', note: 'ok' });
    expect(decided.review_status).toBe('approved');
    expect(decided.reviewer_id).toBe(editor.id); // stamped from auth.uid() by the trigger
    expect(decided.decided_at).not.toBeNull();
    expect(decided.decision_note).toBe('ok');
    // A decided suggestion is the record of what was decided: the repository's conditional writes refuse to decide it
    // again or edit it (409 with the stored status), on real Postgres too. Reopening it is a plain editor UPDATE, which
    // the trigger un-stamps.
    await expect(asEditor.decide(row.id, { reviewStatus: 'rejected' })).rejects.toMatchObject({ currentStatus: 'approved' });
    await expect(asEditor.update(row.id, { review_status: 'in_review' })).rejects.toBeInstanceOf(SuggestionAlreadyDecidedError);
    const reopened = (await editor.client.from('asset_suggestions').update({ review_status: 'in_review' }).eq('id', row.id).select('*').single()).data;
    expect(reopened?.review_status).toBe('in_review');
    expect(reopened?.decided_at).toBeNull();
    const serviceDecision = await svc.assetSuggestions.decide(row.id, { reviewStatus: 'rejected', reviewerId: editor.id });
    expect(serviceDecision.reviewer_id).toBe(editor.id);
    expect(serviceDecision.decided_at).not.toBeNull();
    expect((await service.from('asset_suggestions').insert({ media_asset_id: assetId, kind: 'bogus' as never, suggestion: {} })).error?.code).toBe('23514');
    await service.from('asset_suggestions').delete().eq('id', row.id);
  });

  it('two editors deciding one suggestion at the same moment on real Postgres: exactly one decision lands, with its own payload', async () => {
    const editor2 = await createTestUser(service, 'gaps-editor2', { role: 'content_editor' });
    createdUserIds.push(editor2.id);
    const asFirst = createRepositories(editor.client).assetSuggestions;
    const asSecond = createRepositories(editor2.client).assetSuggestions;
    // Both requests are in flight together; Postgres serialises the two UPDATEs on the row lock and re-checks the pending
    // filter for the second one, whichever it is. Several rounds, alternating the second editor's decision.
    for (let round = 0; round < 8; round += 1) {
      const row = await svc.assetSuggestions.insert({ media_asset_id: assetId, kind: 'level', suggestion: { value: 'beginner' }, confidence: 0.5, provenance: { task: 'infer_metadata', model: 'test', round } });
      const secondStatus = round % 2 === 0 ? 'approved' : 'rejected';
      const settled = await Promise.allSettled([asFirst.decide(row.id, { reviewStatus: 'approved', suggestion: { value: 'advanced' } }), asSecond.decide(row.id, { reviewStatus: secondStatus })]);
      const landed = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const refused = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
      expect(landed, `round ${round}`).toHaveLength(1);
      expect(refused, `round ${round}`).toHaveLength(1);
      const winner = landed[0]!;
      expect(refused[0]).toBeInstanceOf(SuggestionAlreadyDecidedError);
      expect(refused[0]).toMatchObject({ suggestionId: row.id, currentStatus: winner.review_status });
      // The stored row is the winner's decision, stamped to the winner, with the winner's payload: the first editor's
      // override exists only if the first editor's decision is the one that landed.
      const stored = await svc.assetSuggestions.getById(row.id);
      const firstWon = winner.reviewer_id === editor.id;
      expect(stored).toMatchObject({ review_status: firstWon ? 'approved' : secondStatus, reviewer_id: firstWon ? editor.id : editor2.id, suggestion: firstWon ? { value: 'advanced' } : { value: 'beginner' } });
      expect(stored!.decided_at).not.toBeNull();
      await service.from('asset_suggestions').delete().eq('id', row.id);
    }
  });

  // -------------------------------------------------------------------------
  // 5. processing_job_type domain + staff helpers
  // -------------------------------------------------------------------------
  it('processing_job_type accepts the apps/jobs handler names', async () => {
    const types = ['translate_transcript', 'regenerate_manifest', 'cleanup_orphan_uploads', 'render_cover', 'infer_metadata', 'generate_content', 'import_r2_prefix'] as const;
    for (const jobType of types) {
      const job = await svc.processingJobs.enqueue({ jobType, idempotencyKey: `gaps:${jobType}:${randomUUID()}`, params: { handler: jobType } });
      trackRow(rows, 'processing_jobs', job.id);
      expect(job.job_type).toBe(jobType);
      await service.from('processing_jobs').delete().eq('id', job.id);
    }
    await expect(svc.processingJobs.enqueue({ jobType: 'not_a_job' as never, idempotencyKey: randomUUID() })).rejects.toSatisfy((e) => codeOf(e) === '23514');
  });

  it('coverage/audit helpers: getCoverageStaff and listAfterValuesByPrefix', async () => {
    const coverage = await svc.catalog.getCoverageStaff('french', 'en');
    expect(coverage?.course_track_id).toBe('french');
    expect(await createRepositories(learner.client).catalog.getCoverageStaff('french', 'en')).toBeNull();
    const prefix = `imports/${randomUUID()}/`;
    // audit_logs is append-only: attribute the rows to a purged test account (anonymised at teardown) rather than to nobody.
    const actor_id = editor.id;
    await svc.auditLog.record({ actor_id, action: 'import_r2_prefix.object', after: { key: `${prefix}a.mp3` } });
    await svc.auditLog.record({ actor_id, action: 'import_r2_prefix.object', after: { key: `${prefix}b_c.mp3` } });
    await svc.auditLog.record({ actor_id, action: 'import_r2_prefix.object', after: { key: `elsewhere/${randomUUID()}.mp3` } });
    const keys = await svc.auditLog.listAfterValuesByPrefix('import_r2_prefix.object', 'key', prefix);
    expect(keys.sort()).toEqual([`${prefix}a.mp3`, `${prefix}b_c.mp3`]);
  });
});
