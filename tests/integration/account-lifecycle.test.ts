/**
 * §0.2 / §11 / A28 — data export and account deletion through the API, with evidence ledgers present.
 *
 * The learner first produces real ledger rows the way the product does (mission evaluate → xp_ledger +
 * learning_observations; audio progress / sync → device_sync_events; a bookmark), then:
 *   - `GET /v1/me/export` is a portable bundle built from the learner's OWN rows only (contract-validated, no-store);
 *   - `DELETE /v1/me` needs the literal confirmation and, for an ordinary learner, answers `status: 'deleted'` even
 *     though append-only ledgers exist (the `delete_account` bypass removes them), removes every owned row and the
 *     auth user, anonymises the retained ledgers (audit) and leaves other learners untouched.
 */
import { MeDeleteResponseSchema, MeExportResponseSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, syncBody, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.account-lifecycle');

const OWNED_TABLES = ['xp_ledger', 'learning_observations', 'device_sync_events', 'mission_attempts', 'mission_progress', 'user_skill_mastery', 'user_expression_reviews', 'user_audio_progress', 'bookmarks', 'streak_activity', 'user_course_enrollments', 'account_settings', 'profiles'] as const;

describeStack('account export and deletion (A28) with ledger rows present', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let bystander: TestUser;
  let enrollmentId: string;
  let missionId: string;
  let stepIds: string[];
  let lessonId: string;

  const countOwned = async (userId: string): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const table of OWNED_TABLES) {
      const res = await h.service.from(table).select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
      if (res.error) throw new Error(`count ${table}: ${res.error.message}`);
      out[table] = res.count ?? 0;
    }
    return out;
  };

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [learner, bystander] = await Promise.all([createTestUser(h, 'a28-learner'), createTestUser(h, 'a28-bystander')]);
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'spanish-spain', sourceLanguageCode: 'en' })).id;
    await enrol(h, bystander, { courseTrackId: 'spanish-spain', sourceLanguageCode: 'en' });

    // Curriculum: one mission with a modeled expression so evaluate writes observations, mastery, reviews and XP.
    const course = await seeder.course({ trackId: 'spanish-spain' });
    const chapter = await seeder.chapter({ courseId: course.id });
    const intent = await seeder.intent(['order.drink']);
    const expr = await seeder.expression({ intentId: intent.id, varietyId: 'es-ES', text: 'Un café, por favor', forms: [{ script: 'Latn', text: 'Un café, por favor' }], translations: { en: 'A coffee, please' } });
    const mission = await seeder.mission({ chapterId: chapter.id, varietyId: 'es-ES', titles: { en: 'Order a coffee' }, goals: [{ id: 'g1', skill_keys: ['order.drink'] }] });
    missionId = mission.id;
    await seeder.localization(mission.id, 'en', { title: 'Order a coffee' });
    stepIds = (await seeder.steps(mission.id, ['context_listening', 'modeled_expression', 'review_recall'], [expr.id])).map((s) => s.id);

    // Audio library: one published lesson for listening progress / bookmarks.
    const rights = await seeder.rights({ verified: true, commercialRedistribution: true });
    const collection = await seeder.audioCollection({ trackId: 'spanish-spain', varietyId: 'es-ES', rightsId: rights.id });
    const audioChapter = await seeder.audioChapter(collection.id);
    lessonId = (await seeder.audioLesson({ chapterId: audioChapter.id, rightsId: rights.id, varietyId: 'es-ES' })).id;

    // Ledger rows, produced through the API like a real client would.
    const attempt = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    expect(attempt.status, JSON.stringify(attempt.json)).toBe(201);
    const evaluated = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body: { attemptId: attempt.json.data.attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: stepIds.map((stepId) => ({ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 30_000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null })) } });
    expect(evaluated.status, JSON.stringify(evaluated.json)).toBe(200);
    expect(evaluated.json.data.xpAwarded).toBeGreaterThan(0);
    for (const user of [learner, bystander]) {
      const progress = await call(h, `/v1/me/audio-progress/${lessonId}`, { method: 'PUT', token: user.token, body: { clientEventId: crypto.randomUUID(), deviceId: 'phone', revision: 1, positionMs: 12_000, durationMs: 45 * 60 * 1000, completed: false, occurredAt: new Date().toISOString(), clientSentAt: new Date().toISOString() } });
      expect(progress.status, JSON.stringify(progress.json)).toBe(200);
    }
    const sync = await call(h, '/v1/me/progress/sync', { token: learner.token, body: syncBody('phone', [{ enrollmentId: null, revision: 1, payload: { type: 'activity_minutes', activityDate: new Date().toISOString().slice(0, 10), minutesActive: 7, speakingSeconds: 0 } }]) });
    expect(sync.status, JSON.stringify(sync.json)).toBe(200);
    const bookmark = await call(h, '/v1/me/audio-bookmarks', { token: learner.token, body: { clientEventId: crypto.randomUUID(), lessonId, positionMs: 5_000, note: 'export me', segmentId: null } });
    expect(bookmark.status).toBe(201);
    await h.app.flush();
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [learner, bystander]);
    await seeder.cleanup();
  });

  it('the ledgers really exist before export/deletion (sanity: the test is not vacuous)', async () => {
    const counts = await countOwned(learner.id);
    expect(counts.xp_ledger).toBeGreaterThanOrEqual(1);
    expect(counts.learning_observations).toBeGreaterThanOrEqual(1);
    expect(counts.device_sync_events).toBeGreaterThanOrEqual(2);
    expect(counts.user_audio_progress).toBe(1);
    expect(counts.bookmarks).toBe(1);
    expect(counts.profiles).toBe(1);
    // Ledgers are append-only for everyone but the deletion bypass: the service client cannot delete them directly.
    const direct = await h.service.from('xp_ledger').delete().eq('user_id', learner.id);
    expect(direct.error).not.toBeNull();
    expect((await countOwned(learner.id)).xp_ledger).toBe(counts.xp_ledger);
  });

  it('GET /v1/me/export is a contract-valid bundle of the learner’s own rows only, never cached', async () => {
    const res = await call(h, '/v1/me/export', { token: learner.token });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-disposition')).toContain('langquest-export.json');
    const bundle = MeExportResponseSchema.parse(res.json.data);
    expect(bundle.profile.userId).toBe(learner.id);
    expect(bundle.enrollments.map((e) => e.id)).toEqual([enrollmentId]);
    const progress = bundle.progress as { totalXp: number; xpLedger: Array<{ reason: string; amount: number }>; perEnrollment: Array<{ enrollmentId: string; mastery: unknown[]; reviews: unknown[]; missionProgress: unknown[] }> };
    expect(progress.totalXp).toBeGreaterThan(0);
    expect(progress.xpLedger.some((row) => row.reason === 'mission_completed')).toBe(true);
    expect(progress.xpLedger.reduce((sum, row) => sum + row.amount, 0)).toBe(progress.totalXp);
    const per = progress.perEnrollment.find((p) => p.enrollmentId === enrollmentId);
    expect(per?.mastery.length).toBeGreaterThan(0);
    expect(per?.missionProgress.length).toBeGreaterThan(0);
    // Only the learner's listening progress — the bystander listened to the same lesson and must not appear.
    expect(bundle.audioProgress).toHaveLength(1);
    expect(bundle.audioProgress[0]).toMatchObject({ lesson_id: lessonId, position_ms: 12_000 });
    expect(JSON.stringify(bundle)).not.toContain(bystander.id);
    expect(bundle.notes.join(' ')).toMatch(/recordings/i);
    // Anonymous callers get nothing; another learner's token exports their own (different) bundle.
    expect((await call(h, '/v1/me/export')).status).toBe(401);
    const other = await call(h, '/v1/me/export', { token: bystander.token });
    expect(other.status).toBe(200);
    expect(other.json.data.profile.userId).toBe(bystander.id);
    expect(other.json.data.progress.xpLedger).toEqual([]);
  });

  it('deletion requires the literal confirmation; a wrong body changes nothing', async () => {
    const before = await countOwned(learner.id);
    for (const body of [{}, { confirmation: 'delete' }, { confirmation: 'YES' }]) {
      const res = await call(h, '/v1/me', { method: 'DELETE', token: learner.token, body });
      expect(res.status).toBe(422);
      expect(res.json.ok).toBe(false);
    }
    expect((await call(h, '/v1/me', { method: 'DELETE', body: { confirmation: 'DELETE' } })).status).toBe(401);
    expect(await countOwned(learner.id)).toEqual(before);
  });

  it('DELETE /v1/me with ledger rows answers "deleted": owned rows and the auth user are gone, retained ledgers anonymised, other learners untouched', async () => {
    const bystanderBefore = await countOwned(bystander.id);
    const res = await call(h, '/v1/me', { method: 'DELETE', token: learner.token, body: { confirmation: 'DELETE', deleteOptInRecordings: true } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const summary = MeDeleteResponseSchema.parse(res.json.data);
    expect(summary.status).toBe('deleted'); // ordinary learner: ledgers never force the "scheduled" path
    expect(summary.anonymisedTables).toContain('audit_logs');
    expect(summary.anonymisedTables).toContain('ai_requests');
    expect(summary.retainedForLegalReasons.join(' ')).not.toMatch(/editorial attribution|retention job/);
    await h.app.flush();

    // Every owned row is gone, including the append-only ledgers.
    const after = await countOwned(learner.id);
    for (const table of OWNED_TABLES) expect(after[table], table).toBe(0);
    const turns = await h.service.from('conversation_sessions').select('id', { count: 'exact', head: true }).eq('user_id', learner.id);
    expect(turns.count ?? 0).toBe(0);
    // The auth user itself is deleted (not merely banned), so the e-mail could be re-registered.
    const authUser = await h.service.auth.admin.getUserById(learner.id);
    expect(authUser.data.user ?? null).toBeNull();
    // The old token no longer yields learner data.
    const me = await call(h, '/v1/me', { token: learner.token });
    expect(me.status).not.toBe(200);
    expect(me.json.ok).toBe(false);
    // The audit trail of the deletion is kept without an actor reference (anonymised), by both the RPC and the API.
    const audit = await h.service.from('audit_logs').select('action, actor_id, entity_id').in('action', ['account.delete_account', 'account.delete']).eq('entity_id', learner.id);
    const actions = (audit.data ?? []).map((row) => row.action).sort();
    expect(actions).toEqual(['account.delete', 'account.delete_account']);
    expect((audit.data ?? []).every((row) => row.actor_id === null)).toBe(true);
    // The bystander keeps everything.
    expect(await countOwned(bystander.id)).toEqual(bystanderBefore);
    const other = await call(h, '/v1/me', { token: bystander.token });
    expect(other.status).toBe(200);
  });
});
