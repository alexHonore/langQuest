/**
 * Stored manifests (ADR-004, migration 100): `course_manifests` keyed by (track, source, version) and
 * `audio_collection_manifests` keyed by (collection, instruction language | 'any', version).
 *
 * The `manifest` column holds the exact JSON the API serves (`CourseManifest` / `AudioCollectionManifest`
 * from `@langquest/contracts`); callers that need the typed shape parse it with the contracts schema.
 * Learner JWTs read published versions only (RLS); editors/jobs/service role write.
 */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row } from '../types';

/** Which stored manifest a call refers to. */
export type ManifestRef =
  | { kind: 'course'; courseTrackId: string; sourceLanguageCode: string }
  | { kind: 'audio_collection'; collectionId: string; instructionLanguageCode?: string | null };

export type StoredManifestRow = Row<'course_manifests'> | Row<'audio_collection_manifests'>;

export interface PutManifestInput {
  version: number;
  checksum: string;
  manifest: Record<string, unknown>;
  /** `null` stores an unpublished (draft) version; defaults to now (published). */
  publishedAt?: string | null;
  generatedByJobId?: string | null;
}

export interface ManifestsRepository {
  /** Highest published version for the ref (or highest of any version with `includeUnpublished`). */
  getLatestCourseManifest(courseTrackId: string, sourceLanguageCode: string, opts?: { includeUnpublished?: boolean }): Promise<Row<'course_manifests'> | null>;
  getCourseManifestVersion(courseTrackId: string, sourceLanguageCode: string, version: number): Promise<Row<'course_manifests'> | null>;
  listCourseManifestVersions(courseTrackId: string, sourceLanguageCode: string, limit?: number): Promise<Row<'course_manifests'>[]>;
  /** Idempotent on (track, source, version): re-putting the same version replaces its body. */
  putCourseManifest(row: Insert<'course_manifests'>): Promise<Row<'course_manifests'>>;
  getLatestAudioCollectionManifest(collectionId: string, instructionLanguageCode?: string | null, opts?: { includeUnpublished?: boolean }): Promise<Row<'audio_collection_manifests'> | null>;
  getAudioCollectionManifestVersion(collectionId: string, instructionLanguageCode: string | null | undefined, version: number): Promise<Row<'audio_collection_manifests'> | null>;
  listAudioCollectionManifestVersions(collectionId: string, instructionLanguageCode?: string | null, limit?: number): Promise<Row<'audio_collection_manifests'>[]>;
  /** Idempotent on (collection, instruction language, version). */
  putAudioCollectionManifest(row: Insert<'audio_collection_manifests'>): Promise<Row<'audio_collection_manifests'>>;
  /** Kind-agnostic reads/writes for the regenerate_manifest job and the API manifest routes. */
  getLatestManifest(ref: ManifestRef, opts?: { includeUnpublished?: boolean }): Promise<StoredManifestRow | null>;
  putManifest(ref: ManifestRef, input: PutManifestInput): Promise<StoredManifestRow>;
  /** Sets/clears `published_at` on one stored version (unpublish keeps the row for rollback). */
  setPublished(ref: ManifestRef, version: number, publishedAt: string | null): Promise<StoredManifestRow>;
}

/** DB value for the audio manifest instruction language (`'any'` when none). */
export const audioManifestLanguage = (code?: string | null): string => (code && code.length > 0 ? code : 'any');

export function manifestsRepository(db: DbClient): ManifestsRepository {
  const latestCourse = async (courseTrackId: string, sourceLanguageCode: string, includeUnpublished: boolean) => {
    let q = db.from('course_manifests').select('*').eq('course_track_id', courseTrackId).eq('source_language_code', sourceLanguageCode);
    if (!includeUnpublished) q = q.not('published_at', 'is', null);
    return unwrapMaybe(await q.order('version', { ascending: false }).limit(1).maybeSingle(), 'manifests.getLatestCourseManifest');
  };
  const latestAudio = async (collectionId: string, instructionLanguageCode: string | null | undefined, includeUnpublished: boolean) => {
    let q = db.from('audio_collection_manifests').select('*').eq('collection_id', collectionId).eq('instruction_language_code', audioManifestLanguage(instructionLanguageCode));
    if (!includeUnpublished) q = q.not('published_at', 'is', null);
    return unwrapMaybe(await q.order('version', { ascending: false }).limit(1).maybeSingle(), 'manifests.getLatestAudioCollectionManifest');
  };
  const putCourse = async (row: Insert<'course_manifests'>) =>
    unwrap(await db.from('course_manifests').upsert(row, { onConflict: 'course_track_id,source_language_code,version' }).select('*').single(), 'manifests.putCourseManifest');
  const putAudio = async (row: Insert<'audio_collection_manifests'>) =>
    unwrap(
      await db
        .from('audio_collection_manifests')
        .upsert({ ...row, instruction_language_code: audioManifestLanguage(row.instruction_language_code) }, { onConflict: 'collection_id,instruction_language_code,version' })
        .select('*')
        .single(),
      'manifests.putAudioCollectionManifest',
    );

  return {
    getLatestCourseManifest: (track, source, opts) => latestCourse(track, source, Boolean(opts?.includeUnpublished)),
    async getCourseManifestVersion(track, source, version) {
      return unwrapMaybe(
        await db.from('course_manifests').select('*').eq('course_track_id', track).eq('source_language_code', source).eq('version', version).maybeSingle(),
        'manifests.getCourseManifestVersion',
      );
    },
    async listCourseManifestVersions(track, source, limit = 20) {
      return unwrap(
        await db.from('course_manifests').select('*').eq('course_track_id', track).eq('source_language_code', source).order('version', { ascending: false }).limit(limit),
        'manifests.listCourseManifestVersions',
      );
    },
    putCourseManifest: putCourse,
    getLatestAudioCollectionManifest: (collectionId, lang, opts) => latestAudio(collectionId, lang, Boolean(opts?.includeUnpublished)),
    async getAudioCollectionManifestVersion(collectionId, lang, version) {
      return unwrapMaybe(
        await db
          .from('audio_collection_manifests')
          .select('*')
          .eq('collection_id', collectionId)
          .eq('instruction_language_code', audioManifestLanguage(lang))
          .eq('version', version)
          .maybeSingle(),
        'manifests.getAudioCollectionManifestVersion',
      );
    },
    async listAudioCollectionManifestVersions(collectionId, lang, limit = 20) {
      return unwrap(
        await db
          .from('audio_collection_manifests')
          .select('*')
          .eq('collection_id', collectionId)
          .eq('instruction_language_code', audioManifestLanguage(lang))
          .order('version', { ascending: false })
          .limit(limit),
        'manifests.listAudioCollectionManifestVersions',
      );
    },
    putAudioCollectionManifest: putAudio,
    async getLatestManifest(ref, opts) {
      const includeUnpublished = Boolean(opts?.includeUnpublished);
      return ref.kind === 'course'
        ? latestCourse(ref.courseTrackId, ref.sourceLanguageCode, includeUnpublished)
        : latestAudio(ref.collectionId, ref.instructionLanguageCode, includeUnpublished);
    },
    async putManifest(ref, input) {
      const common = {
        version: input.version,
        checksum: input.checksum,
        manifest: input.manifest as never,
        published_at: input.publishedAt === undefined ? new Date().toISOString() : input.publishedAt,
        generated_by_job_id: input.generatedByJobId ?? null,
      };
      return ref.kind === 'course'
        ? putCourse({ ...common, course_track_id: ref.courseTrackId, source_language_code: ref.sourceLanguageCode })
        : putAudio({ ...common, collection_id: ref.collectionId, instruction_language_code: audioManifestLanguage(ref.instructionLanguageCode) });
    },
    async setPublished(ref, version, publishedAt) {
      if (ref.kind === 'course') {
        return unwrap(
          await db
            .from('course_manifests')
            .update({ published_at: publishedAt })
            .eq('course_track_id', ref.courseTrackId)
            .eq('source_language_code', ref.sourceLanguageCode)
            .eq('version', version)
            .select('*')
            .single(),
          'manifests.setPublished',
        );
      }
      return unwrap(
        await db
          .from('audio_collection_manifests')
          .update({ published_at: publishedAt })
          .eq('collection_id', ref.collectionId)
          .eq('instruction_language_code', audioManifestLanguage(ref.instructionLanguageCode))
          .eq('version', version)
          .select('*')
          .single(),
        'manifests.setPublished',
      );
    },
  };
}
