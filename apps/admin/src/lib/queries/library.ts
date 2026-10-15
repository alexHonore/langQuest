import 'server-only';
import { db, pageRange, safe, type QueryResult } from './index';

// Reads go through the `media_assets_staff` view: staff JWTs see legacy_filename / legacy_path
// / owner_id there, while the base table only grants learner-safe columns (070_rls.sql §8).

export interface LibraryFilters {
  status?: string;
  kind?: string;
  targetVarietyId?: string;
  instructionLanguage?: string;
  speakerId?: string;
  collectionId?: string;
  q?: string;
  page: number;
  derived?: 'original' | 'derived' | 'all';
}

export interface LibraryAssetRow {
  id: string;
  kind: string;
  storage_key: string;
  legacy_filename: string | null;
  legacy_path: string | null;
  mime_type: string;
  byte_length: number;
  duration_ms: number | null;
  checksum_sha256: string;
  state: string;
  visibility: string;
  disposition: string;
  source_asset_id: string | null;
  derivation: string | null;
  content_rights_id: string | null;
  created_at: string;
  updated_at: string;
  rights: { verified: boolean; license_id: string } | null;
  lessonLinks: Array<{ asset_type: string; lesson: { id: string; title_translations: unknown; chapter_id: string; target_variety_id: string | null; instruction_language_code: string | null; transcript_status: string; chapter: { collection_id: string } | null } | null }>;
}

const ASSET_COLUMNS =
  'id, kind, storage_key, legacy_filename, legacy_path, mime_type, byte_length, duration_ms, checksum_sha256, state, visibility, disposition, source_asset_id, derivation, content_rights_id, created_at, updated_at, rights:content_rights!content_rights_id(verified, license_id), lessonLinks:audio_lesson_assets(asset_type, lesson:audio_lessons(id, title_translations, chapter_id, target_variety_id, instruction_language_code, transcript_status, chapter:audio_chapters(collection_id)))';

export async function listLibraryAssets(filters: LibraryFilters, pageSize = 50): Promise<QueryResult<{ rows: LibraryAssetRow[]; hasNext: boolean }>> {
  const client = await db();
  const { from, to } = pageRange(filters.page, pageSize);
  let query = client.from('media_assets_staff').select(ASSET_COLUMNS).order('created_at', { ascending: false }).range(from, to + 1);
  if (filters.status) query = query.eq('state', filters.status);
  if (filters.kind) query = query.eq('kind', filters.kind);
  if (filters.derived === 'original') query = query.is('source_asset_id', null);
  if (filters.derived === 'derived') query = query.not('source_asset_id', 'is', null);
  if (filters.q) query = query.or(`legacy_filename.ilike.%${filters.q.replace(/[%,()]/g, '')}%,legacy_path.ilike.%${filters.q.replace(/[%,()]/g, '')}%,checksum_sha256.eq.${filters.q.toLowerCase().replace(/[^a-f0-9]/g, '') || 'x'}`);
  const result = await safe(() => query);
  if (!result.ok) return result;
  let rows = result.data as unknown as LibraryAssetRow[];
  // Lesson-level filters (variety / instruction language / collection / speaker) are applied on the joined lesson.
  const speakerIds = new Set<string>();
  if (filters.speakerId) {
    const links = await client.from('lesson_speakers').select('lesson_id').eq('speaker_id', filters.speakerId).limit(5000);
    for (const l of links.data ?? []) speakerIds.add(l.lesson_id);
  }
  rows = rows.filter((r) => {
    const lessons = r.lessonLinks.map((l) => l.lesson).filter((l): l is NonNullable<typeof l> => Boolean(l));
    if (filters.targetVarietyId && !lessons.some((l) => l.target_variety_id === filters.targetVarietyId)) return false;
    if (filters.instructionLanguage && !lessons.some((l) => l.instruction_language_code === filters.instructionLanguage)) return false;
    if (filters.collectionId && !lessons.some((l) => l.chapter?.collection_id === filters.collectionId)) return false;
    if (filters.speakerId && !lessons.some((l) => speakerIds.has(l.id))) return false;
    return true;
  });
  const hasNext = rows.length > pageSize;
  return { ok: true, data: { rows: rows.slice(0, pageSize), hasNext } };
}

export async function getAsset(id: string) {
  const client = await db();
  return safe(() => client.from('media_assets_staff').select(ASSET_COLUMNS).eq('id', id).maybeSingle());
}

export async function listAssetJobs(assetId: string) {
  const client = await db();
  return safe(() => client.from('processing_jobs').select('id, job_type, state, progress_pct, attempts, max_attempts, failure_code, failure_message, created_at, finished_at').eq('parent_asset_id', assetId).order('created_at', { ascending: false }).limit(20));
}

export interface CollectionOption {
  id: string;
  title_translations: unknown;
  course_track_id: string | null;
}
export interface ChapterOption {
  id: string;
  collection_id: string;
  title_translations: unknown;
  sort_order: number;
}
export interface SpeakerOption {
  id: string;
  display_name: string;
  target_variety_id: string | null;
}
export interface RightsOption {
  id: string;
  license_id: string;
  verified: boolean;
  commercial_redistribution: boolean;
}

/** Reference lists for pickers (collections, chapters, speakers, rights). */
export async function loadPickerOptions() {
  const client = await db();
  const [collections, chapters, speakers, rights] = await Promise.all([
    safe(() => client.from('audio_course_collections').select('id, title_translations, course_track_id').order('sort_order').limit(1000)),
    safe(() => client.from('audio_chapters').select('id, collection_id, title_translations, sort_order').order('sort_order').limit(5000)),
    safe(() => client.from('speakers').select('id, display_name, target_variety_id').order('display_name').limit(1000)),
    safe(() => client.from('content_rights').select('id, license_id, verified, commercial_redistribution').order('created_at', { ascending: false }).limit(1000)),
  ]);
  return {
    collections: (collections.ok ? collections.data : []) as CollectionOption[],
    chapters: (chapters.ok ? chapters.data : []) as ChapterOption[],
    speakers: (speakers.ok ? speakers.data : []) as SpeakerOption[],
    rights: (rights.ok ? rights.data : []) as RightsOption[],
  };
}
