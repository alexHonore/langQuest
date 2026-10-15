import 'server-only';
import { db, safe } from './index';

export const JOB_COLUMNS = 'id, job_type, parent_asset_id, parent_entity_table, parent_entity_id, state, priority, attempts, max_attempts, progress_pct, provider, params, cost_estimate_usd, cost_actual_usd, failure_code, failure_message, output_asset_ids, output, idempotency_key, requested_by, started_at, finished_at, locked_by, locked_until, created_at, updated_at';

export async function listJobs(page: number, filters: { state?: string; type?: string; assetId?: string }, pageSize = 50) {
  const client = await db();
  const from = (page - 1) * pageSize;
  let query = client.from('processing_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).range(from, from + pageSize);
  if (filters.state) query = query.eq('state', filters.state);
  if (filters.type) query = query.eq('job_type', filters.type);
  if (filters.assetId) query = query.eq('parent_asset_id', filters.assetId);
  const result = await safe(() => query);
  if (!result.ok) return result;
  return { ok: true as const, data: { rows: result.data.slice(0, pageSize), hasNext: result.data.length > pageSize } };
}

export async function listModelProfiles() {
  const client = await db();
  const [profiles, benchmarks] = await Promise.all([
    safe(() => client.from('ai_model_profiles').select('id, task, target_variety_id, source_language_code, provider, primary_model, fallback_models, params, capabilities, latency_class, daily_budget_usd, enabled, version, benchmark_status, updated_by, updated_at').order('task').order('target_variety_id', { nullsFirst: true }).limit(2000)),
    safe(() =>
      client
        .from('ai_model_benchmarks')
        .select('id, profile_id, model, target_variety_id, source_language_code, sample_set_id, evaluator_version, naturalness, intelligibility, dialect_adherence, false_correction_rate, wer, latency_p50_ms, latency_p95_ms, cost_per_call_usd, passed, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
    ),
  ]);
  return { profiles, benchmarks };
}

export async function listReviewQueue() {
  const client = await db();
  const [lessons, transcripts, translations, visual] = await Promise.all([
    safe(() => client.from('audio_lessons').select('id, title_translations, state, quality_review_status, target_variety_id, instruction_language_code, transcript_status, updated_at').or('state.eq.review_needed,quality_review_status.eq.unreviewed').order('updated_at', { ascending: false }).limit(200)),
    safe(() => client.from('transcripts').select('id, lesson_id, revision, status, qa_state, primary_language_code, updated_at, lesson:audio_lessons(title_translations)').eq('qa_state', 'needs_review').order('updated_at', { ascending: false }).limit(200)),
    safe(() => client.from('transcript_translations').select('id, segment_id, language_code, text, qa_state, updated_at').eq('qa_state', 'needs_review').order('updated_at', { ascending: false }).limit(200)),
    safe(() => client.from('visual_assets').select('id, type, alt_text_key, review_status, origin, mime_type, updated_at').in('review_status', ['review_needed', 'in_review']).order('updated_at', { ascending: false }).limit(200)),
  ]);
  return { lessons, transcripts, translations, visual };
}

export async function listPublishables(table: 'audio_lessons' | 'audio_course_collections', page: number, pageSize = 50) {
  const client = await db();
  const from = (page - 1) * pageSize;
  const columns = table === 'audio_lessons' ? 'id, title_translations, state, published_revision, content_rights_id, updated_at, target_variety_id, instruction_language_code' : 'id, title_translations, state, published_version, content_rights_id, updated_at, course_track_id, instruction_language_code';
  const result = await safe(() => client.from(table).select(columns).order('updated_at', { ascending: false }).range(from, from + pageSize));
  if (!result.ok) return result;
  const rows = result.data as unknown as Array<Record<string, unknown>>;
  return { ok: true as const, data: { rows: rows.slice(0, pageSize), hasNext: rows.length > pageSize } };
}

export async function listRevisions(entityTable: string, entityId: string) {
  const client = await db();
  const [revisions, events] = await Promise.all([
    safe(() => client.from('content_revisions').select('id, revision, diff, snapshot, editor_id, note, created_at').eq('entity_table', entityTable).eq('entity_id', entityId).order('revision', { ascending: false }).limit(100)),
    safe(() => client.from('publication_events').select('id, revision, from_state, to_state, actor_id, reason, rollback_of_event_id, created_at').eq('entity_table', entityTable).eq('entity_id', entityId).order('created_at', { ascending: false }).limit(100)),
  ]);
  return { revisions, events };
}

export async function listRecentPublicationEvents(limit = 50) {
  const client = await db();
  return safe(() => client.from('publication_events').select('id, entity_table, entity_id, revision, from_state, to_state, actor_id, reason, created_at').order('created_at', { ascending: false }).limit(limit));
}

export async function listUserRoles() {
  const client = await db();
  return safe(() => client.from('user_roles').select('id, user_id, role, granted_by, expires_at, created_at').order('created_at', { ascending: false }).limit(1000));
}

export async function listAuditLogs(page: number, filters: { action?: string; entityTable?: string }, pageSize = 50) {
  const client = await db();
  const from = (page - 1) * pageSize;
  let query = client.from('audit_logs').select('id, actor_id, actor_role, action, entity_table, entity_id, before, after, request_id, created_at').order('created_at', { ascending: false }).range(from, from + pageSize);
  if (filters.action) query = query.ilike('action', `%${filters.action.replace(/[%,()]/g, '')}%`);
  if (filters.entityTable) query = query.eq('entity_table', filters.entityTable);
  const result = await safe(() => query);
  if (!result.ok) return result;
  return { ok: true as const, data: { rows: result.data.slice(0, pageSize), hasNext: result.data.length > pageSize } };
}

/** Content-factory drafts: AI-generated missions/expressions awaiting review (§9.8). */
export async function listContentDrafts() {
  const client = await db();
  const [missions, expressions, jobs] = await Promise.all([
    safe(() =>
      client
        .from('missions')
        .select('id, title_translations, mission_type, target_variety_id, level, state, sort_order, chapter_id, template_key, goals, narrative_segment, created_at, updated_at, localizations:mission_localizations(source_language_code, title, instructions, hints, qa_state)')
        .in('state', ['imported_draft', 'review_needed', 'approved', 'rejected'])
        .order('updated_at', { ascending: false })
        .limit(200),
    ),
    safe(() => client.from('expressions').select('id, intent_id, target_variety_id, canonical_text, register, difficulty, reviewed, origin, state, scenario_tags, created_at, forms:expression_forms(script, text, transliteration_scheme), translations:expression_translations(source_language_code, natural_meaning, context_note, qa_state)').eq('origin', 'ai_generated').in('state', ['review_needed', 'approved', 'rejected']).order('created_at', { ascending: false }).limit(500)),
    safe(() => client.from('processing_jobs').select('id, state, progress_pct, params, output, failure_message, created_at, finished_at').eq('job_type', 'content_generate').order('created_at', { ascending: false }).limit(50)),
  ]);
  return { missions, expressions, jobs };
}
