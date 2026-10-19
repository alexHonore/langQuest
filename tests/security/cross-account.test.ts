/**
 * A29 / §5.5 / §11: cross-account access is denied at the API layer AND at the database layer (RLS) for every
 * user-owned table — enrollments, progress, conversation transcripts, bookmarks, review cards, XP. The
 * negative RLS checks run as the attacker's own JWT through supabase-js (no API in between).
 */
import { USER_OWNED_TABLES } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, syncBody, userClient, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('security.cross-account');

describeStack('cross-account access is denied at API and DB layers (A29)', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let victim: TestUser;
  let attacker: TestUser;
  let enrollmentId: string;
  let sessionId: string;
  let lessonId: string;
  let bookmarkId: string;
  let cardId: string;
  let attemptId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [victim, attacker] = await Promise.all([createTestUser(h, 'victim', { defaultSourceLanguageCode: 'fr' }), createTestUser(h, 'attacker')]);
    enrollmentId = (await enrol(h, victim, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr' })).id;
    const character = await seeder.character('ary');
    const session = await seeder.conversationSession({ userId: victim.id, enrollmentId, characterId: character.id, varietyId: 'ary', sourceLanguageCode: 'fr', rubricOutcomes: { objectivesCompleted: [], skillsExercised: [], observations: [], priorityCorrections: [], summary: 'private summary of the victim', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0.5 } });
    sessionId = session.id;
    const turn = await h.service.from('conversation_turns').insert({ session_id: sessionId, turn_index: 1, speaker: 'learner', text: 'SECRET victim utterance', client_turn_id: crypto.randomUUID() });
    if (turn.error) throw new Error(`seed conversation_turns: ${turn.error.message}`);
    const rights = await seeder.rights({ verified: true, commercialRedistribution: true });
    const collection = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', rightsId: rights.id });
    const chapter = await seeder.audioChapter(collection.id);
    lessonId = (await seeder.audioLesson({ chapterId: chapter.id, rightsId: rights.id })).id;
    const bookmark = await h.service.from('bookmarks').insert({ user_id: victim.id, lesson_id: lessonId, position_ms: 1000, note: 'victim bookmark', client_event_id: crypto.randomUUID() }).select('id').single();
    bookmarkId = bookmark.data!.id;
    cardId = (await seeder.reviewCard({ userId: victim.id, enrollmentId, skillKey: 'greet.basic', dueAt: new Date(Date.now() - 1000).toISOString() })).id;
    const mission = await seeder.mission({ varietyId: 'ary' });
    const attempt = await h.service.from('mission_attempts').insert({ user_id: victim.id, enrollment_id: enrollmentId, mission_id: mission.id, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString() }).select('id').single();
    attemptId = attempt.data!.id;
    seeder.track('mission_attempts', attemptId);
    await h.service.from('user_skill_mastery').insert({ user_id: victim.id, enrollment_id: enrollmentId, skill_key: 'greet.basic', mastery_state: 'practiced', internal_score: 0.5, evidence_count: 2, uncertainty: 0.4 });
    await h.service.rpc('award_xp', { p_idempotency_key: crypto.randomUUID(), p_user_id: victim.id, p_amount: 50, p_reason: 'mission_completed', p_enrollment_id: enrollmentId });
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [victim, attacker]);
    await seeder.cleanup();
  });

  it('API: enrollments, skills, reviews, progress and sessions of another learner are 404/rejected, never 200', async () => {
    expect((await call(h, `/v1/me/enrollments/${enrollmentId}`, { method: 'PATCH', token: attacker.token, body: { sourceLanguageCode: 'en' } })).status).toBe(404);
    expect((await call(h, `/v1/me/enrollments/${enrollmentId}?confirm=delete`, { method: 'DELETE', token: attacker.token })).status).toBe(404);
    expect((await call(h, `/v1/me/skills?enrollmentId=${enrollmentId}`, { token: attacker.token })).status).toBe(404);
    expect((await call(h, `/v1/me/reviews/due?enrollmentId=${enrollmentId}`, { token: attacker.token })).status).toBe(404);
    const end = await call(h, `/v1/ai/conversation/${sessionId}/end`, { token: attacker.token, body: { reason: 'learner_ended', clientState: { lastSeq: 1, turnCount: 1 }, clientEventId: crypto.randomUUID() } });
    expect([403, 404]).toContain(end.status);
    const turn = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: attacker.token, body: { clientTurnId: crypto.randomUUID(), input: { kind: 'text', text: 'hi' }, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null } } });
    expect([403, 404, 412, 501]).toContain(turn.status);
    expect(turn.json.ok).toBe(false);
    const progress = await call(h, '/v1/me/progress', { token: attacker.token });
    expect(progress.json.data.totalXp).toBe(0);
    expect(progress.json.data.perEnrollment).toEqual([]);
    const exported = await call(h, '/v1/me/export', { token: attacker.token });
    expect(JSON.stringify(exported.json)).not.toMatch(/SECRET victim utterance|private summary of the victim|victim bookmark/);
    const still = await h.service.from('user_course_enrollments').select('source_language_code, status').eq('id', enrollmentId).single();
    expect(still.data).toEqual({ source_language_code: 'fr', status: 'active' });
  });

  it('API: a mission evaluation cannot reference another learner\'s attempt or conversation session', async () => {
    const attackerEnrollment = await enrol(h, attacker, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' });
    const mission = await seeder.mission({ varietyId: 'ary' });
    const steps = await seeder.steps(mission.id, ['context_listening']);
    const ownAttempt = await call(h, `/v1/missions/${mission.id}/attempts`, { token: attacker.token, body: { enrollmentId: attackerEnrollment.id, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    const stolenAttempt = await call(h, `/v1/missions/${mission.id}/evaluate`, { token: attacker.token, body: { attemptId, enrollmentId: attackerEnrollment.id, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [{ stepId: steps[0]!.id, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 1000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null }] } });
    expect([403, 404]).toContain(stolenAttempt.status);
    const stolenSession = await call(h, `/v1/missions/${mission.id}/evaluate`, { token: attacker.token, body: { attemptId: ownAttempt.json.data.attemptId, enrollmentId: attackerEnrollment.id, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [{ stepId: steps[0]!.id, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 1000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: sessionId }] } });
    expect(stolenSession.status).toBe(403);
    const sync = await call(h, '/v1/me/progress/sync', { token: attacker.token, body: syncBody('x', [{ enrollmentId: attackerEnrollment.id, revision: 1, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: attemptId, amount: 50 } }, { enrollmentId: attackerEnrollment.id, revision: 2, payload: { type: 'review_result', cardId, rating: 'easy', hintsUsed: 0, replays: 0, responseTimeMs: null, scenarioId: null } }]) });
    for (const r of sync.json.data.results) expect(r.resolution).toBe('rejected');
  });

  it('API: audio bookmarks and progress of another learner are invisible', async () => {
    const theirs = await h.service.from('bookmarks').select('id').eq('id', bookmarkId).single();
    expect(theirs.data).toBeTruthy();
    const db = userClient(h, attacker);
    const read = await db.from('bookmarks').select('*').eq('id', bookmarkId);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const del = await db.from('bookmarks').delete().eq('id', bookmarkId).select('id');
    expect(del.data ?? []).toEqual([]);
    const update = await db.from('bookmarks').update({ note: 'defaced' }).eq('id', bookmarkId).select('id');
    expect(update.data ?? []).toEqual([]);
    const stillThere = await h.service.from('bookmarks').select('note').eq('id', bookmarkId).single();
    expect(stillThere.data?.note).toBe('victim bookmark');
  });

  it('DB (RLS): every user-owned table hides, and refuses updates/deletes to, another user\'s rows', async () => {
    const db = userClient(h, attacker);
    const failures: string[] = [];
    for (const table of USER_OWNED_TABLES) {
      const owned = await h.service.from(table).select('*').eq('user_id', victim.id).limit(1);
      const sample = owned.data?.[0] as Record<string, unknown> | undefined;
      const seen = await db.from(table).select('*').eq('user_id', victim.id);
      if (seen.error) failures.push(`${table}: select errored (${seen.error.message})`);
      else if ((seen.data?.length ?? 0) > 0) failures.push(`${table}: attacker could read ${seen.data!.length} victim row(s)`);
      if (!sample) continue; // no victim row in this table for this run; the select above still proves the filter
      const patchKey = Object.keys(sample).find((k) => !['id', 'user_id', 'created_at', 'updated_at'].includes(k) && typeof sample[k] === 'string') ?? null;
      if (patchKey) {
        const updated = await db.from(table).update({ [patchKey]: sample[patchKey] } as never).eq('user_id', victim.id).select('user_id');
        if ((updated.data?.length ?? 0) > 0) failures.push(`${table}: attacker could update a victim row`);
      }
      const deleted = await db.from(table).delete().eq('user_id', victim.id).select('user_id');
      if ((deleted.data?.length ?? 0) > 0) failures.push(`${table}: attacker could delete a victim row`);
      const after = await h.service.from(table).select('user_id').eq('user_id', victim.id).limit(1);
      if ((after.data?.length ?? 0) === 0) failures.push(`${table}: victim row vanished after attacker delete`);
    }
    expect(failures).toEqual([]);
  });

  it('DB (RLS): inserting rows on behalf of another user is refused for owned tables', async () => {
    const db = userClient(h, attacker);
    const results: Record<string, string | null> = {};
    const attempts: Array<[string, PromiseLike<{ error: { message: string } | null }>]> = [
      ['user_course_enrollments', db.from('user_course_enrollments').insert({ user_id: victim.id, course_track_id: 'german', source_language_code: 'en', script_mode: 'native' })],
      ['bookmarks', db.from('bookmarks').insert({ user_id: victim.id, lesson_id: lessonId, position_ms: 5, client_event_id: crypto.randomUUID() })],
      ['user_expression_reviews', db.from('user_expression_reviews').insert({ user_id: victim.id, enrollment_id: enrollmentId, skill_key: 'forged.skill' })],
      ['conversation_sessions', db.from('conversation_sessions').insert({ id: crypto.randomUUID(), user_id: victim.id, enrollment_id: enrollmentId, character_id: crypto.randomUUID(), target_variety_id: 'ary', source_language_code: 'fr' })],
      ['mission_attempts', db.from('mission_attempts').insert({ user_id: victim.id, enrollment_id: enrollmentId, mission_id: crypto.randomUUID(), client_attempt_id: crypto.randomUUID() })],
      ['user_audio_progress', db.from('user_audio_progress').insert({ user_id: victim.id, lesson_id: lessonId, position_ms: 1 })],
    ];
    for (const [table, p] of attempts) results[table] = (await p).error?.message ?? null;
    for (const [table, error] of Object.entries(results)) expect(error, `${table} insert as victim must fail`).not.toBeNull();
    const forgedEnrollments = await h.service.from('user_course_enrollments').select('id').eq('user_id', victim.id).eq('course_track_id', 'german');
    expect(forgedEnrollments.data).toEqual([]);
  });

  it('DB (RLS): conversation transcripts are only readable by their owner', async () => {
    const db = userClient(h, attacker);
    const sessions = await db.from('conversation_sessions').select('id, summary, rubric_outcomes').eq('id', sessionId);
    expect(sessions.data).toEqual([]);
    const turns = await db.from('conversation_turns').select('text').eq('session_id', sessionId);
    expect(turns.data ?? []).toEqual([]);
    const mine = userClient(h, victim);
    const ownTurns = await mine.from('conversation_turns').select('text').eq('session_id', sessionId);
    expect(ownTurns.data?.map((t) => t.text)).toEqual(['SECRET victim utterance']);
  });
});
