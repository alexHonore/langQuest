import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pcm16ToWav } from '@langquest/ai/util';
import { encodeRecordedSpeech, speechEndBeforeTrailer } from './recorded-speech';

const fixture = readFileSync(new URL('../../fixtures/speech-trailer.wav', import.meta.url));
const noise = Int16Array.from({ length: (fixture.length - 44) / 2 }, (_, i) => fixture.readInt16LE(44 + i * 2));

describe('recorded speech endings', () => {
  it('finds the trailing burst with short and long padding and preserves speech up to its onset', () => {
    for (const padding of [0, 24_000]) {
      const clip = new Int16Array(8000 + noise.length + padding);
      clip.set(noise, 8000);
      expect(speechEndBeforeTrailer(clip)).toBe(7520);
      clip.fill(3000, 7000, 8000);
      expect(speechEndBeforeTrailer(clip)).toBe(7976);
    }
  });

  it('preserves a final fricative, a partial match and a burst followed by more speech', () => {
    const clip = new Int16Array(20_000);
    for (let i = 12_000; i < 16_000; i++) clip[i] = 9000 * Math.sin(i * 1.65);
    expect(speechEndBeforeTrailer(clip)).toBeNull();
    clip.set(noise.subarray(0, 792), 12_000);
    expect(speechEndBeforeTrailer(clip)).toBeNull();
    clip.set(noise, 1000);
    expect(speechEndBeforeTrailer(clip)).toBeNull();
    expect(speechEndBeforeTrailer(new Int16Array(10))).toBeNull();
  });

  it('removes a trailer already mixed into raw audio and leaves the complete voice and a quiet ending in the MP3', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lq-speech-'));
    try {
      const bytes = Buffer.alloc((18_000 + noise.length + 6000) * 2);
      for (let i = 0; i < 16_000; i++) bytes.writeInt16LE(Math.round(6000 * Math.sin(i / 15)), 2 * i);
      fixture.copy(bytes, 18_000 * 2, 44);
      const output = join(directory, 'utterance.mp3');
      encodeRecordedSpeech(bytes, 'pcm', '24000', output);
      const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 's16le', '-']);
      const expected = (18_000 - 480) / 24_000 + 0.12 + 0.25;
      expect(Math.abs(decoded.length / 48_000 - expected)).toBeLessThan(0.015);
      const lastVoice = Array.from({ length: 240 }, (_, i) => decoded.readInt16LE((2880 + 15_760 + i) * 2));
      expect(Math.max(...lastVoice.map(Math.abs))).toBeGreaterThan(1000);
      expect(decoded.subarray(-4800).every((byte) => byte === 0)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('encodes the same voice from raw PCM and a provider WAV with loud non-audio bytes after its data chunk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lq-speech-'));
    try {
      const voice = Buffer.alloc(32_000);
      for (let i = 0; i < voice.length / 2; i++) voice.writeInt16LE(Math.round(10_000 * Math.sin(i / 12)), 2 * i);
      const extra = Buffer.alloc(8008, 0x61);
      extra.write('JUNK');
      extra.writeUInt32LE(extra.length - 8, 4);
      const wav = Buffer.concat([pcm16ToWav(voice, 16_000), extra]);
      wav.writeUInt32LE(wav.length - 8, 4);
      const rawFile = join(directory, 'raw.mp3');
      const wavFile = join(directory, 'wav.mp3');
      encodeRecordedSpeech(voice, 'pcm', '16000', rawFile);
      // The WAV header specifies 16 kHz even when the request and its fallback rate said otherwise.
      encodeRecordedSpeech(wav, 'pcm', '24000', wavFile);
      const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(digest(wavFile)).toBe(digest(rawFile));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
