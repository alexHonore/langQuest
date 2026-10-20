/**
 * AI models test harness (§8.7, R-4.3-01). Formerly a local Next route handler that called OpenRouter from the admin
 * host with its own key; the probe now runs inside the Worker, behind the `admin` role gate, through the same AI
 * wiring every learner call uses (`RequestServices.ai()`): no provider key ever sits on the admin host.
 *
 * - `prompt`: `TextReasoner.generateStructured` for the chosen text task — the per-task model registry resolves the
 *   profile for (task, variety, source) and the requested model is tried first (`modelOverride`), with the profile's
 *   chain as fallback. The response names that chain, not the model that answered. The probe's spend is ledgered in
 *   `ai_requests` through `staffReasoner` (no enrollment, attributed to the admin, `redacted_log.purpose =
 *   'admin_model_test'`), so the response's `traceId` matches the probe's row(s).
 * - `synthesize`: the per-variety voice registry (`OpenRouterSpeechSynthesizer`), variety boundary enforced.
 * - `transcribe`: the per-variety STT route (`OpenRouterSpeechRecognizer`).
 * Unsupported varieties answer `capability_unsupported` with the capability reasons; nothing is substituted.
 * The speech probes are ledgered exactly like the prompt probe: `staffSynthesizer` / `staffRecognizer` rebuild the
 * request's adapter on the same OpenRouter client (and TTS cache) with the `staffLedgerSink`, so their `ai_requests`
 * rows carry no enrollment, the admin as `user_id` and `redacted_log.purpose = 'admin_model_test'` /
 * `redacted_log.actor = 'staff'`: analytics counts them in `staffAndJobsUsd`, never in `unattributedUsd`.
 */
import type { AiServices } from '@langquest/ai';
import { ModelProfileRegistry } from '@langquest/ai/profiles';
import { OpenRouterTextReasoner, type AiRequestSink } from '@langquest/ai/reasoner';
import { OpenRouterSpeechRecognizer } from '@langquest/ai/speech/stt';
import { OpenRouterSpeechSynthesizer } from '@langquest/ai/speech/tts';
import { base64ToBytes, bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import { ModelTestRequestSchema, ModelTestResponseSchema, buildLanguageContext, tracksForVariety, type AudioEncoding, type Capability, type TextReasoner, type VarietyId } from '@langquest/contracts';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody } from '../../http/validate';
import { createTtsCache, loadDbProfiles } from '../../services/ai';
import type { RequestServices } from '../../services/context';
import { createAiRequestSink } from '../../services/telemetry';

/** Why a staff member spent on AI (`ai_requests.redacted_log.purpose`). */
export type StaffAiPurpose = 'admin_model_test' | 'admin_smoke_test';

/**
 * Ledger attribution for staff AI calls (R-5.4-03). A probe or smoke test runs outside any learner enrollment; its
 * language context carries a placeholder uuid only because `LanguageContext.enrollmentId` is required, and the
 * reasoner copies that placeholder into the record. It is not a `user_course_enrollments` row, so the row would fail
 * the `ai_requests.enrollment_id` foreign key and take the whole telemetry batch down with it. Staff rows are
 * therefore written with `enrollment_id = null` (the column is nullable; no migration), attributed to the staff actor
 * through `user_id` (an `auth.users` id, like the speech probes' rows) and tagged `redacted_log.purpose` /
 * `redacted_log.actor = 'staff'` so cost reports can tell admin spend from learner traffic.
 */
export function staffLedgerSink(inner: AiRequestSink, actor: { userId: string; purpose: StaffAiPurpose }): AiRequestSink {
  return { record: (entry) => inner.record({ ...entry, userId: actor.userId, enrollmentId: null, redactedLog: { ...(entry.redactedLog ?? {}), purpose: actor.purpose, actor: 'staff' } }) };
}

/** The `ai_requests` sink of a staff call (the request's sink wrapped in `staffLedgerSink`); null without a signed-in actor. */
async function staffSink(s: RequestServices, purpose: StaffAiPurpose): Promise<AiRequestSink | null> {
  const userId = s.principal?.userId ?? null;
  if (!userId) return null;
  const loaded = await loadDbProfiles(s.service, s.log);
  const sink = createAiRequestSink({ service: s.service, log: s.log, waitUntil: (p) => s.waitUntil(p), knownProfileIds: () => loaded.ids, defaultUserId: userId });
  return staffLedgerSink(sink, { userId, purpose });
}

/**
 * The text reasoner for a staff probe: the request's OpenRouter reasoner rebuilt on the same client and profile
 * registry (same routing, pricing and fallbacks), writing its ledger rows through `staffLedgerSink`. A reasoner that
 * is not the OpenRouter one (an injected test double) is returned unchanged: it writes no ledger rows of its own.
 */
export async function staffReasoner(s: RequestServices, ai: AiServices, purpose: StaffAiPurpose): Promise<TextReasoner> {
  if (!(ai.reasoner instanceof OpenRouterTextReasoner)) return ai.reasoner;
  const sink = await staffSink(s, purpose);
  return sink ? new OpenRouterTextReasoner({ client: ai.client, profiles: ai.profiles, sink }) : ai.reasoner;
}

/**
 * The speech synthesizer for a staff probe: the request's OpenRouter synthesizer rebuilt on the same client and the
 * same R2 TTS cache (voices, variety boundary and pricing unchanged), writing its ledger rows through
 * `staffLedgerSink`. Anything else (an injected test double) is returned unchanged.
 */
export async function staffSynthesizer(s: RequestServices, ai: AiServices, purpose: StaffAiPurpose): Promise<AiServices['synthesizer']> {
  if (!(ai.synthesizer instanceof OpenRouterSpeechSynthesizer)) return ai.synthesizer;
  const sink = await staffSink(s, purpose);
  return sink ? new OpenRouterSpeechSynthesizer({ client: ai.client, sink, cache: createTtsCache(s.media, s.log) }) : ai.synthesizer;
}

/**
 * The speech recognizer for a staff probe: the request's OpenRouter recognizer rebuilt on the same client (per-variety
 * STT models and language hints unchanged), writing its ledger rows through `staffLedgerSink`. The probe sends inline
 * audio only, so no asset resolver is needed. Anything else (an injected test double) is returned unchanged.
 */
export async function staffRecognizer(s: RequestServices, ai: AiServices, purpose: StaffAiPurpose): Promise<AiServices['recognizer']> {
  if (!(ai.recognizer instanceof OpenRouterSpeechRecognizer)) return ai.recognizer;
  const sink = await staffSink(s, purpose);
  return sink ? new OpenRouterSpeechRecognizer({ client: ai.client, sink }) : ai.recognizer;
}

/** Inline audio for transcription probes is capped by `AudioInputSchema` (8 MB of base64). */
export const MODEL_TEST_BODY_LIMIT_BYTES = 12 * 1024 * 1024;
const PROMPT_TIMEOUT_MS = 45_000;
const ReplySchema = z.object({ reply: z.string().min(1).max(8000) });
const DEFAULT_SYSTEM = 'You are a model being evaluated from the LangQuest Studio test harness. Answer the user message directly.';

const MIME_BY_ENCODING: Readonly<Record<AudioEncoding, string>> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  opus: 'audio/ogg',
  webm_opus: 'audio/webm',
  pcm16: 'audio/wav',
};

const unsupported = (what: string, variety: VarietyId, capability: Capability) => problem.unsupported(`${what} is not available for ${variety}: ${capability.reasons.join(', ') || 'unsupported'}`, { reasons: capability.reasons, notes: capability.notes });
const noteValue = (capability: Capability, key: string): string | null => capability.notes.find((n) => n.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;

export function registerModelTestRoutes(define: DefineRoute): void {
  define('adminModelTest', { role: 'admin', rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: MODEL_TEST_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const body = await parseBody(c, ModelTestRequestSchema);
    const s = c.get('services')!;
    s.requireUser();
    const ai = await s.ai();
    const traceId = crypto.randomUUID();
    const started = Date.now();

    if (body.mode === 'prompt') {
      // A probe runs for a real course variety; nothing falls back to another one (no variety substitution).
      const track = tracksForVariety(body.targetVariety)[0];
      if (!track) throw problem.validation(`No course track uses variety ${body.targetVariety}`);
      // Placeholder enrollment id (the context requires one); `staffReasoner` never writes it to the ledger.
      const language = buildLanguageContext({ uiLocale: 'en', enrollmentId: crypto.randomUUID(), sourceLanguageCode: body.sourceLanguage, courseTrackId: track.id });
      if (language.targetVariety !== body.targetVariety) throw problem.validation(`Variety ${body.targetVariety} resolves to ${language.targetVariety}; choose the course variety itself`);
      const profile = ai.profiles.resolve({ task: body.task, targetVariety: language.targetVariety, sourceLanguage: language.sourceLanguage });
      const modelChain = ModelProfileRegistry.modelChain(profile, body.model);
      const reasoner = await staffReasoner(s, ai, 'admin_model_test');
      const out = await reasoner.generateStructured(
        body.task,
        language,
        { system: `${body.system?.trim() || DEFAULT_SYSTEM}\n\nPut your whole answer in the "reply" field of the JSON object.`, user: body.prompt, templateId: 'admin.model_test', templateVersion: '2026-10-20.1' },
        ReplySchema,
        { modelOverride: body.model, timeoutMs: PROMPT_TIMEOUT_MS, traceId },
      );
      return respondOk(c, ModelTestResponseSchema.parse({ mode: 'prompt', task: body.task, targetVariety: body.targetVariety, sourceLanguage: body.sourceLanguage, requestedModel: body.model, modelChain, content: out.reply, latencyMs: Date.now() - started, traceId }));
    }

    if (body.mode === 'synthesize') {
      // Staff-tagged ledger rows (`staffSynthesizer`), like the prompt probe: never unattributed spend.
      const synthesizer = await staffSynthesizer(s, ai, 'admin_model_test');
      const capability = await synthesizer.supports(body.targetVariety, body.voiceId);
      if (!capability.supported) throw unsupported('Speech synthesis', body.targetVariety, capability);
      const audio = await synthesizer.synthesize(body.text, body.targetVariety, body.voiceId ?? '', { traceId });
      if (!audio.base64) throw problem.provider('The speech provider returned no audio. Please retry.');
      const audioBase64 = audio.encoding === 'pcm16' ? bytesToBase64(pcm16ToWav(base64ToBytes(audio.base64), audio.sampleRateHz)) : audio.base64;
      return respondOk(c, ModelTestResponseSchema.parse({ mode: 'synthesize', targetVariety: body.targetVariety, voiceId: audio.voiceId, model: noteValue(capability, 'model'), mimeType: MIME_BY_ENCODING[audio.encoding], audioBase64, durationMs: audio.durationMs, latencyMs: Date.now() - started, cached: audio.cached, synthetic: true, traceId }));
    }

    // Staff-tagged ledger rows (`staffRecognizer`), like the prompt probe: never unattributed spend.
    const recognizer = await staffRecognizer(s, ai, 'admin_model_test');
    const capability = await recognizer.supports(body.targetVariety);
    if (!capability.supported) throw unsupported('Speech recognition', body.targetVariety, capability);
    const transcript = await recognizer.transcribe({ source: 'inline', base64: body.audioBase64, encoding: body.encoding, sampleRateHz: null }, body.targetVariety, { traceId });
    return respondOk(
      c,
      ModelTestResponseSchema.parse({
        mode: 'transcribe',
        targetVariety: body.targetVariety,
        text: transcript.text,
        detectedLanguage: transcript.detectedLanguage?.code ?? null,
        confidence: transcript.confidence,
        durationMs: transcript.durationMs,
        languageMismatch: transcript.languageMismatch,
        model: transcript.model,
        segments: transcript.segments.slice(0, 50).map((seg) => ({ index: seg.index, text: seg.text, startMs: seg.startMs, endMs: seg.endMs })),
        latencyMs: Date.now() - started,
        traceId,
      }),
    );
  });
}
