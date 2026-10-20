import { describe, expect, it } from 'vitest';
import type { ContentState } from '../enums';
import { PROCESSING_JOB_TYPE_EXTENSION_VALUES, PROCESSING_JOB_TYPE_VALUES } from '../enums';
import {
  ContentRollbackRequestSchema,
  CoverageUpdateRequestSchema,
  ModelTestRequestSchema,
  ROLLBACK_ENTITY_TABLES,
  ROLLBACK_RESTORABLE_COLUMNS,
  RUNNER_EXTENSION_HANDLER_BY_TYPE,
  RUNNER_JOB_TYPE_HANDLERS,
  TranscriptSaveRequestSchema,
  UserRoleGrantRequestSchema,
  coverageUpdateViolation,
  planDecision,
  planJobRetry,
  rollbackPatch,
  runnerHandlerFor,
  transcriptCoverageOf,
  transcriptSaveViolation,
  type RetryableJob,
} from './admin-studio';
import { ROUTES } from './common';

const metrics = (v: number) => ({ mission_instructions_pct: v, explanations_pct: v, ui_pct: v, subtitles_pct: v, audio_overlays_pct: v });

describe('Studio routes in ROUTES', () => {
  it('are admin routes under /v1/admin', () => {
    for (const key of ['adminCoveragePut', 'adminTranscriptSave', 'adminContentDecision', 'adminContentRollback', 'adminProcessingJobRetry', 'adminUserRoleGrant', 'adminUserRoleRevoke', 'adminModelTest'] as const) {
      expect(ROUTES[key].auth, key).toBe('admin');
      expect(ROUTES[key].path.startsWith('/v1/admin/'), key).toBe(true);
    }
  });
});

describe('coverage honesty rules', () => {
  const base = { sourceLanguageCode: 'en', metrics: metrics(100), nativeReviewed: true, fallbackSourceLanguageCode: null };
  it('complete needs a native review and every metric at 100', () => {
    expect(coverageUpdateViolation({ ...base, status: 'complete' })).toBeNull();
    expect(coverageUpdateViolation({ ...base, status: 'complete', nativeReviewed: false })).toBe('"complete" requires nativeReviewed and every metric at 100%.');
    expect(coverageUpdateViolation({ ...base, status: 'complete', metrics: { ...metrics(100), subtitles_pct: 90 } })).toContain('every metric at 100%');
  });
  it('a complete pair never advertises a fallback, and a fallback differs from the source', () => {
    expect(coverageUpdateViolation({ ...base, status: 'complete', fallbackSourceLanguageCode: 'fr' })).toBe('A complete pair must not advertise a fallback language.');
    expect(coverageUpdateViolation({ ...base, status: 'partial', fallbackSourceLanguageCode: 'en' })).toBe('Fallback must differ from the source language.');
    expect(coverageUpdateViolation({ ...base, status: 'partial', nativeReviewed: false, metrics: metrics(20), fallbackSourceLanguageCode: 'fr' })).toBeNull();
  });
  it('defaults the optional fields and bounds the metrics', () => {
    const parsed = CoverageUpdateRequestSchema.parse({ courseTrackId: 'french', sourceLanguageCode: 'en', status: 'planned', metrics: metrics(0), nativeReviewed: false });
    expect(parsed).toMatchObject({ editorialNoteKey: null, fallbackSourceLanguageCode: null });
    expect(CoverageUpdateRequestSchema.safeParse({ ...parsed, metrics: metrics(101) }).success).toBe(false);
  });
});

describe('transcript saves', () => {
  it('fills segment defaults and caps the segment count', () => {
    const parsed = TranscriptSaveRequestSchema.parse({ primaryLanguageCode: 'es', segments: [{ sortIndex: 0, startMs: 0, endMs: 10, text: 'hola' }] });
    expect(parsed).toMatchObject({ languageMode: 'mixed', status: 'edited', qaState: 'needs_review', accessRights: 'internal_only', durationMs: null });
    expect(parsed.segments[0]).toMatchObject({ speakerLabel: null, speakerId: null, reviewed: false, translations: [] });
    expect(TranscriptSaveRequestSchema.safeParse({ primaryLanguageCode: 'es', status: 'machine', segments: [] }).success).toBe(false);
  });
  it('flags reversed segments, repeated sort indexes and repeated translation languages', () => {
    const seg = (sortIndex: number, startMs: number, endMs: number, languages: string[] = []) => ({ sortIndex, startMs, endMs, translations: languages.map((languageCode) => ({ languageCode })) });
    expect(transcriptSaveViolation([seg(0, 0, 10, ['en', 'fr']), seg(1, 10, 20)])).toBeNull();
    expect(transcriptSaveViolation([seg(3, 20, 10)])).toBe('Segment 3: end before start');
    expect(transcriptSaveViolation([seg(1, 0, 10), seg(1, 10, 20)])).toBe('Segment 1: duplicate sort index');
    expect(transcriptSaveViolation([seg(0, 0, 10, ['en', 'en'])])).toBe('Segment 0: more than one en translation');
  });
  it('computes coverage against the lesson duration (0 when unknown, capped at 100)', () => {
    expect(transcriptCoverageOf([{ startMs: 0, endMs: 500 }, { startMs: 500, endMs: 750 }], 1000)).toBe(75);
    expect(transcriptCoverageOf([{ startMs: 0, endMs: 5000 }], 1000)).toBe(100);
    expect(transcriptCoverageOf([{ startMs: 0, endMs: 500 }], null)).toBe(0);
  });
});

describe('planDecision', () => {
  // Stand-in for `@langquest/media` `canTransitionContent` (contracts has no media dependency).
  const allowed: Partial<Record<ContentState, ContentState[]>> = { review_needed: ['approved', 'rejected'], rejected: ['review_needed'] };
  const canTransition = (from: ContentState, to: ContentState) => (allowed[from] ?? []).includes(to);

  it('approves and rejects content in review', () => {
    expect(planDecision('review_needed', 'approve', canTransition)).toEqual({ ok: true, from: 'review_needed', to: 'approved', noop: false });
    expect(planDecision('review_needed', 'reject', canTransition)).toEqual({ ok: true, from: 'review_needed', to: 'rejected', noop: false });
  });
  it('never touches published content and refuses illegal transitions instead of forcing the state', () => {
    expect(planDecision('published', 'reject', canTransition)).toMatchObject({ ok: false, code: 'precondition_failed', message: 'Unpublish before changing the editorial decision.' });
    const plan = planDecision('imported_draft', 'approve', canTransition);
    expect(plan).toMatchObject({ ok: false, code: 'precondition_failed' });
    if (!plan.ok) expect(plan.message).toContain('cannot move');
  });
  it('treats a repeated decision as a no-op and rejects unknown states', () => {
    expect(planDecision('rejected', 'reject', canTransition)).toEqual({ ok: true, from: 'rejected', to: 'rejected', noop: true });
    expect(planDecision('mystery', 'approve', canTransition)).toMatchObject({ ok: false, code: 'validation_failed' });
  });
});

describe('rollback', () => {
  it('restores only the allowed columns per entity, never state or publish flags', () => {
    expect(rollbackPatch('audio_lessons', { title_translations: { en: 'x' }, state: 'published', published_revision: 4, sort_order: 2 })).toEqual({ title_translations: { en: 'x' }, sort_order: 2 });
    expect(rollbackPatch('characters', { state: 'approved' })).toEqual({});
    // `visual_assets.review_status` is that table's lifecycle state.
    expect(rollbackPatch('visual_assets', { review_status: 'approved', alt_text_key: 'visual.alt.cafe' })).toEqual({ alt_text_key: 'visual.alt.cafe' });
    // Any lifecycle state, native-review flag or publish column, whatever the table calls it.
    const stateBearing = /^(state|review_status|publication_state|reviewed|reviewer_id|reviewed_at|native_reviewed|published|unpublished)$|^(published|unpublished)_/;
    for (const table of ROLLBACK_ENTITY_TABLES) {
      expect(ROLLBACK_RESTORABLE_COLUMNS[table].filter((col) => stateBearing.test(col)), table).toEqual([]);
    }
  });
  it('validates the entity table and revision', () => {
    expect(ContentRollbackRequestSchema.safeParse({ entityTable: 'speakers', revision: 1 }).success).toBe(false);
    expect(ContentRollbackRequestSchema.safeParse({ entityTable: 'audio_chapters', revision: 0 }).success).toBe(true);
  });
});

describe('job retry planning', () => {
  const base: RetryableJob = { id: 'job-1', job_type: 'transcode', state: 'failed', params: { preset: 'mobile' }, parent_asset_id: 'asset-1', parent_entity_table: null, parent_entity_id: null, priority: 5, provider: null, max_attempts: 3, idempotency_key: 'transcode:asset-1:abc', attempts: 3 };

  it('maps every base job type (null for the two the runner does not serve) and every extension type', () => {
    for (const type of PROCESSING_JOB_TYPE_VALUES) expect(type in RUNNER_JOB_TYPE_HANDLERS).toBe(true);
    for (const type of PROCESSING_JOB_TYPE_EXTENSION_VALUES) expect(type in RUNNER_EXTENSION_HANDLER_BY_TYPE).toBe(true);
    expect(runnerHandlerFor({ job_type: 'benchmark_model', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'image_generate', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'transcribe', params: {} })).toBe('transcribe');
  });
  it('honours params.handler for extension handlers riding on a carrier type', () => {
    expect(runnerHandlerFor({ job_type: 'describe', params: { handler: 'regenerate_manifest' } })).toBe('regenerate_manifest');
    expect(runnerHandlerFor({ job_type: 'translate_transcript', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'translate_transcript', params: { handler: 'translate_transcript' } })).toBe('translate_transcript');
  });
  it('refuses pending and running jobs, and job types no runner serves', () => {
    expect(planJobRetry({ ...base, state: 'running' }, undefined)).toMatchObject({ kind: 'refused', code: 'precondition_failed' });
    expect(planJobRetry({ ...base, state: 'pending' }, undefined)).toMatchObject({ kind: 'refused' });
    const plan = planJobRetry({ ...base, job_type: 'benchmark_model', parent_asset_id: null }, undefined);
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.message).toContain('AI models screen');
    expect(planJobRetry({ ...base, job_type: 'translate_transcript', params: {} }, undefined).kind).toBe('refused');
    expect(planJobRetry({ ...base, job_type: 'not_a_type' }, undefined)).toMatchObject({ kind: 'refused', code: 'validation_failed' });
  });
  it('re-runs asset-parented jobs as an asset process with the original params', () => {
    expect(planJobRetry(base, 2)).toEqual({ kind: 'asset_process', assetId: 'asset-1', operation: 'transcode', params: { preset: 'mobile' }, priority: 2 });
  });
  it('re-enqueues other jobs with a unique retry key', () => {
    const plan = planJobRetry({ ...base, job_type: 'import_manifest', parent_asset_id: null, idempotency_key: 'import_manifest:x', attempts: 1, params: null }, undefined, 1000);
    expect(plan).toEqual({ kind: 'enqueue', jobType: 'import_manifest', params: {}, priority: 5, idempotencyKey: `import_manifest:x:retry:2:${(1000).toString(36)}` });
  });
});

describe('role grants and model probes', () => {
  it('grant bodies need a known role and an ISO expiry (or none)', () => {
    expect(UserRoleGrantRequestSchema.parse({ role: 'content_editor' })).toEqual({ role: 'content_editor', expiresAt: null });
    expect(UserRoleGrantRequestSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(UserRoleGrantRequestSchema.safeParse({ role: 'admin', expiresAt: 'tomorrow' }).success).toBe(false);
  });
  it('prompt probes run as a text task for a real variety; speech tasks are not prompt probes', () => {
    expect(ModelTestRequestSchema.parse({ mode: 'prompt', targetVariety: 'ary', model: ' x/y ', prompt: 'salam' })).toMatchObject({ task: 'character_dialogue', sourceLanguage: 'en', model: 'x/y' });
    expect(ModelTestRequestSchema.safeParse({ mode: 'prompt', task: 'speech_recognition', targetVariety: 'ary', model: 'x/y', prompt: 'salam' }).success).toBe(false);
    expect(ModelTestRequestSchema.safeParse({ mode: 'synthesize', targetVariety: 'klingon', text: 'x' }).success).toBe(false);
  });
});
