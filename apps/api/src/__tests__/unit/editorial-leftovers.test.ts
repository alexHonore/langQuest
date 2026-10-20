/**
 * Round-4 editorial leftovers through the REAL app and offline fakes (route-fixtures):
 *
 * 1. The publish override (`overrideReviewFlags` / `overrideReason`) is validated by the contract's
 *    `ContentPublishRequestSchema` itself, and the diversity flag the gate reads is the contract's constant.
 * 2. Two editors deciding the same asset suggestion at the same moment: the decision is a conditional UPDATE
 *    (pending status in the filter), so exactly one lands and the other is a 409 carrying the stored status. An
 *    editor's payload override is conditional the same way, so it never rewrites a suggestion decided since.
 * 3. Speakers are deliberately not restorable (a consent record): revisions carry `snapshot: null`, rollback is
 *    refused, and the PATCH `expectedRevision` guard is atomic (two editors at the same revision: one 412).
 * 4. The Studio Model Test synthesize and transcribe probes are ledgered as staff spend, like the prompt probe, so the
 *    cost panel counts them in `staffAndJobsUsd`, never in `unattributedUsd`.
 */
import { DIVERSITY_REVIEW_FLAG as CONTRACT_DIVERSITY_REVIEW_FLAG, PUBLISH_BLOCKING_REVIEW_FLAGS as CONTRACT_BLOCKING_FLAGS } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { DIVERSITY_REVIEW_FLAG, PUBLISH_BLOCKING_REVIEW_FLAGS } from '../../routes/admin/content';
import { aiRowAttribution } from '../../routes/admin/analytics';
import { invalidateProfileCache } from '../../services/ai';
import { audioLessonRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const EDITOR = '33333333-3333-4333-8333-333333333333';
const EDITOR2 = '44444444-4444-4444-8444-444444444444';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [EDITOR]: ['content_editor' as const], [EDITOR2]: ['content_editor' as const], [ADMIN]: ['admin' as const] };
const WAV = Buffer.from('RIFF0000WAVEfmt fake-audio-bytes').toString('base64');

/** Serve `interleave` once, right before the first database request matching `when` (a deterministic race window). */
function interleaveBefore(h: RouteHarness, when: (method: string, target: string) => boolean, interleave: () => Promise<void> | void): void {
  const serve = h.db.handle.bind(h.db);
  let fired = false;
  h.db.handle = async (request: Request) => {
    const target = new URL(request.url).pathname.replace(/^\/rest\/v1\//, '');
    if (!fired && when(request.method.toUpperCase(), target)) {
      fired = true;
      await interleave();
    }
    return serve(request);
  };
}

const revisionsOf = (h: RouteHarness, table: string, id: unknown): DbRow[] =>
  h.db
    .rows('content_revisions')
    .filter((r) => r.entity_table === table && r.entity_id === id)
    .sort((a, b) => Number(a.revision) - Number(b.revision));
const auditsOf = (h: RouteHarness, action: string, id?: unknown): DbRow[] => h.db.rows('audit_logs').filter((a) => a.action === action && (id === undefined || a.entity_id === id));

let h: RouteHarness;

describe('the diversity flag has one definition', () => {
  it('the API re-exports the contract constants', () => {
    expect(DIVERSITY_REVIEW_FLAG).toBe(CONTRACT_DIVERSITY_REVIEW_FLAG);
    expect(DIVERSITY_REVIEW_FLAG).toBe('diversity_needs_regeneration');
    expect(PUBLISH_BLOCKING_REVIEW_FLAGS).toBe(CONTRACT_BLOCKING_FLAGS);
  });
});

describe('publish override fields come from the contract', () => {
  afterEach(() => h.restore());

  it('an override the contract refuses is a 422 before any read (unknown flag, padded short reason, reason alone)', async () => {
    h = routeHarness({ roles: ROLES });
    const editor = await h.token(EDITOR);
    const id = crypto.randomUUID();
    for (const extra of [
      { overrideReviewFlags: ['made_up_flag'], overrideReason: 'A reason long enough to pass' },
      { overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: '   too short    ' },
      { overrideReason: 'A reason long enough to pass' },
      { overrideReviewFlags: [DIVERSITY_REVIEW_FLAG] },
    ]) {
      const res = await h.call(`/v1/admin/content/${id}/publish`, { token: editor, body: { entityTable: 'missions', expectedRevision: 0, ...extra } });
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.json.error.code).toBe('validation_failed');
    }
    expect(h.db.requests.filter((r) => r.target === 'missions' || r.target === 'content_revisions')).toEqual([]);
  });
});

describe('asset suggestion decisions race', () => {
  afterEach(() => h.restore());
  const suggestionRow = (lessonId: string, over: DbRow = {}): DbRow => ({
    id: crypto.randomUUID(),
    media_asset_id: crypto.randomUUID(),
    lesson_id: lessonId,
    job_id: null,
    kind: 'level',
    suggestion: { value: 'beginner' },
    confidence: 0.8,
    provenance: { task: 'infer_metadata', model: 'fake/model' },
    review_status: 'review_needed',
    reviewer_id: null,
    decided_at: null,
    decision_note: null,
    ...over,
  });

  it('two editors who both saw it pending: one decision lands, the other is a 409 with the stored status and nothing applied', async () => {
    h = routeHarness({ roles: ROLES, media: true });
    const [first, second] = [await h.token(EDITOR), await h.token(EDITOR2)];
    const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'review_needed', level: null })]) as [DbRow];
    const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string)]) as [DbRow];
    const path = `/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`;
    // The second editor's whole decision runs after the first editor's route has read the row as pending, right before
    // the first editor's UPDATE reaches the database.
    let rejected: Awaited<ReturnType<RouteHarness['call']>> | null = null;
    interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'asset_suggestions', async () => {
      rejected = await h.call(path, { token: second, body: { decision: 'reject', note: 'wrong level', idempotencyKey: 'decide-race-second' } });
    });
    const approved = await h.call(path, { token: first, body: { decision: 'approve', note: 'looks right', idempotencyKey: 'decide-race-first' } });

    expect(rejected!.status, JSON.stringify(rejected!.json)).toBe(200);
    expect(rejected!.json.data).toMatchObject({ suggestion: { reviewStatus: 'rejected', reviewerId: EDITOR2, decisionNote: 'wrong level' }, applied: false, replayed: false });
    expect(approved.status, JSON.stringify(approved.json)).toBe(409);
    expect(approved.json.error.code).toBe('conflict');
    expect(approved.json.error.message).toBe('Suggestion was already rejected');
    expect(approved.json.error.details).toMatchObject({ reviewStatus: 'rejected' });

    // The stored decision is the winner's; the loser's approval never reached the lesson.
    expect(suggestion).toMatchObject({ review_status: 'rejected', reviewer_id: EDITOR2, decision_note: 'wrong level' });
    expect(lesson.level).toBeNull();
    expect(revisionsOf(h, 'audio_lessons', lesson.id)).toEqual([]);
    // Both UPDATEs were conditional on the pending status; only the winner's matched.
    const updates = h.db.writes('asset_suggestions').filter((w) => w.method === 'PATCH');
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(decodeURIComponent(u.query)).toContain('review_status=in.(draft,review_needed,in_review)');
    await h.flush();
    expect(auditsOf(h, 'asset_suggestion.decide', suggestion.id)).toEqual([expect.objectContaining({ actor_id: EDITOR2 })]);
  });

  it('a decision on a suggestion decided since the editor loaded it, with no race in the route, is still refused (409)', async () => {
    h = routeHarness({ roles: ROLES, media: true });
    const editor = await h.token(EDITOR);
    const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'review_needed', level: null })]) as [DbRow];
    const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string)]) as [DbRow];
    // A bulk decision (or a job) moves the row out of the queue between the route's read and its write.
    interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'asset_suggestions', () => {
      Object.assign(suggestion, { review_status: 'approved', reviewer_id: EDITOR2, decided_at: '2026-10-20T08:00:00.000Z' });
    });
    const res = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body: { decision: 'reject', idempotencyKey: 'decide-late-0001' } });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json.error.details).toEqual({ reviewStatus: 'approved', decidedAt: '2026-10-20T08:00:00.000Z' });
    expect(suggestion).toMatchObject({ review_status: 'approved', reviewer_id: EDITOR2 });
  });

  it('an override approval that loses to another editor’s approval is a 409 and never rewrites the payload that was approved and applied', async () => {
    h = routeHarness({ roles: ROLES, media: true });
    const [first, second] = [await h.token(EDITOR), await h.token(EDITOR2)];
    const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'review_needed', level: null })]) as [DbRow];
    const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string)]) as [DbRow];
    const path = `/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`;
    // The second editor approves the original payload after the first editor's route read the row as pending, right
    // before the first editor's payload override reaches the database.
    let winner: Awaited<ReturnType<RouteHarness['call']>> | null = null;
    interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'asset_suggestions', async () => {
      winner = await h.call(path, { token: second, body: { decision: 'approve', idempotencyKey: 'decide-override-second' } });
    });
    const loser = await h.call(path, { token: first, body: { decision: 'approve', overrideSuggestion: { value: 'advanced' }, idempotencyKey: 'decide-override-first' } });

    expect(winner!.status, JSON.stringify(winner!.json)).toBe(200);
    expect(winner!.json.data).toMatchObject({ suggestion: { reviewStatus: 'approved', reviewerId: EDITOR2, suggestion: { value: 'beginner' } }, applied: true, replayed: false });
    expect(loser.status, JSON.stringify(loser.json)).toBe(409);
    expect(loser.json.error).toMatchObject({ code: 'conflict', message: 'Suggestion was already approved', details: { reviewStatus: 'approved' } });

    // The payload of record is the one that was approved and applied; the loser's override was never written.
    expect(suggestion).toMatchObject({ review_status: 'approved', reviewer_id: EDITOR2, suggestion: { value: 'beginner' } });
    expect(lesson.level).toBe('beginner');
    expect(revisionsOf(h, 'audio_lessons', lesson.id)).toHaveLength(1);
    const updates = h.db.writes('asset_suggestions').filter((w) => w.method === 'PATCH');
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(decodeURIComponent(u.query)).toContain('review_status=in.(draft,review_needed,in_review)');
    expect(updates.some((u) => JSON.stringify(u.body).includes('advanced'))).toBe(true);
    await h.flush();
    expect(auditsOf(h, 'asset_suggestion.decide', suggestion.id)).toEqual([expect.objectContaining({ actor_id: EDITOR2 })]);
  });
});

describe('speakers: not restorable, by design, and an atomic revision guard', () => {
  afterEach(() => h.restore());
  const create = (token: string, key: string, over: DbRow = {}) => h.call('/v1/admin/speakers', { token, body: { displayName: 'Amina (pseudonym)', consentState: 'granted', targetVarietyId: 'ary', idempotencyKey: key, ...over } });
  const patch = (token: string, id: unknown, body: DbRow) => h.call(`/v1/admin/speakers/${String(id)}`, { method: 'PATCH', token, body });

  it('create and patch revisions carry snapshot null (an audit trail), and a rollback of a speaker is refused with nothing written', async () => {
    h = routeHarness({ roles: ROLES });
    const editor = await h.token(EDITOR);
    const created = await create(editor, 'speaker-create-0001');
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const id = created.json.data.id as string;
    expect(created.json.data.revision).toBe(1);
    const patched = await patch(editor, id, { expectedRevision: 1, consentState: 'revoked', region: 'Casablanca' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect(patched.json.data).toMatchObject({ revision: 2, consentState: 'revoked', region: 'Casablanca' });
    const revisions = revisionsOf(h, 'speakers', id);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(revisions.every((r) => r.snapshot === null)).toBe(true);
    expect(revisions[1]).toMatchObject({ diff: { consentState: 'revoked', region: 'Casablanca' }, editor_id: EDITOR });

    // Rolling a speaker back would restore a withdrawn consent: the rollback contract does not accept the table.
    const before = h.db.requests.length;
    const refused = await h.call(`/v1/admin/content/${id}/rollback`, { token: editor, body: { entityTable: 'speakers', revision: 1 } });
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('validation_failed');
    expect(h.db.requests.slice(before).filter((r) => r.method !== 'GET')).toEqual([]);
    expect(h.db.rows('speakers').find((r) => r.id === id)).toMatchObject({ consent_state: 'revoked' });
  });

  it('two editors patching at the same revision: exactly one saves, the other gets 412 with the winner’s revision', async () => {
    h = routeHarness({ roles: ROLES });
    const [first, second] = [await h.token(EDITOR), await h.token(EDITOR2)];
    const created = await create(first, 'speaker-create-0002', { consentState: 'pending' });
    const id = created.json.data.id as string;
    let winner: Awaited<ReturnType<RouteHarness['call']>> | null = null;
    // The second editor saves right before the first editor's revision claim reaches the database.
    interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', async () => {
      winner = await patch(second, id, { expectedRevision: 1, region: 'Fès' });
    });
    const loser = await patch(first, id, { expectedRevision: 1, region: 'Rabat' });
    expect(winner!.status, JSON.stringify(winner!.json)).toBe(200);
    expect(winner!.json.data).toMatchObject({ revision: 2, region: 'Fès' });
    expect(loser.status, JSON.stringify(loser.json)).toBe(412);
    expect(loser.json.error).toMatchObject({ code: 'precondition_failed', details: { currentRevision: 2 } });
    expect(h.db.rows('speakers').find((r) => r.id === id)).toMatchObject({ region: 'Fès' });
    expect(revisionsOf(h, 'speakers', id).map((r) => [r.revision, r.editor_id, r.snapshot])).toEqual([
      [1, EDITOR, null],
      [2, EDITOR2, null],
    ]);
    // A stale editor is refused before anything is written.
    const writesBefore = h.db.writes('speakers').length;
    const stale = await patch(first, id, { expectedRevision: 1, region: 'Rabat' });
    expect(stale.status).toBe(412);
    expect(h.db.writes('speakers')).toHaveLength(writesBefore);
  });
});

describe('Model Test speech probes are staff spend', () => {
  afterEach(() => h.restore());
  const setup = async () => {
    h = routeHarness({ roles: ROLES, openRouter: true });
    invalidateProfileCache();
    return h.token(ADMIN);
  };
  const attributionOf = (row: DbRow) => {
    const log = (row.redacted_log ?? {}) as DbRow;
    return aiRowAttribution({ enrollment_id: (row.enrollment_id as string | null) ?? null, actor: (log.actor as string | undefined) ?? null, job_id: (log.jobId as string | undefined) ?? null });
  };

  it('a synthesize probe writes a staff-tagged row: no enrollment, the admin as actor, the probe trace id', async () => {
    const admin = await setup();
    const res = await h.call('/v1/admin/models/test', { token: admin, body: { mode: 'synthesize', targetVariety: 'fr', text: 'Bonjour, comment ça va ?' } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'synthesize', targetVariety: 'fr', synthetic: true });
    expect(h.openrouter.callsTo('/audio/speech')).toHaveLength(1);
    await h.flush();
    const rows = h.db.rows('ai_requests');
    expect(rows).toEqual([expect.objectContaining({ task: 'speech_synthesis', enrollment_id: null, user_id: ADMIN, trace_id: res.json.data.traceId, success: true })]);
    expect(rows[0]!.redacted_log).toMatchObject({ purpose: 'admin_model_test', actor: 'staff' });
    expect(attributionOf(rows[0]!)).toBe('staff_or_job');
    expect(h.blocked).toEqual([]);
  });

  it('a transcribe probe writes a staff-tagged row too, never an unattributed one', async () => {
    const admin = await setup();
    const res = await h.call('/v1/admin/models/test', { token: admin, body: { mode: 'transcribe', targetVariety: 'fr', audioBase64: WAV, encoding: 'wav' } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'transcribe', targetVariety: 'fr', text: 'Bonjour' });
    expect(h.openrouter.callsTo('/audio/transcriptions')).toHaveLength(1);
    await h.flush();
    const rows = h.db.rows('ai_requests');
    expect(rows).toEqual([expect.objectContaining({ task: 'speech_recognition', enrollment_id: null, user_id: ADMIN, trace_id: res.json.data.traceId, success: true })]);
    expect(rows[0]!.redacted_log).toMatchObject({ purpose: 'admin_model_test', actor: 'staff' });
    expect(attributionOf(rows[0]!)).toBe('staff_or_job');
    expect(h.blocked).toEqual([]);
  });
});
