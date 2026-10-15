/**
 * FFmpeg / ffprobe command builders (§7.2 background transcode, §7.5 clips, §3.6 slow playback).
 *
 * This module only *builds* argument arrays — it never spawns processes, so it is safe to import
 * from Workers and trivially unit-testable. `apps/jobs` executes the commands with `spawn(bin, args)`
 * (no shell), which is why every builder returns `string[]` and rejects paths that look like flags.
 *
 * Design rules (§4.4): keep masters untouched, generate voice-friendly AAC/Opus renditions at
 * audited bitrates, skip transcoding when it brings no benefit, preserve instructional pauses
 * (no silence removal anywhere), and keep pitch when slowing speech down.
 */
import { z } from 'zod';

export interface FfCommand {
  bin: 'ffmpeg' | 'ffprobe';
  args: string[];
}

/** Reject inputs that could be parsed as options or contain NUL bytes. Paths are otherwise passed verbatim (no shell). */
export function assertSafePath(path: string, label = 'path'): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error(`${label} is required`);
  if (path.includes('\u0000')) throw new Error(`${label} contains a NUL byte`);
  if (path.startsWith('-')) throw new Error(`${label} must not start with "-" (would be parsed as an option)`);
  return path;
}

const COMMON_FFMPEG_FLAGS = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'] as const;

/** `ffprobe -print_format json -show_format -show_streams <input>` */
export function buildProbeCommand(input: string): FfCommand {
  return {
    bin: 'ffprobe',
    args: ['-hide_banner', '-loglevel', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', assertSafePath(input, 'input')],
  };
}

const numericString = z.union([z.string(), z.number()]).transform((v) => (typeof v === 'number' ? v : Number.parseFloat(v)));

export const ProbeStreamSchema = z
  .object({
    index: z.number().int(),
    codec_type: z.string(),
    codec_name: z.string().optional(),
    profile: z.string().optional(),
    sample_rate: numericString.optional(),
    channels: z.number().int().optional(),
    channel_layout: z.string().optional(),
    bit_rate: numericString.optional(),
    duration: numericString.optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    disposition: z.record(z.string(), z.number()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const ProbeFormatSchema = z
  .object({
    filename: z.string().optional(),
    format_name: z.string().optional(),
    format_long_name: z.string().optional(),
    duration: numericString.optional(),
    size: numericString.optional(),
    bit_rate: numericString.optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const ProbeOutputSchema = z.object({
  streams: z.array(ProbeStreamSchema).default([]),
  format: ProbeFormatSchema.default({}),
  chapters: z.array(z.object({ id: z.number().int().optional(), start_time: numericString.optional(), end_time: numericString.optional(), tags: z.record(z.string(), z.string()).optional() }).passthrough()).default([]),
});
export type ProbeOutput = z.infer<typeof ProbeOutputSchema>;

/** Normalised view of an ffprobe result for the first audio stream. */
export interface ProbeSummary {
  container: string | null;
  codec: string | null;
  profile: string | null;
  durationMs: number | null;
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  byteLength: number | null;
  /** Attached picture (embedded cover) stream present. */
  hasCover: boolean;
  tags: Record<string, string>;
  chapters: Array<{ startMs: number; endMs: number; title: string | null }>;
}

function finite(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Parse and normalise raw `ffprobe` JSON (string or already-parsed). Throws on malformed JSON. */
export function parseProbeOutput(raw: string | unknown): ProbeSummary {
  const json: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const probe = ProbeOutputSchema.parse(json);
  const audio = probe.streams.find((s) => s.codec_type === 'audio') ?? null;
  const hasCover = probe.streams.some((s) => s.codec_type === 'video' && ((s.disposition?.attached_pic ?? 0) === 1 || /^(mjpeg|png|webp)$/.test(s.codec_name ?? '')));
  const durationSec = finite(probe.format.duration) ?? finite(audio?.duration);
  const bitrate = finite(audio?.bit_rate) ?? finite(probe.format.bit_rate);
  const lowerTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(probe.format.tags ?? {})) lowerTags[k.toLowerCase()] = v;
  return {
    container: probe.format.format_name ?? null,
    codec: audio?.codec_name ?? null,
    profile: audio?.profile ?? null,
    durationMs: durationSec === null ? null : Math.round(durationSec * 1000),
    bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
    sampleRateHz: finite(audio?.sample_rate),
    channels: audio?.channels ?? null,
    byteLength: finite(probe.format.size),
    hasCover,
    tags: lowerTags,
    chapters: probe.chapters.map((c) => ({ startMs: Math.round((finite(c.start_time) ?? 0) * 1000), endMs: Math.round((finite(c.end_time) ?? 0) * 1000), title: c.tags?.title ?? null })),
  };
}

// --- transcode profiles -----------------------------------------------------------

export interface SourceAudioInfo {
  channels: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  sampleRateHz: number | null;
  durationMs: number | null;
  /** Editor hint: true for narrated/speech content where stereo carries no information. */
  speechOnly?: boolean;
}

export interface RenditionProfile {
  codec: 'aac' | 'opus';
  bitrateKbps: number;
  channels: 1 | 2;
  sampleRateHz: number;
  /** Output container extension. */
  ext: 'm4a' | 'ogg';
  mimeType: 'audio/mp4' | 'audio/ogg';
}

/** Audited bitrate ladder (§4.4): AAC 64k mono / 96k stereo, Opus 32k mono / 48k stereo. */
export const RENDITION_LADDER = {
  aac: { mono: 64, stereo: 96 },
  opus: { mono: 32, stereo: 48 },
} as const;

/**
 * Decide mono vs stereo and bitrate for each mobile rendition. Mono sources (or speech-only
 * content) stay mono; stereo sources keep stereo so music/ambience lessons are not degraded.
 */
export function decideTranscodeProfile(source: SourceAudioInfo): { aac: RenditionProfile; opus: RenditionProfile } {
  const mono = (source.channels ?? 1) <= 1 || source.speechOnly === true;
  const channels: 1 | 2 = mono ? 1 : 2;
  const sampleRate = source.sampleRateHz !== null && source.sampleRateHz > 0 && source.sampleRateHz <= 44100 ? source.sampleRateHz : 44100;
  return {
    aac: { codec: 'aac', bitrateKbps: mono ? RENDITION_LADDER.aac.mono : RENDITION_LADDER.aac.stereo, channels, sampleRateHz: sampleRate, ext: 'm4a', mimeType: 'audio/mp4' },
    opus: { codec: 'opus', bitrateKbps: mono ? RENDITION_LADDER.opus.mono : RENDITION_LADDER.opus.stereo, channels, sampleRateHz: 48000, ext: 'ogg', mimeType: 'audio/ogg' },
  };
}

/**
 * Whether a mobile rendition is worth producing (§4.4 "avoid converting if no audible/size benefit").
 * Masters that are already AAC at or below the ladder bitrate are served as-is.
 */
export function shouldTranscode(source: SourceAudioInfo, target: RenditionProfile): { transcode: boolean; reason: string } {
  const codec = (source.codec ?? '').toLowerCase();
  if (target.codec === 'aac' && codec === 'aac' && source.bitrateKbps !== null && source.bitrateKbps <= target.bitrateKbps + 8 && (source.channels ?? 1) <= target.channels) {
    return { transcode: false, reason: 'master is already AAC at or below the target bitrate' };
  }
  if (target.codec === 'opus' && codec === 'opus' && source.bitrateKbps !== null && source.bitrateKbps <= target.bitrateKbps + 8) {
    return { transcode: false, reason: 'master is already Opus at or below the target bitrate' };
  }
  if (source.bitrateKbps !== null && source.bitrateKbps <= target.bitrateKbps && codec === 'mp3' && target.codec === 'aac') {
    return { transcode: false, reason: 'low-bitrate MP3 master; re-encoding to AAC would only lose quality' };
  }
  return { transcode: true, reason: 'rendition reduces size or improves mobile compatibility' };
}

/** EBU R128 loudness normalisation target for narrated content (optional, never applied to masters). */
export const LOUDNESS_TARGET = { integratedLufs: -16, truePeakDb: -1.5, loudnessRange: 11 } as const;

export interface TranscodeOptions {
  input: string;
  output: string;
  profile: RenditionProfile;
  /** Apply `loudnorm` (single pass). Off by default so instructional dynamics are preserved. */
  loudnessNormalize?: boolean;
  /** Strip source tags/cover from the rendition (metadata lives in the DB). Default true. */
  stripMetadata?: boolean;
}

function audioFilters(opts: { loudnessNormalize?: boolean }, extra: string[] = []): string[] {
  const filters = [...extra];
  if (opts.loudnessNormalize) filters.push(`loudnorm=I=${LOUDNESS_TARGET.integratedLufs}:TP=${LOUDNESS_TARGET.truePeakDb}:LRA=${LOUDNESS_TARGET.loudnessRange}`);
  return filters.length ? ['-af', filters.join(',')] : [];
}

/** Build the `ffmpeg` command for an AAC (m4a) or Opus (ogg) rendition. */
export function buildTranscodeCommand(opts: TranscodeOptions): FfCommand {
  const { profile } = opts;
  const args: string[] = [...COMMON_FFMPEG_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-vn'];
  if (opts.stripMetadata !== false) args.push('-map_metadata', '-1');
  args.push('-ac', String(profile.channels), '-ar', String(profile.sampleRateHz));
  args.push(...audioFilters(opts));
  if (profile.codec === 'aac') {
    args.push('-c:a', 'aac', '-b:a', `${profile.bitrateKbps}k`, '-movflags', '+faststart', '-f', 'mp4');
  } else {
    args.push('-c:a', 'libopus', '-b:a', `${profile.bitrateKbps}k`, '-vbr', 'on', '-application', 'audio', '-f', 'ogg');
  }
  args.push(assertSafePath(opts.output, 'output'));
  return { bin: 'ffmpeg', args };
}

/** Supported slow-playback factors (§3.6). `atempo` changes tempo without changing pitch. */
export const SLOW_FACTORS = [0.75, 0.85] as const;
export type SlowFactor = (typeof SLOW_FACTORS)[number];

/** Build a pitch-preserving slow rendition (`atempo`), encoded with the given profile. */
export function buildSlowCommand(opts: { input: string; output: string; factor: SlowFactor; profile: RenditionProfile; loudnessNormalize?: boolean }): FfCommand {
  if (!SLOW_FACTORS.includes(opts.factor)) throw new Error(`Unsupported slow factor ${opts.factor}`);
  const { profile } = opts;
  const args: string[] = [...COMMON_FFMPEG_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-vn', '-map_metadata', '-1'];
  args.push(...audioFilters(opts, [`atempo=${opts.factor}`]));
  args.push('-ac', String(profile.channels), '-ar', String(profile.sampleRateHz));
  if (profile.codec === 'aac') args.push('-c:a', 'aac', '-b:a', `${profile.bitrateKbps}k`, '-movflags', '+faststart', '-f', 'mp4');
  else args.push('-c:a', 'libopus', '-b:a', `${profile.bitrateKbps}k`, '-f', 'ogg');
  args.push(assertSafePath(opts.output, 'output'));
  return { bin: 'ffmpeg', args };
}

function msToTimestamp(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error('Timestamps must be non-negative integer milliseconds');
  return (ms / 1000).toFixed(3);
}

/**
 * Extract `[startMs, endMs)` into a clip. With `mode: 'copy'` the cut snaps to frame boundaries
 * (fast, lossless); with `mode: 'encode'` the cut is sample-accurate (seek after `-i`).
 */
export function buildClipCommand(opts: { input: string; output: string; startMs: number; endMs: number; mode?: 'copy' | 'encode'; profile?: RenditionProfile }): FfCommand {
  if (opts.endMs <= opts.startMs) throw new Error('endMs must be greater than startMs');
  const mode = opts.mode ?? 'encode';
  const args: string[] = [...COMMON_FFMPEG_FLAGS];
  if (mode === 'copy') {
    args.push('-ss', msToTimestamp(opts.startMs), '-to', msToTimestamp(opts.endMs), '-i', assertSafePath(opts.input, 'input'), '-vn', '-map_metadata', '-1', '-c:a', 'copy');
  } else {
    const profile = opts.profile ?? decideTranscodeProfile({ channels: 1, bitrateKbps: null, codec: null, sampleRateHz: null, durationMs: null }).aac;
    args.push('-i', assertSafePath(opts.input, 'input'), '-ss', msToTimestamp(opts.startMs), '-to', msToTimestamp(opts.endMs), '-vn', '-map_metadata', '-1', '-ac', String(profile.channels), '-ar', String(profile.sampleRateHz));
    if (profile.codec === 'aac') args.push('-c:a', 'aac', '-b:a', `${profile.bitrateKbps}k`, '-movflags', '+faststart', '-f', 'mp4');
    else args.push('-c:a', 'libopus', '-b:a', `${profile.bitrateKbps}k`, '-f', 'ogg');
  }
  args.push(assertSafePath(opts.output, 'output'));
  return { bin: 'ffmpeg', args };
}

/** Extract the embedded cover picture (attached_pic stream) without re-encoding. */
export function buildCoverExtractCommand(opts: { input: string; output: string }): FfCommand {
  return {
    bin: 'ffmpeg',
    args: [...COMMON_FFMPEG_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-an', '-map', '0:v:0', '-c:v', 'copy', '-frames:v', '1', assertSafePath(opts.output, 'output')],
  };
}

// --- waveform peaks ------------------------------------------------------------------

/** Sample rate used when downmixing audio to PCM for peak extraction. */
export const PEAK_PCM_SAMPLE_RATE = 8000;

/**
 * Decode to mono 8-bit signed PCM on stdout at a low sample rate; `peaksFromPcm` buckets the
 * result into `peaksPerSecond` normalised peaks. This is the cheapest reliable path and does not
 * depend on ffmpeg's metadata filter output format.
 */
export function buildPcmPeaksCommand(opts: { input: string; sampleRate?: number }): FfCommand {
  const rate = opts.sampleRate ?? PEAK_PCM_SAMPLE_RATE;
  return {
    bin: 'ffmpeg',
    args: [...COMMON_FFMPEG_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-vn', '-ac', '1', '-ar', String(rate), '-f', 's8', '-acodec', 'pcm_s8', 'pipe:1'],
  };
}

/** Alternative: `astats` per window printing `Peak_level` lines; parse with `parseAstatsPeaks`. */
export function buildAstatsPeaksCommand(opts: { input: string; peaksPerSecond?: number; sampleRate?: number }): FfCommand {
  const rate = opts.sampleRate ?? PEAK_PCM_SAMPLE_RATE;
  const pps = opts.peaksPerSecond ?? 10;
  const windowFrames = Math.max(1, Math.round(rate / pps));
  const filter = `aresample=${rate},aformat=channel_layouts=mono,asetnsamples=n=${windowFrames}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-`;
  return {
    bin: 'ffmpeg',
    args: [...COMMON_FFMPEG_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-vn', '-af', filter, '-f', 'null', '-'],
  };
}

export interface WaveformPeaks {
  version: 1;
  peaksPerSecond: number;
  /** Peaks in 0..1, one per window. */
  peaks: number[];
  durationMs: number;
}

/** Bucket signed 8-bit PCM samples into normalised absolute peaks. */
export function peaksFromPcm(pcm: Uint8Array, sampleRate: number, peaksPerSecond = 10): WaveformPeaks {
  const window = Math.max(1, Math.round(sampleRate / peaksPerSecond));
  const peaks: number[] = [];
  for (let i = 0; i < pcm.length; i += window) {
    let max = 0;
    const end = Math.min(i + window, pcm.length);
    for (let j = i; j < end; j++) {
      const v = (pcm[j] as number) << 24 >> 24; // signed 8-bit
      const a = Math.abs(v);
      if (a > max) max = a;
    }
    peaks.push(Number((max / 128).toFixed(3)));
  }
  return { version: 1, peaksPerSecond, peaks, durationMs: Math.round((pcm.length / sampleRate) * 1000) };
}

/** Parse `ametadata` print output lines (`lavfi.astats.Overall.Peak_level=-12.3`) into 0..1 peaks. */
export function parseAstatsPeaks(output: string, peaksPerSecond = 10): WaveformPeaks {
  const peaks: number[] = [];
  const re = /lavfi\.astats\.Overall\.Peak_level=(-?[0-9.]+|-inf)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const db = m[1] === '-inf' ? -Infinity : Number.parseFloat(m[1]!);
    peaks.push(Number(Math.min(1, Math.pow(10, db / 20)).toFixed(3)));
  }
  return { version: 1, peaksPerSecond, peaks, durationMs: Math.round((peaks.length / peaksPerSecond) * 1000) };
}

/** Render a command for logs/debugging only (single-quoted); never pass this string to a shell. */
export function formatCommandForLog(cmd: FfCommand): string {
  return [cmd.bin, ...cmd.args].map((a) => (/^[A-Za-z0-9_./:+=,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}
