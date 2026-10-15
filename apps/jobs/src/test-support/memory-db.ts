/**
 * In-memory `JobsDb` for unit tests (no Supabase). Rows are plain objects shaped like the generated
 * `Row<…>` types with sensible defaults, so handlers exercise the same code paths as in production.
 */
import type { CourseManifest } from '@langquest/contracts';
import type { EnqueueJobInput, Insert, Row, Update } from '@langquest/db';
import type { JobsDb, LessonWithMedia, MediaAssetRow, ProcessingJobRow, SegmentRow, TranscriptRow, TranslationRow, UploadRow, WordAlignmentRow } from '../db';

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

type Rows<N extends keyof RowMap> = RowMap[N];
interface RowMap {
  media_assets: MediaAssetRow;
  uploads: UploadRow;
  audio_course_collections: Row<'audio_course_collections'>;
  audio_chapters: Row<'audio_chapters'>;
  audio_lessons: Row<'audio_lessons'>;
  audio_lesson_assets: Row<'audio_lesson_assets'>;
  transcripts: TranscriptRow;
  transcript_segments: SegmentRow;
  transcript_translations: TranslationRow;
  transcript_word_alignments: WordAlignmentRow;
  lesson_topics: Row<'lesson_topics'>;
  processing_jobs: ProcessingJobRow;
  asset_provenance_events: Row<'asset_provenance_events'>;
  audit_logs: Row<'audit_logs'>;
  missions: Row<'missions'>;
  mission_localizations: Row<'mission_localizations'>;
  expressions: Row<'expressions'>;
  expression_forms: Row<'expression_forms'>;
  expression_translations: Row<'expression_translations'>;
  visual_assets: Row<'visual_assets'>;
  audio_cover_art: Row<'audio_cover_art'>;
  ai_requests: Row<'ai_requests'>;
  speakers: Row<'speakers'>;
}

export class MemoryJobsDb implements JobsDb {
  readonly tables: { [K in keyof RowMap]: Map<string, Rows<K>> } = {
    media_assets: new Map(),
    uploads: new Map(),
    audio_course_collections: new Map(),
    audio_chapters: new Map(),
    audio_lessons: new Map(),
    audio_lesson_assets: new Map(),
    transcripts: new Map(),
    transcript_segments: new Map(),
    transcript_translations: new Map(),
    transcript_word_alignments: new Map(),
    lesson_topics: new Map(),
    processing_jobs: new Map(),
    asset_provenance_events: new Map(),
    audit_logs: new Map(),
    missions: new Map(),
    mission_localizations: new Map(),
    expressions: new Map(),
    expression_forms: new Map(),
    expression_translations: new Map(),
    visual_assets: new Map(),
    audio_cover_art: new Map(),
    ai_requests: new Map(),
    speakers: new Map(),
  };
  /** Intent keys known to the (fake) `communicative_intents` table. */
  readonly intents = new Map<string, string>();
  /** `speech_recognition` model overrides per variety. */
  readonly sttProfiles = new Map<string, string[]>();
  courseManifest: CourseManifest | null = null;

  // --- seeding helpers ---------------------------------------------------------------------
  seedAsset(partial: Partial<MediaAssetRow> & Pick<MediaAssetRow, 'storage_key' | 'checksum_sha256' | 'mime_type' | 'byte_length'>): MediaAssetRow {
    const row: MediaAssetRow = {
      id: uuid(),
      bucket: 'local',
      owner_id: null,
      kind: 'audio',
      duration_ms: null,
      channels: null,
      sample_rate_hz: null,
      bitrate_kbps: null,
      source_asset_id: null,
      derivation: null,
      visibility: 'private',
      content_rights_id: null,
      disposition: 'active',
      legacy_filename: null,
      legacy_path: null,
      state: 'imported_draft',
      etag: null,
      created_at: now(),
      updated_at: now(),
      ...partial,
    };
    this.tables.media_assets.set(row.id, row);
    return row;
  }
  seedUpload(partial: Partial<UploadRow> & Pick<UploadRow, 'storage_key' | 'client_checksum_sha256' | 'declared_byte_length' | 'declared_mime_type'>): UploadRow {
    const row: UploadRow = {
      id: uuid(),
      user_id: uuid(),
      draft_asset_id: null,
      multipart_upload_id: null,
      part_size_bytes: 16 * 1024 * 1024,
      part_count: 1,
      completed_parts: [],
      original_filename: 'file.mp3',
      original_path: null,
      verified_checksum_sha256: null,
      status: 'completed',
      failure_code: null,
      idempotency_key: uuid(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_at: now(),
      updated_at: now(),
      ...partial,
    };
    this.tables.uploads.set(row.id, row);
    return row;
  }
  seedCollection(partial: Partial<Row<'audio_course_collections'>> = {}): Row<'audio_course_collections'> {
    const row: Row<'audio_course_collections'> = { id: uuid(), title_translations: { en: 'Collection' }, description_translations: {}, course_track_id: null, target_variety_id: null, instruction_language_code: null, region: null, instructor_speaker_id: null, cover_visual_asset_id: null, content_rights_id: null, state: 'imported_draft', sort_order: 0, published_version: null, created_at: now(), updated_at: now(), ...partial };
    this.tables.audio_course_collections.set(row.id, row);
    return row;
  }
  seedChapter(collectionId: string, partial: Partial<Row<'audio_chapters'>> = {}): Row<'audio_chapters'> {
    const row: Row<'audio_chapters'> = { id: uuid(), collection_id: collectionId, title_translations: { en: 'Chapter 1' }, summary_translations: {}, sort_order: 0, cover_visual_asset_id: null, state: 'imported_draft', created_at: now(), updated_at: now(), ...partial };
    this.tables.audio_chapters.set(row.id, row);
    return row;
  }
  seedLesson(chapterId: string, partial: Partial<Row<'audio_lessons'>> = {}): Row<'audio_lessons'> {
    const row: Row<'audio_lessons'> = { id: uuid(), chapter_id: chapterId, title_translations: { en: 'Lesson 1' }, description_translations: {}, sort_order: 0, episode_number: null, level: null, target_variety_id: null, instruction_language_code: null, spoken_language_codes: [], regional_dialect: null, topic: null, tags: [], scene: null, state: 'imported_draft', transcript_status: 'none', listen_length_ms: null, quality_review_status: 'unreviewed', visibility: 'private', content_rights_id: null, cover_visual_asset_id: null, published_revision: null, created_at: now(), updated_at: now(), ...partial };
    this.tables.audio_lessons.set(row.id, row);
    return row;
  }
  seedTranscript(lessonId: string, partial: Partial<TranscriptRow> = {}): TranscriptRow {
    const row: TranscriptRow = { id: uuid(), lesson_id: lessonId, language_mode: 'target', primary_language_code: 'es', revision: 0, coverage_pct: 0, status: 'machine', qa_state: 'machine_draft', provider: 'fake', model: 'fake-stt', access_rights: 'internal_only', source_asset_id: null, manually_uploaded: false, created_at: now(), updated_at: now(), ...partial };
    this.tables.transcripts.set(row.id, row);
    return row;
  }

  // --- JobsDb -------------------------------------------------------------------------------
  async getAsset(id: string) {
    return this.tables.media_assets.get(id) ?? null;
  }
  async findAssetByChecksum(checksum: string) {
    return [...this.tables.media_assets.values()].find((a) => a.checksum_sha256 === checksum) ?? null;
  }
  async listAssetsByChecksum(checksum: string) {
    return [...this.tables.media_assets.values()].filter((a) => a.checksum_sha256 === checksum);
  }
  async insertAsset(row: Insert<'media_assets'>) {
    const full = this.seedAsset({ ...(row as Partial<MediaAssetRow>), storage_key: row.storage_key, checksum_sha256: row.checksum_sha256, mime_type: row.mime_type, byte_length: row.byte_length });
    return full;
  }
  async updateAsset(id: string, patch: Update<'media_assets'>) {
    const row = this.tables.media_assets.get(id);
    if (!row) throw new Error(`asset ${id} missing`);
    const next = { ...row, ...(patch as Partial<MediaAssetRow>), updated_at: now() };
    this.tables.media_assets.set(id, next);
    return next;
  }
  async listAssetsByPrefix(prefix: string) {
    return [...this.tables.media_assets.values()].filter((a) => a.storage_key.startsWith(prefix) || (a.legacy_path ?? '').startsWith(prefix)).map((a) => ({ id: a.id, legacy_path: a.legacy_path, storage_key: a.storage_key, checksum_sha256: a.checksum_sha256 }));
  }
  async listDerivedAssets(sourceAssetId: string) {
    return [...this.tables.media_assets.values()].filter((a) => a.source_asset_id === sourceAssetId && a.disposition === 'active');
  }
  async findAssetByStorageKey(storageKey: string) {
    return [...this.tables.media_assets.values()].find((a) => a.storage_key === storageKey) ?? null;
  }
  async findAssetByLegacyPath(legacyPath: string) {
    return [...this.tables.media_assets.values()].find((a) => a.legacy_path === legacyPath) ?? null;
  }
  async getUpload(id: string) {
    return this.tables.uploads.get(id) ?? null;
  }
  async findUploadByDraftAsset(assetId: string) {
    return [...this.tables.uploads.values()].find((u) => u.draft_asset_id === assetId) ?? null;
  }
  async updateUpload(id: string, patch: Update<'uploads'>) {
    const row = this.tables.uploads.get(id);
    if (!row) throw new Error(`upload ${id} missing`);
    const next = { ...row, ...(patch as Partial<UploadRow>), updated_at: now() };
    this.tables.uploads.set(id, next);
    return next;
  }
  async listUploadsByStatus(status: UploadRow['status'], limit = 100) {
    return [...this.tables.uploads.values()].filter((u) => u.status === status).slice(0, limit);
  }
  async getLesson(id: string): Promise<LessonWithMedia | null> {
    const lesson = this.tables.audio_lessons.get(id);
    if (!lesson) return null;
    const assets = [...this.tables.audio_lesson_assets.values()].filter((l) => l.lesson_id === id).map((l) => ({ ...l, media: this.tables.media_assets.get(l.asset_id) ?? null }));
    return { lesson, assets, speakers: [] };
  }
  async findLessonIdsForAsset(assetId: string) {
    return [...new Set([...this.tables.audio_lesson_assets.values()].filter((l) => l.asset_id === assetId).map((l) => l.lesson_id))];
  }
  async getCollection(id: string) {
    return this.tables.audio_course_collections.get(id) ?? null;
  }
  async findCollectionByTitle(title: string, lang: string) {
    return [...this.tables.audio_course_collections.values()].find((c) => (c.title_translations as Record<string, string>)[lang] === title) ?? null;
  }
  async findChapterByTitle(collectionId: string, title: string, lang: string) {
    return [...this.tables.audio_chapters.values()].find((c) => c.collection_id === collectionId && (c.title_translations as Record<string, string>)[lang] === title) ?? null;
  }
  async upsertCollection(row: Insert<'audio_course_collections'>) {
    return this.seedCollection(row as Partial<Row<'audio_course_collections'>>);
  }
  async upsertChapter(row: Insert<'audio_chapters'>) {
    return this.seedChapter(row.collection_id, row as Partial<Row<'audio_chapters'>>);
  }
  async upsertLesson(row: Insert<'audio_lessons'>) {
    if (row.id && this.tables.audio_lessons.has(row.id)) return this.updateLesson(row.id, row as Update<'audio_lessons'>);
    return this.seedLesson(row.chapter_id, row as Partial<Row<'audio_lessons'>>);
  }
  async updateLesson(id: string, patch: Update<'audio_lessons'>) {
    const row = this.tables.audio_lessons.get(id);
    if (!row) throw new Error(`lesson ${id} missing`);
    const next = { ...row, ...(patch as Partial<Row<'audio_lessons'>>), updated_at: now() };
    this.tables.audio_lessons.set(id, next);
    return next;
  }
  async attachLessonAsset(row: Insert<'audio_lesson_assets'>) {
    const key = `${row.lesson_id}:${row.asset_id}:${row.asset_type}`;
    if (![...this.tables.audio_lesson_assets.values()].some((l) => `${l.lesson_id}:${l.asset_id}:${l.asset_type}` === key)) {
      const full: Row<'audio_lesson_assets'> = { id: uuid(), lesson_id: row.lesson_id, asset_id: row.asset_id, asset_type: row.asset_type, sort_order: row.sort_order ?? 0, created_at: now(), updated_at: now() };
      this.tables.audio_lesson_assets.set(full.id, full);
    }
  }
  async getCollectionTree(collectionId: string) {
    const collection = this.tables.audio_course_collections.get(collectionId);
    if (!collection) return null;
    const chapters = [...this.tables.audio_chapters.values()].filter((c) => c.collection_id === collectionId).sort((a, b) => a.sort_order - b.sort_order);
    const out = [];
    for (const chapter of chapters) {
      const lessons = [...this.tables.audio_lessons.values()].filter((l) => l.chapter_id === chapter.id).sort((a, b) => a.sort_order - b.sort_order);
      const full = [];
      for (const lesson of lessons) {
        const detail = (await this.getLesson(lesson.id))!;
        const transcriptLanguages = [...new Set([...this.tables.transcripts.values()].filter((t) => t.lesson_id === lesson.id && t.status !== 'failed' && t.status !== 'none').map((t) => t.primary_language_code))];
        full.push({ ...detail, transcriptLanguages });
      }
      out.push({ chapter, lessons: full });
    }
    return { collection, chapters: out };
  }
  async upsertLessonTopics(rows: Insert<'lesson_topics'>[]) {
    for (const r of rows) {
      const existing = [...this.tables.lesson_topics.values()].find((t) => t.lesson_id === r.lesson_id && t.topic_key === r.topic_key);
      const full: Row<'lesson_topics'> = { id: existing?.id ?? uuid(), lesson_id: r.lesson_id, topic_key: r.topic_key, confidence: r.confidence ?? null, provenance: r.provenance ?? 'editor', created_at: existing?.created_at ?? now(), updated_at: now() };
      this.tables.lesson_topics.set(full.id, full);
    }
  }
  async getTranscript(id: string) {
    return this.tables.transcripts.get(id) ?? null;
  }
  async listTranscriptsForLesson(lessonId: string) {
    return [...this.tables.transcripts.values()].filter((t) => t.lesson_id === lessonId).sort((a, b) => a.revision - b.revision);
  }
  async listTranscriptsForAssets(assetIds: string[]) {
    return [...this.tables.transcripts.values()].filter((t) => t.source_asset_id !== null && assetIds.includes(t.source_asset_id));
  }
  async upsertTranscript(row: Insert<'transcripts'>) {
    const existing = [...this.tables.transcripts.values()].find((t) => t.lesson_id === row.lesson_id && t.revision === (row.revision ?? 0));
    if (existing) {
      const next = { ...existing, ...(row as Partial<TranscriptRow>), updated_at: now() };
      this.tables.transcripts.set(existing.id, next);
      return next;
    }
    return this.seedTranscript(row.lesson_id, row as Partial<TranscriptRow>);
  }
  async updateTranscript(id: string, patch: Update<'transcripts'>) {
    const row = this.tables.transcripts.get(id);
    if (!row) throw new Error(`transcript ${id} missing`);
    const next = { ...row, ...(patch as Partial<TranscriptRow>), updated_at: now() };
    this.tables.transcripts.set(id, next);
    return next;
  }
  async replaceSegments(transcriptId: string, segments: Omit<Insert<'transcript_segments'>, 'transcript_id'>[]) {
    for (const [id, s] of this.tables.transcript_segments) if (s.transcript_id === transcriptId) this.tables.transcript_segments.delete(id);
    const out: SegmentRow[] = [];
    segments.forEach((s, i) => {
      const row: SegmentRow = { id: uuid(), transcript_id: transcriptId, sort_index: s.sort_index ?? i, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text, speaker_label: s.speaker_label ?? null, speaker_id: null, language_code: s.language_code ?? null, target_variety_id: s.target_variety_id ?? null, script: null, confidence: s.confidence ?? null, reviewed: s.reviewed ?? false, created_at: now(), updated_at: now() };
      this.tables.transcript_segments.set(row.id, row);
      out.push(row);
    });
    return out;
  }
  async listSegments(transcriptId: string) {
    return [...this.tables.transcript_segments.values()].filter((s) => s.transcript_id === transcriptId).sort((a, b) => a.sort_index - b.sort_index);
  }
  async updateSegment(id: string, patch: Update<'transcript_segments'>) {
    const row = this.tables.transcript_segments.get(id);
    if (!row) throw new Error(`segment ${id} missing`);
    this.tables.transcript_segments.set(id, { ...row, ...(patch as Partial<SegmentRow>), updated_at: now() });
  }
  async upsertTranslations(rows: Insert<'transcript_translations'>[]) {
    for (const r of rows) {
      const existing = [...this.tables.transcript_translations.values()].find((t) => t.segment_id === r.segment_id && t.language_code === r.language_code);
      const full: TranslationRow = { id: existing?.id ?? uuid(), segment_id: r.segment_id, language_code: r.language_code, text: r.text, qa_state: r.qa_state ?? 'machine_draft', quality_flags: r.quality_flags ?? [], reviewer_id: null, created_at: existing?.created_at ?? now(), updated_at: now() };
      this.tables.transcript_translations.set(full.id, full);
    }
    return rows.length;
  }
  async listTranslations(segmentIds: string[], languageCode: string) {
    return [...this.tables.transcript_translations.values()].filter((t) => segmentIds.includes(t.segment_id) && t.language_code === languageCode);
  }
  async replaceWordAlignments(segmentId: string, rows: Omit<Insert<'transcript_word_alignments'>, 'segment_id'>[]) {
    for (const [id, w] of this.tables.transcript_word_alignments) if (w.segment_id === segmentId) this.tables.transcript_word_alignments.delete(id);
    for (const r of rows) {
      const full: WordAlignmentRow = { id: uuid(), segment_id: segmentId, word_index: r.word_index, word: r.word, start_ms: r.start_ms, end_ms: r.end_ms, confidence: r.confidence ?? null, expression_id: null, created_at: now(), updated_at: now() };
      this.tables.transcript_word_alignments.set(full.id, full);
    }
    return rows.length;
  }
  async enqueueJob(input: EnqueueJobInput) {
    const existing = [...this.tables.processing_jobs.values()].find((j) => j.idempotency_key === input.idempotencyKey);
    if (existing) return existing;
    const row: ProcessingJobRow = { id: uuid(), job_type: input.jobType, parent_asset_id: input.parentAssetId ?? null, parent_entity_table: input.parentEntityTable ?? null, parent_entity_id: input.parentEntityId ?? null, state: 'pending', priority: input.priority ?? 5, attempts: 0, max_attempts: input.maxAttempts ?? 3, progress_pct: 0, provider: input.provider ?? null, params: (input.params ?? {}) as never, cost_estimate_usd: null, cost_actual_usd: null, failure_code: null, failure_message: null, output_asset_ids: [], output: null, idempotency_key: input.idempotencyKey, requested_by: input.requestedBy ?? null, started_at: null, finished_at: null, locked_by: null, locked_until: null, created_at: now(), updated_at: now() };
    this.tables.processing_jobs.set(row.id, row);
    return row;
  }
  async listJobsForAsset(assetId: string) {
    return [...this.tables.processing_jobs.values()].filter((j) => j.parent_asset_id === assetId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async recordProvenance(row: Insert<'asset_provenance_events'>) {
    const full: Row<'asset_provenance_events'> = { id: uuid(), asset_id: row.asset_id, event_type: row.event_type, actor_id: row.actor_id ?? null, job_id: row.job_id ?? null, details: (row.details ?? {}) as never, created_at: now() };
    this.tables.asset_provenance_events.set(full.id, full);
  }
  async recordAudit(row: Insert<'audit_logs'>) {
    const full: Row<'audit_logs'> = { id: uuid(), actor_id: row.actor_id ?? null, actor_role: row.actor_role ?? null, action: row.action, entity_table: row.entity_table ?? null, entity_id: row.entity_id ?? null, before: (row.before ?? null) as never, after: (row.after ?? null) as never, ip_hash: null, request_id: row.request_id ?? null, created_at: now() };
    this.tables.audit_logs.set(full.id, full);
  }
  async listImportedObjectKeys(prefix: string) {
    return [...this.tables.audit_logs.values()].filter((a) => a.action === 'import_r2_prefix.object').map((a) => (a.after as { key?: string } | null)?.key).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
  }
  async getIntentByKey(intentKey: string) {
    const id = this.intents.get(intentKey);
    return id ? { id, intent_key: intentKey } : null;
  }
  async insertMission(row: Insert<'missions'>) {
    const full = { id: uuid(), chapter_id: null, template_key: null, mission_type: 'standard', title_translations: {}, goals: [], level: 'beginner', recommended_minutes: 8, published_revision: null, prerequisite_skill_keys: [], difficulty: 0.5, narrative_segment: null, scoring_rubric: {}, sort_order: 0, state: 'review_needed', created_at: now(), updated_at: now(), ...row } as Row<'missions'>;
    this.tables.missions.set(full.id, full);
    return full;
  }
  async insertMissionLocalization(row: Insert<'mission_localizations'>) {
    const full = { id: uuid(), hints: [], help_text: null, qa_state: 'machine_draft', reviewer_id: null, created_at: now(), updated_at: now(), ...row } as Row<'mission_localizations'>;
    this.tables.mission_localizations.set(full.id, full);
  }
  async insertExpression(row: Insert<'expressions'>) {
    const full = { id: uuid(), register: 'neutral', difficulty: 0.5, scenario_tags: [], script_annotations: {}, phonetic_annotations: {}, reviewed: false, reviewer_id: null, content_rights_id: null, origin: 'ai_generated', state: 'review_needed', created_at: now(), updated_at: now(), ...row } as Row<'expressions'>;
    this.tables.expressions.set(full.id, full);
    return full;
  }
  async insertExpressionForm(row: Insert<'expression_forms'>) {
    const full = { id: uuid(), script: null, transliteration_scheme: null, word_alignment: [], tone_markers: null, ipa: null, created_at: now(), updated_at: now(), ...row } as Row<'expression_forms'>;
    this.tables.expression_forms.set(full.id, full);
  }
  async insertExpressionTranslation(row: Insert<'expression_translations'>) {
    const full = { id: uuid(), context_note: null, literal_gloss: null, qa_state: 'machine_draft', reviewer_id: null, created_at: now(), updated_at: now(), ...row } as Row<'expression_translations'>;
    this.tables.expression_translations.set(full.id, full);
  }
  async buildCourseManifest() {
    if (!this.courseManifest) throw new Error('MemoryJobsDb.courseManifest not set');
    return this.courseManifest;
  }
  async findVisualByHash(hash: string) {
    return [...this.tables.visual_assets.values()].find((v) => v.content_hash === hash) ?? null;
  }
  async insertVisualAsset(row: Insert<'visual_assets'>) {
    const full = { id: uuid(), license_id: null, focal_point: null, locale_neutral: true, review_status: 'draft', dominant_colors: [], variants: [], generation_brief: null, prompt_template_id: null, source_file_asset_id: null, replaced_by_asset_id: null, moderation_status: 'unchecked', created_at: now(), updated_at: now(), ...row } as Row<'visual_assets'>;
    this.tables.visual_assets.set(full.id, full);
    return full;
  }
  async upsertCoverArt(row: Insert<'audio_cover_art'>) {
    const full = { id: uuid(), collection_id: null, chapter_id: null, lesson_id: null, generated_from_template: false, template_id: null, review_status: 'draft', created_at: now(), updated_at: now(), ...row } as Row<'audio_cover_art'>;
    this.tables.audio_cover_art.set(full.id, full);
  }
  async resolveSttModels(varietyId: string) {
    return this.sttProfiles.get(varietyId) ?? null;
  }
  async listEnabledModelProfiles() {
    return [];
  }
  async logAiRequest(row: Insert<'ai_requests'>) {
    const full = { id: uuid(), user_id: null, enrollment_id: null, profile_id: null, fallback_index: 0, latency_ms: null, input_tokens: null, output_tokens: null, audio_seconds: null, estimated_cost_usd: null, error_code: null, redacted_log: null, created_at: now(), ...row } as Row<'ai_requests'>;
    this.tables.ai_requests.set(full.id, full);
  }
}
