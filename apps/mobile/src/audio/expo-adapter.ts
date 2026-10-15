/**
 * `expo-audio` implementation of {@link NativePlayer} (ADR-001). One player
 * instance outlives screens (global mini player); background playback and
 * lock-screen controls follow docs/reference/expo-audio-sdk57.md: audio mode
 * `shouldPlayInBackground` + `doNotMix`, `setActiveForLockScreen` with
 * metadata (required on Android for sustained background playback).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { LockScreenMetadata, NativePlayer, NativePlayerStatus } from './AudioEngine';

let libraryModeReady: Promise<void> | null = null;

/** Configure the audio session for long-form background playback (idempotent, re-run after the recorder changed the mode). */
export function ensureLibraryAudioMode(): Promise<void> {
  if (!libraryModeReady) {
    libraryModeReady = setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix', allowsRecording: false, shouldRouteThroughEarpiece: false })
      .catch(() => undefined)
      .finally(() => {
        // Allow the next prepare to re-apply the mode (the conversation recorder switches it to playAndRecord).
        setTimeout(() => {
          libraryModeReady = null;
        }, 1_000);
      });
  }
  return libraryModeReady;
}

const toStatus = (s: AudioStatus): NativePlayerStatus => ({
  playing: s.playing,
  positionMs: Math.max(0, Math.round((Number.isFinite(s.currentTime) ? s.currentTime : 0) * 1000)),
  durationMs: Number.isFinite(s.duration) && s.duration > 0 ? Math.round(s.duration * 1000) : null,
  loaded: s.isLoaded,
  buffering: s.isBuffering,
  didJustFinish: s.didJustFinish,
  error: s.error ?? null,
  mediaServicesDidReset: s.mediaServicesDidReset ?? false,
});

export function createExpoNativePlayer(): NativePlayer {
  const player: AudioPlayer = createAudioPlayer(null, { updateInterval: 500 });
  const listeners = new Set<(status: NativePlayerStatus) => void>();
  const sub = player.addListener('playbackStatusUpdate', (status) => {
    const mapped = toStatus(status);
    for (const l of listeners) l(mapped);
  });
  let lockActive = false;
  return {
    load: (uri) => {
      player.replace({ uri });
    },
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (positionMs) => player.seekTo(positionMs / 1000),
    setRate: (rate) => {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rate, 'high');
    },
    setLockScreen: (active, metadata?: LockScreenMetadata) => {
      try {
        if (active) {
          const meta = metadata ? { title: metadata.title, artist: metadata.artist, albumTitle: metadata.albumTitle, artworkUrl: metadata.artworkUrl } : undefined;
          if (lockActive && meta) player.updateLockScreenMetadata(meta);
          else player.setActiveForLockScreen(true, meta, { showSeekBackward: true, showSeekForward: true });
          lockActive = true;
        } else if (lockActive) {
          player.clearLockScreenControls();
          lockActive = false;
        }
      } catch {
        /* lock-screen controls unsupported on this platform */
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepareSession: () => ensureLibraryAudioMode(),
    release: () => {
      sub.remove();
      listeners.clear();
      try {
        player.clearLockScreenControls();
      } catch {
        /* ignore */
      }
      player.remove();
    },
  };
}
