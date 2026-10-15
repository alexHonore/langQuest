import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURSE_TRACKS, LANGUAGE_CODES, LANGUAGE_VARIETIES } from '@langquest/contracts';
import { buildCoverageReport, loadDraftFacts, renderCoverageMarkdown, type DbCoverageFacts, type DraftFacts } from './coverage-report';
import { writeJsonl } from './io';

const emptyDrafts: DraftFacts = { files: 0, expressionDraftsByVariety: {}, expressionDraftTranslations: {}, chapterDraftsByTrackSource: {}, nativeReviewedClaims: 0 };
const now = new Date('2026-10-14T00:00:00Z');

const healthyDb = (): DbCoverageFacts => ({
  url: 'http://127.0.0.1:54321',
  trackIds: COURSE_TRACKS.map((t) => t.id),
  languageCount: LANGUAGE_CODES.length,
  varietyCount: LANGUAGE_VARIETIES.length,
  coverageRows: COURSE_TRACKS.flatMap((t) => ['en', 'fr'].map((s) => ({ course_track_id: t.id, source_language_code: s, status: 'planned' as const, native_reviewed: false }))),
  expressionsByVariety: { ary: { total: 12, reviewed: 0, published: 0, withAudio: 2 } },
  missionsByVariety: { ary: { total: 6, published: 0 } },
  translationsByVarietySource: { 'ary|fr': 12 },
});

describe('coverage report', () => {
  it('reports every track × source honestly without a database', () => {
    const r = buildCoverageReport({ sources: ['en', 'fr'], db: null, drafts: emptyDrafts, now });
    expect(r.rows).toHaveLength(60);
    expect(r.totals.complete).toBe(0);
    expect(r.drift).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/database not reachable/);
    const ary = r.rows.find((x) => x.courseTrackId === 'arabic-moroccan' && x.sourceLanguageCode === 'fr')!;
    expect(ary.status).toBe('partial');
    expect(ary.missions.drafted).toBeGreaterThan(0);
    const ln = r.rows.find((x) => x.courseTrackId === 'lingala' && x.sourceLanguageCode === 'fr')!;
    expect(ln.status).toBe('planned');
    expect(r.locales.en?.status).toBe('complete');
    expect(r.locales.fr?.status).toBe('complete');
    expect(r.curriculumInvariants.noNativeReviewedClaims).toBe(true);
    const md = renderCoverageMarkdown(r);
    expect(md).toContain('# Course coverage report');
    expect(md).toContain('| 02 | Arabic (Moroccan) | ary | P | P |');
  });

  it('merges DB facts and detects drift (missing tracks, dishonest complete rows, bad counts)', () => {
    const ok = buildCoverageReport({ sources: ['en', 'fr'], db: healthyDb(), drafts: emptyDrafts, now });
    expect(ok.drift).toEqual([]);
    const ary = ok.rows.find((x) => x.courseTrackId === 'arabic-moroccan' && x.sourceLanguageCode === 'fr')!;
    expect(ary.expressions.db).toBe(12);
    expect(ary.audio.dbExpressionsWithAudio).toBe(2);
    expect(ary.missions.db).toBe(6);

    const bad = healthyDb();
    bad.trackIds = bad.trackIds.filter((id) => id !== 'lingala').concat(['klingon']);
    bad.languageCount = 5;
    bad.coverageRows[0]!.status = 'complete';
    bad.coverageRows = bad.coverageRows.filter((r) => !(r.course_track_id === 'swedish' && r.source_language_code === 'fr'));
    const r = buildCoverageReport({ sources: ['en', 'fr'], db: bad, drafts: { ...emptyDrafts, nativeReviewedClaims: 1 }, now });
    expect(r.drift).toEqual(expect.arrayContaining([expect.stringMatching(/missing lingala/), expect.stringMatching(/unknown track klingon/), expect.stringMatching(/languages has 5 rows/), expect.stringMatching(/'complete' without native review/), expect.stringMatching(/missing \(swedish, fr\)/), expect.stringMatching(/claim nativeReviewed=true/)]));
    expect(renderCoverageMarkdown(r)).toContain('❌');
  });

  it('counts JSONL drafts and upgrades planned pairs to partial when translations exist for that source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    await writeJsonl(join(dir, 'x.jsonl'), [
      { kind: 'expression_draft', nativeReviewed: false, target: { varietyId: 'ln' }, translations: [{ sourceLanguageCode: 'fr' }] },
      { kind: 'expression_draft', nativeReviewed: false, target: { varietyId: null }, translations: [] },
      { kind: 'chapter_draft', nativeReviewed: false, chapter: { courseTrackId: 'lingala', sourceLanguages: ['en'], missions: [{ expressions: [{ targetText: 'x' }, { targetText: null }] }] } },
    ]);
    const drafts = await loadDraftFacts([dir]);
    expect(drafts).toMatchObject({ files: 1, expressionDraftsByVariety: { ln: 1, unresolved: 1 }, expressionDraftTranslations: { 'ln|fr': 1 }, chapterDraftsByTrackSource: { 'lingala|en': { chapters: 1, expressions: 1 } }, nativeReviewedClaims: 0 });
    const r = buildCoverageReport({ sources: ['en', 'fr', 'es'], db: null, drafts, now });
    expect(r.rows.find((x) => x.courseTrackId === 'lingala' && x.sourceLanguageCode === 'fr')!.status).toBe('partial');
    expect(r.rows.find((x) => x.courseTrackId === 'lingala' && x.sourceLanguageCode === 'en')!.status).toBe('partial');
    expect(r.rows.find((x) => x.courseTrackId === 'lingala' && x.sourceLanguageCode === 'es')!.status).toBe('planned');
  });
});
