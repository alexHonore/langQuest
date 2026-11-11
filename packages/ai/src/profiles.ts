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
  dialogue_character: { temperature: 0.7, maxOutputTokens: 1000, timeoutMs: 12_000 },
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
const CALL_FALLBACKS = ['anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash'] as const;

/**
 * Defaults for all thirteen tasks (global scope) plus variety-scoped overrides for low-resource varieties
 * where a stronger model is the responsible default. Live-verified on 2026-10-14: `anthropic/claude-haiku-5.5`
 * structured output in Darija, `openai/whisper-large-v3` / `elevenlabs/scribe-v2` / `google/gemini-3.5-transcribe`
 * STT, `google/gemini-3.8-flash-lite-tts` / `hexgrad/kokoro-82m` / `microsoft/mai-voice-2.1-flash` TTS.
 */
export const DEFAULT_PROFILES: readonly ModelProfile[] = [
  mk({ task: 'content_generation', provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['google/gemini-3.8-flash'], latency: 'batch', params: { temperature: 0.8, maxOutputTokens: 4000, timeoutMs: 90_000, maxRetries: 2 } }),
  mk({ task: 'scene_planning', provider: 'openrouter', primary: 'anthropic/claude-haiku-5.5', fallbacks: CHEAP_FAST, latency: 'interactive', params: { temperature: 0.5, maxOutputTokens: 1200, timeoutMs: 20_000 } }),
  // Calls: GPT 6 Luna first, Sonnet behind it, Gemini as a third provider (owner's choice after the 2026-11-11 bench,
  // docs/provider-matrix/dialogue-models-2026-11-11.md: Luna scored above Haiku at a lower cost per turn).
  mk({ task: 'character_dialogue', provider: 'openrouter', primary: 'openai/gpt-6-luna', fallbacks: CALL_FALLBACKS, latency: 'realtime', params: { temperature: 0.7, maxOutputTokens: 1000, timeoutMs: 12_000, maxRetries: 1, contextBudgetTokens: 6000 } }),
  mk({ task: 'meaning_assessment', provider: 'openrouter', primary: 'google/gemini-3.8-flash', fallbacks: ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'], latency: 'interactive', params: { temperature: 0, maxOutputTokens: 300, timeoutMs: 8_000 } }),
  mk({ task: 'source_explanation', provider: 'openrouter', primary: 'anthropic/claude-haiku-5.5', fallbacks: CHEAP_FAST, latency: 'interactive', params: { temperature: 0.2, maxOutputTokens: 300, timeoutMs: 10_000 } }),
  mk({ task: 'learner_evaluation', provider: 'openrouter', primary: 'google/gemini-3.8-flash', fallbacks: ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'], latency: 'batch', params: { temperature: 0.1, maxOutputTokens: 1200, timeoutMs: 30_000 } }),
  mk({ task: 'speech_recognition', provider: 'openrouter', primary: 'openai/whisper-large-v3', fallbacks: ['elevenlabs/scribe-v2', 'google/gemini-3.5-transcribe'], latency: 'interactive', params: { timeoutMs: 20_000, maxRetries: 1 } }),
  mk({ task: 'speech_synthesis', provider: 'openrouter', primary: 'google/gemini-3.8-flash-lite-tts', fallbacks: ['elevenlabs/eleven-flash-v2.5', 'microsoft/mai-voice-2.1-flash'], latency: 'realtime', params: { timeoutMs: 15_000, maxRetries: 1 } }),
  mk({ task: 'realtime_conversation', provider: 'other', primary: 'pipeline:stt_llm_tts', fallbacks: [], latency: 'realtime', params: { timeoutMs: 20_000 } }),
  mk({ task: 'pronunciation_assessment', provider: 'azure_speech', primary: 'azure:pronunciation-assessment', fallbacks: ['reference-comparison'], latency: 'interactive', params: { timeoutMs: 15_000 } }),
  mk({ task: 'transcription_alignment', provider: 'openrouter', primary: 'openai/whisper-large-v3', fallbacks: ['elevenlabs/scribe-v2'], latency: 'batch', params: { timeoutMs: 60_000, maxRetries: 2 } }),
  mk({ task: 'language_quality_check', provider: 'openrouter', primary: 'google/gemini-3.5-flash-lite', fallbacks: ['anthropic/claude-haiku-5.5'], latency: 'interactive', params: { temperature: 0, maxOutputTokens: 200, timeoutMs: 8_000 } }),
  // Listens to a learner's take (audio input): an audio-capable model (OpenRouter `input_audio`).
  mk({ task: 'pronunciation_feedback', provider: 'openrouter', primary: 'google/gemini-3.8-flash', fallbacks: ['google/gemini-3.5-flash-lite'], latency: 'interactive', params: { temperature: 0, maxOutputTokens: 1200, timeoutMs: 25_000 } }),
  // Variety-scoped: dialects and low-resource targets get a stronger dialogue/evaluation model by default.
  ...(['ary', 'arz', 'ar-levant', 'yue', 'ht', 'rw', 'ln', 'sw'] as const).flatMap((variety) => [
    mk({ task: 'character_dialogue', variety, provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['openai/gpt-6-luna', 'google/gemini-3.8-flash'], latency: 'realtime', params: { temperature: 0.7, maxOutputTokens: 1000, timeoutMs: 14_000, maxRetries: 1 } }),
    mk({ task: 'learner_evaluation', variety, provider: 'openrouter', primary: 'anthropic/claude-sonnet-5.5', fallbacks: ['google/gemini-3.8-flash'], latency: 'batch', params: { temperature: 0.1, maxOutputTokens: 1200, timeoutMs: 40_000 } }),
  ]),
];

/**
 * Loader hook: the API implements this over `ai_model_profiles`. Only rows with `enabled: true` overlay the
 * package defaults (see `ModelProfileRegistry.refresh`); a disabled row never turns a task off.
 */
export interface ProfileLoader {
  load(): Promise<readonly ModelProfile[]>;
}

/** Where a resolved profile came from: an `ai_model_profiles` row or the package `DEFAULT_PROFILES`. */
export const PROFILE_SOURCE_VALUES = ['db', 'package-default'] as const;
export type ProfileSource = (typeof PROFILE_SOURCE_VALUES)[number];

/** A profile plus its provenance. `id` is an `ai_model_profiles.id` only when `resolvedSource === 'db'`. */
export type ResolvedModelProfile = ModelProfile & { readonly resolvedSource: ProfileSource };

/** `ai_requests.profile_id` must reference a DB row: package-default ids are deterministic hashes, not DB uuids. */
export const ledgerProfileId = (profile: ResolvedModelProfile): string | null => (profile.resolvedSource === 'db' ? profile.id : null);

export interface RefreshResult {
  /** Enabled rows overlaid (same as the number `refresh()` returns). */
  applied: number;
  /** Disabled rows that were ignored; a previously overlaid DB row for that scope is removed again. */
  skippedDisabled: number;
  /** Scopes that reverted from a DB row to the package default (or were removed) because the row is now disabled. */
  reverted: number;
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

/**
 * In-memory registry with exact → variety → source language → global resolution.
 *
 * Two layers are kept per scope: the package default (from the constructor seed) and an optional DB overlay.
 * The DB layer only ever holds enabled rows, so a disabled `ai_model_profiles` row — the catalog seed ships every
 * row disabled until an admin smoke-tests it — can never switch a task off; it simply leaves the default in place.
 */
export class ModelProfileRegistry {
  private readonly defaults = new Map<string, ModelProfile>();
  private readonly overlay = new Map<string, ModelProfile>();

  constructor(seed: readonly ModelProfile[] = DEFAULT_PROFILES) {
    for (const p of seed) this.upsert(p, 'package-default');
  }

  /**
   * Insert or replace a profile in one layer. `source` defaults to `'db'` (the shape the API hands over from
   * `ai_model_profiles`); pass `'package-default'` for in-process defaults. A disabled DB row is stored nowhere and
   * removes any earlier DB overlay for the scope (see `refresh`).
   */
  upsert(profile: ModelProfile, source: ProfileSource = 'db'): void {
    const parsed = ModelProfileSchema.parse(profile);
    const key = keyOf(parsed.task, parsed.targetVariety, parsed.sourceLanguage);
    if (source === 'package-default') {
      this.defaults.set(key, parsed);
      return;
    }
    if (parsed.enabled) this.overlay.set(key, parsed);
    else this.overlay.delete(key);
  }

  /**
   * Convenience for admin input shapes. Without an explicit `id` the profile gets a deterministic package-style id and
   * is stored as a package default (it is not a DB row); with `overrides.id` it is treated as a DB row.
   */
  upsertInput(input: ModelProfileInput, overrides: Partial<Pick<ModelProfile, 'id' | 'version' | 'benchmarkStatus' | 'updatedAt'>> = {}, source?: ProfileSource): ModelProfile {
    const profile = ModelProfileSchema.parse({
      ...input,
      id: overrides.id ?? defaultProfileId(input.task, input.targetVariety, input.sourceLanguage),
      version: overrides.version ?? 1,
      benchmarkStatus: overrides.benchmarkStatus ?? 'unbenchmarked',
      updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    });
    this.upsert(profile, source ?? (overrides.id ? 'db' : 'package-default'));
    return profile;
  }

  /** Remove the scope from both layers. Returns whether anything was removed. */
  remove(task: AiTaskName, variety: VarietyId | null, source: SourceLanguageCode | null): boolean {
    const key = keyOf(task, variety, source);
    const a = this.overlay.delete(key);
    const b = this.defaults.delete(key);
    return a || b;
  }

  /** Effective profiles (DB overlay wins over the package default for the same scope), most specific first. */
  list(task?: AiTaskName): ResolvedModelProfile[] {
    const all = [...this.effective().values()];
    return (task ? all.filter((p) => p.task === task) : all).sort((a, b) => modelProfileSpecificity(b) - modelProfileSpecificity(a) || a.task.localeCompare(b.task));
  }

  /** Package defaults only (ignores the DB overlay). */
  listDefaults(task?: AiTaskName): ModelProfile[] {
    const all = [...this.defaults.values()];
    return task ? all.filter((p) => p.task === task) : all;
  }

  /**
   * Overlay rows from the loader (the `ai_model_profiles` table). Only enabled rows are applied; a disabled row is
   * skipped and, if an earlier refresh had overlaid that scope, the scope reverts to the package default. Returns how
   * many enabled rows were applied (see `refreshDetailed` for the full breakdown).
   */
  async refresh(loader: ProfileLoader): Promise<number> {
    return (await this.refreshDetailed(loader)).applied;
  }

  async refreshDetailed(loader: ProfileLoader): Promise<RefreshResult> {
    const rows = await loader.load();
    const result: RefreshResult = { applied: 0, skippedDisabled: 0, reverted: 0 };
    for (const row of rows) {
      const parsed = ModelProfileSchema.parse(row);
      const key = keyOf(parsed.task, parsed.targetVariety, parsed.sourceLanguage);
      if (parsed.enabled) {
        this.overlay.set(key, parsed);
        result.applied += 1;
      } else {
        result.skippedDisabled += 1;
        if (this.overlay.delete(key)) result.reverted += 1;
      }
    }
    return result;
  }

  /** Resolve the most specific enabled profile (DB overlay before package default per scope), or `null`. */
  find(lookup: ProfileLookup): ResolvedModelProfile | null {
    const candidates: Array<[VarietyId | null, SourceLanguageCode | null]> = [
      [lookup.targetVariety, lookup.sourceLanguage],
      [lookup.targetVariety, null],
      [null, lookup.sourceLanguage],
      [null, null],
    ];
    for (const [variety, source] of candidates) {
      const p = this.get(keyOf(lookup.task, variety, source));
      if (p && p.enabled) return p;
    }
    return null;
  }

  resolve(lookup: ProfileLookup): ResolvedModelProfile {
    const p = this.find(lookup);
    if (!p) throw new ProfileNotFoundError(lookup);
    return p;
  }

  /** Provenance of the effective profile for an exact scope (`null` when the scope has no profile at all). */
  sourceOf(task: AiTaskName, variety: VarietyId | null, source: SourceLanguageCode | null): ProfileSource | null {
    return this.get(keyOf(task, variety, source))?.resolvedSource ?? null;
  }

  private get(key: string): ResolvedModelProfile | null {
    const db = this.overlay.get(key);
    if (db) return { ...db, resolvedSource: 'db' };
    const def = this.defaults.get(key);
    return def ? { ...def, resolvedSource: 'package-default' } : null;
  }

  private effective(): Map<string, ResolvedModelProfile> {
    const out = new Map<string, ResolvedModelProfile>();
    for (const [key, p] of this.defaults) out.set(key, { ...p, resolvedSource: 'package-default' });
    for (const [key, p] of this.overlay) out.set(key, { ...p, resolvedSource: 'db' });
    return out;
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
