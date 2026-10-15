/**
 * §6.2 speech routes: transcription, pronunciation assessment, synthesis and per-track model capabilities.
 *
 * Capability-aware by construction (§8.2, §8.5, §15): the registry decides which adapter may serve a
 * variety and fallbacks never cross a dialect boundary; a numeric pronunciation score exists only when an
 * acoustic assessor produced it (the contracts schema enforces it), otherwise the learner gets reference
 * comparison + honest coarse feedback. Approved content only: synthesis accepts expression ids or text the
 * server itself generated for a character turn; pronunciation references must be published expressions.
 */
import type { AiServices } from '@langquest/ai';
import { providerLocaleFor, capabilityFromStatus } from '@langquest/ai/capability/registry';
import { base64ToBytes } from '@langquest/ai/util';
import { AI_TASK_NAME_VALUES, ModelCapabilitiesQuerySchema, ModelCapabilitiesResponseSchema, PronunciationAssessRequestSchema, PronunciationAssessResponseSchema, SynthesizeRequestSchema, SynthesizeResponseSchema, TranscribeRequestSchema, TranscribeResponseSchema, getCourseTrack, isAcousticAssessmentMode, unsupportedCapability, type AiTaskName, type Capability, type SkillObservationInput, type SpeechEvaluationResult } from '@langquest/contracts';
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

const PRONUNCIATION_SCORER_VERSION = 'speech-route@2026-10-14.1';

/** Persist a learner recording (inline audio) under the learner's retention preference; null when not retained. */
async function retainRecording(s: RequestServices, enrollment: EnrollmentRow, audio: { base64: string; encoding: string }, userId: string): Promise<string | null> {
  const { repos } = s.requireUser();
  const profile = await repos.profiles.getByUserId(userId);
  const retention = parsePrivacy(profile?.privacy_options).store_speech_recordings;
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

const intelligibilityOf = (matched: boolean, confidence: number, needsClarification: boolean, transcript: string | null): SpeechEvaluationResult['intelligibility'] => {
  if (!transcript || transcript.trim() === '') return 'no_speech_detected';
  if (matched) return 'understood';
  if (needsClarification || confidence >= 0.3) return 'partially_understood';
  return 'not_understood';
};

export function registerSpeechRoutes(define: DefineRoute): void {
  define('speechTranscribe', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, TranscribeRequestSchema);
    const s = c.get('services')!;
    const { db, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    const ai = await s.ai();
    const locale = providerLocaleFor(body.targetVarietyId, enrollment.regional_preference);
    const pick = await ai.registry.recognizerFor(locale);
    if (!pick) throw problem.unsupported(`Speech recognition is not available for ${body.targetVarietyId} yet`, { capability: unsupportedCapability('openrouter', ['locale_unsupported']) });
    const transcript = await ai.recognizer.transcribe(body.audio, locale, { traceId: s.requestId, enrollmentId: enrollment.id });
    const recordingAssetId = body.audio.source === 'inline' ? await retainRecording(s, enrollment, body.audio, principal.userId) : null;
    return respondOk(c, TranscribeResponseSchema.parse({ transcript, capability: pick.capability, recordingAssetId }));
  });

  define('speechPronunciationAssess', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, PronunciationAssessRequestSchema);
    const s = c.get('services')!;
    const { db, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    assertVarietyMatches(enrollment, body.targetVarietyId);
    const reference = await resolveReference(s, enrollment, { expressionId: body.expressionId, referenceText: body.referenceText });
    const ai = await s.ai();
    const locale = providerLocaleFor(body.targetVarietyId, enrollment.regional_preference);
    const language = languageContextFor(enrollment, await loadUiLocale(db, principal.userId));
    const result = await ai.assessor.assess({ audio: body.audio, targetVarietyId: body.targetVarietyId, locale, referenceText: reference.text, referencePhonemes: null, expressionId: reference.expressionId, requestedFeatures: body.requestedFeatures });
    const transcriptText = result.transcript?.text ?? null;
    const meaning = transcriptText && transcriptText.trim() ? await ai.meaning.score({ utterance: transcriptText, references: [{ text: reference.text, intentId: reference.expressionId ?? undefined }], language, utteranceConfidence: result.transcript?.confidence ?? null }) : { matched: false, confidence: 0, matchedIntentIds: [], method: 'deterministic' as const, deterministicScore: 0, paraphrase: false, reason: 'no_transcript', needsClarification: true };
    const intelligibility = intelligibilityOf(meaning.matched, meaning.confidence, meaning.needsClarification, transcriptText);
    const assessmentId = crypto.randomUUID();
    const evaluation = PronunciationAssessResponseSchema.parse({
      assessmentId,
      targetVarietyId: body.targetVarietyId,
      semanticIntentMatched: meaning.matched,
      meaningConfidence: meaning.confidence,
      intelligibility,
      pronunciation: result.pronunciation,
      shouldAdvanceConversation: meaning.matched || (intelligibility === 'partially_understood' && meaning.confidence >= 0.5),
      transcript: transcriptText,
      matchedIntentIds: meaning.matchedIntentIds,
    });
    // Evidence (A14): meaning and pronunciation are separate observations; pronunciation only counts with an acoustic scorer.
    const scenarioId = body.scenarioId ?? reference.expressionId ?? 'pronunciation';
    const observations: SkillObservationInput[] = [];
    const semanticSkill = 'speaking.intelligibility';
    observations.push({ enrollmentId: enrollment.id, skillKey: semanticSkill, observationType: 'semantic_success', scenarioId, missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: reference.expressionId, autonomy: 'unaided', hintsUsed: 0, outcome: meaning.needsClarification ? 'unclear' : meaning.matched ? 'success' : 'fail', utteranceConfidence: result.transcript?.confidence ?? null, scorerKind: meaning.method === 'deterministic' ? 'deterministic' : 'llm_evaluator', scorerVersion: PRONUNCIATION_SCORER_VERSION, uncertainty: meaning.needsClarification ? 0.9 : 1 - meaning.confidence, observedAt: new Date().toISOString(), note: null });
    if (isAcousticAssessmentMode(result.pronunciation.assessmentMode) && result.pronunciation.numericScore !== null) {
      observations.push({ enrollmentId: enrollment.id, skillKey: 'speaking.pronunciation', observationType: 'pronunciation', scenarioId, missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: reference.expressionId, autonomy: 'unaided', hintsUsed: 0, outcome: result.pronunciation.numericScore >= 70 ? 'success' : result.pronunciation.numericScore >= 45 ? 'partial' : 'fail', utteranceConfidence: result.transcript?.confidence ?? null, scorerKind: 'acoustic_assessor', scorerVersion: result.pronunciation.scorerVersion ?? result.pronunciation.provider ?? 'acoustic', uncertainty: 0.3, observedAt: new Date().toISOString(), note: null });
    }
    s.waitUntil(recordObservations(s, enrollment, observations, new Date().toISOString()).then(() => undefined));
    return respondOk(c, evaluation);
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
    const resolved = ai.synthesizer.resolveVoice(locale, body.voiceId);
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

  define('modelCapabilities', {}, async (c) => {
    const query = parseQuery(c, ModelCapabilitiesQuerySchema);
    const s = c.get('services')!;
    const track = getCourseTrack(query.trackId);
    const locale = providerLocaleFor(track.targetVarietyId, query.regionalOption ?? null);
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
      // No enrollment here: source-language-specific overrides are not considered (variety + global scope only).
      const effective = ai ? ai.profiles.find({ task, targetVariety: track.targetVarietyId, sourceLanguage: 'en' }) : null;
      if (!openRouter || !effective) return unsupportedCapability('openrouter', ['provider_disabled'], ['No enabled model profile for this task']);
      const dbVersion = versionFor(task);
      return capabilityFromStatus({ provider: 'openrouter', status: effective.benchmarkStatus === 'passing' ? 'verified' : 'vendor_documented', effectiveLocale: locale, latencyClass: effective.latencyClass, notes: [dbVersion === null ? 'Routed by the package default profile (no enabled ai_model_profiles row yet)' : `Routed by ai_model_profiles v${dbVersion}`] });
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
