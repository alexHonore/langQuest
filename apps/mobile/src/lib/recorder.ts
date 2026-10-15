/**
 * Microphone capture for lessons, the pronunciation coach and live
 * conversations (expo-audio recorder, ADR-001). Permission is requested
 * just-in-time (§10.2B screen 1). Recorded clips are read back as base64 for
 * the inline `AudioInput` contract and deleted locally; server-side retention
 * follows the learner's `speechRetention` preference.
 *
 * `expo-audio` only hands out recorder instances through `useAudioRecorder`,
 * so `useRecorder()` is a hook that wraps that instance in the platform-free
 * `Recorder` interface the feature code expects.
 */
import { RecordingPresets, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, useAudioRecorder, type AudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { bytesToBase64 } from './base64';
import { ensureAudioMode } from './clip-player';
import type { ConversationRecorderAdapter, RecordedClip } from '@/features/conversation/controller';
import type { AudioEncoding } from '@langquest/contracts';

export type MicPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export async function getMicPermission(): Promise<MicPermission> {
  try {
    const p = await getRecordingPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestMicPermission(): Promise<MicPermission> {
  try {
    const p = await requestRecordingPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 96_000,
};

const encodingFor = (uri: string): AudioEncoding => {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.wav')) return 'wav';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.webm')) return 'webm_opus';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'opus';
  if (lower.endsWith('.caf') || lower.endsWith('.aac')) return 'aac';
  return 'm4a';
};

export interface Recorder extends ConversationRecorderAdapter {
  /** Current level in dBFS when metering is available (undefined otherwise — never faked). */
  level(): number | undefined;
  isRecording(): boolean;
  durationMs(): number;
}

/** Read a recorded file as base64 (web: fetch the blob URL). */
async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
  }
  return new File(uri).base64();
}

const deleteQuietly = (uri: string | null): void => {
  if (!uri || Platform.OS === 'web') return;
  try {
    new File(uri).delete();
  } catch {
    /* best effort cleanup */
  }
};

/** Wrap an expo-audio recorder instance (from `useAudioRecorder`) in the `Recorder` interface. */
export function wrapRecorder(recorder: AudioRecorder): Recorder {
  let startedAt = 0;
  let prepared = false;
  return {
    async start() {
      await ensureAudioMode();
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      prepared = true;
      recorder.record();
      startedAt = Date.now();
    },
    async stop(): Promise<RecordedClip | null> {
      if (!prepared) return null;
      const durationMs = Math.max(0, Date.now() - startedAt);
      await recorder.stop();
      prepared = false;
      const uri = recorder.uri;
      if (!uri || durationMs < 150) {
        deleteQuietly(uri);
        return null;
      }
      const base64 = await readBase64(uri);
      deleteQuietly(uri);
      return { base64, encoding: Platform.OS === 'web' ? 'webm_opus' : encodingFor(uri), sampleRateHz: RECORDING_OPTIONS.sampleRate, durationMs };
    },
    async cancel() {
      if (!prepared) return;
      try {
        await recorder.stop();
      } catch {
        /* nothing to cancel */
      }
      prepared = false;
      deleteQuietly(recorder.uri);
    },
    level: () => {
      try {
        return recorder.getStatus().metering;
      } catch {
        return undefined;
      }
    },
    isRecording: () => recorder.isRecording,
    durationMs: () => (recorder.isRecording ? Date.now() - startedAt : 0),
  };
}

/** React hook: a `Recorder` bound to the component lifecycle. */
export function useRecorder(): Recorder {
  const native = useAudioRecorder(RECORDING_OPTIONS);
  return useMemo(() => wrapRecorder(native), [native]);
}
