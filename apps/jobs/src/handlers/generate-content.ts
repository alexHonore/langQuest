/**
 * `generate_content` — the content factory (§9.8): mission brief + communicative intents → constrained
 * structured generation in the target variety (`content_factory` role, `content_generation` task) →
 * syntactic / semantic / rubric validators (language guard, intent + register rules, length) → draft
 * `missions` / `mission_localizations` / `expressions` / `expression_forms` / `expression_translations`
 * rows in `review_needed` with provenance (model task, prompt version, trace id, job id). Rejected lines are
 * reported, never stored. Drafts carry `nativeReviewed: false` and can only be published by an editor
 * after native review and rights approval (publication gate lives in the API).
 *
 * `missions.goals` is written in the shape the API publish gate and learner routes read (§10.1,
 * `apps/api/src/lib/goals.ts`): `{ id, skill_keys, description: { [sourceLanguage]: text } }` per accepted
 * objective, the id being the intent key and the description the model's learner-facing goal text in the
 * SOURCE language. An objective the model gave no description for gets no `description` at all (never a
 * bare string or a text of unknown language), so the gate blocks publishing until an editor adds one; such
 * goals are listed on the job output as `goalsWithoutDescription`.
 *
 * Diversity gate (§9.8 "diverse dialogues, not a rigid one-correct-answer quiz", R-9.8-02), the same metric the
 * scripts content factory applies to chapters and fixture suites (`scoreDialogueDiversity`, `@langquest/curriculum`):
 * - per mission (`MISSION_DIVERSITY_THRESHOLDS`): the accepted learner phrasings per intent (expression + its
 *   variants) and the mission's own dialogue (a question → answer drill blocks);
 * - per batch (`DEFAULT_DIVERSITY_THRESHOLDS`, two or more drafted missions): the missions' dialogues together
 *   (repeated scripts, one turn structure, no misunderstanding → repair anywhere).
 * A draft that fails either gate is still written as `review_needed` (never dropped, never published) and is marked
 * for regeneration with the reasons: `scoring_rubric.diversity` + `reviewFlags: ['diversity_needs_regeneration']` on
 * the mission, the same flag on its expressions, the audit row and `output.diversityGate`. Regenerating a failing
 * mission once with the gate's reasons costs one extra paid call per mission, so it runs only when the job asks
 * (`regenerateOnLowDiversity: true`), within the job cost ceiling; a retry is kept only when it validates, scores
 * better and actually changes the text (relabelled turns do not count).
 */
import { z } from 'zod';
import type { CourseTrackId, DraftContent, Register, SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { CourseTrackIdSchema, DraftContentSchema, KeySchema, LearnerLevelSchema, RegisterSchema, SourceLanguageCodeSchema, getCourseTrack } from '@langquest/contracts';
import { coachingLanguageInstruction, getPromptPack, varietyGuardInstruction, type GuardResult } from '@langquest/ai';
import { DEFAULT_DIVERSITY_THRESHOLDS, DIALOGUE_TURN_ACTS, MISSION_DIVERSITY_THRESHOLDS, getIntent, isIntentKey, scoreDialogueDiversity, type DialogueSetInput, type DiversityDialogue, type DiversityReport } from '@langquest/curriculum';
import type { Insert } from '@langquest/db';
import { CostCeilingExceeded } from '../cost';
import { JobFailure, type JobHandler } from '../queue/types';
import { jobLanguageContext, keyHash } from './common';

export const CONTENT_FACTORY_PROMPT_VERSION = 'content_factory:v2';

export const GenerateContentParamsSchema = z.object({
  targetTrack: CourseTrackIdSchema,
  sourceLanguage: SourceLanguageCodeSchema,
  intentKeys: z.array(KeySchema).min(1).max(50),
  level: LearnerLevelSchema,
  scene: z.string().max(200).optional(),
  characterId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(20).default(1),
  /** Validate and report only; write nothing. */
  dryRun: z.boolean().default(false),
  /** Re-run a mission that fails the diversity gate once, with the gate's reasons (one extra paid call per such mission). */
  regenerateOnLowDiversity: z.boolean().default(false),
});
export type GenerateContentParams = z.infer<typeof GenerateContentParamsSchema>;

const line = z.object({
  speaker: z.enum(['character', 'learner']),
  intentKey: z.string(),
  targetText: z.string(),
  transliteration: z.string().nullable(),
  sourceMeaning: z.string(),
  register: RegisterSchema,
  /** Conversational function of the turn, read by the diversity gate's repair check (defaults keep v1 output parseable). */
  act: z.enum(DIALOGUE_TURN_ACTS).default('normal'),
});
export const GeneratedExpressionSchema = z.object({
  intentKey: z.string(),
  targetText: z.string(),
  transliteration: z.string().nullable(),
  sourceMeaning: z.string(),
  literalGloss: z.string().nullable(),
  contextNote: z.string().nullable(),
  register: RegisterSchema,
  variants: z.array(z.string()).max(5),
});
export const GeneratedMissionSchema = z.object({
  title: z.string(),
  sceneDescription: z.string(),
  objectiveIntentKeys: z.array(z.string()).min(1),
  /** One learner-facing goal sentence per objective intent, in the SOURCE language (→ `missions.goals[].description`). */
  objectiveDescriptions: z.array(z.object({ intentKey: z.string(), description: z.string() })).max(20).default([]),
  dialogue: z.array(line).min(2).max(16),
  expressions: z.array(GeneratedExpressionSchema).min(1).max(12),
  instructions: z.string(),
  hints: z.array(z.string()).max(5),
});
export const ContentFactoryOutputSchema = z.object({ missions: z.array(GeneratedMissionSchema).min(1).max(20) });
export type GeneratedMission = z.infer<typeof GeneratedMissionSchema>;

export interface ValidationRejection {
  mission: number;
  item: string;
  reason: string;
  text?: string;
}

export function buildContentFactoryPrompt(input: { track: CourseTrackId; variety: VarietyId; source: SourceLanguageCode; level: string; scene: string | null; count: number; intents: Array<{ key: string; description: string; socialMeaning: string | null; politeness: string; typicalMaxWords: number | null; variants: readonly string[] }> }): { system: string; user: string; templateId: string; templateVersion: string } {
  const pack = getPromptPack(input.variety);
  const track = getCourseTrack(input.track);
  const system = [
    'You are the LangQuest content factory. You write short, natural, situational conversation material for adult learners.',
    varietyGuardInstruction(pack, input.source),
    coachingLanguageInstruction(input.source),
    `Script: primary ${track.scripts.primary}${track.scripts.transliterations.length ? `; also give a ${track.scripts.transliterations[0]} transliteration when the script is not Latin` : ''}.`,
    'Each mission: a realistic scene, 2–16 dialogue lines between the character and the learner, 3–12 learner expressions that fulfil the requested intents, plus instructions and hints for the learner in the SOURCE language.',
    'Write how people actually talk in this variety: no textbook stiffness, no overly formal register unless requested, no offensive or insensitive content, nothing that only works as a quiz with one correct answer; give acceptable variants.',
    'Every expression must name the intent it fulfils (intentKey from the brief). Keep expressions within the typical length for the intent.',
    'Give each expression real alternatives in "variants": different words or structures a learner could also say, not punctuation, spelling or one-word swaps of the same sentence.',
    `Write conversations, not quizzes: vary who opens, let the learner ask questions too, allow two turns in a row by the same speaker, and make the dialogues of different missions differ in words and structure. In at least one mission out of three, one speaker misunderstands and the other repairs it. Label every dialogue line with "act": ${DIALOGUE_TURN_ACTS.join(' | ')} ("misunderstanding" for the turn that shows it, "repair" for the turn that fixes it, otherwise "normal").`,
    'For every objective intent (objectiveIntentKeys) also give one objectiveDescriptions entry: a single learner-facing sentence in the SOURCE language saying what the learner will manage to do (e.g. "Order a coffee politely").',
    'Output JSON only. Target text must be in the target variety; sourceMeaning, title, objectiveDescriptions, instructions and hints must be in the source language.',
  ].join('\n');
  const user = JSON.stringify({ level: input.level, scene: input.scene, missionCount: input.count, intents: input.intents });
  return { system, user, templateId: 'content_factory', templateVersion: CONTENT_FACTORY_PROMPT_VERSION };
}

const CASUAL: ReadonlySet<Register> = new Set(['casual', 'intimate', 'slang']);

/** Pure validators over one generated mission; returns accepted expressions + rejections. */
export function validateGeneratedMission(
  mission: GeneratedMission,
  index: number,
  input: { allowedIntents: ReadonlySet<string>; guard: (text: string) => GuardResult },
): { accepted: GeneratedMission['expressions']; objectives: string[]; rejections: ValidationRejection[] } {
  const rejections: ValidationRejection[] = [];
  const accepted: GeneratedMission['expressions'] = [];
  const objectives = mission.objectiveIntentKeys.filter((k) => input.allowedIntents.has(k));
  for (const k of mission.objectiveIntentKeys) if (!input.allowedIntents.has(k)) rejections.push({ mission: index, item: 'objective', reason: `unknown or unrequested intent ${k}` });
  const seen = new Set<string>();
  mission.expressions.forEach((e, i) => {
    const item = `expression[${i}]`;
    const text = e.targetText.trim();
    if (!text) return void rejections.push({ mission: index, item, reason: 'empty target text' });
    if (!input.allowedIntents.has(e.intentKey)) return void rejections.push({ mission: index, item, reason: `intent ${e.intentKey} not in brief`, text });
    if (!e.sourceMeaning.trim()) return void rejections.push({ mission: index, item, reason: 'missing source meaning', text });
    if (e.sourceMeaning.trim().toLowerCase() === text.toLowerCase()) return void rejections.push({ mission: index, item, reason: 'source meaning identical to target text', text });
    const intent = isIntentKey(e.intentKey) ? getIntent(e.intentKey) : null;
    const maxWords = intent?.responseConstraints.typicalMaxWords ?? null;
    if (maxWords && text.split(/\s+/).length > maxWords * 2) return void rejections.push({ mission: index, item, reason: `too long for intent (${maxWords} words typical)`, text });
    if (intent?.politeness === 'polite' && CASUAL.has(e.register)) return void rejections.push({ mission: index, item, reason: `intent requires a polite register, got ${e.register}`, text });
    if (seen.has(text.toLowerCase())) return void rejections.push({ mission: index, item, reason: 'duplicate expression', text });
    const guard = input.guard(text);
    if (!guard.ok) return void rejections.push({ mission: index, item, reason: `language guard: ${guard.issues.map((g) => `${g.kind}${g.suspectedVariety ? ` (${g.suspectedVariety})` : ''}`).join(', ')}`, text });
    seen.add(text.toLowerCase());
    accepted.push({ ...e, targetText: text });
  });
  return { accepted, objectives, rejections };
}

/** One `missions.goals` entry (§10.1; mirrors `MissionGoal` in the API's `lib/goals.ts`, which reads this column). */
export interface MissionGoalDraft {
  id: string;
  skill_keys: string[];
  /** Learner-facing text keyed by source language; absent when the model gave none (publish gate then blocks). */
  description?: Record<string, string>;
}

/**
 * Pure mapping from accepted objectives to `missions.goals` rows: id = intent key, `skill_keys` from the
 * curriculum intent, `description` = `{ [sourceLanguage]: text }` when the model described the objective.
 * Never writes a bare string (no language) or an empty map.
 */
export function buildMissionGoals(input: { objectives: readonly string[]; sourceLanguage: SourceLanguageCode; descriptions: ReadonlyArray<{ intentKey: string; description: string }>; skillKeysFor: (intentKey: string) => readonly string[] }): { goals: MissionGoalDraft[]; goalsWithoutDescription: string[] } {
  const described = new Map<string, string>();
  for (const d of input.descriptions) {
    const text = d.description.trim();
    if (text && !described.has(d.intentKey)) described.set(d.intentKey, text);
  }
  const goalsWithoutDescription: string[] = [];
  const goals = input.objectives.map((id): MissionGoalDraft => {
    const text = described.get(id);
    if (!text) goalsWithoutDescription.push(id);
    return text ? { id, skill_keys: [...input.skillKeysFor(id)], description: { [input.sourceLanguage]: text } } : { id, skill_keys: [...input.skillKeysFor(id)] };
  });
  return { goals, goalsWithoutDescription };
}

// --- diversity gate (§9.8, R-9.8-02) -------------------------------------------------------------

/** Thresholds of the per-mission gate (relaxed alternative coverage, as for scripts chapter missions). */
export const MISSION_GATE_THRESHOLDS = MISSION_DIVERSITY_THRESHOLDS;
/** Thresholds of the per-batch gate over the dialogues of every drafted mission (free-set defaults). */
export const BATCH_GATE_THRESHOLDS = DEFAULT_DIVERSITY_THRESHOLDS;
export const DIVERSITY_REVIEW_FLAG = 'diversity_needs_regeneration';

const missionDialogue = (mission: GeneratedMission, id: string): DiversityDialogue => ({ id, turns: mission.dialogue.map((l) => ({ speaker: l.speaker, text: l.targetText, intentKey: l.intentKey, act: l.act })) });

/** Gate input for one mission: accepted learner phrasings per intent (expression + its variants) and its dialogue. */
export function missionDiversityInput(mission: GeneratedMission, accepted: GeneratedMission['expressions'], id: string): DialogueSetInput {
  const byIntent = new Map<string, string[]>();
  for (const e of accepted) byIntent.set(e.intentKey, [...(byIntent.get(e.intentKey) ?? []), e.targetText, ...e.variants]);
  return { intents: [...byIntent].map(([intentKey, phrasings]) => ({ intentKey, phrasings })), dialogues: [missionDialogue(mission, id)] };
}

/** Gate input for a batch: the dialogues of every drafted mission (phrasings are gated per mission). */
export function batchDiversityInput(missions: ReadonlyArray<{ id: string; mission: GeneratedMission }>): DialogueSetInput {
  return { intents: [], dialogues: missions.map((m) => missionDialogue(m.mission, m.id)) };
}

export interface DiversitySummary {
  verdict: DiversityReport['verdict'];
  score: number;
  reasons: string[];
  warnings: string[];
}

export const summarizeDiversity = (r: DiversityReport): DiversitySummary => ({ verdict: r.verdict, score: r.score, reasons: r.reasons, warnings: r.flags.filter((f) => f.severity === 'warn').map((f) => `${f.code}${f.subject !== null ? `:${f.subject}` : ''}`) });

/** The mark stored on a draft (`scoring_rubric.diversity`, job output). */
export interface DiversityMark {
  verdict: DiversityReport['verdict'];
  /** Mission reasons, then batch reasons prefixed `batch:`. */
  reasons: string[];
  mission: DiversitySummary;
  batch: DiversitySummary | null;
  regenerated: boolean;
}

/** Combine a mission's gate with its batch's: a failing batch marks every mission in it (they were generated together). */
export function diversityMark(mission: DiversityReport, batch: DiversityReport | null, regenerated: boolean): DiversityMark {
  const reasons = [...mission.reasons, ...(batch?.reasons ?? []).map((r) => `batch:${r}`)];
  return { verdict: reasons.length ? 'needs_regeneration' : 'diverse', reasons, mission: summarizeDiversity(mission), batch: batch ? summarizeDiversity(batch) : null, regenerated };
}

/** Regeneration feedback naming the gate's blocking findings for one mission. */
export function diversityFeedback(report: DiversityReport): string {
  const findings = report.flags.filter((f) => f.severity === 'block').map((f) => `${f.code}${f.subject !== null ? ` (${f.subject})` : ''}: ${f.detail}`);
  return `Your previous attempt at this mission failed the diversity gate: ${findings.join('; ')}. Give the learner expressions real alternatives in "variants" (different words or structures, not punctuation, spelling or one-word swaps), and write a conversation rather than a question → answer drill: vary who speaks and who asks, and let one speaker misunderstand and the other repair it (label those turns "misunderstanding" and "repair"). Return the full JSON again with exactly one mission.`;
}

/** Fewer blocking reasons wins; on a tie, the higher score (same rule as the scripts content factory). */
export const diversityImproved = (candidate: DiversityReport, current: DiversityReport): boolean => candidate.reasons.length < current.reasons.length || (candidate.reasons.length === current.reasons.length && candidate.score > current.score);

/** Target text of a mission (speaker + dialogue lines, expressions, variants): tells a rewrite from a relabelled copy. */
const missionText = (m: GeneratedMission): string => JSON.stringify([m.dialogue.map((l) => [l.speaker, l.targetText.trim()]), m.expressions.map((e) => [e.targetText.trim(), e.variants])]);

const DIFFICULTY: Record<string, number> = { beginner: 0.2, elementary: 0.35, intermediate: 0.5, upper_intermediate: 0.65, advanced: 0.8 };

interface Candidate {
  index: number;
  mission: GeneratedMission;
  accepted: GeneratedMission['expressions'];
  objectives: string[];
  rejections: ValidationRejection[];
  gate: DiversityReport;
  regenerated: boolean;
}

export const generateContentHandler: JobHandler<GenerateContentParams> = {
  name: 'generate_content',
  jobTypes: ['content_generate', 'generate_content'],
  runtime: 'any',
  paramsSchema: GenerateContentParamsSchema,
  async run(ctx) {
    const { db } = ctx.services;
    const p = ctx.params;
    const track = getCourseTrack(p.targetTrack);
    const variety = track.targetVarietyId;
    const unknown = p.intentKeys.filter((k) => !isIntentKey(k));
    if (unknown.length) throw new JobFailure('unknown_intent', `Unknown intent keys: ${unknown.join(', ')}`, { retry: false });
    const intents = p.intentKeys.map((k) => getIntent(k));
    const allowed = new Set(p.intentKeys);
    const languageContext = jobLanguageContext(ctx, { track: track.id, sourceLanguage: p.sourceLanguage, level: p.level });
    const ai = await ctx.services.ai({ sink: ctx.cost, varietyId: variety });

    ctx.cost.assertBudget();
    const promptInput = {
      track: track.id,
      variety,
      source: p.sourceLanguage,
      level: p.level,
      scene: p.scene ?? null,
      intents: intents.map((i) => ({ key: i.intentKey, description: i.description, socialMeaning: i.socialMeaning ?? null, politeness: i.politeness, typicalMaxWords: i.responseConstraints.typicalMaxWords ?? null, variants: i.acceptableVariants })),
    };
    const prompt = buildContentFactoryPrompt({ ...promptInput, count: p.count });
    const generated = await ai.reasoner.generateStructured('content_generation', languageContext, prompt, ContentFactoryOutputSchema, { traceId: ctx.traceId });
    await ctx.progress(40, `${generated.missions.length} missions generated`);

    const provenanceBase = { task: 'content_generation', role: 'content_factory', promptVersion: CONTENT_FACTORY_PROMPT_VERSION, traceId: ctx.traceId, jobId: ctx.job.id, generatedAt: ctx.services.now().toISOString(), nativeReviewed: false, licenseMarker: 'ai_generated_unlicensed_draft' };
    const guard = (text: string) => ai.guard.checkHeuristic(text, variety, track.defaultScriptMode, { sourceLanguage: p.sourceLanguage, track: track.id });
    const gateId = (index: number) => `missions/${index}`;

    // --- 1. validate + per-mission diversity gate (pure) -----------------------------------------
    const rejectedMissions: Array<{ mission: number; reason: string; rejections: ValidationRejection[] }> = [];
    const candidates: Candidate[] = [];
    for (const [index, mission] of generated.missions.entries()) {
      const { accepted, objectives, rejections } = validateGeneratedMission(mission, index, { allowedIntents: allowed, guard });
      if (!accepted.length || !objectives.length) {
        rejectedMissions.push({ mission: index, reason: accepted.length ? 'no valid objective' : 'no expression passed validation', rejections });
        continue;
      }
      candidates.push({ index, mission, accepted, objectives, rejections, gate: scoreDialogueDiversity(missionDiversityInput(mission, accepted, gateId(index)), MISSION_GATE_THRESHOLDS), regenerated: false });
    }
    if (!candidates.length) throw new JobFailure('all_drafts_rejected', `Validators rejected every generated mission (${rejectedMissions.map((m) => m.reason).join('; ')})`, { retry: true, backoffSeconds: 60, details: { rejectedMissions } });

    // --- 2. optional regeneration of low-diversity missions (paid; within the job ceiling) ------
    const regeneration = { requested: p.regenerateOnLowDiversity, attempts: 0, kept: [] as number[], skipped: null as string | null };
    const low = candidates.filter((c) => c.gate.verdict === 'needs_regeneration');
    if (low.length && !p.regenerateOnLowDiversity) regeneration.skipped = 'not requested (regenerateOnLowDiversity is off)';
    if (low.length && p.regenerateOnLowDiversity) {
      for (const c of low) {
        try {
          ctx.cost.assertBudget();
        } catch (error) {
          if (!(error instanceof CostCeilingExceeded)) throw error;
          regeneration.skipped = `job cost ceiling reached (${error.usd.toFixed(4)} of ${error.ceilingUsd.toFixed(2)} USD)`;
          break;
        }
        const base = buildContentFactoryPrompt({ ...promptInput, count: 1 });
        regeneration.attempts += 1;
        try {
          const retry = await ai.reasoner.generateStructured('content_generation', languageContext, { ...base, user: `${base.user}\n\n${diversityFeedback(c.gate)}` }, ContentFactoryOutputSchema, { traceId: ctx.traceId });
          const mission = retry.missions[0];
          if (!mission) continue;
          const v = validateGeneratedMission(mission, c.index, { allowedIntents: allowed, guard });
          if (!v.accepted.length || !v.objectives.length || missionText(mission) === missionText(c.mission)) continue;
          const gate = scoreDialogueDiversity(missionDiversityInput(mission, v.accepted, gateId(c.index)), MISSION_GATE_THRESHOLDS);
          if (!diversityImproved(gate, c.gate)) continue;
          Object.assign(c, { mission, accepted: v.accepted, objectives: v.objectives, rejections: v.rejections, gate, regenerated: true });
          regeneration.kept.push(c.index);
        } catch (error) {
          // A failed regeneration keeps the original draft (still marked); the job itself does not fail.
          ctx.log.warn('content_factory.diversity_regeneration_failed', { mission: c.index, error });
        }
      }
    }

    // --- 3. batch gate over the drafted missions' dialogues --------------------------------------
    const batchGate = candidates.length >= 2 ? scoreDialogueDiversity(batchDiversityInput(candidates.map((c) => ({ id: gateId(c.index), mission: c.mission }))), BATCH_GATE_THRESHOLDS) : null;
    await ctx.progress(50, `diversity gate: ${candidates.filter((c) => c.gate.verdict === 'needs_regeneration').length} mission(s) and batch ${batchGate?.verdict ?? 'n/a'}`);

    // --- 4. drafts (always review_needed) -------------------------------------------------------
    const drafts: Array<{ missionId: string | null; draft: DraftContent; accepted: number; rejected: ValidationRejection[]; skippedIntents: string[]; goals: MissionGoalDraft[]; goalsWithoutDescription: string[]; diversity: DiversityMark }> = [];
    const missionIds: string[] = [];
    const needsRegeneration: Array<{ mission: number; missionId: string | null; reasons: string[] }> = [];

    for (const [position, c] of candidates.entries()) {
      const { index, mission, accepted, objectives, rejections } = c;
      const diversity = diversityMark(c.gate, batchGate, c.regenerated);
      const reviewFlags = diversity.verdict === 'needs_regeneration' ? [DIVERSITY_REVIEW_FLAG] : [];
      const draft = DraftContentSchema.parse({
        intentId: objectives[0],
        targetTrack: track.id,
        targetVariety: variety,
        sourceLanguage: p.sourceLanguage,
        mission: { title: mission.title, level: p.level, objectiveIds: objectives, scene: p.scene ?? mission.sceneDescription, characterId: p.characterId ?? '' },
        expressions: accepted.map((e) => ({ targetText: e.targetText, sourceMeaning: e.sourceMeaning, register: e.register, nativeReviewed: false, approvedForPublishing: false })),
        publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true },
      });

      const { goals, goalsWithoutDescription } = buildMissionGoals({ objectives, sourceLanguage: p.sourceLanguage, descriptions: mission.objectiveDescriptions, skillKeysFor: (key) => (isIntentKey(key) ? getIntent(key).skillKeys : []) });
      if (goalsWithoutDescription.length) rejections.push(...goalsWithoutDescription.map((id): ValidationRejection => ({ mission: index, item: `goal:${id}`, reason: 'no learner-facing description in the source language (editor must add one before publishing)' })));

      let missionId: string | null = null;
      const skippedIntents: string[] = [];
      if (!p.dryRun) {
        const templateKey = `cf.${objectives[0]!.replace(/[^a-z0-9_.]/g, '_')}.${keyHash(ctx.job.id, index).slice(0, 10)}`;
        const row = await db.insertMission({
          chapter_id: null,
          template_key: templateKey,
          mission_type: 'standard',
          title_translations: { [p.sourceLanguage]: mission.title } as never,
          goals: goals as never,
          target_variety_id: variety,
          level: p.level,
          recommended_minutes: 8,
          prerequisite_skill_keys: [...new Set(intents.filter((i) => objectives.includes(i.intentKey)).flatMap((i) => i.skillKeys))],
          difficulty: DIFFICULTY[p.level] ?? 0.5,
          narrative_segment: { scene: draft.mission.scene, sceneDescription: mission.sceneDescription, dialogue: mission.dialogue, characterId: p.characterId ?? null } as never,
          scoring_rubric: { objectives, provenance: provenanceBase, reviewStatus: 'review_needed', diversity, reviewFlags } as never,
          sort_order: 0,
          state: 'review_needed',
        } as Insert<'missions'>);
        missionId = row.id;
        missionIds.push(row.id);
        await db.insertMissionLocalization({ mission_id: row.id, source_language_code: p.sourceLanguage, title: mission.title, instructions: mission.instructions, hints: mission.hints, qa_state: 'machine_draft' });
        for (const e of accepted) {
          const intent = await db.getIntentByKey(e.intentKey);
          if (!intent) {
            skippedIntents.push(e.intentKey);
            continue;
          }
          const expr = await db.insertExpression({
            intent_id: intent.id,
            target_variety_id: variety,
            canonical_text: e.targetText,
            register: e.register,
            difficulty: DIFFICULTY[p.level] ?? 0.5,
            scenario_tags: [draft.mission.scene].filter(Boolean),
            script_annotations: { variants: e.variants, missionId: row.id, provenance: provenanceBase, reviewFlags } as never,
            reviewed: false,
            origin: 'ai_generated',
            state: 'review_needed',
          } as Insert<'expressions'>);
          await db.insertExpressionForm({ expression_id: expr.id, script: track.scripts.primary, transliteration_scheme: null, text: e.targetText });
          if (e.transliteration && track.scripts.transliterations[0]) await db.insertExpressionForm({ expression_id: expr.id, script: null, transliteration_scheme: track.scripts.transliterations[0], text: e.transliteration });
          await db.insertExpressionTranslation({ expression_id: expr.id, source_language_code: p.sourceLanguage, natural_meaning: e.sourceMeaning, context_note: e.contextNote, literal_gloss: e.literalGloss, qa_state: 'machine_draft' });
        }
        await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: 'jobs', action: 'content_factory.draft_created', entity_table: 'missions', entity_id: row.id, before: null, after: { draft, goals, goalsWithoutDescription, provenance: provenanceBase, rejected: rejections.length, skippedIntents, diversity } as never, request_id: ctx.job.id });
        await ctx.emit('translation.review_requested', { entityTable: 'missions', entityId: row.id, sourceLanguageCode: p.sourceLanguage, targetVarietyId: variety, requestedBy: ctx.job.requested_by, reviewerId: null }, `translation.review_requested:missions:${row.id}:${p.sourceLanguage}`);
      }
      if (diversity.verdict === 'needs_regeneration') needsRegeneration.push({ mission: index, missionId, reasons: diversity.reasons });
      drafts.push({ missionId, draft, accepted: accepted.length, rejected: rejections, skippedIntents, goals, goalsWithoutDescription, diversity });
      await ctx.progress(50 + Math.round(((position + 1) / candidates.length) * 48));
    }
    await ctx.progress(100);
    return {
      output: {
        dryRun: p.dryRun,
        targetTrack: track.id,
        targetVariety: variety,
        sourceLanguage: p.sourceLanguage,
        drafts,
        draftIds: missionIds,
        rejectedMissions,
        diversityGate: { batch: batchGate ? summarizeDiversity(batchGate) : null, needsRegeneration, regeneration },
        provenance: provenanceBase,
        publication: { status: 'draft', requiresNativeReview: true, requiresVerifiedSourceRights: true },
      },
    };
  },
};
