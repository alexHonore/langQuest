/**
 * `generate_content` — the content factory (§9.8): mission brief + communicative intents → constrained
 * structured generation in the target variety (`content_factory` role, `content_generation` task) →
 * syntactic / semantic / rubric validators (language guard, intent + register rules, length) → draft
 * `missions` / `mission_localizations` / `expressions` / `expression_forms` / `expression_translations`
 * rows in `review_needed` with provenance (model task, prompt version, trace id, job id). Rejected lines are
 * reported, never stored. Drafts carry `nativeReviewed: false` and can only be published by an editor
 * after native review and rights approval (publication gate lives in the API).
 */
import { z } from 'zod';
import type { CourseTrackId, DraftContent, Register, SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { CourseTrackIdSchema, DraftContentSchema, KeySchema, LearnerLevelSchema, RegisterSchema, SourceLanguageCodeSchema, getCourseTrack } from '@langquest/contracts';
import { coachingLanguageInstruction, getPromptPack, varietyGuardInstruction, type GuardResult } from '@langquest/ai';
import { getIntent, isIntentKey } from '@langquest/curriculum';
import type { Insert } from '@langquest/db';
import { JobFailure, type JobHandler } from '../queue/types';
import { jobLanguageContext, keyHash } from './common';

export const CONTENT_FACTORY_PROMPT_VERSION = 'content_factory:v1';

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
});
export type GenerateContentParams = z.infer<typeof GenerateContentParamsSchema>;

const line = z.object({
  speaker: z.enum(['character', 'learner']),
  intentKey: z.string(),
  targetText: z.string(),
  transliteration: z.string().nullable(),
  sourceMeaning: z.string(),
  register: RegisterSchema,
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
    'Each mission: a realistic scene, 2–16 dialogue lines alternating character/learner, 3–12 learner expressions that fulfil the requested intents, plus instructions and hints for the learner in the SOURCE language.',
    'Write how people actually talk in this variety: no textbook stiffness, no overly formal register unless requested, no offensive or insensitive content, nothing that only works as a quiz with one correct answer; give acceptable variants.',
    'Every expression must name the intent it fulfils (intentKey from the brief). Keep expressions within the typical length for the intent.',
    'Output JSON only. Target text must be in the target variety; sourceMeaning, title, instructions and hints must be in the source language.',
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

const DIFFICULTY: Record<string, number> = { beginner: 0.2, elementary: 0.35, intermediate: 0.5, upper_intermediate: 0.65, advanced: 0.8 };

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
    const prompt = buildContentFactoryPrompt({
      track: track.id,
      variety,
      source: p.sourceLanguage,
      level: p.level,
      scene: p.scene ?? null,
      count: p.count,
      intents: intents.map((i) => ({ key: i.intentKey, description: i.description, socialMeaning: i.socialMeaning ?? null, politeness: i.politeness, typicalMaxWords: i.responseConstraints.typicalMaxWords ?? null, variants: i.acceptableVariants })),
    });
    const generated = await ai.reasoner.generateStructured('content_generation', languageContext, prompt, ContentFactoryOutputSchema, { traceId: ctx.traceId });
    await ctx.progress(50, `${generated.missions.length} missions generated`);

    const provenanceBase = { task: 'content_generation', role: 'content_factory', promptVersion: CONTENT_FACTORY_PROMPT_VERSION, traceId: ctx.traceId, jobId: ctx.job.id, generatedAt: ctx.services.now().toISOString(), nativeReviewed: false, licenseMarker: 'ai_generated_unlicensed_draft' };
    const drafts: Array<{ missionId: string | null; draft: DraftContent; accepted: number; rejected: ValidationRejection[]; skippedIntents: string[] }> = [];
    const rejectedMissions: Array<{ mission: number; reason: string; rejections: ValidationRejection[] }> = [];
    const missionIds: string[] = [];

    for (const [index, mission] of generated.missions.entries()) {
      const { accepted, objectives, rejections } = validateGeneratedMission(mission, index, { allowedIntents: allowed, guard: (text) => ai.guard.checkHeuristic(text, variety, track.defaultScriptMode, { sourceLanguage: p.sourceLanguage, track: track.id }) });
      if (!accepted.length || !objectives.length) {
        rejectedMissions.push({ mission: index, reason: accepted.length ? 'no valid objective' : 'no expression passed validation', rejections });
        continue;
      }
      const draft = DraftContentSchema.parse({
        intentId: objectives[0],
        targetTrack: track.id,
        targetVariety: variety,
        sourceLanguage: p.sourceLanguage,
        mission: { title: mission.title, level: p.level, objectiveIds: objectives, scene: p.scene ?? mission.sceneDescription, characterId: p.characterId ?? '' },
        expressions: accepted.map((e) => ({ targetText: e.targetText, sourceMeaning: e.sourceMeaning, register: e.register, nativeReviewed: false, approvedForPublishing: false })),
        publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true },
      });

      let missionId: string | null = null;
      const skippedIntents: string[] = [];
      if (!p.dryRun) {
        const templateKey = `cf.${objectives[0]!.replace(/[^a-z0-9_.]/g, '_')}.${keyHash(ctx.job.id, index).slice(0, 10)}`;
        const row = await db.insertMission({
          chapter_id: null,
          template_key: templateKey,
          mission_type: 'standard',
          title_translations: { [p.sourceLanguage]: mission.title } as never,
          goals: objectives as never,
          target_variety_id: variety,
          level: p.level,
          recommended_minutes: 8,
          prerequisite_skill_keys: [...new Set(intents.filter((i) => objectives.includes(i.intentKey)).flatMap((i) => i.skillKeys))],
          difficulty: DIFFICULTY[p.level] ?? 0.5,
          narrative_segment: { scene: draft.mission.scene, sceneDescription: mission.sceneDescription, dialogue: mission.dialogue, characterId: p.characterId ?? null } as never,
          scoring_rubric: { objectives, provenance: provenanceBase, reviewStatus: 'review_needed' } as never,
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
            script_annotations: { variants: e.variants, missionId: row.id, provenance: provenanceBase } as never,
            reviewed: false,
            origin: 'ai_generated',
            state: 'review_needed',
          } as Insert<'expressions'>);
          await db.insertExpressionForm({ expression_id: expr.id, script: track.scripts.primary, transliteration_scheme: null, text: e.targetText });
          if (e.transliteration && track.scripts.transliterations[0]) await db.insertExpressionForm({ expression_id: expr.id, script: null, transliteration_scheme: track.scripts.transliterations[0], text: e.transliteration });
          await db.insertExpressionTranslation({ expression_id: expr.id, source_language_code: p.sourceLanguage, natural_meaning: e.sourceMeaning, context_note: e.contextNote, literal_gloss: e.literalGloss, qa_state: 'machine_draft' });
        }
        await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: 'jobs', action: 'content_factory.draft_created', entity_table: 'missions', entity_id: row.id, before: null, after: { draft, provenance: provenanceBase, rejected: rejections.length, skippedIntents } as never, request_id: ctx.job.id });
        await ctx.emit('translation.review_requested', { entityTable: 'missions', entityId: row.id, sourceLanguageCode: p.sourceLanguage, targetVarietyId: variety, requestedBy: ctx.job.requested_by, reviewerId: null }, `translation.review_requested:missions:${row.id}:${p.sourceLanguage}`);
      }
      drafts.push({ missionId, draft, accepted: accepted.length, rejected: rejections, skippedIntents });
      await ctx.progress(50 + Math.round(((index + 1) / generated.missions.length) * 48));
    }
    if (!drafts.length) throw new JobFailure('all_drafts_rejected', `Validators rejected every generated mission (${rejectedMissions.map((m) => m.reason).join('; ')})`, { retry: true, backoffSeconds: 60, details: { rejectedMissions } });
    await ctx.progress(100);
    return { output: { dryRun: p.dryRun, targetTrack: track.id, targetVariety: variety, sourceLanguage: p.sourceLanguage, drafts, draftIds: missionIds, rejectedMissions, provenance: provenanceBase, publication: { status: 'draft', requiresNativeReview: true, requiresVerifiedSourceRights: true } } };
  },
};
