/**
 * Client telemetry (§12.2) built on `@langquest/telemetry`: pseudonymous,
 * redacted, buffered. Without a configured sink the events go to the console
 * in development and are dropped in production; the typed constructors still
 * validate every event so screens cannot emit malformed data.
 */
import type { LanguageContext, TelemetryEvent } from '@langquest/contracts';
import { BufferedSink, ConsoleSink, createTelemetryContext, telemetry, withLanguageContext, type TelemetryContext } from '@langquest/telemetry';
import { Platform } from 'react-native';
import { ENV } from '@/config/env';

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

let context: TelemetryContext = createTelemetryContext({ platform, appVersion: ENV.appVersion, privacyLevel: 'anonymous' });
const sink = __DEV__ ? new BufferedSink(new ConsoleSink({ format: 'pretty', prefix: '[telemetry]' }), { flushIntervalMs: 10_000, maxBatchSize: 50 }) : null;

export function bindTelemetryUser(userHash: string | null): void {
  context = { ...context, userHash, privacyLevel: userHash ? 'pseudonymous' : 'anonymous' };
}

export function bindTelemetryEnrollment(lc: LanguageContext | null): void {
  context = lc ? withLanguageContext(context, lc) : { ...context, enrollmentId: null, trackId: null, targetVarietyId: null, sourceLanguageCode: null };
}

function emit(event: TelemetryEvent): void {
  void sink?.write([event]).catch(() => undefined);
}

export const track = {
  screenView: (screen: string, rtl: boolean, scriptMode: string | null) => emit(telemetry.screenView(context, { screen, rtl, scriptMode })),
  onboardingStep: (step: 'welcome' | 'ui_language' | 'source_language' | 'track_selected' | 'enrolled' | 'first_mission_started', completed = true) =>
    emit(telemetry.onboardingStep(context, { step, completed })),
  enrollmentSourceChanged: (from: LanguageContext['sourceLanguage'], to: LanguageContext['sourceLanguage']) => emit(telemetry.enrollmentSourceChanged(context, { from, to })),
  mascotPreference: (enabled: boolean, reduceMotion: boolean) => emit(telemetry.mascotPreference(context, { enabled, reduceMotion })),
  speakingTime: (seconds: number, ctx: 'conversation' | 'drill' | 'anticipation' | 'shadowing') => emit(telemetry.speakingTime(context, { seconds, context: ctx })),
  conversationFunnel: (step: 'session_created' | 'first_turn' | 'barge_in' | 'command_used' | 'ended', turnCount: number | null) => emit(telemetry.conversationFunnel(context, { step, turnCount })),
  apiError: (route: string, code: Parameters<typeof telemetry.apiError>[1]['code'], status: number, traceId: string | null) => emit(telemetry.apiError(context, { route, code, status, traceId })),
  appStart: (coldStartMs: number, lowEndDevice: boolean) => emit(telemetry.appStart(context, { coldStartMs, lowEndDevice })),
  /** Non-fatal client fault worth an alert (e.g. the local database could not be opened). */
  clientFault: (fingerprint: string, screen: string | null) => emit(telemetry.clientCrash(context, { fingerprint, fatal: false, screen })),
};

export const flushTelemetry = (): Promise<void> => sink?.flush() ?? Promise.resolve();
