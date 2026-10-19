/**
 * Course capabilities per (track × instruction language) — CONVENTIONS §8 "visible means usable".
 *
 * `deriveCourseCapabilities` is pure (unit-tested): published-content counts + coverage row + deployment flags →
 * the `CourseCapabilities` snapshot with its `missing[]` disclaimer items. `courseCapabilitiesFor` loads the counts
 * (service role; all public information) with a short cache (`COUNTS_TTL_SECONDS`) so the enrollment DTO, the
 * coverage endpoint and the manifest can all carry the snapshot without a query storm.
 *
 * Invariants:
 * - a capability is never `available` while its backing count is 0 (missions, audio collections, characters);
 * - missions need the editorial gate too: coverage `partial` / `complete` for THIS source (a `planned` pair stays
 *   hidden even if drafts exist — the editor flips the status, UX observation #7);
 * - offline downloads need media storage AND something downloadable (a published audio library for the pair);
 * - conversation/pronunciation modes come from the evidence-backed matrix in `@langquest/ai`, gated by the
 *   configured providers (no OpenRouter key → `none`, never a pretend "text_only").
 */
import { capabilityForTrack, isUsable } from '@langquest/ai/capability/matrix';
import { CAPABILITY_MISSING_I18N_KEYS, CourseCapabilitiesSchema, getCourseTrack, hasUsableContent, type CapabilityMissingItem, type CapabilityMissingKey, type CourseCapabilities, type CourseTrackId, type SourceCoverage, type SourceLanguageCode } from '@langquest/contracts';
import { COVERAGE_METADATA } from '@langquest/locales/coverage';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { pronunciationScoringLevel } from './capabilities';
import { coverageToDto, COVERAGE_COLUMNS, plannedCoverage, type CoverageRow } from './dto';
import { courseCapabilityCountsKey } from '../services/cache';
import type { RequestServices } from '../services/context';

/** Short cache for the DB-derived counts: publish/unpublish of a course also purges it (`invalidateCourse`). */
export const COUNTS_TTL_SECONDS = 60;

export interface CapabilityCounts {
  /** Published missions reachable through published `lesson_courses → chapters` of the track. */
  publishedMissions: number;
  /** Of those, missions with a `mission_localizations` row for the source language. */
  localizedMissions: number;
  /** Published `audio_course_collections` of the track whose `instruction_language_code` is the source. */
  publishedAudioCollections: number;
  /** Published characters of the track's variety. */
  publishedCharacters: number;
}

export interface CapabilityEnvFlags {
  /** OpenRouter configured: text reasoner, STT, TTS routes exist. */
  openRouter: boolean;
  /** Azure Speech configured: acoustic pronunciation assessor may apply (per locale). */
  azure: boolean;
  /** Any media transport (R2 binding or S3 credentials) — playback and download packs. */
  mediaAvailable: boolean;
}

export interface DeriveCapabilitiesInput {
  trackId: CourseTrackId;
  sourceLanguageCode: SourceLanguageCode;
  counts: CapabilityCounts;
  /** Coverage of the pair; `null` = no row yet (treated as `planned`). */
  coverage: Pick<SourceCoverage, 'status' | 'nativeReviewed' | 'metrics'> | null;
  env: CapabilityEnvFlags;
  /** Completeness (0..100) of the `@langquest/locales` catalog for the source language; `null` = no catalog. */
  sourceCatalogPct: number | null;
  now?: Date;
}

export const capabilityEnvFlags = (s: Pick<RequestServices, 'config' | 'media'>): CapabilityEnvFlags => ({
  openRouter: Boolean(s.config.env.OPENROUTER_API_KEY),
  azure: Boolean(s.config.env.AZURE_SPEECH_KEY && s.config.env.AZURE_SPEECH_REGION),
  mediaAvailable: s.media.available || s.media.canPresign,
});

export const sourceCatalogPct = (source: string): number | null => COVERAGE_METADATA.locales[source]?.pct ?? null;

const item = (key: CapabilityMissingKey, severity: CapabilityMissingItem['severity']): CapabilityMissingItem => ({ key, i18nKey: CAPABILITY_MISSING_I18N_KEYS[key], severity });

/** Pure derivation; see the module header for the rules. */
export function deriveCourseCapabilities(input: DeriveCapabilitiesInput): CourseCapabilities {
  const track = getCourseTrack(input.trackId);
  const coverage = input.coverage ?? plannedCoverage(input.sourceLanguageCode);
  const { counts, env } = input;
  const matrix = capabilityForTrack(input.trackId);

  const editorialOpen = coverage.status === 'partial' || coverage.status === 'complete';
  const missions = {
    available: editorialOpen && counts.publishedMissions > 0 && counts.localizedMissions > 0,
    publishedCount: counts.publishedMissions,
    localizedCount: counts.localizedMissions,
  };
  const audioLibrary = { available: counts.publishedAudioCollections > 0, publishedCollections: counts.publishedAudioCollections };
  const conversationAvailable = env.openRouter && counts.publishedCharacters > 0;
  const voice = isUsable(matrix.stt.status) && isUsable(matrix.tts.status);
  const liveConversation = {
    available: conversationAvailable,
    characterCount: counts.publishedCharacters,
    mode: (!conversationAvailable ? 'none' : voice ? 'text_and_voice' : 'text_only') as CourseCapabilities['liveConversation']['mode'],
  };
  const level = env.openRouter ? pronunciationScoringLevel(input.trackId, env.azure) : 'none';
  const pronunciationScoring = { mode: (level === 'full' || level === 'partial' ? 'acoustic' : level === 'limited' ? 'reference_comparison' : 'none') as CourseCapabilities['pronunciationScoring']['mode'] };
  const offlineDownloads = { available: env.mediaAvailable && audioLibrary.available };

  const usable = hasUsableContent({ missions, audioLibrary, liveConversation });
  const missing: CapabilityMissingItem[] = [];
  if (coverage.status === 'unavailable') missing.push(item('instruction_language_unavailable', 'blocking'));
  else if (coverage.status === 'planned') missing.push(item('instruction_language_planned', 'blocking'));
  if (!missions.available) missing.push(item('no_missions', usable ? 'info' : 'blocking'));
  if (coverage.status === 'partial' || (coverage.status === 'complete' && !coverage.nativeReviewed)) missing.push(item('instruction_language_draft', 'info'));
  if (!audioLibrary.available) missing.push(item('no_audio_library', 'info'));
  if (!liveConversation.available) missing.push(item('no_live_conversation', 'info'));
  else if (liveConversation.mode === 'text_only') missing.push(item('text_only_conversation', 'info'));
  if (pronunciationScoring.mode === 'reference_comparison') missing.push(item('no_pronunciation_scoring', 'info'));
  else if (pronunciationScoring.mode === 'none') missing.push(item('no_pronunciation_feedback', 'info'));
  if (audioLibrary.available && !offlineDownloads.available) missing.push(item('no_offline_downloads', 'info'));
  if ((input.sourceCatalogPct ?? 0) < 100) missing.push(item('partial_interface_language', 'info'));
  missing.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1));

  return CourseCapabilitiesSchema.parse({
    courseTrackId: input.trackId,
    sourceLanguageCode: input.sourceLanguageCode,
    targetVarietyId: track.targetVarietyId,
    missions,
    audioLibrary,
    liveConversation,
    pronunciationScoring,
    offlineDownloads,
    instructionLanguage: { status: coverage.status, nativeReviewed: coverage.nativeReviewed, metrics: coverage.metrics },
    scripts: { modes: track.scriptModeOptions },
    regionalOptions: track.regionalOptions,
    missing,
    computedAt: (input.now ?? new Date()).toISOString(),
  });
}

/** Published-content counts for one pair (service role: public information, independent of the caller). */
export async function loadCapabilityCounts(s: Pick<RequestServices, 'service'>, trackId: CourseTrackId, source: SourceLanguageCode): Promise<CapabilityCounts> {
  const variety = getCourseTrack(trackId).targetVarietyId;
  const [missions, audio, characters] = await Promise.all([
    s.service
      .from('missions')
      .select('id, mission_localizations(source_language_code), chapters!inner(state, lesson_courses!inner(course_track_id, state))')
      .eq('state', 'published')
      .eq('chapters.state', 'published')
      .eq('chapters.lesson_courses.state', 'published')
      .eq('chapters.lesson_courses.course_track_id', trackId),
    s.service.from('audio_course_collections').select('id', { count: 'exact', head: true }).eq('state', 'published').eq('course_track_id', trackId).eq('instruction_language_code', source),
    s.service.from('characters').select('id', { count: 'exact', head: true }).eq('state', 'published').eq('target_variety_id', variety),
  ]);
  const missionRows = (missions.data ?? []) as unknown as { mission_localizations: { source_language_code: string }[] | null }[];
  return {
    publishedMissions: missionRows.length,
    localizedMissions: missionRows.filter((m) => (m.mission_localizations ?? []).some((l) => l.source_language_code === source)).length,
    publishedAudioCollections: audio.count ?? 0,
    publishedCharacters: characters.count ?? 0,
  };
}

async function cachedCounts(s: Pick<RequestServices, 'service' | 'cache'>, trackId: CourseTrackId, source: SourceLanguageCode): Promise<CapabilityCounts> {
  const key = courseCapabilityCountsKey(trackId, source);
  const hit = await s.cache.get(key);
  if (hit) {
    try {
      return JSON.parse(hit.body) as CapabilityCounts;
    } catch {
      /* fall through to a fresh load */
    }
  }
  const counts = await loadCapabilityCounts(s, trackId, source);
  await s.cache.put(key, JSON.stringify(counts), COUNTS_TTL_SECONDS);
  return counts;
}

/**
 * Snapshot for one pair. Pass the coverage row when the caller already has it (enrollment DTOs); otherwise it is
 * read here. Counts come from the short cache; coverage and env are always current.
 */
export async function courseCapabilitiesFor(s: Pick<RequestServices, 'service' | 'cache' | 'config' | 'media'>, trackId: CourseTrackId, source: SourceLanguageCode, coverageRow?: CoverageRow | null): Promise<CourseCapabilities> {
  let row = coverageRow;
  if (row === undefined) {
    const res = await s.service.from('course_source_localizations').select(COVERAGE_COLUMNS).eq('course_track_id', trackId).eq('source_language_code', source).maybeSingle();
    row = (res.data as CoverageRow | null) ?? null;
  }
  const counts = await cachedCounts(s, trackId, source);
  return deriveCourseCapabilities({ trackId, sourceLanguageCode: source, counts, coverage: row ? coverageToDto(row) : null, env: capabilityEnvFlags(s), sourceCatalogPct: sourceCatalogPct(source) });
}

/** Snapshots for several pairs (deduplicated); used by enrollment lists and `/v1/me`. */
export async function courseCapabilitiesForPairs(s: Pick<RequestServices, 'service' | 'cache' | 'config' | 'media'>, pairs: { trackId: CourseTrackId; source: SourceLanguageCode; coverageRow: CoverageRow | null }[]): Promise<Map<string, CourseCapabilities>> {
  const out = new Map<string, CourseCapabilities>();
  const unique = new Map<string, (typeof pairs)[number]>();
  for (const p of pairs) unique.set(`${p.trackId}|${p.source}`, p);
  await Promise.all([...unique].map(async ([key, p]) => out.set(key, await courseCapabilitiesFor(s, p.trackId, p.source, p.coverageRow))));
  return out;
}

export const pairKey = (trackId: string, source: string): string => `${trackId}|${source}`;

/** Stable fingerprint of the parts that affect what a client renders (excludes `computedAt`); used in manifest ETags. */
export function capabilitiesFingerprint(c: CourseCapabilities): string {
  const { computedAt: _ignored, ...rest } = c;
  return sha256Hex(JSON.stringify(rest)).slice(0, 12);
}
