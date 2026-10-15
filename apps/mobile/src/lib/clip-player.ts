/**
 * Short-clip audio playback for lessons, pronunciation references and
 * conversation turns (expo-audio, ADR-001). The long-form library player is
 * owned by `src/audio/**` (audio agent). Inline base64 clips are written to the
 * cache directory first because `expo-audio` plays file/URL sources.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { base64ToBytes, stripDataUri } from './base64';
import type { ConversationAudioAdapter } from '@/features/conversation/controller';

export type ClipSource = { url: string } | { base64: string; mimeType: string };

const extensionFor = (mimeType: string): string => {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg';
  if (mimeType.includes('flac')) return 'flac';
  return 'bin';
};

let clipCounter = 0;

/** Materialise a base64 clip as a file URI (web: data URI). */
export async function materialiseClip(base64: string, mimeType: string): Promise<string> {
  const data = stripDataUri(base64);
  if (Platform.OS === 'web') return `data:${mimeType};base64,${data}`;
  const file = new File(Paths.cache, `langquest-clip-${Date.now()}-${++clipCounter}.${extensionFor(mimeType)}`);
  file.write(base64ToBytes(data));
  return file.uri;
}

export interface ClipPlayer extends ConversationAudioAdapter {
  /** Currently playing? */
  readonly playing: boolean;
  /** Play a URL / file / data URI; resolves when playback finishes or is stopped. */
  playUri(uri: string, rate?: number): Promise<void>;
  dispose(): void;
}

let audioModeReady: Promise<void> | null = null;
/** Configure the audio session once: play in silent mode, allow recording, duck others. */
export function ensureAudioMode(): Promise<void> {
  if (!audioModeReady) {
    audioModeReady = setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false, shouldRouteThroughEarpiece: false }).catch(() => undefined);
  }
  return audioModeReady;
}

export function createClipPlayer(): ClipPlayer {
  let player: AudioPlayer | null = null;
  let finish: (() => void) | null = null;
  let playing = false;

  const settle = (): void => {
    playing = false;
    const f = finish;
    finish = null;
    f?.();
  };

  const stop = (): void => {
    try {
      player?.pause();
    } catch {
      /* already released */
    }
    settle();
  };

  const playUri = async (uri: string, rate = 1): Promise<void> => {
    await ensureAudioMode();
    stop();
    player?.remove();
    player = createAudioPlayer({ uri }, { updateInterval: 250 });
    playing = true;
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      const p = player!;
      const sub = p.addListener('playbackStatusUpdate', (status) => {
        if (status.error) {
          sub.remove();
          settle();
          reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) {
          sub.remove();
          settle();
        }
      });
      try {
        if (rate !== 1) p.setPlaybackRate(rate, 'high');
        p.play();
      } catch (error) {
        sub.remove();
        settle();
        reject(error instanceof Error ? error : new Error('playback failed'));
      }
    });
  };

  return {
    get playing() {
      return playing;
    },
    playUri,
    play: async (source, rate) => {
      const uri = 'url' in source ? source.url : await materialiseClip(source.base64, source.mimeType);
      await playUri(uri, rate);
    },
    stop,
    dispose: () => {
      stop();
      player?.remove();
      player = null;
    },
  };
}
