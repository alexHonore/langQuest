/**
 * Negative RLS + invariant tests against the LOCAL Supabase stack (CONVENTIONS §7, spec §5.5, §11
 * "RLS regression suite").
 *
 * Every user-owned table from `supabase/migrations/20261014100700_070_rls.sql` (the `full_crud`,
 * `upsert_only` and `read_only` policy groups, plus the hand-written `mission_attempts`,
 * `conversation_turns`, `feedback_reports` and `uploads` policies) gets the same table-driven negative
 * test: a row is seeded for user A with the service client, then user B must see nothing, change
 * nothing, delete nothing and be refused (42501) when spoofing an insert as A. Role boundaries
 * (support_readonly, content_editor), the server-only RPCs, the xp_claim hand-off, column-level grants
 * and the upload staging-key binding are covered too.
 *
 * Skipped with a clear message when no stack is reachable — unless LANGQUEST_REQUIRE_LOCAL_STACK=1,
 * in which case the file fails (CI must never go green by skipping this suite).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnonClient, createServiceClient, type DbClient } from '../client';
import { DbError } from '../errors';
import { COVERAGE_COLUMNS, MEDIA_ASSET_COLUMNS, createRepositories } from '../repositories';
import type { TableName } from '../types';
import {
  createTestUser,
  deleteTestUsers,
  deleteTrackedRows,
  describeWithStack,
  stackEnv,
  testKey,
  trackRow,
  type TestUser,
  type TrackedRow,
} from './stack';

const describeStack = describeWithStack('rls.test');

// ---------------------------------------------------------------------------
// Policy groups — keep in sync with 070_rls.sql (a table added there without a case here is a bug).
// ---------------------------------------------------------------------------
const FULL_CRUD = [
  'user_course_enrollments',
  'bookmarks',
  'user_audio_progress',
  'user_download_manifests',
  'character_relationship_memory',
  'user_expression_reviews',
  'notification_settings',
  'conversation_sessions',
] as const satisfies readonly TableName[];
const UPSERT_ONLY = ['profiles', 'account_settings'] as const satisfies readonly TableName[];
/** Owner reads only: ledgers/evidence and engine-derived state are written with the service role. */
const READ_ONLY = [
  'user_roles',
  'xp_ledger',
  'device_sync_events',
  'learning_observations',
  'user_achievements',
  'notification_deliveries',
  'user_skill_mastery',
  'mission_progress',
  'streak_activity',
  'daily_learning_metrics',
] as const satisfies readonly TableName[];
/** Tables with bespoke owner policies in 070 (not in the arrays) that are still user-owned. */
const CUSTOM_OWNER = [
  'mission_attempts',
  'feedback_reports',
  'uploads',
] as const satisfies readonly TableName[];

type UserTable =
  | (typeof FULL_CRUD)[number]
  | (typeof UPSERT_ONLY)[number]
  | (typeof READ_ONLY)[number]
  | (typeof CUSTOM_OWNER)[number];
type Group = 'full_crud' | 'upsert_only' | 'read_only' | 'custom';

/** Shared content/user fixtures created once in beforeAll. */
interface Fixtures {
  lessonId: string;
  missionId: string;
  characterId: string;
  /** Published, authenticated-visible media asset owned by the editor. */
  assetId: string;
  enrollmentA: {
    id: string;
    course_track_id: string;
    source_language_code: string;
    status: string;
  };
  sessionA: { id: string };
  /** User whose `user_roles` row serves as "someone else's row" (never A, whose role set must stay empty). */
  supportUserId: string;
}

const SHA = 'a'.repeat(64);
/** Row seed for user `ownerId`; `null` means the row already exists (created by the auth trigger). */
const seeds: Record<UserTable, (fx: Fixtures, ownerId: string) => Record<string, unknown> | null> =
  {
    user_course_enrollments: (_fx, user_id) => ({
      user_id,
      course_track_id: 'japanese',
      source_language_code: 'en',
    }),
    bookmarks: (fx, user_id) => ({
      user_id,
      lesson_id: fx.lessonId,
      position_ms: 0,
      client_event_id: randomUUID(),
    }),
    user_audio_progress: (fx, user_id) => ({ user_id, lesson_id: fx.lessonId }),
    user_download_manifests: (fx, user_id) => ({
      user_id,
      lesson_id: fx.lessonId,
      pack_id: randomUUID(),
      checksum: SHA,
      total_bytes: 10,
    }),
    character_relationship_memory: (fx, user_id) => ({
      user_id,
      character_id: fx.characterId,
      enrollment_id: fx.enrollmentA.id,
    }),
    user_expression_reviews: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      skill_key: testKey('skill'),
    }),
    user_skill_mastery: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      skill_key: testKey('skill'),
    }),
    mission_attempts: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      mission_id: fx.missionId,
      client_attempt_id: randomUUID(),
    }),
    mission_progress: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      mission_id: fx.missionId,
    }),
    streak_activity: (_fx, user_id) => ({ user_id, activity_date: '2025-01-01' }),
    daily_learning_metrics: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      metric_date: '2025-01-01',
    }),
    notification_settings: (_fx, user_id) => ({ user_id, channel: 'push', platform: 'ios' }),
    conversation_sessions: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      character_id: fx.characterId,
      target_variety_id: 'ary',
      source_language_code: 'fr',
    }),
    profiles: () => null,
    account_settings: () => null,
    user_roles: () => null,
    xp_ledger: (_fx, user_id) => ({
      user_id,
      amount: 5,
      reason: 'mission_completed',
      idempotency_key: randomUUID(),
    }),
    device_sync_events: (_fx, user_id) => ({
      user_id,
      device_id: 'dev-rls',
      client_event_id: randomUUID(),
      payload_type: 'activity_minutes',
      client_occurred_at: new Date().toISOString(),
      resolution: 'applied',
    }),
    learning_observations: (fx, user_id) => ({
      user_id,
      enrollment_id: fx.enrollmentA.id,
      skill_key: 'greet.basic',
      observation_type: 'spoken_production',
      scenario_id: 'rls',
      autonomy: 'unaided',
      outcome: 'success',
      scorer_kind: 'deterministic',
      scorer_version: '1',
    }),
    user_achievements: (_fx, user_id) => ({
      user_id,
      achievement_key: 'first.mission',
      client_event_id: randomUUID(),
    }),
    notification_deliveries: (_fx, user_id) => ({
      user_id,
      channel: 'push',
      category: 'reminder',
      template_key: 'daily',
      locale: 'fr',
    }),
    feedback_reports: (_fx, user_id) => ({
      user_id,
      category: 'bug',
      message: 'rls negative test',
    }),
    // The staging key must name its own row (guard_upload_row), so the id is generated here.
    uploads: (_fx, user_id) => {
      const id = randomUUID();
      return {
        id,
        user_id,
        storage_key: `uploads/${id}/${SHA}.mp3`,
        part_size_bytes: 1,
        original_filename: 'a.mp3',
        declared_mime_type: 'audio/mpeg',
        declared_byte_length: 1,
        client_checksum_sha256: SHA,
        idempotency_key: randomUUID(),
      };
    },
  };
/** Spoofed insert payloads differ from the seed only where a unique key would otherwise fire before RLS could be observed. */
const spoofs: Partial<
  Record<UserTable, (fx: Fixtures, ownerId: string) => Record<string, unknown>>
> = {
  user_course_enrollments: (_fx, user_id) => ({
    user_id,
    course_track_id: 'korean',
    source_language_code: 'en',
  }),
  profiles: (_fx, user_id) => ({ user_id, ui_locale: 'en' }),
  account_settings: (_fx, user_id) => ({ user_id, audio_speed: 1 }),
  user_roles: (_fx, user_id) => ({ user_id, role: 'admin' }),
};

const cases: { table: UserTable; group: Group }[] = [
  ...FULL_CRUD.map((table) => ({ table, group: 'full_crud' as const })),
  ...UPSERT_ONLY.map((table) => ({ table, group: 'upsert_only' as const })),
  ...READ_ONLY.map((table) => ({ table, group: 'read_only' as const })),
  ...CUSTOM_OWNER.map((table) => ({ table, group: 'custom' as const })),
];

/** One concrete table type keeps the query-builder generics simple for table-driven tests. */
const tbl = (db: DbClient, table: UserTable) => db.from(table as 'bookmarks');

describeStack('RLS and invariants (local stack)', () => {
  // Vitest still evaluates a `describe.skip` factory to collect its tests, so nothing that needs a
  // reachable stack (client construction included) may run at collection time — only inside hooks.
  let service: DbClient;
  let anon: DbClient;
  let svc: ReturnType<typeof createRepositories>;
  const createdUserIds: string[] = [];
  /** Service-role rows the suite creates (the shared asset, processing jobs); removed before the users. */
  const rows: TrackedRow[] = [];
  let userA: TestUser;
  let userB: TestUser;
  let support: TestUser;
  let editor: TestUser;
  let fx: Fixtures;
  let enrollmentA: Fixtures['enrollmentA'];
  let lessonCourseId: string;
  let collectionId: string;

  beforeAll(async () => {
    service = createServiceClient(stackEnv);
    anon = createAnonClient(stackEnv);
    svc = createRepositories(service);
    userA = await createTestUser(service, 'a');
    userB = await createTestUser(service, 'b');
    support = await createTestUser(service, 'support', { role: 'support_readonly' });
    editor = await createTestUser(service, 'editor', { role: 'content_editor' });
    createdUserIds.push(userA.id, userB.id, support.id, editor.id);
    enrollmentA = await createRepositories(userA.client).enrollments.create({
      userId: userA.id,
      courseTrackId: 'arabic-moroccan',
      sourceLanguageCode: 'fr',
    });

    // Content fixtures (service role): one audio lesson, one published mission, one character, one asset.
    const collection = await service
      .from('audio_course_collections')
      .insert({ title_translations: { en: 'RLS fixtures' } })
      .select('id')
      .single();
    if (collection.error) throw collection.error;
    collectionId = collection.data.id;
    const audioChapter = await service
      .from('audio_chapters')
      .insert({ collection_id: collectionId, title_translations: { en: 'c' } })
      .select('id')
      .single();
    if (audioChapter.error) throw audioChapter.error;
    const lesson = await service
      .from('audio_lessons')
      .insert({ chapter_id: audioChapter.data.id, title_translations: { en: 'l' } })
      .select('id')
      .single();
    if (lesson.error) throw lesson.error;
    const course = await service
      .from('lesson_courses')
      .insert({
        course_track_id: 'arabic-moroccan',
        title_translations: { en: 'RLS fixtures' },
        state: 'published',
        published_revision: 1,
        sort_order: 901,
      })
      .select('id')
      .single();
    if (course.error) throw course.error;
    lessonCourseId = course.data.id;
    const chapter = await service
      .from('chapters')
      .insert({
        lesson_course_id: lessonCourseId,
        title_translations: { fr: 'Chapitre' },
        state: 'published',
      })
      .select('id')
      .single();
    if (chapter.error) throw chapter.error;
    const mission = await service
      .from('missions')
      .insert({
        chapter_id: chapter.data.id,
        target_variety_id: 'ary',
        title_translations: { fr: 'Mission' },
        state: 'published',
        published_revision: 1,
      })
      .select('id')
      .single();
    if (mission.error) throw mission.error;
    const character = await service
      .from('characters')
      .insert({
        character_key: testKey('rls.char'),
        name: 'Yasmine',
        role: 'barista',
        personality: 'warm',
        home_region: 'Casablanca',
        target_variety_id: 'ary',
        state: 'published',
      })
      .select('id')
      .single();
    if (character.error) throw character.error;
    const session = await service
      .from('conversation_sessions')
      .insert({
        user_id: userA.id,
        enrollment_id: enrollmentA.id,
        character_id: character.data.id,
        target_variety_id: 'ary',
        source_language_code: 'fr',
      })
      .select('id')
      .single();
    if (session.error) throw session.error;
    const assetId = trackRow(rows, 'media_assets', randomUUID());
    const asset = await service.from('media_assets').insert({
      id: assetId,
      storage_key: `media/${assetId}/${SHA}.mp3`,
      bucket: 'media',
      owner_id: editor.id,
      kind: 'audio',
      checksum_sha256: SHA,
      mime_type: 'audio/mpeg',
      byte_length: 10,
      visibility: 'authenticated',
      state: 'published',
      legacy_path: '/imports/rls/a.mp3',
    });
    if (asset.error) throw asset.error;
    const link = await service
      .from('audio_lesson_assets')
      .insert({ lesson_id: lesson.data.id, asset_id: assetId, asset_type: 'master' });
    if (link.error) throw link.error;
    fx = {
      lessonId: lesson.data.id,
      missionId: mission.data.id,
      characterId: character.data.id,
      assetId,
      enrollmentA,
      sessionA: session.data,
      supportUserId: support.id,
    };
  }, 90000);

  afterAll(async () => {
    // Tracked rows first: the asset is owned by the editor, and purging its owner first would append
    // an `asset_provenance_events` row (append-only) that blocks the asset delete for good.
    await deleteTrackedRows(service, rows);
    await deleteTestUsers(service, createdUserIds);
    if (lessonCourseId) await service.from('lesson_courses').delete().eq('id', lessonCourseId);
    if (collectionId)
      await service.from('audio_course_collections').delete().eq('id', collectionId);
    if (fx?.characterId) await service.from('characters').delete().eq('id', fx.characterId);
  });

  // -------------------------------------------------------------------------
  // Table-driven negative tests: every user-owned table
  // -------------------------------------------------------------------------
  describe('every user-owned table is invisible and immutable to other learners', () => {
    it.each(cases)('$table ($group)', async ({ table, group }) => {
      const ownerId = table === 'user_roles' ? fx.supportUserId : userA.id;
      const seed = seeds[table](fx, ownerId);
      if (seed) {
        const seeded = await tbl(service, table)
          .insert(seed as never)
          .select('user_id');
        expect(seeded.error, `seed ${table}: ${seeded.error?.message}`).toBeNull();
      }
      const before = await tbl(service, table).select('user_id').eq('user_id', ownerId);
      expect(before.error).toBeNull();
      expect(before.data?.length ?? 0).toBeGreaterThan(0);

      // B cannot read the owner's rows (by owner id — the same predicate the policy uses)
      const read = await tbl(userB.client, table).select('user_id').eq('user_id', ownerId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      // anon (no JWT) sees nothing either: policies are `to authenticated`
      const anonRead = await tbl(anon, table).select('user_id').eq('user_id', ownerId);
      expect(anonRead.data ?? []).toEqual([]);

      // B cannot update or delete them (RLS filters: zero rows affected, no leak through error text)
      const upd = await tbl(userB.client, table)
        .update({ user_id: ownerId } as never)
        .eq('user_id', ownerId)
        .select('user_id');
      expect(upd.error).toBeNull();
      expect(upd.data).toEqual([]);
      const del = await tbl(userB.client, table).delete().eq('user_id', ownerId).select('user_id');
      expect(del.error).toBeNull();
      expect(del.data).toEqual([]);

      // B cannot insert a row that claims to belong to the owner
      const spoofRow = (spoofs[table] ?? seeds[table])(fx, ownerId);
      expect(spoofRow, `${table} needs a spoof payload`).not.toBeNull();
      const spoof = await tbl(userB.client, table).insert(spoofRow as never);
      expect(
        spoof.error?.code,
        `${table}: expected 42501, got ${spoof.error?.code} ${spoof.error?.message}`,
      ).toBe('42501');

      // the owner's rows are untouched
      const after = await tbl(service, table).select('user_id').eq('user_id', ownerId);
      expect(after.data?.length).toBe(before.data?.length);
      if (group === 'read_only') {
        // ledgers / evidence / engine-derived state: not even the owner may write them
        const ownIns = await tbl(userA.client, table).insert(
          (spoofs[table] ?? seeds[table])(fx, userA.id) as never,
        );
        expect(ownIns.error?.code, `${table}: owner insert must be refused`).toBe('42501');
        const ownUpd = await tbl(userA.client, table)
          .update({ user_id: ownerId } as never)
          .eq('user_id', ownerId)
          .select('user_id');
        expect(ownUpd.data).toEqual([]);
        const ownDel = await tbl(userA.client, table)
          .delete()
          .eq('user_id', ownerId)
          .select('user_id');
        expect(ownDel.data).toEqual([]);
      }
      if (group === 'upsert_only') {
        // profiles / account_settings: the owner may never delete them (account deletion is a server flow)
        const ownDel = await tbl(userA.client, table)
          .delete()
          .eq('user_id', userA.id)
          .select('user_id');
        expect(ownDel.data).toEqual([]);
      }
    });

    it('conversation_turns are reachable only through session ownership', async () => {
      const own = await userA.client
        .from('conversation_turns')
        .insert({ session_id: fx.sessionA.id, turn_index: 0, speaker: 'learner', text: 'salam' })
        .select('id, expires_at')
        .single();
      expect(own.error).toBeNull();
      // retention comes from the session ('none' → 24h), never from the client
      expect(own.data?.expires_at).not.toBeNull();
      expect(
        (
          await userA.client
            .from('conversation_turns')
            .select('id')
            .eq('session_id', fx.sessionA.id)
        ).data,
      ).toHaveLength(1);
      // a learner never writes character lines, nor attaches somebody else's audio
      expect(
        (
          await userA.client.from('conversation_turns').insert({
            session_id: fx.sessionA.id,
            turn_index: 1,
            speaker: 'character',
            text: 'forged',
          })
        ).error?.code,
      ).toBe('42501');
      expect(
        (
          await userA.client.from('conversation_turns').insert({
            session_id: fx.sessionA.id,
            turn_index: 1,
            speaker: 'learner',
            text: 'hi',
            audio_asset_id: fx.assetId,
          })
        ).error?.code,
      ).toBe('42501');
      // B: no read, no spoofed turn into A's session, no update/delete
      expect(
        (
          await userB.client
            .from('conversation_turns')
            .select('id')
            .eq('session_id', fx.sessionA.id)
        ).data,
      ).toEqual([]);
      const spoof = await userB.client
        .from('conversation_turns')
        .insert({ session_id: fx.sessionA.id, turn_index: 1, speaker: 'learner', text: 'spoof' });
      expect(spoof.error?.code).toBe('42501');
      expect(
        (
          await userB.client
            .from('conversation_turns')
            .update({ text: 'x' })
            .eq('session_id', fx.sessionA.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (
          await userB.client
            .from('conversation_turns')
            .delete()
            .eq('session_id', fx.sessionA.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (await anon.from('conversation_turns').select('id').eq('session_id', fx.sessionA.id))
          .data ?? [],
      ).toEqual([]);
    });

    it('profiles: the deleted_at marker cannot be set by the learner and the profile default never rewrites enrollments', async () => {
      const asA = createRepositories(userA.client);
      const marked = await userA.client
        .from('profiles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userA.id);
      expect(marked.error?.code).toBe('42501');
      expect((await svc.profiles.getByUserId(userA.id))?.deleted_at).toBeNull();
      await asA.profiles.update(userA.id, { default_source_language_code: 'es' });
      expect((await asA.enrollments.getById(enrollmentA.id))?.source_language_code).toBe('fr');
      // the default may be cleared again (nullable: onboarding not done yet)
      expect(
        (await asA.profiles.update(userA.id, { default_source_language_code: null }))
          .default_source_language_code,
      ).toBeNull();
      await asA.profiles.update(userA.id, { default_source_language_code: 'fr' });
    });

    it('feedback_reports: learners file their own, only admins triage', async () => {
      const own = await userA.client
        .from('feedback_reports')
        .insert({
          user_id: userA.id,
          category: 'wrong_dialect',
          message: 'MSA leaked into Darija',
          course_track_id: 'arabic-moroccan',
        })
        .select('id')
        .single();
      expect(own.error).toBeNull();
      expect(
        (
          await userA.client
            .from('feedback_reports')
            .update({ status: 'resolved' })
            .eq('id', own.data!.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (
          await userB.client
            .from('feedback_reports')
            .update({ status: 'resolved' })
            .eq('id', own.data!.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (await userB.client.from('feedback_reports').select('id').eq('id', own.data!.id)).data,
      ).toEqual([]);
      const spoof = await userB.client
        .from('feedback_reports')
        .insert({ user_id: userA.id, category: 'bug', message: 'spoofed report' });
      expect(spoof.error?.code).toBe('42501');
      const status = await service
        .from('feedback_reports')
        .select('status')
        .eq('id', own.data!.id)
        .single();
      expect(status.data?.status).toBe('open');
    });

    it('mission_attempts: learners start and advance their own attempts; the outcome is server-decided; evidence is never deleted', async () => {
      const asA = createRepositories(userA.client);
      const attempt = await asA.progress.startAttempt({
        user_id: userA.id,
        enrollment_id: enrollmentA.id,
        mission_id: fx.missionId,
        client_attempt_id: randomUUID(),
      });
      expect(attempt.completed_at).toBeNull();
      const advanced = await asA.progress.updateAttempt(attempt.id, {
        current_step_index: 2,
        step_results: [{ ok: true }],
      });
      expect(advanced.current_step_index).toBe(2);
      // completed_at / evaluation / xp_awarded / objectives_completed are decided by the evaluator (service role)
      await expect(
        asA.progress.updateAttempt(attempt.id, { completed_at: new Date().toISOString() }),
      ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.isForbidden);
      await expect(asA.progress.updateAttempt(attempt.id, { xp_awarded: 50 })).rejects.toSatisfy(
        (e: unknown) => e instanceof DbError && e.isForbidden,
      );
      expect(
        (
          await userA.client.from('mission_attempts').insert({
            user_id: userA.id,
            enrollment_id: enrollmentA.id,
            mission_id: fx.missionId,
            client_attempt_id: randomUUID(),
            completed_at: new Date().toISOString(),
          })
        ).error?.code,
      ).toBe('42501');
      expect(
        (await userA.client.from('mission_attempts').delete().eq('id', attempt.id).select('id'))
          .data,
      ).toEqual([]);
      const completed = await svc.progress.updateAttempt(attempt.id, {
        completed_at: new Date().toISOString(),
        xp_awarded: 50,
      });
      expect(completed.completed_at).not.toBeNull();
    });

    it('uploads: learners cannot open uploads; editors open only an initiated row whose staging key names it; the lifecycle is server-owned', async () => {
      const learnerUpload = await userA.client
        .from('uploads')
        .insert(seeds.uploads(fx, userA.id) as never);
      expect(learnerUpload.error?.code).toBe('42501');
      await expect(
        createRepositories(userA.client).uploads.initiate({
          user_id: userA.id,
          part_size_bytes: 1,
          original_filename: 'a.mp3',
          declared_mime_type: 'audio/mpeg',
          declared_byte_length: 1,
          client_checksum_sha256: SHA,
          idempotency_key: randomUUID(),
          extension: 'mp3',
        }),
      ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.isForbidden);

      const asEditor = createRepositories(editor.client);
      const key = randomUUID();
      const opened = await asEditor.uploads.initiate({
        user_id: editor.id,
        part_size_bytes: 1,
        original_filename: 'My Song.mp3',
        declared_mime_type: 'audio/mpeg',
        declared_byte_length: 1,
        client_checksum_sha256: SHA,
        idempotency_key: key,
        extension: 'mp3',
      });
      expect(opened.replayed).toBe(false);
      expect(opened.upload.status).toBe('initiated');
      expect(opened.upload.storage_key).toBe(`uploads/${opened.upload.id}/${SHA}.mp3`);
      const replay = await asEditor.uploads.initiate({
        user_id: editor.id,
        part_size_bytes: 1,
        original_filename: 'My Song.mp3',
        declared_mime_type: 'audio/mpeg',
        declared_byte_length: 1,
        client_checksum_sha256: SHA,
        idempotency_key: key,
        extension: 'mp3',
      });
      expect(replay.replayed).toBe(true);
      expect(replay.upload.id).toBe(opened.upload.id);
      // a staging key that names another row, or a pre-verified row, is refused for everyone
      const foreignKey = await editor.client.from('uploads').insert({
        ...(seeds.uploads(fx, editor.id) as object),
        storage_key: `uploads/${randomUUID()}/${SHA}.mp3`,
      } as never);
      expect(foreignKey.error?.code).toBe('23514');
      const preVerified = await editor.client.from('uploads').insert({
        ...(seeds.uploads(fx, editor.id) as object),
        status: 'verified',
        verified_checksum_sha256: SHA,
      } as never);
      expect(preVerified.error?.code).toBe('42501');
      // no UPDATE policy for JWT sessions: zero rows, row untouched
      expect(
        (
          await editor.client
            .from('uploads')
            .update({ status: 'completed' })
            .eq('id', opened.upload.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect((await svc.uploads.getById(opened.upload.id))?.status).toBe('initiated');
      // visibility: uploader and editors only
      expect(
        (await userB.client.from('uploads').select('id').eq('id', opened.upload.id)).data,
      ).toEqual([]);
      expect(
        (await support.client.from('uploads').select('id').eq('id', opened.upload.id)).data,
      ).toEqual([]);
      expect(
        (await editor.client.from('uploads').select('id').eq('id', opened.upload.id)).data,
      ).toHaveLength(1);
      // service role drives the state machine, which still rejects illegal transitions
      await expect(
        svc.uploads.update(opened.upload.id, { status: 'verified', verified_checksum_sha256: SHA }),
      ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.code === '23514');
      expect((await svc.uploads.update(opened.upload.id, { status: 'completed' })).status).toBe(
        'completed',
      );
      expect(
        (
          await svc.uploads.update(opened.upload.id, {
            status: 'verified',
            verified_checksum_sha256: SHA,
          })
        ).status,
      ).toBe('verified');
    });
  });

  // -------------------------------------------------------------------------
  // Column exposure (070 §8): staff user ids and import paths never reach learners or anon
  // -------------------------------------------------------------------------
  describe('column-level grants', () => {
    it('learners and anon must name coverage columns; reviewer_id is staff-only', async () => {
      expect(
        (await anon.from('course_source_localizations').select('*').limit(1)).error?.code,
      ).toBe('42501');
      expect(
        (await userA.client.from('course_source_localizations').select('reviewer_id').limit(1))
          .error?.code,
      ).toBe('42501');
      const named = await anon
        .from('course_source_localizations')
        .select(COVERAGE_COLUMNS)
        .eq('course_track_id', 'french');
      expect(named.error).toBeNull();
      expect(named.data?.length).toBeGreaterThan(0);
      expect(await createRepositories(anon).catalog.listCoverageForSource('fr')).toHaveLength(30);
      // staff view: empty for learners, denied for anon, full rows for staff and the service role
      expect(await createRepositories(userA.client).catalog.listCoverageStaff()).toEqual([]);
      expect(
        (await anon.from('course_source_localizations_staff').select('*').limit(1)).error?.code,
      ).toBe('42501');
      const viaEditor = await createRepositories(editor.client).catalog.listCoverageStaff('french');
      expect(viaEditor.length).toBeGreaterThan(0);
      expect(viaEditor[0]).toHaveProperty('reviewer_id');
      expect((await svc.catalog.listCoverageStaff('french')).length).toBe(viaEditor.length);
    });

    it('media_assets: owner_id and legacy paths are readable through the staff view only', async () => {
      expect(
        (await userA.client.from('media_assets').select('*').eq('id', fx.assetId)).error?.code,
      ).toBe('42501');
      expect(
        (await userA.client.from('media_assets').select('owner_id').eq('id', fx.assetId)).error
          ?.code,
      ).toBe('42501');
      const named = await userA.client
        .from('media_assets')
        .select(MEDIA_ASSET_COLUMNS)
        .eq('id', fx.assetId);
      expect(named.error).toBeNull();
      expect(named.data).toHaveLength(1);
      const asA = createRepositories(userA.client);
      const visible = await asA.rights.getAsset(fx.assetId);
      expect(visible?.checksum_sha256).toBe(SHA);
      expect(visible).not.toHaveProperty('owner_id');
      expect(await asA.rights.getAssetStaff(fx.assetId)).toBeNull();
      // the media join names its columns too (the lesson is a draft, so read it as staff — still the
      // `authenticated` role, which is what the column grant applies to)
      const asEditor = createRepositories(editor.client);
      const lesson = await asEditor.audioLibrary.getLesson(fx.lessonId);
      expect(lesson?.assets.map((a) => a.media?.checksum_sha256)).toEqual([SHA]);
      expect(lesson?.assets[0]?.media).not.toHaveProperty('owner_id');
      expect((await asEditor.rights.getAssetStaff(fx.assetId))?.owner_id).toBe(editor.id);
      const full = await svc.rights.getAssetStaff(fx.assetId);
      expect(full?.owner_id).toBe(editor.id);
      expect(full?.legacy_path).toBe('/imports/rls/a.mp3');
      // editors still read/write the table by named columns
      const updated = await createRepositories(editor.client).rights.updateAsset(fx.assetId, {
        etag: 'rls-etag',
      });
      expect(updated.etag).toBe('rls-etag');
      expect(updated).not.toHaveProperty('legacy_path');
    });
  });

  // -------------------------------------------------------------------------
  // Role boundaries
  // -------------------------------------------------------------------------
  describe('role boundaries', () => {
    it("a learner cannot grant themselves a role or read anyone's roles", async () => {
      const grant = await userA.client
        .from('user_roles')
        .insert({ user_id: userA.id, role: 'super_admin' });
      expect(grant.error?.code).toBe('42501');
      expect(
        (await userA.client.from('user_roles').select('role').eq('user_id', support.id)).data,
      ).toEqual([]);
      // support_readonly and content_editor cannot escalate either
      expect(
        (await support.client.from('user_roles').insert({ user_id: support.id, role: 'admin' }))
          .error?.code,
      ).toBe('42501');
      expect(
        (await editor.client.from('user_roles').insert({ user_id: editor.id, role: 'admin' })).error
          ?.code,
      ).toBe('42501');
      expect(
        (
          await support.client
            .from('user_roles')
            .update({ role: 'admin' })
            .eq('user_id', support.id)
            .select('id')
        ).data,
      ).toEqual([]);
    });

    it('support_readonly can read learner rows but never conversation turns, and cannot write', async () => {
      // positive control: the role is effective
      expect(
        (await support.client.from('user_course_enrollments').select('id').eq('id', enrollmentA.id))
          .data,
      ).toHaveLength(1);
      expect(
        (await support.client.from('conversation_sessions').select('id').eq('id', fx.sessionA.id))
          .data,
      ).toHaveLength(1);
      // turns are retention-sensitive: no support read
      expect(
        (
          await support.client
            .from('conversation_turns')
            .select('id')
            .eq('session_id', fx.sessionA.id)
        ).data,
      ).toEqual([]);
      // read-only means read-only
      expect(
        (
          await support.client
            .from('user_course_enrollments')
            .update({ status: 'archived' })
            .eq('id', enrollmentA.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (
          await support.client
            .from('user_course_enrollments')
            .delete()
            .eq('id', enrollmentA.id)
            .select('id')
        ).data,
      ).toEqual([]);
      expect(
        (
          await support.client
            .from('profiles')
            .update({ display_name: 'x' })
            .eq('user_id', userA.id)
            .select('user_id')
        ).data,
      ).toEqual([]);
      expect(
        (
          await support.client.from('user_course_enrollments').insert({
            user_id: userA.id,
            course_track_id: 'hindi',
            source_language_code: 'en',
          } as never)
        ).error?.code,
      ).toBe('42501');
      expect(
        (
          await support.client.from('xp_ledger').insert({
            user_id: userA.id,
            amount: 1,
            reason: 'mission_completed',
            idempotency_key: randomUUID(),
          })
        ).error?.code,
      ).toBe('42501');
      expect(
        (
          await support.client.from('content_rights').insert({
            permission_grant: 'forged',
            license_id: 'CC0',
            verified: true,
            commercial_redistribution: true,
          })
        ).error?.code,
      ).toBe('42501');
      expect((await svc.enrollments.getById(enrollmentA.id))?.status).toBe('active');
    });

    it('content_editor cannot read or write learner-owned rows', async () => {
      for (const table of [
        ...FULL_CRUD,
        ...UPSERT_ONLY,
        ...READ_ONLY.filter((t) => t !== 'user_roles'),
      ] as UserTable[]) {
        const read = await tbl(editor.client, table).select('user_id').eq('user_id', userA.id);
        expect(read.error, `${table}: ${read.error?.message}`).toBeNull();
        expect(read.data, `${table} leaked to content_editor`).toEqual([]);
      }
      expect(
        (
          await editor.client
            .from('conversation_turns')
            .select('id')
            .eq('session_id', fx.sessionA.id)
        ).data,
      ).toEqual([]);
      expect(
        (
          await editor.client.from('user_course_enrollments').insert({
            user_id: userA.id,
            course_track_id: 'hindi',
            source_language_code: 'en',
          } as never)
        ).error?.code,
      ).toBe('42501');
      expect(
        (
          await editor.client
            .from('user_course_enrollments')
            .update({ status: 'archived' })
            .eq('id', enrollmentA.id)
            .select('id')
        ).data,
      ).toEqual([]);
      // positive control: editors do write shared content
      const skill = await editor.client
        .from('skills')
        .insert({ skill_key: testKey('rls.skill'), descriptor: 'editor-created' })
        .select('id')
        .single();
      expect(skill.error).toBeNull();
      await service.from('skills').delete().eq('id', skill.data!.id);
      // …and learners do not
      expect(
        (
          await userA.client
            .from('skills')
            .insert({ skill_key: testKey('rls.skill'), descriptor: 'learner-created' })
        ).error?.code,
      ).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------
  // Invariants (profiles, enrollments, XP, sync, jobs)
  // -------------------------------------------------------------------------
  it('creates a profile + settings from auth metadata (handle_new_user trigger)', async () => {
    const profile = await svc.profiles.getByUserId(userA.id);
    expect(profile?.ui_locale).toBe('fr-CA');
    expect(profile?.default_source_language_code).toBe('fr');
    expect(await svc.profiles.getSettings(userA.id)).not.toBeNull();
  });

  it('signup normalises the instruction language, leaves it NULL when absent and rejects unknown codes', async () => {
    const regional = await createTestUser(service, 'pt-br', { defaultSourceLanguageCode: 'pt-BR' });
    createdUserIds.push(regional.id);
    expect((await svc.profiles.getByUserId(regional.id))?.default_source_language_code).toBe('pt');
    const oauthStyle = await createTestUser(service, 'oauth', { defaultSourceLanguageCode: null });
    createdUserIds.push(oauthStyle.id);
    expect(
      (await svc.profiles.getByUserId(oauthStyle.id))?.default_source_language_code,
    ).toBeNull();
    // an unknown value aborts the signup instead of being substituted silently (§2.1 item 4)
    const unknown = await service.auth.admin.createUser({
      email: `rls-unknown-${randomUUID()}@test.local`,
      password: `pw-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { default_source_language_code: 'xx' },
    });
    expect(unknown.error).not.toBeNull();
    if (unknown.data?.user) createdUserIds.push(unknown.data.user.id);
  });

  it('enrollment carries its own source language, the track default script mode, and is visible only to its owner', async () => {
    expect(enrollmentA.source_language_code).toBe('fr');
    expect((await svc.enrollments.getById(enrollmentA.id))?.script_mode).toBe('both'); // Darija: Arabic + Arabizi, not 'native'
    const mine = await createRepositories(userA.client).enrollments.listForUser(userA.id);
    expect(mine.map((e) => e.id)).toContain(enrollmentA.id);
    // B cannot read A's enrollment, by id or by listing with A's user id
    const asB = createRepositories(userB.client);
    expect(await asB.enrollments.getById(enrollmentA.id)).toBeNull();
    expect(await asB.enrollments.listForUser(userA.id)).toEqual([]);
  });

  it('user B cannot modify, delete or spoof rows of user A', async () => {
    const upd = await userB.client
      .from('user_course_enrollments')
      .update({ status: 'archived' })
      .eq('id', enrollmentA.id)
      .select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual([]); // RLS filtered: zero rows affected
    const del = await userB.client
      .from('user_course_enrollments')
      .delete()
      .eq('id', enrollmentA.id)
      .select('id');
    expect(del.data).toEqual([]);
    const spoof = await userB.client.from('user_course_enrollments').insert({
      user_id: userA.id,
      course_track_id: 'french',
      source_language_code: 'en',
    } as never);
    expect(spoof.error?.code).toBe('42501');
    const still = await svc.enrollments.getById(enrollmentA.id);
    expect(still?.status).toBe('active');
  });

  it('anon can read the catalog but cannot write anything', async () => {
    const tracks = await createRepositories(anon).catalog.listTracks();
    expect(tracks).toHaveLength(30);
    expect(tracks[0]?.id).toBe('arabic-eastern');
    const coverage = await createRepositories(anon).catalog.listCoverage('french', 'fr');
    expect(coverage[0]?.status).toBe('planned');
    const ins = await anon.from('user_course_enrollments').insert({
      user_id: userA.id,
      course_track_id: 'french',
      source_language_code: 'en',
    } as never);
    expect(ins.error).not.toBeNull();
    const upd = await anon
      .from('course_tracks')
      .update({ display_name: 'hacked' })
      .eq('id', 'french')
      .select('id');
    expect(upd.data ?? []).toEqual([]);
    const xp = await anon.from('xp_ledger').insert({
      user_id: userA.id,
      amount: 100,
      reason: 'mission_completed',
      idempotency_key: randomUUID(),
    });
    expect(xp.error).not.toBeNull();
  });

  it('a learner cannot insert content_rights or course_tracks, nor read rights rows', async () => {
    const rights = await userA.client.from('content_rights').insert({
      permission_grant: 'forged',
      license_id: 'CC0',
      verified: true,
      commercial_redistribution: true,
    });
    expect(rights.error?.code).toBe('42501');
    const track = await userA.client.from('course_tracks').insert({
      id: 'klingon',
      sort_order: 31,
      display_name: 'Klingon',
      language_id: 'en',
      primary_target_variety_id: 'en',
      default_locale: 'tlh',
      scripts: {},
    });
    expect(track.error).not.toBeNull();
    const read = await userA.client.from('content_rights').select('id');
    expect(read.data).toEqual([]);
  });

  it('a learner cannot write XP directly; award_xp is service-only, idempotent and reference-checked', async () => {
    const direct = await userA.client.from('xp_ledger').insert({
      user_id: userA.id,
      amount: 500,
      reason: 'mission_completed',
      idempotency_key: randomUUID(),
    });
    expect(direct.error?.code).toBe('42501');
    const viaRpc = await userA.client.rpc('award_xp', {
      p_idempotency_key: randomUUID(),
      p_user_id: userA.id,
      p_amount: 500,
      p_reason: 'mission_completed',
    });
    expect(viaRpc.error?.code).toBe('42501'); // execute not granted to authenticated

    const key = randomUUID();
    const first = await svc.progress.awardXp({
      idempotencyKey: key,
      userId: userA.id,
      amount: 50,
      reason: 'mission_completed',
      enrollmentId: enrollmentA.id,
    });
    const replay = await svc.progress.awardXp({
      idempotencyKey: key,
      userId: userA.id,
      amount: 50,
      reason: 'mission_completed',
      enrollmentId: enrollmentA.id,
    });
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(replay.ledger_id).toBe(first.ledger_id);
    expect(replay.total_xp).toBe(first.total_xp);
    const ledger = await createRepositories(userA.client).progress.listXp(userA.id);
    expect(ledger.filter((l) => l.idempotency_key === key)).toHaveLength(1);
    expect(await createRepositories(userB.client).progress.listXp(userA.id)).toEqual([]);

    // a reference must be the user's own, completed row — and is paid once per reason
    const attempt = await svc.progress.startAttempt({
      user_id: userA.id,
      enrollment_id: enrollmentA.id,
      mission_id: fx.missionId,
      client_attempt_id: randomUUID(),
    });
    const award = (idempotencyKey: string, userId = userA.id) =>
      svc.progress.awardXp({
        idempotencyKey,
        userId,
        amount: 50,
        reason: 'mission_completed',
        referenceTable: 'mission_attempts',
        referenceId: attempt.id,
      });
    await expect(award(randomUUID())).rejects.toSatisfy(
      (e: unknown) => e instanceof DbError && e.code === '23503',
    );
    await svc.progress.updateAttempt(attempt.id, { completed_at: new Date().toISOString() });
    const paid = await award(randomUUID());
    expect(paid.applied).toBe(true);
    const again = await award(randomUUID());
    expect(again.applied).toBe(false);
    expect(again.ledger_id).toBe(paid.ledger_id);
    await expect(award(randomUUID(), userB.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof DbError && e.code === '23503',
    );
  });

  it('apply_sync_events is idempotent on client_event_id and hands xp_claim to the engine unpaid', async () => {
    const asA = createRepositories(userA.client);
    const xpBefore = await asA.progress.totalXp(userA.id);
    const claimId = randomUUID();
    const events = [
      {
        clientEventId: claimId,
        enrollmentId: enrollmentA.id,
        deviceId: 'dev-1',
        revision: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          type: 'xp_claim' as const,
          reason: 'review_completed' as const,
          referenceId: randomUUID(),
          amount: 9999,
        },
      },
      {
        clientEventId: randomUUID(),
        enrollmentId: enrollmentA.id,
        deviceId: 'dev-1',
        revision: 2,
        occurredAt: new Date().toISOString(),
        payload: {
          type: 'activity_minutes' as const,
          activityDate: '2026-10-14',
          minutesActive: 12,
          speakingSeconds: 90,
        },
      },
      {
        clientEventId: randomUUID(),
        enrollmentId: enrollmentA.id,
        deviceId: 'dev-1',
        revision: 3,
        occurredAt: new Date().toISOString(),
        payload: {
          type: 'review_result' as const,
          cardId: randomUUID(),
          rating: 'good' as const,
          hintsUsed: 0,
          replays: 0,
          responseTimeMs: 1200,
          scenarioId: null,
        },
      },
      {
        clientEventId: randomUUID(),
        enrollmentId: enrollmentA.id,
        deviceId: 'dev-1',
        revision: 4,
        occurredAt: new Date().toISOString(),
        payload: {
          type: 'xp_claim' as const,
          reason: 'mission_completed' as const,
          referenceId: null,
          amount: 9999,
        },
      },
    ];
    const results = await asA.progress.applySyncEvents(events, {
      clientSentAt: new Date().toISOString(),
    });
    expect(results.map((r) => r.resolution)).toEqual(['applied', 'applied', 'applied', 'rejected']);
    // xp_claim: recorded for the API Worker (handled_in_db = false), never credited by the DB
    expect(results[0]?.handled_in_db).toBe(false);
    expect(results[0]?.xp_credited).toBeNull();
    expect(results[1]?.handled_in_db).toBe(true);
    expect(results[2]?.handled_in_db).toBe(false);
    expect(results[3]?.reason).toBe('xp_claim_requires_reference');
    expect(await asA.progress.totalXp(userA.id)).toBe(xpBefore);
    const replay = await asA.progress.applySyncEvents([events[0]!]);
    expect(replay[0]?.resolution).toBe('duplicate');
    expect(replay[0]?.xp_credited).toBe(0);
    // the Worker finishes engine-handled events after validating them
    expect(await asA.progress.markSyncEventsApplied([claimId])).toBe(1);
    expect(await asA.progress.markSyncEventsApplied([claimId])).toBe(0);
    // B cannot sync events on behalf of A
    const err = await userB.client.rpc('apply_sync_events', {
      p_events: [events[1]] as never,
      p_user_id: userA.id,
    });
    expect(err.error?.code).toBe('42501');
    const streak = await asA.progress.listStreak(userA.id, '2026-10-01');
    expect(streak.find((s) => s.activity_date === '2026-10-14')?.minutes_active).toBe(12);
  });

  it('changing the enrollment source language keeps mastery, reviews and XP untouched', async () => {
    const asA = createRepositories(userA.client);
    // derived state is engine-written (service role); learners only read it
    await expect(
      asA.progress.upsertMastery([
        { user_id: userA.id, enrollment_id: enrollmentA.id, skill_key: 'greet.informal' },
      ]),
    ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.isForbidden);
    await svc.progress.upsertMastery([
      {
        user_id: userA.id,
        enrollment_id: enrollmentA.id,
        skill_key: 'greet.informal',
        mastery_state: 'practiced',
        internal_score: 0.6,
        evidence_count: 3,
        uncertainty: 0.3,
      },
    ]);
    await asA.progress.upsertReviewCard({
      user_id: userA.id,
      enrollment_id: enrollmentA.id,
      skill_key: 'greet.informal',
      next_due_at: new Date(Date.now() - 1000).toISOString(),
    });
    const before = await asA.progress.listMastery(enrollmentA.id);
    expect(before.map((m) => m.skill_key)).toContain('greet.informal');
    const xpBefore = await asA.progress.totalXp(userA.id);

    const changed = await asA.enrollments.changeSourceLanguage(enrollmentA.id, 'en');
    expect(changed.source_language_code).toBe('en');
    expect(changed.course_track_id).toBe('arabic-moroccan');
    expect(changed.script_mode).toBe('both'); // script mode belongs to the target track, not the source

    const after = await asA.progress.listMastery(enrollmentA.id);
    expect(
      after.map((m) => [m.skill_key, m.mastery_state, m.internal_score, m.evidence_count]),
    ).toEqual(
      before.map((m) => [m.skill_key, m.mastery_state, m.internal_score, m.evidence_count]),
    );
    expect(await asA.progress.totalXp(userA.id)).toBe(xpBefore);
    const due = await asA.progress.getDueReviews(enrollmentA.id, 10);
    expect(due.map((d) => d.skill_key)).toContain('greet.informal');
    // B cannot change A's source language through the RPC
    await expect(
      createRepositories(userB.client).enrollments.changeSourceLanguage(enrollmentA.id, 'es'),
    ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.isForbidden);
    // profile default never rewrites the enrollment
    await asA.profiles.update(userA.id, { default_source_language_code: 'es' });
    expect((await asA.enrollments.getById(enrollmentA.id))?.source_language_code).toBe('en');
  });

  it('enforces one active enrollment per (user, track) but allows a second with a different source once archived', async () => {
    const asA = createRepositories(userA.client);
    await expect(
      asA.enrollments.create({
        userId: userA.id,
        courseTrackId: 'arabic-moroccan',
        sourceLanguageCode: 'es',
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof DbError && e.isUniqueViolation);
    await asA.enrollments.update(enrollmentA.id, { status: 'archived' });
    const second = await asA.enrollments.create({
      userId: userA.id,
      courseTrackId: 'arabic-moroccan',
      sourceLanguageCode: 'es',
    });
    expect(second.source_language_code).toBe('es');
    expect(second.script_mode).toBe('both');
    await asA.enrollments.update(enrollmentA.id, { status: 'active' }).catch(() => undefined);
  });

  it('processing jobs: claim is exclusive (SKIP LOCKED), complete/fail transition states, ledgers are append-only', async () => {
    const key = `test:verify:${randomUUID()}`;
    const job = await svc.processingJobs.enqueue({
      jobType: 'verify',
      idempotencyKey: key,
      params: { x: 1 },
    });
    trackRow(rows, 'processing_jobs', job.id);
    const again = await svc.processingJobs.enqueue({ jobType: 'verify', idempotencyKey: key });
    expect(again.id).toBe(job.id);
    const [c1, c2] = await Promise.all([
      svc.processingJobs.claim('w1', ['verify']),
      svc.processingJobs.claim('w2', ['verify']),
    ]);
    const claimed = [c1, c2].filter((c) => c?.id === job.id);
    expect(claimed).toHaveLength(1);
    const winner = claimed[0]!.locked_by!;
    expect(await svc.processingJobs.heartbeat(job.id, winner, 40)).toBe(true);
    expect(await svc.processingJobs.heartbeat(job.id, 'impostor', 40)).toBe(false);
    const failed = await svc.processingJobs.fail(job.id, winner, 'E_TEST', 'first try failed');
    expect(failed.state).toBe('pending');
    expect(failed.attempts).toBe(1);
    // backoff lease keeps it unclaimable right now
    expect((await svc.processingJobs.claim('w3', ['verify']))?.id).not.toBe(job.id);
    await service
      .from('processing_jobs')
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq('id', job.id);
    const re = await svc.processingJobs.claim('w3', ['verify']);
    expect(re?.id).toBe(job.id);
    const done = await svc.processingJobs.complete(job.id, 'w3', { ok: true }, []);
    expect(done.state).toBe('succeeded');
    expect(done.progress_pct).toBe(100);
    // learners cannot see jobs at all
    expect((await userA.client.from('processing_jobs').select('id').eq('id', job.id)).data).toEqual(
      [],
    );
    // append-only ledger: even the service role cannot update xp rows
    const row = (
      await service.from('xp_ledger').select('id').eq('user_id', userA.id).limit(1).single()
    ).data;
    const upd = await service.from('xp_ledger').update({ amount: 9999 }).eq('id', row!.id);
    expect(upd.error?.message).toMatch(/append-only/);
  });

  it('processing jobs: editors enqueue as themselves but never claim; expired leases are swept, never stranded', async () => {
    const asEditor = createRepositories(editor.client);
    const enqueued = await asEditor.processingJobs.enqueue({
      jobType: 'verify',
      idempotencyKey: `test:attrib:${randomUUID()}`,
      requestedBy: userA.id, // ignored for JWT sessions: the caller is the requester
      maxAttempts: 1,
    });
    trackRow(rows, 'processing_jobs', enqueued.id);
    expect(enqueued.requested_by).toBe(editor.id);
    expect(
      (await editor.client.rpc('claim_processing_job', { p_worker_id: 'editor' })).error?.code,
    ).toBe('42501');
    expect((await editor.client.rpc('requeue_expired_jobs', {})).error?.code).toBe('42501');
    expect(
      (
        await editor.client
          .from('processing_jobs')
          .insert({ job_type: 'verify', idempotency_key: 'forged' })
      ).error?.code,
    ).toBe('42501');

    const claimed = await svc.processingJobs.claim('crashed-worker', ['verify']);
    expect(claimed?.id).toBe(enqueued.id);
    await service
      .from('processing_jobs')
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq('id', enqueued.id);
    const swept = await svc.processingJobs.requeueExpired();
    expect(swept.find((j) => j.job_id === enqueued.id)?.new_state).toBe('review_needed');
    const after = await svc.processingJobs.getById(enqueued.id);
    expect(after?.state).toBe('review_needed');
    expect(after?.locked_by).toBeNull();
    expect(after?.failure_code).toBe('lease_expired');
  });
});
