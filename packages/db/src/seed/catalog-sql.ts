/**
 * Generates the idempotent catalog seed migration (`080_seed_catalog.sql`) from the canonical
 * constants in `@langquest/contracts` so the database never drifts from the shared catalog.
 *
 * Usage: `pnpm --filter @langquest/db seed:catalog-sql` (writes supabase/migrations/…_080_seed_catalog.sql).
 * The generated file is committed; re-run after changing the contracts catalog.
 */
import {
  AI_TASK_NAME_VALUES,
  COURSE_TRACKS,
  LANGUAGES,
  LANGUAGE_VARIETIES,
  WRITING_SYSTEMS,
  type AiTaskName,
} from '@langquest/contracts';

/** SQL single-quoted literal with proper escaping (safe for any unicode text). */
export const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
export const sqlTextArray = (values: readonly string[]): string =>
  values.length === 0 ? "'{}'::text[]" : `array[${values.map(sqlLiteral).join(',')}]::text[]`;
export const sqlJsonb = (value: unknown): string => `${sqlLiteral(JSON.stringify(value))}::jsonb`;
export const sqlNullable = (value: string | null | undefined): string => (value == null ? 'null' : sqlLiteral(value));

/** Default model routing per task. All rows are `enabled = false` until a benchmark passes (§8.7). */
export interface DefaultModelProfile {
  task: AiTaskName;
  provider: 'openrouter' | 'azure_speech' | 'other';
  primaryModel: string;
  fallbackModels: string[];
  latencyClass: 'realtime' | 'interactive' | 'batch';
  params: Record<string, unknown>;
  capabilities: Record<string, unknown>;
}

/**
 * Model ids come from docs/provider-matrix/openrouter-models-snapshot-2026-10-14.json.
 * They are routing defaults pending benchmark — never hard-coded in UI (CONVENTIONS §5).
 */
export const DEFAULT_MODEL_PROFILES: readonly DefaultModelProfile[] = [
  { task: 'content_generation', provider: 'openrouter', primaryModel: 'anthropic/claude-sonnet-5.5', fallbackModels: ['google/gemini-3.8-flash'], latencyClass: 'batch', params: { temperature: 0.7, maxOutputTokens: 4000, timeoutMs: 60000, maxRetries: 2 }, capabilities: { structuredOutput: true } },
  { task: 'scene_planning', provider: 'openrouter', primaryModel: 'anthropic/claude-sonnet-5.5', fallbackModels: ['google/gemini-3.8-flash'], latencyClass: 'batch', params: { temperature: 0.6, maxOutputTokens: 3000, timeoutMs: 60000, maxRetries: 2 }, capabilities: { structuredOutput: true } },
  { task: 'character_dialogue', provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: ['google/gemini-3.8-flash'], latencyClass: 'realtime', params: { temperature: 0.8, maxOutputTokens: 300, timeoutMs: 8000, maxRetries: 1 }, capabilities: { streaming: true, structuredOutput: true } },
  { task: 'meaning_assessment', provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: ['google/gemini-3.5-flash'], latencyClass: 'interactive', params: { temperature: 0.1, maxOutputTokens: 600, timeoutMs: 10000, maxRetries: 1 }, capabilities: { structuredOutput: true } },
  { task: 'source_explanation', provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: ['google/gemini-3.5-flash'], latencyClass: 'interactive', params: { temperature: 0.3, maxOutputTokens: 800, timeoutMs: 10000, maxRetries: 1 }, capabilities: { structuredOutput: true } },
  { task: 'learner_evaluation', provider: 'openrouter', primaryModel: 'anthropic/claude-sonnet-5.5', fallbackModels: ['anthropic/claude-haiku-5.5'], latencyClass: 'batch', params: { temperature: 0.1, maxOutputTokens: 2000, timeoutMs: 45000, maxRetries: 2 }, capabilities: { structuredOutput: true } },
  { task: 'speech_recognition', provider: 'openrouter', primaryModel: 'openai/gpt-4o-transcribe', fallbackModels: ['openai/whisper-large-v3-turbo'], latencyClass: 'interactive', params: { timeoutMs: 15000, maxRetries: 1 }, capabilities: { languageHint: true, wordTimestamps: false } },
  { task: 'speech_synthesis', provider: 'openrouter', primaryModel: 'elevenlabs/eleven-multilingual-v2', fallbackModels: ['google/gemini-3.8-flash-tts'], latencyClass: 'interactive', params: { timeoutMs: 15000, maxRetries: 1 }, capabilities: { voices: true, speedControl: true } },
  { task: 'realtime_conversation', provider: 'other', primaryModel: 'pipeline:stt_llm_tts', fallbackModels: [], latencyClass: 'realtime', params: { timeoutMs: 30000 }, capabilities: { interruptible: false, duplex: false, note: 'Composed STT→LLM→TTS pipeline; duplex providers are opt-in via REALTIME_VOICE_PROVIDER' } },
  { task: 'pronunciation_assessment', provider: 'azure_speech', primaryModel: 'azure-pronunciation-assessment', fallbackModels: [], latencyClass: 'interactive', params: { timeoutMs: 15000 }, capabilities: { word: true, phoneme: true, prosody: true, tone: false, localeTable: 'docs/provider-matrix/azure-pronunciation-locales-2026-10-14.md' } },
  { task: 'transcription_alignment', provider: 'openrouter', primaryModel: 'openai/whisper-large-v3', fallbackModels: ['openai/whisper-large-v3-turbo'], latencyClass: 'batch', params: { timeoutMs: 600000, maxRetries: 2 }, capabilities: { wordTimestamps: true } },
  { task: 'language_quality_check', provider: 'openrouter', primaryModel: 'anthropic/claude-sonnet-5.5', fallbackModels: ['google/gemini-3.8-flash'], latencyClass: 'batch', params: { temperature: 0, maxOutputTokens: 2000, timeoutMs: 60000, maxRetries: 2 }, capabilities: { structuredOutput: true } },
];

/**
 * Tasks added after this catalog migration (080) ran everywhere: their default row is seeded by the migration that
 * widened the `ai_task_name` domain for them (this file runs first on a fresh stack, before the domain allows them).
 */
export const TASKS_SEEDED_LATER: Readonly<Partial<Record<(typeof AI_TASK_NAME_VALUES)[number], string>>> = {
  pronunciation_feedback: 'supabase/migrations/20261111210000_170_ai_task_pronunciation_feedback.sql',
};

/** Source languages seeded into course_source_localizations (priority tiers 1 and 2). */
export const SEEDED_SOURCE_LANGUAGES = ['en', 'fr'] as const;

/** Builds the full seed SQL text. Pure: no I/O. */
export function buildCatalogSeedSql(): string {
  const out: string[] = [];
  out.push('-- 080 — catalog seed. GENERATED by packages/db/src/seed/catalog-sql.ts from @langquest/contracts; do not hand-edit.');
  out.push('-- Idempotent: every statement is INSERT … ON CONFLICT DO UPDATE.');
  out.push('');

  out.push('-- languages');
  for (const l of LANGUAGES) {
    out.push(
      `insert into public.languages (id, code, english_name, native_name, default_script, rtl, plural_categories) values (${sqlLiteral(l.code)}, ${sqlLiteral(l.code)}, ${sqlLiteral(l.englishName)}, ${sqlLiteral(l.nativeName)}, ${sqlLiteral(l.defaultScript)}, ${l.rtl}, ${sqlTextArray(l.pluralCategories)})` +
        ' on conflict (id) do update set english_name = excluded.english_name, native_name = excluded.native_name, default_script = excluded.default_script, rtl = excluded.rtl, plural_categories = excluded.plural_categories;',
    );
  }
  out.push('');

  out.push('-- writing_systems');
  for (const w of WRITING_SYSTEMS) {
    out.push(
      `insert into public.writing_systems (id, kind, name, direction, renders_script, renderer_rules) values (${sqlLiteral(w.id)}, ${sqlLiteral(w.kind)}, ${sqlLiteral(w.name)}, ${sqlLiteral(w.direction)}, ${sqlNullable(w.rendersScript)}, ${sqlJsonb({ notes: w.rendererNotes })})` +
        ' on conflict (id) do update set kind = excluded.kind, name = excluded.name, direction = excluded.direction, renders_script = excluded.renders_script, renderer_rules = excluded.renderer_rules;',
    );
  }
  out.push('');

  out.push('-- language_varieties');
  for (const v of LANGUAGE_VARIETIES) {
    out.push(
      `insert into public.language_varieties (id, language_id, dialect_name, bcp47_locale, tonal, regional_notes, code_switch_norms, alternative_names, localized_voice_settings, must_not_substitute) values (${sqlLiteral(v.id)}, ${sqlLiteral(v.languageCode)}, ${sqlLiteral(v.name)}, ${sqlNullable(v.bcp47)}, ${v.tonal}, ${sqlLiteral(v.regionalNotes)}, ${sqlLiteral(v.codeSwitchNorms)}, ${sqlTextArray(v.alternativeNames)}, '{}'::jsonb, ${sqlTextArray(v.mustNotSubstitute)})` +
        ' on conflict (id) do update set language_id = excluded.language_id, dialect_name = excluded.dialect_name, bcp47_locale = excluded.bcp47_locale, tonal = excluded.tonal, regional_notes = excluded.regional_notes, code_switch_norms = excluded.code_switch_norms, alternative_names = excluded.alternative_names, must_not_substitute = excluded.must_not_substitute;',
    );
  }
  out.push('');

  out.push('-- course_tracks (exactly 30; ids and display names are stable — CONVENTIONS §2.1)');
  // Insert tracks that share assets after their targets: sort so `sharesAssetsWithTrackId` targets come first.
  const tracks = [...COURSE_TRACKS].sort((a, b) => Number(a.sharesAssetsWithTrackId != null) - Number(b.sharesAssetsWithTrackId != null) || a.order - b.order);
  for (const t of tracks) {
    out.push(
      `insert into public.course_tracks (id, sort_order, display_name, language_id, primary_target_variety_id, default_locale, regional_options, scripts, script_mode_options, default_script_mode, script_focus, default_voices, teaching_focus, shares_assets_with_track_id, tonal, assumptions, automated_scoring_support, publication_state) values (` +
        [
          sqlLiteral(t.id),
          String(t.order),
          sqlLiteral(t.displayName),
          sqlLiteral(t.languageCode),
          sqlLiteral(t.targetVarietyId),
          sqlLiteral(t.defaultLocale),
          sqlJsonb(t.regionalOptions),
          sqlJsonb(t.scripts),
          sqlTextArray(t.scriptModeOptions),
          sqlLiteral(t.defaultScriptMode),
          sqlNullable(t.scriptFocus),
          "'{}'::jsonb",
          sqlLiteral(t.teachingFocus),
          sqlNullable(t.sharesAssetsWithTrackId),
          String(t.tonal),
          sqlTextArray(t.assumptions),
          sqlLiteral(t.automatedScoringSupport),
          "'published'",
        ].join(', ') +
        ') on conflict (id) do update set sort_order = excluded.sort_order, display_name = excluded.display_name, language_id = excluded.language_id, primary_target_variety_id = excluded.primary_target_variety_id, default_locale = excluded.default_locale, regional_options = excluded.regional_options, scripts = excluded.scripts, script_mode_options = excluded.script_mode_options, default_script_mode = excluded.default_script_mode, script_focus = excluded.script_focus, teaching_focus = excluded.teaching_focus, shares_assets_with_track_id = excluded.shares_assets_with_track_id, tonal = excluded.tonal, assumptions = excluded.assumptions, automated_scoring_support = excluded.automated_scoring_support;',
    );
  }
  out.push('');

  out.push("-- course_source_localizations: honest 'planned' status for en and fr on all 30 tracks (no curriculum seeded yet)");
  for (const t of COURSE_TRACKS) {
    for (const src of SEEDED_SOURCE_LANGUAGES) {
      out.push(
        `insert into public.course_source_localizations (course_track_id, source_language_code, status, native_reviewed, editorial_note_key) values (${sqlLiteral(t.id)}, ${sqlLiteral(src)}, 'planned', false, 'coverage.planned')` +
          ' on conflict (course_track_id, source_language_code) do update set editorial_note_key = coalesce(public.course_source_localizations.editorial_note_key, excluded.editorial_note_key);',
      );
    }
  }
  out.push('');

  out.push('-- ai_model_profiles: one default (any variety, any source) per task, disabled until benchmarked');
  const tasks = new Set<string>(AI_TASK_NAME_VALUES);
  for (const p of DEFAULT_MODEL_PROFILES) {
    if (!tasks.has(p.task)) throw new Error(`Unknown AI task in defaults: ${p.task}`);
    out.push(
      `insert into public.ai_model_profiles (task, target_variety_id, source_language_code, provider, primary_model, fallback_models, params, capabilities, latency_class, enabled, version, benchmark_status) values (${sqlLiteral(p.task)}, null, null, ${sqlLiteral(p.provider)}, ${sqlLiteral(p.primaryModel)}, ${sqlTextArray(p.fallbackModels)}, ${sqlJsonb(p.params)}, ${sqlJsonb(p.capabilities)}, ${sqlLiteral(p.latencyClass)}, false, 1, 'unbenchmarked')` +
        ' on conflict (task, target_variety_id, source_language_code) do update set provider = excluded.provider, primary_model = excluded.primary_model, fallback_models = excluded.fallback_models, params = excluded.params, capabilities = excluded.capabilities, latency_class = excluded.latency_class where public.ai_model_profiles.benchmark_status = \'unbenchmarked\';',
    );
  }
  for (const task of AI_TASK_NAME_VALUES) {
    if (TASKS_SEEDED_LATER[task]) continue;
    if (!DEFAULT_MODEL_PROFILES.some((p) => p.task === task)) throw new Error(`Missing default model profile for task ${task}`);
  }
  out.push('');
  return out.join('\n') + '\n';
}
