/**
 * Narrow data-access boundary for job handlers (ADR-003). Handlers never touch supabase-js directly: they
 * use `JobsDb`, implemented here over `@langquest/db` repositories plus a few explicit-column queries
 * the shared repositories do not offer yet (listed as cross-package gaps in the runner report), and in
 * tests by the in-memory `MemoryJobsDb` (`src/test-support/memory-db.ts`).
 */
import type { CourseManifest } from '@langquest/contracts';
import { DbError, createRepositories, unwrap, unwrapMaybe, type DbClient, type EnqueueJobInput, type Insert, type ManifestRef, type PutManifestInput, type Repositories, type Row, type StoredManifestRow, type Update } from '@langquest/db';

export type MediaAssetRow = Row<'media_assets'>;
export type UploadRow = Row<'uploads'>;
export type LessonRow = Row<'audio_lessons'>;
export type ChapterRow = Row<'audio_chapters'>;
export type CollectionRow = Row<'audio_course_collections'>;
export type TranscriptRow = Row<'transcripts'>;
export type SegmentRow = Row<'transcript_segments'>;
export type TranslationRow = Row<'transcript_translations'>;
export type WordAlignmentRow = Row<'transcript_word_alignments'>;
export type ProcessingJobRow = Row<'processing_jobs'>;

/** Media columns visible through lesson reads (owner / import paths are staff-only columns; use `getAsset` for the full row). */
export type LessonMediaRow = Omit<MediaAssetRow, 'owner_id' | 'legacy_filename' | 'legacy_path'>;

export interface LessonWithMedia {
  lesson: LessonRow;
  assets: Array<Row<'audio_lesson_assets'> & { media: LessonMediaRow | null }>;
  speakers: Row<'speakers'>[];
}

export interface CollectionTree {
  collection: CollectionRow;
  chapters: Array<{ chapter: ChapterRow; lessons: Array<LessonWithMedia & { transcriptLanguages: string[] }> }>;
}

export interface JobsDb {
  // --- media assets ---
  getAsset(id: string): Promise<MediaAssetRow | null>;
  findAssetByChecksum(checksum: string): Promise<MediaAssetRow | null>;
  listAssetsByChecksum(checksum: string): Promise<MediaAssetRow[]>;
  insertAsset(row: Insert<'media_assets'>): Promise<MediaAssetRow>;
  updateAsset(id: string, patch: Update<'media_assets'>): Promise<MediaAssetRow>;
  /** Assets whose `legacy_path` or `storage_key` starts with `prefix` (explicit columns only). */
  listAssetsByPrefix(prefix: string): Promise<Array<Pick<MediaAssetRow, 'id' | 'legacy_path' | 'storage_key' | 'checksum_sha256'>>>;
  /** Derivatives of a master (`source_asset_id = id`, active only). */
  listDerivedAssets(sourceAssetId: string): Promise<MediaAssetRow[]>;
  findAssetByStorageKey(storageKey: string): Promise<MediaAssetRow | null>;
  findAssetByLegacyPath(legacyPath: string): Promise<MediaAssetRow | null>;
  // --- uploads ---
  getUpload(id: string): Promise<UploadRow | null>;
  findUploadByDraftAsset(assetId: string): Promise<UploadRow | null>;
  updateUpload(id: string, patch: Update<'uploads'>): Promise<UploadRow>;
  listUploadsByStatus(status: UploadRow['status'], limit?: number): Promise<UploadRow[]>;
  // --- audio library ---
  getLesson(id: string): Promise<LessonWithMedia | null>;
  findLessonIdsForAsset(assetId: string): Promise<string[]>;
  getCollection(id: string): Promise<CollectionRow | null>;
  findCollectionByTitle(title: string, languageCode: string): Promise<CollectionRow | null>;
  findChapterByTitle(collectionId: string, title: string, languageCode: string): Promise<ChapterRow | null>;
  upsertCollection(row: Insert<'audio_course_collections'>): Promise<CollectionRow>;
  upsertChapter(row: Insert<'audio_chapters'>): Promise<ChapterRow>;
  upsertLesson(row: Insert<'audio_lessons'>): Promise<LessonRow>;
  updateLesson(id: string, patch: Update<'audio_lessons'>): Promise<LessonRow>;
  attachLessonAsset(row: Insert<'audio_lesson_assets'>): Promise<void>;
  getCollectionTree(collectionId: string): Promise<CollectionTree | null>;
  upsertLessonTopics(rows: Insert<'lesson_topics'>[]): Promise<void>;
  // --- transcripts ---
  getTranscript(id: string): Promise<TranscriptRow | null>;
  listTranscriptsForLesson(lessonId: string): Promise<TranscriptRow[]>;
  listTranscriptsForAssets(assetIds: string[]): Promise<TranscriptRow[]>;
  upsertTranscript(row: Insert<'transcripts'>): Promise<TranscriptRow>;
  updateTranscript(id: string, patch: Update<'transcripts'>): Promise<TranscriptRow>;
  replaceSegments(transcriptId: string, segments: Omit<Insert<'transcript_segments'>, 'transcript_id'>[]): Promise<SegmentRow[]>;
  listSegments(transcriptId: string): Promise<SegmentRow[]>;
  updateSegment(id: string, patch: Update<'transcript_segments'>): Promise<void>;
  upsertTranslations(rows: Insert<'transcript_translations'>[]): Promise<number>;
  listTranslations(segmentIds: string[], languageCode: string): Promise<TranslationRow[]>;
  replaceWordAlignments(segmentId: string, rows: Omit<Insert<'transcript_word_alignments'>, 'segment_id'>[]): Promise<number>;
  // --- jobs / provenance ---
  enqueueJob(input: EnqueueJobInput): Promise<ProcessingJobRow>;
  listJobsForAsset(assetId: string): Promise<ProcessingJobRow[]>;
  recordProvenance(row: Insert<'asset_provenance_events'>): Promise<void>;
  recordAudit(row: Insert<'audit_logs'>): Promise<void>;
  /** Object keys already processed by `import_r2_prefix` (audit ledger `import_r2_prefix.object`, `after.key`). */
  listImportedObjectKeys(prefix: string): Promise<string[]>;
  // --- curriculum / content factory ---
  getIntentByKey(intentKey: string): Promise<Pick<Row<'communicative_intents'>, 'id' | 'intent_key'> | null>;
  insertMission(row: Insert<'missions'>): Promise<Row<'missions'>>;
  insertMissionLocalization(row: Insert<'mission_localizations'>): Promise<void>;
  insertExpression(row: Insert<'expressions'>): Promise<Row<'expressions'>>;
  insertExpressionForm(row: Insert<'expression_forms'>): Promise<void>;
  insertExpressionTranslation(row: Insert<'expression_translations'>): Promise<void>;
  buildCourseManifest(courseTrackId: string, sourceLanguageCode: string, targetVarietyId: string): Promise<CourseManifest>;
  // --- stored manifests (ADR-004: `course_manifests` / `audio_collection_manifests`) ---
  /** Highest stored version for the ref, published or not (the job compares against the last build, whatever its publication state). */
  getLatestStoredManifest(ref: ManifestRef): Promise<StoredManifestRow | null>;
  /** Idempotent on (ref, version); `generatedByJobId` is dropped when no such `processing_jobs` row exists (direct runs). */
  putStoredManifest(ref: ManifestRef, input: PutManifestInput): Promise<StoredManifestRow>;
  // --- AI suggestions (§7.4: `asset_suggestions`, never auto-applied) ---
  insertAssetSuggestions(rows: Insert<'asset_suggestions'>[]): Promise<Row<'asset_suggestions'>[]>;
  listAssetSuggestionsForJob(jobId: string): Promise<Row<'asset_suggestions'>[]>;
  // --- visuals ---
  findVisualByHash(contentHash: string): Promise<Row<'visual_assets'> | null>;
  insertVisualAsset(row: Insert<'visual_assets'>): Promise<Row<'visual_assets'>>;
  upsertCoverArt(row: Insert<'audio_cover_art'>): Promise<void>;
  // --- AI ---
  /** Enabled `speech_recognition` profile models for a variety (primary first), or null when none configured. */
  resolveSttModels(targetVarietyId: string): Promise<string[] | null>;
  listEnabledModelProfiles(): Promise<Row<'ai_model_profiles'>[]>;
  logAiRequest(row: Insert<'ai_requests'>): Promise<void>;
  // --- model benchmarks (§8.7, `benchmark_model`) ---
  /** One `ai_model_profiles` row by id, enabled or not (benchmarks also run on draft profiles). */
  getModelProfile(id: string): Promise<Row<'ai_model_profiles'> | null>;
  /**
   * Set a profile's `benchmark_status` only while the row still routes to the benchmarked model at the version the run
   * read (a config change during the run bumps `version`). Returns whether a row was updated.
   */
  setModelProfileBenchmarkStatus(input: { id: string; status: Row<'ai_model_profiles'>['benchmark_status']; primaryModel: string; version: number }): Promise<boolean>;
  recordModelBenchmark(row: Insert<'ai_model_benchmarks'>): Promise<Row<'ai_model_benchmarks'>>;
  /** The full-run benchmark row an earlier attempt of this job recorded (its notes carry `benchmarkNotesJobMarker`), if any. */
  findModelBenchmarkForJob(input: { profileId: string; jobId: string }): Promise<Row<'ai_model_benchmarks'> | null>;
  /** Sum of `ai_requests.estimated_cost_usd` attributed to a profile since an instant (daily budget checks). */
  sumAiSpendSince(input: { profileId: string; since: string }): Promise<number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marker a `benchmark_model` run writes into `ai_model_benchmarks.notes` (there is no job column): a retry of the same
 * job finds its earlier row by it instead of re-running the paid samples. Only uuids are accepted, so the LIKE pattern
 * built from it has no wildcard characters.
 */
export function benchmarkNotesJobMarker(jobId: string): string {
  if (!UUID_RE.test(jobId)) throw new Error(`benchmarkNotesJobMarker: ${jobId} is not a uuid`);
  return `job ${jobId.toLowerCase()}.`;
}

/** PostgREST answers at most this many rows per request (`max_rows`); ledger sums page through it. */
const LEDGER_PAGE_ROWS = 1000;

const LEGACY_COLUMNS = 'id, legacy_path, storage_key, checksum_sha256';

/** `JobsDb` over a service-role supabase client. */
export function createSupabaseJobsDb(db: DbClient, repos: Repositories = createRepositories(db)): JobsDb {
  const translated = (translations: unknown, lang: string): string | null => {
    const obj = (translations ?? {}) as Record<string, unknown>;
    const v = obj[lang];
    return typeof v === 'string' ? v : null;
  };

  return {
    // media assets — full rows (service role; `owner_id` / legacy paths are staff-only columns for JWTs)
    async getAsset(id) {
      return unwrapMaybe(await db.from('media_assets').select('*').eq('id', id).single(), 'jobs.getAsset');
    },
    async findAssetByChecksum(checksum) {
      const rows = unwrap(await db.from('media_assets').select('*').eq('checksum_sha256', checksum).order('created_at').limit(1), 'jobs.findAssetByChecksum');
      return rows[0] ?? null;
    },
    async listAssetsByChecksum(checksum) {
      return unwrap(await db.from('media_assets').select('*').eq('checksum_sha256', checksum).order('created_at'), 'jobs.listAssetsByChecksum');
    },
    async insertAsset(row) {
      return unwrap(await db.from('media_assets').insert(row).select('*').single(), 'jobs.insertAsset');
    },
    async updateAsset(id, patch) {
      return unwrap(await db.from('media_assets').update(patch).eq('id', id).select('*').single(), 'jobs.updateAsset');
    },
    async listAssetsByPrefix(prefix) {
      const escaped = prefix.replace(/[%_]/g, (m) => `\\${m}`);
      const byPath = unwrap(await db.from('media_assets').select(LEGACY_COLUMNS).like('legacy_path', `${escaped}%`).limit(50_000), 'jobs.listAssetsByPrefix.path');
      const byKey = unwrap(await db.from('media_assets').select(LEGACY_COLUMNS).like('storage_key', `${escaped}%`).limit(50_000), 'jobs.listAssetsByPrefix.key');
      const seen = new Map<string, (typeof byPath)[number]>();
      for (const r of [...byPath, ...byKey]) seen.set(r.id, r);
      return [...seen.values()];
    },
    async listDerivedAssets(sourceAssetId) {
      return unwrap(await db.from('media_assets').select('*').eq('source_asset_id', sourceAssetId).eq('disposition', 'active').order('created_at'), 'jobs.listDerivedAssets');
    },
    async findAssetByStorageKey(storageKey) {
      const rows = unwrap(await db.from('media_assets').select('*').eq('storage_key', storageKey).limit(1), 'jobs.findAssetByStorageKey');
      return rows[0] ?? null;
    },
    async findAssetByLegacyPath(legacyPath) {
      const rows = unwrap(await db.from('media_assets').select('*').eq('legacy_path', legacyPath).order('created_at').limit(1), 'jobs.findAssetByLegacyPath');
      return rows[0] ?? null;
    },
    // uploads
    getUpload: (id) => repos.uploads.getById(id),
    async findUploadByDraftAsset(assetId) {
      const rows = unwrap(await db.from('uploads').select('*').eq('draft_asset_id', assetId).order('created_at', { ascending: false }).limit(1), 'jobs.findUploadByDraftAsset');
      return rows[0] ?? null;
    },
    updateUpload: (id, patch) => repos.uploads.update(id, patch),
    listUploadsByStatus: (status, limit) => repos.uploads.listByStatus(status, limit),
    // audio library
    getLesson: (id) => repos.audioLibrary.getLesson(id),
    async findLessonIdsForAsset(assetId) {
      const rows = unwrap(await db.from('audio_lesson_assets').select('lesson_id').eq('asset_id', assetId), 'jobs.findLessonIdsForAsset');
      return [...new Set(rows.map((r) => r.lesson_id))];
    },
    getCollection: (id) => repos.audioLibrary.getCollection(id),
    async findCollectionByTitle(title, languageCode) {
      const rows = unwrap(await db.from('audio_course_collections').select('*').eq(`title_translations->>${languageCode}`, title).limit(1), 'jobs.findCollectionByTitle');
      return rows[0] ?? null;
    },
    async findChapterByTitle(collectionId, title, languageCode) {
      const rows = unwrap(await db.from('audio_chapters').select('*').eq('collection_id', collectionId), 'jobs.findChapterByTitle');
      return rows.find((c) => translated(c.title_translations, languageCode) === title) ?? null;
    },
    upsertCollection: (row) => repos.audioLibrary.upsertCollection(row),
    upsertChapter: (row) => repos.audioLibrary.upsertChapter(row),
    upsertLesson: (row) => repos.audioLibrary.upsertLesson(row),
    updateLesson: (id, patch) => repos.audioLibrary.updateLesson(id, patch),
    async attachLessonAsset(row) {
      await repos.audioLibrary.attachLessonAsset(row);
    },
    async getCollectionTree(collectionId) {
      const collection = await repos.audioLibrary.getCollection(collectionId);
      if (!collection) return null;
      const chapters = await repos.audioLibrary.listChapters(collectionId);
      const out: CollectionTree = { collection, chapters: [] };
      for (const chapter of chapters) {
        const lessons = await repos.audioLibrary.listLessons(chapter.id);
        const full: CollectionTree['chapters'][number]['lessons'] = [];
        for (const lesson of lessons) {
          const detail = await repos.audioLibrary.getLesson(lesson.id);
          if (!detail) continue;
          const transcripts = unwrap(await db.from('transcripts').select('primary_language_code, status').eq('lesson_id', lesson.id), 'jobs.getCollectionTree.transcripts');
          const transcriptLanguages = [...new Set(transcripts.filter((t) => t.status !== 'failed' && t.status !== 'none').map((t) => t.primary_language_code))];
          full.push({ ...detail, transcriptLanguages });
        }
        out.chapters.push({ chapter, lessons: full });
      }
      return out;
    },
    async upsertLessonTopics(rows) {
      if (!rows.length) return;
      unwrap(await db.from('lesson_topics').upsert(rows, { onConflict: 'lesson_id,topic_key' }), 'jobs.upsertLessonTopics');
    },
    // transcripts
    async getTranscript(id) {
      return unwrapMaybe(await db.from('transcripts').select('*').eq('id', id).single(), 'jobs.getTranscript');
    },
    async listTranscriptsForLesson(lessonId) {
      return unwrap(await db.from('transcripts').select('*').eq('lesson_id', lessonId).order('revision'), 'jobs.listTranscriptsForLesson');
    },
    async listTranscriptsForAssets(assetIds) {
      if (!assetIds.length) return [];
      return unwrap(await db.from('transcripts').select('*').in('source_asset_id', assetIds).order('created_at', { ascending: false }), 'jobs.listTranscriptsForAssets');
    },
    upsertTranscript: (row) => repos.audioLibrary.upsertTranscript(row),
    async updateTranscript(id, patch) {
      return unwrap(await db.from('transcripts').update(patch).eq('id', id).select('*').single(), 'jobs.updateTranscript');
    },
    replaceSegments: (transcriptId, segments) => repos.audioLibrary.replaceTranscriptSegments(transcriptId, segments),
    async listSegments(transcriptId) {
      return unwrap(await db.from('transcript_segments').select('*').eq('transcript_id', transcriptId).order('sort_index'), 'jobs.listSegments');
    },
    async updateSegment(id, patch) {
      unwrap(await db.from('transcript_segments').update(patch).eq('id', id), 'jobs.updateSegment');
    },
    async upsertTranslations(rows) {
      if (!rows.length) return 0;
      unwrap(await db.from('transcript_translations').upsert(rows, { onConflict: 'segment_id,language_code' }), 'jobs.upsertTranslations');
      return rows.length;
    },
    async listTranslations(segmentIds, languageCode) {
      if (!segmentIds.length) return [];
      return unwrap(await db.from('transcript_translations').select('*').in('segment_id', segmentIds).eq('language_code', languageCode), 'jobs.listTranslations');
    },
    async replaceWordAlignments(segmentId, rows) {
      unwrap(await db.from('transcript_word_alignments').delete().eq('segment_id', segmentId), 'jobs.replaceWordAlignments.delete');
      if (!rows.length) return 0;
      unwrap(await db.from('transcript_word_alignments').insert(rows.map((r) => ({ ...r, segment_id: segmentId }))), 'jobs.replaceWordAlignments.insert');
      return rows.length;
    },
    // jobs / provenance
    enqueueJob: (input) => repos.processingJobs.enqueue(input),
    listJobsForAsset: (assetId) => repos.processingJobs.listForAsset(assetId),
    async recordProvenance(row) {
      await repos.processingJobs.recordProvenance(row);
    },
    async recordAudit(row) {
      await repos.auditLog.record(row);
    },
    async listImportedObjectKeys(prefix) {
      const escaped = prefix.replace(/[%_]/g, (m) => `\\${m}`);
      const rows = unwrap(await db.from('audit_logs').select('after').eq('action', 'import_r2_prefix.object').like('after->>key', `${escaped}%`).limit(100_000), 'jobs.listImportedObjectKeys');
      return rows.map((r) => (r.after as { key?: string } | null)?.key).filter((k): k is string => typeof k === 'string');
    },
    // curriculum
    async getIntentByKey(intentKey) {
      const rows = unwrap(await db.from('communicative_intents').select('id, intent_key').eq('intent_key', intentKey).limit(1), 'jobs.getIntentByKey');
      return rows[0] ?? null;
    },
    insertMission: (row) => repos.curriculum.upsertMission(row),
    async insertMissionLocalization(row) {
      unwrap(await db.from('mission_localizations').upsert(row, { onConflict: 'mission_id,source_language_code' }), 'jobs.insertMissionLocalization');
    },
    insertExpression: (row) => repos.curriculum.insertExpression(row),
    async insertExpressionForm(row) {
      unwrap(await db.from('expression_forms').insert(row), 'jobs.insertExpressionForm');
    },
    async insertExpressionTranslation(row) {
      unwrap(await db.from('expression_translations').upsert(row, { onConflict: 'expression_id,source_language_code' }), 'jobs.insertExpressionTranslation');
    },
    async buildCourseManifest(courseTrackId, sourceLanguageCode, targetVarietyId) {
      const localized = await repos.curriculum.buildManifest(courseTrackId, sourceLanguageCode, targetVarietyId);
      return localized as unknown as CourseManifest;
    },
    // stored manifests
    getLatestStoredManifest: (ref) => repos.manifests.getLatestManifest(ref, { includeUnpublished: true }),
    async putStoredManifest(ref, input) {
      try {
        return await repos.manifests.putManifest(ref, input);
      } catch (error) {
        // 23503 foreign_key_violation on generated_by_job_id: the job ran outside the queue (`runDirect`), so no
        // processing_jobs row exists; the manifest itself is still stored, without the job link.
        if (error instanceof DbError && error.code === '23503' && input.generatedByJobId) return repos.manifests.putManifest(ref, { ...input, generatedByJobId: null });
        throw error;
      }
    },
    // AI suggestions
    insertAssetSuggestions: (rows) => repos.assetSuggestions.insertMany(rows),
    listAssetSuggestionsForJob: (jobId) => repos.assetSuggestions.listForJob(jobId),
    // visuals
    findVisualByHash: (hash) => repos.visualAssets.findByHash(hash),
    insertVisualAsset: (row) => repos.visualAssets.insert(row),
    async upsertCoverArt(row) {
      await repos.visualAssets.upsertCoverArt(row);
    },
    // AI
    async resolveSttModels(targetVarietyId) {
      const profile = await repos.aiProfiles.resolve('speech_recognition', targetVarietyId, null).catch((e: unknown) => {
        if (e instanceof DbError && e.isNotFound) return null;
        throw e;
      });
      if (!profile || !profile.enabled) return null;
      return [profile.primary_model, ...(profile.fallback_models ?? [])];
    },
    listEnabledModelProfiles: () => repos.aiProfiles.list({ enabledOnly: true }),
    logAiRequest: (row) => repos.aiProfiles.logRequest(row),
    // model benchmarks
    getModelProfile: (id) => repos.aiProfiles.getById(id),
    async setModelProfileBenchmarkStatus({ id, status, primaryModel, version }) {
      const rows = unwrap(await db.from('ai_model_profiles').update({ benchmark_status: status }).eq('id', id).eq('primary_model', primaryModel).eq('version', version).select('id'), 'jobs.setModelProfileBenchmarkStatus');
      return rows.length > 0;
    },
    recordModelBenchmark: (row) => repos.aiProfiles.recordBenchmark(row),
    async findModelBenchmarkForJob({ profileId, jobId }) {
      if (!UUID_RE.test(jobId)) return null;
      const rows = unwrap(await db.from('ai_model_benchmarks').select('*').eq('profile_id', profileId).like('notes', `%${benchmarkNotesJobMarker(jobId)}%`).order('created_at').limit(1), 'jobs.findModelBenchmarkForJob');
      return rows[0] ?? null;
    },
    async sumAiSpendSince({ profileId, since }) {
      let total = 0;
      for (let from = 0; ; from += LEDGER_PAGE_ROWS) {
        const rows = unwrap(await db.from('ai_requests').select('id, estimated_cost_usd').eq('profile_id', profileId).gte('created_at', since).order('created_at').order('id').range(from, from + LEDGER_PAGE_ROWS - 1), 'jobs.sumAiSpendSince');
        for (const r of rows) total += Number(r.estimated_cost_usd ?? 0);
        if (rows.length < LEDGER_PAGE_ROWS) return total;
      }
    },
  };
}
