import { describe, expect, it } from 'vitest';
import { PronunciationAssessmentSchema, SpeechEvaluationResultSchema, referenceComparisonAssessment } from '../ai/io';
import { API_ERROR_HTTP_STATUS, ApiProblem, ROUTES, apiEnvelope, buildPath, err, isOk, ok } from './common';
import { EnrollmentCreateRequestSchema, EnrollmentPatchRequestSchema, ProgressSyncRequestSchema } from './learner';
import { PronunciationAssessRequestSchema, SynthesizeRequestSchema } from './speech';
import { UploadInitiateRequestSchema, BulkLabelRequestSchema } from './admin';

const uuid = '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d';
const sha = 'a'.repeat(64);

describe('enrollment schemas', () => {
  it('accepts the §6.5 example', () => {
    const parsed = EnrollmentCreateRequestSchema.parse({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', scriptMode: 'both' });
    expect(parsed.sourceLanguageCode).toBe('fr');
  });

  it('rejects a missing sourceLanguageCode (profile default never substitutes)', () => {
    const result = EnrollmentCreateRequestSchema.safeParse({ courseTrackId: 'arabic-moroccan' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'sourceLanguageCode')).toBe(true);
  });

  it('rejects unknown tracks and unknown keys', () => {
    expect(EnrollmentCreateRequestSchema.safeParse({ courseTrackId: 'klingon', sourceLanguageCode: 'en' }).success).toBe(false);
    expect(EnrollmentCreateRequestSchema.safeParse({ courseTrackId: 'french', sourceLanguageCode: 'en', premium: true }).success).toBe(false);
  });

  it('patch requires at least one field and allows a source-language change', () => {
    expect(EnrollmentPatchRequestSchema.safeParse({}).success).toBe(false);
    expect(EnrollmentPatchRequestSchema.safeParse({ sourceLanguageCode: 'fr' }).success).toBe(true);
  });
});

describe('pronunciation result refinement (§6.5)', () => {
  const acoustic = {
    assessmentMode: 'acoustic-assessor',
    numericScore: 82,
    confidence: 'high',
    feedback: ['Good rhythm.'],
    featuresAssessed: ['word'],
    wordScores: [{ word: 'salam', startMs: 0, endMs: 400, accuracy: 90, errorType: 'none' }],
    phonemeHints: [],
    toneHints: [],
    highlightedSegment: null,
    provider: 'azure_speech',
    scorerVersion: 'pa-2026-01',
  };

  it('accepts a numeric score from an acoustic assessor', () => {
    expect(PronunciationAssessmentSchema.safeParse(acoustic).success).toBe(true);
  });

  it('rejects numericScore with reference-comparison mode', () => {
    const result = PronunciationAssessmentSchema.safeParse({ ...acoustic, assessmentMode: 'reference-comparison' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'numericScore')).toBe(true);
  });

  it('rejects numericScore with human-calibrated-reference-comparison and semantic-only modes', () => {
    for (const mode of ['human-calibrated-reference-comparison', 'semantic-only', 'unavailable']) {
      expect(PronunciationAssessmentSchema.safeParse({ ...acoustic, assessmentMode: mode, wordScores: [] }).success).toBe(false);
    }
  });

  it('rejects word accuracy values without an acoustic assessor', () => {
    expect(PronunciationAssessmentSchema.safeParse({ ...acoustic, assessmentMode: 'reference-comparison', numericScore: null }).success).toBe(false);
  });

  it('accepts the spec example with numericScore null', () => {
    const example = {
      assessmentId: uuid,
      targetVarietyId: 'ary',
      semanticIntentMatched: true,
      meaningConfidence: 0.88,
      intelligibility: 'understood',
      pronunciation: referenceComparisonAssessment(["The meaning came across. Listen to the model's rhythm and retry."], true),
      shouldAdvanceConversation: true,
      transcript: null,
      matchedIntentIds: ['request_drink'],
    };
    const parsed = SpeechEvaluationResultSchema.parse(example);
    expect(parsed.pronunciation.assessmentMode).toBe('human-calibrated-reference-comparison');
    expect(parsed.pronunciation.numericScore).toBeNull();
    expect(parsed.pronunciation.confidence).toBe('limited');
  });

  it('pronunciation-assess request needs an expression or reference text', () => {
    const audio = { source: 'asset', assetId: uuid, encoding: 'opus', sampleRateHz: null };
    expect(PronunciationAssessRequestSchema.safeParse({ enrollmentId: uuid, targetVarietyId: 'ary', audio, clientRequestId: uuid }).success).toBe(false);
    expect(PronunciationAssessRequestSchema.safeParse({ enrollmentId: uuid, targetVarietyId: 'ary', audio, clientRequestId: uuid, expressionId: uuid }).success).toBe(true);
    expect(SynthesizeRequestSchema.safeParse({ enrollmentId: uuid, targetVarietyId: 'ary' }).success).toBe(false);
  });
});

describe('envelope helpers', () => {
  it('ok/err produce the CONVENTIONS §3 envelope', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(err('not_found', 'Missing')).toEqual({ ok: false, error: { code: 'not_found', message: 'Missing' } });
    expect(err('validation_failed', 'Bad', { field: 'x' }, 'trace-1')).toEqual({ ok: false, error: { code: 'validation_failed', message: 'Bad', details: { field: 'x' }, traceId: 'trace-1' } });
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('internal', 'x'))).toBe(false);
  });

  it('apiEnvelope validates both branches', () => {
    const schema = apiEnvelope(EnrollmentCreateRequestSchema);
    expect(schema.safeParse(ok({ courseTrackId: 'french', sourceLanguageCode: 'en' })).success).toBe(true);
    expect(schema.safeParse(err('forbidden', 'no')).success).toBe(true);
    expect(schema.safeParse({ ok: true, data: { courseTrackId: 'french' } }).success).toBe(false);
    expect(schema.safeParse({ ok: false, error: { code: 'premium_required', message: 'x' } }).success).toBe(false);
  });

  it('ApiProblem maps to HTTP status', () => {
    const p = new ApiProblem('rights_blocked', 'Rights not verified');
    expect(p.status).toBe(451);
    expect(p.toFailure('t').error).toEqual({ code: 'rights_blocked', message: 'Rights not verified', traceId: 't' });
    expect(API_ERROR_HTTP_STATUS.unauthorized).toBe(401);
    expect(API_ERROR_HTTP_STATUS.capability_unsupported).toBe(501);
  });
});

describe('routes', () => {
  it('every route is under /v1 and admin routes are marked admin', () => {
    for (const [key, def] of Object.entries(ROUTES)) {
      expect(def.path.startsWith('/v1/'), key).toBe(true);
      if (def.path.startsWith('/v1/admin/')) expect(def.auth, key).toBe('admin');
    }
    expect(Object.keys(ROUTES).length).toBeGreaterThanOrEqual(53);
  });

  it('buildPath substitutes params and query', () => {
    expect(buildPath('enrollmentPatch', { id: 'abc' })).toBe('/v1/me/enrollments/abc');
    expect(buildPath('courseCoverage', { trackId: 'arabic-moroccan' }, { source: 'fr' })).toBe('/v1/courses/arabic-moroccan/coverage?source=fr');
    expect(buildPath('me')).toBe('/v1/me');
    expect(() => buildPath('missionDetail', { id: '' })).toThrow(/Missing route param/);
  });
});

describe('progress sync', () => {
  it('requires client event ids, device id and revisions', () => {
    const valid = {
      deviceId: 'device-1',
      clientSentAt: '2026-10-14T10:00:00.000Z',
      events: [
        { clientEventId: uuid, enrollmentId: uuid, deviceId: 'device-1', revision: 3, occurredAt: '2026-10-14T09:59:00.000Z', payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: uuid, amount: 20 } },
      ],
    };
    expect(ProgressSyncRequestSchema.safeParse(valid).success).toBe(true);
    expect(ProgressSyncRequestSchema.safeParse({ ...valid, events: [] }).success).toBe(false);
    const { clientEventId: _c, ...noId } = valid.events[0]!;
    expect(ProgressSyncRequestSchema.safeParse({ ...valid, events: [noId] }).success).toBe(false);
  });
});

describe('admin schemas', () => {
  it('upload initiate validates checksum and mime', () => {
    const req = { filename: 'lesson01.mp3', contentType: 'audio/mpeg', byteLength: 1024, clientChecksumSha256: sha, idempotencyKey: 'upload-lesson01-1' };
    expect(UploadInitiateRequestSchema.safeParse(req).success).toBe(true);
    expect(UploadInitiateRequestSchema.safeParse({ ...req, contentType: 'application/x-msdownload' }).success).toBe(false);
    expect(UploadInitiateRequestSchema.safeParse({ ...req, clientChecksumSha256: 'xyz' }).success).toBe(false);
  });

  it('bulk label requires a selection and a non-empty patch', () => {
    expect(BulkLabelRequestSchema.safeParse({ patch: { topic: 'cafe' }, idempotencyKey: 'bulk-0001' }).success).toBe(false);
    expect(BulkLabelRequestSchema.safeParse({ assetIds: [uuid], patch: {}, idempotencyKey: 'bulk-0001' }).success).toBe(false);
    expect(BulkLabelRequestSchema.safeParse({ assetIds: [uuid], patch: { topic: 'cafe', instructionLanguage: 'fr' }, idempotencyKey: 'bulk-0001' }).success).toBe(true);
  });
});
