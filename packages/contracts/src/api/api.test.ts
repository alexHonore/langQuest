import { describe, expect, it } from 'vitest';
import { PronunciationAssessmentSchema, SpeechEvaluationResultSchema, referenceComparisonAssessment } from '../ai/io';
import { API_ERROR_HTTP_STATUS, ApiProblem, ConfirmQuerySchema, QueryBooleanSchema, ROUTES, apiEnvelope, buildPath, confirmQuery, err, isOk, ok } from './common';
import { EnrollmentCreateRequestSchema, EnrollmentDeleteQuerySchema, EnrollmentDeleteResponseSchema, EnrollmentPatchQuerySchema, EnrollmentPatchRequestSchema, EnrollmentsListQuerySchema, MeResponseSchema, MissionDetailResponseSchema, PatchSettingsRequestSchema, ProgressSyncRequestSchema, type CoursesResponse } from './learner';
import { ManifestMissionSchema } from '../manifest';
import { MediaStreamQuerySchema, type PlaybackUrlRequest } from './audio';
import { ConversationSessionCreateRequestSchema, ConversationTurnRequestSchema, ModelCapabilitiesQuerySchema, PronunciationAssessRequestSchema, SynthesizeRequestSchema, type ConversationEndRequest, type TranscribeResponse } from './speech';
import { AudioProgressPutRequestSchema, AudioProgressPutResponseSchema } from './audio';
import { EvaluatorOutputSchema, emptyEvaluatorOutput } from '../ai/conversation';
import {
  AssetSuggestionDecideRequestSchema,
  AssetSuggestionsGenerateRequestSchema,
  BulkLabelRequestSchema,
  BulkLabelResponseSchema,
  ChapterPatchRequestSchema,
  CollectionCreateRequestSchema,
  ContentRequestReviewResponseSchema,
  ContentRightsCreateRequestSchema,
  ContentRightsRevokeRequestSchema,
  ImportManifestResponseSchema,
  ImportR2PrefixResponseSchema,
  ReorderRequestSchema,
  SpeakerCreateRequestSchema,
  SpeakerPatchRequestSchema,
  SpeakersListQuerySchema,
  UploadInitiateRequestSchema,
  VisualAssetAssignRequestSchema,
  VisualAssetRegisterRequestSchema,
  VisualAssetUploadInitiateRequestSchema,
} from './admin';

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
    // conversation turn replay: an in-flight clientTurnId is a 409 the client retries after Retry-After
    expect(API_ERROR_HTTP_STATUS.turn_in_progress).toBe(409);
    expect(new ApiProblem('turn_in_progress', 'still running', { retryAfterSeconds: 3 }).status).toBe(409);
  });
});

describe('routes', () => {
  it('every route is under /v1 and admin routes are marked admin', () => {
    for (const [key, def] of Object.entries(ROUTES)) {
      expect(def.path.startsWith('/v1/'), key).toBe(true);
      if (def.path.startsWith('/v1/admin/')) expect(def.auth, key).toBe('admin');
    }
    expect(Object.keys(ROUTES).length).toBeGreaterThanOrEqual(94);
  });

  it('no two routes share a method + path', () => {
    const seen = new Map<string, string>();
    for (const [key, def] of Object.entries(ROUTES)) {
      const sig = `${def.method} ${def.path}`;
      expect(seen.get(sig), `${key} duplicates ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, key);
    }
  });

  it('buildPath substitutes params and query', () => {
    expect(buildPath('enrollmentPatch', { id: 'abc' })).toBe('/v1/me/enrollments/abc');
    expect(buildPath('courseCoverage', { trackId: 'arabic-moroccan' }, { source: 'fr' })).toBe('/v1/courses/arabic-moroccan/coverage?source=fr');
    expect(buildPath('me')).toBe('/v1/me');
    expect(() => buildPath('missionDetail', { id: '' })).toThrow(/Missing route param/);
  });

  it('exposes the enrollment delete and media stream routes the API serves', () => {
    expect(ROUTES.enrollmentDelete).toEqual({ method: 'DELETE', path: '/v1/me/enrollments/:id', auth: 'learner' });
    expect(ROUTES.enrollmentPatch.path).toBe(ROUTES.enrollmentDelete.path);
    expect(ROUTES.mediaStream).toEqual({ method: 'GET', path: '/v1/media/stream/:assetId', auth: 'public' });
    expect(buildPath('enrollmentDelete', { id: uuid }, { confirm: 'delete' })).toBe(`/v1/me/enrollments/${uuid}?confirm=delete`);
    expect(buildPath('enrollmentPatch', { id: uuid }, { confirm: 'archive' })).toBe(`/v1/me/enrollments/${uuid}?confirm=archive`);
    expect(buildPath('enrollmentsList', undefined, { includeArchived: true })).toBe('/v1/me/enrollments?includeArchived=true');
    expect(buildPath('mediaStream', { assetId: uuid }, { t: 'a.b' })).toBe(`/v1/media/stream/${uuid}?t=a.b`);
  });
});

describe('enrollment & media query schemas', () => {
  it('QueryBooleanSchema reads string flags honestly ("false" is false)', () => {
    expect(QueryBooleanSchema.parse('true')).toBe(true);
    expect(QueryBooleanSchema.parse('1')).toBe(true);
    expect(QueryBooleanSchema.parse('false')).toBe(false);
    expect(QueryBooleanSchema.parse('0')).toBe(false);
    expect(QueryBooleanSchema.parse(true)).toBe(true);
    expect(QueryBooleanSchema.safeParse('yes').success).toBe(false);
  });

  it('enrollments list defaults includeArchived to false and parses query strings', () => {
    expect(EnrollmentsListQuerySchema.parse({})).toEqual({ includeArchived: false });
    expect(EnrollmentsListQuerySchema.parse({ includeArchived: 'true' })).toEqual({ includeArchived: true });
    expect(EnrollmentsListQuerySchema.parse({ includeArchived: 'false' })).toEqual({ includeArchived: false });
  });

  it('confirmQuery builds route-specific confirm flags and ConfirmQuerySchema accepts the documented values', () => {
    expect(confirmQuery('archive').parse({ confirm: 'archive' }).confirm).toBe('archive');
    expect(confirmQuery('archive').safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(ConfirmQuerySchema.parse({ confirm: 'delete' }).confirm).toBe('delete');
    expect(ConfirmQuerySchema.safeParse({ confirm: 'yes' }).success).toBe(false);
  });

  it('confirm flags accept only the documented value for each route', () => {
    expect(EnrollmentPatchQuerySchema.parse({})).toEqual({});
    expect(EnrollmentPatchQuerySchema.parse({ confirm: 'archive' }).confirm).toBe('archive');
    expect(EnrollmentPatchQuerySchema.safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(EnrollmentDeleteQuerySchema.parse({ confirm: 'delete' }).confirm).toBe('delete');
    expect(EnrollmentDeleteQuerySchema.safeParse({ confirm: 'archive' }).success).toBe(false);
    expect(EnrollmentDeleteResponseSchema.safeParse({ deleted: true, enrollmentId: uuid }).success).toBe(true);
    expect(EnrollmentDeleteResponseSchema.safeParse({ deleted: false, enrollmentId: uuid }).success).toBe(false);
  });

  it('media stream requires a non-empty token', () => {
    expect(MediaStreamQuerySchema.safeParse({ t: 'abc.def' }).success).toBe(true);
    expect(MediaStreamQuerySchema.safeParse({ t: '' }).success).toBe(false);
    expect(MediaStreamQuerySchema.safeParse({}).success).toBe(false);
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

describe('integration-gap closures (cross-package-gaps 2026-10-15)', () => {
  const inlineClip = { base64: 'AAAA', mime: 'audio/webm;codecs=opus', durationMs: 1200 };
  const turnBase = { clientTurnId: uuid, input: { kind: 'audio', assetId: uuid, durationMs: 1200, transcriptHint: null }, clientState: { state: 'listening', lastSeq: 3, lastCharacterTurnId: null } };

  it('conversation turn accepts inline audio (bare clip or AudioInput) and still works without it', () => {
    expect(ConversationTurnRequestSchema.safeParse(turnBase).success).toBe(true);
    expect(ConversationTurnRequestSchema.safeParse({ ...turnBase, audio: inlineClip }).success).toBe(true);
    expect(ConversationTurnRequestSchema.safeParse({ ...turnBase, audio: { source: 'inline', base64: 'AAAA', encoding: 'opus', sampleRateHz: null } }).success).toBe(true);
    expect(ConversationTurnRequestSchema.safeParse({ ...turnBase, audio: { base64: '', mime: 'audio/webm', durationMs: 10 } }).success).toBe(false);
  });

  it('settings patch accepts null to clear the default source language (mirrors nullable MeResponse)', () => {
    expect(PatchSettingsRequestSchema.safeParse({ defaultSourceLanguageCode: null }).success).toBe(true);
    expect(PatchSettingsRequestSchema.safeParse({ defaultSourceLanguageCode: 'fr' }).success).toBe(true);
    expect(MeResponseSchema.shape.defaultSourceLanguageCode.safeParse(null).success).toBe(true);
  });

  it('missions carry an optional sceneId in manifests and mission detail', () => {
    const mission = { id: uuid, order: 0, type: 'standard', titleKey: null, title: 'Au café', level: 'beginner', difficulty: 0.2, recommendedMinutes: 5, prerequisiteSkillKeys: [], skillKeys: [], characterIds: [], sceneArt: null, publishedRevision: 1, steps: [], localizationComplete: true };
    expect(ManifestMissionSchema.safeParse(mission).success).toBe(true);
    expect(ManifestMissionSchema.parse({ ...mission, sceneId: 'cafe' }).sceneId).toBe('cafe');
    expect(ManifestMissionSchema.safeParse({ ...mission, sceneId: null }).success).toBe(true);
    expect(ManifestMissionSchema.safeParse({ ...mission, sceneId: 'Not A Key' }).success).toBe(false);
    expect(MissionDetailResponseSchema.shape.sceneId.safeParse('market').success).toBe(true);
    expect(MissionDetailResponseSchema.shape.sceneId.safeParse(undefined).success).toBe(true);
  });

  it('bulk label response accepts (table,id,revision) tuples and keeps revisionIds optional', () => {
    expect(BulkLabelResponseSchema.safeParse({ affected: 2, revisionIds: [uuid], skipped: [] }).success).toBe(true);
    expect(BulkLabelResponseSchema.safeParse({ affected: 2, revisions: [{ entityTable: 'audio_lessons', entityId: uuid, revision: 4 }], skipped: [] }).success).toBe(true);
    expect(BulkLabelResponseSchema.safeParse({ affected: 0, skipped: [] }).success).toBe(true);
    expect(BulkLabelResponseSchema.safeParse({ affected: 1, revisions: [{ entityTable: 'audio_lessons', entityId: 'nope', revision: 1 }], skipped: [] }).success).toBe(false);
  });

  it('import responses expose planId/enqueued for dry runs while jobId stays present', () => {
    const base = { jobId: uuid, dryRun: true, planId: uuid, enqueued: false };
    expect(ImportManifestResponseSchema.safeParse({ ...base, rowCount: 3, matched: 2, unmatched: [{ row: 2, reason: 'no key' }], validationErrors: [] }).success).toBe(true);
    expect(ImportR2PrefixResponseSchema.safeParse({ ...base, discovered: { objects: 1, audio: 1, sidecars: 0, alreadyImported: 0, unsupported: 0 }, sample: [] }).success).toBe(true);
    expect(ImportR2PrefixResponseSchema.safeParse({ jobId: uuid, dryRun: false, discovered: { objects: 1, audio: 1, sidecars: 0, alreadyImported: 0, unsupported: 0 }, sample: [] }).success).toBe(true);
    expect(ImportR2PrefixResponseSchema.safeParse({ dryRun: true, planId: uuid, discovered: { objects: 1, audio: 1, sidecars: 0, alreadyImported: 0, unsupported: 0 }, sample: [] }).success).toBe(false);
  });

  it('inferred types exist for the schemas the apps had to infer locally', () => {
    const end: ConversationEndRequest = { reason: 'completed', clientState: { lastSeq: 1, turnCount: 1 }, clientEventId: uuid };
    const playback: PlaybackUrlRequest = { renewal: false };
    const courses: CoursesResponse = { courses: [] };
    const recording: TranscribeResponse['recordingAssetId'] = null;
    expect([end, playback, courses, recording].length).toBe(4);
  });
});

describe('2026-10-19 contract additions (admin resources, scope, honesty flags)', () => {
  const key = 'idem-0001-abcdef';

  it('registers the promoted admin routes with stable paths', () => {
    expect(ROUTES.adminSpeakersList).toEqual({ method: 'GET', path: '/v1/admin/speakers', auth: 'admin' });
    expect(ROUTES.adminChaptersReorder.path).toBe('/v1/admin/library/collections/:id/chapters/reorder');
    expect(ROUTES.adminLessonAssetDetach).toEqual({ method: 'DELETE', path: '/v1/admin/library/lessons/:id/assets/:assetId', auth: 'admin' });
    expect(ROUTES.adminContentRightsRevoke.method).toBe('POST');
    expect(ROUTES.adminVisualAssetUploadInitiate.path).toBe('/v1/admin/visual-assets/upload-initiate');
    expect(ROUTES.adminAssetSuggestionDecide.path).toBe('/v1/admin/asset-suggestions/:id/decide');
    expect(buildPath('adminLessonAssetDetach', { id: uuid, assetId: uuid })).toBe(`/v1/admin/library/lessons/${uuid}/assets/${uuid}`);
  });

  it('speakers: create defaults are honest (unknown variety stays null) and patch needs a field', () => {
    const created = SpeakerCreateRequestSchema.parse({ displayName: 'Fatima', idempotencyKey: key });
    expect(created.targetVarietyId).toBeNull();
    expect(created.consentState).toBe('unknown');
    expect(created.synthetic).toBe(false);
    expect(SpeakerPatchRequestSchema.safeParse({ expectedRevision: 2 }).success).toBe(false);
    expect(SpeakerPatchRequestSchema.safeParse({ region: 'Casablanca', expectedRevision: 2 }).success).toBe(true);
    // a patch never re-applies create defaults (so `{ region }` does not silently reset `synthetic` to false)
    expect(SpeakerPatchRequestSchema.parse({ region: 'Casablanca' })).toEqual({ region: 'Casablanca' });
    expect(SpeakersListQuerySchema.parse({ synthetic: 'false', limit: '10' })).toMatchObject({ synthetic: false, limit: 10 });
  });

  it('structure: collections carry translations per language, reorders reject duplicates', () => {
    expect(CollectionCreateRequestSchema.safeParse({ titleTranslations: 'Darija basics', idempotencyKey: key }).success).toBe(false);
    expect(CollectionCreateRequestSchema.parse({ titleTranslations: { en: 'Darija basics' }, idempotencyKey: key }).descriptionTranslations).toEqual({});
    expect(ChapterPatchRequestSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(ReorderRequestSchema.safeParse({ orderedIds: [uuid, uuid], idempotencyKey: key }).success).toBe(false);
    expect(ReorderRequestSchema.safeParse({ orderedIds: [uuid], idempotencyKey: key }).success).toBe(true);
  });

  it('content rights: revoke needs a documented reason; create defaults to unverified', () => {
    expect(ContentRightsRevokeRequestSchema.safeParse({ reason: 'oops', idempotencyKey: key }).success).toBe(false);
    expect(ContentRightsRevokeRequestSchema.safeParse({ reason: 'takedown', idempotencyKey: key }).success).toBe(true);
    expect(ContentRightsCreateRequestSchema.parse({ permissionGrant: 'Written consent', licenseId: 'cc-by-4.0', idempotencyKey: key }).verified).toBe(false);
  });

  it('visual assets: upload-initiate is image-only, register requires English alt text, assign targets a known slot', () => {
    const base = { filename: 'cover.png', byteLength: 10, clientChecksumSha256: sha, idempotencyKey: key };
    expect(VisualAssetUploadInitiateRequestSchema.safeParse({ ...base, contentType: 'image/png' }).success).toBe(true);
    expect(VisualAssetUploadInitiateRequestSchema.safeParse({ ...base, contentType: 'audio/mpeg' }).success).toBe(false);
    const reg = { uploadId: uuid, type: 'mission_scene', styleVersion: 'v1', origin: 'original_upload', idempotencyKey: key };
    expect(VisualAssetRegisterRequestSchema.safeParse({ ...reg, altTextTranslations: { fr: 'Un café' } }).success).toBe(false);
    expect(VisualAssetRegisterRequestSchema.safeParse({ ...reg, altTextTranslations: { en: 'A café terrace', fr: 'Un café' }, crop: { x: 0.5, y: 0, width: 0.6, height: 1 } }).success).toBe(false);
    expect(VisualAssetRegisterRequestSchema.safeParse({ ...reg, altTextTranslations: { en: 'A café terrace' }, crop: { x: 0.1, y: 0, width: 0.6, height: 1 } }).success).toBe(true);
    expect(VisualAssetAssignRequestSchema.safeParse({ entityTable: 'audio_lessons', entityId: uuid, slot: 'cover', idempotencyKey: key }).success).toBe(true);
    expect(VisualAssetAssignRequestSchema.safeParse({ entityTable: 'speakers', entityId: uuid, slot: 'cover', idempotencyKey: key }).success).toBe(false);
  });

  it('asset suggestions: generate needs a selection, decide is approve/reject only', () => {
    expect(AssetSuggestionsGenerateRequestSchema.safeParse({ idempotencyKey: key }).success).toBe(false);
    expect(AssetSuggestionsGenerateRequestSchema.parse({ assetIds: [uuid], idempotencyKey: key }).kinds).toContain('language');
    expect(AssetSuggestionDecideRequestSchema.safeParse({ decision: 'accept', idempotencyKey: key }).success).toBe(false);
    expect(AssetSuggestionDecideRequestSchema.safeParse({ decision: 'approve', overrideSuggestion: { level: 'beginner' }, idempotencyKey: key }).success).toBe(true);
  });

  it('request-review reports review_needed | in_review, never pending', () => {
    expect(ContentRequestReviewResponseSchema.safeParse({ contentId: uuid, state: 'review_needed', reviewStatus: 'in_review' }).success).toBe(true);
    expect(ContentRequestReviewResponseSchema.safeParse({ contentId: uuid, state: 'review_needed', reviewStatus: 'pending' }).success).toBe(false);
    expect(ContentRequestReviewResponseSchema.safeParse({ contentId: uuid, state: 'review_needed', reviewStatus: 'approved' }).success).toBe(false);
  });

  it('evaluator confidence is null when no evaluator ran (never a fabricated 0)', () => {
    expect(EvaluatorOutputSchema.parse(emptyEvaluatorOutput()).confidence).toBeNull();
    expect(EvaluatorOutputSchema.safeParse({ ...emptyEvaluatorOutput(), confidence: 0.8 }).success).toBe(true);
    expect(EvaluatorOutputSchema.safeParse({ ...emptyEvaluatorOutput(), confidence: 1.2 }).success).toBe(false);
  });

  it('conversation session scope is mission | audio_lesson | free and must agree with missionId', () => {
    const base = { enrollmentId: uuid, clientSessionId: uuid };
    expect(ConversationSessionCreateRequestSchema.parse(base).scope).toBeUndefined();
    expect(ConversationSessionCreateRequestSchema.safeParse({ ...base, scope: { kind: 'free' } }).success).toBe(true);
    expect(ConversationSessionCreateRequestSchema.safeParse({ ...base, scope: { kind: 'audio_lesson', audioLessonId: uuid, transcriptSegmentIds: [uuid] } }).success).toBe(true);
    expect(ConversationSessionCreateRequestSchema.safeParse({ ...base, scope: { kind: 'audio_lesson' } }).success).toBe(false);
    expect(ConversationSessionCreateRequestSchema.safeParse({ ...base, missionId: uuid, scope: { kind: 'mission', missionId: '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0e' } }).success).toBe(false);
  });

  it('model capabilities query accepts enrollmentId and source; audio progress accepts clientSentAt + reason', () => {
    expect(ModelCapabilitiesQuerySchema.parse({ trackId: 'arabic-moroccan', enrollmentId: uuid, source: 'fr' })).toMatchObject({ source: 'fr' });
    expect(ModelCapabilitiesQuerySchema.safeParse({ trackId: 'arabic-moroccan', source: 'xx' }).success).toBe(false);
    const put = { clientEventId: uuid, deviceId: 'd1', revision: 1, positionMs: 100, durationMs: null, completed: false, occurredAt: '2026-10-19T10:00:00.000Z' };
    expect(AudioProgressPutRequestSchema.safeParse(put).success).toBe(true);
    expect(AudioProgressPutRequestSchema.safeParse({ ...put, clientSentAt: '2026-10-19T10:00:01.000Z' }).success).toBe(true);
    expect(AudioProgressPutResponseSchema.safeParse({ lessonId: uuid, positionMs: 100, completed: false, revision: 1, resolution: 'superseded', reason: 'older_event' }).success).toBe(true);
    expect(AudioProgressPutResponseSchema.safeParse({ lessonId: uuid, positionMs: 100, completed: false, revision: 1, resolution: 'applied' }).success).toBe(true);
  });
});

describe('PatchSettingsRequestSchema keeps partial option patches partial (device QA 2026-10-20)', () => {
  it('does not inject defaults for accessibility fields the client did not send', () => {
    // Before: parse() returned reduce_motion:false etc., and the API merge reset the learner's other settings.
    expect(PatchSettingsRequestSchema.parse({ accessibilityOptions: { mascot_enabled: false } })).toEqual({ accessibilityOptions: { mascot_enabled: false } });
  });
  it('does the same for privacy and notification patches', () => {
    const privacy = PatchSettingsRequestSchema.parse({ privacyOptions: {} }) as { privacyOptions: Record<string, unknown> };
    expect(privacy.privacyOptions).toEqual({});
    const notif = PatchSettingsRequestSchema.parse({ notificationPreferences: {} }) as { notificationPreferences: Record<string, unknown> };
    expect(notif.notificationPreferences).toEqual({});
  });
  it('still validates the fields that are sent', () => {
    expect(() => PatchSettingsRequestSchema.parse({ accessibilityOptions: { text_scale: 5 } })).toThrow();
  });
});
