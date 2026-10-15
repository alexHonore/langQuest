/**
 * Typed telemetry event constructors (§12.2) on top of the schemas in `@langquest/contracts`.
 *
 * Every constructor:
 *  - stamps the shared base fields from a {@link TelemetryContext} (platform, pseudonymous ids,
 *    enrollment/track/source language, privacy level),
 *  - redacts every free-text string in `props` (emails, phone numbers, secrets, long text → hash),
 *  - validates the result with the contract schema, so a malformed event throws at the call site
 *    instead of poisoning a batch downstream.
 */
import {
  AiCostTelemetry,
  AiLatencyTelemetry,
  ApiErrorTelemetry,
  AppStartTelemetry,
  AudioPlaybackTelemetry,
  ClientCrashTelemetry,
  ConversationFunnelTelemetry,
  EnrollmentSourceChangedTelemetry,
  ImageLoadTelemetry,
  JobCostTelemetry,
  MascotPreferenceTelemetry,
  MediaFailureTelemetry,
  MediaStartTelemetry,
  MissionCompletedTelemetry,
  OnboardingStepTelemetry,
  PronunciationFeedbackTelemetry,
  ProviderFailureTelemetry,
  ReviewRecallTelemetry,
  ScreenViewTelemetry,
  SkillStateChangedTelemetry,
  SpeakingTimeTelemetry,
  SttQualityTelemetry,
  StorageOpsTelemetry,
  TelemetryEventSchema,
  TransferSuccessTelemetry,
  type LanguageContext,
  type Platform,
  type PrivacyLevel,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryEventOf,
} from '@langquest/contracts';
import type { z } from 'zod';
import { redactDeep, type RedactTextOptions } from './privacy';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type BaseFields = Omit<TelemetryEvent, 'name' | 'category' | 'props' | 'eventId' | 'occurredAt'>;

/** Shared base fields plus injectable clock / id source (handy for tests and deterministic replay). */
export interface TelemetryContext extends BaseFields {
  /** ISO timestamp source. Defaults to `new Date().toISOString()`. */
  now?: () => string;
  /** UUID v4 source. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
  /** Redaction tuning applied to every `props` string. */
  redaction?: RedactTextOptions;
}

export interface TelemetryContextInit extends Partial<BaseFields> {
  platform: Platform;
  appVersion: string;
  now?: () => string;
  newId?: () => string;
  redaction?: RedactTextOptions;
}

/** RFC 4122 v4 UUID using Web Crypto when available (Node ≥ 19, Workers, modern RN runtimes). */
export function defaultIdGenerator(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Build a context with safe defaults: no identifiers and `privacyLevel: 'anonymous'` unless
 * provided. Pass the output of `pseudonymizeLearnerId` as `userHash`; never a raw user id.
 */
export function createTelemetryContext(init: TelemetryContextInit): TelemetryContext {
  const ctx: TelemetryContext = {
    platform: init.platform,
    appVersion: init.appVersion,
    sessionId: init.sessionId ?? null,
    userHash: init.userHash ?? null,
    enrollmentId: init.enrollmentId ?? null,
    trackId: init.trackId ?? null,
    targetVarietyId: init.targetVarietyId ?? null,
    sourceLanguageCode: init.sourceLanguageCode ?? null,
    privacyLevel: init.privacyLevel ?? 'anonymous',
  };
  if (init.now) ctx.now = init.now;
  if (init.newId) ctx.newId = init.newId;
  if (init.redaction) ctx.redaction = init.redaction;
  return ctx;
}

/**
 * Derive a context bound to an enrollment from its `LanguageContext`: enrollment, track, variety
 * and the enrollment's own source language (never a profile default).
 */
export function withLanguageContext(ctx: TelemetryContext, lc: LanguageContext): TelemetryContext {
  return { ...ctx, enrollmentId: lc.enrollmentId, trackId: lc.targetTrack, targetVarietyId: lc.targetVariety, sourceLanguageCode: lc.sourceLanguage };
}

/** Return a copy of the context with a different privacy level. */
export function withPrivacyLevel(ctx: TelemetryContext, privacyLevel: PrivacyLevel): TelemetryContext {
  return { ...ctx, privacyLevel };
}

// ---------------------------------------------------------------------------
// Generic constructor
// ---------------------------------------------------------------------------

export type EventProps<N extends TelemetryEventName> = TelemetryEventOf<N>['props'];

/** Per-event overrides of the base fields (e.g. a one-off `privacyLevel` or `occurredAt`). */
export type EventOverrides = Partial<Pick<TelemetryEvent, 'eventId' | 'occurredAt' | 'privacyLevel' | 'enrollmentId' | 'trackId' | 'targetVarietyId' | 'sourceLanguageCode' | 'sessionId' | 'userHash'>>;

function build(schema: z.ZodType, name: TelemetryEventName, category: TelemetryEvent['category'], ctx: TelemetryContext, props: unknown, overrides: EventOverrides = {}): unknown {
  const { now, newId, redaction, ...base } = ctx;
  return schema.parse({
    ...base,
    ...overrides,
    eventId: overrides.eventId ?? (newId ?? defaultIdGenerator)(),
    occurredAt: overrides.occurredAt ?? (now ? now() : new Date().toISOString()),
    name,
    category,
    props: redactDeep(props, redaction),
  });
}

/** Build any event by name; mostly useful for generic pipelines and tests. */
export function createTelemetryEvent<N extends TelemetryEventName>(ctx: TelemetryContext, name: N, props: EventProps<N>, overrides?: EventOverrides): TelemetryEventOf<N> {
  return TelemetryEventSchema.parse(build(SCHEMAS[name], name, CATEGORIES[name], ctx, props, overrides)) as TelemetryEventOf<N>;
}

const SCHEMAS = {
  mission_completed: MissionCompletedTelemetry,
  review_recall: ReviewRecallTelemetry,
  skill_state_changed: SkillStateChangedTelemetry,
  speaking_time: SpeakingTimeTelemetry,
  pronunciation_feedback: PronunciationFeedbackTelemetry,
  transfer_success: TransferSuccessTelemetry,
  onboarding_step: OnboardingStepTelemetry,
  enrollment_source_changed: EnrollmentSourceChangedTelemetry,
  screen_view: ScreenViewTelemetry,
  mascot_preference: MascotPreferenceTelemetry,
  audio_playback: AudioPlaybackTelemetry,
  conversation_funnel: ConversationFunnelTelemetry,
  app_start: AppStartTelemetry,
  media_start: MediaStartTelemetry,
  ai_latency: AiLatencyTelemetry,
  stt_quality: SttQualityTelemetry,
  image_load: ImageLoadTelemetry,
  ai_cost: AiCostTelemetry,
  storage_ops: StorageOpsTelemetry,
  job_cost: JobCostTelemetry,
  api_error: ApiErrorTelemetry,
  provider_failure: ProviderFailureTelemetry,
  media_failure: MediaFailureTelemetry,
  client_crash: ClientCrashTelemetry,
} as const satisfies Record<TelemetryEventName, z.ZodType>;

const CATEGORIES = {
  mission_completed: 'learning_outcome',
  review_recall: 'learning_outcome',
  skill_state_changed: 'learning_outcome',
  speaking_time: 'learning_outcome',
  pronunciation_feedback: 'learning_outcome',
  transfer_success: 'learning_outcome',
  onboarding_step: 'ux_funnel',
  enrollment_source_changed: 'ux_funnel',
  screen_view: 'ux_funnel',
  mascot_preference: 'ux_funnel',
  audio_playback: 'ux_funnel',
  conversation_funnel: 'ux_funnel',
  app_start: 'performance',
  media_start: 'performance',
  ai_latency: 'performance',
  stt_quality: 'performance',
  image_load: 'performance',
  ai_cost: 'cost',
  storage_ops: 'cost',
  job_cost: 'cost',
  api_error: 'error',
  provider_failure: 'error',
  media_failure: 'error',
  client_crash: 'error',
} as const satisfies Record<TelemetryEventName, TelemetryEvent['category']>;

/** Category of a telemetry event name. */
export function categoryOf<N extends TelemetryEventName>(name: N): (typeof CATEGORIES)[N] {
  return CATEGORIES[name];
}

/** Event names grouped by category (stable order). */
export const EVENT_NAMES_BY_CATEGORY: Readonly<Record<TelemetryEvent['category'], readonly TelemetryEventName[]>> = {
  learning_outcome: ['mission_completed', 'review_recall', 'skill_state_changed', 'speaking_time', 'pronunciation_feedback', 'transfer_success'],
  ux_funnel: ['onboarding_step', 'enrollment_source_changed', 'screen_view', 'mascot_preference', 'audio_playback', 'conversation_funnel'],
  performance: ['app_start', 'media_start', 'ai_latency', 'stt_quality', 'image_load'],
  cost: ['ai_cost', 'storage_ops', 'job_cost'],
  error: ['api_error', 'provider_failure', 'media_failure', 'client_crash'],
};

type Ctor<N extends TelemetryEventName> = (ctx: TelemetryContext, props: EventProps<N>, overrides?: EventOverrides) => TelemetryEventOf<N>;
const ctor = <N extends TelemetryEventName>(name: N): Ctor<N> => (ctx, props, overrides) => createTelemetryEvent(ctx, name, props, overrides);

// ---------------------------------------------------------------------------
// Learning outcomes (§12.2 "Learning")
// ---------------------------------------------------------------------------

/** Mission finished; `withoutHints` is the can-do KPI (completion without hints). */
export const missionCompleted = ctor('mission_completed');
/** Spaced-review recall; use {@link recallBucket} on `intervalDays` for the 7/30-day KPIs. */
export const reviewRecall = ctor('review_recall');
export const skillStateChanged = ctor('skill_state_changed');
/** Actual active speaking time (secondary KPI). */
export const speakingTime = ctor('speaking_time');
/**
 * Pronunciation feedback shown to the learner. `learnerFlaggedFalseCorrection` is the
 * false-correction KPI by target language; `numericScorePresent` must only be true when
 * `assessmentMode` is acoustic (the contract refinement is enforced upstream).
 */
export const pronunciationFeedback = ctor('pronunciation_feedback');
/** Skill transferred to an unseen scenario. */
export const transferSuccess = ctor('transfer_success');

/** Recall KPIs are reported at the 7-day and 30-day horizons (§12.2). */
export const RECALL_HORIZONS_DAYS = [7, 30] as const;
export type RecallBucket = '7d' | '30d' | 'other';

/**
 * Map a review interval to the KPI horizon it counts towards. A review counts for a horizon
 * when the interval lands within ±20% of it (7d: 5.6–8.4, 30d: 24–36 days).
 */
export function recallBucket(intervalDays: number): RecallBucket {
  for (const h of RECALL_HORIZONS_DAYS) {
    if (intervalDays >= h * 0.8 && intervalDays <= h * 1.2) return `${h}d` as RecallBucket;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// UX funnel
// ---------------------------------------------------------------------------

export const onboardingStep = ctor('onboarding_step');
/** Learner changed the source (instruction) language of one enrollment. */
export const enrollmentSourceChanged = ctor('enrollment_source_changed');
export const screenView = ctor('screen_view');
export const mascotPreference = ctor('mascot_preference');
export const audioPlayback = ctor('audio_playback');
export const conversationFunnel = ctor('conversation_funnel');

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/** App cold start. */
export const appStart = ctor('app_start');
/** Time to first media frame (R2 start/seek p99 input). */
export const mediaStart = ctor('media_start');
/** AI latency incl. time-to-first-audio and interruption (barge-in) latency. */
export const aiLatency = ctor('ai_latency');
export const sttQuality = ctor('stt_quality');
export const imageLoad = ctor('image_load');

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** One AI request's usage and estimated cost (see `cost.ts` for the estimate). */
export const aiCost = ctor('ai_cost');
/** Cloudflare R2 operations (class A/B) and bytes. */
export const storageOps = ctor('storage_ops');
export const jobCost = ctor('job_cost');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const apiError = ctor('api_error');
export const providerFailure = ctor('provider_failure');
export const mediaFailure = ctor('media_failure');
export const clientCrash = ctor('client_crash');

/** All constructors keyed by event name. */
export const telemetry = {
  missionCompleted,
  reviewRecall,
  skillStateChanged,
  speakingTime,
  pronunciationFeedback,
  transferSuccess,
  onboardingStep,
  enrollmentSourceChanged,
  screenView,
  mascotPreference,
  audioPlayback,
  conversationFunnel,
  appStart,
  mediaStart,
  aiLatency,
  sttQuality,
  imageLoad,
  aiCost,
  storageOps,
  jobCost,
  apiError,
  providerFailure,
  mediaFailure,
  clientCrash,
} as const;

// ---------------------------------------------------------------------------
// Percentile accumulator for performance KPIs (p50/p95/p99 inputs)
// ---------------------------------------------------------------------------

/** Latency series tracked by the performance dashboard (§12.2, §14.3). */
export const LATENCY_METRIC_VALUES = ['cold_start_ms', 'time_to_first_frame_ms', 'media_seek_ms', 'time_to_first_audio_ms', 'interruption_latency_ms', 'ai_total_ms', 'api_ms', 'image_load_ms'] as const;
export type LatencyMetric = (typeof LATENCY_METRIC_VALUES)[number];

export interface PercentileSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Bounded reservoir of samples per metric computing nearest-rank percentiles. Feed it from the
 * performance events (`appStart` → cold_start_ms, `mediaStart` → time_to_first_frame_ms,
 * `aiLatency` → time_to_first_audio_ms / interruption_latency_ms / ai_total_ms, …) or directly
 * from client timers for series without an event (media seek).
 */
export class PercentileAccumulator {
  readonly #samples = new Map<string, number[]>();
  readonly #capacity: number;

  constructor(capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('PercentileAccumulator: capacity must be a positive integer');
    this.#capacity = capacity;
  }

  /** Record one sample; silently drops NaN/negative values and keeps the newest `capacity` samples. */
  add(metric: LatencyMetric | string, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    let arr = this.#samples.get(metric);
    if (!arr) {
      arr = [];
      this.#samples.set(metric, arr);
    }
    arr.push(value);
    if (arr.length > this.#capacity) arr.splice(0, arr.length - this.#capacity);
  }

  /** Extract the relevant latency samples from a performance event. */
  addEvent(event: TelemetryEvent): void {
    switch (event.name) {
      case 'app_start':
        this.add('cold_start_ms', event.props.coldStartMs);
        break;
      case 'media_start':
        this.add('time_to_first_frame_ms', event.props.timeToFirstFrameMs);
        break;
      case 'ai_latency':
        this.add('ai_total_ms', event.props.totalMs);
        if (event.props.timeToFirstAudioMs !== null) this.add('time_to_first_audio_ms', event.props.timeToFirstAudioMs);
        if (event.props.interruptionLatencyMs !== null) this.add('interruption_latency_ms', event.props.interruptionLatencyMs);
        break;
      case 'image_load':
        this.add('image_load_ms', event.props.loadMs);
        break;
      default:
        break;
    }
  }

  summary(metric: LatencyMetric | string): PercentileSummary | null {
    const arr = this.#samples.get(metric);
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
    const sum = sorted.reduce((a, b) => a + b, 0);
    return { count: sorted.length, min: sorted[0]!, max: sorted[sorted.length - 1]!, mean: sum / sorted.length, p50: rank(50), p95: rank(95), p99: rank(99) };
  }

  metrics(): string[] {
    return [...this.#samples.keys()];
  }

  reset(metric?: string): void {
    if (metric === undefined) this.#samples.clear();
    else this.#samples.delete(metric);
  }
}
