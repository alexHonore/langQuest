/**
 * §6.1 missions: localized detail (`?source=`), attempt creation (idempotent on `clientAttemptId`) and
 * evaluation. Evaluation combines the deterministic step rubric with the evaluator output recorded by the
 * conversation sessions referenced in the step results (A11: semantic paraphrase accepted, never exact phrase);
 * it then writes observations → mastery → XP (via `award_xp`, server-validated) → review cards → achievements
 * with the service client, strictly AFTER the attempt and enrollment were validated as the learner's own.
 *
 * Step outcomes sent by the client are claims (HANDOFF §9 item 1). Only steps the server holds evidence for are
 * credited (`lib/xp-credit.ts`): a speech-route grading row for speaking steps, the conversation evaluator's own rows
 * for conversation steps (the session row is learner-writable, so its stored output is capped by those rows). Choice
 * steps are not credited: their answer key ships to the client. The credited outcome never exceeds the claim or the
 * evidence. Steps without evidence write nothing; the attempt and the mission still complete for navigation, but
 * mission XP, completion counts, achievements and review cards need a credited mission. The decision is settled by the
 * database (`complete_mission_attempt`, migration 161): in one transaction it claims the decision's evidence (one
 * grading row or session backs one attempt; an id another attempt holds is `contested` and the decision is re-made
 * without it), stores the decision (the first write wins when two evaluations of one attempt race) and counts the
 * completion (`completions = completions + 1`, once). A stored decision is final and replayed as stored: a second
 * evaluate of a completed attempt never re-decides, and its XP is paid at most once per attempt (`award_xp`). It is
 * replayed only for the mission and enrollment it was settled for (`decisionMadeFor`): a completed attempt moved
 * elsewhere (learner-writable `mission_id`/`enrollment_id`; frozen by the guard trigger since migration 161) is refused
 * with 409. The mission must be of the enrollment's variety, whatever the attempt row says (learners can insert one).
 */
import {
  MissionAttemptCreateRequestSchema,
  MissionAttemptCreateResponseSchema,
  MissionDetailQuerySchema,
  MissionDetailResponseSchema,
  MissionEvaluateRequestSchema,
  MissionEvaluateResponseSchema,
  UuidSchema,
  type AutonomyLevel,
  type EvaluatorOutput,
  type LearnerLevel,
  type LearningSpeed,
  type MasteryState,
  type MissionType,
  type SourceLanguageCode,
  type MissionDetailResponse,
  type MissionExpression,
  type MissionStepType,
  ObservationOutcomeSchema,
  type ObservationType,
  type SkillObservationInput,
  type StepResult,
} from '@langquest/contracts';
import { earnedAchievements } from '@langquest/curriculum/rubric/xp';
import { evaluateMissionObjectives } from '@langquest/curriculum/rubric/rubric';
import { planSession, type PlannerMission } from '@langquest/curriculum/planner/planner';
import type { Json } from '@langquest/db/database.types';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sourceLanguageTranslator } from '@langquest/locales';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { MEDIA_ASSET_COLUMNS, mediaAssetToRef, reviewRowToCard, type MediaAssetPublicRow } from '../../lib/dto';
import { loadOwnedEnrollment, varietyOf } from '../../lib/enrollment';
import { goalDescriptionFor, goalsOf } from '../../lib/goals';
import { awardMasteryAdvances, awardXp, recordObservations, scheduleReviews, scheduler, uuidFrom, type MasteryChange, type XpAwardResult } from '../../lib/learning';
import {
  MAX_SETTLE_ROUNDS,
  MISSION_CREDIT_VERSION,
  StepEvidenceSchema,
  corroboratedSessionOutput,
  decideMissionCredit,
  decisionMadeFor,
  hasPositiveEvidence,
  latestResults,
  loadMissionEvidence,
  parseSessionOutput,
  settleMissionDecision,
  stepSpecsOf,
  storedMissionEvaluation,
  withoutEvidence,
  type MissionEvidence,
  type StoredMissionCredit,
  type StoredMissionEvaluation,
} from '../../lib/xp-credit';
import type { RequestServices } from '../../services/context';

/**
 * Local bound on the only free-text field a client may put into `step_results` (`selectedIntentId` is an intent key,
 * never a transcript): the contracts schema leaves it unbounded (cross-package gap), and the row is stored verbatim.
 */
const MissionEvaluateBoundedSchema = MissionEvaluateRequestSchema.extend({
  stepResults: z.array(MissionEvaluateRequestSchema.shape.stepResults.element.extend({ selectedIntentId: z.string().max(200).nullable() })).min(1).max(100),
});

const IdParams = z.object({ id: UuidSchema });

/**
 * Learner-facing API shape for `missionEvaluate`: the contracts response (nullable `confidence`, optional
 * `evaluatorRan`) with `evaluatorRan` made mandatory, so a mission without any conversation evaluator output never
 * reports a made-up percentage (§16.3): `evaluatorRan: false` ⇒ `evaluation.confidence: null`.
 */
export const MissionEvaluateApiResponseSchema = MissionEvaluateResponseSchema.extend({
  /** True only when at least one referenced conversation session carried LLM evaluator output. */
  evaluatorRan: z.boolean(),
  /**
   * The server's credit decision (API-local addition; contract clients strip it). `missionCredited` is true when the
   * attempt earned mission credit from server evidence. Per step: what backed it (`none` = not credited) and the
   * outcome recorded as its observation (`null` = none written).
   */
  credit: z.object({
    missionCredited: z.boolean(),
    steps: z.array(z.object({ stepId: UuidSchema, evidence: StepEvidenceSchema, creditedOutcome: ObservationOutcomeSchema.nullable() })),
  }),
});
export type MissionEvaluateApiResponse = z.infer<typeof MissionEvaluateApiResponseSchema>;

/** Build the localized mission detail through the learner's RLS client (published rows only). */
export async function buildMissionDetail(s: RequestServices, missionId: string, source: string): Promise<MissionDetailResponse> {
  const { db, repos } = s.requireUser();
  const bundle = await repos.curriculum.getMissionBundle(missionId, source);
  if (!bundle) throw problem.notFound('Mission');
  const { mission, steps, localization, expressions, forms, translations, audio } = bundle;
  const t = sourceLanguageTranslator({ sourceLanguage: source as SourceLanguageCode });
  const assetIds = [...new Set(audio.map((a) => a.asset_id))];
  const assets = assetIds.length ? ((await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).in('id', assetIds)).data as MediaAssetPublicRow[] | null) ?? [] : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const translationByExpr = new Map(translations.map((tr) => [tr.expression_id, tr]));
  const scenarios = await repos.curriculum.listScenarios(mission.id);
  const characterIds = [...new Set(scenarios.map((sc) => sc.character_id))];
  const characters = (await Promise.all(characterIds.map((id) => repos.curriculum.getCharacter(id)))).filter((ch): ch is Row<'characters'> => ch !== null);
  const intentIds = [...new Set(steps.flatMap((st) => st.valid_intent_ids))];
  const intents = intentIds.length ? ((await db.from('communicative_intents').select('id, intent_key').in('id', intentIds)).data ?? []) : [];
  const intentKeyById = new Map(intents.map((i) => [i.id, i.intent_key]));

  const toExpression = (expr: Row<'expressions'>): MissionExpression => {
    const tr = translationByExpr.get(expr.id);
    return {
      id: expr.id,
      canonicalText: expr.canonical_text,
      forms: forms.filter((f) => f.expression_id === expr.id).map((f) => ({ script: f.script, transliterationScheme: f.transliteration_scheme, text: f.text })),
      meaning: tr?.natural_meaning ?? '',
      contextNote: tr?.context_note ?? null,
      register: expr.register as MissionExpression['register'],
      audio: audio
        .filter((a) => a.expression_id === expr.id && assetById.has(a.asset_id))
        .map((a) => ({ asset: mediaAssetToRef(assetById.get(a.asset_id)!), speechRate: a.speech_rate as 'slow' | 'normal' | 'fast', synthetic: a.synthetic, regionalOption: a.regional_option })),
      translationQaState: (tr ? tr.qa_state : 'needs_review') as MissionExpression['translationQaState'],
    };
  };
  const expressionById = new Map(expressions.map((e) => [e.id, toExpression(e)]));
  const translationsComplete = expressions.every((e) => translationByExpr.has(e.id));
  const goalDescriptions = goalsOf(mission).map((g) => ({ goal: g, description: goalDescriptionFor(g, source as SourceLanguageCode, t.translator) }));
  const goalsComplete = goalDescriptions.every((g) => g.description !== null);
  const localizationComplete = localization !== null && (localization.qa_state === 'reviewed' || localization.qa_state === 'approved') && translationsComplete && goalsComplete;
  // Generic step-type label from the source-language catalog: the only honest fallback when no overlay exists.
  const stepTypeLabel = (stepType: string): string => (t.translator.has(`lesson.stepTypes.${stepType}`) ? t.translator.t(`lesson.stepTypes.${stepType}`) : '');

  return MissionDetailResponseSchema.parse({
    id: mission.id,
    revision: mission.published_revision ?? 0,
    type: mission.mission_type,
    title: localization?.title ?? ((mission.title_translations as Record<string, string> | null)?.[source] ?? ''),
    level: mission.level,
    targetVarietyId: mission.target_variety_id,
    sourceLanguageCode: source,
    localizationComplete,
    goals: goalDescriptions.map(({ goal, description }) => ({ id: goal.id, description: description ?? '', skillKeys: goal.skill_keys ?? [] })),
    recommendedMinutes: Number(mission.recommended_minutes),
    sceneArt: null,
    characters: characters.map((ch) => ({ id: ch.id, name: ch.name, role: ch.role, portrait: null, syntheticVoice: Boolean((ch.voice_profile as Record<string, unknown>)?.synthetic ?? true) })),
    steps: steps.map((st) => ({
      id: st.id,
      order: st.sort_order,
      type: st.step_type,
      lessonType: st.lesson_type,
      // Authored source-language instruction first (§2.1/§10.1); the catalog label only when no overlay exists.
      instruction: localization?.instructions?.trim() ? localization.instructions : stepTypeLabel(st.step_type),
      // `mission_steps.hint_scaffold` carries no language (it is a realisation-time draft); only the overlay's
      // hints are ever shown for a source language.
      hints: localization?.hints ?? [],
      expressions: st.target_expression_ids.map((id) => expressionById.get(id)).filter((e): e is MissionExpression => e !== undefined),
      promptAssets: st.prompt_asset_ids.map((id) => assetById.get(id)).filter((a): a is MediaAssetPublicRow => a !== undefined).map((a) => mediaAssetToRef(a)),
      visuals: [],
      validIntentIds: st.valid_intent_ids.map((id) => intentKeyById.get(id) ?? id),
      successConditions: (st.success_conditions as Record<string, unknown>) ?? {},
      branching: (st.branching as Record<string, unknown> | null) ?? null,
      estimatedSeconds: st.estimated_seconds,
      offlineCapable: st.offline_capable,
    })),
    narrative: (mission.narrative_segment as Record<string, unknown> | null) ?? null,
  });
}

const OBSERVATION_BY_STEP: Record<MissionStepType, ObservationType> = {
  context_listening: 'listening_comprehension',
  modeled_expression: 'spoken_production',
  anticipation: 'spoken_production',
  listen_identify: 'listening_comprehension',
  shadowing: 'spoken_production',
  comprehension_check: 'listening_comprehension',
  pronunciation_drill: 'spoken_production',
  character_conversation: 'semantic_success',
  story_branch: 'semantic_success',
  feedback_retry: 'spoken_production',
  review_recall: 'retention',
  script_support: 'listening_comprehension',
};

const autonomyFor = (r: StepResult): AutonomyLevel => (r.attemptedBeforeReveal === false ? 'revealed' : r.hintsUsed === 0 ? 'unaided' : r.hintsUsed === 1 ? 'hinted' : 'heavily_hinted');

/**
 * Bumped 2026-10-20: observations only for steps with server evidence, at the credited (never the claimed) outcome
 * (`.2`: choice steps no longer write any).
 */
export const DETERMINISTIC_SCORER_VERSION = 'mission-rubric@2026-10-20.2';

/** One evaluation decision, before anything is recorded or paid. */
interface AttemptDecision {
  decision: StoredMissionEvaluation;
  /** The `mission_attempts.evaluation` document (its `credit` block is what the settlement claims and counts). */
  evaluation: Record<string, unknown>;
  objectivesCompleted: string[];
  /** Deterministic observations of the credited speaking steps. */
  observations: SkillObservationInput[];
}

export function registerMissionRoutes(define: DefineRoute): void {
  define('missionDetail', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const query = parseQuery(c, MissionDetailQuerySchema);
    const s = c.get('services')!;
    if (query.enrollmentId) {
      const enrollment = await loadOwnedEnrollment(s.requireUser().db, query.enrollmentId);
      if (enrollment.source_language_code !== query.source) throw problem.validation(`Enrollment ${enrollment.id} learns from ${enrollment.source_language_code}; requested source ${query.source}`);
    }
    return respondOk(c, await buildMissionDetail(s, id, query.source));
  });

  define('missionAttemptCreate', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, MissionAttemptCreateRequestSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    const mission = await repos.curriculum.getMission(id);
    if (!mission) throw problem.notFound('Mission');
    if (mission.target_variety_id !== varietyOf(enrollment)) throw problem.validation('This mission belongs to a different course variety');
    const existing = await db.from('mission_attempts').select('*').eq('client_attempt_id', body.clientAttemptId).maybeSingle();
    if (existing.data) return respondOk(c, MissionAttemptCreateResponseSchema.parse({ attemptId: existing.data.id, missionId: existing.data.mission_id, replayed: true, startedAt: existing.data.started_at }));
    const row = await repos.progress.startAttempt({ user_id: principal.userId, enrollment_id: enrollment.id, mission_id: mission.id, mission_revision: body.missionRevision, client_attempt_id: body.clientAttemptId, started_at: body.startedAt });
    await repos.enrollments.setActiveMission(enrollment.id, mission.id).catch(() => undefined);
    return respondOk(c, MissionAttemptCreateResponseSchema.parse({ attemptId: row.id, missionId: row.mission_id, replayed: false, startedAt: row.started_at }), 201);
  });

  define('missionEvaluate', { timeoutMs: 40_000 }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, MissionEvaluateBoundedSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    const attempt = await repos.progress.getAttempt(body.attemptId);
    if (!attempt || attempt.mission_id !== id) throw problem.notFound('Attempt');
    if (attempt.enrollment_id !== enrollment.id) throw problem.forbidden('Attempt belongs to another enrollment');
    const bundle = await repos.curriculum.getMissionBundle(id, enrollment.source_language_code);
    if (!bundle) throw problem.notFound('Mission');
    // Never across a variety boundary. The attempts route checks it, but RLS lets the learner insert an open attempt row
    // (offline-first) and rewrite an open one's mission_id, so the attempt row proves nothing about the course.
    if (bundle.mission.target_variety_id !== varietyOf(enrollment)) throw problem.validation('This mission belongs to a different course variety');
    const now = new Date().toISOString();
    const stepById = new Map(bundle.steps.map((st) => [st.id, st]));
    for (const r of body.stepResults) if (!stepById.has(r.stepId)) throw problem.validation(`Step ${r.stepId} is not part of this mission`);
    const goals = goalsOf(bundle.mission);
    const goalSkills = [...new Set(goals.flatMap((g) => g.skill_keys ?? []))];
    const results = latestResults(body.stepResults);

    // Conversation sessions referenced by step results must be the learner's own (RLS read) and from this course. The
    // row itself is learner-writable (RLS full CRUD): its stored evaluator output is only a claim, and it counts only as
    // far as the evaluator's own rows for that session back it (`loadMissionEvidence`, `corroboratedSessionOutput`).
    const sessionIds = [...new Set(body.stepResults.map((r) => r.conversationSessionId).filter((v): v is string => v !== null))];
    const sessions = sessionIds.length ? ((await db.from('conversation_sessions').select('id, rubric_outcomes, enrollment_id, mission_id').in('id', sessionIds)).data ?? []) : [];
    if (sessions.length !== sessionIds.length) throw problem.forbidden('A referenced conversation session is not yours');
    if (sessions.some((sess) => sess.enrollment_id !== enrollment.id)) throw problem.forbidden('A referenced conversation session belongs to another course');

    // A completed attempt with a stored decision is replayed as stored (never re-decided, never re-awarded).
    let decision: StoredMissionEvaluation | null = attempt.completed_at ? storedMissionEvaluation(attempt.evaluation) : null;
    let replayed = decision !== null;
    let completedAttempt: Row<'mission_attempts'> = attempt;
    let changes: MasteryChange[] = [];
    let masteryRows: Row<'user_skill_mastery'>[] = [];
    if (!decision) {
      const specs = stepSpecsOf(bundle.steps, new Set(bundle.expressions.map((e) => e.id)));
      const specById = new Map(specs.map((sp) => [sp.id, sp]));
      const resultById = new Map(results.map((r) => [r.stepId, r]));
      const claimedOutputs = new Map(sessions.flatMap((sess) => {
        const output = sess.mission_id === bundle.mission.id ? parseSessionOutput(sess.rubric_outcomes) : null;
        return output ? [[sess.id, output] as const] : [];
      }));
      const evidence = await loadMissionEvidence(s, { userId: principal.userId, enrollmentId: enrollment.id, missionId: bundle.mission.id, attempt, now: new Date(now) }, body.stepResults);

      const decide = (ev: MissionEvidence): AttemptDecision => {
        // 1. Server evidence → credit per step (lib/xp-credit.ts). A session is usable only with evaluator rows.
        const usableSessions = new Map(sessions.map((sess) => [sess.id, claimedOutputs.has(sess.id) && (ev.sessions.get(sess.id)?.length ?? 0) > 0]));
        const credit = decideMissionCredit({ specs, results, pool: ev.pool, claimed: ev.claimed, sessions: usableSessions });
        const creditedSessionIds = [...new Set(credit.steps.filter((cr) => cr.evidence === 'conversation_evaluator').flatMap((cr) => cr.evidenceIds))];
        const sessionEvaluations = creditedSessionIds.map((sid) => corroboratedSessionOutput(claimedOutputs.get(sid)!, ev.sessions.get(sid) ?? [], goals));

        // 2. Deterministic observations for credited speaking steps only (conversation steps: the evaluator's own).
        const observations: SkillObservationInput[] = [];
        for (const cr of credit.steps) {
          if (cr.creditedOutcome === null) continue;
          const step = stepById.get(cr.stepId)!;
          const r = resultById.get(cr.stepId)!;
          const skills = goalSkills.length ? goalSkills : ['general.participation'];
          for (const skillKey of skills.slice(0, 3)) {
            observations.push({
              enrollmentId: enrollment.id,
              skillKey,
              observationType: OBSERVATION_BY_STEP[step.step_type as MissionStepType],
              scenarioId: bundle.mission.template_key ?? bundle.mission.id,
              missionId: bundle.mission.id,
              missionAttemptId: attempt.id,
              conversationSessionId: null,
              expressionId: specById.get(cr.stepId)?.expressionId ?? step.target_expression_ids[0] ?? null,
              autonomy: autonomyFor(r),
              hintsUsed: r.hintsUsed,
              outcome: cr.creditedOutcome,
              utteranceConfidence: cr.utteranceConfidence,
              scorerKind: 'deterministic',
              scorerVersion: DETERMINISTIC_SCORER_VERSION,
              uncertainty: cr.creditedOutcome === 'unclear' ? 0.8 : 0.3,
              observedAt: body.completedAt,
              note: null,
            });
          }
        }

        // 3. Objectives: the sessions' corroborated evaluator output, or ≥ 80 % of the mission's gradable (speaking)
        //    steps credited as success.
        const successRatio = credit.gradableSteps ? credit.creditedSuccesses / credit.gradableSteps : 0;
        const hasConversation = bundle.steps.some((st) => st.step_type === 'character_conversation');
        const reportedObjectives = new Set(sessionEvaluations.flatMap((e) => e.objectivesCompleted));
        if (!hasConversation || sessionEvaluations.length === 0) {
          if (successRatio >= 0.8) for (const g of goals) reportedObjectives.add(g.id);
        }
        const evaluatorRan = sessionEvaluations.length > 0;
        // Only evaluators that reported a figure count; a session whose evaluator ran but reported none stays null.
        const reportedConfidences = sessionEvaluations.map((e) => e.confidence).filter((v): v is number => typeof v === 'number');
        const merged: EvaluatorOutput = {
          objectivesCompleted: [...reportedObjectives],
          skillsExercised: [...new Set([...goalSkills, ...sessionEvaluations.flatMap((e) => e.skillsExercised)])],
          observations: sessionEvaluations.flatMap((e) => e.observations),
          priorityCorrections: sessionEvaluations.flatMap((e) => e.priorityCorrections).slice(0, 2),
          summary: sessionEvaluations.map((e) => e.summary).join(' ').slice(0, 1500),
          reviewTriggers: [...new Set(sessionEvaluations.flatMap((e) => e.reviewTriggers))],
          relationshipMemoryUpdate: sessionEvaluations.find((e) => e.relationshipMemoryUpdate)?.relationshipMemoryUpdate ?? null,
          // No evaluator ⇒ no confidence figure: the deterministic rubric only knows step outcomes (§16.3).
          confidence: evaluatorRan && reportedConfidences.length ? Math.min(...reportedConfidences) : null,
        };
        const rubric = evaluateMissionObjectives({ objectives: goals.map((g) => ({ id: g.id, intentKeys: [], skillKeys: g.skill_keys ?? [], required: true })) }, merged);
        const missionCredited = rubric.outcome !== 'fail' && hasPositiveEvidence(credit.steps);
        const storedCredit: StoredMissionCredit = { version: MISSION_CREDIT_VERSION, missionCredited, withoutHints: results.every((r) => r.hintsUsed === 0), gradableSteps: credit.gradableSteps, creditedSuccesses: credit.creditedSuccesses, steps: credit.steps, missionId: bundle.mission.id, enrollmentId: enrollment.id };
        return {
          decision: { evaluator: merged, evaluatorRan, rubricOutcome: rubric.outcome, credit: storedCredit },
          evaluation: { rubric: { ...rubric, confidence: merged.confidence }, evaluator: merged, evaluatorRan, credit: storedCredit },
          objectivesCompleted: rubric.objectives.filter((o) => o.completed).map((o) => o.id),
          observations,
        };
      };
      // 4. Settle the decision in the database (`complete_mission_attempt`): claim its evidence, store it, count the
      //    completion, in one transaction. `step_results` keeps the client's claims. An id another attempt holds comes
      //    back contested and the decision is re-made without it (it only ever loses rows). The attempt's stored
      //    evaluation as read above is the compare-and-set value: if another evaluation stored a decision since, that
      //    one is replayed.
      const seenEvaluation = (attempt.evaluation ?? null) as Json | null;
      const dropped = new Set<string>();
      for (let round = 0; decision === null; round += 1) {
        if (round === MAX_SETTLE_ROUNDS) throw problem.conflict('This attempt\'s evidence is being used by another evaluation; retry shortly');
        const decided = decide(withoutEvidence(evidence, dropped));
        const settled = await settleMissionDecision(s, {
          userId: principal.userId,
          attemptId: attempt.id,
          enrollmentId: enrollment.id,
          missionId: bundle.mission.id,
          completedAt: body.completedAt,
          stepResults: body.stepResults as unknown as Json,
          objectivesCompleted: decided.objectivesCompleted,
          evaluation: decided.evaluation as unknown as Json,
          currentStepIndex: body.stepResults.length,
          seenEvaluation,
        });
        if (settled.outcome === 'contested') {
          s.log.warn('mission.evidence_contested', { missionId: id, attemptId: attempt.id, round, contested: settled.contestedIds.length });
          for (const eid of settled.contestedIds) dropped.add(eid);
          continue;
        }
        completedAttempt = settled.attempt;
        if (settled.outcome === 'already_decided') {
          // Another evaluation of this same attempt stored its decision first: replay what it decided.
          decision = storedMissionEvaluation(settled.attempt.evaluation);
          if (!decision) throw problem.conflict('This attempt is being evaluated; retry shortly');
          replayed = true;
          break;
        }
        decision = decided.decision;
        // 5. Observations → mastery (credited steps only), once: only the evaluation that stored the decision.
        ({ changes, masteryRows } = await recordObservations(s, enrollment, decided.observations, now));
      }
    }
    if (!decision) throw problem.conflict('This attempt is being evaluated; retry shortly');
    // A replayed decision pays, completes and schedules only where it was made: a completed attempt whose mission_id or
    // enrollment_id the learner rewrote since (RLS owner_update; the guard trigger refuses it since migration 161)
    // completes no other mission or course. Nothing has been written by this request yet.
    if (replayed && !decisionMadeFor(decision.credit, { missionId: bundle.mission.id, enrollmentId: enrollment.id, stepIds: new Set(stepById.keys()) })) {
      throw problem.conflict('This attempt was completed for another mission or course');
    }
    // Attempts evaluated before server-side credit carry no decision: their rubric outcome stands, as it did then.
    const missionCredited = decision.credit ? decision.credit.missionCredited : decision.rubricOutcome !== 'fail';
    const withoutHints = decision.credit ? decision.credit.withoutHints : results.every((r) => r.hintsUsed === 0);
    const completedAt = completedAttempt.completed_at ?? body.completedAt;

    // 6. XP: mission completion (idempotent on clientEventId + attempt reference) and mastery advances. `xpAwarded`
    //    is the sum of what THIS call wrote to `xp_ledger` (`XP_AMOUNTS` canonical amounts), achievements included below.
    const xp: XpAwardResult = missionCredited ? await awardXp(s, { idempotencyKey: body.clientEventId, userId: principal.userId, enrollmentId: enrollment.id, reason: 'mission_completed', referenceTable: 'mission_attempts', referenceId: completedAttempt.id, occurredAt: completedAt }) : { applied: false, amount: 0, totalXp: 0, rejectedReason: 'mission_not_credited' };
    // Mastery may move on any credited step (a real graded take), but XP of any kind needs a credited mission.
    const advanceXp = missionCredited ? await awardMasteryAdvances(s, enrollment, changes, masteryRows, body.clientEventId) : 0;
    let xpAwarded = xp.amount + advanceXp;

    // 7. Mission progress: always completed for navigation; completions only count credited attempts. The evaluation
    //    that stored the decision recorded the completion in the same transaction (`complete_mission_attempt`:
    //    `completions = completions + 1`, once per credited attempt). A replay never counts and never rewrites the row:
    //    it only inserts one that is missing, uncounted, for the mission and enrollment the decision was made for (checked
    //    above). Since migration 161 the settlement always writes that row, so this inserts only for a decision stored
    //    before it, or after the row was removed.
    if (replayed) {
      const ins = await s.service.from('mission_progress').upsert(
        {
          user_id: principal.userId,
          enrollment_id: enrollment.id,
          mission_id: bundle.mission.id,
          status: 'completed',
          best_attempt_id: missionCredited ? completedAttempt.id : null,
          completions: 0,
          completed_without_hints: missionCredited && withoutHints,
          first_completed_at: missionCredited ? completedAt : null,
          last_completed_at: completedAt,
        },
        { onConflict: 'enrollment_id,mission_id', ignoreDuplicates: true },
      );
      if (ins.error) throw new DbError(ins.error, 'missions.progress_replay');
    }

    // 8. Achievements (and their XP), from credited completions only (navigation-only completions have
    //    `completions = 0`), unlocked on a credited evaluation; the next credited one catches up on anything missed.
    const masteryAll = await s.repos.progress.listMastery(enrollment.id);
    const masteryBySkill = new Map(masteryAll.map((m) => [m.skill_key, m.mastery_state as MasteryState]));
    const completedProgress = (await s.repos.progress.listMissionProgress(enrollment.id)).filter((p) => p.status === 'completed');
    const creditedProgress = completedProgress.filter((p) => p.completions > 0);
    const earned = !missionCredited ? [] : earnedAchievements({ masteryBySkill, missionsCompleted: creditedProgress.reduce((n, p) => n + p.completions, 0), missionsCompletedWithoutHints: creditedProgress.filter((p) => p.completed_without_hints).length, distinctMissionsCompleted: creditedProgress.length });
    const existingAchievements = await s.repos.progress.listAchievements(principal.userId);
    const have = new Set(existingAchievements.map((a) => a.achievement_key));
    const unlocked: string[] = [];
    for (const key of earned) {
      if (have.has(key)) continue;
      const ins = await s.service.from('user_achievements').insert({ user_id: principal.userId, enrollment_id: enrollment.id, achievement_key: key, client_event_id: uuidFrom(`${body.clientEventId}:achievement:${key}`), evidence: { attemptId: completedAttempt.id } }).select('*').maybeSingle();
      if (ins.error) {
        if (ins.error.code !== '23505') throw new DbError(ins.error, 'achievements.insert');
        continue;
      }
      if (ins.data) {
        unlocked.push(key);
        const achievementXp = await awardXp(s, { idempotencyKey: uuidFrom(`${body.clientEventId}:achievement_xp:${key}`), userId: principal.userId, enrollmentId: enrollment.id, reason: 'achievement', referenceTable: 'user_achievements', referenceId: ins.data.id });
        xpAwarded += achievementXp.amount;
      }
    }
    if (xpAwarded > 0) await s.repos.progress.updateAttempt(attempt.id, { xp_awarded: (completedAttempt.xp_awarded ?? 0) + xpAwarded }).catch(() => undefined);

    // 9. Review scheduling (expressions practised + evaluator review triggers), for a credited mission only.
    const reviewTriggers = [...new Set(decision.evaluator.reviewTriggers)];
    const scheduled = missionCredited ? await scheduleReviews(s, enrollment, [...bundle.expressions.map((e) => ({ kind: 'expression' as const, id: e.id })), ...reviewTriggers.map((k) => ({ kind: 'skill' as const, id: k }))], now, withoutHints ? 'good' : 'hard') : [];

    // 10. Next mission from the planner (same chapter, unlocked by prerequisites; a navigation-only completion counts).
    const siblings = bundle.mission.chapter_id ? await repos.curriculum.listMissions(bundle.mission.chapter_id) : [];
    const plannerMissions: PlannerMission[] = siblings.map((m) => {
      const prog = completedProgress.find((p) => p.mission_id === m.id);
      return { missionId: m.id, blueprintKey: m.template_key ?? m.id, type: m.mission_type as MissionType, level: m.level as LearnerLevel, skillKeys: [...new Set(goalsOf(m).flatMap((g) => g.skill_keys ?? []))], prerequisiteSkillKeys: m.prerequisite_skill_keys, sortOrder: m.sort_order, estimatedMinutes: Number(m.recommended_minutes), completed: Boolean(prog), completedWithoutHints: prog?.completed_without_hints ?? false, lastCompletedAt: prog?.last_completed_at ?? null };
    });
    const cards = (await s.repos.progress.getDueReviews(enrollment.id, 50)).map(reviewRowToCard);
    const plan = plannerMissions.length
      ? planSession({ now, enrollmentId: enrollment.id, scheduler, cards, masteries: masteryAll.map((m) => ({ skillKey: m.skill_key, masteryState: m.mastery_state as MasteryState, internalScore: m.internal_score, evidenceCount: m.evidence_count })), missions: plannerMissions, pace: enrollment.preferred_learning_speed as LearningSpeed, learnerLevel: enrollment.learner_level as LearnerLevel })
      : null;

    const creditedSteps = decision.credit?.steps.filter((st) => st.evidence !== 'none').length ?? null;
    s.log.info('mission.evaluated', { missionId: id, attemptId: attempt.id, outcome: decision.rubricOutcome, missionCredited, creditedSteps, xpAwarded, replayed });
    return respondOk(
      c,
      MissionEvaluateApiResponseSchema.parse({
        attemptId: completedAttempt.id,
        evaluation: decision.evaluator,
        evaluatorRan: decision.evaluatorRan,
        xpAwarded,
        xpReplayed: replayed || (missionCredited && !xp.applied && xp.rejectedReason === null),
        masteryChanges: changes,
        scheduledReviews: scheduled,
        achievementsUnlocked: unlocked,
        nextMissionId: plan?.nextMissionId ?? null,
        credit: { missionCredited, steps: (decision.credit?.steps ?? []).map((st) => ({ stepId: st.stepId, evidence: st.evidence, creditedOutcome: st.creditedOutcome })) },
      }),
    );
  });
}
