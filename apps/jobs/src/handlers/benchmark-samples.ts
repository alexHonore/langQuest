/**
 * Benchmark sample sets for `benchmark_model` (§8.7, R-8.4-03): fixed, versioned prompts run against ONE model for
 * one (variety, source language), so two models — or one model before and after a change — are compared on the
 * same inputs.
 *
 * `core-v1` measures in-variety text generation, so it runs only for tasks whose output is target-variety text
 * (`CORE_SET_TASKS` in `benchmark-model.ts`: character dialogue, scene planning, content generation): six short
 * situational requests (greeting, a service exchange, directions, a repair request, a code-switched learner message,
 * a polite register).
 * Every reply must be in the target variety; the code-switch sample mixes the learner's source language into the
 * message (Darija + French, Haitian Creole + French …) and the reply must not follow it into that language or into
 * a sister variety (§8.4: no ary→arb, yue→cmn, ht→fr). The instructions to the model are English (operator-facing);
 * nothing here is shown to learners.
 *
 * The set measures dialect adherence (heuristic language guard), structured-output validity, latency and cost. It
 * does NOT measure naturalness or intelligibility: those need native raters and stay empty on the benchmark row.
 */
import type { SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { findLanguage } from '@langquest/contracts';
import { exemplarGloss, getPromptPack, varietyGuardInstruction } from '@langquest/ai';

export interface BenchmarkSample {
  /** Stable within a set version (written to the benchmark notes and `ai_requests.redacted_log.sampleId`). */
  id: string;
  system: string;
  user: string;
}

export interface BenchmarkSampleSet {
  /** Canonical id recorded in `ai_model_benchmarks.sample_set_id`. */
  id: string;
  /** Prompt template version (`ai_requests.redacted_log.templateVersion`). */
  version: string;
  samples: BenchmarkSample[];
}

export const CORE_SAMPLE_SET_ID = 'core-v1';
export const CORE_SAMPLE_SET_VERSION = '2026-10-20.1';

/**
 * Ids an admin may type in the benchmark dialog; `default` (the dialog's prefill) always names the current core set.
 * `apps/api/src/routes/admin/models.ts` `KNOWN_BENCHMARK_SAMPLE_SETS` mirrors these keys to refuse unknown ids before
 * any spend: change both together.
 */
export const SAMPLE_SET_ALIASES: Readonly<Record<string, string>> = { default: CORE_SAMPLE_SET_ID, core: CORE_SAMPLE_SET_ID, [CORE_SAMPLE_SET_ID]: CORE_SAMPLE_SET_ID };

/** Canonical sample-set id for a requested id, or null when no such set ships with this runner. */
export function resolveSampleSetId(requested: string): string | null {
  return SAMPLE_SET_ALIASES[requested.trim().toLowerCase()] ?? null;
}

const languageName = (code: SourceLanguageCode): string => findLanguage(code)?.englishName ?? code;

/** Build a sample set for one (variety, source language). Throws for an unknown canonical id (resolve it first). */
export function buildSampleSet(id: string, input: { variety: VarietyId; source: SourceLanguageCode }): BenchmarkSampleSet {
  if (id !== CORE_SAMPLE_SET_ID) throw new Error(`Unknown benchmark sample set ${id}`);
  const pack = getPromptPack(input.variety);
  const source = languageName(input.source);
  const system = [
    `You are a native speaker of ${pack.name} taking part in a language-model benchmark. Reply ONLY in ${pack.name}, in one or two short, natural sentences, the way people actually talk.`,
    varietyGuardInstruction(pack, input.source),
    'Output JSON {"reply": "...", "transliteration": "..." | null}. "reply" is in the target variety; "transliteration" is a Latin transliteration only when the reply is not written in Latin script, else null.',
  ].join('\n');
  const opener = pack.exemplars[0]?.target ?? pack.recoveryLine.text;
  const mixed = pack.exemplars[1] ?? pack.exemplars[0];
  const mixedIn = mixed ? exemplarGloss(mixed, input.source).text : source;
  const samples: Array<Omit<BenchmarkSample, 'system'>> = [
    { id: 'greeting', user: 'Greet a learner in one short sentence and ask how they are.' },
    { id: 'service_exchange', user: 'You run a small café. A customer has just asked you for a coffee. Answer them and ask one follow-up question.' },
    { id: 'directions', user: 'A visitor asks you where the nearest bus stop is. Answer like a friendly local.' },
    { id: 'repair_request', user: 'You did not understand what the learner just said. Ask them, kindly, to say it again more slowly.' },
    { id: 'code_switch', user: `The learner writes to you: "${opener} … ${mixedIn}". They mixed ${source} into the message. Answer them only in ${pack.name}: never switch to ${source} or to another variety.` },
    { id: 'register', user: 'You work in a shop. Tell a customer politely, the way shop staff really say it, that the shop closes in ten minutes.' },
  ];
  return { id, version: CORE_SAMPLE_SET_VERSION, samples: samples.map((s) => ({ ...s, system })) };
}
