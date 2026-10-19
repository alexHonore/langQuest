import { describe, expect, it } from 'vitest';
import { CAPABILITY_MISSING_I18N_KEYS, CAPABILITY_MISSING_KEYS, CourseCapabilitiesSchema, hasUsableContent, type CourseCapabilities } from './capabilities';
import { EnrollmentDtoSchema, CoverageResponseSchema } from './api/learner';
import { CourseManifestSchema, MANIFEST_FORMAT_VERSION } from './manifest';

const base: CourseCapabilities = {
  courseTrackId: 'arabic-moroccan',
  sourceLanguageCode: 'fr',
  targetVarietyId: 'ary',
  missions: { available: true, publishedCount: 6, localizedCount: 6 },
  audioLibrary: { available: false, publishedCollections: 0 },
  liveConversation: { available: true, characterCount: 52, mode: 'text_and_voice' },
  pronunciationScoring: { mode: 'reference_comparison' },
  offlineDownloads: { available: false },
  instructionLanguage: { status: 'partial', nativeReviewed: false, metrics: { mission_instructions_pct: 100, explanations_pct: 100, ui_pct: 100, subtitles_pct: 0, audio_overlays_pct: 0 } },
  scripts: { modes: ['native', 'latin', 'both'] },
  regionalOptions: [{ id: 'casablanca', label: 'Casablanca', locale: 'ar-MA' }],
  missing: [{ key: 'no_audio_library', i18nKey: 'enrollment.disclaimer.noAudioLibrary', severity: 'info' }],
  computedAt: '2026-10-19T12:00:00.000Z',
};

describe('CourseCapabilitiesSchema', () => {
  it('parses a full snapshot and rejects unknown modes', () => {
    expect(CourseCapabilitiesSchema.parse(base)).toEqual(base);
    expect(CourseCapabilitiesSchema.safeParse({ ...base, liveConversation: { ...base.liveConversation, mode: 'duplex' } }).success).toBe(false);
    expect(CourseCapabilitiesSchema.safeParse({ ...base, missing: [{ key: 'nope', i18nKey: 'x', severity: 'info' }] }).success).toBe(false);
  });

  it('maps every missing key to an enrollment.disclaimer i18n key', () => {
    for (const key of CAPABILITY_MISSING_KEYS) expect(CAPABILITY_MISSING_I18N_KEYS[key]).toMatch(/^enrollment\.disclaimer\.[a-zA-Z]+$/);
  });

  it('hasUsableContent is true when any learning surface is available', () => {
    expect(hasUsableContent(base)).toBe(true);
    expect(hasUsableContent({ missions: { available: false, publishedCount: 0, localizedCount: 0 }, audioLibrary: { available: false, publishedCollections: 0 }, liveConversation: { available: false, characterCount: 0, mode: 'none' } })).toBe(false);
  });

  it('is optional on the enrollment DTO, the coverage response and the manifest (backward compatible)', () => {
    const enrollment = {
      id: '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d', courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', preferredTargetVariantId: null, regionalPreference: null, scriptMode: 'both', learnerLevel: 'beginner', status: 'active', preferredLearningSpeed: 'regular', activeMissionId: null, translationPeekLanguageCode: null, addedAt: '2026-10-19T12:00:00.000Z', lastOpenedAt: null,
      coverage: { status: 'partial', nativeReviewed: false, editorialNoteKey: null, fallbackSourceLanguageCode: null },
    };
    expect(EnrollmentDtoSchema.parse(enrollment).capabilities).toBeUndefined();
    expect(EnrollmentDtoSchema.parse({ ...enrollment, capabilities: base }).capabilities).toEqual(base);
    expect(CoverageResponseSchema.parse({ courseTrackId: 'arabic-moroccan', coverage: [] }).capabilities).toBeUndefined();
    const manifest = { formatVersion: MANIFEST_FORMAT_VERSION, courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', version: 1, checksum: 'a'.repeat(64), generatedAt: '2026-10-19T12:00:00.000Z', coverArt: null, chapters: [], characters: [], cacheTtlSeconds: 3600 };
    expect(CourseManifestSchema.parse(manifest).capabilities).toBeUndefined();
    expect(CourseManifestSchema.parse({ ...manifest, capabilities: base }).capabilities?.missions.publishedCount).toBe(6);
  });
});
