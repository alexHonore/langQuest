/**
 * Track-level capability summary shared by `/v1/courses` and `/v1/ai/model-capabilities` (§8.5, §15):
 * derived from the evidence-backed capability matrix in `@langquest/ai` and the configured providers.
 * Never claims phoneme/tone scoring the deployment cannot deliver.
 */
import { capabilityForTrack, isUsable } from '@langquest/ai/capability/matrix';
import type { CourseTrackId } from '@langquest/contracts';
import { getCourseTrack } from '@langquest/contracts';

export type PronunciationScoringLevel = 'full' | 'partial' | 'limited' | 'none';

export interface TrackCapabilitySummary {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  realtimeConversation: boolean;
  pronunciationScoring: PronunciationScoringLevel;
}

/**
 * - `full`: an acoustic assessor is configured and documents word + phoneme (+ tone for tonal tracks) for this locale.
 * - `partial`: acoustic assessor configured, word level only (or tone missing on a tonal track).
 * - `limited`: no acoustic assessor for this variety; reference comparison + semantic check only (no numeric score).
 * - `none`: not even STT is usable, so no spoken feedback at all.
 */
export function pronunciationScoringLevel(trackId: CourseTrackId, azureConfigured: boolean): PronunciationScoringLevel {
  const cap = capabilityForTrack(trackId);
  if (!isUsable(cap.stt.status)) return 'none';
  if (!azureConfigured || !cap.pronunciation.azureLocale) return 'limited';
  const word = isUsable(cap.pronunciation.word.status);
  const phoneme = isUsable(cap.pronunciation.phoneme.status);
  const tone = isUsable(cap.pronunciation.tone.status);
  const tonal = getCourseTrack(trackId).tonal;
  if (word && phoneme && (!tonal || tone)) return 'full';
  if (word) return 'partial';
  return 'limited';
}

export function trackCapabilitySummary(trackId: CourseTrackId, azureConfigured: boolean, openRouterConfigured: boolean): TrackCapabilitySummary {
  const cap = capabilityForTrack(trackId);
  return {
    speechRecognition: openRouterConfigured && isUsable(cap.stt.status),
    speechSynthesis: openRouterConfigured && isUsable(cap.tts.status),
    realtimeConversation: openRouterConfigured && isUsable(cap.realtimePipeline.status),
    pronunciationScoring: openRouterConfigured ? pronunciationScoringLevel(trackId, azureConfigured) : 'none',
  };
}
