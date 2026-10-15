/**
 * Language guard (§8.4, §15 "AI responds in wrong dialect"): checks generated text for the expected script
 * and variety markers with heuristics, optionally confirms with an LLM verifier, and reports quality incidents.
 * The guard never rewrites text — callers re-prompt or fall back to the pack's recovery line.
 */
import { z } from 'zod';
import { UnitIntervalSchema, findLanguage, getCourseTrack, getVariety, tracksForVariety, type AiTaskName, type CourseTrackId, type LanguageContext, type ScriptId, type ScriptMode, type SourceLanguageCode, type TextReasoner, type VarietyId } from '@langquest/contracts';
import { getPromptPack, resolveRegionalPreference, sourceLeakMarkers, type GuardMarkerSet } from './packs';

export type DetectedScript = ScriptId | 'Han' | 'mixed' | 'none';

const RANGES: ReadonlyArray<{ script: DetectedScript; re: RegExp }> = [
  { script: 'Arab', re: /[؀-ۿݐ-ݿ]/gu },
  { script: 'Hebr', re: /[֐-׿]/gu },
  { script: 'Cyrl', re: /[Ѐ-ӿ]/gu },
  { script: 'Grek', re: /[Ͱ-Ͽἀ-῿]/gu },
  { script: 'Deva', re: /[ऀ-ॿ]/gu },
  { script: 'Kore', re: /[가-힯ᄀ-ᇿ]/gu },
  { script: 'Jpan', re: /[぀-ヿ]/gu },
  { script: 'Han', re: /[㐀-鿿豈-﫿]/gu },
  { script: 'Latn', re: /[A-Za-zÀ-ɏḀ-ỿ]/gu },
];

/** Count letters per script; returns the dominant script (`mixed` when two scripts both exceed 25%). */
export function detectScript(text: string): { dominant: DetectedScript; counts: Partial<Record<DetectedScript, number>> } {
  const counts: Partial<Record<DetectedScript, number>> = {};
  let total = 0;
  for (const { script, re } of RANGES) {
    const n = (text.match(re) ?? []).length;
    if (n) {
      counts[script] = n;
      total += n;
    }
  }
  if (!total) return { dominant: 'none', counts };
  // Japanese text mixes kana and Han; treat Han as Jpan when kana are present.
  if (counts.Jpan && counts.Han) {
    counts.Jpan += counts.Han;
    delete counts.Han;
  }
  const sorted = (Object.entries(counts) as Array<[DetectedScript, number]>).sort((a, b) => b[1] - a[1]);
  const [first, second] = sorted;
  if (first && second && second[1] / total > 0.25 && !(first[0] === 'Latn' || second[0] === 'Latn')) return { dominant: 'mixed', counts };
  return { dominant: first ? first[0] : 'none', counts };
}

/** Small simplified↔traditional discriminator set (characters that differ between the two). */
const SIMPLIFIED_ONLY = '这个们没么说对时间买车电话东见门问开关书学习头发办饭让谁车汉语儿点钱几';
const TRADITIONAL_ONLY = '這個們沒麼說對時間買車電話東見門問開關書學習頭髮辦飯讓誰漢語兒點錢幾';

export function detectHanVariant(text: string): 'Hans' | 'Hant' | 'unknown' {
  let s = 0;
  let t = 0;
  for (const ch of text) {
    if (SIMPLIFIED_ONLY.includes(ch)) s += 1;
    else if (TRADITIONAL_ONLY.includes(ch)) t += 1;
  }
  if (s === 0 && t === 0) return 'unknown';
  return s > t ? 'Hans' : 'Hant';
}

export type GuardIssueKind = 'wrong_script' | 'wrong_han_variant' | 'wrong_variety' | 'source_language_leak' | 'empty';

export interface GuardIssue {
  kind: GuardIssueKind;
  detail: string;
  /** Variety the text looks like, when identifiable. */
  suspectedVariety: VarietyId | 'other' | null;
}

export interface GuardResult {
  ok: boolean;
  issues: GuardIssue[];
  /** 0..1 confidence in the verdict (heuristic evidence strength). */
  confidence: number;
  positiveHits: number;
  negativeHits: Array<{ varietyId: VarietyId | 'other'; label: string; hits: string[] }>;
  verifiedByLlm: boolean;
}

export interface QualityIncident {
  kind: GuardIssueKind;
  varietyId: VarietyId;
  task: AiTaskName;
  model: string | null;
  detail: string;
  textFingerprint: string;
  at: string;
}

export interface QualityIncidentSink {
  record(incident: QualityIncident): void | Promise<void>;
}

export class MemoryQualityIncidentSink implements QualityIncidentSink {
  readonly incidents: QualityIncident[] = [];
  record(incident: QualityIncident): void {
    this.incidents.push(incident);
  }
}

export const LanguageVerdictSchema = z.object({
  isTargetVariety: z.boolean(),
  detectedVariety: z.string().max(40),
  confidence: UnitIntervalSchema,
  reason: z.string().max(200),
});
export type LanguageVerdict = z.infer<typeof LanguageVerdictSchema>;

export interface LanguageGuardOptions {
  /** Optional LLM verifier used when heuristics are inconclusive or `verifyWithLlm` is forced. */
  reasoner?: TextReasoner | null;
  incidents?: QualityIncidentSink | null;
  /** Minimum negative-marker hits (with zero positives) to flag `wrong_variety` heuristically. */
  negativeThreshold?: number;
}

/** Han variant a regional option's locale implies (`zh-TW`/`zh-HK`/`zh-MO` → Hant, `zh-CN`/`zh-SG` → Hans). */
const hanVariantForLocale = (locale: string | null | undefined): 'Hans' | 'Hant' | null => {
  if (!locale) return null;
  const region = locale.split(/[-_]/).map((p) => p.toLowerCase());
  if (region.includes('hant') || region.includes('tw') || region.includes('hk') || region.includes('mo')) return 'Hant';
  if (region.includes('hans') || region.includes('cn') || region.includes('sg')) return 'Hans';
  return null;
};

export interface HeuristicOptions {
  allowTransliterationOnly?: boolean;
  /** Enrollment source language: enables detection of the character answering in the learner's own language. */
  sourceLanguage?: SourceLanguageCode;
  /** Learner's regional option id or locale (e.g. `TW`, `zh-TW`); decides the expected Han variant for Mandarin. */
  regionalPreference?: string | null;
  /** Course track (a `scriptFocus: 'Hans'` track pins the Han variant). */
  track?: CourseTrackId | null;
}

/**
 * Expected script for a variety. The Han variant is pinned for Cantonese (Hant) and for tracks with a
 * `scriptFocus`; Mandarin otherwise follows the learner's regional choice (TW → Hant, CN → Hans) and accepts
 * both when no region was chosen, because Traditional-script Mandarin is still Mandarin, not Cantonese.
 */
const expectedScriptFor = (variety: VarietyId, scriptMode: ScriptMode, opts: Pick<HeuristicOptions, 'regionalPreference' | 'track'> = {}): { script: ScriptId; allowLatin: boolean; hanVariant: 'Hans' | 'Hant' | null } => {
  const tracks = tracksForVariety(variety);
  const track = (opts.track ? tracks.find((t) => t.id === opts.track) : null) ?? tracks[0] ?? getCourseTrack('english');
  const primary = track.scripts.primary;
  const isHan = primary === 'Hans' || primary === 'Hant';
  let hanVariant: 'Hans' | 'Hant' | null = null;
  if (isHan) {
    if (track.scriptFocus === 'Hans' || track.scriptFocus === 'Hant') hanVariant = track.scriptFocus;
    else if (!track.scripts.alternatives.some((a) => a === 'Hans' || a === 'Hant')) hanVariant = primary;
    else if (opts.regionalPreference) {
      const pref = opts.regionalPreference;
      const option = track.regionalOptions.find((o) => o.id === pref || (o.locale ?? '').toLowerCase() === pref.toLowerCase());
      hanVariant = hanVariantForLocale(option?.locale ?? pref);
    }
  }
  return { script: primary, allowLatin: scriptMode === 'latin' || primary === 'Latn', hanVariant };
};

const countMarkers = (normalized: string, markers: readonly string[]): string[] => {
  const hits: string[] = [];
  for (const m of markers) {
    const needle = m.toLowerCase();
    const isLatin = /^[a-zÀ-ɏ' ]+$/i.test(needle);
    const found = isLatin ? new RegExp(`(^|[^\\p{L}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'u').test(normalized) : normalized.includes(needle);
    if (found) hits.push(m);
  }
  return hits;
};

export class LanguageGuard {
  private readonly reasoner: TextReasoner | null;
  private readonly incidents: QualityIncidentSink | null;
  private readonly negativeThreshold: number;

  constructor(options: LanguageGuardOptions = {}) {
    this.reasoner = options.reasoner ?? null;
    this.incidents = options.incidents ?? null;
    this.negativeThreshold = options.negativeThreshold ?? 2;
  }

  /** Pure heuristic check (sync, no network). */
  checkHeuristic(text: string, variety: VarietyId, scriptMode: ScriptMode = 'native', opts: HeuristicOptions = {}): GuardResult {
    const issues: GuardIssue[] = [];
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, issues: [{ kind: 'empty', detail: 'Empty output', suspectedVariety: null }], confidence: 1, positiveHits: 0, negativeHits: [], verifiedByLlm: false };

    const pack = getPromptPack(variety);
    const expected = expectedScriptFor(variety, scriptMode, opts);
    const { dominant } = detectScript(trimmed);
    const scriptOk =
      dominant === expected.script ||
      (dominant === 'Han' && (expected.script === 'Hans' || expected.script === 'Hant')) ||
      (dominant === 'Latn' && (expected.allowLatin || opts.allowTransliterationOnly === true)) ||
      (dominant === 'mixed' && scriptMode === 'both');
    if (!scriptOk) issues.push({ kind: 'wrong_script', detail: `Expected ${expected.script} script, detected ${dominant}`, suspectedVariety: null });
    if (expected.hanVariant && (dominant === 'Han' || dominant === 'mixed')) {
      const variant = detectHanVariant(trimmed);
      // A Hans/Hant mismatch is only evidence of Cantonese→Mandarin substitution for a Cantonese course; for
      // Mandarin it is a script-preference issue (Traditional Mandarin is still Mandarin), never a yue suspicion.
      if (variant !== 'unknown' && variant !== expected.hanVariant) issues.push({ kind: 'wrong_han_variant', detail: `Expected ${expected.hanVariant} characters, detected ${variant}`, suspectedVariety: variety === 'yue' && variant === 'Hans' ? 'cmn' : null });
    }

    const normalized = trimmed.toLowerCase().normalize('NFKC').replace(/[ً-ْـ]/g, '');
    const positiveHits = countMarkers(normalized, pack.guard.positive).length;
    const negativeSets = [...pack.guard.negative, ...(opts.sourceLanguage ? sourceLeakNegatives(variety, pack.guard, opts.sourceLanguage) : [])];
    const negativeHits = negativeSets.map((n) => ({ varietyId: n.varietyId, label: n.label, hits: countMarkers(normalized, n.markers) })).filter((n) => n.hits.length > 0);
    for (const n of negativeHits) {
      const strong = n.hits.length >= this.negativeThreshold && n.hits.length > positiveHits;
      if (!strong) continue;
      if (n.varietyId === 'other') issues.push({ kind: 'source_language_leak', detail: `${n.label} markers: ${n.hits.join(', ')}`, suspectedVariety: 'other' });
      else issues.push({ kind: 'wrong_variety', detail: `${n.label} markers (${n.hits.join(', ')}) outweigh ${pack.name} markers (${positiveHits})`, suspectedVariety: n.varietyId });
    }
    const evidence = positiveHits + negativeHits.reduce((a, n) => a + n.hits.length, 0);
    const confidence = issues.some((i) => i.kind === 'wrong_script' || i.kind === 'wrong_han_variant') ? 0.95 : Math.min(0.9, 0.4 + evidence * 0.12);
    return { ok: issues.length === 0, issues, confidence, positiveHits, negativeHits, verifiedByLlm: false };
  }

  /**
   * Heuristic check, then (when a reasoner is configured and the verdict is weak or `verifyWithLlm` is set)
   * an LLM verifier. Records a quality incident for every confirmed failure.
   */
  async check(text: string, language: LanguageContext, context: { task: AiTaskName; model?: string | null; verifyWithLlm?: boolean; allowTransliterationOnly?: boolean } ): Promise<GuardResult> {
    const variety = language.targetVariety;
    let result = this.checkHeuristic(text, variety, language.targetScriptMode, { allowTransliterationOnly: context.allowTransliterationOnly, sourceLanguage: language.sourceLanguage, regionalPreference: language.regionalPreference ?? null, track: language.targetTrack });
    const inconclusive = result.ok && result.confidence < 0.6;
    if (this.reasoner && (context.verifyWithLlm || inconclusive || (!result.ok && result.issues.every((i) => i.kind === 'wrong_variety')))) {
      const pack = getPromptPack(variety);
      const leak = sourceLeakNegatives(variety, pack.guard, language.sourceLanguage)[0] ?? null;
      const region = regionalLabel(language);
      try {
        const verdict = await this.reasoner.generateStructured(
          'language_quality_check',
          language,
          {
            templateId: 'guard.language_verdict',
            templateVersion: '2026-10-14.1',
            system: `You are a strict dialect/variety classifier. Decide whether the text is written in ${pack.name} (${variety})${region ? ` (learner's regional preference: ${region}; regional wording within ${pack.name} is correct)` : ''}. Varieties that must NOT be confused with it: ${[...pack.guard.negative.map((n) => n.label), ...(leak ? [leak.label] : [])].join(', ')}. Judge grammar and lexicon, not topic. Return JSON only.`,
            user: `Text:\n"""${text.slice(0, 1200)}"""`,
          },
          LanguageVerdictSchema,
        );
        const llmOk = verdict.isTargetVariety && verdict.confidence >= 0.5;
        if (!llmOk) {
          const issue: GuardIssue = { kind: 'wrong_variety', detail: `LLM verifier: ${verdict.detectedVariety} (${verdict.reason})`, suspectedVariety: null };
          result = { ...result, ok: false, issues: result.ok ? [issue] : [...result.issues, issue], confidence: Math.max(result.confidence, verdict.confidence), verifiedByLlm: true };
        } else {
          result = { ...result, ok: result.issues.every((i) => i.kind === 'wrong_variety') ? true : result.ok, issues: result.issues.filter((i) => i.kind !== 'wrong_variety'), confidence: Math.max(result.confidence, verdict.confidence), verifiedByLlm: true };
        }
      } catch {
        // Verifier unavailable: keep the heuristic verdict (never block on the verifier).
      }
    }
    if (!result.ok && this.incidents) {
      for (const issue of result.issues) {
        await this.incidents.record({ kind: issue.kind, varietyId: variety, task: context.task, model: context.model ?? null, detail: issue.detail, textFingerprint: fingerprint(text), at: new Date().toISOString() });
      }
    }
    return result;
  }
}

/**
 * Negative marker set for the enrollment's source language ("the character answered in the learner's own
 * language"). Empty when the source language IS the target language, or when the pack already guards that
 * language as a confusable variety (e.g. French for Haitian Creole), so a leak is reported exactly once.
 */
export function sourceLeakNegatives(variety: VarietyId, guard: GuardMarkerSet, source: SourceLanguageCode): GuardMarkerSet['negative'] {
  if (getVariety(variety).languageCode === source) return [];
  if (guard.negative.some((n) => n.varietyId !== 'other' && getVariety(n.varietyId).languageCode === source)) return [];
  const markers = sourceLeakMarkers(source);
  if (!markers.length) return [];
  const name = findLanguage(source)?.englishName ?? source;
  return [{ varietyId: 'other', label: `${name} (source language ${source}) leak`, markers }];
}

/** Human-readable regional option for the verdict prompt (`Lebanese (ar-LB)`), or null when none was chosen. */
const regionalLabel = (language: LanguageContext): string | null => resolveRegionalPreference(language.targetTrack, language.regionalPreference)?.label ?? null;

const fingerprint = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${h.toString(16).padStart(8, '0')}:${text.length}`;
};
