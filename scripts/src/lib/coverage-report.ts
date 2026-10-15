/**
 * Course coverage validation (spec §2.1 honest availability, §12.2 editor-quality metrics).
 *
 * Combines three truth sources into one per (track × source) report:
 *  - `@langquest/curriculum` `summariseCoverage()` — drafted missions/expressions and invariants;
 *  - `@langquest/locales` `computeCatalogCoverage()` — UI/instruction catalog completeness per language;
 *  - the database (when reachable) — expressions, audio, native-review counts, coverage rows;
 *  - JSONL drafts under `data/drafts` (Tatoeba, content factory) — unreviewed material on disk.
 *
 * Drift checks fail the run (non-zero exit): catalog constants vs database catalog tables, missing
 * coverage rows, `complete` rows without native review, drafts claiming native review, curriculum
 * invariants, UI locale set not a subset of the language catalog.
 */
import { COURSE_TRACKS, LANGUAGE_CODES, LANGUAGE_VARIETIES, SOURCE_LANGUAGES, tracksForVariety, type CourseTrackId, type CoverageStatus, type SourceLanguageCode } from '@langquest/contracts';
import { summariseCoverage, type CoverageSummary } from '@langquest/curriculum';
import type { DbClient } from '@langquest/db';
import { SUPPORTED_UI_LOCALES, computeCatalogCoverage, type LocaleCoverage } from '@langquest/locales';
import { readJsonl } from './io';
import { findJsonlFiles } from './license-report';

export interface DbCoverageFacts {
  url: string;
  trackIds: string[];
  languageCount: number;
  varietyCount: number;
  coverageRows: Array<{ course_track_id: string; source_language_code: string; status: CoverageStatus; native_reviewed: boolean }>;
  expressionsByVariety: Record<string, { total: number; reviewed: number; published: number; withAudio: number }>;
  missionsByVariety: Record<string, { total: number; published: number }>;
  translationsByVarietySource: Record<string, number>;
}

export interface DraftFacts {
  files: number;
  expressionDraftsByVariety: Record<string, number>;
  expressionDraftTranslations: Record<string, number>;
  chapterDraftsByTrackSource: Record<string, { chapters: number; expressions: number }>;
  nativeReviewedClaims: number;
}

export interface CoverageRow {
  courseTrackId: CourseTrackId;
  displayName: string;
  targetVarietyId: string;
  sourceLanguageCode: SourceLanguageCode;
  /** Honest computed status (never better than the curriculum/DB evidence allows). */
  status: CoverageStatus;
  dbStatus: CoverageStatus | null;
  missions: { expected: number; drafted: number; db: number; dbPublished: number };
  expressions: { seedDrafted: number; seedWithSourceMeaning: number; jsonlDrafts: number; db: number; dbReviewed: number; dbPublished: number };
  audio: { dbExpressionsWithAudio: number };
  nativeReview: { reviewedExpressions: number; coverageRowReviewed: boolean };
  localization: { uiPct: number; explanationsPct: number; missionInstructionsPct: number; jsonlTranslations: number };
  reason: string;
}

export interface CoverageReport {
  generatedAt: string;
  sources: SourceLanguageCode[];
  rows: CoverageRow[];
  totals: Record<CoverageStatus, number>;
  perTrack: Array<{ courseTrackId: CourseTrackId; displayName: string; targetVarietyId: string; byStatus: Record<CoverageStatus, number>; expressionsDb: number; expressionsDraft: number; audioDb: number; reviewedDb: number }>;
  locales: Record<string, { status: LocaleCoverage['status']; pct: number }>;
  drift: string[];
  warnings: string[];
  db: { reachable: boolean; url: string | null };
  curriculumInvariants: CoverageSummary['invariants'];
}

/** Query the database for coverage facts. */
export async function loadDbFacts(db: DbClient, url: string): Promise<DbCoverageFacts> {
  const must = <T,>(r: { data: T | null; error: { message: string } | null }, ctx: string): T => {
    if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
    return r.data as T;
  };
  const tracks = must(await db.from('course_tracks').select('id'), 'course_tracks');
  const languages = must(await db.from('languages').select('id'), 'languages');
  const varieties = must(await db.from('language_varieties').select('id'), 'language_varieties');
  const coverage = must(await db.from('course_source_localizations').select('course_track_id, source_language_code, status, native_reviewed'), 'course_source_localizations');
  const expressions = must(await db.from('expressions').select('id, target_variety_id, reviewed, state'), 'expressions');
  const audio = must(await db.from('expression_audio').select('expression_id'), 'expression_audio');
  const translations = must(await db.from('expression_translations').select('expression_id, source_language_code'), 'expression_translations');
  const missions = must(await db.from('missions').select('target_variety_id, state'), 'missions');

  const withAudio = new Set(audio.map((a) => a.expression_id));
  const varietyOfExpression = new Map(expressions.map((e) => [e.id, e.target_variety_id]));
  const expressionsByVariety: DbCoverageFacts['expressionsByVariety'] = {};
  for (const e of expressions) {
    const b = (expressionsByVariety[e.target_variety_id] ??= { total: 0, reviewed: 0, published: 0, withAudio: 0 });
    b.total += 1;
    if (e.reviewed) b.reviewed += 1;
    if (e.state === 'published') b.published += 1;
    if (withAudio.has(e.id)) b.withAudio += 1;
  }
  const missionsByVariety: DbCoverageFacts['missionsByVariety'] = {};
  for (const m of missions) {
    const b = (missionsByVariety[m.target_variety_id] ??= { total: 0, published: 0 });
    b.total += 1;
    if (m.state === 'published') b.published += 1;
  }
  const translationsByVarietySource: Record<string, number> = {};
  for (const t of translations) {
    const v = varietyOfExpression.get(t.expression_id);
    if (!v) continue;
    const k = `${v}|${t.source_language_code}`;
    translationsByVarietySource[k] = (translationsByVarietySource[k] ?? 0) + 1;
  }
  return { url, trackIds: tracks.map((t) => t.id), languageCount: languages.length, varietyCount: varieties.length, coverageRows: coverage as DbCoverageFacts['coverageRows'], expressionsByVariety, missionsByVariety, translationsByVarietySource };
}

/** Scan JSONL drafts on disk. */
export async function loadDraftFacts(dirs: readonly string[]): Promise<DraftFacts> {
  const files = dirs.flatMap((d) => findJsonlFiles(d));
  const facts: DraftFacts = { files: files.length, expressionDraftsByVariety: {}, expressionDraftTranslations: {}, chapterDraftsByTrackSource: {}, nativeReviewedClaims: 0 };
  for (const file of files) {
    for await (const rec of readJsonl<Record<string, unknown>>(file)) {
      if (rec.nativeReviewed === true) facts.nativeReviewedClaims += 1;
      if (rec.kind === 'expression_draft') {
        const target = rec.target as { varietyId: string | null } | undefined;
        const v = target?.varietyId ?? 'unresolved';
        facts.expressionDraftsByVariety[v] = (facts.expressionDraftsByVariety[v] ?? 0) + 1;
        for (const t of (rec.translations as Array<{ sourceLanguageCode: string }> | undefined) ?? []) {
          const k = `${v}|${t.sourceLanguageCode}`;
          facts.expressionDraftTranslations[k] = (facts.expressionDraftTranslations[k] ?? 0) + 1;
        }
      } else if (rec.kind === 'chapter_draft') {
        const chapter = rec.chapter as { courseTrackId: string; sourceLanguages: string[]; missions: Array<{ expressions: Array<{ targetText: string | null; nativeReviewed?: boolean }> }> } | undefined;
        if (!chapter) continue;
        const exprs = chapter.missions.flatMap((m) => m.expressions);
        if (exprs.some((e) => e.nativeReviewed === true)) facts.nativeReviewedClaims += 1;
        for (const src of chapter.sourceLanguages) {
          const k = `${chapter.courseTrackId}|${src}`;
          const b = (facts.chapterDraftsByTrackSource[k] ??= { chapters: 0, expressions: 0 });
          b.chapters += 1;
          b.expressions += exprs.filter((e) => e.targetText).length;
        }
      }
    }
  }
  return facts;
}

/** Combine everything into the report (pure given its inputs). */
export function buildCoverageReport(input: { sources: readonly SourceLanguageCode[]; db: DbCoverageFacts | null; drafts: DraftFacts; now?: Date }): CoverageReport {
  const now = input.now ?? new Date();
  const sources = [...input.sources];
  const curriculum = summariseCoverage({ sources, now: now.toISOString() });
  const localeCoverage = computeCatalogCoverage();
  const locales: CoverageReport['locales'] = {};
  for (const [loc, c] of Object.entries(localeCoverage)) locales[loc] = { status: c.status, pct: Math.round(c.pct * 10) / 10 };
  const uiPctFor = (lang: string): number => locales[lang]?.pct ?? 0;
  const drift: string[] = [];
  const warnings: string[] = [];

  // --- contract/curriculum/locales drift -------------------------------------------------
  if (COURSE_TRACKS.length !== 30) drift.push(`contracts: expected 30 course tracks, found ${COURSE_TRACKS.length}`);
  for (const [k, v] of Object.entries(curriculum.invariants)) if (!v) drift.push(`curriculum invariant failed: ${k}`);
  for (const loc of SUPPORTED_UI_LOCALES) if (!(LANGUAGE_CODES as readonly string[]).includes(loc)) drift.push(`locales: UI locale ${loc} is not a catalog language`);
  for (const loc of ['en', 'fr']) if (locales[loc]?.status !== 'complete') drift.push(`locales: ${loc} catalog must be complete (is ${locales[loc]?.status ?? 'missing'})`);
  if (input.drafts.nativeReviewedClaims > 0) drift.push(`drafts: ${input.drafts.nativeReviewedClaims} JSONL draft(s) claim nativeReviewed=true`);

  // --- db drift ------------------------------------------------------------------------
  const db = input.db;
  if (db) {
    const expected = new Set(COURSE_TRACKS.map((t) => t.id));
    const found = new Set(db.trackIds);
    for (const id of expected) if (!found.has(id)) drift.push(`db: course_tracks missing ${id} (run seed-languages)`);
    for (const id of found) if (!expected.has(id as CourseTrackId)) drift.push(`db: course_tracks has unknown track ${id}`);
    if (db.languageCount !== LANGUAGE_CODES.length) drift.push(`db: languages has ${db.languageCount} rows, catalog has ${LANGUAGE_CODES.length}`);
    if (db.varietyCount !== LANGUAGE_VARIETIES.length) drift.push(`db: language_varieties has ${db.varietyCount} rows, catalog has ${LANGUAGE_VARIETIES.length}`);
    const rowKey = (t: string, s: string) => `${t}|${s}`;
    const dbRows = new Map(db.coverageRows.map((r) => [rowKey(r.course_track_id, r.source_language_code), r]));
    for (const t of COURSE_TRACKS) for (const s of ['en', 'fr']) if (!dbRows.has(rowKey(t.id, s))) drift.push(`db: course_source_localizations missing (${t.id}, ${s})`);
    for (const r of db.coverageRows) {
      if (r.status === 'complete' && !r.native_reviewed) drift.push(`db: coverage row (${r.course_track_id}, ${r.source_language_code}) is 'complete' without native review`);
      if (!expected.has(r.course_track_id as CourseTrackId)) drift.push(`db: coverage row references unknown track ${r.course_track_id}`);
    }
  }

  // --- rows ----------------------------------------------------------------------------
  const rows: CoverageRow[] = [];
  for (const track of COURSE_TRACKS) {
    for (const source of sources) {
      const cur = curriculum.rows.find((r) => r.courseTrackId === track.id && r.sourceLanguageCode === source)!;
      const dbExpr = db?.expressionsByVariety[track.targetVarietyId] ?? { total: 0, reviewed: 0, published: 0, withAudio: 0 };
      const dbMissions = db?.missionsByVariety[track.targetVarietyId] ?? { total: 0, published: 0 };
      const dbRow = db?.coverageRows.find((r) => r.course_track_id === track.id && r.source_language_code === source) ?? null;
      const jsonlDrafts = (input.drafts.expressionDraftsByVariety[track.targetVarietyId] ?? 0) + (input.drafts.chapterDraftsByTrackSource[`${track.id}|${source}`]?.expressions ?? 0);
      const jsonlTranslations = (input.drafts.expressionDraftTranslations[`${track.targetVarietyId}|${source}`] ?? 0) + (input.drafts.chapterDraftsByTrackSource[`${track.id}|${source}`]?.expressions ?? 0);
      const dbTranslations = db?.translationsByVarietySource[`${track.targetVarietyId}|${source}`] ?? 0;
      // Honest status: complete requires DB-reviewed published rows for this pair (never true yet); partial when any drafted text exists for this source; unavailable only from the DB row.
      let status: CoverageStatus = cur.status;
      if (dbRow?.status === 'unavailable') status = 'unavailable';
      else if (status === 'planned' && (jsonlTranslations > 0 || dbTranslations > 0)) status = 'partial';
      // A DB row may lag behind drafts on disk (planned while JSONL drafts exist); it must never over-claim.
      if (dbRow && STATUS_RANK[dbRow.status] > STATUS_RANK[status]) warnings.push(`(${track.id}, ${source}): db coverage row says '${dbRow.status}' but evidence only supports '${status}'; run seed-languages --with-coverage or fix the row`);
      const reason = status === 'unavailable' ? 'marked unavailable by an editor in course_source_localizations' : status === 'partial' ? `${cur.draftedMissionCount}/${cur.missionCount} chapter-1 missions drafted in code, ${jsonlDrafts} JSONL draft expressions, ${dbExpr.total} DB expressions (${dbExpr.reviewed} reviewed, ${dbExpr.withAudio} with audio); native review pending` : cur.reason;
      rows.push({
        courseTrackId: track.id,
        displayName: track.displayName,
        targetVarietyId: track.targetVarietyId,
        sourceLanguageCode: source,
        status,
        dbStatus: dbRow?.status ?? null,
        missions: { expected: cur.missionCount, drafted: cur.draftedMissionCount, db: dbMissions.total, dbPublished: dbMissions.published },
        expressions: { seedDrafted: cur.expressionsWithTargetText, seedWithSourceMeaning: cur.expressionsWithSourceMeaning, jsonlDrafts, db: dbExpr.total, dbReviewed: dbExpr.reviewed, dbPublished: dbExpr.published },
        audio: { dbExpressionsWithAudio: dbExpr.withAudio },
        nativeReview: { reviewedExpressions: dbExpr.reviewed, coverageRowReviewed: dbRow?.native_reviewed ?? false },
        localization: { uiPct: uiPctFor(source), explanationsPct: cur.metrics.explanations_pct, missionInstructionsPct: cur.metrics.mission_instructions_pct, jsonlTranslations },
        reason,
      });
    }
  }
  const totals: Record<CoverageStatus, number> = { complete: 0, partial: 0, planned: 0, unavailable: 0 };
  for (const r of rows) totals[r.status] += 1;
  const perTrack = COURSE_TRACKS.map((t) => {
    const tr = rows.filter((r) => r.courseTrackId === t.id);
    const byStatus: Record<CoverageStatus, number> = { complete: 0, partial: 0, planned: 0, unavailable: 0 };
    for (const r of tr) byStatus[r.status] += 1;
    const dbExpr = db?.expressionsByVariety[t.targetVarietyId] ?? { total: 0, reviewed: 0, published: 0, withAudio: 0 };
    return { courseTrackId: t.id, displayName: t.displayName, targetVarietyId: t.targetVarietyId, byStatus, expressionsDb: dbExpr.total, expressionsDraft: input.drafts.expressionDraftsByVariety[t.targetVarietyId] ?? 0, audioDb: dbExpr.withAudio, reviewedDb: dbExpr.reviewed };
  });
  if (!db) warnings.push('database not reachable: DB counts are 0 and DB drift checks were skipped');
  return { generatedAt: now.toISOString(), sources, rows, totals, perTrack, locales, drift, warnings, db: { reachable: !!db, url: db?.url ?? null }, curriculumInvariants: curriculum.invariants };
}

const STATUS_LETTER: Record<CoverageStatus, string> = { complete: 'C', partial: 'P', planned: '·', unavailable: 'X' };
const STATUS_RANK: Record<CoverageStatus, number> = { unavailable: 0, planned: 1, partial: 2, complete: 3 };

/** Render docs/provider-matrix/coverage-report.md. */
export function renderCoverageMarkdown(report: CoverageReport): string {
  const l: string[] = [];
  l.push('# Course coverage report');
  l.push('');
  l.push(`Generated ${report.generatedAt} by \`scripts/validate-course-coverage\`. Database: ${report.db.reachable ? report.db.url : 'not reachable (DB columns show 0)'}.`);
  l.push('');
  l.push(`Status legend: C = complete (native-reviewed, all metrics 100), P = partial (unreviewed drafts exist), · = planned (structure only), X = unavailable. **No track × source pair is complete yet**; every draft is \`review_needed\`.`);
  l.push('');
  l.push(`Totals over ${report.rows.length} (track × source) pairs: complete ${report.totals.complete} · partial ${report.totals.partial} · planned ${report.totals.planned} · unavailable ${report.totals.unavailable}.`);
  l.push('');
  l.push('## Drift checks');
  l.push('');
  if (report.drift.length) for (const d of report.drift) l.push(`- ❌ ${d}`);
  else l.push('- ✅ no catalog drift detected');
  for (const w of report.warnings.slice(0, 40)) l.push(`- ⚠️ ${w}`);
  if (report.warnings.length > 40) l.push(`- ⚠️ … ${report.warnings.length - 40} more warnings`);
  l.push('');
  l.push('## UI / instruction catalogs (`@langquest/locales`)');
  l.push('');
  l.push('| Locale | Status | Keys present |');
  l.push('|---|---|---:|');
  for (const [loc, c] of Object.entries(report.locales)) l.push(`| ${loc} | ${c.status} | ${c.pct}% |`);
  l.push('');
  l.push('## Status matrix (rows: tracks, columns: source languages)');
  l.push('');
  l.push(`| # | Track | Variety | ${report.sources.join(' | ')} | DB expr | Draft expr | DB audio | DB reviewed |`);
  l.push(`|---|---|---|${report.sources.map(() => ':-:').join('|')}|---:|---:|---:|---:|`);
  for (const [i, t] of report.perTrack.entries()) {
    const cells = report.sources.map((s) => STATUS_LETTER[report.rows.find((r) => r.courseTrackId === t.courseTrackId && r.sourceLanguageCode === s)!.status]);
    l.push(`| ${String(i + 1).padStart(2, '0')} | ${t.displayName} | ${t.targetVarietyId} | ${cells.join(' | ')} | ${t.expressionsDb} | ${t.expressionsDraft} | ${t.audioDb} | ${t.reviewedDb} |`);
  }
  l.push('');
  l.push('## Priority sources detail (en, fr, es, ru)');
  l.push('');
  l.push('| Track | Source | Status | Missions drafted/expected (DB) | Expressions seed / JSONL / DB (reviewed) | Audio (DB) | Native review | UI % | Explanations % | Reason |');
  l.push('|---|---|---|---|---|---:|---|---:|---:|---|');
  for (const r of report.rows.filter((r) => ['en', 'fr', 'es', 'ru'].includes(r.sourceLanguageCode))) {
    l.push(`| ${r.courseTrackId} | ${r.sourceLanguageCode} | ${r.status} | ${r.missions.drafted}/${r.missions.expected} (${r.missions.db}) | ${r.expressions.seedDrafted} / ${r.expressions.jsonlDrafts} / ${r.expressions.db} (${r.expressions.dbReviewed}) | ${r.audio.dbExpressionsWithAudio} | ${r.nativeReview.coverageRowReviewed ? 'row reviewed' : 'pending'} (${r.nativeReview.reviewedExpressions} expr) | ${r.localization.uiPct} | ${r.localization.explanationsPct} | ${r.reason} |`);
  }
  l.push('');
  return l.join('\n') + '\n';
}

/** Default source list: the full catalog, priority first. */
export const DEFAULT_SOURCES: SourceLanguageCode[] = [...SOURCE_LANGUAGES].sort((a, b) => a.priorityTier - b.priorityTier || a.code.localeCompare(b.code)).map((s) => s.code);

/** Tracks that teach a variety (helper re-export for callers). */
export const tracksTeaching = tracksForVariety;
