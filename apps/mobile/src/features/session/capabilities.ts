/**
 * Capability → UI mapping for the learner app (CONVENTIONS §8, "visible means usable").
 *
 * The API attaches a `CourseCapabilities` snapshot to every enrollment DTO (and to the public
 * coverage endpoint before enrollment). This module turns it into two things:
 *
 * - `resolveNavigation`: which tabs / sections / controls are RENDERED for an enrollment. Anything
 *   the pair cannot use is omitted, never greyed out. An unknown snapshot (first offline run, a cached
 *   DTO from an older build) hides everything optional: the app never shows a feature it cannot prove.
 * - `buildDisclaimer` / `buildIncludes`: the plain lists shown before enrolling (wizard) and in the
 *   account's "What this course includes" screen. Copy comes from the `enrollment.disclaimer.*` keys;
 *   the `missing[].i18nKey` values are supplied by the server (`CAPABILITY_MISSING_I18N_KEYS`).
 *
 * Pure functions only (no React Native imports) so they are unit-tested under node.
 */
import type { CapabilityMissingItem, CapabilityMissingKey, CapabilityMissingSeverity, CourseCapabilities, CoverageStatus } from '@langquest/contracts';
import { COVERAGE_METADATA, SUPPORTED_UI_LOCALES, type SupportedUiLocale } from '@langquest/locales';

export type CapabilitySnapshot = CourseCapabilities | null | undefined;

/** What the learner app renders for one enrollment. Every flag defaults to `false` when the snapshot is unknown. */
export interface EnrollmentNavigation {
  /** The snapshot was present (false = unknown → everything optional hidden). */
  known: boolean;
  /** Missions tab + Home mission card. */
  missions: boolean;
  /** Audio tab, "Continue audio" button and the global mini player. */
  audio: boolean;
  /** Speak tab (live conversation and/or pronunciation drills). */
  speak: boolean;
  /** Live AI conversation (quick speak, character cards, conversation screen). */
  liveConversation: boolean;
  /** Voice controls inside the conversation (mic, hands-free). Text-only otherwise. */
  conversationVoice: boolean;
  /** Pronunciation coach with mic (needs mission expressions + some spoken feedback mode). */
  pronunciationDrills: boolean;
  /** Numeric pronunciation score UI (acoustic assessor only). */
  numericScore: boolean;
  /** Offline download controls (media storage configured + something downloadable + platform support). */
  downloads: boolean;
}

export const HIDDEN_NAVIGATION: EnrollmentNavigation = Object.freeze({
  known: false,
  missions: false,
  audio: false,
  speak: false,
  liveConversation: false,
  conversationVoice: false,
  pronunciationDrills: false,
  numericScore: false,
  downloads: false,
});

export interface NavigationOptions {
  /** Platform support for download packs (false on web, where expo-file-system has no `Directory`). */
  downloadsSupported?: boolean;
}

/** Tabs / sections / controls for a capability snapshot. Unknown → `HIDDEN_NAVIGATION` (hide, never guess). */
export function resolveNavigation(caps: CapabilitySnapshot, options: NavigationOptions = {}): EnrollmentNavigation {
  if (!caps) return HIDDEN_NAVIGATION;
  const missions = caps.missions.available && caps.missions.publishedCount > 0;
  const audio = caps.audioLibrary.available && caps.audioLibrary.publishedCollections > 0;
  const liveConversation = caps.liveConversation.available && caps.liveConversation.characterCount > 0 && caps.liveConversation.mode !== 'none';
  const conversationVoice = liveConversation && caps.liveConversation.mode === 'text_and_voice';
  // Drills read their expressions from the mission pathway; without missions there is nothing to drill.
  const pronunciationDrills = missions && caps.pronunciationScoring.mode !== 'none';
  const numericScore = pronunciationDrills && caps.pronunciationScoring.mode === 'acoustic';
  const downloads = audio && caps.offlineDownloads.available && (options.downloadsSupported ?? true);
  return {
    known: true,
    missions,
    audio,
    speak: liveConversation || pronunciationDrills,
    liveConversation,
    conversationVoice,
    pronunciationDrills,
    numericScore,
    downloads,
  };
}

/**
 * Download settings (Wi-Fi only, offline auto-download) are shown only when at least one of the learner's
 * enrollments can actually download (CONVENTIONS §8). Device QA 2026-10-20 found both switches on an
 * Arabic-from-French account with no audio library and R2 off.
 */
export function downloadsOfferedForAny(snapshots: readonly CapabilitySnapshot[], options: NavigationOptions = {}): boolean {
  return snapshots.some((caps) => resolveNavigation(caps, options).downloads);
}

/** Expo Router tab routes, in bar order, that an enrollment can use. Home and Progress are always present. */
export type LearnerTab = 'index' | 'missions' | 'audio' | 'speak' | 'progress';
export function visibleTabs(nav: EnrollmentNavigation): LearnerTab[] {
  const tabs: LearnerTab[] = ['index'];
  if (nav.missions) tabs.push('missions');
  if (nav.audio) tabs.push('audio');
  if (nav.speak) tabs.push('speak');
  tabs.push('progress');
  return tabs;
}

/** Primary Home call-to-action: the mission card when missions exist, else live conversation, else nothing. */
export type HomeCta = 'missions' | 'speak' | null;
export function homeCta(nav: EnrollmentNavigation): HomeCta {
  if (nav.missions) return 'missions';
  if (nav.liveConversation) return 'speak';
  return null;
}

// ---------------------------------------------------------------------------
// Disclaimer (before enrolling) and "What this course includes" (after)
// ---------------------------------------------------------------------------

export type Translate = (key: string, values?: Record<string, string | number | boolean | null | undefined | Date>) => string;

export interface DisclaimerLine {
  key: CapabilityMissingKey;
  severity: CapabilityMissingSeverity;
  text: string;
}

export interface Disclaimer {
  /** "What this course does not have yet" */
  title: string;
  /** Short explanation that hidden features reappear when ready. */
  intro: string;
  /** One line per missing item, blocking first (server order is kept, then stabilised by severity). */
  lines: DisclaimerLine[];
  /** True when the pair has no usable learning content at all (any blocking item). */
  blocking: boolean;
  /** Editorial status line for the instruction language ("Partly available from French"). */
  instructionLanguageStatus: string;
  /** Extra caption when the pair is not native-reviewed and not unavailable; null otherwise. */
  nativeReviewCaption: string | null;
  /** "Everything is available for this course from French." when `lines` is empty. */
  allAvailable: string | null;
}

export interface DisclaimerNames {
  /** Instruction language display name ("French"). */
  source: string;
  /** Course display name ("Arabic (Moroccan)"). */
  target: string;
}

const SEVERITY_ORDER: Record<CapabilityMissingSeverity, number> = { blocking: 0, info: 1 };

/** Server order first (blocking first by contract), then a stable sort by severity as a safety net. */
export function orderMissing(missing: readonly CapabilityMissingItem[]): CapabilityMissingItem[] {
  return missing.map((m, i) => ({ m, i })).sort((a, b) => SEVERITY_ORDER[a.m.severity] - SEVERITY_ORDER[b.m.severity] || a.i - b.i).map((x) => x.m);
}

/** Lines for the enrollment wizard and the account screen. `caps` unknown → null (render nothing, never a guess). */
export function buildDisclaimer(caps: CapabilitySnapshot, t: Translate, names: DisclaimerNames): Disclaimer | null {
  if (!caps) return null;
  const values = { source: names.source, target: names.target };
  const lines = orderMissing(caps.missing).map((m) => ({ key: m.key, severity: m.severity, text: t(m.i18nKey, values) }));
  const status: CoverageStatus = caps.instructionLanguage.status;
  return {
    title: t('enrollment.disclaimer.missingTitle', values),
    intro: t('enrollment.disclaimer.intro', values),
    lines,
    blocking: lines.some((l) => l.severity === 'blocking'),
    instructionLanguageStatus: t(`enrollment.coverage.${status}`, values),
    nativeReviewCaption: !caps.instructionLanguage.nativeReviewed && status !== 'unavailable' ? t('catalog.notNativeReviewed', values) : null,
    allAvailable: lines.length === 0 ? t('enrollment.disclaimer.allAvailable', values) : null,
  };
}

export interface IncludesLine {
  key: 'missions' | 'audioLibrary' | 'liveConversation' | 'liveConversationTextOnly' | 'pronunciationAcoustic' | 'pronunciationReference' | 'offlineDownloads';
  text: string;
}

/** What IS available for the pair (counts from the snapshot). Empty when nothing is usable; unknown → null. */
export function buildIncludes(caps: CapabilitySnapshot, t: Translate, options: NavigationOptions = {}): IncludesLine[] | null {
  if (!caps) return null;
  const nav = resolveNavigation(caps, options);
  const out: IncludesLine[] = [];
  if (nav.missions) out.push({ key: 'missions', text: t('enrollment.disclaimer.includes.missions', { count: caps.missions.publishedCount }) });
  if (nav.audio) out.push({ key: 'audioLibrary', text: t('enrollment.disclaimer.includes.audioLibrary', { count: caps.audioLibrary.publishedCollections }) });
  if (nav.liveConversation) {
    const key = nav.conversationVoice ? 'liveConversation' : 'liveConversationTextOnly';
    out.push({ key, text: t(`enrollment.disclaimer.includes.${key}`, { count: caps.liveConversation.characterCount }) });
  }
  if (nav.numericScore) out.push({ key: 'pronunciationAcoustic', text: t('enrollment.disclaimer.includes.pronunciationAcoustic') });
  else if (nav.pronunciationDrills) out.push({ key: 'pronunciationReference', text: t('enrollment.disclaimer.includes.pronunciationReference') });
  if (nav.downloads) out.push({ key: 'offlineDownloads', text: t('enrollment.disclaimer.includes.offlineDownloads') });
  return out;
}

// ---------------------------------------------------------------------------
// Interface languages
// ---------------------------------------------------------------------------

/**
 * UI locales offered in the language pickers: only catalogs that are 100% complete. Partial catalogs (es, ru)
 * stay selectable as INSTRUCTION languages wherever a course has coverage; they are not offered as the app's
 * chrome language until completed (docs/UPCOMING_FEATURES.md).
 */
export function completeUiLocales(metadata: { locales: Readonly<Record<string, { pct?: number; status: string }>> } = COVERAGE_METADATA, supported: readonly SupportedUiLocale[] = SUPPORTED_UI_LOCALES): SupportedUiLocale[] {
  const out = supported.filter((code) => {
    const c = metadata.locales[code];
    return Boolean(c) && c!.status === 'complete' && (c!.pct ?? 0) >= 100;
  });
  // The base locale is always a valid chrome language, whatever the metadata says.
  return out.length > 0 ? out : ['en'];
}

/** Numeric pronunciation data is dropped client-side whenever the pair has no acoustic assessor (belt and braces). */
export function withoutNumericScore<T extends { pronunciation: { numericScore: number | null; wordScores: unknown[] } }>(result: T, nav: Pick<EnrollmentNavigation, 'numericScore'>): T {
  if (nav.numericScore) return result;
  if (result.pronunciation.numericScore === null && result.pronunciation.wordScores.length === 0) return result;
  return { ...result, pronunciation: { ...result.pronunciation, numericScore: null, wordScores: [] } };
}
