/**
 * §6.2 speech routes: transcription, pronunciation assessment, synthesis and per-track model capabilities.
 *
 * Capability-aware by construction (§8.2, §8.5, §15): the registry decides which adapter may serve a
 * variety and fallbacks never cross a dialect boundary; a numeric pronunciation score exists only when an
 * acoustic assessor produced it (the contracts schema enforces it), otherwise the learner gets reference
 * comparison + honest coarse feedback. Approved content only: synthesis accepts expression ids or text the
 * server itself generated for a character turn; pronunciation references must be published expressions.
 *
 * Non-speech gate (`@langquest/ai/speech/speech-detection`): learner takes are transcribed with `screening: 'learner'`.
 * A take without speech (silence, ambient noise the recognizer turned into "اشتركوا في القناة" / "Sous-titres réalisés
 * par la communauté d'Amara.org") is its own honest outcome: `no_speech_detected`, no meaning judgement (no LLM call),
 * no observation, no skill or XP credit, no retained recording.
 */
import type { AiServices } from '@langquest/ai';
import { providerLocaleFor, capabilityFromStatus, resolveVariety } from '@langquest/ai/capability/registry';
import { MEANING_THRESHOLDS, type MeaningScoreResult } from '@langquest/ai/semantic/meaning';
import { applySpeechScreening, noSpeechAssessment, SILENCE_PEAK_DBFS, speechDetectionOf, toSpeechDetection, type SpeechScreening } from '@langquest/ai/speech/speech-detection';
import { PRONUNCIATION_JUDGE_VERSION, PronunciationJudgeError } from '@langquest/ai/speech/pronunciation-judge';
import { base64ToBytes } from '@langquest/ai/util';
import { AI_TASK_NAME_VALUES, ModelCapabilitiesQuerySchema, ModelCapabilitiesResponseSchema, PronunciationAssessRequestSchema, PronunciationAssessResponseSchema, PronunciationFeedbackRequestSchema, PronunciationFeedbackResponseSchema, LANGUAGE_VARIETIES, isCourseTrackId, SynthesizeRequestSchema, SynthesizeResponseSchema, NarrateRequestSchema, NarrateResponseSchema, COURSE_TRACKS, TranscribeRequestSchema, TranscribeResponseSchema, getCourseTrack, isAcousticAssessmentMode, speechObservationOutcome, unsupportedCapability, type AiTaskName, type AudioInput, type Capability, type PronunciationAssessment, type SkillObservationInput, type SourceLanguageCode, type SpeechEvaluationResult, type SpeechRetention, type VarietyId } from '@langquest/contracts';
import { sha256Hex as mediaSha256 } from '@langquest/media/hashing';
import { buildMasterKey, extensionForMime } from '@langquest/media/keys';
import { sha256Hex } from '@langquest/telemetry/privacy';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseQuery } from '../../http/validate';
import { pronunciationScoringLevel } from '../../lib/capabilities';
import { parsePrivacy } from '../../lib/dto';
import { assertVarietyMatches, languageContextFor, loadOwnedEnrollment, loadUiLocale, varietyOf, type EnrollmentRow } from '../../lib/enrollment';
import { recordObservations } from '../../lib/learning';
import { loadDbProfiles } from '../../services/ai';
import { SPEECH_BODY_LIMIT_BYTES } from '../../middleware/security';
import type { RequestServices } from '../../services/context';

/** Bumped 2026-10-20: non-speech gate before grading; a confident miss is no longer 'partially_understood'. */
const PRONUNCIATION_SCORER_VERSION = 'speech-route@2026-10-20.1';

/**
 * `GET /v1/ai/model-capabilities` query: the contract carries `trackId` / `regionalOption` plus `enrollmentId` /
 * `source`, which select the SOURCE language whose model profiles should be reported — `ai_model_profiles` are keyed
 * task × variety × source (CONVENTIONS §5), so an English-source answer is wrong for a French-source learner.
 * `enrollmentId` (owned enrollment, its `source_language_code`) wins over `source`; with neither, only the
 * variety/global scope is resolved and the capability notes say so. Kept as an alias for existing importers.
 */
export const ModelCapabilitiesApiQuerySchema = ModelCapabilitiesQuerySchema;

/**
 * Persist a learner recording (inline audio) under the learner's retention preference (or the explicit session
 * retention when given); null when not retained or when media storage is unavailable.
 */
export async function retainRecording(s: RequestServices, enrollment: EnrollmentRow, audio: { base64: string; encoding: string }, userId: string, retentionOverride?: SpeechRetention): Promise<string | null> {
  const { repos } = s.requireUser();
  const retention = retentionOverride ?? parsePrivacy((await repos.profiles.getByUserId(userId))?.privacy_options).store_speech_recordings;
  if (retention === 'none' || retention === 'session' || !s.media.available) return null;
  const bytes = base64ToBytes(audio.base64);
  const mime = audio.encoding === 'mp3' ? 'audio/mpeg' : audio.encoding === 'wav' || audio.encoding === 'pcm16' ? 'audio/wav' : audio.encoding === 'flac' ? 'audio/flac' : audio.encoding === 'webm_opus' ? 'audio/webm' : audio.encoding === 'm4a' || audio.encoding === 'aac' ? 'audio/mp4' : 'audio/ogg';
  const checksum = await mediaSha256(bytes);
  const assetId = crypto.randomUUID();
  const ext = extensionForMime(mime) ?? 'bin';
  const key = buildMasterKey({ assetId, contentHash: checksum, ext });
  await s.media.put(key, bytes, mime);
  const ins = await s.service.from('media_assets').insert({ id: assetId, storage_key: key, bucket: s.media.bucket, owner_id: userId, kind: 'audio', checksum_sha256: checksum, mime_type: mime, byte_length: bytes.byteLength, visibility: 'private', state: 'imported_draft', disposition: 'active' }).select('id').single();
  if (ins.error) {
    s.log.warn('speech.retain_failed', { error: ins.error.message });
    return null;
  }
  s.log.info('speech.recording_retained', { assetId, retention, enrollmentId: enrollment.id });
  return assetId;
}

async function resolveReference(s: RequestServices, enrollment: EnrollmentRow, input: { expressionId?: string; referenceText?: string }): Promise<{ text: string; expressionId: string | null }> {
  const { db } = s.requireUser();
  const variety = varietyOf(enrollment);
  if (input.expressionId) {
    const res = await db.from('expressions').select('id, canonical_text, target_variety_id').eq('id', input.expressionId).maybeSingle();
    if (!res.data) throw problem.notFound('Expression');
    if (res.data.target_variety_id !== variety) throw problem.validation(`Expression is ${res.data.target_variety_id}, not ${variety}`);
    return { text: res.data.canonical_text, expressionId: res.data.id };
  }
  const text = (input.referenceText ?? '').trim();
  const byCanonical = await db.from('expressions').select('id').eq('target_variety_id', variety).eq('canonical_text', text).limit(1).maybeSingle();
  if (byCanonical.data) return { text, expressionId: byCanonical.data.id };
  const byForm = await db.from('expression_forms').select('expression_id, expressions!inner(target_variety_id)').eq('text', text).limit(5);
  const form = ((byForm.data ?? []) as unknown as { expression_id: string; expressions: { target_variety_id: string } | null }[]).find((f) => f.expressions?.target_variety_id === variety);
  if (form) return { text, expressionId: form.expression_id };
  throw problem.validation('referenceText must be approved course content for this variety (use expressionId)');
}

/** Text the server generated for a character turn in one of this learner's sessions (approved for synthesis). */
async function isOwnCharacterText(s: RequestServices, userId: string, text: string): Promise<boolean> {
  const hash = sha256Hex(text);
  const res = await s.service.from('conversation_turns').select('id, conversation_sessions!inner(user_id)').eq('speaker', 'character').eq('text_hash', hash).limit(5);
  return ((res.data ?? []) as unknown as { conversation_sessions: { user_id: string } | null }[]).some((r) => r.conversation_sessions?.user_id === userId);
}

/**
 * Learner audio arrives inline or as a stored recording (`asset`, which the asset resolver checks for ownership). A
 * caller-supplied URL is refused: the Worker would fetch any host for the caller (internal addresses included) and
 * forward up to 25 MB of whatever it returned to the paid STT provider.
 */
export function assertLearnerAudioSource(audio: AudioInput): void {
  if (audio.source === 'url') throw problem.validation('audio.source "url" is not accepted; send the recording inline or as an uploaded asset (assetId)', { field: 'audio.source' });
}

/**
 * Intelligibility of a take that contained speech. `meaning.confidence` is the judge's confidence in its OWN verdict
 * (0.99 for "confidently NOT the expected meaning"), so it never makes a miss "partially understood": only partial
 * lexical evidence (the deterministic score in the uncertain band) or a low-confidence recognition does. Takes without
 * speech never reach this function (`no_speech_detected`).
 */
export const intelligibilityOf = (meaning: Pick<MeaningScoreResult, 'matched' | 'needsClarification' | 'deterministicScore'>): SpeechEvaluationResult['intelligibility'] => {
  if (meaning.matched) return 'understood';
  if (meaning.needsClarification || meaning.deterministicScore >= MEANING_THRESHOLDS.uncertainLow) return 'partially_understood';
  return 'not_understood';
};

/** §6.5 result for a take without speech: nothing heard, nothing judged, nothing credited (and nothing to advance on). */
export function noSpeechEvaluation(input: { assessmentId: string; targetVarietyId: VarietyId; pronunciation: PronunciationAssessment }): SpeechEvaluationResult {
  const pronunciation = input.pronunciation.assessmentMode === 'unavailable' && input.pronunciation.numericScore === null ? input.pronunciation : noSpeechAssessment(input.pronunciation.provider, input.pronunciation.scorerVersion);
  return { assessmentId: input.assessmentId, targetVarietyId: input.targetVarietyId, semanticIntentMatched: false, meaningConfidence: 0, intelligibility: 'no_speech_detected', pronunciation, shouldAdvanceConversation: false, transcript: null, matchedIntentIds: [], outcome: speechObservationOutcome({ intelligibility: 'no_speech_detected', semanticIntentMatched: false }) };
}

/** Log line for a gated take: the reason and signals only, never the (discarded) text. */
const logNoSpeech = (s: RequestServices, route: string, enrollmentId: string, speech: SpeechScreening): void =>
  s.log.info('speech.no_speech_detected', { route, enrollmentId, reason: speech.reason, matchedPhrases: speech.matchedPhrases.length, signals: speech.signals, detector: speech.detectorVersion });

/**
 * Most specific enabled profile for a text task: (variety × source) → (variety) → (source) → (global) when a source
 * is known, otherwise (variety) → (global) only. The registry's `find` always requires a source, hence this helper.
 */
function findTextProfile(ai: AiServices, task: AiTaskName, targetVariety: VarietyId, source: SourceLanguageCode | null): ReturnType<AiServices['profiles']['find']> {
  if (source) return ai.profiles.find({ task, targetVariety, sourceLanguage: source });
  const enabled = ai.profiles.list(task).filter((p) => p.enabled && p.sourceLanguage === null && (p.targetVariety === targetVariety || p.targetVariety === null));
  return enabled.find((p) => p.targetVariety === targetVariety) ?? enabled.find((p) => p.targetVariety === null) ?? null;
}

export function registerSpeechRoutes(define: DefineRoute): void {
  define('speechTranscribe', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, TranscribeRequestSchema);
    assertLearnerAudioSource(body.audio);
    const s = c.get('services')!;
    const { db, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    const ai = await s.ai();
    const locale = providerLocaleFor(body.targetVarietyId, enrollment.regional_preference);
    const pick = await ai.registry.recognizerFor(locale);
    if (!pick) throw problem.unsupported(`Speech recognition is not available for ${body.targetVarietyId} yet`, { capability: unsupportedCapability('openrouter', ['locale_unsupported']) });
    const heard = await ai.recognizer.transcribe(body.audio, locale, { traceId: s.requestId, enrollmentId: enrollment.id, screening: 'learner', expectedText: body.expectedText ?? null, clientSignals: body.recording ?? null });
    const speech = speechDetectionOf(heard, { expectedText: body.expectedText ?? null, client: body.recording ?? null });
    const transcript = applySpeechScreening(heard, speech);
    if (!speech.speechDetected) logNoSpeech(s, 'speechTranscribe', enrollment.id, speech);
    // A take without speech is never kept, whatever the retention preference (nothing of the learner's to keep).
    const recordingAssetId = speech.speechDetected && body.audio.source === 'inline' ? await retainRecording(s, enrollment, body.audio, principal.userId) : null;
    return respondOk(c, TranscribeResponseSchema.parse({ transcript, capability: pick.capability, recordingAssetId, speech: toSpeechDetection(speech) }));
  });

  define('speechPronunciationAssess', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, PronunciationAssessRequestSchema);
    assertLearnerAudioSource(body.audio);
    const s = c.get('services')!;
    const { db, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    const reference = await resolveReference(s, enrollment, { expressionId: body.expressionId, referenceText: body.referenceText });
    const ai = await s.ai();
    const locale = providerLocaleFor(body.targetVarietyId, enrollment.regional_preference);
    const language = languageContextFor(enrollment, await loadUiLocale(db, principal.userId));
    const clientSignals = body.recording ?? null;
    const result = await ai.assessor.assess({ audio: body.audio, targetVarietyId: body.targetVarietyId, locale, referenceText: reference.text, referencePhonemes: null, expressionId: reference.expressionId, requestedFeatures: body.requestedFeatures }, { clientSignals, traceId: s.requestId, enrollmentId: enrollment.id });
    const assessmentId = crypto.randomUUID();
    // Gate before any judgement: the assessor's verdict, or one computed here for an acoustic assessor's transcript.
    const speech = speechDetectionOf(result.transcript, { expectedText: reference.text, client: clientSignals });
    if (!speech.speechDetected) {
      logNoSpeech(s, 'speechPronunciationAssess', enrollment.id, speech);
      return respondOk(c, PronunciationAssessResponseSchema.parse(noSpeechEvaluation({ assessmentId, targetVarietyId: body.targetVarietyId, pronunciation: result.pronunciation })));
    }
    const transcriptText = speech.text;
    const meaning = await ai.meaning.score({ utterance: transcriptText, references: [{ text: reference.text, intentId: reference.expressionId ?? undefined }], language, utteranceConfidence: result.transcript?.confidence ?? null });
    const intelligibility = intelligibilityOf(meaning);
    // The one outcome vocabulary (contracts `speechObservationOutcome`): recorded below AND returned to the client.
    const outcome = speechObservationOutcome({ intelligibility, semanticIntentMatched: meaning.matched, needsClarification: meaning.needsClarification });
    const evaluation = PronunciationAssessResponseSchema.parse({
      assessmentId,
      targetVarietyId: body.targetVarietyId,
      semanticIntentMatched: meaning.matched,
      meaningConfidence: meaning.confidence,
      intelligibility,
      pronunciation: result.pronunciation,
      shouldAdvanceConversation: meaning.matched,
      transcript: transcriptText,
      matchedIntentIds: meaning.matchedIntentIds,
      outcome,
    });
    // Evidence (A14): meaning and pronunciation are separate observations; pronunciation only counts with an acoustic scorer.
    const scenarioId = body.scenarioId ?? reference.expressionId ?? 'pronunciation';
    const observations: SkillObservationInput[] = [];
    const semanticSkill = 'speaking.intelligibility';
    observations.push({ enrollmentId: enrollment.id, skillKey: semanticSkill, observationType: 'semantic_success', scenarioId, missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: reference.expressionId, autonomy: 'unaided', hintsUsed: 0, outcome, utteranceConfidence: result.transcript?.confidence ?? null, scorerKind: meaning.method === 'deterministic' ? 'deterministic' : 'llm_evaluator', scorerVersion: PRONUNCIATION_SCORER_VERSION, uncertainty: meaning.needsClarification ? 0.9 : 1 - meaning.confidence, observedAt: new Date().toISOString(), note: null });
    if (isAcousticAssessmentMode(result.pronunciation.assessmentMode) && result.pronunciation.numericScore !== null) {
      observations.push({ enrollmentId: enrollment.id, skillKey: 'speaking.pronunciation', observationType: 'pronunciation', scenarioId, missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: reference.expressionId, autonomy: 'unaided', hintsUsed: 0, outcome: result.pronunciation.numericScore >= 70 ? 'success' : result.pronunciation.numericScore >= 45 ? 'partial' : 'fail', utteranceConfidence: result.transcript?.confidence ?? null, scorerKind: 'acoustic_assessor', scorerVersion: result.pronunciation.scorerVersion ?? result.pronunciation.provider ?? 'acoustic', uncertainty: 0.3, observedAt: new Date().toISOString(), note: null });
    }
    // The grading row is the evidence mission credit reads (`lib/xp-credit.ts`), so it is written before answering:
    // a mission evaluate sent right after the last take must see that take. A failed write never fails the take itself;
    // it only means the take earns no credit, which is logged.
    try {
      await recordObservations(s, enrollment, observations, new Date().toISOString());
    } catch (error) {
      s.log.warn('speech.grading_row_failed', { route: 'speechPronunciationAssess', enrollmentId: enrollment.id, assessmentId, error: error instanceof Error ? error.message : String(error) });
    }
    return respondOk(c, evaluation);
  });

  // AI pronunciation feedback: a listening model's estimate for a take of an approved phrase (ADR-006 still holds: no
  // acoustic score is claimed and nothing is recorded as mastery evidence). A take the recorder metered as silent is
  // answered `no_speech` without calling the model.
  define('speechPronunciationFeedback', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, PronunciationFeedbackRequestSchema);
    const s = c.get('services')!;
    const { db } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    if (!s.config.env.OPENROUTER_API_KEY) throw problem.unsupported('AI pronunciation feedback is not available on this deployment', { capability: unsupportedCapability('openrouter', ['provider_disabled']) });
    const reference = await resolveReference(s, enrollment, { expressionId: body.expressionId });
    const base = { feedbackId: crypto.randomUUID(), targetVarietyId: body.targetVarietyId, method: 'ai_listening' as const, version: PRONUNCIATION_JUDGE_VERSION };
    const peak = body.recording?.peakLevelDb;
    if (typeof peak === 'number' && peak <= SILENCE_PEAK_DBFS) {
      return respondOk(c, PronunciationFeedbackResponseSchema.parse({ ...base, score: null, band: 'no_speech', matchesTarget: false, heard: '', heardIpa: '', targetIpa: '', words: [], summary: '', tip: '', model: null }));
    }
    if (!isCourseTrackId(enrollment.course_track_id)) throw problem.internal('Enrollment references an unknown track');
    const track = getCourseTrack(enrollment.course_track_id);
    const variety = LANGUAGE_VARIETIES.find((v) => v.id === track.targetVarietyId);
    const varietyName = variety && variety.name !== track.displayName ? `${track.displayName} — ${variety.name}` : track.displayName;
    const ai = await s.ai();
    let judgement;
    try {
      judgement = await ai.pronunciationJudge.judge(
        { audio: { bytes: base64ToBytes(body.audio.base64), format: body.audio.encoding }, targetText: reference.text, transliteration: null, varietyName, sourceLanguage: enrollment.source_language_code, targetVariety: body.targetVarietyId },
        { traceId: s.requestId, enrollmentId: enrollment.id },
      );
    } catch (error) {
      s.log.warn('speech.pronunciation_feedback_failed', { enrollmentId: enrollment.id, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof PronunciationJudgeError) throw problem.provider('The pronunciation feedback could not be read this time. Please try again.');
      throw problem.provider();
    }
    return respondOk(
      c,
      PronunciationFeedbackResponseSchema.parse({ ...base, score: judgement.score, band: judgement.band, matchesTarget: judgement.matchesTarget, heard: judgement.heard, heardIpa: judgement.heardIpa, targetIpa: judgement.targetIpa, words: judgement.words, summary: judgement.summary, tip: judgement.tip, model: judgement.model }),
    );
  });

  define('speechSynthesize', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, idempotent: false }, async (c) => {
    const body = await parseBody(c, SynthesizeRequestSchema);
    const s = c.get('services')!;
    const { db, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    let text: string;
    let shared = false;
    if (body.expressionId) {
      text = (await resolveReference(s, enrollment, { expressionId: body.expressionId })).text;
      shared = true;
    } else {
      text = body.text!.trim();
      const approved = (await isOwnCharacterText(s, principal.userId, text)) || (await resolveReference(s, enrollment, { referenceText: text }).then(() => true, () => false));
      if (!approved) throw problem.validation('Only approved course content or your own character turns can be synthesized');
    }
    const ai = await s.ai();
    const locale = providerLocaleFor(body.targetVarietyId, body.regionalOption ?? enrollment.regional_preference);
    const resolved = resolveVoiceWithAdminChoice(ai, locale, body.voiceId, enrollment.source_language_code as SourceLanguageCode);
    if (!resolved.voice || !resolved.capability.supported) throw problem.unsupported(`No verified synthetic voice exists for ${body.targetVarietyId} yet`, { capability: resolved.capability });
    const audio = await ai.synthesizer.synthesize(text, locale, resolved.voice.voiceId, { cacheScope: shared ? 'shared_approved' : 'none', rate: body.speed === 'slow' ? 0.75 : 1, traceId: s.requestId, enrollmentId: enrollment.id });
    let out = audio;
    if (audio.base64 && !audio.url && s.media.canPresign) {
      try {
        const key = `tts/${sha256Hex(`${text}|${resolved.voice.voiceId}|${body.speed}`)}.${audio.encoding === 'mp3' ? 'mp3' : 'wav'}`;
        await s.media.put(key, base64ToBytes(audio.base64), audio.encoding === 'mp3' ? 'audio/mpeg' : 'audio/wav');
        out = { ...audio, url: await s.media.presignGet(key, 900), base64: null };
      } catch (error) {
        s.log.warn('tts.r2_store_failed', { error });
      }
    }
    return respondOk(c, SynthesizeResponseSchema.parse({ audio: out, capability: resolved.capability }));
  });

  /**
   * The narrator: an exercise's instruction or context ("At the café. Karim greets you. What do you answer?") read in
   * the learner's instruction language, with a voice of that language. Never target-language content (that is
   * `speechSynthesize`, approved lines only, in the variety's own voice), so a narration can never be taken as a
   * model to imitate. Instruction text is generic: identical text gives identical audio, so clips are cached and
   * shared (the requester already knows the text).
   */
  define('speechNarrate', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, idempotent: false }, async (c) => {
    const body = await parseBody(c, NarrateRequestSchema);
    const s = c.get('services')!;
    const { db } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    const language = enrollment.source_language_code as SourceLanguageCode;
    const locale = narratorLocaleFor(language);
    if (!locale) throw problem.unsupported(`No narrator voice for ${language} yet`);
    const ai = await s.ai();
    const resolved = resolveVoiceWithAdminChoice(ai, locale, undefined, language);
    if (!resolved.voice || !resolved.capability.supported) throw problem.unsupported(`No narrator voice for ${language} yet`, { capability: resolved.capability });
    const text = body.text;
    const audio = await ai.synthesizer.synthesize(text, locale, resolved.voice.voiceId, { cacheScope: 'shared_approved', rate: body.speed === 'slow' ? 0.75 : 1, traceId: s.requestId, enrollmentId: enrollment.id });
    let out = audio;
    if (audio.base64 && !audio.url && s.media.canPresign) {
      try {
        const key = `tts/narration/${sha256Hex(`${text}|${resolved.voice.voiceId}|${body.speed}`)}.${audio.encoding === 'mp3' ? 'mp3' : 'wav'}`;
        await s.media.put(key, base64ToBytes(audio.base64), audio.encoding === 'mp3' ? 'audio/mpeg' : 'audio/wav');
        out = { ...audio, url: await s.media.presignGet(key, 900), base64: null };
      } catch (error) {
        s.log.warn('tts.r2_store_failed', { error });
      }
    }
    return respondOk(c, NarrateResponseSchema.parse({ audio: out, capability: resolved.capability, language }));
  });

  define('modelCapabilities', {}, async (c) => {
    const query = parseQuery(c, ModelCapabilitiesApiQuerySchema);
    const s = c.get('services')!;
    const track = getCourseTrack(query.trackId);
    // Source language of the text-task profiles: the owned enrollment's (never a hard-coded 'en'), else an explicit
    // `source`, else none (variety/global scope only — stated in the notes rather than pretending the 'en' route applies).
    let source: SourceLanguageCode | null = query.source ?? null;
    let regionalOption: string | null = query.regionalOption ?? null;
    if (query.enrollmentId) {
      const enrollment = await loadOwnedEnrollment(s.requireUser().db, query.enrollmentId, { allowArchived: true });
      if (enrollment.course_track_id !== track.id) throw problem.validation(`Enrollment ${enrollment.id} is for ${enrollment.course_track_id}, not ${track.id}`);
      source = enrollment.source_language_code as SourceLanguageCode;
      regionalOption ??= enrollment.regional_preference;
    }
    const locale = providerLocaleFor(track.targetVarietyId, regionalOption);
    const profiles = await loadDbProfiles(s.service, s.log);
    const versionFor = (task: AiTaskName): number | null => {
      const candidates = profiles.profiles.filter((p) => p.task === task && p.enabled && (p.targetVariety === null || p.targetVariety === track.targetVarietyId));
      candidates.sort((a, b) => (b.targetVariety ? 1 : 0) - (a.targetVariety ? 1 : 0));
      return candidates[0]?.version ?? null;
    };
    const openRouter = Boolean(s.config.env.OPENROUTER_API_KEY);
    let ai: AiServices | null = null;
    if (openRouter) {
      try {
        ai = await s.ai();
      } catch {
        ai = null;
      }
    }
    // Effective routing = enabled `ai_model_profiles` row (admin override) or the package default for the task.
    const textCapability = (task: AiTaskName): Capability => {
      const effective = ai ? findTextProfile(ai, task, track.targetVarietyId, source) : null;
      if (!openRouter || !effective) return unsupportedCapability('openrouter', ['provider_disabled'], ['No enabled model profile for this task']);
      const dbVersion = versionFor(task);
      const scope = source ? `Resolved for source language ${source} (most specific enabled profile: ${effective.targetVariety ?? 'any variety'} × ${effective.sourceLanguage ?? 'any source'})` : 'Resolved at variety/global scope only: no enrollment or source given, so source-language-specific profiles are not reflected';
      return capabilityFromStatus({ provider: 'openrouter', status: effective.benchmarkStatus === 'passing' ? 'verified' : 'vendor_documented', effectiveLocale: locale, latencyClass: effective.latencyClass, notes: [dbVersion === null ? 'Routed by the package default profile (no enabled ai_model_profiles row yet)' : `Routed by ai_model_profiles v${dbVersion}`, scope] });
    };
    const tasks = await Promise.all(
      AI_TASK_NAME_VALUES.map(async (task) => {
        let capability: Capability;
        switch (task) {
          case 'speech_recognition':
            capability = ai ? ((await ai.registry.recognizerFor(locale))?.capability ?? unsupportedCapability('openrouter', ['locale_unsupported'])) : unsupportedCapability('openrouter', ['provider_disabled']);
            break;
          case 'speech_synthesis':
            capability = ai ? ((await ai.registry.synthesizerFor(locale))?.capability ?? unsupportedCapability('openrouter', ['voice_unsupported'])) : unsupportedCapability('openrouter', ['provider_disabled']);
            break;
          case 'realtime_conversation':
            capability = ai ? ((await ai.registry.realtimeFor(locale, true))?.capability ?? unsupportedCapability('pipeline_stt_llm_tts', ['provider_unavailable'])) : unsupportedCapability('pipeline_stt_llm_tts', ['provider_disabled']);
            break;
          case 'pronunciation_assessment':
            capability = ai ? await ai.assessor.capability(locale) : unsupportedCapability('composite', ['provider_disabled']);
            break;
          default:
            capability = textCapability(task);
        }
        return { task, capability, profileVersion: versionFor(task) };
      }),
    );
    const azure = Boolean(s.config.env.AZURE_SPEECH_KEY && s.config.env.AZURE_SPEECH_REGION);
    return respondOk(c, ModelCapabilitiesResponseSchema.parse({ trackId: track.id, targetVarietyId: track.targetVarietyId, tasks, pronunciationScoring: openRouter ? pronunciationScoringLevel(track.id, azure) : 'none', realtimeLatencyEstimateMs: null, checkedAt: new Date().toISOString() }), 200, { 'Cache-Control': 'private, max-age=60' });
  });
}

/** Where a language has several course varieties, the narrator speaks its most widely understood one. */
const NARRATOR_LOCALE_OVERRIDES: Partial<Record<SourceLanguageCode, string>> = { ar: 'ar', es: 'es-ES', pt: 'pt-BR', zh: 'zh-CN' };

/** The locale the narrator speaks for an instruction language (the first course of that language otherwise). */
export function narratorLocaleFor(language: SourceLanguageCode): string | null {
  return NARRATOR_LOCALE_OVERRIDES[language] ?? COURSE_TRACKS.find((t) => t.languageCode === language)?.defaultLocale ?? null;
}

/**
 * The voice for [locale]: the one asked for, else the one an admin chose for its variety (an enabled `speech_synthesis`
 * model profile of that variety with `params.voiceId`, set in the admin screen), else the registry's default. An admin
 * voice that does not belong to the variety is ignored (the registry refuses cross-variety voices).
 */
export function resolveVoiceWithAdminChoice(ai: AiServices, locale: string, requested: string | undefined, source: SourceLanguageCode): ReturnType<AiServices['synthesizer']['resolveVoice']> {
  if (requested) return ai.synthesizer.resolveVoice(locale, requested);
  const variety = resolveVariety(locale);
  const profile = variety ? ai.profiles.find({ task: 'speech_synthesis', targetVariety: variety, sourceLanguage: source }) : null;
  const chosen = profile && profile.resolvedSource === 'db' ? profile.params.voiceId : undefined;
  if (chosen) {
    const resolved = ai.synthesizer.resolveVoice(locale, chosen);
    if (resolved.voice && resolved.capability.supported) return resolved;
  }
  return ai.synthesizer.resolveVoice(locale);
}
