/** Catalog reads: tracks, varieties, languages, writing systems, per-source coverage. */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Row, Update } from '../types';

/**
 * Columns of `course_source_localizations` granted to `anon`/`authenticated` (070_rls.sql §8).
 * `reviewer_id` is staff-only; PostgREST answers `select=*` with 42501 for roles that lack the
 * table-level privilege, so every learner/anon read must name these columns.
 */
export const COVERAGE_COLUMNS =
  'id, course_track_id, source_language_code, status, metrics, native_reviewed, reviewed_at, editorial_note_key, fallback_source_language_code, created_at, updated_at' as const;
/** A coverage row as learners and anon see it (no `reviewer_id`). */
export type CoverageRow = Omit<Row<'course_source_localizations'>, 'reviewer_id'>;

export interface CatalogRepository {
  listLanguages(): Promise<Row<'languages'>[]>;
  listWritingSystems(): Promise<Row<'writing_systems'>[]>;
  listVarieties(): Promise<Row<'language_varieties'>[]>;
  /** Published tracks in spec order (staff clients also see unpublished ones through RLS). */
  listTracks(): Promise<Row<'course_tracks'>[]>;
  getTrack(id: string): Promise<Row<'course_tracks'> | null>;
  /** Coverage rows for one track (all sources) or one (track, source) pair. */
  listCoverage(courseTrackId: string, sourceLanguageCode?: string): Promise<CoverageRow[]>;
  /** All coverage rows for a given source language (drives the catalog availability UI). */
  listCoverageForSource(sourceLanguageCode: string): Promise<CoverageRow[]>;
  /**
   * Full coverage rows (incl. `reviewer_id`) through the `course_source_localizations_staff` view:
   * staff JWTs and the service role see every row, everyone else gets an empty list.
   */
  listCoverageStaff(courseTrackId?: string): Promise<Row<'course_source_localizations'>[]>;
  /** Editors/reviewers: update the honest status of a (track, source) pair. */
  updateCoverage(
    courseTrackId: string,
    sourceLanguageCode: string,
    patch: Update<'course_source_localizations'>,
  ): Promise<CoverageRow>;
}

export function catalogRepository(db: DbClient): CatalogRepository {
  return {
    async listLanguages() {
      return unwrap(await db.from('languages').select('*').order('code'), 'catalog.listLanguages');
    },
    async listWritingSystems() {
      return unwrap(
        await db.from('writing_systems').select('*').order('id'),
        'catalog.listWritingSystems',
      );
    },
    async listVarieties() {
      return unwrap(
        await db.from('language_varieties').select('*').order('id'),
        'catalog.listVarieties',
      );
    },
    async listTracks() {
      return unwrap(
        await db.from('course_tracks').select('*').order('sort_order'),
        'catalog.listTracks',
      );
    },
    async getTrack(id) {
      return unwrapMaybe(
        await db.from('course_tracks').select('*').eq('id', id).single(),
        'catalog.getTrack',
      );
    },
    async listCoverage(courseTrackId, sourceLanguageCode) {
      let q = db
        .from('course_source_localizations')
        .select(COVERAGE_COLUMNS)
        .eq('course_track_id', courseTrackId);
      if (sourceLanguageCode) q = q.eq('source_language_code', sourceLanguageCode);
      return unwrap(await q, 'catalog.listCoverage');
    },
    async listCoverageForSource(sourceLanguageCode) {
      return unwrap(
        await db
          .from('course_source_localizations')
          .select(COVERAGE_COLUMNS)
          .eq('source_language_code', sourceLanguageCode),
        'catalog.listCoverageForSource',
      );
    },
    async listCoverageStaff(courseTrackId) {
      let q = db.from('course_source_localizations_staff').select('*');
      if (courseTrackId) q = q.eq('course_track_id', courseTrackId);
      // The view is `select *` over the table; generated view types lose NOT NULL, hence the cast.
      return unwrap(await q, 'catalog.listCoverageStaff') as Row<'course_source_localizations'>[];
    },
    async updateCoverage(courseTrackId, sourceLanguageCode, patch) {
      return unwrap(
        await db
          .from('course_source_localizations')
          .update(patch)
          .eq('course_track_id', courseTrackId)
          .eq('source_language_code', sourceLanguageCode)
          .select(COVERAGE_COLUMNS)
          .single(),
        'catalog.updateCoverage',
      );
    },
  };
}
