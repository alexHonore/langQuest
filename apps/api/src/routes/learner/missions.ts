/**
 * §6.1 missions: localized detail (`?source=`), attempt creation (idempotent on `clientAttemptId`) and
 * evaluation. Evaluation combines the deterministic step rubric with the evaluator output recorded by the
 * conversation sessions referenced in the step results (A11: semantic paraphrase accepted, never exact phrase);
 * it then writes observations → mastery → XP (via `award_xp`, server-validated) → review cards → achievements
 * with the service client, strictly AFTER the attempt and enrollment were validated as the learner's own.
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
  type ObservationType,
  type SkillObservationInput,
  type StepResult,
} from '@langquest/contracts';
import { earnedAchievements } from '@langquest/curriculum/rubric/xp';
import { evaluateMissionObjectives } from '@langquest/curriculum/rubric/rubric';
import { planSession, type PlannerMission } from '@langquest/curriculum/planner/planner';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sourceLanguageTranslator } from '@langquest/locales';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { MEDIA_ASSET_COLUMNS, mediaAssetToRef, reviewRowToCard, type MediaAssetPublicRow } from '../../lib/dto';
import { loadOwnedEnrollment, varietyOf } from '../../lib/enrollment';
import { awardMasteryAdvances, awardXp, recordObservations, scheduleReviews, scheduler, uuidFrom } from '../../lib/learning';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });

interface Goal {
  id: string;
  skill_keys: string[];
  description_key?: string;
  description?: string;
}
const goalsOf = (mission: Row<'missions'>): Goal[] => (Array.isArray(mission.goals) ? (mission.goals as unknown as Goal[]) : []).filter((g) => typeof g?.id === 'string');

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
  const localizationComplete = localization !== null && (localization.qa_state === 'reviewed' || localization.qa_state === 'approved') && translationsComplete;

  return MissionDetailResponseSchema.parse({
    id: mission.id,
    revision: mission.published_revision ?? 0,
    type: mission.mission_type,
    title: localization?.title ?? ((mission.title_translations as Record<string, string> | null)?.[source] ?? ''),
    level: mission.level,
    targetVarietyId: mission.target_variety_id,
    sourceLanguageCode: source,
    localizationComplete,
    goals: goalsOf(mission).map((g) => ({ id: g.id, description: g.description_key && t.translator.has(g.description_key) ? t.translator.t(g.description_key) : (g.description ?? ''), skillKeys: g.skill_keys ?? [] })),
    recommendedMinutes: Number(mission.recommended_minutes),
    sceneArt: null,
    characters: characters.map((ch) => ({ id: ch.id, name: ch.name, role: ch.role, portrait: null, syntheticVoice: Boolean((ch.voice_profile as Record<string, unknown>)?.synthetic ?? true) })),
    steps: steps.map((st) => ({
      id: st.id,
      order: st.sort_order,
      type: st.step_type,
      lessonType: st.lesson_type,
      instruction: t.translator.has(`lesson.stepTypes.${st.step_type}`) ? t.translator.t(`lesson.stepTypes.${st.step_type}`) : (localization?.instructions ?? ''),
      hints: [...(localization?.hints ?? []), ...st.hint_scaffold],
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

export const DETERMINISTIC_SCORER_VERSION = 'mission-rubric@2026-10-14.1';

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
    const body = await parseBody(c, MissionEvaluateRequestSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    const attempt = await repos.progress.getAttempt(body.attemptId);
    if (!attempt || attempt.mission_id !== id) throw problem.notFound('Attempt');
    if (attempt.enrollment_id !== enrollment.id) throw problem.forbidden('Attempt belongs to another enrollment');
    const bundle = await repos.curriculum.getMissionBundle(id, enrollment.source_language_code);
    if (!bundle) throw problem.notFound('Mission');
    const now = new Date().toISOString();
    const stepById = new Map(bundle.steps.map((st) => [st.id, st]));
    for (const r of body.stepResults) if (!stepById.has(r.stepId)) throw problem.validation(`Step ${r.stepId} is not part of this mission`);
    const goals = goalsOf(bundle.mission);
    const goalSkills = [...new Set(goals.flatMap((g) => g.skill_keys ?? []))];

    // Conversation sessions referenced by step results must be the learner's own (RLS read) and finished.
    const sessionIds = [...new Set(body.stepResults.map((r) => r.conversationSessionId).filter((v): v is string => v !== null))];
    const sessions = sessionIds.length ? ((await db.from('conversation_sessions').select('id, rubric_outcomes, objectives_completed, enrollment_id').in('id', sessionIds)).data ?? []) : [];
    if (sessions.length !== sessionIds.length) throw problem.forbidden('A referenced conversation session is not yours');
    const sessionEvaluations = sessions.map((sess) => (sess.rubric_outcomes as EvaluatorOutput | null) ?? null).filter((e): e is EvaluatorOutput => e !== null);

    // Deterministic step observations (conversation steps are evidenced by their session's evaluator output).
    const observations: SkillObservationInput[] = [];
    for (const r of body.stepResults) {
      const step = stepById.get(r.stepId)!;
      if (step.step_type === 'character_conversation' && r.conversationSessionId) continue;
      const skills = goalSkills.length ? goalSkills : ['general.participation'];
      for (const skillKey of skills.slice(0, 3)) {
        observations.push({
          enrollmentId: enrollment.id,
          skillKey,
          observationType: OBSERVATION_BY_STEP[step.step_type as MissionStepType],
          scenarioId: bundle.mission.template_key ?? bundle.mission.id,
          missionId: bundle.mission.id,
          missionAttemptId: attempt.id,
          conversationSessionId: r.conversationSessionId,
          expressionId: step.target_expression_ids[0] ?? null,
          autonomy: autonomyFor(r),
          hintsUsed: r.hintsUsed,
          outcome: r.outcome,
          utteranceConfidence: null,
          scorerKind: 'deterministic',
          scorerVersion: DETERMINISTIC_SCORER_VERSION,
          uncertainty: r.outcome === 'unclear' ? 0.8 : 0.3,
          observedAt: body.completedAt,
          note: null,
        });
      }
    }

    const successCount = body.stepResults.filter((r) => r.outcome === 'success').length;
    const successRatio = body.stepResults.length ? successCount / body.stepResults.length : 0;
    const hasConversation = bundle.steps.some((st) => st.step_type === 'character_conversation');
    const reportedObjectives = new Set(sessionEvaluations.flatMap((e) => e.objectivesCompleted));
    if (!hasConversation || sessionEvaluations.length === 0) {
      if (successRatio >= 0.8) for (const g of goals) reportedObjectives.add(g.id);
    }
    const merged: EvaluatorOutput = {
      objectivesCompleted: [...reportedObjectives],
      skillsExercised: [...new Set([...goalSkills, ...sessionEvaluations.flatMap((e) => e.skillsExercised)])],
      observations: sessionEvaluations.flatMap((e) => e.observations),
      priorityCorrections: sessionEvaluations.flatMap((e) => e.priorityCorrections).slice(0, 2),
      summary: sessionEvaluations.map((e) => e.summary).join(' ').slice(0, 1500),
      reviewTriggers: [...new Set(sessionEvaluations.flatMap((e) => e.reviewTriggers))],
      relationshipMemoryUpdate: sessionEvaluations.find((e) => e.relationshipMemoryUpdate)?.relationshipMemoryUpdate ?? null,
      confidence: sessionEvaluations.length ? Math.min(...sessionEvaluations.map((e) => e.confidence)) : successRatio >= 0.8 ? 0.7 : 0.5,
    };
    const rubric = evaluateMissionObjectives({ objectives: goals.map((g) => ({ id: g.id, intentKeys: [], skillKeys: g.skill_keys ?? [], required: true })) }, merged);

    // 1. Attempt outcome (service role: these columns are server-decided).
    const alreadyCompleted = attempt.completed_at !== null;
    const completedAttempt = await s.repos.progress.updateAttempt(attempt.id, {
      completed_at: attempt.completed_at ?? body.completedAt,
      step_results: body.stepResults as unknown as Row<'mission_attempts'>['step_results'],
      objectives_completed: rubric.objectives.filter((o) => o.completed).map((o) => o.id),
      evaluation: { rubric, evaluator: merged } as unknown as Row<'mission_attempts'>['evaluation'],
      current_step_index: body.stepResults.length,
    });

    // 2. Observations → mastery (skip when replaying an already-completed attempt to avoid double evidence).
    const { changes, masteryRows } = alreadyCompleted ? { changes: [], masteryRows: [] } : await recordObservations(s, enrollment, observations, now);

    // 3. XP: mission completion (idempotent on clientEventId + attempt reference) and mastery advances.
    const xp = rubric.outcome === 'fail' ? { applied: false, amount: 0, totalXp: 0, rejectedReason: 'mission_not_passed' } : await awardXp(s, { idempotencyKey: body.clientEventId, userId: principal.userId, enrollmentId: enrollment.id, reason: 'mission_completed', referenceTable: 'mission_attempts', referenceId: completedAttempt.id, occurredAt: body.completedAt });
    const advanceXp = await awardMasteryAdvances(s, enrollment, changes, masteryRows, body.clientEventId);
    const xpAwarded = xp.amount + advanceXp;
    if (xpAwarded > 0) await s.repos.progress.updateAttempt(attempt.id, { xp_awarded: (completedAttempt.xp_awarded ?? 0) + xpAwarded }).catch(() => undefined);

    // 4. Mission progress + achievements.
    const progressRows = await s.repos.progress.listMissionProgress(enrollment.id);
    const prevProgress = progressRows.find((p) => p.mission_id === bundle.mission.id);
    const withoutHints = body.stepResults.every((r) => r.hintsUsed === 0);
    if (rubric.outcome !== 'fail') {
      await s.repos.progress.upsertMissionProgress({
        user_id: principal.userId,
        enrollment_id: enrollment.id,
        mission_id: bundle.mission.id,
        status: 'completed',
        best_attempt_id: completedAttempt.id,
        completions: (prevProgress?.completions ?? 0) + (alreadyCompleted ? 0 : 1),
        completed_without_hints: Boolean(prevProgress?.completed_without_hints) || withoutHints,
        first_completed_at: prevProgress?.first_completed_at ?? body.completedAt,
        last_completed_at: body.completedAt,
      });
    }
    const masteryAll = await s.repos.progress.listMastery(enrollment.id);
    const masteryBySkill = new Map(masteryAll.map((m) => [m.skill_key, m.mastery_state as MasteryState]));
    const completedProgress = (await s.repos.progress.listMissionProgress(enrollment.id)).filter((p) => p.status === 'completed');
    const earned = earnedAchievements({ masteryBySkill, missionsCompleted: completedProgress.reduce((n, p) => n + p.completions, 0), missionsCompletedWithoutHints: completedProgress.filter((p) => p.completed_without_hints).length, distinctMissionsCompleted: completedProgress.length });
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
        await awardXp(s, { idempotencyKey: uuidFrom(`${body.clientEventId}:achievement_xp:${key}`), userId: principal.userId, enrollmentId: enrollment.id, reason: 'achievement', referenceTable: 'user_achievements', referenceId: ins.data.id });
      }
    }

    // 5. Review scheduling (expressions practised + evaluator review triggers).
    const scheduled = rubric.outcome === 'fail' ? [] : await scheduleReviews(s, enrollment, [...bundle.expressions.map((e) => ({ kind: 'expression' as const, id: e.id })), ...rubric.reviewTriggers.map((k) => ({ kind: 'skill' as const, id: k }))], now, withoutHints ? 'good' : 'hard');

    // 6. Next mission from the planner (same chapter, unlocked by prerequisites).
    const siblings = bundle.mission.chapter_id ? await repos.curriculum.listMissions(bundle.mission.chapter_id) : [];
    const plannerMissions: PlannerMission[] = siblings.map((m) => {
      const prog = completedProgress.find((p) => p.mission_id === m.id);
      return { missionId: m.id, blueprintKey: m.template_key ?? m.id, type: m.mission_type as MissionType, level: m.level as LearnerLevel, skillKeys: [...new Set(goalsOf(m).flatMap((g) => g.skill_keys ?? []))], prerequisiteSkillKeys: m.prerequisite_skill_keys, sortOrder: m.sort_order, estimatedMinutes: Number(m.recommended_minutes), completed: Boolean(prog), completedWithoutHints: prog?.completed_without_hints ?? false, lastCompletedAt: prog?.last_completed_at ?? null };
    });
    const cards = (await s.repos.progress.getDueReviews(enrollment.id, 50)).map(reviewRowToCard);
    const plan = plannerMissions.length
      ? planSession({ now, enrollmentId: enrollment.id, scheduler, cards, masteries: masteryAll.map((m) => ({ skillKey: m.skill_key, masteryState: m.mastery_state as MasteryState, internalScore: m.internal_score, evidenceCount: m.evidence_count })), missions: plannerMissions, pace: enrollment.preferred_learning_speed as LearningSpeed, learnerLevel: enrollment.learner_level as LearnerLevel })
      : null;

    s.log.info('mission.evaluated', { missionId: id, attemptId: attempt.id, outcome: rubric.outcome, xpAwarded, replayed: alreadyCompleted });
    return respondOk(
      c,
      MissionEvaluateResponseSchema.parse({
        attemptId: completedAttempt.id,
        evaluation: merged,
        xpAwarded,
        xpReplayed: alreadyCompleted || (!xp.applied && xp.rejectedReason === null && rubric.outcome !== 'fail'),
        masteryChanges: changes,
        scheduledReviews: scheduled,
        achievementsUnlocked: unlocked,
        nextMissionId: plan?.nextMissionId ?? null,
      }),
    );
  });
}
