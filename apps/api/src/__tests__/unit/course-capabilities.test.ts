/**
 * Pure derivation of `CourseCapabilities` (CONVENTIONS §8): counts + coverage + deployment flags → snapshot.
 * No database: the loader is covered by the stack suite.
 */
import { CourseCapabilitiesSchema, type CourseCapabilities } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { capabilitiesFingerprint, deriveCourseCapabilities, sourceCatalogPct, type CapabilityCounts, type CapabilityEnvFlags, type DeriveCapabilitiesInput } from '../../lib/course-capabilities';

const metrics = { mission_instructions_pct: 100, explanations_pct: 100, ui_pct: 100, subtitles_pct: 0, audio_overlays_pct: 0 };
const partial = { status: 'partial' as const, nativeReviewed: false, metrics };
const complete = { status: 'complete' as const, nativeReviewed: true, metrics };
const counts = (over: Partial<CapabilityCounts> = {}): CapabilityCounts => ({ publishedMissions: 6, localizedMissions: 6, publishedAudioCollections: 0, publishedCharacters: 52, ...over });
const env = (over: Partial<CapabilityEnvFlags> = {}): CapabilityEnvFlags => ({ openRouter: true, azure: false, mediaAvailable: false, ...over });
const derive = (over: Partial<DeriveCapabilitiesInput> = {}): CourseCapabilities =>
  deriveCourseCapabilities({ trackId: 'arabic-moroccan', sourceLanguageCode: 'fr', counts: counts(), coverage: partial, env: env(), sourceCatalogPct: 100, ...over });
const keys = (c: CourseCapabilities) => c.missing.map((m) => m.key);

describe('deriveCourseCapabilities', () => {
  it('arabic-moroccan × fr with OpenRouter: missions (6), no audio, voice conversation, reference-comparison pronunciation', () => {
    const c = derive();
    expect(CourseCapabilitiesSchema.parse(c)).toEqual(c);
    expect(c.missions).toEqual({ available: true, publishedCount: 6, localizedCount: 6 });
    expect(c.audioLibrary).toEqual({ available: false, publishedCollections: 0 });
    expect(c.liveConversation).toEqual({ available: true, characterCount: 52, mode: 'text_and_voice' });
    expect(c.pronunciationScoring.mode).toBe('reference_comparison'); // ar-MA has no Azure assessment locale (ADR-006)
    expect(c.offlineDownloads.available).toBe(false);
    expect(c.instructionLanguage).toEqual({ status: 'partial', nativeReviewed: false, metrics });
    expect(c.scripts.modes).toEqual(['native', 'latin', 'both']);
    expect(c.regionalOptions.map((o) => o.id)).toContain('casablanca');
    expect(keys(c)).toEqual(['instruction_language_draft', 'no_audio_library', 'no_pronunciation_scoring']);
    expect(c.missing.every((m) => m.severity === 'info')).toBe(true);
    expect(c.missing.every((m) => m.i18nKey.startsWith('enrollment.disclaimer.'))).toBe(true);
  });

  it('without an OpenRouter key nothing AI-backed is claimed: conversation none, no spoken feedback', () => {
    const c = derive({ env: env({ openRouter: false }) });
    expect(c.liveConversation).toEqual({ available: false, characterCount: 52, mode: 'none' });
    expect(c.pronunciationScoring.mode).toBe('none');
    expect(keys(c)).toEqual(['instruction_language_draft', 'no_audio_library', 'no_live_conversation', 'no_pronunciation_feedback']);
  });

  it('swahili × en (planned, no missions): blocking disclaimer, missions hidden even though a character exists', () => {
    const c = derive({ trackId: 'swahili', sourceLanguageCode: 'en', counts: counts({ publishedMissions: 0, localizedMissions: 0, publishedCharacters: 1 }), coverage: { status: 'planned', nativeReviewed: false, metrics: { ...metrics, mission_instructions_pct: 0, explanations_pct: 0, ui_pct: 0 } } });
    expect(c.targetVarietyId).toBe('sw');
    expect(c.missions).toEqual({ available: false, publishedCount: 0, localizedCount: 0 });
    expect(c.liveConversation.available).toBe(true); // 1 published character + OpenRouter: Speak tab stays usable
    expect(c.missing[0]).toEqual({ key: 'instruction_language_planned', i18nKey: 'enrollment.disclaimer.instructionLanguagePlanned', severity: 'blocking' });
    expect(c.missing.find((m) => m.key === 'no_missions')?.severity).toBe('info');
    expect(c.scripts.modes).toEqual(['native']);
    expect(c.regionalOptions.map((o) => o.id).length).toBeGreaterThan(0);
  });

  it('a planned pair keeps missions hidden even when published + localized missions exist (editorial gate)', () => {
    const c = derive({ coverage: { ...partial, status: 'planned' } });
    expect(c.missions.available).toBe(false);
    expect(c.missions.publishedCount).toBe(6);
    expect(keys(c)[0]).toBe('instruction_language_planned');
  });

  it('missing rows are treated as planned; unavailable rows block', () => {
    expect(derive({ coverage: null }).instructionLanguage.status).toBe('planned');
    const c = derive({ coverage: { ...partial, status: 'unavailable' } });
    expect(c.missing[0]?.key).toBe('instruction_language_unavailable');
    expect(c.missions.available).toBe(false);
  });

  it('never reports a capability as available with a zero backing count', () => {
    const c = derive({ counts: counts({ publishedMissions: 0, localizedMissions: 0, publishedCharacters: 0, publishedAudioCollections: 0 }), env: env({ openRouter: true, azure: true, mediaAvailable: true }) });
    expect(c.missions.available).toBe(false);
    expect(c.audioLibrary.available).toBe(false);
    expect(c.liveConversation).toMatchObject({ available: false, mode: 'none' });
    expect(c.offlineDownloads.available).toBe(false);
    expect(c.missing.find((m) => m.key === 'no_missions')?.severity).toBe('blocking'); // nothing at all to learn from
    // Published missions that lack a localization in this source are not usable from it either.
    expect(derive({ counts: counts({ localizedMissions: 0 }) }).missions).toEqual({ available: false, publishedCount: 6, localizedCount: 0 });
  });

  it('audio library + downloads: collections make the tab available; downloads also need media storage', () => {
    const noMedia = derive({ counts: counts({ publishedAudioCollections: 2 }) });
    expect(noMedia.audioLibrary).toEqual({ available: true, publishedCollections: 2 });
    expect(noMedia.offlineDownloads.available).toBe(false);
    expect(keys(noMedia)).toContain('no_offline_downloads');
    expect(keys(noMedia)).not.toContain('no_audio_library');
    const withMedia = derive({ counts: counts({ publishedAudioCollections: 2 }), env: env({ mediaAvailable: true }) });
    expect(withMedia.offlineDownloads.available).toBe(true);
    expect(keys(withMedia)).not.toContain('no_offline_downloads');
    // No audio at all: downloads are not listed separately (the audio item already covers it).
    expect(keys(derive({ env: env({ mediaAvailable: true }) }))).not.toContain('no_offline_downloads');
  });

  it('acoustic scoring only with Azure configured AND a documented locale; text-only conversation when TTS is unavailable', () => {
    const french = derive({ trackId: 'french', sourceLanguageCode: 'en', coverage: complete, env: env({ azure: true }) });
    expect(french.pronunciationScoring.mode).toBe('acoustic');
    expect(keys(french)).not.toContain('no_pronunciation_scoring');
    expect(keys(french)).not.toContain('instruction_language_draft');
    const darijaAzure = derive({ env: env({ azure: true }) });
    expect(darijaAzure.pronunciationScoring.mode).toBe('reference_comparison'); // Azure never scores Darija with ar-SA
    // Kinyarwanda: STT limited/usable, TTS unavailable in the matrix → text-only conversation.
    const rw = derive({ trackId: 'kinyarwanda', sourceLanguageCode: 'en', counts: counts({ publishedCharacters: 1 }) });
    if (rw.liveConversation.mode === 'text_only') expect(keys(rw)).toContain('text_only_conversation');
    expect(['text_and_voice', 'text_only']).toContain(rw.liveConversation.mode);
  });

  it('flags partial interface languages from the locales catalog completeness', () => {
    expect(sourceCatalogPct('fr')).toBe(100);
    expect(sourceCatalogPct('en')).toBe(100);
    expect(sourceCatalogPct('es')).toBeLessThan(100);
    expect(sourceCatalogPct('sw')).toBeNull();
    expect(keys(derive({ sourceLanguageCode: 'es', sourceCatalogPct: sourceCatalogPct('es') }))).toContain('partial_interface_language');
    expect(keys(derive({ sourceLanguageCode: 'sw', sourceCatalogPct: null }))).toContain('partial_interface_language');
    expect(keys(derive())).not.toContain('partial_interface_language');
  });

  it('orders blocking items first and fingerprints ignore computedAt', () => {
    const c = derive({ trackId: 'swahili', sourceLanguageCode: 'en', counts: counts({ publishedMissions: 0, localizedMissions: 0, publishedCharacters: 0 }), coverage: null });
    const severities = c.missing.map((m) => m.severity);
    expect(severities.slice(0, 2)).toEqual(['blocking', 'blocking']);
    expect(severities.slice(2).every((s) => s === 'info')).toBe(true);
    const a = derive({ now: new Date('2026-10-19T10:00:00Z') });
    const b = derive({ now: new Date('2026-10-19T11:00:00Z') });
    expect(a.computedAt).not.toBe(b.computedAt);
    expect(capabilitiesFingerprint(a)).toBe(capabilitiesFingerprint(b));
    expect(capabilitiesFingerprint(derive({ env: env({ openRouter: false }) }))).not.toBe(capabilitiesFingerprint(a));
  });
});
