/**
 * @langquest/ai — OpenRouter `TextReasoner`, STT/TTS/realtime/pronunciation adapters, capability registry,
 * model profiles, conversation orchestration (character agent + evaluator), prompt packs and semantic scoring.
 *
 * Entry point: `createAiServices(env, deps)`.
 */
import { type AiEnv, readAiEnv } from './env';
import { OpenRouterClient, type AiLogger, silentLogger } from './openrouter/client';
import { PricingTable } from './openrouter/pricing';
import { ModelProfileRegistry, type ProfileLoader } from './profiles';
import { OpenRouterTextReasoner, type AiAttributionSource, type AiRequestSink } from './reasoner';
import { DefaultCapabilityRegistry } from './capability/registry';
import { OpenRouterSpeechRecognizer } from './speech/stt';
import { OpenRouterSpeechSynthesizer, type TtsCache } from './speech/tts';
import { AzurePronunciationAssessor, CompositeAssessor, ReferenceComparisonAssessor, type ReferenceAudioResolver } from './speech/pronunciation';
import type { AudioAssetResolver } from './speech/audio-input';
import { LlmPronunciationJudge } from './speech/pronunciation-judge';
import { PipelineRealtimeProvider } from './realtime/pipeline';
import { DuplexProviderStub } from './realtime/duplex-stub';
import { CharacterAgent } from './conversation/character-agent';
import { Evaluator } from './conversation/evaluator';
import { SessionSummariser } from './conversation/summariser';
import { LanguageGuard, type QualityIncidentSink } from './prompts/language-guard';
import { MeaningMatcher } from './semantic/meaning';
import type { RealtimeConversationProvider } from '@langquest/contracts';

export * from './env';
export * from './errors';
export * from './util';
export * from './openrouter/client';
export * from './openrouter/pricing';
export * from './openrouter/redact';
export * from './reasoner';
export * from './profiles';
export * from './capability/azure-locales';
export * from './capability/matrix';
export * from './capability/registry';
export * from './speech/audio-input';
export * from './speech/voices';
export * from './speech/stt';
export * from './speech/tts';
export * from './speech/pronunciation';
export * from './speech/pronunciation-judge';
export * from './realtime/tickets';
export * from './realtime/pipeline';
export * from './realtime/duplex-stub';
export * from './conversation/machine';
export * from './conversation/character-agent';
export * from './conversation/evaluator';
export * from './conversation/summariser';
export * from './prompts/packs';
export * from './prompts/builders';
export * from './prompts/language-guard';
export * from './semantic/meaning';

export interface AiServiceDeps {
  fetch?: typeof fetch;
  logger?: AiLogger;
  /** `ai_requests` ledger writer (API provides a Supabase-backed one). */
  requestSink?: AiRequestSink;
  incidentSink?: QualityIncidentSink;
  /** Overlay `ai_model_profiles` rows; applied once at creation (call `profiles.refresh()` to reload). */
  profileLoader?: ProfileLoader;
  assetResolver?: AudioAssetResolver;
  ttsCache?: TtsCache;
  referenceAudio?: ReferenceAudioResolver;
  /** A real full-duplex provider, when one is integrated; otherwise the stub honestly reports unsupported. */
  duplexProvider?: RealtimeConversationProvider;
  pricing?: PricingTable;
  /** Pseudonymous user hash for provider abuse monitoring (never an e-mail). */
  userHash?: string | null;
  /**
   * Attribution written to `ai_requests` rows by every adapter (learner `userId`, DB `profileId`, `enrollmentId`).
   * Omit to keep rows pseudonymous (`userId: null`).
   */
  attribution?: AiAttributionSource | null;
}

export interface AiServices {
  env: AiEnv;
  client: OpenRouterClient;
  pricing: PricingTable;
  profiles: ModelProfileRegistry;
  reasoner: OpenRouterTextReasoner;
  guard: LanguageGuard;
  recognizer: OpenRouterSpeechRecognizer;
  synthesizer: OpenRouterSpeechSynthesizer;
  azureAssessor: AzurePronunciationAssessor;
  referenceAssessor: ReferenceComparisonAssessor;
  assessor: CompositeAssessor;
  pipeline: PipelineRealtimeProvider;
  duplex: DuplexProviderStub;
  registry: DefaultCapabilityRegistry;
  characterAgent: CharacterAgent;
  evaluator: Evaluator;
  summariser: SessionSummariser;
  meaning: MeaningMatcher;
  /** AI pronunciation feedback: a listening model's estimate (never an acoustic score, never mastery evidence). */
  pronunciationJudge: LlmPronunciationJudge;
}

/** Wire every adapter from environment + injected dependencies. Safe for Workers and Node. */
export async function createAiServices(envSource: AiEnv | Record<string, string | undefined>, deps: AiServiceDeps = {}): Promise<AiServices> {
  const env = readAiEnv(envSource as Record<string, string | undefined>);
  const logger = deps.logger ?? silentLogger;
  const pricing = deps.pricing ?? new PricingTable();
  const client = new OpenRouterClient({ apiKey: env.OPENROUTER_API_KEY, baseUrl: env.OPENROUTER_BASE_URL, fetch: deps.fetch, logger, pricing, appName: env.AI_APP_NAME, referer: env.AI_APP_REFERER });
  const profiles = new ModelProfileRegistry();
  if (deps.profileLoader) await profiles.refresh(deps.profileLoader);
  const attribution = deps.attribution ?? null;
  const reasoner = new OpenRouterTextReasoner({ client, profiles, sink: deps.requestSink, userHash: deps.userHash ?? null, attribution });
  const guard = new LanguageGuard({ reasoner, incidents: deps.incidentSink ?? null });
  const recognizer = new OpenRouterSpeechRecognizer({ client, sink: deps.requestSink, assetResolver: deps.assetResolver, fetch: deps.fetch, attribution });
  const synthesizer = new OpenRouterSpeechSynthesizer({ client, sink: deps.requestSink, cache: deps.ttsCache, attribution });
  const azureAssessor = new AzurePronunciationAssessor({ key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION, fetch: deps.fetch, assetResolver: deps.assetResolver, sink: deps.requestSink, attribution });
  const referenceAssessor = new ReferenceComparisonAssessor({ recognizer, referenceAudio: deps.referenceAudio });
  const assessor = new CompositeAssessor([azureAssessor], referenceAssessor);
  const characterAgent = new CharacterAgent({ reasoner, guard });
  let ticketSecret = env.AI_SESSION_TICKET_SECRET;
  if (!ticketSecret) {
    ticketSecret = crypto.randomUUID() + crypto.randomUUID();
    logger.warn('ai.tickets.ephemeral_secret', { message: 'AI_SESSION_TICKET_SECRET not set; session tickets will not survive a restart' });
  }
  const connectTemplate = env.AI_REALTIME_CONNECT_URL;
  const pipeline = new PipelineRealtimeProvider({ recognizer, synthesizer, characterAgent, ticketSecret, connectUrl: (sessionId) => (connectTemplate ? connectTemplate.replace('{sessionId}', sessionId) : null) });
  const duplex = new DuplexProviderStub({ delegate: deps.duplexProvider ?? null });
  const registry = new DefaultCapabilityRegistry({ recognizers: [recognizer], synthesizers: [synthesizer], realtime: [duplex, pipeline], assessors: [azureAssessor, referenceAssessor] });
  return {
    env,
    client,
    pricing,
    profiles,
    reasoner,
    guard,
    recognizer,
    synthesizer,
    azureAssessor,
    referenceAssessor,
    assessor,
    pipeline,
    duplex,
    registry,
    characterAgent,
    evaluator: new Evaluator({ reasoner }),
    summariser: new SessionSummariser(reasoner),
    meaning: new MeaningMatcher({ reasoner }),
    pronunciationJudge: new LlmPronunciationJudge({ client, sink: deps.requestSink ?? null, attribution, profiles }),
  };
}
