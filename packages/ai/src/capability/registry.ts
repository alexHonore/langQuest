/**
 * Capability registry (§8.2): locale → variety resolution, the no-variety-crossing rule, and the
 * `CapabilityRegistry` implementation that picks adapters by validated capability.
 */
import {
  COURSE_TRACKS,
  LANGUAGE_VARIETIES,
  NO_FEATURES,
  findCourseTrack,
  findVariety,
  getCourseTrack,
  isForbiddenSubstitution,
  tracksForVariety,
  unsupportedCapability,
  type Capability,
  type CapabilityRegistry,
  type CourseTrackId,
  type LanguageCode,
  type PronunciationAssessor,
  type PronunciationFeature,
  type RealtimeConversationProvider,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type VarietyId,
} from '@langquest/contracts';
import { isUsable, qualityEstimateFor, type SupportStatus } from './matrix';

const localeToVariety = new Map<string, VarietyId>();
const put = (locale: string | null | undefined, variety: VarietyId) => {
  if (!locale) return;
  const key = locale.toLowerCase();
  if (!localeToVariety.has(key)) localeToVariety.set(key, variety);
};
// Explicit, unambiguous mappings first.
put('arb', 'arb');
put('ar', 'arb');
put('ar-sa', 'arb');
put('ar-ps', 'ar-levant');
put('yue', 'yue');
put('yue-hk', 'yue');
put('zh-hk', 'yue');
put('zh-hant-hk', 'yue');
put('cmn', 'cmn');
put('zh-cn', 'cmn');
put('zh-tw', 'cmn');
put('zh-hans', 'cmn');
put('zh-hant', 'cmn');
put('zh-hans-cn', 'cmn');
put('zh-hant-tw', 'cmn');
for (const v of LANGUAGE_VARIETIES) {
  put(v.id, v.id);
  put(v.bcp47, v.id);
}
for (const t of COURSE_TRACKS) {
  put(t.defaultLocale, t.targetVarietyId);
  for (const r of t.regionalOptions) put(r.locale, t.targetVarietyId);
}
// A bare language code resolves only when the language has exactly one variety.
const varietiesByLanguage = new Map<LanguageCode, Set<VarietyId>>();
for (const v of LANGUAGE_VARIETIES) {
  const set = varietiesByLanguage.get(v.languageCode) ?? new Set<VarietyId>();
  set.add(v.id);
  varietiesByLanguage.set(v.languageCode, set);
}
for (const [lang, set] of varietiesByLanguage) {
  if (set.size === 1) put(lang, [...set][0] as VarietyId);
}

/**
 * Resolve a provider locale, BCP-47 tag, variety id or track id to the LangQuest variety it denotes.
 * Returns `null` for ambiguous inputs (`es`, `pt`, `zh`) or unknown locales — never a guess.
 */
export function resolveVariety(localeOrId: string): VarietyId | null {
  const direct = localeToVariety.get(localeOrId.toLowerCase());
  if (direct) return direct;
  const track = findCourseTrack(localeOrId);
  if (track) return track.targetVarietyId;
  // Regional sub-tags of an unambiguous language (e.g. `fr-BE`, `de-AT`, `en-NG`).
  const base = localeOrId.split(/[-_]/)[0]?.toLowerCase();
  if (base && base !== localeOrId.toLowerCase()) {
    const byBase = localeToVariety.get(base);
    if (byBase && (varietiesByLanguage.get(base as LanguageCode)?.size ?? 0) === 1) return byBase;
  }
  return null;
}

/** Provider locale to send for a variety (track default, or the matching regional option). */
export function providerLocaleFor(variety: VarietyId, regionalPreference?: string | null): string {
  const track = tracksForVariety(variety)[0];
  if (!track) return findVariety(variety)?.bcp47 ?? variety;
  if (regionalPreference) {
    const option = track.regionalOptions.find((o) => o.id === regionalPreference || (o.locale ?? '').toLowerCase() === regionalPreference.toLowerCase());
    if (option?.locale) return option.locale;
  }
  return track.defaultLocale;
}

export const trackForVariety = (variety: VarietyId): CourseTrackId => (tracksForVariety(variety)[0] ?? getCourseTrack('english')).id;

/**
 * Enforce "a fallback may never cross a variety boundary". Returns `null` when the candidate is acceptable,
 * otherwise an unsupported `Capability` naming the boundary.
 */
export function varietyBoundaryViolation(provider: string, requested: VarietyId, candidateLocale: string | null): Capability | null {
  if (candidateLocale === null) return null;
  const candidate = resolveVariety(candidateLocale);
  if (candidate === null) {
    return unsupportedCapability(provider, ['locale_unsupported'], [`Provider locale ${candidateLocale} does not map to a LangQuest variety`]);
  }
  if (candidate === requested) return null;
  const reason = isForbiddenSubstitution(requested, candidate) ? 'forbidden' : 'different';
  return unsupportedCapability(provider, ['variety_boundary'], [`Refusing to serve ${requested} with ${candidate} (${candidateLocale}): ${reason} variety substitution`]);
}

/** Build a `Capability` from a matrix status (used by adapters whose support is table-driven). */
export function capabilityFromStatus(input: {
  provider: string;
  status: SupportStatus;
  effectiveLocale: string;
  latencyClass: Capability['latencyClass'];
  features?: Partial<Capability['features']>;
  notes?: string[];
  evidence?: string;
}): Capability {
  const supported = isUsable(input.status);
  return {
    supported,
    reasons: supported ? (input.status === 'limited' ? ['not_benchmarked'] : []) : ['locale_unsupported'],
    features: { ...NO_FEATURES, ...(input.features ?? {}) },
    latencyClass: input.latencyClass,
    effectiveLocale: supported ? input.effectiveLocale : null,
    qualityEstimate: qualityEstimateFor(input.status),
    provider: input.provider,
    notes: [...(input.evidence ? [input.evidence] : []), ...(input.notes ?? [])],
  };
}

export interface DefaultCapabilityRegistryOptions {
  recognizers: readonly SpeechRecognizer[];
  synthesizers: readonly SpeechSynthesizer[];
  realtime: readonly RealtimeConversationProvider[];
  assessors: readonly PronunciationAssessor[];
}

/**
 * Resolves adapters by capability. Each adapter's `supports()` answer is additionally checked against the
 * variety boundary: an adapter whose `effectiveLocale` resolves to a different variety is skipped.
 */
export class DefaultCapabilityRegistry implements CapabilityRegistry {
  constructor(private readonly adapters: DefaultCapabilityRegistryOptions) {}

  async recognizerFor(locale: string): Promise<{ adapter: SpeechRecognizer; capability: Capability } | null> {
    return this.pick(locale, this.adapters.recognizers, (a) => a.supports(locale));
  }

  async synthesizerFor(locale: string, voiceId?: string): Promise<{ adapter: SpeechSynthesizer; capability: Capability } | null> {
    return this.pick(locale, this.adapters.synthesizers, (a) => a.supports(locale, voiceId));
  }

  async realtimeFor(locale: string, interruptible: boolean): Promise<{ adapter: RealtimeConversationProvider; capability: Capability } | null> {
    return this.pick(locale, this.adapters.realtime, (a) => a.supports(locale, interruptible));
  }

  async assessorFor(locale: string, features: readonly PronunciationFeature[]): Promise<{ adapter: PronunciationAssessor; capability: Capability } | null> {
    return this.pick(
      locale,
      this.adapters.assessors,
      async (a) => {
        const cap = await a.capability(locale);
        if (!cap.supported) return cap;
        const missing = features.filter((f) => !cap.features[f]);
        if (missing.length) return { ...cap, supported: false, reasons: [...cap.reasons, 'feature_unsupported'], notes: [...cap.notes, `Missing features: ${missing.join(', ')}`] };
        return cap;
      },
    );
  }

  private async pick<A extends { provider: string }>(locale: string, adapters: readonly A[], query: (adapter: A) => Promise<Capability>): Promise<{ adapter: A; capability: Capability } | null> {
    const requested = resolveVariety(locale);
    if (!requested) return null;
    for (const adapter of adapters) {
      const capability = await query(adapter);
      if (!capability.supported) continue;
      if (varietyBoundaryViolation(adapter.provider, requested, capability.effectiveLocale)) continue;
      return { adapter, capability };
    }
    return null;
  }
}
