/**
 * Integration tests against the LOCAL Supabase stack (Docker): real JWTs, real RLS, real RPCs.
 * Journeys: A01/A02 enrollment with per-enrollment source language, A03 two enrollments side by side,
 * A04 source-language change preserving mastery, A27 sync idempotency across two devices + xp_claim validation
 * (server-side reference ownership, canonical amounts), A29 cross-account denial, admin-role enforcement,
 * A28 export/delete, manifest caching and honest capability answers without providers.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createStackUser, deleteStackUsers, describeWithStack, stackApp, type StackHarness, type TestUser } from '../harness';

const describeStack = describeWithStack('api.stack');

describeStack('API against the local stack', () => {
  let h: StackHarness;
  let alice: TestUser;
  let bob: TestUser;
  let editor: TestUser;
  let admin: TestUser;
  const created: string[] = [];

  beforeAll(async () => {
    h = stackApp();
    [alice, bob, editor, admin] = await Promise.all([createStackUser(h, 'alice', { defaultSourceLanguageCode: 'fr' }), createStackUser(h, 'bob', { defaultSourceLanguageCode: 'en' }), createStackUser(h, 'editor', { role: 'content_editor' }), createStackUser(h, 'admin', { role: 'admin' })]);
    created.push(alice.id, bob.id, editor.id, admin.id);
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteStackUsers(h, created);
  });

  it('GET /v1/me returns the verified principal, profile and roles', async () => {
    const me = await call(h.app, '/v1/me', { token: alice.token });
    expect(me.status).toBe(200);
    expect(me.json.data).toMatchObject({ userId: alice.id, uiLocale: 'fr-CA', defaultSourceLanguageCode: 'fr', roles: [], enrollments: [] });
    const adminMe = await call(h.app, '/v1/me', { token: admin.token });
    expect(adminMe.json.data.roles).toEqual(['admin']);
  });

  it('public catalog routes work for anonymous callers and expose honest coverage', async () => {
    const courses = await call(h.app, '/v1/courses?source=fr');
    expect(courses.status).toBe(200);
    const darija = courses.json.data.courses.find((c: { track: { id: string } }) => c.track.id === 'arabic-moroccan');
    expect(darija.coverage).toHaveLength(1);
    expect(darija.coverage[0].sourceLanguageCode).toBe('fr');
    expect(['planned', 'partial', 'complete', 'unavailable']).toContain(darija.coverage[0].status);
    expect(darija.coverage[0].nativeReviewed).toBe(false);
    const coverage = await call(h.app, '/v1/courses/arabic-moroccan/coverage');
    expect(coverage.json.data.coverage.length).toBeGreaterThanOrEqual(23);
  });

  let darijaId: string;
  let japaneseId: string;

  it('A01/A02/A03 — enrollments carry their own source language and can coexist', async () => {
    const missingSource = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'arabic-moroccan' } });
    expect(missingSource.status).toBe(422);
    const darija = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' } });
    expect(darija.status).toBe(201);
    expect(darija.json.data).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', scriptMode: 'both', status: 'active' });
    darijaId = darija.json.data.id;
    const japanese = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'japanese', sourceLanguageCode: 'en' } });
    expect(japanese.status).toBe(201);
    expect(japanese.json.data.sourceLanguageCode).toBe('en');
    japaneseId = japanese.json.data.id;
    const duplicate = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' } });
    expect(duplicate.status).toBe(409);
    const wrongVariety = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'arb' } });
    expect(wrongVariety.status).toBe(422);
    const list = await call(h.app, '/v1/me/enrollments', { token: alice.token });
    expect(list.json.data.enrollments.map((e: { sourceLanguageCode: string }) => e.sourceLanguageCode).sort()).toEqual(['en', 'fr']);
  });

  it('A04 — changing the source language keeps mastery, reviews and XP (RPC touches one column)', async () => {
    // Seed evidence with the service client (as the engine would after a mission).
    const seeded = await h.service.from('user_skill_mastery').insert({ user_id: alice.id, enrollment_id: darijaId, skill_key: 'greet.basic', mastery_state: 'practiced', internal_score: 0.6, evidence_count: 3, uncertainty: 0.3 }).select('id').single();
    expect(seeded.error).toBeNull();
    const award = await h.service.rpc('award_xp', { p_idempotency_key: crypto.randomUUID(), p_user_id: alice.id, p_amount: 50, p_reason: 'mission_completed', p_enrollment_id: darijaId });
    expect(award.error).toBeNull();
    const patch = await call(h.app, `/v1/me/enrollments/${darijaId}`, { method: 'PATCH', token: alice.token, body: { sourceLanguageCode: 'en' } });
    expect(patch.status).toBe(200);
    expect(patch.json.data.sourceLanguageCode).toBe('en');
    expect(patch.json.data.courseTrackId).toBe('arabic-moroccan');
    const skills = await call(h.app, `/v1/me/skills?enrollmentId=${darijaId}`, { token: alice.token });
    expect(skills.json.data.items).toHaveLength(1);
    expect(skills.json.data.items[0]).toMatchObject({ skillKey: 'greet.basic', masteryState: 'practiced' });
    const progress = await call(h.app, '/v1/me/progress', { token: alice.token });
    expect(progress.json.data.totalXp).toBe(50);
    expect(progress.json.data.perEnrollment.find((e: { enrollmentId: string }) => e.enrollmentId === darijaId).xp).toBe(50);
    // Back to French; the mission manifest is served per (track, source) and edge-cached.
    const back = await call(h.app, `/v1/me/enrollments/${darijaId}`, { method: 'PATCH', token: alice.token, body: { sourceLanguageCode: 'fr' } });
    expect(back.json.data.sourceLanguageCode).toBe('fr');
    const manifest = await call(h.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: alice.token });
    expect(manifest.status).toBe(200);
    expect(manifest.json.data).toMatchObject({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary' });
    expect(manifest.headers.get('etag')).toBeTruthy();
    const cached = await call(h.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: alice.token, headers: { 'if-none-match': manifest.headers.get('etag')! } });
    expect(cached.status).toBe(304);
  });

  it('archiving and deleting a course require explicit confirmation', async () => {
    const noConfirm = await call(h.app, `/v1/me/enrollments/${japaneseId}`, { method: 'PATCH', token: alice.token, body: { status: 'archived' } });
    expect(noConfirm.status).toBe(412);
    expect(noConfirm.json.error.details).toMatchObject({ requiredConfirmation: 'archive' });
    const archived = await call(h.app, `/v1/me/enrollments/${japaneseId}?confirm=archive`, { method: 'PATCH', token: alice.token, body: { status: 'archived' } });
    expect(archived.json.data.status).toBe('archived');
    const del = await call(h.app, `/v1/me/enrollments/${japaneseId}`, { method: 'DELETE', token: alice.token });
    expect(del.status).toBe(412);
    const deleted = await call(h.app, `/v1/me/enrollments/${japaneseId}?confirm=delete`, { method: 'DELETE', token: alice.token });
    expect(deleted.status).toBe(200);
    const list = await call(h.app, '/v1/me/enrollments?includeArchived=true', { token: alice.token });
    expect(list.json.data.enrollments.map((e: { id: string }) => e.id)).toEqual([darijaId]);
  });

  it('A29 — another learner cannot read or change Alice’s enrollment, sessions or progress', async () => {
    const read = await call(h.app, `/v1/me/skills?enrollmentId=${darijaId}`, { token: bob.token });
    expect(read.status).toBe(404);
    const patch = await call(h.app, `/v1/me/enrollments/${darijaId}`, { method: 'PATCH', token: bob.token, body: { sourceLanguageCode: 'es' } });
    expect(patch.status).toBe(404);
    const sync = await call(h.app, '/v1/me/progress/sync', { token: bob.token, body: { deviceId: 'bob-phone', clientSentAt: new Date().toISOString(), events: [{ clientEventId: crypto.randomUUID(), enrollmentId: darijaId, deviceId: 'bob-phone', revision: 1, occurredAt: new Date().toISOString(), payload: { type: 'enrollment_opened', enrollmentId: darijaId } }] } });
    expect(sync.status).toBe(200);
    expect(sync.json.data.results[0].resolution).toBe('rejected');
    const still = await h.service.from('user_course_enrollments').select('source_language_code').eq('id', darijaId).single();
    expect(still.data?.source_language_code).toBe('fr');
    const adminOnly = await call(h.app, '/v1/admin/assets', { token: bob.token });
    expect(adminOnly.status).toBe(403);
  });

  it('A27 — the same XP claim from two devices is paid once and validated against an owned, completed row', async () => {
    // A completed mission attempt is the only thing that can back a mission_completed claim.
    const mission = await h.service.from('missions').insert({ template_key: `api_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, target_variety_id: 'ary', state: 'published', title_translations: { fr: 'Test' } }).select('id').single();
    expect(mission.error).toBeNull();
    const attempt = await h.service.from('mission_attempts').insert({ user_id: alice.id, enrollment_id: darijaId, mission_id: mission.data!.id, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString() }).select('id').single();
    expect(attempt.error).toBeNull();
    const clientEventId = crypto.randomUUID();
    const event = (deviceId: string) => ({ clientEventId, enrollmentId: darijaId, deviceId, revision: 7, occurredAt: new Date().toISOString(), payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: attempt.data!.id, amount: 999 } });
    const [phone, tablet] = await Promise.all([
      call(h.app, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'phone', clientSentAt: new Date().toISOString(), events: [event('phone')] } }),
      call(h.app, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'tablet', clientSentAt: new Date().toISOString(), events: [event('tablet')] } }),
    ]);
    const results = [phone.json.data.results[0], tablet.json.data.results[0]];
    const applied = results.filter((r) => r.resolution === 'applied');
    const duplicates = results.filter((r) => r.resolution === 'duplicate');
    expect(applied).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(applied[0].xpCredited).toBe(50); // canonical amount, client said 999
    expect(duplicates[0].xpCredited).toBe(0);
    const replay = await call(h.app, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'phone', clientSentAt: new Date().toISOString(), events: [event('phone')] } });
    expect(replay.json.data.results[0].resolution).toBe('duplicate');
    // A claim referencing Bob's row (or an unfinished attempt) is rejected, never paid.
    const bobEnrollment = await h.service.from('user_course_enrollments').insert({ user_id: bob.id, course_track_id: 'arabic-moroccan', source_language_code: 'en', script_mode: 'both' }).select('id').single();
    const bobAttempt = await h.service.from('mission_attempts').insert({ user_id: bob.id, enrollment_id: bobEnrollment.data!.id, mission_id: mission.data!.id, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString() }).select('id').single();
    const stolen = await call(h.app, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'phone', clientSentAt: new Date().toISOString(), events: [{ ...event('phone'), clientEventId: crypto.randomUUID(), payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: bobAttempt.data!.id, amount: 50 } }] } });
    expect(stolen.json.data.results[0].resolution).toBe('rejected');
    expect(stolen.json.data.results[0].xpCredited).toBe(0);
    const total = await h.service.rpc('user_total_xp', { p_user_id: alice.id });
    expect(Number(total.data)).toBe(100); // 50 seeded earlier + 50 from the single valid claim
    // Observations submitted via sync survive and recompute mastery.
    const obs = await call(h.app, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'phone', clientSentAt: new Date().toISOString(), events: [{ clientEventId: crypto.randomUUID(), enrollmentId: darijaId, deviceId: 'phone', revision: 8, occurredAt: new Date().toISOString(), payload: { type: 'observation', observation: { enrollmentId: darijaId, skillKey: 'order.drink', observationType: 'semantic_success', scenarioId: 'cafe', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 0.9, scorerKind: 'deterministic', scorerVersion: 'client-test', uncertainty: 0.2, note: null } } }] } });
    expect(obs.json.data.results[0].resolution).toBe('applied');
    const mastery = await h.service.from('user_skill_mastery').select('skill_key, mastery_state').eq('enrollment_id', darijaId);
    expect(mastery.data?.map((m) => m.skill_key).sort()).toEqual(['greet.basic', 'order.drink']);
    await h.service.from('missions').delete().eq('id', mission.data!.id);
  });

  it('admin routes enforce roles server-side and audit mutations', async () => {
    const learner = await call(h.app, '/v1/admin/models', { token: alice.token });
    expect(learner.status).toBe(403);
    const list = await call(h.app, '/v1/admin/models', { token: editor.token });
    expect(list.status).toBe(200);
    expect(list.json.data.profiles.length).toBeGreaterThanOrEqual(12);
    const put = await call(h.app, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: editor.token, body: { task: 'character_dialogue', targetVariety: null, sourceLanguage: null, provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: [], params: {}, latencyClass: 'realtime', enabled: false, dailyBudgetUsd: null, requireSmokeTests: false } });
    expect(put.status).toBe(403);
    const adminPut = await call(h.app, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: admin.token, body: { task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr', provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: ['google/gemini-3.8-flash'], params: { temperature: 0.7 }, latencyClass: 'realtime', enabled: false, dailyBudgetUsd: 5, requireSmokeTests: false } });
    expect(adminPut.status).toBe(200);
    expect(adminPut.json.data.profile).toMatchObject({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr', enabled: false });
    await h.app.flush();
    const audit = await h.service.from('audit_logs').select('action, actor_id').eq('actor_id', admin.id);
    expect(audit.data?.some((a) => a.action === 'models.config_put')).toBe(true);
    await h.service.from('ai_model_profiles').delete().eq('id', adminPut.json.data.profile.id);
    const jobs = await call(h.app, `/v1/admin/processing-jobs/${crypto.randomUUID()}`, { token: editor.token });
    expect(jobs.status).toBe(404);
    const analytics = await call(h.app, '/v1/admin/analytics/usage?from=2026-10-01&to=2026-10-14', { token: editor.token });
    expect(analytics.status).toBe(200);
    expect(analytics.json.data.byTrack.find((t: { trackId: string }) => t.trackId === 'arabic-moroccan').activeLearners).toBeGreaterThanOrEqual(1);
    const cost = await call(h.app, '/v1/admin/analytics/cost?from=2026-10-01&to=2026-10-14', { token: admin.token });
    expect(cost.status).toBe(200);
    expect(cost.json.data.reconciliation.invoicedUsd).toBeNull();
  });

  it('media endpoints never fabricate URLs when R2 is not configured', async () => {
    const upload = await call(h.app, '/v1/admin/uploads/initiate', { token: editor.token, body: { filename: 'lesson.mp3', contentType: 'audio/mpeg', byteLength: 10_000_000, clientChecksumSha256: 'a'.repeat(64), idempotencyKey: `idem-${crypto.randomUUID()}`, kind: 'audio' } });
    expect(upload.status).toBe(501);
    expect(upload.json.error.code).toBe('capability_unsupported');
    expect(upload.json.error.message).toMatch(/R2/);
    const playback = await call(h.app, `/v1/audio/assets/${crypto.randomUUID()}/playback-url`, { token: alice.token, body: {} });
    expect(playback.status).toBe(404);
    const importPrefix = await call(h.app, '/v1/admin/library/import-r2-prefix', { token: editor.token, body: { prefix: 'imports/x/', idempotencyKey: `idem-${crypto.randomUUID()}` } });
    expect(importPrefix.status).toBe(501);
  });

  it('speech routes answer honestly without providers configured', async () => {
    const caps = await call(h.app, '/v1/ai/model-capabilities?trackId=arabic-moroccan', { token: alice.token });
    expect(caps.status).toBe(200);
    expect(caps.json.data.pronunciationScoring).toBe('none');
    expect(caps.json.data.tasks.every((t: { capability: { supported: boolean } }) => t.capability.supported === false)).toBe(true);
    const session = await call(h.app, '/v1/ai/conversation/session', { token: alice.token, body: { enrollmentId: darijaId, clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(session.status).toBe(501);
    expect(session.json.error.code).toBe('capability_unsupported');
    const assess = await call(h.app, '/v1/speech/pronunciation-assess', { token: alice.token, body: { enrollmentId: darijaId, targetVarietyId: 'arb', referenceText: 'x', audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, clientRequestId: crypto.randomUUID() } });
    expect(assess.status).toBe(422); // arb is not this enrollment's variety: no silent substitution
    expect(assess.json.error.message).toMatch(/different variety/);
  });

  it('reviews/due and audio library are scoped to the learner', async () => {
    const due = await call(h.app, `/v1/me/reviews/due?enrollmentId=${darijaId}`, { token: alice.token });
    expect(due.status).toBe(200);
    expect(due.json.data).toMatchObject({ enrollmentId: darijaId, dueCount: 0, items: [] });
    const collections = await call(h.app, '/v1/audio/collections?language=ary', { token: alice.token });
    expect(collections.status).toBe(200);
    expect(Array.isArray(collections.json.data.items)).toBe(true);
    const progress = await call(h.app, `/v1/me/audio-progress/${crypto.randomUUID()}`, { method: 'PUT', token: alice.token, body: { clientEventId: crypto.randomUUID(), deviceId: 'phone', revision: 1, positionMs: 1000, durationMs: null, completed: false, occurredAt: new Date().toISOString() } });
    expect(progress.status).toBe(422); // unknown lesson → rejected by the sync RPC, never a silent write
  });

  it('A28 — export bundles only the learner’s data and deletion follows the disclosed policy', async () => {
    const exported = await call(h.app, '/v1/me/export', { token: alice.token });
    expect(exported.status).toBe(200);
    expect(exported.json.data.profile.userId).toBe(alice.id);
    expect(exported.json.data.enrollments.map((e: { id: string }) => e.id)).toEqual([darijaId]);
    expect(exported.json.data.progress.totalXp).toBe(100);
    const victim = await createStackUser(h, 'victim');
    const refused = await call(h.app, '/v1/me', { method: 'DELETE', token: victim.token, body: { confirmation: 'delete' } });
    expect(refused.status).toBe(422);
    const deleted = await call(h.app, '/v1/me', { method: 'DELETE', token: victim.token, body: { confirmation: 'DELETE' } });
    expect(deleted.status).toBe(200);
    expect(deleted.json.data.status).toBe('deleted');
    const gone = await h.service.from('profiles').select('user_id').eq('user_id', victim.id).maybeSingle();
    expect(gone.data).toBeNull();
    // Alice has append-only evidence rows: the cascade is refused by the ledgers, so the account is deactivated
    // immediately (banned + anonymised) and the hard delete is deferred to the retention job.
    const deferred = await call(h.app, '/v1/me', { method: 'DELETE', token: alice.token, body: { confirmation: 'DELETE' } });
    expect(deferred.status).toBe(200);
    expect(deferred.json.data.status).toBe('scheduled');
    const profile = await h.service.from('profiles').select('deleted_at, display_name').eq('user_id', alice.id).single();
    expect(profile.data?.deleted_at).toBeTruthy();
    const banned = await h.service.auth.admin.getUserById(alice.id);
    expect(banned.data.user?.email).toMatch(/@deleted\.invalid$/);
  });
});
