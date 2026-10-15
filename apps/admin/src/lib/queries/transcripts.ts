import 'server-only';
import { db, safe } from './index';

export async function listTranscriptLessons(page: number, status: string | undefined, pageSize = 50) {
  const client = await db();
  const from = (page - 1) * pageSize;
  let query = client
    .from('audio_lessons')
    .select('id, title_translations, transcript_status, target_variety_id, instruction_language_code, spoken_language_codes, listen_length_ms, state, updated_at, chapter:audio_chapters(title_translations, collection:audio_course_collections(title_translations))')
    .order('updated_at', { ascending: false })
    .range(from, from + pageSize);
  if (status) query = query.eq('transcript_status', status);
  const result = await safe(() => query);
  if (!result.ok) return result;
  return { ok: true as const, data: { rows: result.data.slice(0, pageSize), hasNext: result.data.length > pageSize } };
}

export interface TranscriptBundle {
  lesson: {
    id: string;
    title_translations: unknown;
    transcript_status: string;
    target_variety_id: string | null;
    instruction_language_code: string | null;
    spoken_language_codes: string[];
    listen_length_ms: number | null;
    masterAssetId: string | null;
    masterDurationMs: number | null;
  };
  transcript: { id: string; revision: number; status: string; qa_state: string; primary_language_code: string; language_mode: string; access_rights: string; coverage_pct: number; provider: string | null; model: string | null; manually_uploaded: boolean } | null;
  revisions: Array<{ id: string; revision: number; status: string; created_at: string }>;
  segments: Array<{
    id: string;
    sort_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
    speaker_label: string | null;
    speaker_id: string | null;
    language_code: string | null;
    target_variety_id: string | null;
    confidence: number | null;
    reviewed: boolean;
    translations: Array<{ language_code: string; text: string; qa_state: string }>;
  }>;
  speakers: Array<{ id: string; display_name: string }>;
}

export async function loadTranscript(lessonId: string, revision?: number): Promise<{ ok: true; data: TranscriptBundle } | { ok: false; error: string }> {
  const client = await db();
  const lessonRes = await client
    .from('audio_lessons')
    .select('id, title_translations, transcript_status, target_variety_id, instruction_language_code, spoken_language_codes, listen_length_ms, assets:audio_lesson_assets(asset_type, asset:media_assets(id, duration_ms, kind))')
    .eq('id', lessonId)
    .maybeSingle();
  if (lessonRes.error) return { ok: false, error: lessonRes.error.message };
  if (!lessonRes.data) return { ok: false, error: 'not_found' };
  const master = lessonRes.data.assets.find((a) => a.asset_type === 'master' && a.asset?.kind === 'audio')?.asset ?? lessonRes.data.assets.find((a) => a.asset?.kind === 'audio')?.asset ?? null;
  const revisionsRes = await client.from('transcripts').select('id, revision, status, created_at').eq('lesson_id', lessonId).order('revision', { ascending: false }).limit(50);
  const revisions = revisionsRes.data ?? [];
  const target = revision !== undefined ? revisions.find((r) => r.revision === revision) : revisions[0];
  let transcript: TranscriptBundle['transcript'] = null;
  let segments: TranscriptBundle['segments'] = [];
  if (target) {
    const t = await client.from('transcripts').select('id, revision, status, qa_state, primary_language_code, language_mode, access_rights, coverage_pct, provider, model, manually_uploaded').eq('id', target.id).maybeSingle();
    transcript = t.data ?? null;
    const s = await client
      .from('transcript_segments')
      .select('id, sort_index, start_ms, end_ms, text, speaker_label, speaker_id, language_code, target_variety_id, confidence, reviewed, translations:transcript_translations(language_code, text, qa_state)')
      .eq('transcript_id', target.id)
      .order('sort_index')
      .limit(20000);
    segments = (s.data ?? []) as TranscriptBundle['segments'];
  }
  const speakersRes = await client.from('speakers').select('id, display_name').order('display_name').limit(500);
  return {
    ok: true,
    data: {
      lesson: {
        id: lessonRes.data.id,
        title_translations: lessonRes.data.title_translations,
        transcript_status: lessonRes.data.transcript_status,
        target_variety_id: lessonRes.data.target_variety_id,
        instruction_language_code: lessonRes.data.instruction_language_code,
        spoken_language_codes: lessonRes.data.spoken_language_codes,
        listen_length_ms: lessonRes.data.listen_length_ms,
        masterAssetId: master?.id ?? null,
        masterDurationMs: master?.duration_ms ?? null,
      },
      transcript,
      revisions,
      segments,
      speakers: speakersRes.data ?? [],
    },
  };
}
