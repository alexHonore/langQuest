/**
 * Server-authoritative credit for mission steps (HANDOFF §9 item 1; §3.4 evidence, §3.8 XP, A11/A16).
 *
 * `POST /v1/missions/:id/evaluate` receives the learner's step results from the client. Their outcomes are CLAIMS. A
 * step earns skill credit (a deterministic observation → mastery) and counts toward the mission's XP only when the
 * server holds its own evidence for it, in rows the learner cannot write:
 *
 * | Step | Server evidence | Credited outcome |
 * |---|---|---|
 * | speaking (`modeled_expression`, `anticipation`, `shadowing`, `pronunciation_drill`, `feedback_retry`, `review_recall`) with a published target expression | a grading row written by `POST /v1/speech/pronunciation-assess` for THIS learner and enrollment: `learning_observations` (owner read-only) with `skill_key = speaking.intelligibility`, `observation_type = semantic_success`, scorer `speech-route@…`, `scenario_id` = the mission id, `expression_id` = the step's expression, no `mission_attempt_id`, observed inside the attempt window | the lower of the claim and the outcome the server recorded |
 * | conversation (`character_conversation`, `story_branch`) | the conversation evaluator's OWN rows for the referenced session: `learning_observations` with `scorer_kind = llm_evaluator`, scorer `evaluator@…`, `conversation_session_id` = the session, this learner, enrollment and mission | through the evaluator only; the session's stored output (`conversation_sessions.rubric_outcomes`, learner-writable under RLS) is a claim capped by those rows (`corroboratedSessionOutput`) |
 * | choice (`listen_identify`, `comprehension_check`) | none: the answer key (the step's first target expression) ships to every client in the mission detail, so a scripted client always "chooses" right | never credited (until the server checks opaque, server-shuffled option ids) |
 * | `context_listening`, `script_support`, speaking steps without a published expression | none possible (playback and reading happen on the device) | never credited |
 *
 * A take without speech writes no grading row (`no_speech_detected`), so it can never back a step. A step without
 * evidence keeps its claim in `mission_attempts.step_results` and the mission still completes for navigation; it writes
 * no observation, no mastery and no XP.
 *
 * One grading row (or session) backs at most one attempt, ever: rows any other evaluated attempt of this learner
 * already used are excluded (the ids are kept in `mission_attempts.evaluation.credit`, a service-only column), and
 * inside an attempt one row backs one step. The scan of other attempts is bounded only by `updated_at`, which the
 * server sets on every write (`set_updated_at`), never by the learner-writable `created_at`, `mission_id` or
 * `enrollment_id`. Two evaluations running in parallel are settled by a check after the decision is written (see
 * `missionEvaluate`). Rows are matched by the assessment ids the client lists when the server persisted them under that
 * id, and otherwise per expression: the best claims are paired with the best rows, so N real takes never credit more
 * than N steps.
 *
 * Other client-reported award paths go through the same rules: progress-sync `observation` events are recorded as
 * client reports (scorer `client-sync:…`, uncertainty 1, so mastery ignores them and they can never pose as a grading
 * or evaluator row), and `xp_claim` events are refused for attempts the server did not credit; skill advances are paid
 * by the server only.
 */
import { EvaluatorOutputSchema, ObservationOutcomeSchema, UuidSchema, type EvaluatorOutput, type MissionStepType, type ObservationOutcome, type SkillObservationInput, type StepResult, type XpReason } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { z } from 'zod';
import { problem } from '../http/envelope';
import type { RequestServices } from '../services/context';

/** Version of the credit rules; stored with every decision in `mission_attempts.evaluation.credit`. */
export const MISSION_CREDIT_VERSION = 'mission-credit@2026-10-20.2';

/**
 * What backs a step's credit. `none` means the step was not credited. `answer_key` is no longer assigned (choice steps
 * are unverifiable, see the table above); it stays so decisions stored under `mission-credit@2026-10-20.1` still parse.
 */
export const STEP_EVIDENCE_VALUES = ['speech_evaluation', 'answer_key', 'conversation_evaluator', 'none'] as const;
export const StepEvidenceSchema = z.enum(STEP_EVIDENCE_VALUES);
export type StepEvidence = z.infer<typeof StepEvidenceSchema>;

/** How a step type can be verified by the server. */
export type StepVerification = 'speech' | 'conversation' | 'none';

/** Steps the lesson player records (mirrors the player's speaking-step list). */
export const SPEECH_STEP_TYPES: ReadonlySet<MissionStepType> = new Set<MissionStepType>(['modeled_expression', 'anticipation', 'shadowing', 'pronunciation_drill', 'feedback_retry', 'review_recall']);
/** Steps answered by choosing an option. Unverifiable while the correct option is the client-visible first expression. */
export const CHOICE_STEP_TYPES: ReadonlySet<MissionStepType> = new Set<MissionStepType>(['listen_identify', 'comprehension_check']);
/** Steps evidenced by a conversation session's evaluator rows. */
export const CONVERSATION_STEP_TYPES: ReadonlySet<MissionStepType> = new Set<MissionStepType>(['character_conversation', 'story_branch']);

/** The grading row `POST /v1/speech/pronunciation-assess` writes for every take that contained speech. */
export const SPEECH_EVIDENCE = { skillKey: 'speaking.intelligibility', observationType: 'semantic_success', scorerVersionPrefix: 'speech-route@' } as const;

/**
 * The rows the conversation evaluator writes for a session (`lib/conversation.ts` `evaluateSession` →
 * `Evaluator.toSkillObservations`: `scorer_kind = llm_evaluator`, `scorer_version = EVALUATOR_SCORER_VERSION`).
 */
export const SESSION_EVIDENCE = { scorerKind: 'llm_evaluator', scorerVersionPrefix: 'evaluator@' } as const;

/** Scorer-version prefix of observations a client reported through progress sync (never server evidence). */
export const CLIENT_SYNC_SCORER_PREFIX = 'client-sync:';

/** Grading rows may precede the attempt row a little (attempt created late, clock skew)... */
export const EVIDENCE_GRACE_MS = 10 * 60_000;
/** ...but never by more than this before the evaluation (server clock), whatever `created_at`/`started_at` say. */
export const EVIDENCE_MAX_LOOKBACK_MS = 12 * 60 * 60_000;
/** Server clock tolerance at the upper end of the window. */
export const EVIDENCE_CLOCK_SKEW_MS = 2 * 60_000;
/** Margin of the other-attempts scan below the earliest candidate row (Worker vs database clock, transaction start). */
export const CONSUMED_SCAN_MARGIN_MS = 10 * 60_000;
/** Page size of the other-attempts scan (paged until empty, so a lower PostgREST `max_rows` never truncates it). */
export const CONSUMED_SCAN_PAGE = 500;
/** Assessment ids considered per step result (the latest ones) and per request. */
export const MAX_CLAIMED_IDS_PER_STEP = 20;
export const MAX_CLAIMED_IDS = 200;

export interface StepSpec {
  id: string;
  type: MissionStepType;
  verification: StepVerification;
  /** The step's first published target expression: the grading reference of a speaking step. */
  expressionId: string | null;
}

/** One server grading row, reduced to what the decision needs. */
export interface SpeechEvidence {
  id: string;
  expressionId: string | null;
  outcome: ObservationOutcome;
  utteranceConfidence: number | null;
  observedAt: string;
}

/** One row the conversation evaluator wrote for a session, reduced to what corroboration needs. */
export interface SessionEvidence {
  id: string;
  sessionId: string;
  skillKey: string;
  outcome: ObservationOutcome;
  observedAt: string;
}

export interface StepCredit {
  stepId: string;
  claimedOutcome: ObservationOutcome;
  evidence: StepEvidence;
  /**
   * Outcome written as the step's deterministic observation. `null` when no such observation is written: no evidence
   * (`evidence: 'none'`), or a conversation step, which is credited through its evaluator.
   */
  creditedOutcome: ObservationOutcome | null;
  /** Server rows backing the credit: grading observation ids, or the conversation session id. */
  evidenceIds: string[];
  /** Recognition confidence of the grading row (speech steps). */
  utteranceConfidence: number | null;
}

export interface MissionCreditDecision {
  version: string;
  /** One entry per distinct submitted step, in submission order. */
  steps: StepCredit[];
  /** Speaking steps of the mission that the server can grade (the deterministic denominator). */
  gradableSteps: number;
  /** Gradable steps credited with `success`. */
  creditedSuccesses: number;
}

const RANK: Readonly<Record<ObservationOutcome, number>> = { unclear: 0, fail: 1, partial: 2, success: 3 };
const POSITIVE_OUTCOMES: ReadonlySet<ObservationOutcome> = new Set<ObservationOutcome>(['success', 'partial']);

/** The lower of two outcomes: a claim can lower what the server recorded, never raise it. */
export const cappedOutcome = (claim: ObservationOutcome, server: ObservationOutcome): ObservationOutcome => (RANK[claim] <= RANK[server] ? claim : server);

/** The step specs of a mission bundle (the same "first published expression" the mission detail shows the player). */
export function stepSpecsOf(steps: ReadonlyArray<Pick<Row<'mission_steps'>, 'id' | 'step_type' | 'target_expression_ids'>>, publishedExpressionIds: ReadonlySet<string>): StepSpec[] {
  return steps.map((st) => {
    const type = st.step_type as MissionStepType;
    const expressionId = st.target_expression_ids.find((id) => publishedExpressionIds.has(id)) ?? null;
    const verification: StepVerification = SPEECH_STEP_TYPES.has(type) && expressionId ? 'speech' : CONVERSATION_STEP_TYPES.has(type) ? 'conversation' : 'none';
    return { id: st.id, type, verification, expressionId };
  });
}

/** The last result the client sent for each step, in first-seen order (a repeated step never counts twice). */
export function latestResults(results: readonly StepResult[]): StepResult[] {
  const byStep = new Map<string, StepResult>();
  for (const r of results) byStep.set(r.stepId, r);
  return [...byStep.values()];
}

const noCredit = (r: StepResult): StepCredit => ({ stepId: r.stepId, claimedOutcome: r.outcome, evidence: 'none', creditedOutcome: null, evidenceIds: [], utteranceConfidence: null });

const bestFirst = (a: SpeechEvidence, b: SpeechEvidence): number => RANK[b.outcome] - RANK[a.outcome] || a.observedAt.localeCompare(b.observedAt);

/**
 * Decide each step's credit from server evidence only (pure). `claimed` maps a step id to the grading rows its own
 * assessment ids resolved to; `pool` holds every usable grading row of the attempt window (claimed ones included: each
 * row is used once); `sessions` says, per referenced session id, whether it is usable evidence for this mission.
 */
export function decideMissionCredit(input: { specs: readonly StepSpec[]; results: readonly StepResult[]; pool: readonly SpeechEvidence[]; claimed?: ReadonlyMap<string, readonly SpeechEvidence[]>; sessions?: ReadonlyMap<string, boolean> }): MissionCreditDecision {
  const specById = new Map(input.specs.map((sp) => [sp.id, sp]));
  const results = latestResults(input.results);
  const credits = new Map<string, StepCredit>();
  const used = new Set<string>();
  const speechCredit = (r: StepResult, row: SpeechEvidence): StepCredit => {
    used.add(row.id);
    return { stepId: r.stepId, claimedOutcome: r.outcome, evidence: 'speech_evaluation', creditedOutcome: cappedOutcome(r.outcome, row.outcome), evidenceIds: [row.id], utteranceConfidence: row.utteranceConfidence };
  };

  // 1. Conversation and unverifiable steps (choice steps included).
  for (const r of results) {
    const spec = specById.get(r.stepId);
    if (!spec || spec.verification === 'none') credits.set(r.stepId, noCredit(r));
    else if (spec.verification === 'conversation') {
      const sid = r.conversationSessionId;
      credits.set(r.stepId, sid && input.sessions?.get(sid) === true ? { stepId: r.stepId, claimedOutcome: r.outcome, evidence: 'conversation_evaluator', creditedOutcome: null, evidenceIds: [sid], utteranceConfidence: null } : noCredit(r));
    }
  }

  // 2. Speaking steps whose own assessment ids resolved to grading rows: the best of those rows.
  const speaking = results.filter((r) => specById.get(r.stepId)?.verification === 'speech');
  for (const r of speaking) {
    const spec = specById.get(r.stepId)!;
    const own = (input.claimed?.get(r.stepId) ?? []).filter((row) => row.expressionId === spec.expressionId && !used.has(row.id)).sort(bestFirst);
    if (own[0]) credits.set(r.stepId, speechCredit(r, own[0]));
  }

  // 3. The other speaking steps, per expression: best claims paired with the best unused rows (one row, one step).
  const pending = speaking.filter((r) => !credits.has(r.stepId));
  for (const expressionId of new Set(pending.map((r) => specById.get(r.stepId)!.expressionId))) {
    const steps = pending.filter((r) => specById.get(r.stepId)!.expressionId === expressionId).sort((a, b) => RANK[b.outcome] - RANK[a.outcome]);
    const rows = input.pool.filter((row) => row.expressionId === expressionId && !used.has(row.id)).sort(bestFirst);
    steps.forEach((r, i) => credits.set(r.stepId, rows[i] ? speechCredit(r, rows[i]) : noCredit(r)));
  }

  const steps = results.map((r) => credits.get(r.stepId) ?? noCredit(r));
  const gradable = new Set(input.specs.filter((sp) => sp.verification === 'speech').map((sp) => sp.id));
  return {
    version: MISSION_CREDIT_VERSION,
    steps,
    gradableSteps: gradable.size,
    creditedSuccesses: steps.filter((c) => gradable.has(c.stepId) && c.creditedOutcome === 'success').length,
  };
}

/** True when some step carries positive server evidence (a credited success/partial, or a conversation evaluator). */
export const hasPositiveEvidence = (steps: readonly Pick<StepCredit, 'evidence' | 'creditedOutcome'>[]): boolean =>
  steps.some((c) => c.evidence === 'conversation_evaluator' || (c.evidence !== 'none' && (c.creditedOutcome === 'success' || c.creditedOutcome === 'partial')));

/** Parse the evaluator output stored on a session row (learner-writable: anything malformed is no output at all). */
export function parseSessionOutput(value: unknown): EvaluatorOutput | null {
  const parsed = EvaluatorOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Cap a session's stored evaluator output by the evaluator's own rows for that session (pure). The stored output sits
 * in `conversation_sessions.rubric_outcomes`, which the learner can rewrite through PostgREST; the rows cannot be. An
 * objective counts only when it is a mission goal whose skills those rows observed as success or partial; skills,
 * review triggers and observations count only when those rows observed them (an observation: same skill and outcome).
 * Summary, corrections and the confidence figure are display text and pass through unchanged.
 */
export function corroboratedSessionOutput(claimed: EvaluatorOutput, rows: readonly Pick<SessionEvidence, 'skillKey' | 'outcome'>[], goals: ReadonlyArray<{ id: string; skill_keys?: readonly string[] | null }>): EvaluatorOutput {
  const observed = new Set(rows.map((r) => r.skillKey));
  const observedOutcomes = new Set(rows.map((r) => `${r.skillKey}\u0000${r.outcome}`));
  const positive = new Set(rows.filter((r) => POSITIVE_OUTCOMES.has(r.outcome)).map((r) => r.skillKey));
  const backedGoals = new Set(goals.filter((g) => (g.skill_keys ?? []).some((k) => positive.has(k))).map((g) => g.id));
  return {
    ...claimed,
    objectivesCompleted: [...new Set(claimed.objectivesCompleted.filter((id) => backedGoals.has(id)))],
    skillsExercised: [...new Set(claimed.skillsExercised.filter((k) => observed.has(k)))],
    observations: claimed.observations.filter((o) => observedOutcomes.has(`${o.skillKey}\u0000${o.outcome}`)),
    reviewTriggers: [...new Set(claimed.reviewTriggers.filter((k) => observed.has(k)))],
  };
}

// --- stored decisions ---------------------------------------------------------------------------------------------

const StoredStepCreditSchema = z.object({
  stepId: UuidSchema,
  claimedOutcome: ObservationOutcomeSchema,
  evidence: StepEvidenceSchema,
  creditedOutcome: ObservationOutcomeSchema.nullable(),
  evidenceIds: z.array(z.string()),
  utteranceConfidence: z.number().nullable(),
});

/** The `credit` block stored in `mission_attempts.evaluation` (service-role column; learners cannot write it). */
export const StoredMissionCreditSchema = z.object({
  version: z.string(),
  missionCredited: z.boolean(),
  /** Every distinct submitted step used no hints (decided once, at first evaluation). */
  withoutHints: z.boolean(),
  gradableSteps: z.number().int().nonnegative(),
  creditedSuccesses: z.number().int().nonnegative(),
  steps: z.array(StoredStepCreditSchema),
});
export type StoredMissionCredit = z.infer<typeof StoredMissionCreditSchema>;

/** What a completed attempt's stored evaluation says (`credit` is null for attempts evaluated before these rules). */
export interface StoredMissionEvaluation {
  evaluator: EvaluatorOutput;
  evaluatorRan: boolean;
  rubricOutcome: ObservationOutcome | null;
  credit: StoredMissionCredit | null;
}

const StoredEvaluationSchema = z.object({
  rubric: z.object({ outcome: ObservationOutcomeSchema }).partial().nullish(),
  evaluator: EvaluatorOutputSchema,
  evaluatorRan: z.boolean().optional(),
  credit: z.unknown().optional(),
});

/** Parse a stored attempt evaluation; null when there is none (or it is unreadable, which is treated as none). */
export function storedMissionEvaluation(evaluation: unknown): StoredMissionEvaluation | null {
  const parsed = StoredEvaluationSchema.safeParse(evaluation);
  if (!parsed.success) return null;
  const credit = StoredMissionCreditSchema.safeParse(parsed.data.credit);
  return { evaluator: parsed.data.evaluator, evaluatorRan: parsed.data.evaluatorRan ?? false, rubricOutcome: parsed.data.rubric?.outcome ?? null, credit: credit.success ? credit.data : null };
}

/** Only the stored `credit` block (null when absent). */
export function storedMissionCredit(evaluation: unknown): StoredMissionCredit | null {
  if (!evaluation || typeof evaluation !== 'object') return null;
  const credit = StoredMissionCreditSchema.safeParse((evaluation as { credit?: unknown }).credit);
  return credit.success ? credit.data : null;
}

/** Every evidence id (grading rows, sessions) a decision used, once each. */
export const evidenceIdsOf = (credit: Pick<StoredMissionCredit, 'steps'> | null): string[] => [...new Set((credit?.steps ?? []).flatMap((st) => st.evidenceIds))];

// --- evidence lookup ----------------------------------------------------------------------------------------------

const EVIDENCE_COLUMNS = 'id, user_id, enrollment_id, scenario_id, mission_id, conversation_session_id, expression_id, skill_key, observation_type, scorer_kind, scorer_version, mission_attempt_id, outcome, utterance_confidence, observed_at';
type EvidenceRow = Pick<Row<'learning_observations'>, 'id' | 'user_id' | 'enrollment_id' | 'scenario_id' | 'mission_id' | 'conversation_session_id' | 'expression_id' | 'skill_key' | 'observation_type' | 'scorer_kind' | 'scorer_version' | 'mission_attempt_id' | 'outcome' | 'utterance_confidence' | 'observed_at'>;

export interface EvidenceContext {
  userId: string;
  enrollmentId: string;
  missionId: string;
  attempt: Pick<Row<'mission_attempts'>, 'id' | 'created_at' | 'started_at'>;
  now: Date;
}

/**
 * The time window in which grading rows may back this attempt. Its floor is the server's own clock (`now`): the
 * attempt's `created_at` and `started_at` are learner-writable (RLS insert/update), so they can narrow the window but
 * never widen it beyond `EVIDENCE_MAX_LOOKBACK_MS` before the evaluation.
 */
export function evidenceWindow(attempt: EvidenceContext['attempt'], now: Date): { from: string; to: string } {
  const created = Date.parse(attempt.created_at);
  const started = Date.parse(attempt.started_at);
  const anchors = [created, started].filter(Number.isFinite);
  const floor = now.getTime() - EVIDENCE_MAX_LOOKBACK_MS;
  const from = anchors.length ? Math.max(Math.min(...anchors) - EVIDENCE_GRACE_MS, floor) : floor;
  return { from: new Date(from).toISOString(), to: new Date(now.getTime() + EVIDENCE_CLOCK_SKEW_MS).toISOString() };
}

/** True when an observation row is a speech-route grading row of this learner, enrollment and mission. */
export function isSpeechEvidenceFor(row: EvidenceRow, ctx: Pick<EvidenceContext, 'userId' | 'enrollmentId' | 'missionId'>): boolean {
  return (
    row.user_id === ctx.userId &&
    row.enrollment_id === ctx.enrollmentId &&
    row.scenario_id === ctx.missionId &&
    row.skill_key === SPEECH_EVIDENCE.skillKey &&
    row.observation_type === SPEECH_EVIDENCE.observationType &&
    row.scorer_version.startsWith(SPEECH_EVIDENCE.scorerVersionPrefix) &&
    row.mission_attempt_id === null
  );
}

/**
 * True when an observation row was written by the conversation evaluator for a session of this learner, enrollment
 * and mission. A progress-sync report can carry `scorer_kind = llm_evaluator` and any session id, but its scorer
 * version always starts with `client-sync:`, never `evaluator@`.
 */
export function isSessionEvidenceFor(row: EvidenceRow, ctx: Pick<EvidenceContext, 'userId' | 'enrollmentId' | 'missionId'>): boolean {
  return (
    row.user_id === ctx.userId &&
    row.enrollment_id === ctx.enrollmentId &&
    row.mission_id === ctx.missionId &&
    row.conversation_session_id !== null &&
    row.mission_attempt_id === null &&
    row.scorer_kind === SESSION_EVIDENCE.scorerKind &&
    row.scorer_version.startsWith(SESSION_EVIDENCE.scorerVersionPrefix)
  );
}

const toEvidence = (row: EvidenceRow): SpeechEvidence => ({ id: row.id, expressionId: row.expression_id, outcome: row.outcome as ObservationOutcome, utteranceConfidence: row.utterance_confidence, observedAt: row.observed_at });

/**
 * Evidence ids (grading rows, sessions) that the learner's OTHER evaluated attempts were credited with. No filter on
 * `mission_id`, `enrollment_id` or `created_at` (all learner-writable) and no truncating limit: the scan is bounded
 * by `updated_at`, which `set_updated_at` sets to the database clock on every update. An attempt credited with a row
 * observed at T was written at or after T, so `since` just below the earliest candidate row finds every such attempt.
 */
export async function consumedEvidenceIds(s: RequestServices, input: { userId: string; attemptId: string; since: string }): Promise<Set<string>> {
  const out = new Set<string>();
  for (let offset = 0; ; ) {
    const res = await s.service
      .from('mission_attempts')
      .select('id, evaluation')
      .eq('user_id', input.userId)
      .neq('id', input.attemptId)
      .not('evaluation', 'is', null)
      .gte('updated_at', input.since)
      .order('id', { ascending: true })
      .range(offset, offset + CONSUMED_SCAN_PAGE - 1);
    if (res.error) throw new DbError(res.error, 'credit.consumed');
    const rows = res.data ?? [];
    for (const row of rows) for (const id of evidenceIdsOf(storedMissionCredit(row.evaluation))) out.add(id);
    if (rows.length === 0) return out;
    offset += rows.length;
  }
}

export interface MissionEvidence {
  /** Usable grading rows of the attempt window (not used by another attempt). */
  pool: SpeechEvidence[];
  /** Per step id: the usable grading rows its own assessment ids resolved to. */
  claimed: Map<string, SpeechEvidence[]>;
  /** Per referenced session id (not used by another attempt): the evaluator's own rows for it. */
  sessions: Map<string, SessionEvidence[]>;
  /** Evidence ids other attempts already used. */
  consumed: Set<string>;
  /** `updated_at` floor of the other-attempts scan (the post-write check reuses it). */
  consumedSince: string;
}

/** The evidence restricted to `keep` (a decision may only lose rows, never gain new ones). */
export function restrictEvidence(ev: MissionEvidence, keep: ReadonlySet<string>): MissionEvidence {
  return {
    ...ev,
    pool: ev.pool.filter((row) => keep.has(row.id)),
    claimed: new Map([...ev.claimed].map(([stepId, rows]) => [stepId, rows.filter((row) => keep.has(row.id))] as const)),
    sessions: new Map([...ev.sessions].filter(([sid]) => keep.has(sid))),
  };
}

/**
 * Load the server evidence for an attempt: grading rows the step results name by assessment id (another learner's id
 * is refused with 403), the other grading rows of the attempt window, the evaluator's rows for the referenced
 * conversation sessions, and the evidence other attempts already used.
 */
export async function loadMissionEvidence(s: RequestServices, ctx: EvidenceContext, results: readonly StepResult[]): Promise<MissionEvidence> {
  const window = evidenceWindow(ctx.attempt, ctx.now);
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  // Compared as instants: PostgREST returns `+00:00` offsets, the window is built with `Z`.
  const inWindow = (row: EvidenceRow): boolean => {
    const t = Date.parse(row.observed_at);
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  };
  const latest = latestResults(results);

  // Evaluator rows of the referenced sessions (no time window: a session is mission-scoped and backs one attempt).
  const sessionIds = [...new Set(latest.map((r) => r.conversationSessionId).filter((v): v is string => v !== null))];
  let sessionRows: EvidenceRow[] = [];
  if (sessionIds.length) {
    const res = await s.service
      .from('learning_observations')
      .select(EVIDENCE_COLUMNS)
      .eq('user_id', ctx.userId)
      .eq('enrollment_id', ctx.enrollmentId)
      .eq('mission_id', ctx.missionId)
      .eq('scorer_kind', SESSION_EVIDENCE.scorerKind)
      .like('scorer_version', `${SESSION_EVIDENCE.scorerVersionPrefix}%`)
      .in('conversation_session_id', sessionIds)
      .order('observed_at', { ascending: true })
      .limit(1000);
    if (res.error) throw new DbError(res.error, 'credit.sessions');
    sessionRows = ((res.data ?? []) as EvidenceRow[]).filter((row) => isSessionEvidenceFor(row, ctx) && sessionIds.includes(row.conversation_session_id!));
  }

  // Other attempts' evidence: every candidate row is at or after `window.from`, or is one of these session rows.
  const earliestSession = Math.min(...sessionRows.map((row) => Date.parse(row.observed_at)).filter(Number.isFinite));
  const consumedSince = new Date(Math.min(fromMs, earliestSession) - CONSUMED_SCAN_MARGIN_MS).toISOString();
  const consumed = await consumedEvidenceIds(s, { userId: ctx.userId, attemptId: ctx.attempt.id, since: consumedSince });

  const sessions = new Map<string, SessionEvidence[]>();
  for (const row of sessionRows) {
    const sid = row.conversation_session_id!;
    if (consumed.has(sid)) continue;
    sessions.set(sid, [...(sessions.get(sid) ?? []), { id: row.id, sessionId: sid, skillKey: row.skill_key, outcome: row.outcome as ObservationOutcome, observedAt: row.observed_at }]);
  }

  const idsByStep = new Map<string, string[]>();
  for (const r of latest) idsByStep.set(r.stepId, [...new Set(r.speechAssessmentIds)].slice(-MAX_CLAIMED_IDS_PER_STEP));
  const allIds = [...new Set([...idsByStep.values()].flat())].slice(0, MAX_CLAIMED_IDS);
  const claimed = new Map<string, SpeechEvidence[]>();
  if (allIds.length) {
    const res = await s.service.from('learning_observations').select(EVIDENCE_COLUMNS).in('id', allIds);
    if (res.error) throw new DbError(res.error, 'credit.claimed');
    const rows = (res.data ?? []) as EvidenceRow[];
    if (rows.some((row) => row.user_id !== ctx.userId)) throw problem.forbidden('A referenced speech assessment is not yours');
    const usable = new Map(rows.filter((row) => isSpeechEvidenceFor(row, ctx) && inWindow(row) && !consumed.has(row.id)).map((row) => [row.id, toEvidence(row)]));
    for (const [stepId, ids] of idsByStep) {
      const own = ids.map((id) => usable.get(id)).filter((e): e is SpeechEvidence => e !== undefined);
      if (own.length) claimed.set(stepId, own);
    }
  }

  const res = await s.service
    .from('learning_observations')
    .select(EVIDENCE_COLUMNS)
    .eq('user_id', ctx.userId)
    .eq('enrollment_id', ctx.enrollmentId)
    .eq('skill_key', SPEECH_EVIDENCE.skillKey)
    .eq('observation_type', SPEECH_EVIDENCE.observationType)
    .eq('scenario_id', ctx.missionId)
    .like('scorer_version', `${SPEECH_EVIDENCE.scorerVersionPrefix}%`)
    .is('mission_attempt_id', null)
    .gte('observed_at', window.from)
    .lte('observed_at', window.to)
    .order('observed_at', { ascending: true })
    .limit(500);
  if (res.error) throw new DbError(res.error, 'credit.pool');
  // Rows named by id stay in the pool too: the decision uses each row once, whichever way it was found.
  const pool = ((res.data ?? []) as EvidenceRow[]).filter((row) => isSpeechEvidenceFor(row, ctx) && inWindow(row) && !consumed.has(row.id)).map(toEvidence);
  return { pool, claimed, sessions, consumed, consumedSince };
}

// --- other client-reported award paths (progress sync) --------------------------------------------------------------

/**
 * A progress-sync `observation` is the client's own report: it is recorded (offline history survives) but marked as
 * such and given full uncertainty, so mastery excludes it (`too_uncertain`) and it can never pose as a server grading
 * row (`speech-route@…`), an evaluator row (`evaluator@…`) or the mission rubric.
 */
export function clientReportedObservation(o: SkillObservationInput): SkillObservationInput {
  const version = o.scorerVersion.startsWith(CLIENT_SYNC_SCORER_PREFIX) ? o.scorerVersion : `${CLIENT_SYNC_SCORER_PREFIX}${o.scorerVersion}`;
  return { ...o, scorerVersion: version.slice(0, 200), uncertainty: 1 };
}

/**
 * Why an `xp_claim` sync event must not be paid even though its reference is the learner's own completed row, or null.
 * - `skill_state_advanced` is never paid through sync: `missionEvaluate` pays a mastery advance itself, and only for a
 *   mission it credited (a sync claim would pay advances of uncredited missions);
 * - mission XP needs the server's credit: an attempt carrying a decision is paid only when `missionCredited`
 *   (`mission_completed` and `step_completed` alike, so a graded miss or an uncredited step never pays);
 *   `step_completed` also needs that decision; `mission_completed` for an attempt without one (evaluated before
 *   these rules, or completed by a server path without an evaluation — `completed_at` is service-only) keeps the
 *   earlier rule: refused when its rubric failed.
 */
export async function xpClaimRejection(s: RequestServices, input: { userId: string; reason: XpReason; referenceTable: string; referenceId: string }): Promise<string | null> {
  if (input.reason === 'skill_state_advanced') return 'skill_advance_server_only';
  if (input.referenceTable === 'mission_attempts' && (input.reason === 'mission_completed' || input.reason === 'step_completed')) {
    const res = await s.service.from('mission_attempts').select('id, evaluation').eq('id', input.referenceId).eq('user_id', input.userId).maybeSingle();
    if (res.error) throw new DbError(res.error, 'credit.claim_attempt');
    const stored = storedMissionEvaluation(res.data?.evaluation ?? null);
    if (stored?.credit) return stored.credit.missionCredited ? null : 'mission_not_credited';
    if (input.reason === 'step_completed') return 'mission_not_credited';
    return stored?.rubricOutcome === 'fail' ? 'mission_not_passed' : null;
  }
  return null;
}
