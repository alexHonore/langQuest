/**
 * Offline deterministic exercise packs (§4.5, Phase 4): listen/identify, anticipate and
 * repeat exercises built only from pre-generated assets. Same seed + same inputs ⇒ the
 * same pack, byte for byte. No `Math.random` anywhere.
 */
import type { LanguageContext, LessonType, ScriptMode } from '@langquest/contracts';
import { findIntent } from '../intents';
import { ExpressionCandidateSchema, selectDisplayForms, type ExpressionAudioRef, type ExpressionCandidate, type ExpressionCandidateInput, type ExpressionForm } from '../missions/realise';
import { Seeded, fnv1a32 } from './random';

export type OfflineExerciseKind = 'listen_identify' | 'anticipate' | 'repeat';

export interface ListenIdentifyExercise {
  kind: 'listen_identify';
  id: string;
  lessonType: Extract<LessonType, 'listen_identify'>;
  expressionId: string;
  promptAudio: ExpressionAudioRef;
  /** Source-language meanings; exactly one is correct. */
  options: { expressionId: string; intentKey: string; meaning: string }[];
  correctIndex: number;
  estimatedSeconds: number;
}

export interface AnticipateExercise {
  kind: 'anticipate';
  id: string;
  lessonType: Extract<LessonType, 'anticipate_speak'>;
  expressionId: string;
  intentKey: string;
  /** Source-language prompt: what to say. */
  meaning: string;
  contextNote: string | null;
  /** Revealed after the attempt (or explicit reveal choice) — §14.1 A16. */
  reveal: { forms: ExpressionForm[]; audio: ExpressionAudioRef[] };
  requiresAttemptBeforeReveal: true;
  estimatedSeconds: number;
}

export interface RepeatExercise {
  kind: 'repeat';
  id: string;
  lessonType: Extract<LessonType, 'shadowing'>;
  expressionId: string;
  forms: ExpressionForm[];
  meaning: string;
  audio: { normal: ExpressionAudioRef; slow: ExpressionAudioRef | null };
  /** Pronunciation feedback offline is reference comparison only — never a numeric score. */
  assessmentMode: 'reference-comparison';
  estimatedSeconds: number;
}

export type OfflineExercise = ListenIdentifyExercise | AnticipateExercise | RepeatExercise;

export interface OfflinePackInput {
  seed: string;
  ctx: LanguageContext;
  expressions: readonly ExpressionCandidateInput[];
  /** Target number of exercises (default 12). */
  size?: number;
  kinds?: readonly OfflineExerciseKind[];
  /** Options per listen/identify exercise (default 3, min 2). */
  optionCount?: number;
}

export interface OfflineExercisePack {
  /** Stable id derived from seed + expression ids + context. */
  packId: string;
  seed: string;
  targetTrack: LanguageContext['targetTrack'];
  targetVariety: LanguageContext['targetVariety'];
  sourceLanguage: LanguageContext['sourceLanguage'];
  scriptMode: ScriptMode;
  exercises: OfflineExercise[];
  /** Expressions that could not be used, with honest reasons. */
  skipped: { expressionId: string; reason: 'wrong_variety' | 'missing_source_meaning' | 'no_audio' }[];
  /** Every asset id the pack needs downloaded before it can run. */
  requiredAssetIds: string[];
  estimatedSeconds: number;
}

const normalAudio = (e: ExpressionCandidate): ExpressionAudioRef | undefined => e.audio.find((a) => a.speechRate === 'normal') ?? e.audio[0];
const slowAudio = (e: ExpressionCandidate): ExpressionAudioRef | null => e.audio.find((a) => a.speechRate === 'slow') ?? null;

/** Build a deterministic offline exercise pack. */
export function buildOfflinePack(input: OfflinePackInput): OfflineExercisePack {
  const { ctx } = input;
  const size = Math.max(0, input.size ?? 12);
  const kinds = input.kinds?.length ? input.kinds : (['listen_identify', 'anticipate', 'repeat'] as const);
  const optionCount = Math.max(2, input.optionCount ?? 3);
  const skipped: OfflineExercisePack['skipped'] = [];
  const usable: ExpressionCandidate[] = [];

  for (const raw of [...input.expressions].sort((a, b) => a.id.localeCompare(b.id))) {
    const e = ExpressionCandidateSchema.parse(raw);
    if (e.targetVarietyId !== ctx.targetVariety) skipped.push({ expressionId: e.id, reason: 'wrong_variety' });
    else if (!e.meanings[ctx.sourceLanguage]) skipped.push({ expressionId: e.id, reason: 'missing_source_meaning' });
    else if (e.audio.length === 0) skipped.push({ expressionId: e.id, reason: 'no_audio' });
    else usable.push(e);
  }

  const packId = fnv1a32(`${input.seed}|${ctx.targetTrack}|${ctx.sourceLanguage}|${ctx.targetScriptMode}|${usable.map((e) => e.id).join(',')}`).toString(16).padStart(8, '0');
  const rng = new Seeded(`${packId}:${input.seed}`);
  const exercises: OfflineExercise[] = [];
  const assets = new Set<string>();
  const meaningOf = (e: ExpressionCandidate) => e.meanings[ctx.sourceLanguage]!;

  if (usable.length > 0 && size > 0) {
    const order = rng.shuffle(usable);
    let i = 0;
    let kindIndex = 0;
    let guard = 0;
    while (exercises.length < size && guard++ < size * 4) {
      const e = order[i % order.length]!;
      i += 1;
      const kind = kinds[kindIndex % kinds.length]!;
      kindIndex += 1;
      const id = `${packId}.${exercises.length}.${kind}`;
      if (kind === 'listen_identify') {
        if (usable.length < 2) continue;
        const prompt = normalAudio(e)!;
        const sameConcept = findIntent(e.intentKey)?.conceptId;
        const others = usable.filter((o) => o.id !== e.id);
        const preferred = others.filter((o) => findIntent(o.intentKey)?.conceptId !== sameConcept);
        const distractors = rng.sample(preferred.length >= optionCount - 1 ? preferred : others, optionCount - 1);
        const options = rng.shuffle([e, ...distractors]).map((o) => ({ expressionId: o.id, intentKey: o.intentKey, meaning: meaningOf(o).meaning }));
        assets.add(prompt.assetId);
        exercises.push({ kind, id, lessonType: 'listen_identify', expressionId: e.id, promptAudio: prompt, options, correctIndex: options.findIndex((o) => o.expressionId === e.id), estimatedSeconds: 20 });
      } else if (kind === 'anticipate') {
        for (const a of e.audio) assets.add(a.assetId);
        exercises.push({
          kind,
          id,
          lessonType: 'anticipate_speak',
          expressionId: e.id,
          intentKey: e.intentKey,
          meaning: meaningOf(e).meaning,
          contextNote: meaningOf(e).contextNote,
          reveal: { forms: selectDisplayForms(e.forms, ctx.targetScriptMode), audio: e.audio },
          requiresAttemptBeforeReveal: true,
          estimatedSeconds: 30,
        });
      } else {
        const normal = normalAudio(e)!;
        const slow = slowAudio(e);
        assets.add(normal.assetId);
        if (slow) assets.add(slow.assetId);
        exercises.push({ kind, id, lessonType: 'shadowing', expressionId: e.id, forms: selectDisplayForms(e.forms, ctx.targetScriptMode), meaning: meaningOf(e).meaning, audio: { normal, slow }, assessmentMode: 'reference-comparison', estimatedSeconds: 25 });
      }
    }
  }

  return {
    packId,
    seed: input.seed,
    targetTrack: ctx.targetTrack,
    targetVariety: ctx.targetVariety,
    sourceLanguage: ctx.sourceLanguage,
    scriptMode: ctx.targetScriptMode,
    exercises,
    skipped,
    requiredAssetIds: [...assets].sort(),
    estimatedSeconds: exercises.reduce((a, x) => a + x.estimatedSeconds, 0),
  };
}
