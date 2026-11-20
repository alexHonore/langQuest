import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sampleRate = 24_000;
const ffmpeg = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

function samplesOf(pcm: Buffer): Int16Array {
  const samples = new Int16Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
  return samples;
}

// Two independent portions of the recurring trailer heard after the restaurant question. The fixture
// contains only the noise, in a 24 kHz mono PCM WAV with a standard 44-byte header.
const trailer = samplesOf(readFileSync(new URL('../../fixtures/speech-trailer.wav', import.meta.url)).subarray(44));
function anchor(samples: Int16Array) {
  return { samples, energy: samples.reduce((sum, x) => sum + x * x, 0) };
}
const first = anchor(trailer.subarray(0, 792)); // 33 ms
const separation = 1680; // 70 ms between anchors
const second = anchor(trailer.subarray(separation));

function matches(samples: Int16Array, offset: number, reference: typeof first, threshold: number): boolean {
  if (offset < 0 || offset + reference.samples.length > samples.length) return false;
  let dot = 0;
  let energy = 0;
  for (let i = 0; i < reference.samples.length; i++) {
    const x = samples[offset + i]!;
    dot += x * reference.samples[i]!;
    energy += x * x;
  }
  return dot > 0 && dot * dot > threshold * threshold * energy * reference.energy;
}

/** End of the speech before the verified trailer in 24 kHz mono PCM. A final consonant or breath is kept. */
export function speechEndBeforeTrailer(samples: Int16Array): number | null {
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]!) < 256) last--;
  // The burst spans about 190 ms and can be followed by any amount of silence.
  for (let at = Math.max(0, last - 7200); at <= last - 3500; at++) {
    if (!matches(samples, at, first, 0.75)) continue;
    // MP3 encoding can shift the second match by one or two samples.
    for (let shift = -3; shift <= 3; shift++) {
      if (!matches(samples, at + separation + shift, second, 0.42)) continue;
      const before = Math.max(0, at - 480);
      const speechAtBoundary = samples.subarray(before, Math.max(before, at - 360)).some((x) => Math.abs(x) > 512);
      return speechAtBoundary ? Math.max(0, at - 24) : before;
    }
  }
  return null;
}

/** Normalize one provider response into a course MP3. A WAV response carries its own rate, channels and data boundaries. */
export function encodeRecordedSpeech(bytes: Buffer, format: 'pcm' | 'mp3', rate: string, output: string): void {
  const wave = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  const raw = format === 'pcm' && !wave;
  const input = raw ? ['-f', 's16le', '-ar', rate, '-ac', '1'] : [];
  const pcm = raw && Number(rate) === sampleRate ? bytes : execFileSync('ffmpeg', [
    ...ffmpeg, ...input, '-i', 'pipe:0', '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1',
  ], { input: bytes, maxBuffer: 64 * 1024 * 1024 });
  const end = speechEndBeforeTrailer(samplesOf(pcm));
  const filters = [];
  if (end !== null) {
    if (end === 0) throw new Error('The recording contains only the noise trailer.');
    const fade = Math.min(end, 96);
    filters.push(`atrim=end_sample=${end}`, `afade=t=out:ss=${end - fade}:ns=${fade}`);
  }
  // Room for the first and last syllables at both playback speeds.
  filters.push('adelay=120', 'apad=pad_dur=0.25', 'loudnorm=I=-18:TP=-2:LRA=11');
  execFileSync('ffmpeg', [
    ...ffmpeg, '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    '-af', filters.join(','), '-ac', '1', '-ar', String(sampleRate), '-b:a', '48k', output,
  ], { input: pcm });
}
