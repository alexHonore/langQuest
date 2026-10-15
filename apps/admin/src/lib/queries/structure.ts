import 'server-only';
import { db, safe } from './index';

const COLLECTION_COLUMNS = 'id, title_translations, description_translations, course_track_id, target_variety_id, instruction_language_code, region, instructor_speaker_id, cover_visual_asset_id, content_rights_id, state, sort_order, published_version, created_at, updated_at';
const CHAPTER_COLUMNS = 'id, collection_id, title_translations, summary_translations, sort_order, cover_visual_asset_id, state, created_at, updated_at';
const LESSON_COLUMNS =
  'id, chapter_id, title_translations, description_translations, sort_order, episode_number, level, target_variety_id, instruction_language_code, spoken_language_codes, regional_dialect, topic, tags, scene, state, transcript_status, listen_length_ms, quality_review_status, visibility, content_rights_id, cover_visual_asset_id, published_revision, created_at, updated_at';

export async function listCollections() {
  const client = await db();
  return safe(() => client.from('audio_course_collections').select(`${COLLECTION_COLUMNS}, chapters:audio_chapters(id)` as const).order('sort_order').order('created_at').limit(1000));
}

export async function getCollection(id: string) {
  const client = await db();
  const [collection, chapters] = await Promise.all([
    safe(() => client.from('audio_course_collections').select(COLLECTION_COLUMNS).eq('id', id).maybeSingle()),
    safe(() => client.from('audio_chapters').select(`${CHAPTER_COLUMNS}, lessons:audio_lessons(id, state)` as const).eq('collection_id', id).order('sort_order').limit(1000)),
  ]);
  return { collection, chapters };
}

export async function listChapters() {
  const client = await db();
  return safe(() => client.from('audio_chapters').select(`${CHAPTER_COLUMNS}, collection:audio_course_collections(id, title_translations), lessons:audio_lessons(id)` as const).order('sort_order').limit(2000));
}

export async function getChapter(id: string) {
  const client = await db();
  const [chapter, lessons] = await Promise.all([
    safe(() => client.from('audio_chapters').select(`${CHAPTER_COLUMNS}, collection:audio_course_collections(id, title_translations, course_track_id, target_variety_id, instruction_language_code)` as const).eq('id', id).maybeSingle()),
    safe(() => client.from('audio_lessons').select(LESSON_COLUMNS).eq('chapter_id', id).order('sort_order').limit(2000)),
  ]);
  return { chapter, lessons };
}

export async function listLessons(page: number, pageSize = 50, filters: { state?: string; chapterId?: string; q?: string } = {}) {
  const client = await db();
  const from = (page - 1) * pageSize;
  let query = client.from('audio_lessons').select(`${LESSON_COLUMNS}, chapter:audio_chapters(id, title_translations, collection:audio_course_collections(id, title_translations))` as const).order('updated_at', { ascending: false }).range(from, from + pageSize);
  if (filters.state) query = query.eq('state', filters.state);
  if (filters.chapterId) query = query.eq('chapter_id', filters.chapterId);
  if (filters.q) query = query.ilike('title_translations::text', `%${filters.q.replace(/[%,()]/g, '')}%`);
  const result = await safe(() => query);
  if (!result.ok) return result;
  return { ok: true as const, data: { rows: result.data.slice(0, pageSize), hasNext: result.data.length > pageSize } };
}

export async function getLesson(id: string) {
  const client = await db();
  const [lesson, assets, speakers, revisions] = await Promise.all([
    safe(() => client.from('audio_lessons').select(`${LESSON_COLUMNS}, chapter:audio_chapters(id, title_translations, collection_id, collection:audio_course_collections(id, title_translations, course_track_id))` as const).eq('id', id).maybeSingle()),
    safe(() => client.from('audio_lesson_assets').select('id, asset_type, sort_order, asset:media_assets_staff(id, kind, mime_type, byte_length, duration_ms, checksum_sha256, state, legacy_filename, source_asset_id, derivation)').eq('lesson_id', id).order('sort_order')),
    safe(() => client.from('lesson_speakers').select('id, role, speaker:speakers(id, display_name, target_variety_id, consent_state)').eq('lesson_id', id)),
    safe(() => client.from('content_revisions').select('id, revision, note, created_at, editor_id').eq('entity_table', 'audio_lessons').eq('entity_id', id).order('revision', { ascending: false }).limit(20)),
  ]);
  return { lesson, assets, speakers, revisions };
}

/** Lessons list for pickers ("attach to lesson"). */
export async function listLessonOptions(q?: string) {
  const client = await db();
  let query = client.from('audio_lessons').select('id, title_translations, chapter_id, sort_order, chapter:audio_chapters(title_translations, collection:audio_course_collections(title_translations))').order('updated_at', { ascending: false }).limit(200);
  if (q) query = query.ilike('title_translations::text', `%${q.replace(/[%,()]/g, '')}%`);
  return safe(() => query);
}

export async function listSpeakers() {
  const client = await db();
  return safe(() => client.from('speakers').select('id, display_name, pseudonymous, target_variety_id, region, consent_state, content_rights_id, voice_description, synthetic, created_at, updated_at, lessons:lesson_speakers(id)').order('display_name').limit(2000));
}

export async function listRights(page: number, onlyUnverified: boolean, pageSize = 50) {
  const client = await db();
  const from = (page - 1) * pageSize;
  let query = client
    .from('content_rights')
    .select('id, origin_url, authors, speakers, permission_grant, license_id, license_version, commercial_redistribution, attribution_required, attribution_text, alterations_permitted, ai_processing_permitted, voice_rights, expires_at, revoked_at, evidence_asset_id, reviewer_id, reviewed_at, verified, created_at, updated_at, assets:media_assets!content_rights_id(id), lessons:audio_lessons!content_rights_id(id, state), collections:audio_course_collections!content_rights_id(id, state)')
    .order('created_at', { ascending: false })
    .range(from, from + pageSize);
  if (onlyUnverified) query = query.eq('verified', false);
  const result = await safe(() => query);
  if (!result.ok) return result;
  return { ok: true as const, data: { rows: result.data.slice(0, pageSize), hasNext: result.data.length > pageSize } };
}

export async function listCoverage() {
  const client = await db();
  return safe(() => client.from('course_source_localizations_staff').select('id, course_track_id, source_language_code, status, metrics, native_reviewed, reviewer_id, reviewed_at, editorial_note_key, fallback_source_language_code, updated_at').limit(2000));
}
