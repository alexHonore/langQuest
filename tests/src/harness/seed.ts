/**
 * Content seeding for stack-bound suites. Everything is written with the SERVICE client (editors would do this
 * through the CMS) and registered for teardown in reverse insertion order, so suites leave the shared local
 * database as they found it. Rows are honest drafts/published fixtures — nothing here claims native review.
 */
import type { ReviewCard, ReviewRating } from '@langquest/contracts';
import { createScheduler, newCard } from '@langquest/curriculum/scheduler/scheduler';
import type { DbClient } from '@langquest/db/client';
import type { Insert, Row, TableName } from '@langquest/db/types';
import { sha256HexSync } from '@langquest/media/hashing';

const slug = (prefix: string): string => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

export const scheduler = createScheduler();

/** Collects inserted rows and deletes them in reverse order. */
export class Seeder {
  private readonly rows: Array<{ table: TableName; id: string }> = [];
  constructor(readonly service: DbClient) {}

  track(table: TableName, id: string): string {
    this.rows.push({ table, id });
    return id;
  }

  async insert<N extends TableName>(table: N, row: Insert<N>): Promise<Row<N>> {
    const res = await this.service.from(table).insert(row as never).select('*').single();
    if (res.error) throw new Error(`seed ${table}: ${res.error.message}`);
    const data = res.data as unknown as Row<N>;
    this.track(table, (data as { id: string }).id);
    return data;
  }

  async cleanup(): Promise<void> {
    for (const { table, id } of [...this.rows].reverse()) {
      const res = await this.service.from(table).delete().eq('id' as never, id as never);
      // A refused delete (typically a RESTRICT FK from a session a suite forgot to purge first) must not leak silently.
      if (res.error) console.warn(`[seed] cleanup of ${table} ${id} failed: ${res.error.message}`);
    }
    this.rows.length = 0;
  }

  // --- curriculum ------------------------------------------------------------------------

  async intent(skillKeys: string[] = ['greet.basic']): Promise<Row<'communicative_intents'>> {
    return this.insert('communicative_intents', { intent_key: slug('tests.intent'), description: 'Test intent', skill_keys: skillKeys });
  }

  async expression(input: { intentId: string; varietyId: string; text: string; forms?: Array<{ script?: string; scheme?: string; text: string }>; translations?: Record<string, string>; state?: Row<'expressions'>['state'] }): Promise<Row<'expressions'>> {
    const expr = await this.insert('expressions', { intent_id: input.intentId, target_variety_id: input.varietyId, canonical_text: input.text, state: input.state ?? 'published', reviewed: false, origin: 'in_code_vector' });
    for (const f of input.forms ?? []) {
      await this.insert('expression_forms', { expression_id: expr.id, script: (f.script ?? null) as never, transliteration_scheme: (f.scheme ?? null) as never, text: f.text });
    }
    for (const [code, meaning] of Object.entries(input.translations ?? {})) {
      await this.insert('expression_translations', { expression_id: expr.id, source_language_code: code, natural_meaning: meaning, qa_state: 'needs_review' });
    }
    return expr;
  }

  async course(input: { trackId: string; state?: Row<'lesson_courses'>['state']; titles?: Record<string, string>; rightsId?: string | null }): Promise<Row<'lesson_courses'>> {
    return this.insert('lesson_courses', { course_track_id: input.trackId, state: input.state ?? 'published', title_translations: input.titles ?? { en: 'Test course' }, content_rights_id: input.rightsId ?? null, sort_order: 999 });
  }

  async chapter(input: { courseId: string; state?: Row<'chapters'>['state']; titles?: Record<string, string>; sortIndex?: number }): Promise<Row<'chapters'>> {
    return this.insert('chapters', { lesson_course_id: input.courseId, state: input.state ?? 'published', title_translations: input.titles ?? { en: 'Chapter 1' }, sort_index: input.sortIndex ?? 0 });
  }

  async mission(input: { chapterId?: string | null; templateKey?: string; varietyId: string; state?: Row<'missions'>['state']; titles?: Record<string, string>; goals?: Array<{ id: string; skill_keys: string[] }>; sortOrder?: number; prerequisiteSkillKeys?: string[] }): Promise<Row<'missions'>> {
    return this.insert('missions', {
      chapter_id: input.chapterId ?? null,
      template_key: input.chapterId ? null : (input.templateKey ?? slug('tests.mission')),
      target_variety_id: input.varietyId,
      state: input.state ?? 'published',
      title_translations: input.titles ?? { en: 'Test mission' },
      goals: (input.goals ?? [{ id: 'g1', skill_keys: ['greet.basic'] }]) as never,
      sort_order: input.sortOrder ?? 0,
      prerequisite_skill_keys: input.prerequisiteSkillKeys ?? [],
    });
  }

  /**
   * Insert one published step per type (sort order = index). `hintScaffold` goes on every step's language-neutral
   * `hint_scaffold` column so suites can prove it never leaks into a source-language overlay.
   */
  async steps(missionId: string, types: Array<Row<'mission_steps'>['step_type']>, expressionIds: string[] = [], options: { hintScaffold?: string[] } = {}): Promise<Row<'mission_steps'>[]> {
    const out: Row<'mission_steps'>[] = [];
    for (const [i, step_type] of types.entries()) {
      out.push(await this.insert('mission_steps', { mission_id: missionId, sort_order: i, step_type, estimated_seconds: 60, target_expression_ids: expressionIds, hint_scaffold: options.hintScaffold ?? [], offline_capable: step_type !== 'character_conversation' }));
    }
    return out;
  }

  /** Source-language overlay for one mission: title, instructions and graded hints (§2.1 `mission_localizations`). */
  async localization(missionId: string, code: string, input: { title: string; instructions?: string; hints?: string[]; qaState?: Row<'mission_localizations'>['qa_state'] }): Promise<Row<'mission_localizations'>> {
    return this.insert('mission_localizations', { mission_id: missionId, source_language_code: code, title: input.title, instructions: input.instructions ?? `Instructions (${code})`, hints: input.hints ?? [], qa_state: input.qaState ?? 'machine_draft' });
  }

  async character(varietyId: string, state: Row<'characters'>['state'] = 'published'): Promise<Row<'characters'>> {
    return this.insert('characters', { character_key: slug('tests.char'), name: 'Nadia', role: 'café staff', personality: 'warm, patient', home_region: 'Casablanca', target_variety_id: varietyId, state, voice_profile: { synthetic: true } });
  }

  // --- audio library ---------------------------------------------------------------------

  async rights(input: { verified: boolean; commercialRedistribution: boolean; licenseId?: string; revokedAt?: string | null; attributionText?: string | null }): Promise<Row<'content_rights'>> {
    return this.insert('content_rights', { permission_grant: input.verified ? 'written permission on file' : 'unclear — forwarded email only', license_id: input.licenseId ?? 'proprietary', verified: input.verified, commercial_redistribution: input.commercialRedistribution, attribution_required: true, attribution_text: input.attributionText ?? 'Test narrator', revoked_at: input.revokedAt ?? null });
  }

  async mediaAsset(input: { rightsId?: string | null; state?: Row<'media_assets'>['state']; visibility?: Row<'media_assets'>['visibility']; disposition?: string; ownerId?: string | null; durationMs?: number }): Promise<Row<'media_assets'>> {
    const id = crypto.randomUUID();
    const checksum = sha256HexSync(`asset:${id}`);
    return this.insert('media_assets', {
      id,
      storage_key: `media/${id}/${checksum}.mp3`,
      bucket: 'langquest-media',
      owner_id: input.ownerId ?? null,
      kind: 'audio',
      checksum_sha256: checksum,
      mime_type: 'audio/mpeg',
      byte_length: 1_234_567,
      duration_ms: input.durationMs ?? 45 * 60 * 1000,
      visibility: input.visibility ?? 'authenticated',
      content_rights_id: input.rightsId ?? null,
      disposition: input.disposition ?? 'active',
      state: input.state ?? 'published',
      etag: `"${checksum.slice(0, 16)}"`,
    });
  }

  async audioCollection(input: { trackId?: string | null; varietyId?: string | null; instructionLanguage?: string | null; rightsId?: string | null; state?: Row<'audio_course_collections'>['state']; titles?: Record<string, string> }): Promise<Row<'audio_course_collections'>> {
    return this.insert('audio_course_collections', { title_translations: input.titles ?? { en: 'Test collection', fr: 'Collection de test' }, course_track_id: input.trackId ?? null, target_variety_id: input.varietyId ?? null, instruction_language_code: input.instructionLanguage ?? null, content_rights_id: input.rightsId ?? null, state: input.state ?? 'published', published_version: input.state === 'published' || input.state === undefined ? 1 : null });
  }

  async audioChapter(collectionId: string, state: Row<'audio_chapters'>['state'] = 'published'): Promise<Row<'audio_chapters'>> {
    return this.insert('audio_chapters', { collection_id: collectionId, title_translations: { en: 'Chapter 1' }, state });
  }

  async audioLesson(input: { chapterId: string; state?: Row<'audio_lessons'>['state']; visibility?: 'private' | 'authenticated'; rightsId?: string | null; varietyId?: string | null; instructionLanguage?: string | null; titles?: Record<string, string>; listenLengthMs?: number }): Promise<Row<'audio_lessons'>> {
    return this.insert('audio_lessons', { chapter_id: input.chapterId, title_translations: input.titles ?? { en: 'Lesson 1' }, state: input.state ?? 'published', visibility: input.visibility ?? 'authenticated', content_rights_id: input.rightsId ?? null, target_variety_id: input.varietyId ?? null, instruction_language_code: input.instructionLanguage ?? null, listen_length_ms: input.listenLengthMs ?? 45 * 60 * 1000, published_revision: (input.state ?? 'published') === 'published' ? 1 : null });
  }

  async linkLessonAsset(lessonId: string, assetId: string, assetType: Row<'audio_lesson_assets'>['asset_type'] = 'mobile_encoded'): Promise<Row<'audio_lesson_assets'>> {
    return this.insert('audio_lesson_assets', { lesson_id: lessonId, asset_id: assetId, asset_type: assetType });
  }

  // --- learner state ---------------------------------------------------------------------

  /** A review card scheduled by the real scheduler (one `good` review), then forced due at `dueAt`. */
  async reviewCard(input: { userId: string; enrollmentId: string; expressionId?: string | null; skillKey?: string | null; dueAt: string; rating?: ReviewRating; recentScenarioIds?: string[] }): Promise<Row<'user_expression_reviews'>> {
    const id = crypto.randomUUID();
    const reviewedAt = new Date(Date.parse(input.dueAt) - 3 * 86_400_000).toISOString();
    const card: ReviewCard = newCard({ id, enrollmentId: input.enrollmentId, targetKind: input.expressionId ? 'expression' : 'skill', targetId: input.expressionId ?? input.skillKey ?? 'greet.basic', now: reviewedAt });
    const reviewed = scheduler.review(card, input.rating ?? 'good', { now: reviewedAt, hintsUsed: 0 });
    const c = reviewed.card;
    return this.insert('user_expression_reviews', {
      id,
      user_id: input.userId,
      enrollment_id: input.enrollmentId,
      expression_id: input.expressionId ?? null,
      skill_key: input.expressionId ? null : (input.skillKey ?? 'greet.basic'),
      card_state: c.state,
      stability: c.memory.stability,
      difficulty: c.memory.difficulty,
      retrievability: c.memory.retrievability,
      reps: c.reps,
      lapses: c.lapses,
      scheduled_days: c.scheduledDays,
      elapsed_days: c.elapsedDays,
      last_rating: input.rating ?? 'good',
      last_hint_count: 0,
      last_reviewed_at: c.lastReviewedAt,
      next_due_at: input.dueAt,
      recent_scenario_ids: input.recentScenarioIds ?? c.recentScenarioIds,
      scheduler_version: scheduler.version,
    });
  }

  /** A finished conversation session with evaluator output as the engine would have stored it. */
  async conversationSession(input: { userId: string; enrollmentId: string; characterId: string; varietyId: string; sourceLanguageCode: string; missionId?: string | null; rubricOutcomes?: unknown; state?: Row<'conversation_sessions'>['state'] }): Promise<Row<'conversation_sessions'>> {
    return this.insert('conversation_sessions', { user_id: input.userId, enrollment_id: input.enrollmentId, character_id: input.characterId, target_variety_id: input.varietyId, source_language_code: input.sourceLanguageCode, mission_id: input.missionId ?? null, mode: 'text_only', pipeline: 'text_only', state: input.state ?? 'finished', rubric_outcomes: (input.rubricOutcomes ?? null) as never, ended_at: new Date().toISOString() });
  }
}
