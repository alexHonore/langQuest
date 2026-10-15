import { describe, expect, it } from 'vitest';
import { CONVERSATION_PIPELINE_VALUES, ConversationModeSchema, ConversationPipelineSchema, INTENT_POLARITY_VALUES, INTENT_POLITENESS_VALUES, IntentPolaritySchema, IntentPolitenessSchema } from '../enums';
import { APPEND_ONLY_TABLES, DB_TABLES, TABLE_NAMES, USER_OWNED_TABLES, UserCourseEnrollmentsTable, XpLedgerTable, ProfilesTable, VisualAssetsTable } from './index';

const uuid = '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d';
const at = '2026-10-14T10:00:00.000Z';

describe('DB_TABLES', () => {
  it('contains every table from §5.1–5.4 and §10.2C', () => {
    const required = [
      'profiles', 'account_settings', 'languages', 'language_varieties', 'writing_systems', 'course_tracks', 'user_course_enrollments', 'course_source_localizations',
      'skills', 'skill_variants', 'communicative_intents', 'expressions', 'expression_forms', 'expression_translations', 'expression_audio', 'lesson_courses', 'chapters', 'missions',
      'mission_localizations', 'mission_steps', 'mission_graph_edges', 'dialogue_scenarios', 'dialogue_variants', 'characters', 'story_arcs', 'media_assets', 'content_rights',
      'content_revisions', 'publication_events', 'audio_course_collections', 'audio_chapters', 'audio_lessons', 'audio_lesson_assets', 'speakers', 'lesson_speakers', 'transcripts',
      'transcript_segments', 'transcript_translations', 'transcript_word_alignments', 'lesson_tags', 'lesson_topics', 'bookmarks', 'user_audio_progress', 'user_download_manifests',
      'uploads', 'processing_jobs', 'asset_provenance_events', 'ai_model_profiles', 'ai_model_benchmarks', 'ai_requests', 'conversation_sessions', 'conversation_turns',
      'character_relationship_memory', 'user_skill_mastery', 'user_expression_reviews', 'learning_observations', 'mission_attempts', 'mission_progress', 'user_achievements',
      'streak_activity', 'xp_ledger', 'daily_learning_metrics', 'device_sync_events', 'notification_settings', 'notification_deliveries', 'feedback_reports', 'moderation_incidents',
      'audit_logs', 'visual_assets', 'mascot_animations', 'character_visual_variants', 'mission_visual_bindings', 'audio_cover_art',
    ];
    for (const name of required) expect(TABLE_NAMES, name).toContain(name);
  });

  it('every table name equals its key and columns are snake_case', () => {
    for (const [key, table] of Object.entries(DB_TABLES)) {
      expect(table.name).toBe(key);
      for (const column of Object.keys(table.row.shape)) expect(column, `${key}.${column}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('user-owned and append-only lists reference real tables', () => {
    for (const name of [...USER_OWNED_TABLES, ...APPEND_ONLY_TABLES]) expect(TABLE_NAMES).toContain(name);
    for (const name of USER_OWNED_TABLES) expect(Object.keys(DB_TABLES[name].row.shape), name).toContain('user_id');
  });

  it('insert schemas make id/created_at/updated_at optional', () => {
    const insert = UserCourseEnrollmentsTable.insert.safeParse({
      user_id: uuid,
      course_track_id: 'arabic-moroccan',
      source_language_code: 'fr',
      preferred_target_variant_id: null,
      regional_preference: 'Casablanca',
      script_mode: 'both',
      learner_level: 'beginner',
      added_at: at,
      last_opened_at: null,
      status: 'active',
      active_mission_id: null,
      preferred_learning_speed: 'regular',
      translation_peek_language_code: null,
    });
    expect(insert.success).toBe(true);
  });

  it('enrollment rows reject a missing source_language_code', () => {
    const result = UserCourseEnrollmentsTable.row.safeParse({ id: uuid, created_at: at, updated_at: at, user_id: uuid, course_track_id: 'french', script_mode: 'native', learner_level: 'beginner', added_at: at, last_opened_at: null, status: 'active', active_mission_id: null, preferred_learning_speed: 'regular', preferred_target_variant_id: null, regional_preference: null, translation_peek_language_code: null });
    expect(result.success).toBe(false);
  });

  it('ledgers have no updated_at and carry idempotency keys', () => {
    expect(XpLedgerTable.kind).toBe('ledger');
    expect(Object.keys(XpLedgerTable.row.shape)).not.toContain('updated_at');
    expect(Object.keys(XpLedgerTable.row.shape)).toContain('idempotency_key');
    expect(Object.keys(DB_TABLES.device_sync_events.row.shape)).toContain('client_event_id');
  });

  it('profiles are keyed by user_id and visual_assets match §10.2C', () => {
    expect(ProfilesTable.kind).toBe('keyed');
    expect(Object.keys(ProfilesTable.row.shape)).not.toContain('id');
    const cols = Object.keys(VisualAssetsTable.row.shape);
    for (const c of ['storage_key', 'type', 'style_version', 'content_hash', 'license_id', 'alt_text_key', 'focal_point', 'dimensions', 'locale_neutral', 'review_status', 'created_at']) expect(cols).toContain(c);
  });
});

describe('contract ranges mirror SQL CHECK constraints', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const at = '2026-01-01T00:00:00.000Z';

  it('xp_ledger.amount is 1..1000 (award_xp)', () => {
    const base = { user_id: uuid, enrollment_id: null, reason: 'mission_completed', reference_table: null, reference_id: null, idempotency_key: uuid, occurred_at: at };
    expect(DB_TABLES.xp_ledger.insert.safeParse({ ...base, amount: 50 }).success).toBe(true);
    expect(DB_TABLES.xp_ledger.insert.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(DB_TABLES.xp_ledger.insert.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(DB_TABLES.xp_ledger.insert.safeParse({ ...base, amount: 1001 }).success).toBe(false);
  });

  it('processing_jobs.max_attempts >= 1 and uploads.part_size_bytes > 0', () => {
    expect(DB_TABLES.processing_jobs.row.shape.max_attempts.safeParse(0).success).toBe(false);
    expect(DB_TABLES.processing_jobs.row.shape.max_attempts.safeParse(1).success).toBe(true);
    expect(DB_TABLES.uploads.row.shape.part_size_bytes.safeParse(0).success).toBe(false);
    expect(DB_TABLES.uploads.row.shape.part_size_bytes.safeParse(5 * 1024 * 1024).success).toBe(true);
  });

  it('enum columns reuse the named contracts enums', () => {
    expect(DB_TABLES.communicative_intents.row.shape.polarity).toBe(IntentPolaritySchema);
    expect(DB_TABLES.communicative_intents.row.shape.politeness).toBe(IntentPolitenessSchema);
    expect(DB_TABLES.conversation_sessions.row.shape.pipeline).toBe(ConversationPipelineSchema);
    expect(DB_TABLES.account_settings.row.shape.conversation_mode).toBe(ConversationModeSchema);
    expect(CONVERSATION_PIPELINE_VALUES).toEqual(['duplex', 'stt_llm_tts', 'text_only']);
    expect(INTENT_POLARITY_VALUES).toEqual(['positive', 'negative', 'neutral']);
    expect(INTENT_POLITENESS_VALUES).toEqual(['any', 'polite', 'casual']);
  });
});
