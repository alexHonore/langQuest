/**
 * Mission integrity (HANDOFF §9 item 1): `POST /v1/missions/:id/evaluate` no longer trusts the outcomes the client
 * reports. Through the REAL app, the real speech route (`POST /v1/speech/pronunciation-assess`, fake OpenRouter) and the
 * offline fakes of `route-fixtures` (nothing leaves the process):
 *
 * - a forged "understood" with no server-graded take earns no XP and no skill credit, but the mission still completes;
 * - a real server-graded take credits its step once; replays (same or new client event) never award again;
 * - a take without speech writes no grading row, so it can back nothing;
 * - another learner's grading row (by id) is refused with 403, and other learners' rows never count;
 * - one grading row backs one step and one attempt, ever: learner-writable attempt fields (`created_at`, `mission_id`,
 *   `enrollment_id`), an attempt left open for hours, and evaluations racing never free a used row again. The
 *   settlement is the database's (`complete_mission_attempt`, migration 161; faked here with the same semantics):
 *   evidence claims keyed by evidence id, first decision wins, completions counted once per credited attempt. The
 *   "credit races" block replays the round-3 interleavings (one attempt evaluated twice plus another attempt, the replay
 *   paying first; parallel completions with a slow write) and checks that no take pays two attempts and every credited
 *   completion is counted. A settled decision replays only for the mission and enrollment it was made for (a completed
 *   attempt moved afterwards completes nothing elsewhere), and evaluate refuses a mission of another variety whatever
 *   the attempt row says;
 * - the credited outcome never exceeds what the server recorded; choice steps are never credited (their answer key
 *   ships to the client); conversation steps need the evaluator's OWN rows for the session, and a session row the
 *   learner wrote or rewrote through PostgREST (RLS full CRUD) is a claim capped by those rows;
 * - progress sync cannot route around it: client observations are recorded as client reports (no mastery, never a
 *   grading or evaluator row), `xp_claim` is refused for attempts the server did not credit, and skill advances are
 *   paid by the server only.
 */
import { EVALUATOR_SCORER_VERSION, Evaluator } from '@langquest/ai/conversation/evaluator';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import { bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import type { EvaluatorOutput, ObservationOutcome, StepResult } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { observationToRow } from '../../lib/learning';
import { MissionEvaluateApiResponseSchema } from '../../routes/learner/missions';
import {
  MAX_SETTLE_ROUNDS,
  MISSION_CREDIT_VERSION,
  SESSION_EVIDENCE,
  cappedOutcome,
  clientReportedObservation,
  corroboratedSessionOutput,
  decideMissionCredit,
  decisionMadeFor,
  evidenceIdsOf,
  evidenceWindow,
  hasPositiveEvidence,
  parseSessionOutput,
  stepSpecsOf,
  storedMissionCredit,
  storedMissionEvaluation,
  withoutEvidence,
  type SpeechEvidence,
} from '../../lib/xp-credit';
import { enrollmentRow, profileRow, routeHarness, type DbRow, type FakePostgrest, type RouteHarness, type RpcHandler, type ScriptedResponse } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = () => new Date().toISOString();
const ago = (ms: number, from = Date.now()) => new Date(from - ms).toISOString();
const HOUR = 60 * 60_000;

const tone = (ms: number, amplitude = 0.3, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767), true);
  return out;
};
const TONE_WAV = bytesToBase64(pcm16ToWav(tone(900), 16_000));
const whisper = (text: string, language = 'fr', o: { nsp?: number; lp?: number } = {}): ScriptedResponse => ({
  status: 200,
  body: { text, language, duration: 1.2, segments: [{ id: 0, start: 0, end: 1.2, text, avg_logprob: o.lp ?? -0.2, no_speech_prob: o.nsp ?? 0.03 }], words: [], usage: { seconds: 1.2, cost: 0.0001 } },
});

// --- fake RPCs (the SQL functions the award path relies on) ------------------------------------------------------

const ENGINE_TYPES = new Set(['review_result', 'step_completed', 'mission_abandoned', 'observation', 'xp_claim']);

/** `public.xp_reference_owned`. */
function referenceOwned(db: FakePostgrest, userId: string, table: string | null, id: string | null): boolean {
  if (!table || !id) return false;
  const row = db.rows(table).find((r) => r.id === id);
  if (!row || row.user_id !== userId) return false;
  if (table === 'mission_attempts') return row.completed_at !== null && row.completed_at !== undefined;
  return ['user_skill_mastery', 'user_achievements', 'learning_observations', 'conversation_sessions'].includes(table);
}

function installRpcs(db: FakePostgrest): void {
  /** `public.award_xp`: idempotent on the key, one payment per (user, reason, reference), owned references only. */
  db.rpcs.award_xp = (args, ctx) => {
    const user = String(args.p_user_id);
    const amount = Number(args.p_amount);
    const reason = String(args.p_reason);
    const refTable = (args.p_reference_table as string | undefined) ?? null;
    const refId = (args.p_reference_id as string | undefined) ?? null;
    if (!(amount > 0 && amount <= 1000)) throw { status: 400, code: '22023', message: 'invalid XP amount' };
    if (refId && !referenceOwned(ctx.db, user, refTable, refId)) throw { status: 409, code: '23503', message: 'xp reference is not an owned, completed row' };
    const ledger = ctx.db.rows('xp_ledger');
    let row = ledger.find((l) => l.idempotency_key === args.p_idempotency_key);
    let applied = false;
    if (!row) {
      row = refId ? ledger.find((l) => l.user_id === user && l.reason === reason && l.reference_id === refId) : undefined;
      if (!row) {
        row = { id: crypto.randomUUID(), user_id: user, enrollment_id: args.p_enrollment_id ?? null, amount, reason, reference_table: refTable, reference_id: refId, idempotency_key: args.p_idempotency_key, occurred_at: args.p_occurred_at ?? NOW(), created_at: NOW() };
        ledger.push(row);
        applied = true;
      }
    }
    const total = ledger.filter((l) => l.user_id === user).reduce((n, l) => n + Number(l.amount), 0);
    return [{ applied, ledger_id: row.id, amount: row.amount, total_xp: total }];
  };
  db.rpcs.xp_reference_owned = (args, ctx) => referenceOwned(ctx.db, String(args.p_user_id), String(args.p_reference_table), String(args.p_reference_id));
  db.rpcs.get_due_reviews = () => [];
  /** `public.apply_sync_events`: once per (user, client event); engine payloads are left to the Worker. */
  db.rpcs.apply_sync_events = (args, ctx) =>
    (args.p_events as Array<{ clientEventId: string; payload: { type: string } }>).map((ev) => {
      const seen = ctx.db.rows('device_sync_events').find((r) => r.user_id === ctx.sub && r.client_event_id === ev.clientEventId);
      if (seen) return { client_event_id: ev.clientEventId, resolution: 'duplicate', reason: null, xp_credited: 0, handled_in_db: true };
      ctx.db.rows('device_sync_events').push({ id: crypto.randomUUID(), user_id: ctx.sub, client_event_id: ev.clientEventId, payload_type: ev.payload.type, payload: ev.payload, resolution: 'applied' });
      return { client_event_id: ev.clientEventId, resolution: 'applied', reason: null, xp_credited: null, handled_in_db: !ENGINE_TYPES.has(ev.payload.type) };
    });
  db.rpcs.mark_sync_events_applied = (args) => (args.p_client_event_ids as string[]).length;
  db.rpcs.complete_mission_attempt = completeMissionAttempt;
}

/** Canonical JSON (sorted keys): jsonb equality for the compare-and-set on the stored evaluation. */
const canonical = (value: unknown): string => JSON.stringify(value ?? null, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as DbRow).sort(([a], [b]) => a.localeCompare(b))) : v));
const pgError = (code: string, message: string) => ({ status: code === '22023' ? 400 : 409, code, message });

/**
 * `public.complete_mission_attempt` (migration 161, `supabase/tests/database/mission_progress_atomic.test.sql`). The
 * handler runs without an await, so like the SQL function's transaction it is atomic: refuse a second decision (first
 * write wins), claim the decision's evidence all or nothing (`mission_evidence_claims`, keyed by evidence id), store
 * the decision, and record the completion with `completions + 1` when it credits the mission.
 */
const completeMissionAttempt: RpcHandler = (args, ctx) => {
  const userId = String(args.p_user_id);
  const evaluation = args.p_evaluation as { credit?: { missionCredited?: unknown; withoutHints?: unknown; steps?: unknown } } | null;
  const credit = evaluation?.credit;
  if (!credit || typeof credit.missionCredited !== 'boolean' || !Array.isArray(credit.steps)) throw pgError('22023', 'p_evaluation must carry a credit decision');
  const attempt = ctx.db.rows('mission_attempts').find((a) => a.id === args.p_attempt_id && a.user_id === userId);
  if (!attempt) throw pgError('23503', 'not an attempt of this user');
  const enrollmentOwned = ctx.db.rows('user_course_enrollments').some((e) => e.id === args.p_enrollment_id && e.user_id === userId);
  if (attempt.enrollment_id !== args.p_enrollment_id || attempt.mission_id !== args.p_mission_id || !enrollmentOwned) throw pgError('23503', 'not an attempt of this enrollment and mission');
  const seen = (args.p_seen_evaluation as unknown) ?? null;
  if (canonical(attempt.evaluation) !== canonical(seen)) return [{ outcome: 'already_decided', contested_ids: [], attempt: { ...attempt } }];

  const steps = credit.steps as Array<{ evidence?: string; evidenceIds?: unknown }>;
  const idsOf = (kind: string): string[] => [...new Set(steps.filter((st) => st.evidence === kind).flatMap((st) => (Array.isArray(st.evidenceIds) ? st.evidenceIds.map(String) : [])))];
  const grading = idsOf('speech_evaluation');
  const sessions = idsOf('conversation_evaluator');
  if (grading.some((id) => sessions.includes(id))) throw pgError('22023', 'an evidence id cannot be both kinds');
  const ownsRow = (table: string, id: string) => ctx.db.rows(table).some((r) => r.id === id && r.user_id === userId);
  if (grading.some((id) => !ownsRow('learning_observations', id)) || sessions.some((id) => !ownsRow('conversation_sessions', id))) throw pgError('23503', 'evidence of another user');
  const claims = ctx.db.rows('mission_evidence_claims');
  const wanted = [...grading.map((id) => ({ id, kind: 'grading_row' })), ...sessions.map((id) => ({ id, kind: 'conversation_session' }))].sort((a, b) => a.id.localeCompare(b.id));
  const contested = wanted.filter((w) => claims.some((c) => c.evidence_id === w.id && c.attempt_id !== attempt.id)).map((w) => w.id);
  if (contested.length) return [{ outcome: 'contested', contested_ids: contested, attempt: { ...attempt } }];
  for (const w of wanted) if (!claims.some((c) => c.evidence_id === w.id)) claims.push({ evidence_id: w.id, evidence_kind: w.kind, attempt_id: attempt.id, user_id: userId, claimed_at: NOW() });

  const completedAt = (attempt.completed_at as string | null | undefined) ?? (args.p_completed_at as string | undefined) ?? NOW();
  Object.assign(attempt, { completed_at: completedAt, step_results: args.p_step_results ?? attempt.step_results, objectives_completed: args.p_objectives_completed ?? [], evaluation, current_step_index: args.p_current_step_index ?? attempt.current_step_index, updated_at: NOW() });
  const credited = credit.missionCredited === true;
  const withoutHints = credit.withoutHints === true;
  const counts = credited && seen === null;
  const progress = ctx.db.rows('mission_progress');
  const row = progress.find((p) => p.enrollment_id === args.p_enrollment_id && p.mission_id === args.p_mission_id);
  if (!row) {
    progress.push({ id: crypto.randomUUID(), user_id: userId, enrollment_id: args.p_enrollment_id, mission_id: args.p_mission_id, status: 'completed', best_attempt_id: credited ? attempt.id : null, completions: counts ? 1 : 0, completed_without_hints: credited && withoutHints, first_completed_at: credited ? completedAt : null, last_completed_at: completedAt, revision: 0, created_at: NOW(), updated_at: NOW() });
  } else {
    Object.assign(row, {
      status: 'completed',
      best_attempt_id: credited ? attempt.id : row.best_attempt_id,
      completions: Number(row.completions) + (counts ? 1 : 0),
      completed_without_hints: Boolean(row.completed_without_hints) || (credited && withoutHints),
      first_completed_at: row.first_completed_at ?? (credited ? completedAt : null),
      last_completed_at: completedAt,
      updated_at: NOW(),
    });
  }
  return [{ outcome: 'written', contested_ids: [], attempt: { ...attempt } }];
};

// --- fixture ----------------------------------------------------------------------------------------------------

const expressionRow = (text: string): DbRow => ({ id: crypto.randomUUID(), target_variety_id: 'fr', canonical_text: text, state: 'published', intent_id: 'greet', origin: 'authored', register: 'neutral', difficulty: 1, reviewed: true, reviewer_id: null, scenario_tags: [], phonetic_annotations: {}, script_annotations: {}, content_rights_id: null });
const missionRow = (over: DbRow = {}): DbRow => ({ id: crypto.randomUUID(), template_key: `greet_${crypto.randomUUID().slice(0, 8)}`, target_variety_id: 'fr', state: 'published', published_revision: 1, title_translations: { en: 'Greet' }, goals: [{ id: 'g1', skill_keys: ['greet.basic'] }], chapter_id: null, mission_type: 'conversation', level: 'beginner', recommended_minutes: 5, prerequisite_skill_keys: [], sort_order: 0, narrative_segment: null, ...over });
const stepRow = (missionId: string, order: number, type: string, expressionIds: string[]): DbRow => ({ id: crypto.randomUUID(), mission_id: missionId, sort_order: order, step_type: type, lesson_type: null, target_expression_ids: expressionIds, prompt_asset_ids: [], valid_intent_ids: [], success_conditions: {}, branching: null, estimated_seconds: 30, offline_capable: true, hint_scaffold: [] });

interface Fixture {
  h: RouteHarness;
  token: string;
  otherToken: string;
  enrollment: DbRow;
  otherEnrollment: DbRow;
  secondEnrollment: DbRow;
  bonjour: DbRow;
  oui: DbRow;
  mission: DbRow;
  /** context_listening, modeled_expression, anticipation, listen_identify, shadowing. */
  steps: { listen: DbRow; modeled: DbRow; anticipation: DbRow; choice: DbRow; shadowing: DbRow };
  /** A mission whose only step is a character conversation. */
  chat: DbRow;
  chatStep: DbRow;
  /** The step mix of the 21 published missions: 4 graded speaking steps, a choice and a conversation. */
  seeded: DbRow;
  seededSteps: DbRow[];
}

async function setup(): Promise<Fixture> {
  const h = routeHarness({ openRouter: true });
  installRpcs(h.db);
  h.db.seed('profiles', [profileRow(LEARNER, { ui_locale: 'en', default_source_language_code: 'en' }), profileRow(OTHER, { ui_locale: 'en', default_source_language_code: 'en' })]);
  const [enrollment, otherEnrollment, secondEnrollment] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' }), enrollmentRow(OTHER, 'french', { source_language_code: 'en' }), enrollmentRow(LEARNER, 'french', { source_language_code: 'es' })]);
  const [bonjour, oui] = h.db.seed('expressions', [expressionRow('Bonjour'), expressionRow('Oui')]);
  const [mission, chat, seeded] = h.db.seed('missions', [missionRow(), missionRow({ mission_type: 'conversation' }), missionRow()]);
  const b = bonjour!.id as string;
  const o = oui!.id as string;
  const [listen, modeled, anticipation, choice, shadowing, chatStep] = h.db.seed('mission_steps', [
    stepRow(mission!.id as string, 0, 'context_listening', [b]),
    stepRow(mission!.id as string, 1, 'modeled_expression', [b]),
    stepRow(mission!.id as string, 2, 'anticipation', [b]),
    stepRow(mission!.id as string, 3, 'listen_identify', [b, o]),
    stepRow(mission!.id as string, 4, 'shadowing', [o]),
    stepRow(chat!.id as string, 0, 'character_conversation', []),
  ]);
  const seededSteps = h.db.seed(
    'mission_steps',
    (
      [
        ['context_listening', [b]],
        ['modeled_expression', [b]],
        ['anticipation', [b]],
        ['listen_identify', [b, o]],
        ['feedback_retry', [o]],
        ['review_recall', [b]],
        ['character_conversation', [b]],
      ] as const
    ).map(([type, ids], i) => stepRow(seeded!.id as string, i, type, [...ids])),
  );
  return {
    h,
    token: await h.token(LEARNER),
    otherToken: await h.token(OTHER),
    enrollment: enrollment!,
    otherEnrollment: otherEnrollment!,
    secondEnrollment: secondEnrollment!,
    bonjour: bonjour!,
    oui: oui!,
    mission: mission!,
    steps: { listen: listen!, modeled: modeled!, anticipation: anticipation!, choice: choice!, shadowing: shadowing! },
    chat: chat!,
    chatStep: chatStep!,
    seeded: seeded!,
    seededSteps,
  };
}

async function startAttempt(f: Fixture, missionId = f.mission.id as string, token = f.token, enrollmentId = f.enrollment.id as string): Promise<string> {
  const res = await f.h.call(`/v1/missions/${missionId}/attempts`, { token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 1, startedAt: NOW() } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.data.attemptId as string;
}

/** One take graded by the real speech route (what the lesson player sends); returns the assessment id it answered. */
async function gradeTake(f: Fixture, expression: DbRow, heard: ScriptedResponse, opts: { token?: string; enrollment?: DbRow; missionId?: string; flush?: boolean } = {}): Promise<{ assessmentId: string; intelligibility: string }> {
  f.h.openrouter.transcription = () => heard;
  const enrollment = opts.enrollment ?? f.enrollment;
  const res = await f.h.call('/v1/speech/pronunciation-assess', { token: opts.token ?? f.token, body: { enrollmentId: enrollment.id, targetVarietyId: 'fr', expressionId: expression.id, audio: { source: 'inline', base64: TONE_WAV, encoding: 'wav', sampleRateHz: 16_000 }, requestedFeatures: ['word'], clientRequestId: crypto.randomUUID(), scenarioId: opts.missionId ?? f.mission.id } });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  if (opts.flush !== false) await f.h.flush();
  return { assessmentId: res.json.data.assessmentId as string, intelligibility: res.json.data.intelligibility as string };
}

/** Three understood takes: two "Bonjour", one "Oui" (one per graded step of the main mission). */
async function gradeThree(f: Fixture, missionId = f.mission.id as string): Promise<void> {
  await gradeTake(f, f.bonjour, whisper('Bonjour'), { missionId });
  await gradeTake(f, f.bonjour, whisper('Bonjour'), { missionId });
  await gradeTake(f, f.oui, whisper('Oui'), { missionId });
}

const result = (step: DbRow, over: Partial<StepResult> = {}): StepResult => ({ stepId: step.id as string, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 20_000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null, ...over });

/** The step results the lesson player sends for the whole mission, everything claimed as understood. */
const allSuccess = (f: Fixture, ids: Partial<Record<'modeled' | 'anticipation' | 'shadowing', string[]>> = {}): StepResult[] => [
  result(f.steps.listen),
  result(f.steps.modeled, { speechAssessmentIds: ids.modeled ?? [crypto.randomUUID()] }),
  result(f.steps.anticipation, { attemptedBeforeReveal: true, speechAssessmentIds: ids.anticipation ?? [crypto.randomUUID()] }),
  // The answer key a scripted client reads from the mission detail (the first expression).
  result(f.steps.choice, { attemptedBeforeReveal: true, selectedIntentId: f.bonjour.id as string }),
  result(f.steps.shadowing, { speechAssessmentIds: ids.shadowing ?? [crypto.randomUUID()] }),
];

/** The same for the seeded-shape mission, the conversation step pointing at `sessionId`. */
const allSuccessSeeded = (f: Fixture, sessionId: string | null = null): StepResult[] =>
  f.seededSteps.map((st) => result(st, { attemptedBeforeReveal: true, selectedIntentId: st.step_type === 'listen_identify' ? (f.bonjour.id as string) : null, conversationSessionId: st.step_type === 'character_conversation' ? sessionId : null }));

async function evaluate(f: Fixture, attemptId: string, stepResults: StepResult[], opts: { clientEventId?: string; missionId?: string; token?: string; enrollmentId?: string; completedAt?: string } = {}) {
  return f.h.call(`/v1/missions/${opts.missionId ?? (f.mission.id as string)}/evaluate`, { token: opts.token ?? f.token, body: { attemptId, enrollmentId: opts.enrollmentId ?? f.enrollment.id, completedAt: opts.completedAt ?? NOW(), stepResults, clientEventId: opts.clientEventId ?? crypto.randomUUID() } });
}

interface Settlement {
  attemptId: string;
  completedAt: string;
  outcome: string;
  contested: string[];
  /** Evidence ids the settled decision named. */
  evidenceIds: string[];
  /** One of the `n` held calls (a first decision), not a later re-decision. */
  gated: boolean;
}

/**
 * Hold the first `n` calls to `complete_mission_attempt` until all `n` are pending (so each was decided from the same
 * evidence, before any of them was settled), then let them through one at a time, each after the previous one
 * answered, in `order` (attempt ids; a repeated id takes that attempt's next call in arrival order; default: arrival
 * order). Later calls (re-decisions after `contested`) pass straight through. Every settlement is recorded.
 */
function holdSettlements(db: FakePostgrest, n: number, order?: string[]): { settlements: Settlement[]; restore: () => void } {
  const original = db.handle.bind(db);
  const settlements: Settlement[] = [];
  const pending: Array<{ attemptId: string; go: () => void; done: Promise<void> }> = [];
  let held = 0;
  const release = async () => {
    const queue = [...pending];
    const picks = (order ?? queue.map((p) => p.attemptId)).map((aid) => queue.splice(queue.findIndex((p) => p.attemptId === aid), 1)[0]!);
    for (const p of picks) {
      p.go();
      await p.done;
    }
  };
  const settle = async (req: Request, args: { p_attempt_id: string; p_completed_at: string; p_evaluation: unknown }, gated: boolean) => {
    const res = await original(req);
    const [row] = ((await res.clone().json()) as Array<{ outcome?: string; contested_ids?: string[] }> | null) ?? [];
    settlements.push({ attemptId: args.p_attempt_id, completedAt: args.p_completed_at, outcome: row?.outcome ?? `error ${res.status}`, contested: row?.contested_ids ?? [], evidenceIds: evidenceIdsOf(storedMissionCredit(args.p_evaluation)), gated });
    return res;
  };
  db.handle = async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/rpc/complete_mission_attempt')) return original(req);
    const args = (await req.clone().json()) as { p_attempt_id: string; p_completed_at: string; p_evaluation: unknown };
    if (held >= n) return settle(req, args, false);
    held += 1;
    let go!: () => void;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (go = resolve));
    const done = new Promise<void>((resolve) => (finish = resolve));
    pending.push({ attemptId: args.p_attempt_id, go, done });
    if (pending.length === n) void release();
    await gate;
    try {
      return await settle(req, args, true);
    } finally {
      finish();
    }
  };
  return { settlements, restore: () => (db.handle = original) };
}

/** The final stored decision of an attempt. */
const storedCredit = (f: Fixture, attemptId: string) => storedMissionCredit(attemptRow(f, attemptId).evaluation);
/** Who holds each evidence id (`mission_evidence_claims`). */
const holders = (f: Fixture) => new Map(f.h.db.rows('mission_evidence_claims').map((c) => [c.evidence_id as string, c.attempt_id as string]));

/**
 * The invariants the database settlement guarantees, whatever the interleaving: every evidence id of a stored decision
 * is held by that attempt and by no other decision; every mission payment references an attempt whose FINAL decision is
 * credited, once; completions equal the credited attempts.
 */
function expectSettledInvariants(f: Fixture, attemptIds: string[], missionId = f.mission.id as string): void {
  const held = holders(f);
  const seen = new Map<string, string>();
  for (const id of attemptIds) {
    for (const eid of evidenceIdsOf(storedCredit(f, id))) {
      expect(held.get(eid), `evidence ${eid} of ${id}`).toBe(id);
      expect(seen.get(eid), `evidence ${eid} named by two decisions`).toBeUndefined();
      seen.set(eid, id);
    }
  }
  const paid = payments(f).map((l) => l.reference_id as string);
  expect(new Set(paid).size).toBe(paid.length);
  for (const id of paid) expect(storedCredit(f, id)?.missionCredited, `paid attempt ${id}`).toBe(true);
  const credited = attemptIds.filter((id) => storedCredit(f, id)?.missionCredited === true);
  expect(paid.filter((id) => attemptIds.includes(id)).sort()).toEqual([...credited].sort());
  const progress = f.h.db.rows('mission_progress').find((p) => p.mission_id === missionId && p.enrollment_id === f.enrollment.id);
  expect(Number(progress?.completions ?? 0)).toBe(credited.length);
}

/** A request the learner's own PostgREST client may send (anon key + own JWT), as RLS allows it. */
async function asLearner(f: Fixture, method: 'POST' | 'PATCH', path: string, body: unknown): Promise<{ status: number; rows: DbRow[] }> {
  const res = await fetch(`http://127.0.0.1:1/rest/v1/${path}`, { method, headers: { apikey: 'anon-test-key', authorization: `Bearer ${f.token}`, 'x-langquest-client': 'user', 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) });
  return { status: res.status, rows: ((await res.json()) as DbRow[] | null) ?? [] };
}

const creditOf = (json: { data: { credit: { steps: Array<{ stepId: string; evidence: string; creditedOutcome: string | null }> } } }, step: DbRow) => json.data.credit.steps.find((s) => s.stepId === step.id);
const ledger = (f: Fixture, user = LEARNER) => f.h.db.rows('xp_ledger').filter((l) => l.user_id === user);
const payments = (f: Fixture) => ledger(f).filter((l) => l.reason === 'mission_completed');
const attemptRow = (f: Fixture, id: string) => f.h.db.rows('mission_attempts').find((a) => a.id === id)!;
const attemptObservations = (f: Fixture, attemptId: string) => f.h.db.rows('learning_observations').filter((o) => o.mission_attempt_id === attemptId);
const gradingRow = (f: Fixture, over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  user_id: LEARNER,
  enrollment_id: f.enrollment.id,
  skill_key: 'speaking.intelligibility',
  observation_type: 'semantic_success',
  scenario_id: f.mission.id,
  mission_id: null,
  mission_attempt_id: null,
  conversation_session_id: null,
  expression_id: f.bonjour.id,
  autonomy: 'unaided',
  hints_used: 0,
  outcome: 'success',
  utterance_confidence: 0.9,
  scorer_kind: 'deterministic',
  scorer_version: 'speech-route@2026-10-20.1',
  uncertainty: 0.05,
  feedback_evidence: null,
  observed_at: NOW(),
  ...over,
});
const evaluatorOutput = (over: Partial<EvaluatorOutput> = {}): EvaluatorOutput => ({ objectivesCompleted: ['g1'], skillsExercised: ['greet.basic'], observations: [], priorityCorrections: [], summary: 'Greeted the vendor.', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0.8, ...over });

/**
 * The rows the conversation evaluator writes for a session (`evaluateSession` → `Evaluator.toSkillObservations` →
 * `observationToRow`), produced by the real classes: what a learner can never insert.
 */
function evaluatorRows(f: Fixture, sessionId: string, missionId: string, items: Array<{ skillKey: string; outcome: ObservationOutcome }>): DbRow[] {
  const output = evaluatorOutput({
    observations: items.map((it) => ({ skillKey: it.skillKey, observationType: 'semantic_success', scenarioId: missionId, missionId, missionAttemptId: null, conversationSessionId: sessionId, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: it.outcome, utteranceConfidence: 0.9, uncertainty: 0.2, note: null })),
  });
  const rows = new Evaluator({ reasoner: new FakeReasoner() }).toSkillObservations(output, f.enrollment.id as string).map((o) => observationToRow(o, LEARNER, NOW()) as DbRow);
  return f.h.db.seed('learning_observations', rows);
}

/** A finished conversation session for `missionId` (seeded as the API's conversation route would leave it). */
const sessionRow = (f: Fixture, missionId: string, over: DbRow = {}): DbRow => ({ id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: f.enrollment.id, mission_id: missionId, rubric_outcomes: evaluatorOutput(), objectives_completed: ['g1'], state: 'finished', ...over });

// --- the decision itself (pure) ------------------------------------------------------------------------------------

describe('decideMissionCredit (pure): credit comes from server evidence only', () => {
  const E1 = '00000000-0000-4000-8000-0000000000e1';
  const E2 = '00000000-0000-4000-8000-0000000000e2';
  const specs = stepSpecsOf(
    [
      { id: '00000000-0000-4000-8000-000000000001', step_type: 'context_listening', target_expression_ids: [E1] },
      { id: '00000000-0000-4000-8000-000000000002', step_type: 'modeled_expression', target_expression_ids: [E1] },
      { id: '00000000-0000-4000-8000-000000000003', step_type: 'shadowing', target_expression_ids: ['00000000-0000-4000-8000-0000000000ff', E1] },
      { id: '00000000-0000-4000-8000-000000000004', step_type: 'comprehension_check', target_expression_ids: [E2, E1] },
      { id: '00000000-0000-4000-8000-000000000005', step_type: 'anticipation', target_expression_ids: [] },
      { id: '00000000-0000-4000-8000-000000000006', step_type: 'story_branch', target_expression_ids: [] },
    ],
    new Set([E1, E2]),
  );
  const [listen, modeled, shadowing, check, bare, story] = specs.map((sp) => sp.id) as [string, string, string, string, string, string];
  const r = (stepId: string, over: Partial<StepResult> = {}): StepResult => ({ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 1000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null, ...over });
  const row = (id: string, outcome: SpeechEvidence['outcome'], expressionId = E1, observedAt = NOW()): SpeechEvidence => ({ id, expressionId, outcome, utteranceConfidence: 0.9, observedAt });

  it('maps step types to what the server can verify: speaking steps with a published expression, conversations; never a choice', () => {
    expect(specs.map((sp) => sp.verification)).toEqual(['none', 'speech', 'speech', 'none', 'none', 'conversation']);
    expect(specs[2]!.expressionId).toBe(E1); // the unpublished first target is skipped, as in the mission detail
  });

  it('no evidence → no credit, whatever the claim; one row backs one step; the claim caps the outcome', () => {
    const none = decideMissionCredit({ specs, results: [r(listen), r(modeled), r(shadowing), r(bare), r(story)], pool: [] });
    expect(none.steps.every((c) => c.evidence === 'none' && c.creditedOutcome === null)).toBe(true);
    expect(hasPositiveEvidence(none.steps)).toBe(false);
    const one = decideMissionCredit({ specs, results: [r(modeled), r(shadowing)], pool: [row('a', 'success')] });
    expect(one.steps.filter((c) => c.evidence === 'speech_evaluation')).toHaveLength(1);
    expect(one.creditedSuccesses).toBe(1);
    const capped = decideMissionCredit({ specs, results: [r(modeled, { outcome: 'partial' }), r(shadowing, { outcome: 'success' })], pool: [row('a', 'success'), row('b', 'fail')] });
    // Best claims get the best rows: shadowing (success claim) ← success row; modeled (partial claim) ← fail row.
    expect(capped.steps.map((c) => [c.stepId, c.creditedOutcome])).toEqual([
      [modeled, 'fail'],
      [shadowing, 'success'],
    ]);
    expect(cappedOutcome('success', 'unclear')).toBe('unclear');
    expect(cappedOutcome('fail', 'success')).toBe('fail');
  });

  it('rows named by the step\'s own assessment ids win; a row is never used twice; other expressions never count', () => {
    const claimed = new Map([[modeled, [row('own', 'success')]], [shadowing, [row('own', 'success')]]]);
    const d = decideMissionCredit({ specs, results: [r(modeled), r(shadowing)], pool: [row('own', 'success'), row('e2', 'success', E2)], claimed });
    expect(d.steps.find((c) => c.stepId === modeled)).toMatchObject({ evidence: 'speech_evaluation', evidenceIds: ['own'] });
    expect(d.steps.find((c) => c.stepId === shadowing)).toMatchObject({ evidence: 'none' });
  });

  it('a choice is never credited, even when it names the answer key; conversations need a usable session; repeats count once', () => {
    const d = decideMissionCredit({
      specs,
      results: [r(check, { selectedIntentId: E1 }), r(check, { selectedIntentId: E2, outcome: 'success' }), r(story, { conversationSessionId: 'sess-ok' })],
      pool: [],
      sessions: new Map([['sess-ok', true]]),
    });
    expect(d.steps).toHaveLength(2); // the repeated step counts once (its last result)
    expect(d.steps[0]).toMatchObject({ stepId: check, evidence: 'none', creditedOutcome: null });
    expect(d.steps[1]).toMatchObject({ stepId: story, evidence: 'conversation_evaluator', creditedOutcome: null, evidenceIds: ['sess-ok'] });
    const wrong = decideMissionCredit({ specs, results: [r(story, { conversationSessionId: 'sess-bad' })], pool: [], sessions: new Map([['sess-bad', false]]) });
    expect(wrong.steps.map((c) => [c.evidence, c.creditedOutcome])).toEqual([['none', null]]);
    expect(d.gradableSteps).toBe(2); // modeled and shadowing: no choice, and the bare anticipation has no reference
  });

  it('the evidence window floor is the server clock: learner-written created_at/started_at can narrow it, never widen it', () => {
    const created = '2026-10-20T10:00:00.000Z';
    expect(evidenceWindow({ id: 'a', created_at: created, started_at: '2026-10-20T09:58:00.000Z' }, new Date('2026-10-20T10:30:00.000Z'))).toEqual({ from: '2026-10-20T09:48:00.000Z', to: '2026-10-20T10:32:00.000Z' });
    // Backdated attempt row (RLS lets the learner write created_at and started_at): 12 h before the evaluation, no more.
    expect(evidenceWindow({ id: 'a', created_at: '2000-01-01T00:00:00.000Z', started_at: '2000-01-01T00:00:00.000Z' }, new Date('2026-10-20T10:30:00.000Z')).from).toBe('2026-10-19T22:30:00.000Z');
    // An attempt opened 13 h ago and evaluated now: the same floor.
    expect(evidenceWindow({ id: 'a', created_at: '2026-10-19T21:30:00.000Z', started_at: '2026-10-19T21:30:00.000Z' }, new Date('2026-10-20T10:30:00.000Z')).from).toBe('2026-10-19T22:30:00.000Z');
    expect(evidenceWindow({ id: 'a', created_at: 'garbage', started_at: 'garbage' }, new Date('2026-10-20T10:30:00.000Z')).from).toBe('2026-10-19T22:30:00.000Z');
  });

  it('a session\'s stored output is capped by the evaluator\'s own rows: goals need a positive row on one of their skills', () => {
    const goals = [
      { id: 'g1', skill_keys: ['greet.basic'] },
      { id: 'g2', skill_keys: ['ask_price', 'decline_politely'] },
      { id: 'g3', skill_keys: ['take_leave'] },
    ];
    const claimed = evaluatorOutput({
      objectivesCompleted: ['g1', 'g2', 'g3', 'not_a_goal'],
      skillsExercised: ['greet.basic', 'ask_price', 'invented.key'],
      reviewTriggers: ['take_leave', 'invented.key'],
      observations: [
        { skillKey: 'greet.basic', observationType: 'semantic_success', scenarioId: 'm', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 0.9, uncertainty: 0.2, note: null },
        { skillKey: 'take_leave', observationType: 'semantic_success', scenarioId: 'm', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 0.9, uncertainty: 0.2, note: null },
      ],
    });
    const rows = [
      { skillKey: 'greet.basic', outcome: 'success' as const },
      { skillKey: 'decline_politely', outcome: 'partial' as const },
      { skillKey: 'take_leave', outcome: 'fail' as const },
    ];
    const out = corroboratedSessionOutput(claimed, rows, goals);
    expect(out.objectivesCompleted).toEqual(['g1', 'g2']); // g3: the evaluator saw take_leave fail
    expect(out.skillsExercised).toEqual(['greet.basic']);
    expect(out.reviewTriggers).toEqual(['take_leave']);
    expect(out.observations.map((o) => o.skillKey)).toEqual(['greet.basic']); // take_leave was claimed success, seen fail
    expect(corroboratedSessionOutput(claimed, [], goals).objectivesCompleted).toEqual([]);
    expect(parseSessionOutput({ objectivesCompleted: 'g1' })).toBeNull();
    expect(parseSessionOutput(null)).toBeNull();
    expect(parseSessionOutput(evaluatorOutput())).toEqual(evaluatorOutput());
    // The evaluator really writes rows this module recognises.
    expect(EVALUATOR_SCORER_VERSION.startsWith(SESSION_EVIDENCE.scorerVersionPrefix)).toBe(true);
  });

  it('stored decisions round-trip (an `answer_key` decision of the previous rules too); pre-credit evaluations read without one', () => {
    const credit = { version: MISSION_CREDIT_VERSION, missionCredited: true, withoutHints: true, gradableSteps: 1, creditedSuccesses: 1, steps: [{ stepId: modeled, claimedOutcome: 'success', evidence: 'speech_evaluation', creditedOutcome: 'success', evidenceIds: ['a'], utteranceConfidence: 0.9 }] };
    expect(storedMissionEvaluation({ rubric: { outcome: 'success' }, evaluator: evaluatorOutput(), evaluatorRan: false, credit })?.credit).toEqual(credit);
    const legacy = { ...credit, version: 'mission-credit@2026-10-20.1', steps: [...credit.steps, { stepId: check, claimedOutcome: 'success', evidence: 'answer_key', creditedOutcome: 'success', evidenceIds: [], utteranceConfidence: null }] };
    expect(storedMissionCredit({ credit: legacy })?.steps).toHaveLength(2);
    expect(evidenceIdsOf(storedMissionCredit({ credit: legacy }))).toEqual(['a']);
    expect(storedMissionEvaluation({ rubric: { outcome: 'fail' }, evaluator: evaluatorOutput(), evaluatorRan: false })).toMatchObject({ rubricOutcome: 'fail', credit: null });
    expect(storedMissionEvaluation(null)).toBeNull();
    const o = clientReportedObservation({ enrollmentId: E1, skillKey: 'speaking.intelligibility', observationType: 'semantic_success', scenarioId: 'm', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'deterministic', scorerVersion: 'speech-route@forged', uncertainty: 0, note: null });
    expect(o).toMatchObject({ scorerVersion: 'client-sync:speech-route@forged', uncertainty: 1, outcome: 'success' });
    expect(clientReportedObservation(o).scorerVersion).toBe('client-sync:speech-route@forged');
  });

  it('a stored decision replays only for the mission and enrollment it was made for (its ids, else its steps)', () => {
    const M = '00000000-0000-4000-8000-0000000000a1';
    const N = '00000000-0000-4000-8000-0000000000a2';
    const credit = storedMissionCredit({ credit: { version: MISSION_CREDIT_VERSION, missionCredited: true, withoutHints: true, gradableSteps: 1, creditedSuccesses: 1, steps: [{ stepId: modeled, claimedOutcome: 'success', evidence: 'speech_evaluation', creditedOutcome: 'success', evidenceIds: ['a'], utteranceConfidence: 0.9 }], missionId: M, enrollmentId: E1 } });
    expect(credit).toMatchObject({ missionId: M, enrollmentId: E1 });
    const here = { missionId: M, enrollmentId: E1, stepIds: new Set(specs.map((sp) => sp.id)) };
    expect(decisionMadeFor(credit, here)).toBe(true);
    expect(decisionMadeFor(credit, { ...here, missionId: N })).toBe(false);
    expect(decisionMadeFor(credit, { ...here, enrollmentId: E2 })).toBe(false);
    // A decision of the previous rules names neither: its step ids tie it to its mission.
    const older = { ...credit!, missionId: undefined, enrollmentId: undefined };
    expect(decisionMadeFor(older, { ...here, missionId: N })).toBe(true);
    expect(decisionMadeFor(older, { ...here, stepIds: new Set([listen]) })).toBe(false);
    // A pre-credit evaluation carries nothing to check.
    expect(decisionMadeFor(null, { ...here, stepIds: new Set() })).toBe(true);
  });

  it('dropping contested evidence only ever removes rows and sessions', () => {
    const ev = { pool: [row('a', 'success'), row('b', 'success')], claimed: new Map([[modeled, [row('a', 'success')]]]), sessions: new Map([['s1', []], ['s2', []]]), consumed: new Set<string>(['z']) };
    const kept = withoutEvidence(ev, new Set(['a', 's1']));
    expect(kept.pool.map((x) => x.id)).toEqual(['b']);
    expect(kept.claimed.get(modeled)).toEqual([]);
    expect([...kept.sessions.keys()]).toEqual(['s2']);
    expect([...kept.consumed].sort()).toEqual(['a', 's1', 'z']);
    expect(withoutEvidence(ev, new Set())).toBe(ev);
    // A decision re-made without them cannot use them.
    const again = decideMissionCredit({ specs, results: [r(modeled), r(shadowing)], pool: kept.pool, claimed: kept.claimed });
    expect(evidenceIdsOf({ steps: again.steps })).toEqual(['b']);
  });
});

// --- through the real app ----------------------------------------------------------------------------------------

describe('POST /v1/missions/:id/evaluate — credit is server-authoritative', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  it('a forged "understood" (answer key included) with no graded take earns nothing at all, yet the mission completes', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    const res = await evaluate(f, attemptId, allSuccess(f));
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const data = MissionEvaluateApiResponseSchema.parse(res.json.data);
    expect(data).toMatchObject({ xpAwarded: 0, xpReplayed: false, achievementsUnlocked: [], scheduledReviews: [], masteryChanges: [] });
    expect(data.credit.missionCredited).toBe(false);
    expect(data.evaluation.objectivesCompleted).toEqual([]);
    for (const step of Object.values(f.steps)) expect(creditOf(res.json, step)).toMatchObject({ evidence: 'none', creditedOutcome: null });
    expect(ledger(f)).toEqual([]);
    expect(f.h.db.rows('learning_observations')).toEqual([]); // not even a "listening" observation for the choice
    expect(f.h.db.rows('user_skill_mastery')).toEqual([]);
    // Navigation: the attempt is completed and the mission is marked completed, but it is not a credited completion.
    const attempt = attemptRow(f, attemptId);
    expect(attempt.completed_at).toBeTruthy();
    expect((attempt.evaluation as { credit: { missionCredited: boolean } }).credit.missionCredited).toBe(false);
    expect(attempt.step_results).toHaveLength(5); // the claims are kept as reported
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ status: 'completed', completions: 0, first_completed_at: null, completed_without_hints: false })]);
    expect(f.h.db.rows('user_achievements')).toEqual([]);
    expect(f.h.blocked).toEqual([]);
  });

  it('real server-graded takes credit their steps and pay XP once; replays (same or new client event) award nothing', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    const takes = [await gradeTake(f, f.bonjour, whisper('Bonjour')), await gradeTake(f, f.bonjour, whisper('Bonjour')), await gradeTake(f, f.oui, whisper('Oui'))];
    expect(takes.map((t) => t.intelligibility)).toEqual(['understood', 'understood', 'understood']);
    expect(f.h.db.rows('learning_observations').filter((o) => o.skill_key === 'speaking.intelligibility')).toHaveLength(3);
    // The player's assessment ids are not persisted by the speech route: the rows are matched per expression.
    const body = allSuccess(f, { modeled: [takes[0]!.assessmentId], anticipation: [takes[1]!.assessmentId], shadowing: [takes[2]!.assessmentId] });
    const clientEventId = crypto.randomUUID();
    const res = await evaluate(f, attemptId, body, { clientEventId });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const data = MissionEvaluateApiResponseSchema.parse(res.json.data);
    expect(data.credit.missionCredited).toBe(true);
    expect(data.xpReplayed).toBe(false);
    expect(data.evaluation.objectivesCompleted).toEqual(['g1']);
    for (const step of [f.steps.modeled, f.steps.anticipation, f.steps.shadowing]) expect(creditOf(res.json, step)).toMatchObject({ evidence: 'speech_evaluation', creditedOutcome: 'success' });
    for (const step of [f.steps.listen, f.steps.choice]) expect(creditOf(res.json, step)).toMatchObject({ evidence: 'none' });
    expect(payments(f)).toEqual([expect.objectContaining({ amount: 50, reference_id: attemptId })]);
    expect(data.xpAwarded).toBe(ledger(f).reduce((n, l) => n + Number(l.amount), 0));
    expect(data.achievementsUnlocked).toContain('first_mission');
    expect(data.scheduledReviews.length).toBeGreaterThan(0);
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ status: 'completed', completions: 1, best_attempt_id: attemptId })]);
    expect(attemptObservations(f, attemptId).every((o) => o.observation_type === 'spoken_production')).toBe(true);
    expect(new Set(evidenceIdsOf(storedMissionCredit(attemptRow(f, attemptId).evaluation))).size).toBe(3);
    const xpAfterFirst = ledger(f).length;
    const observationsAfterFirst = f.h.db.rows('learning_observations').length;

    // Replay with the same client event, then with a new one: the stored decision is replayed, nothing is re-awarded.
    for (const id of [clientEventId, crypto.randomUUID()]) {
      const replay = await evaluate(f, attemptId, body, { clientEventId: id });
      expect(replay.status).toBe(200);
      expect(replay.json.data).toMatchObject({ xpAwarded: 0, xpReplayed: true, credit: { missionCredited: true } });
    }
    // A replay cannot rewrite the decision either (a different, better body is ignored).
    const rewrite = await evaluate(f, attemptId, body.map((r) => ({ ...r, hintsUsed: 0, outcome: 'success' })), { clientEventId: crypto.randomUUID() });
    expect(rewrite.json.data.xpAwarded).toBe(0);
    expect(ledger(f)).toHaveLength(xpAfterFirst);
    expect(f.h.db.rows('learning_observations')).toHaveLength(observationsAfterFirst);
    expect(f.h.db.rows('mission_progress')[0]).toMatchObject({ completions: 1, best_attempt_id: attemptId });
  });

  it('the same graded takes never back a second attempt; one take never credits two steps', async () => {
    f = await setup();
    const first = await startAttempt(f);
    await gradeThree(f);
    expect((await evaluate(f, first, allSuccess(f))).json.data.credit.missionCredited).toBe(true);
    const xp = ledger(f).length;

    // A second attempt of the same mission, all claimed as understood, with no new take: nothing left to back it.
    const second = await startAttempt(f);
    const res = await evaluate(f, second, allSuccess(f));
    expect(res.json.data).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false } });
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'none' });
    expect(ledger(f)).toHaveLength(xp);

    // A third attempt with ONE new take for "Bonjour": it backs one of the two "Bonjour" steps, not both.
    const third = await startAttempt(f);
    await gradeTake(f, f.bonjour, whisper('Bonjour'));
    const one = await evaluate(f, third, allSuccess(f));
    const credited = [f.steps.modeled, f.steps.anticipation].map((st) => creditOf(one.json, st)!.evidence);
    expect(credited.sort()).toEqual(['none', 'speech_evaluation']);
    expect(one.json.data.credit.missionCredited).toBe(false); // 1 of 3 gradable steps
    expect(ledger(f)).toHaveLength(xp);
  });

  it('learner-writable attempt fields never free used takes: backdated created_at, moved mission_id or enrollment_id', async () => {
    f = await setup();
    const used = await startAttempt(f);
    await gradeThree(f);
    expect((await evaluate(f, used, allSuccess(f))).json.data.credit.missionCredited).toBe(true);
    expect(payments(f)).toHaveLength(1);
    // RLS owner_update allows each write. Since migration 161 the guard trigger refuses the mission_id/enrollment_id
    // ones on a completed attempt like this one; the fake still applies them: the claims must hold without that guard.
    for (const patch of [{ created_at: '2000-01-01T00:00:00.000Z', started_at: '2000-01-01T00:00:00.000Z' }, { mission_id: f.chat.id }, { enrollment_id: f.secondEnrollment.id }]) {
      const write = await asLearner(f, 'PATCH', `mission_attempts?id=eq.${used}`, patch);
      expect(write.status).toBe(200);
      const next = await startAttempt(f);
      const res = await evaluate(f, next, allSuccess(f));
      expect(res.json.data, JSON.stringify(patch)).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false } });
      expect(attemptObservations(f, next)).toEqual([]);
    }
    expect(payments(f)).toHaveLength(1);
  });

  it('an attempt left open for 13 h still holds the takes it was credited with; a backdated attempt cannot reach older takes', async () => {
    f = await setup();
    const old = await startAttempt(f);
    const fresh = await startAttempt(f);
    // The clock moved on: `old` was opened 13 h ago (no learner write), then both are evaluated now, after the takes.
    attemptRow(f, old).created_at = ago(13 * HOUR);
    attemptRow(f, old).started_at = ago(13 * HOUR);
    await gradeThree(f);
    expect((await evaluate(f, old, allSuccess(f))).json.data.credit.missionCredited).toBe(true);
    expect((await evaluate(f, fresh, allSuccess(f))).json.data).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false } });
    expect(payments(f)).toHaveLength(1);

    // A take observed 13 h before the evaluation is out of reach even for an attempt row backdated to 2000.
    const late = await startAttempt(f);
    expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${late}`, { created_at: '2000-01-01T00:00:00.000Z', started_at: '2000-01-01T00:00:00.000Z' })).status).toBe(200);
    const [stale] = f.h.db.seed('learning_observations', [gradingRow(f, { observed_at: ago(13 * HOUR) })]);
    const res = await evaluate(f, late, [result(f.steps.modeled, { speechAssessmentIds: [stale!.id as string] })]);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'none' });
  });

  it('two attempts evaluated in parallel on the same takes: no row backs both, at most one is paid', async () => {
    f = await setup();
    const a = await startAttempt(f);
    const b = await startAttempt(f);
    await gradeThree(f);
    // Force the race: both decisions are made from the same evidence before either is settled.
    const gate = holdSettlements(f.h.db, 2);
    const [ra, rb] = await Promise.all([evaluate(f, a, allSuccess(f)), evaluate(f, b, allSuccess(f))]);
    gate.restore();
    expect([ra.status, rb.status]).toEqual([200, 200]);
    // The race really happened: both first decisions named the same three rows; the second was contested on all three.
    const [first, second, ...rest] = gate.settlements;
    expect(first!.evidenceIds).toHaveLength(3);
    expect([...second!.evidenceIds].sort()).toEqual([...first!.evidenceIds].sort());
    expect([first!.outcome, second!.outcome]).toEqual(['written', 'contested']);
    expect([...second!.contested].sort()).toEqual([...first!.evidenceIds].sort());
    // The loser re-decided without them and was settled with nothing.
    expect(rest).toEqual([expect.objectContaining({ attemptId: second!.attemptId, outcome: 'written', evidenceIds: [] })]);
    expect([ra, rb].filter((r) => r.json.data.credit.missionCredited)).toHaveLength(1);
    expectSettledInvariants(f, [a, b]);
    // Whatever the interleaving, the three takes pay one attempt at most, ever.
    await evaluate(f, await startAttempt(f), allSuccess(f));
    expect(payments(f)).toHaveLength(1);
  });

  it('one attempt evaluated twice in parallel: the first write decides, the other replays it (one set of observations)', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    await gradeThree(f);
    const gate = holdSettlements(f.h.db, 2);
    const [r1, r2] = await Promise.all([evaluate(f, attemptId, allSuccess(f)), evaluate(f, attemptId, allSuccess(f))]);
    gate.restore();
    expect([r1.status, r2.status]).toEqual([200, 200]);
    // Both decided; only the first settlement applied, the second found the decision and replayed it.
    expect(gate.settlements.map((st) => st.outcome)).toEqual(['written', 'already_decided']);
    expect([r1, r2].map((r) => r.json.data.credit.missionCredited)).toEqual([true, true]);
    // What the two answers report as awarded is exactly what the ledger holds (nothing paid twice).
    expect(r1.json.data.xpAwarded + r2.json.data.xpAwarded).toBe(ledger(f).reduce((n, l) => n + Number(l.amount), 0));
    expect(attemptObservations(f, attemptId)).toHaveLength(3); // one decision recorded: 3 steps × 1 goal skill
    expect(payments(f)).toHaveLength(1);
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ completions: 1 })]);
    expectSettledInvariants(f, [attemptId]);
  });

  it('a take without speech writes no grading row, so a claimed "understood" on it gets nothing', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    const take = await gradeTake(f, f.bonjour, whisper("Sous-titres réalisés par la communauté d'Amara.org", 'fr', { nsp: 0.12, lp: -0.25 }));
    expect(take.intelligibility).toBe('no_speech_detected');
    expect(f.h.db.rows('learning_observations')).toEqual([]);
    const res = await evaluate(f, attemptId, [result(f.steps.modeled, { speechAssessmentIds: [take.assessmentId] })]);
    expect(res.status).toBe(200);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'none', creditedOutcome: null });
    expect(res.json.data.xpAwarded).toBe(0);
    expect(f.h.db.rows('learning_observations')).toEqual([]);
    expect(ledger(f)).toEqual([]);
  });

  it('the last take counts when the evaluate follows it at once: the grading row is stored before the speech route answers', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    // A slow database write, and no flush: the lesson player sends the evaluate as soon as the last take's answer arrives.
    f.h.db.delays.set('POST learning_observations', 40);
    const take = await gradeTake(f, f.bonjour, whisper('Bonjour'), { flush: false });
    expect(take.intelligibility).toBe('understood');
    expect(f.h.db.rows('learning_observations').filter((o) => o.expression_id === f.bonjour.id && o.observation_type === 'semantic_success')).toHaveLength(1);
    const res = await evaluate(f, attemptId, [result(f.steps.modeled, { speechAssessmentIds: [take.assessmentId] })]);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'speech_evaluation', creditedOutcome: 'success' });
  });

  it('the credited outcome never exceeds the server\'s: a graded miss claimed as success is recorded as a fail', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    f.h.openrouter.chat = () => JSON.stringify({ matched: false, confidence: 0.99, matchedIntentIds: [], paraphrase: false, reason: 'Not a greeting.' });
    const take = await gradeTake(f, f.bonjour, whisper("J'aime le fromage."));
    expect(take.intelligibility).toBe('not_understood');
    const res = await evaluate(f, attemptId, [result(f.steps.modeled, { speechAssessmentIds: [take.assessmentId] })]);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'speech_evaluation', creditedOutcome: 'fail' });
    expect(attemptObservations(f, attemptId).every((o) => o.outcome === 'fail')).toBe(true);
    expect(res.json.data.xpAwarded).toBe(0);
  });

  it('another learner\'s assessment id is refused (403, nothing written); their graded takes never count for me', async () => {
    f = await setup();
    // The other learner really did the mission: their rows are real grading rows for the same mission and expressions.
    await gradeTake(f, f.bonjour, whisper('Bonjour'), { token: f.otherToken, enrollment: f.otherEnrollment });
    await gradeTake(f, f.oui, whisper('Oui'), { token: f.otherToken, enrollment: f.otherEnrollment });
    const theirs = f.h.db.rows('learning_observations').find((o) => o.user_id === OTHER)!;
    const attemptId = await startAttempt(f);
    const stolen = await evaluate(f, attemptId, [result(f.steps.modeled, { speechAssessmentIds: [theirs.id as string] })]);
    expect(stolen.status).toBe(403);
    expect(attemptRow(f, attemptId).completed_at ?? null).toBeNull();
    expect(attemptObservations(f, attemptId)).toEqual([]);
    expect(ledger(f)).toEqual([]);
    // Without the id, their rows are simply not mine: no credit.
    const res = await evaluate(f, attemptId, allSuccess(f));
    expect(res.status).toBe(200);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'none' });
    expect(res.json.data.credit.missionCredited).toBe(false);
    // And another learner's mission attempt cannot be evaluated at all.
    const theirAttempt = await startAttempt(f, f.mission.id as string, f.otherToken, f.otherEnrollment.id as string);
    const hijack = await evaluate(f, theirAttempt, allSuccess(f));
    expect(hijack.status).toBe(403);
    expect(ledger(f, OTHER)).toEqual([]);
  });

  it('a grading row named by its own id credits once even when listed under two steps; rows outside the window never count', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    const [own] = f.h.db.seed('learning_observations', [gradingRow(f), gradingRow(f, { observed_at: ago(13 * HOUR) })]);
    const res = await evaluate(f, attemptId, [result(f.steps.modeled, { speechAssessmentIds: [own!.id as string] }), result(f.steps.anticipation, { speechAssessmentIds: [own!.id as string] })]);
    expect(res.status).toBe(200);
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'speech_evaluation', creditedOutcome: 'success' });
    expect(creditOf(res.json, f.steps.anticipation)).toMatchObject({ evidence: 'none' }); // the 13 h old row is out of the window
  });

  it('a forged choice no longer lifts real takes over the bar (seeded mission shape: 4 graded speaking steps)', async () => {
    f = await setup();
    const seededId = f.seeded.id as string;
    const attemptId = await startAttempt(f, seededId);
    await gradeThree(f, seededId); // Bonjour ×2, Oui ×1: modeled, anticipation, feedback_retry; review_recall has none
    const res = await evaluate(f, attemptId, allSuccessSeeded(f), { missionId: seededId });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const choice = f.seededSteps.find((st) => st.step_type === 'listen_identify')!;
    expect(creditOf(res.json, choice)).toMatchObject({ evidence: 'none', creditedOutcome: null });
    // 3 of 4 graded steps (75 % < 80 %): no objective, no mission credit, no XP. The 3 real takes still count as evidence.
    expect(res.json.data).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false }, evaluation: { objectivesCompleted: [] } });
    expect(attemptObservations(f, attemptId)).toHaveLength(3);
    expect(attemptObservations(f, attemptId).some((o) => o.observation_type === 'listening_comprehension')).toBe(false);
    // Four new real takes on a new attempt: credited.
    const next = await startAttempt(f, seededId);
    await gradeThree(f, seededId);
    await gradeTake(f, f.bonjour, whisper('Bonjour'), { missionId: seededId });
    const ok = await evaluate(f, next, allSuccessSeeded(f), { missionId: seededId });
    expect(ok.json.data).toMatchObject({ credit: { missionCredited: true }, evaluation: { objectivesCompleted: ['g1'] } });
    expect(payments(f)).toEqual([expect.objectContaining({ reference_id: next })]);
  });
});

describe('credit races: evidence, decisions and completions are settled by the database (migration 161)', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  // Round 3 left this interleaving open: A1 and B decided from the same takes, A1 stored a credited decision, A2 (a
  // second evaluation of A) found it and paid A's mission XP, then A1's post-write check saw B's claim and dropped the
  // takes, so A was paid on a decision that no longer held them, and B was paid on the same takes (one take, two
  // missions). Each order below holds all three decisions until all three are made, settles them one at a time, and
  // lets A's replay pay before the evaluation that stored A's decision reaches its own award.
  for (const order of [['A', 'A', 'B'], ['A', 'B', 'A'], ['B', 'A', 'A']] as const) {
    it(`three requests (attempt A twice, attempt B once) on the same takes, settled ${order.join(' → ')}: the takes pay one attempt, once`, async () => {
      f = await setup();
      const A = await startAttempt(f);
      const B = await startAttempt(f);
      await gradeThree(f);
      const attemptOf = { A, B } as const;
      const runs = [
        { attemptId: A, clientEventId: crypto.randomUUID(), completedAt: ago(3_000) },
        { attemptId: A, clientEventId: crypto.randomUUID(), completedAt: ago(2_000) },
        { attemptId: B, clientEventId: crypto.randomUUID(), completedAt: ago(1_000) },
      ];
      const gate = holdSettlements(f.h.db, 3, order.map((k) => attemptOf[k]));
      // The replay of A pays first: an award for A from the evaluation that stored A's decision waits for the replay's.
      const settled = f.h.db.handle.bind(f.h.db);
      let replayPaid!: () => void;
      const replayPaidP = new Promise<void>((resolve) => (replayPaid = resolve));
      const keyOf = (completedAt: string) => runs.find((r) => r.completedAt === completedAt)!.clientEventId;
      f.h.db.handle = async (req: Request) => {
        if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/rpc/award_xp')) return settled(req);
        const args = (await req.clone().json()) as { p_reason: string; p_reference_id?: string; p_idempotency_key: string };
        if (args.p_reason !== 'mission_completed' || args.p_reference_id !== A) return settled(req);
        const decider = gate.settlements.find((st) => st.attemptId === A && st.outcome === 'written');
        if (decider && args.p_idempotency_key === keyOf(decider.completedAt)) {
          await Promise.race([replayPaidP, new Promise((resolve) => setTimeout(resolve, 500))]);
          return settled(req);
        }
        const res = await settled(req);
        replayPaid();
        return res;
      };
      const run = (r: (typeof runs)[number]) => evaluate(f, r.attemptId, allSuccess(f), { clientEventId: r.clientEventId, completedAt: r.completedAt });
      const [rA1, rA2, rB] = await Promise.all([run(runs[0]!), run(runs[1]!), run(runs[2]!)]);
      gate.restore();

      expect([rA1.status, rA2.status, rB.status], JSON.stringify([rA1.json, rA2.json, rB.json])).toEqual([200, 200, 200]);
      // The race really happened: three decisions from the same three takes, settled in the requested order.
      const gated = gate.settlements.filter((st) => st.gated);
      expect(gated.map((st) => st.attemptId)).toEqual(order.map((k) => attemptOf[k]));
      for (const st of gated) expect([...st.evidenceIds].sort()).toEqual([...gated[0]!.evidenceIds].sort());
      expect(gated[0]!.evidenceIds).toHaveLength(3);
      // The first one settled holds the three takes and is the only attempt paid.
      const winner = attemptOf[order[0]];
      const loser = winner === A ? B : A;
      expect([...holders(f).values()]).toEqual([winner, winner, winner]);
      expect(payments(f)).toEqual([expect.objectContaining({ reference_id: winner })]);
      expect(storedCredit(f, winner)?.missionCredited).toBe(true);
      expect(storedCredit(f, loser)).toMatchObject({ missionCredited: false });
      expect(evidenceIdsOf(storedCredit(f, loser))).toEqual([]);
      // Both answers about A say what A's stored decision says; nothing was paid twice or reported twice.
      expect([rA1, rA2].map((r) => r.json.data.credit.missionCredited)).toEqual([winner === A, winner === A]);
      expect(rB.json.data.credit.missionCredited).toBe(winner === B);
      expect([rA1, rA2, rB].reduce((n, r) => n + Number(r.json.data.xpAwarded), 0)).toBe(ledger(f).reduce((n, l) => n + Number(l.amount), 0));
      if (winner === A) {
        // The replay paid A (the round-3 interleaving), from a decision that is final: it still holds the takes.
        const decider = gate.settlements.find((st) => st.attemptId === A && st.outcome === 'written')!;
        expect(payments(f)[0]!.idempotency_key).not.toBe(keyOf(decider.completedAt));
      }
      expectSettledInvariants(f, [A, B]);
      // And the same takes never pay again.
      expect((await evaluate(f, await startAttempt(f), allSuccess(f))).json.data.credit.missionCredited).toBe(false);
      expect(payments(f)).toHaveLength(1);
    });
  }

  it('parallel credited completions of one mission count exactly (completions = completions + 1 in the settlement)', async () => {
    f = await setup();
    const attempts = [await startAttempt(f), await startAttempt(f), await startAttempt(f), await startAttempt(f)];
    // Each attempt has its own three graded takes and names them by id.
    const takes = attempts.map(() => f.h.db.seed('learning_observations', [gradingRow(f), gradingRow(f), gradingRow(f, { expression_id: f.oui.id })]).map((row) => row.id as string));
    // A read-then-write of mission_progress would lose counts here (round-3 code: 4 credited completions, completions = 1).
    f.h.db.delays.set('GET mission_progress', 30);
    f.h.db.delays.set('POST mission_progress', 30);
    f.h.db.delays.set('POST rpc:complete_mission_attempt', 10);
    const gate = holdSettlements(f.h.db, attempts.length);
    const res = await Promise.all(attempts.map((id, i) => evaluate(f, id, allSuccess(f, { modeled: [takes[i]![0]!], anticipation: [takes[i]![1]!], shadowing: [takes[i]![2]!] }))));
    gate.restore();
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(res.map((r) => r.json.data.credit.missionCredited)).toEqual([true, true, true, true]);
    expect(gate.settlements.map((st) => st.outcome)).toEqual(['written', 'written', 'written', 'written']);
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ status: 'completed', completions: 4, completed_without_hints: true })]);
    expect(attempts).toContain(f.h.db.rows('mission_progress')[0]!.best_attempt_id);
    expect(f.h.db.rows('mission_progress')[0]!.first_completed_at).toBeTruthy();
    expect(payments(f)).toHaveLength(4);
    expect(holders(f).size).toBe(12);
    attempts.forEach((id, i) => expect([...evidenceIdsOf(storedCredit(f, id))].sort()).toEqual([...takes[i]!].sort()));
    expectSettledInvariants(f, attempts);
  });

  it('four attempts racing for the same pool of takes: the losers re-decide without the claimed take, every take backs one attempt, every credited completion is counted', async () => {
    f = await setup();
    const [solo] = f.h.db.seed('missions', [missionRow()]);
    const soloId = solo!.id as string;
    const [soloStep] = f.h.db.seed('mission_steps', [stepRow(soloId, 0, 'modeled_expression', [f.bonjour.id as string])]);
    const attempts = [];
    for (let i = 0; i < 4; i += 1) attempts.push(await startAttempt(f, soloId));
    for (let i = 0; i < 4; i += 1) await gradeTake(f, f.bonjour, whisper('Bonjour'), { missionId: soloId });
    const gate = holdSettlements(f.h.db, attempts.length);
    const res = await Promise.all(attempts.map((id) => evaluate(f, id, [result(soloStep!)], { missionId: soloId })));
    gate.restore();
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    // All four first wanted the same (best, earliest) take; three were contested and re-decided, round after round.
    expect(gate.settlements.filter((st) => st.gated)).toHaveLength(4);
    expect(new Set(gate.settlements.filter((st) => st.gated).map((st) => st.evidenceIds.join())).size).toBe(1);
    expect(gate.settlements.filter((st) => st.outcome === 'contested').length).toBeGreaterThanOrEqual(3);
    expect(gate.settlements.filter((st) => st.outcome === 'written')).toHaveLength(4);
    expect(res.map((r) => r.json.data.credit.missionCredited)).toEqual([true, true, true, true]);
    expect(new Set(holders(f).values()).size).toBe(4);
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ mission_id: soloId, completions: 4 })]);
    expectSettledInvariants(f, attempts, soloId);
  });

  it('the settlement loop is bounded: contested every round, the evaluation answers 409 and stores nothing', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    await gradeThree(f);
    let calls = 0;
    f.h.db.rpcs.complete_mission_attempt = (args, ctx) => {
      calls += 1;
      return [{ outcome: 'contested', contested_ids: [crypto.randomUUID()], attempt: { ...ctx.db.rows('mission_attempts').find((a) => a.id === args.p_attempt_id) } }];
    };
    const res = await evaluate(f, attemptId, allSuccess(f));
    expect(res.status).toBe(409);
    expect(calls).toBe(MAX_SETTLE_ROUNDS);
    expect(attemptRow(f, attemptId).completed_at ?? null).toBeNull();
    expect(attemptObservations(f, attemptId)).toEqual([]);
    expect(ledger(f)).toEqual([]);
    expect(f.h.db.rows('mission_progress')).toEqual([]);
  });

  it('an attempt moved to another mission while it is being evaluated is refused (409), never credited to either', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    await gradeThree(f);
    const original = f.h.db.handle.bind(f.h.db);
    f.h.db.handle = async (req: Request) => {
      if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/rpc/complete_mission_attempt')) {
        // RLS owner_update lets the learner rewrite mission_id between the API's checks and the settlement.
        f.h.db.handle = original;
        expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${attemptId}`, { mission_id: f.chat.id })).status).toBe(200);
      }
      return original(req);
    };
    const res = await evaluate(f, attemptId, allSuccess(f));
    f.h.db.handle = original;
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(attemptRow(f, attemptId).completed_at ?? null).toBeNull();
    expect(f.h.db.rows('mission_evidence_claims')).toEqual([]);
    expect(ledger(f)).toEqual([]);
    expect(f.h.db.rows('mission_progress')).toEqual([]);
  });

  it('a settled attempt moved afterwards to another mission or course replays nowhere else (409): no progress row, XP or review there; moved back, it replays as stored', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    await gradeThree(f);
    expect((await evaluate(f, attemptId, allSuccess(f))).json.data.credit.missionCredited).toBe(true);
    // The decision names the mission and enrollment it was settled for.
    expect(storedCredit(f, attemptId)).toMatchObject({ missionId: f.mission.id, enrollmentId: f.enrollment.id });
    const progressBefore = structuredClone(f.h.db.rows('mission_progress'));
    const reviewsBefore = f.h.db.rows('user_expression_reviews').length;
    const xpBefore = ledger(f).length;
    // Since migration 161 the guard trigger refuses these writes on a completed attempt (42501,
    // mission_progress_atomic.test.sql §9). The fake applies them, so this checks the API on its own.
    const moves = [
      { patch: { mission_id: f.seeded.id }, missionId: f.seeded.id as string, enrollmentId: f.enrollment.id as string, body: allSuccessSeeded(f) },
      { patch: { mission_id: f.mission.id, enrollment_id: f.secondEnrollment.id }, missionId: f.mission.id as string, enrollmentId: f.secondEnrollment.id as string, body: allSuccess(f) },
    ];
    for (const m of moves) {
      expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${attemptId}`, m.patch)).status).toBe(200);
      const res = await evaluate(f, attemptId, m.body, { missionId: m.missionId, enrollmentId: m.enrollmentId });
      expect(res.status, `${JSON.stringify(m.patch)} ${JSON.stringify(res.json)}`).toBe(409);
    }
    expect(f.h.db.rows('mission_progress')).toEqual(progressBefore);
    expect(ledger(f)).toHaveLength(xpBefore);
    expect(f.h.db.rows('user_expression_reviews')).toHaveLength(reviewsBefore);
    // Moved back to where it was decided, it replays as stored.
    expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${attemptId}`, { enrollment_id: f.enrollment.id })).status).toBe(200);
    const replay = await evaluate(f, attemptId, allSuccess(f));
    expect(replay.status, JSON.stringify(replay.json)).toBe(200);
    expect(replay.json.data).toMatchObject({ xpAwarded: 0, xpReplayed: true, credit: { missionCredited: true } });
    expect(f.h.db.rows('mission_progress')).toEqual(progressBefore);
  });

  it('a mission of another course variety is refused (422, nothing written), however the attempt reached it: inserted directly or moved', async () => {
    f = await setup();
    const [other] = f.h.db.seed('missions', [missionRow({ target_variety_id: 'es' })]);
    const otherId = other!.id as string;
    const [otherStep] = f.h.db.seed('mission_steps', [stepRow(otherId, 0, 'modeled_expression', [f.bonjour.id as string])]);
    // The attempts route refuses it...
    const create = await f.h.call(`/v1/missions/${otherId}/attempts`, { token: f.token, body: { enrollmentId: f.enrollment.id, clientAttemptId: crypto.randomUUID(), missionRevision: 1, startedAt: NOW() } });
    expect(create.status).toBe(422);
    // ...but RLS lets the learner insert an open attempt directly (offline-first) or point an open one at it.
    const inserted = await asLearner(f, 'POST', 'mission_attempts?select=*', { user_id: LEARNER, enrollment_id: f.enrollment.id, mission_id: otherId, client_attempt_id: crypto.randomUUID(), mission_revision: 1, started_at: NOW() });
    expect(inserted.status).toBe(201);
    const moved = await startAttempt(f);
    expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${moved}`, { mission_id: otherId })).status).toBe(200);
    await gradeTake(f, f.bonjour, whisper('Bonjour'), { missionId: otherId });
    for (const id of [inserted.rows[0]!.id as string, moved]) {
      const res = await evaluate(f, id, [result(otherStep!)], { missionId: otherId });
      expect(res.status, JSON.stringify(res.json)).toBe(422);
      expect(attemptRow(f, id).completed_at ?? null).toBeNull();
      expect(attemptObservations(f, id)).toEqual([]);
    }
    expect(f.h.db.rows('mission_evidence_claims')).toEqual([]);
    expect(f.h.db.rows('mission_progress')).toEqual([]);
    expect(ledger(f)).toEqual([]);
  });

  it('a decision stored before migration 161 (no claims, no progress row) replays uncounted and still blocks its takes', async () => {
    f = await setup();
    const old = await startAttempt(f);
    await gradeThree(f);
    const rows = f.h.db.rows('learning_observations').map((o) => o.id as string);
    // What round-3 code left: a completed, credited decision naming the takes, with no claim (the migration backfills
    // them; this checks that the API needs the claim, not the scan, to keep the takes out of another attempt).
    const credit = { version: 'mission-credit@2026-10-20.2', missionCredited: true, withoutHints: true, gradableSteps: 3, creditedSuccesses: 3, steps: [f.steps.modeled, f.steps.anticipation, f.steps.shadowing].map((st, i) => ({ stepId: st.id, claimedOutcome: 'success', evidence: 'speech_evaluation', creditedOutcome: 'success', evidenceIds: [rows[i]], utteranceConfidence: 0.9 })) };
    Object.assign(attemptRow(f, old), { completed_at: NOW(), evaluation: { rubric: { outcome: 'success' }, evaluator: evaluatorOutput(), evaluatorRan: false, credit } });
    // The backfill (migration 161 §3) gives each named take to the attempt.
    f.h.db.seed('mission_evidence_claims', rows.map((id) => ({ evidence_id: id, evidence_kind: 'grading_row', attempt_id: old, user_id: LEARNER, claimed_at: NOW() })));
    const replay = await evaluate(f, old, allSuccess(f));
    expect(replay.json.data).toMatchObject({ credit: { missionCredited: true } });
    expect(payments(f)).toHaveLength(1);
    // The missing progress row is inserted for navigation, uncounted (it was counted when that decision was made).
    expect(f.h.db.rows('mission_progress')).toEqual([expect.objectContaining({ status: 'completed', completions: 0, best_attempt_id: old })]);
    const next = await startAttempt(f);
    expect((await evaluate(f, next, allSuccess(f))).json.data).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false } });
    expect(payments(f)).toHaveLength(1);
    // That decision names no mission or enrollment, but its steps tie it to its mission: moved, it replays nowhere (409).
    expect((await asLearner(f, 'PATCH', `mission_attempts?id=eq.${old}`, { mission_id: f.seeded.id })).status).toBe(200);
    expect((await evaluate(f, old, allSuccessSeeded(f), { missionId: f.seeded.id as string })).status).toBe(409);
    expect(f.h.db.rows('mission_progress').filter((p) => p.mission_id === f.seeded.id)).toEqual([]);
  });
});

describe('POST /v1/missions/:id/evaluate — conversation steps need the evaluator\'s own rows', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  const chatEvaluate = async (fx: Fixture, sessionId: string | null) => evaluate(fx, await startAttempt(fx, fx.chat.id as string), [result(fx.chatStep, { conversationSessionId: sessionId })], { missionId: fx.chat.id as string });

  it('a session the learner inserted through PostgREST with a made-up evaluator output earns nothing, however often', async () => {
    f = await setup();
    const seededId = f.seeded.id as string;
    for (let i = 0; i < 3; i += 1) {
      const ins = await asLearner(f, 'POST', 'conversation_sessions?select=*', { user_id: LEARNER, enrollment_id: f.enrollment.id, mission_id: seededId, state: 'finished', rubric_outcomes: evaluatorOutput({ confidence: 0.99 }), objectives_completed: ['g1'] });
      expect(ins.status).toBe(201); // RLS owner_insert allows it
      const sid = ins.rows[0]!.id as string;
      // A client-sync "observation" naming the session and posing as the evaluator is stored as a client report.
      const sync = await f.h.call('/v1/me/progress/sync', { token: f.token, body: { deviceId: 'phone', clientSentAt: NOW(), events: [{ clientEventId: crypto.randomUUID(), enrollmentId: f.enrollment.id, deviceId: 'phone', revision: i + 1, occurredAt: NOW(), payload: { type: 'observation', observation: { enrollmentId: f.enrollment.id, skillKey: 'greet.basic', observationType: 'semantic_success', scenarioId: seededId, missionId: seededId, missionAttemptId: null, conversationSessionId: sid, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'llm_evaluator', scorerVersion: EVALUATOR_SCORER_VERSION, uncertainty: 0, note: null } } }] } });
      expect(sync.json.data.results[0].resolution).toBe('applied');
      const res = await evaluate(f, await startAttempt(f, seededId), allSuccessSeeded(f, sid), { missionId: seededId });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const conversation = f.seededSteps.find((st) => st.step_type === 'character_conversation')!;
      expect(creditOf(res.json, conversation)).toMatchObject({ evidence: 'none' });
      expect(res.json.data).toMatchObject({ xpAwarded: 0, evaluatorRan: false, achievementsUnlocked: [], credit: { missionCredited: false }, evaluation: { objectivesCompleted: [], confidence: null } });
    }
    expect(f.h.db.rows('learning_observations').every((o) => String(o.scorer_version).startsWith('client-sync:'))).toBe(true);
    expect(ledger(f)).toEqual([]);
    expect(f.h.db.rows('user_achievements')).toEqual([]);
  });

  it('a real session credits through its evaluator rows, once; its objectives are capped by them; it never moves missions', async () => {
    f = await setup();
    const chatId = f.chat.id as string;
    const [real, missed] = f.h.db.seed('conversation_sessions', [sessionRow(f, chatId), sessionRow(f, chatId)]);
    evaluatorRows(f, real!.id as string, chatId, [{ skillKey: 'greet.basic', outcome: 'success' }]);
    evaluatorRows(f, missed!.id as string, chatId, [{ skillKey: 'greet.basic', outcome: 'fail' }]);

    // The evaluator saw the greeting fail; the learner rewrites the stored output to claim the goal anyway.
    expect((await asLearner(f, 'PATCH', `conversation_sessions?id=eq.${missed!.id as string}`, { rubric_outcomes: evaluatorOutput({ objectivesCompleted: ['g1'], confidence: 1 }) })).status).toBe(200);
    const rewritten = await chatEvaluate(f, missed!.id as string);
    expect(rewritten.json.data).toMatchObject({ xpAwarded: 0, evaluatorRan: true, credit: { missionCredited: false }, evaluation: { objectivesCompleted: [] } });

    const ok = await chatEvaluate(f, real!.id as string);
    expect(ok.json.data).toMatchObject({ evaluatorRan: true, credit: { missionCredited: true }, evaluation: { objectivesCompleted: ['g1'] } });
    expect(creditOf(ok.json, f.chatStep)).toMatchObject({ evidence: 'conversation_evaluator', creditedOutcome: null });
    expect(payments(f)).toHaveLength(1);

    // Reused by another attempt: nothing (a session backs one attempt).
    const reused = await chatEvaluate(f, real!.id as string);
    expect(reused.json.data).toMatchObject({ xpAwarded: 0, credit: { missionCredited: false } });
    // Moved to another mission through PostgREST: its evaluator rows still name the mission they were written for.
    const [other] = f.h.db.seed('missions', [missionRow({ mission_type: 'conversation' })]);
    const [otherStep] = f.h.db.seed('mission_steps', [stepRow(other!.id as string, 0, 'character_conversation', [])]);
    const [fresh] = f.h.db.seed('conversation_sessions', [sessionRow(f, chatId)]);
    evaluatorRows(f, fresh!.id as string, chatId, [{ skillKey: 'greet.basic', outcome: 'success' }]);
    expect((await asLearner(f, 'PATCH', `conversation_sessions?id=eq.${fresh!.id as string}`, { mission_id: other!.id })).status).toBe(200);
    const moved = await evaluate(f, await startAttempt(f, other!.id as string), [result(otherStep!, { conversationSessionId: fresh!.id as string })], { missionId: other!.id as string });
    expect(moved.json.data).toMatchObject({ xpAwarded: 0, evaluatorRan: false, credit: { missionCredited: false } });
    expect(payments(f)).toHaveLength(1);
  });

  it('a session of another learner or another course is refused (403); a session without evaluator rows is not evidence', async () => {
    f = await setup();
    const chatId = f.chat.id as string;
    const [mine, otherCourse, theirs] = f.h.db.seed('conversation_sessions', [sessionRow(f, chatId), sessionRow(f, chatId, { enrollment_id: f.secondEnrollment.id }), sessionRow(f, chatId, { user_id: OTHER, enrollment_id: f.otherEnrollment.id })]);
    expect((await chatEvaluate(f, otherCourse!.id as string)).status).toBe(403);
    expect((await chatEvaluate(f, theirs!.id as string)).status).toBe(403);
    expect((await chatEvaluate(f, null)).json.data).toMatchObject({ xpAwarded: 0, evaluatorRan: false, credit: { missionCredited: false } });
    expect((await chatEvaluate(f, mine!.id as string)).json.data).toMatchObject({ xpAwarded: 0, evaluatorRan: false, credit: { missionCredited: false } });
    expect(ledger(f)).toEqual([]);
  });
});

describe('POST /v1/me/progress/sync cannot route around server credit', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  const sync = (fx: Fixture, payloads: unknown[]) =>
    fx.h.call('/v1/me/progress/sync', { token: fx.token, body: { deviceId: 'phone', clientSentAt: NOW(), events: payloads.map((payload, i) => ({ clientEventId: crypto.randomUUID(), enrollmentId: fx.enrollment.id, deviceId: 'phone', revision: i + 1, occurredAt: NOW(), payload })) } });
  const outcomes = (res: { json: { data: { results: Array<{ resolution: string; reason: string | null; xpCredited: number | null }> } } }) => res.json.data.results.map((r) => [r.resolution, r.reason, r.xpCredited]);

  it('a client observation posing as a grading row is kept as a client report: no mastery, and no mission credit', async () => {
    f = await setup();
    const attemptId = await startAttempt(f);
    const forged = { enrollmentId: f.enrollment.id, skillKey: 'speaking.intelligibility', observationType: 'semantic_success', scenarioId: f.mission.id, missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: f.bonjour.id, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'deterministic', scorerVersion: 'speech-route@2026-10-20.1', uncertainty: 0, note: null };
    const res = await sync(f, [{ type: 'observation', observation: forged }, { type: 'observation', observation: { ...forged, skillKey: 'greet.basic' } }]);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.results.map((r: { resolution: string }) => r.resolution)).toEqual(['applied', 'applied']);
    const rows = f.h.db.rows('learning_observations');
    expect(rows).toHaveLength(2);
    expect(rows.every((o) => o.scorer_version === 'client-sync:speech-route@2026-10-20.1' && o.uncertainty === 1)).toBe(true);
    // Recorded ("attempted"), but no counted evidence: excluded as fully uncertain.
    expect(f.h.db.rows('user_skill_mastery').every((m) => m.evidence_count === 0 && ['not_attempted', 'emerging'].includes(m.mastery_state as string))).toBe(true);
    const evaluated = await evaluate(f, attemptId, [result(f.steps.modeled)]);
    expect(creditOf(evaluated.json, f.steps.modeled)).toMatchObject({ evidence: 'none' });
    expect(evaluated.json.data.xpAwarded).toBe(0);
  });

  it('xp_claim pays mission XP only for an attempt the server credited, and never a skill advance', async () => {
    f = await setup();
    // A credited attempt (three real takes): evaluate already paid it.
    const credited = await startAttempt(f);
    await gradeThree(f);
    expect((await evaluate(f, credited, allSuccess(f))).json.data.credit.missionCredited).toBe(true);
    const paidByEvaluate = ledger(f).length;

    // An uncredited attempt that still carries server evidence: a graded miss, and the WRONG choice.
    const uncredited = await startAttempt(f);
    const defaultChat = f.h.openrouter.chat;
    f.h.openrouter.chat = () => JSON.stringify({ matched: false, confidence: 0.99, matchedIntentIds: [], paraphrase: false, reason: 'Not a greeting.' });
    const miss = await gradeTake(f, f.bonjour, whisper("J'aime le fromage."));
    f.h.openrouter.chat = defaultChat;
    const res = await evaluate(f, uncredited, [result(f.steps.modeled, { speechAssessmentIds: [miss.assessmentId] }), result(f.steps.choice, { selectedIntentId: f.oui.id as string })]);
    expect(res.json.data.credit).toMatchObject({ missionCredited: false });
    expect(creditOf(res.json, f.steps.modeled)).toMatchObject({ evidence: 'speech_evaluation', creditedOutcome: 'fail' });
    // The miss is counted evidence on the goal skill (a real mastery row), which evaluate did not pay.
    const mastery = f.h.db.rows('user_skill_mastery').find((m) => m.skill_key === 'greet.basic')!;
    expect(Number(mastery.evidence_count)).toBeGreaterThan(0);
    // Completed by a server path without any decision (stack seeds do this; `completed_at` is service-only).
    const [legacy] = f.h.db.seed('mission_attempts', [{ user_id: LEARNER, enrollment_id: f.enrollment.id, mission_id: f.mission.id, client_attempt_id: crypto.randomUUID(), completed_at: NOW(), evaluation: null, xp_awarded: 0 }]);

    const claims = await sync(f, [
      { type: 'xp_claim', reason: 'mission_completed', referenceId: uncredited, amount: 50 },
      { type: 'xp_claim', reason: 'step_completed', referenceId: uncredited, amount: 5 },
      { type: 'xp_claim', reason: 'skill_state_advanced', referenceId: mastery.id, amount: 20 },
      { type: 'xp_claim', reason: 'step_completed', referenceId: crypto.randomUUID(), amount: 5 },
      { type: 'xp_claim', reason: 'step_completed', referenceId: legacy!.id, amount: 5 },
      { type: 'xp_claim', reason: 'mission_completed', referenceId: legacy!.id, amount: 50 },
      { type: 'xp_claim', reason: 'mission_completed', referenceId: credited, amount: 50 },
      { type: 'xp_claim', reason: 'step_completed', referenceId: credited, amount: 5 },
      { type: 'xp_claim', reason: 'step_completed', referenceId: credited, amount: 5 },
    ]);
    expect(claims.status).toBe(200);
    expect(outcomes(claims)).toEqual([
      ['rejected', 'mission_not_credited', 0],
      ['rejected', 'mission_not_credited', 0],
      ['rejected', 'skill_advance_server_only', 0],
      ['rejected', 'reference_not_owned_or_incomplete', 0],
      ['rejected', 'mission_not_credited', 0],
      ['applied', null, 50], // no decision to contradict: the rule from before server-side credit
      ['applied', 'already_awarded', 0], // evaluate paid it
      ['applied', null, 5],
      ['applied', 'already_awarded', 0],
    ]);
    const added = ledger(f).slice(paidByEvaluate);
    expect(added.map((l) => [l.reason, l.reference_id])).toEqual([
      ['mission_completed', legacy!.id],
      ['step_completed', credited],
    ]);
    expect(ledger(f).some((l) => l.reference_id === uncredited)).toBe(false);
  });
});
