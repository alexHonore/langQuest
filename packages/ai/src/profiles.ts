/**
 * Model profile registry (§8.2 / `ai_model_profiles`): routing keyed by task × target variety × source
 * language, with defaults for every `AiTaskName` and a loader hook so the API can overlay rows from the
 * database. Model ids are never hard-coded in UI; they live here and in the DB.
 */
import {
  AI_TASK_NAME_VALUES,
  ModelProfileSchema,
  modelProfileSpecificity,
  type AiTaskName,
  type LatencyClass,
  type ModelParams,
  type ModelProfile,
  type ModelProfileInput,
  type SourceLanguageCode,
  type VarietyId,
} from '@langquest/contracts';

/**
 * Internal AI roles used by the orchestration code. Each maps to one of the twelve spec tasks (§8.1) so
 * profiles can be resolved per role while `ai_requests.task` stays within the contract enum.
 */
export const AI_ROLE_VALUES = [
  'dialogue_character',
  'evaluator',
  'content_factory',
  'translation_overlay',
  'hint',
  'summary',
  'semantic_match',
  'language_guard',
  'transcript_enrichment',
  'metadata_inference',
] as const;
export type AiRole = (typeof AI_ROLE_VALUES)[number];

export const ROLE_TO_TASK: Readonly<Record<AiRole, AiTaskName>> = {
  dialogue_character: 'character_dialogue',
  evaluator: 'learner_evaluation',
  content_factory: 'content_generation',
  translation_overlay: 'source_explanation',
  hint: 'source_explanation',
  summary: 'learner_evaluation',
  semantic_match: 'meaning_assessment',
  language_guard: 'language_quality_check',
  transcript_enrichment: 'transcription_alignment',
  metadata_inference: 'scene_planning',
};

/** Per-role sampling defaults layered over the resolved profile params. */
export const ROLE_PARAMS: Readonly<Record<AiRole, ModelParams>> = {
  dialogue_character: { temperature: 0.7, maxOutputTokens: 400, timeoutMs: 12_000 },
  evaluator: { temperature: 0.1, maxOutputTokens: 1200, timeoutMs: 30_000 },
  content_factory: { temperature: 0.8, maxOutputTokens: 4000, timeoutMs: 90_000 },
  translation_overlay: { temperature: 0.2, maxOutputTokens: 300, timeoutMs: 10_000 },
  hint: { temperature: 0.4, maxOutputTokens: 200, timeoutMs: 8_000 },
  summary: { temperature: 0.2, maxOutputTokens: 600, timeoutMs: 20_000 },
  semantic_match: { temperature: 0, maxOutputTokens: 300, timeoutMs: 8_000 },
  language_guard: { temperature: 0, maxOutputTokens: 200, timeoutMs: 8_000 },
  transcript_enrichment: { temperature: 0.3, maxOutputTokens: 3000, timeoutMs: 60_000 },
  metadata_inference: { temperature: 0.2, maxOutputTokens: 800, timeoutMs: 30_000 },
};

const DEFAULT_UPDATED_AT = '2026-10-14T00:00:00.000Z';

/** Deterministic, valid v4-shaped UUID for a default profile (stable across processes; not a DB id). */
export const defaultProfileId = (task: AiTaskName, variety: VarietyId | null, source: SourceLanguageCode | null): string => {
  const key = `${task}|${variety ?? '*'}|${source ?? '*'}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + (h1 ^ h2).toString(16).padStart(8, '0') + ((h1 + h2) >>> 0).toString(16).padStart(8, '0')).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

interface Spec {
  task: AiTaskName;
  variety?: VarietyId;
  source?: SourceLanguageCode;
  provider: ModelProfile['provider'];
  primary: string;
  fallbacks: readonly string[];
  latency: LatencyClass;
  params?: ModelParams;
  enabled?: boolean;
}

const mk = (s: Spec): ModelProfile =>
  ModelProfileSchema.parse({
    id: defaultProfileId(s.task, s.variety ?? null, s.source ?? null),
    task: s.task,
    targetVariety: s.variety ?? null,
    sourceLanguage: s.source ?? null,
    provider: s.provider,
    primaryModel: s.primary,
    fallbackModels: [...s.fallbacks],
    params: s.params ?? {},
    latencyClass: s.latency,
    enabled: s.enabled ?? true,
    version: 1,
    benchmarkStatus: 'unbenchmarked',
    dailyBudgetUsd: null,
    updatedAt: DEFAULT_UPDATED_AT,
  } satisfies ModelProfile);

const CHEAP_FAST = ['google/gemini-3.8-flash', 'deepseek/deepseek-v4.1-flash'] as const;

/**
 * Defaults for all twelve tasks (global scope) plus variety-scoped overrides for low-resource varieties
 * where a stronger model is the responsible default. Live-verified on 2026-10-14: `anthropic/claude-haiku-5.5`
 * structured output in Darija, `openai/whisper-large-v3` / `elevenlabs/scribe-v2` / `google/gemini-3.5-transcribe`
 * STT, `google/gemini-3.8-flash-lite-tts` / `hexgrad/kokoro-82m` / `microsoft/mai-voice-2.1-flash` TTS.
 */
export const DEFAULT_PROFILES: readonly ModelProfile[] = [
  mk({ task: 'content_generation', provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['google/gemini-3.8-flash'], latency: 'batch', params: { temperature: 0.8, maxOutputTokens: 4000, timeoutMs: 90_000, maxRetries: 2 } }),
  mk({ task: 'scene_planning', provider: 'openrouter', primary: 'anthropic/claude-haiku-5.5', fallbacks: CHEAP_FAST, latency: 'interactive', params: { temperature: 0.5, maxOutputTokens: 1200, timeoutMs: 20_000 } }),
  mk({ task: 'character_dialogue', provider: 'openrouter', primary: 'anthropic/claude-haiku-5.5', fallbacks: CHEAP_FAST, latency: 'realtime', params: { temperature: 0.7, maxOutputTokens: 400, timeoutMs: 12_000, maxRetries: 1, contextBudgetTokens: 6000 } }),
  mk({ task: 'meaning_assessment', provider: 'openrouter', primary: 'google/gemini-3.8-flash', fallbacks: ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'], latency: 'interactive', params: { temperature: 0, maxOutputTokens: 300, timeoutMs: 8_000 } }),
  mk({ task: 'source_explanation', provider: 'openrouter', primary: 'anthropic/claude-haiku-5.5', fallbacks: CHEAP_FAST, latency: 'interactive', params: { temperature: 0.2, maxOutputTokens: 300, timeoutMs: 10_000 } }),
  mk({ task: 'learner_evaluation', provider: 'openrouter', primary: 'google/gemini-3.8-flash', fallbacks: ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'], latency: 'batch', params: { temperature: 0.1, maxOutputTokens: 1200, timeoutMs: 30_000 } }),
  mk({ task: 'speech_recognition', provider: 'openrouter', primary: 'openai/whisper-large-v3', fallbacks: ['elevenlabs/scribe-v2', 'google/gemini-3.5-transcribe'], latency: 'interactive', params: { timeoutMs: 20_000, maxRetries: 1 } }),
  mk({ task: 'speech_synthesis', provider: 'openrouter', primary: 'google/gemini-3.8-flash-lite-tts', fallbacks: ['elevenlabs/eleven-flash-v2.5', 'microsoft/mai-voice-2.1-flash'], latency: 'realtime', params: { timeoutMs: 15_000, maxRetries: 1 } }),
  mk({ task: 'realtime_conversation', provider: 'other', primary: 'pipeline:stt_llm_tts', fallbacks: [], latency: 'realtime', params: { timeoutMs: 20_000 } }),
  mk({ task: 'pronunciation_assessment', provider: 'azure_speech', primary: 'azure:pronunciation-assessment', fallbacks: ['reference-comparison'], latency: 'interactive', params: { timeoutMs: 15_000 } }),
  mk({ task: 'transcription_alignment', provider: 'openrouter', primary: 'openai/whisper-large-v3', fallbacks: ['elevenlabs/scribe-v2'], latency: 'batch', params: { timeoutMs: 60_000, maxRetries: 2 } }),
  mk({ task: 'language_quality_check', provider: 'openrouter', primary: 'google/gemini-3.5-flash-lite', fallbacks: ['anthropic/claude-haiku-5.5'], latency: 'interactive', params: { temperature: 0, maxOutputTokens: 200, timeoutMs: 8_000 } }),
  // Variety-scoped: dialects and low-resource targets get a stronger dialogue/evaluation model by default.
  ...(['ary', 'arz', 'ar-levant', 'yue', 'ht', 'rw', 'ln', 'sw'] as const).flatMap((variety) => [
    mk({ task: 'character_dialogue', variety, provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash'], latency: 'realtime', params: { temperature: 0.7, maxOutputTokens: 400, timeoutMs: 14_000, maxRetries: 1 } }),
    mk({ task: 'learner_evaluation', variety, provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['google/gemini-3.8-flash'], latency: 'batch', params: { temperature: 0.1, maxOutputTokens: 1200, timeoutMs: 40_000 } }),
  ]),
];

/** Loader hook: the API implements this over `ai_model_profiles` (rows returned override defaults). */
export interface ProfileLoader {
  load(): Promise<readonly ModelProfile[]>;
}

export interface ProfileLookup {
  task: AiTaskName;
  targetVariety: VarietyId;
  sourceLanguage: SourceLanguageCode;
}

export class ProfileNotFoundError extends Error {
  constructor(lookup: ProfileLookup) {
    super(`No enabled model profile for task=${lookup.task} variety=${lookup.targetVariety} source=${lookup.sourceLanguage}`);
    this.name = 'ProfileNotFoundError';
  }
}

const keyOf = (task: AiTaskName, variety: VarietyId | null, source: SourceLanguageCode | null): string => `${task}|${variety ?? '*'}|${source ?? '*'}`;

/** In-memory registry with exact → variety → source language → global resolution. */
export class ModelProfileRegistry {
  private readonly profiles = new Map<string, ModelProfile>();

  constructor(seed: readonly ModelProfile[] = DEFAULT_PROFILES) {
    for (const p of seed) this.upsert(p);
  }

  upsert(profile: ModelProfile): void {
    this.profiles.set(keyOf(profile.task, profile.targetVariety, profile.sourceLanguage), ModelProfileSchema.parse(profile));
  }

  /** Convenience for admin input shapes (id/version assigned deterministically; DB rows should pass full profiles). */
  upsertInput(input: ModelProfileInput, overrides: Partial<Pick<ModelProfile, 'id' | 'version' | 'benchmarkStatus' | 'updatedAt'>> = {}): ModelProfile {
    const profile = ModelProfileSchema.parse({
      ...input,
      id: overrides.id ?? defaultProfileId(input.task, input.targetVariety, input.sourceLanguage),
      version: overrides.version ?? 1,
      benchmarkStatus: overrides.benchmarkStatus ?? 'unbenchmarked',
      updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    });
    this.upsert(profile);
    return profile;
  }

  remove(task: AiTaskName, variety: VarietyId | null, source: SourceLanguageCode | null): boolean {
    return this.profiles.delete(keyOf(task, variety, source));
  }

  list(task?: AiTaskName): ModelProfile[] {
    const all = [...this.profiles.values()];
    return (task ? all.filter((p) => p.task === task) : all).sort((a, b) => modelProfileSpecificity(b) - modelProfileSpecificity(a) || a.task.localeCompare(b.task));
  }

  /** Overlay rows from the loader (e.g. the `ai_model_profiles` table). Returns how many were applied. */
  async refresh(loader: ProfileLoader): Promise<number> {
    const rows = await loader.load();
    for (const row of rows) this.upsert(row);
    return rows.length;
  }

  /** Resolve the most specific enabled profile, or `null`. */
  find(lookup: ProfileLookup): ModelProfile | null {
    const candidates: Array<[VarietyId | null, SourceLanguageCode | null]> = [
      [lookup.targetVariety, lookup.sourceLanguage],
      [lookup.targetVariety, null],
      [null, lookup.sourceLanguage],
      [null, null],
    ];
    for (const [variety, source] of candidates) {
      const p = this.profiles.get(keyOf(lookup.task, variety, source));
      if (p && p.enabled) return p;
    }
    return null;
  }

  resolve(lookup: ProfileLookup): ModelProfile {
    const p = this.find(lookup);
    if (!p) throw new ProfileNotFoundError(lookup);
    return p;
  }

  /** Ordered model list for a call: `[primary, ...fallbacks]`, de-duplicated. */
  static modelChain(profile: ModelProfile, override?: string): string[] {
    const chain = override ? [override, profile.primaryModel, ...profile.fallbackModels] : [profile.primaryModel, ...profile.fallbackModels];
    return [...new Set(chain)];
  }
}

/** Every spec task has a global default — enforced in tests and at module load. */
export const assertDefaultsCoverAllTasks = (profiles: readonly ModelProfile[] = DEFAULT_PROFILES): void => {
  const missing = AI_TASK_NAME_VALUES.filter((task) => !profiles.some((p) => p.task === task && p.targetVariety === null && p.sourceLanguage === null));
  if (missing.length) throw new Error(`DEFAULT_PROFILES missing global defaults for: ${missing.join(', ')}`);
};
assertDefaultsCoverAllTasks();
