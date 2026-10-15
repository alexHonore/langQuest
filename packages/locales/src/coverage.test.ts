import { COURSE_TRACKS, LANGUAGE_CODES, db } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { CATALOG_NAMESPACES, CATALOG_SECTIONS, REQUIRED_PARTIAL_NAMESPACES } from './catalogs';
import {
  COVERAGE_METADATA,
  buildCoverageMetadata,
  computeCatalogCoverage,
  computeLocaleCoverage,
  generateCourseSourceLocalizationRows,
  uiCoveragePctByLanguage,
  validateCourseSourceLocalizationRows,
} from './coverage';

describe('catalog coverage', () => {
  it('reports en and fr complete, es and ru partial but usable', () => {
    const coverage = computeCatalogCoverage();
    expect(coverage.en).toMatchObject({ status: 'complete', pct: 100, extraKeys: [], emptyKeys: [] });
    expect(coverage.fr).toMatchObject({ status: 'complete', pct: 100, extraKeys: [], emptyKeys: [] });
    for (const locale of ['es', 'ru'] as const) {
      const c = coverage[locale]!;
      expect(c.status).toBe('partial');
      expect(c.usable).toBe(true);
      expect(c.completeNamespaces).toEqual([...REQUIRED_PARTIAL_NAMESPACES]);
      expect(c.extraKeys).toEqual([]);
      const missingNs = c.namespaces.filter((ns) => ns.present === 0).map((ns) => ns.namespace);
      expect(missingNs).toEqual(CATALOG_NAMESPACES.filter((ns) => !(REQUIRED_PARTIAL_NAMESPACES as readonly string[]).includes(ns)));
    }
  });

  it('computes per-namespace numbers and flags extra/empty keys', () => {
    const base = { 'a.x': '1', 'a.y': '2', 'b.z': '3' };
    const c = computeLocaleCoverage('xx', { 'a.x': 'one', 'a.y': '', 'c.q': 'extra' }, base);
    expect(c.namespaces).toEqual([
      { namespace: 'a', expected: 2, present: 1, missing: ['a.y'], pct: 50 },
      { namespace: 'b', expected: 1, present: 0, missing: ['b.z'], pct: 0 },
    ]);
    expect(c.pct).toBeCloseTo(33.33, 1);
    expect(c.extraKeys).toEqual(['c.q']);
    expect(c.emptyKeys).toEqual(['a.y']);
    expect(c.status).toBe('partial');
    expect(c.usable).toBe(false);
  });

  it('checked-in coverage.json matches the catalogs', () => {
    expect(COVERAGE_METADATA).toEqual(buildCoverageMetadata());
  });

  it('reports the app-facing sections (admin.ui, catalog.cover, audio.listen) per locale', () => {
    const coverage = computeCatalogCoverage();
    for (const locale of ['en', 'fr'] as const) {
      const c = coverage[locale]!;
      expect(c.sections.map((s) => s.namespace)).toEqual([...CATALOG_SECTIONS]);
      expect(c.sections.every((s) => s.expected > 0 && s.pct === 100 && s.missing.length === 0), locale).toBe(true);
      expect(c.completeSections).toEqual([...CATALOG_SECTIONS]);
    }
    for (const locale of ['es', 'ru'] as const) {
      const c = coverage[locale]!;
      expect(c.completeSections).toEqual([]);
      expect(c.sections.every((s) => s.present === 0)).toBe(true);
    }
    const meta = buildCoverageMetadata();
    expect(meta.sections).toEqual([...CATALOG_SECTIONS]);
    expect(meta.keyCount).toBe(coverage.en!.totalExpected);
    expect(meta.locales.fr).toMatchObject({ sections: [...CATALOG_SECTIONS], keyCount: meta.keyCount, pct: 100 });
    expect(meta.locales.es!.pct).toBeLessThan(100);
  });

  it('section coverage ignores keys that merely share a prefix string', () => {
    const base = { 'admin.ui.a': '1', 'admin.uix.b': '2', 'catalog.cover.x': '3', 'audio.listen.y': '4' };
    const c = computeLocaleCoverage('xx', { 'admin.ui.a': 'a', 'admin.uix.b': 'b' }, base);
    expect(c.sections).toEqual([
      { namespace: 'admin.ui', expected: 1, present: 1, missing: [], pct: 100 },
      { namespace: 'catalog.cover', expected: 1, present: 0, missing: ['catalog.cover.x'], pct: 0 },
      { namespace: 'audio.listen', expected: 1, present: 0, missing: ['audio.listen.y'], pct: 0 },
    ]);
    expect(c.completeSections).toEqual(['admin.ui']);
  });

  it('exposes ui percentages per language', () => {
    const ui = uiCoveragePctByLanguage();
    expect(ui.en).toBe(100);
    expect(ui.fr).toBe(100);
    expect(ui.es).toBeGreaterThan(0);
    expect(ui.es).toBeLessThan(100);
  });
});

describe('generateCourseSourceLocalizationRows', () => {
  it('emits planned rows for every (track, source) when nothing is seeded', () => {
    const rows = generateCourseSourceLocalizationRows();
    expect(rows).toHaveLength(COURSE_TRACKS.length * LANGUAGE_CODES.length);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['planned']));
    expect(rows.every((r) => r.native_reviewed === false && r.fallback_source_language_code === null)).toBe(true);
    expect(rows.every((r) => r.editorial_note_key === 'enrollment.coverage.detail.planned')).toBe(true);
    const fr = rows.find((r) => r.course_track_id === 'arabic-moroccan' && r.source_language_code === 'fr')!;
    expect(fr.metrics).toEqual({ mission_instructions_pct: 0, explanations_pct: 0, ui_pct: 100, subtitles_pct: 0, audio_overlays_pct: 0 });
    const de = rows.find((r) => r.course_track_id === 'arabic-moroccan' && r.source_language_code === 'de')!;
    expect(de.metrics.ui_pct).toBe(0);
    validateCourseSourceLocalizationRows(rows);
  });

  it('marks seeded pairs partial (draft available) and reviewed-complete pairs complete', () => {
    const rows = generateCourseSourceLocalizationRows({
      tracks: ['arabic-moroccan', 'japanese'],
      sourceLanguages: ['en', 'fr', 'es'],
      seeds: [
        { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en', missionInstructionsPct: 60, explanationsPct: 40 },
        { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', missionInstructionsPct: 100, explanationsPct: 100, subtitlesPct: 100, audioOverlaysPct: 100, nativeReviewed: true, reviewerId: '2d2c1c5a-6a1b-4d2d-9c7e-0c8f0b8e1a11', reviewedAt: '2026-10-01T00:00:00.000Z' },
      ],
      unavailable: [{ courseTrackId: 'japanese', sourceLanguageCode: 'es' }],
    });
    const byKey = Object.fromEntries(rows.map((r) => [`${r.course_track_id}|${r.source_language_code}`, r]));
    expect(byKey['arabic-moroccan|en']).toMatchObject({ status: 'partial', editorial_note_key: 'enrollment.coverage.draftAvailable', native_reviewed: false, fallback_source_language_code: null });
    expect(byKey['arabic-moroccan|en']!.metrics).toMatchObject({ mission_instructions_pct: 60, explanations_pct: 40, ui_pct: 100 });
    expect(byKey['arabic-moroccan|fr']).toMatchObject({ status: 'complete', native_reviewed: true, editorial_note_key: null, fallback_source_language_code: null });
    // es is planned for Darija but English drafts exist → opt-in fallback suggested, never applied
    expect(byKey['arabic-moroccan|es']).toMatchObject({ status: 'planned', fallback_source_language_code: 'en' });
    // nothing seeded for Japanese → planned without fallback; es explicitly unavailable
    expect(byKey['japanese|fr']).toMatchObject({ status: 'planned', fallback_source_language_code: null });
    expect(byKey['japanese|es']).toMatchObject({ status: 'unavailable', editorial_note_key: 'enrollment.coverage.detail.unavailable' });
    for (const row of validateCourseSourceLocalizationRows(rows)) expect(db.CourseSourceLocalizationsTable.insert.safeParse(row).success).toBe(true);
  });

  it('never upgrades a pair to complete without native review', () => {
    const [row] = generateCourseSourceLocalizationRows({
      tracks: ['french'],
      sourceLanguages: ['en'],
      seeds: [{ courseTrackId: 'french', sourceLanguageCode: 'en', missionInstructionsPct: 100, explanationsPct: 100, subtitlesPct: 100, audioOverlaysPct: 100 }],
    });
    expect(row!.status).toBe('partial');
  });
});
