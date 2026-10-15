import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertSafePath, buildAstatsPeaksCommand, buildClipCommand, buildCoverExtractCommand, buildPcmPeaksCommand, buildProbeCommand, buildSlowCommand, buildTranscodeCommand, decideTranscodeProfile, formatCommandForLog, parseAstatsPeaks, parseProbeOutput, peaksFromPcm, shouldTranscode } from './ffmpeg';
import { extractAudioMetadata } from './metadata';
import { findFfmpeg, fixturePath, fixturesDir } from './test/fixtures';

const execFileAsync = promisify(execFile);
const hasFixtures = Boolean(fixturesDir());

describe('command builders', () => {
  it('build argument arrays without shell interpolation', () => {
    const weird = "/tmp/It's a; $(rm -rf) `x`.mp3";
    const probe = buildProbeCommand(weird);
    expect(probe.bin).toBe('ffprobe');
    expect(probe.args[probe.args.length - 1]).toBe(weird);
    expect(probe.args).toContain('-show_streams');
    expect(formatCommandForLog(probe)).toContain("'/tmp/It'\\''s a; $(rm -rf) `x`.mp3'");
    expect(() => assertSafePath('-i')).toThrow(/option/);
    expect(() => buildProbeCommand('--version')).toThrow();
    expect(() => buildProbeCommand('a\u0000b')).toThrow(/NUL/);
  });

  it('decides mono/stereo bitrates and skips pointless transcodes', () => {
    const mono = decideTranscodeProfile({ channels: 1, bitrateKbps: 128, codec: 'mp3', sampleRateHz: 44100, durationMs: 1000 });
    expect(mono.aac).toMatchObject({ bitrateKbps: 64, channels: 1, ext: 'm4a' });
    expect(mono.opus).toMatchObject({ bitrateKbps: 32, channels: 1, sampleRateHz: 48000 });
    const stereo = decideTranscodeProfile({ channels: 2, bitrateKbps: 320, codec: 'mp3', sampleRateHz: 48000, durationMs: 1000 });
    expect(stereo.aac).toMatchObject({ bitrateKbps: 96, channels: 2, sampleRateHz: 44100 });
    expect(decideTranscodeProfile({ channels: 2, bitrateKbps: 128, codec: 'mp3', sampleRateHz: 22050, durationMs: 1, speechOnly: true }).aac.channels).toBe(1);
    expect(shouldTranscode({ channels: 1, bitrateKbps: 64, codec: 'aac', sampleRateHz: 44100, durationMs: 1 }, mono.aac).transcode).toBe(false);
    expect(shouldTranscode({ channels: 1, bitrateKbps: 48, codec: 'mp3', sampleRateHz: 44100, durationMs: 1 }, mono.aac).transcode).toBe(false);
    expect(shouldTranscode({ channels: 1, bitrateKbps: 192, codec: 'mp3', sampleRateHz: 44100, durationMs: 1 }, mono.aac).transcode).toBe(true);
    expect(shouldTranscode({ channels: 2, bitrateKbps: 128, codec: 'aac', sampleRateHz: 44100, durationMs: 1 }, mono.aac).transcode).toBe(true);
  });

  it('builds transcode/slow/clip/cover commands', () => {
    const profile = decideTranscodeProfile({ channels: 1, bitrateKbps: 128, codec: 'mp3', sampleRateHz: 44100, durationMs: 1 });
    const aac = buildTranscodeCommand({ input: 'in.mp3', output: 'out.m4a', profile: profile.aac, loudnessNormalize: true });
    expect(aac.args).toEqual(expect.arrayContaining(['-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-map_metadata', '-1']));
    expect(aac.args.join(' ')).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    const opus = buildTranscodeCommand({ input: 'in.mp3', output: 'out.ogg', profile: profile.opus });
    expect(opus.args).toEqual(expect.arrayContaining(['-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg']));
    expect(opus.args.join(' ')).not.toContain('loudnorm');
    const slow = buildSlowCommand({ input: 'in.mp3', output: 'slow.m4a', factor: 0.75, profile: profile.aac });
    expect(slow.args).toEqual(expect.arrayContaining(['-af', 'atempo=0.75']));
    expect(slow.args.join(' ')).not.toContain('asetrate');
    expect(() => buildSlowCommand({ input: 'in.mp3', output: 'x', factor: 0.5 as never, profile: profile.aac })).toThrow();
    const clipCopy = buildClipCommand({ input: 'in.mp3', output: 'clip.mp3', startMs: 1500, endMs: 4250, mode: 'copy' });
    expect(clipCopy.args.slice(5, 11)).toEqual(['-ss', '1.500', '-to', '4.250', '-i', 'in.mp3']);
    const clipEncode = buildClipCommand({ input: 'in.mp3', output: 'clip.m4a', startMs: 1500, endMs: 4250 });
    expect(clipEncode.args.indexOf('-ss')).toBeGreaterThan(clipEncode.args.indexOf('-i'));
    expect(() => buildClipCommand({ input: 'a', output: 'b', startMs: 10, endMs: 10 })).toThrow();
    expect(buildCoverExtractCommand({ input: 'in.mp3', output: 'cover.png' }).args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-c:v', 'copy']));
    expect(buildPcmPeaksCommand({ input: 'in.mp3' }).args).toEqual(expect.arrayContaining(['-f', 's8', 'pipe:1']));
    expect(buildAstatsPeaksCommand({ input: 'in.mp3', peaksPerSecond: 4, sampleRate: 8000 }).args.join(' ')).toContain('asetnsamples=n=2000');
  });

  it('parses ffprobe json and astats output', () => {
    const summary = parseProbeOutput(JSON.stringify({
      streams: [
        { index: 0, codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2, bit_rate: '128000', duration: '2.5' },
        { index: 1, codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } },
      ],
      format: { format_name: 'mp3', duration: '2.50', size: '40000', bit_rate: '128000', tags: { TITLE: 'x' } },
    }));
    expect(summary).toMatchObject({ container: 'mp3', codec: 'mp3', durationMs: 2500, bitrateKbps: 128, sampleRateHz: 44100, channels: 2, byteLength: 40000, hasCover: true, tags: { title: 'x' } });
    expect(() => parseProbeOutput('{not json')).toThrow();
    const peaks = parseAstatsPeaks('frame:0 pts:0\nlavfi.astats.Overall.Peak_level=-6.020\nlavfi.astats.Overall.Peak_level=-inf\nlavfi.astats.Overall.Peak_level=0.000', 2);
    expect(peaks.peaks).toEqual([0.5, 0, 1]);
    expect(peaks.durationMs).toBe(1500);
    const pcm = new Uint8Array([0, 127, 0x80, 10, 0, 0, 0, 0]);
    expect(peaksFromPcm(pcm, 4, 1).peaks).toEqual([1, 0]);
    expect(peaksFromPcm(new Uint8Array([0, 127]), 1, 1).peaks).toEqual([0, 0.992]);
  });
});

describe.skipIf(!hasFixtures)('commands run against real ffmpeg', () => {
  async function bins() {
    const ffmpeg = (await findFfmpeg())!;
    return { ffmpeg, ffprobe: join(dirname(ffmpeg), 'ffprobe') };
  }

  it('probe output parses for the MP3 fixture', async () => {
    const { ffprobe } = await bins();
    const cmd = buildProbeCommand(fixturePath('mp3'));
    const { stdout } = await execFileAsync(ffprobe, cmd.args);
    const summary = parseProbeOutput(stdout);
    expect(summary.codec).toBe('mp3');
    expect(summary.channels).toBe(1);
    expect(summary.hasCover).toBe(true);
    expect(summary.durationMs).toBeGreaterThan(1800);
    expect(summary.tags.title).toBe('Leçon 3 — Au café');
  });

  it('transcodes WAV → AAC and produces a slow version and a clip', async () => {
    const { ffmpeg } = await bins();
    const dir = await mkdtemp(join(tmpdir(), 'lq-ff-'));
    const profile = decideTranscodeProfile({ channels: 1, bitrateKbps: null, codec: 'pcm_s16le', sampleRateHz: 22050, durationMs: 2000 });
    const out = join(dir, 'out.m4a');
    await execFileAsync(ffmpeg, buildTranscodeCommand({ input: fixturePath('wav'), output: out, profile: profile.aac }).args);
    const meta = await extractAudioMetadata(new Uint8Array(await readFile(out)), undefined, { declaredMimeType: 'audio/mp4' });
    expect(meta.codec).toMatch(/AAC/i);
    expect(meta.channels).toBe(1);
    expect(meta.durationMs).toBeGreaterThan(1800);
    const slow = join(dir, 'slow.m4a');
    await execFileAsync(ffmpeg, buildSlowCommand({ input: fixturePath('wav'), output: slow, factor: 0.75, profile: profile.aac }).args);
    const slowMeta = await extractAudioMetadata(new Uint8Array(await readFile(slow)));
    expect(slowMeta.durationMs).toBeGreaterThan(2500);
    const clip = join(dir, 'clip.m4a');
    await execFileAsync(ffmpeg, buildClipCommand({ input: fixturePath('wav'), output: clip, startMs: 500, endMs: 1000, profile: profile.aac }).args);
    const clipMeta = await extractAudioMetadata(new Uint8Array(await readFile(clip)));
    expect(clipMeta.durationMs).toBeGreaterThan(400);
    expect(clipMeta.durationMs).toBeLessThan(700);
    const cover = join(dir, 'cover.png');
    await execFileAsync(ffmpeg, buildCoverExtractCommand({ input: fixturePath('mp3'), output: cover }).args);
    expect((await stat(cover)).size).toBeGreaterThan(0);
  });

  it('extracts waveform peaks from PCM', async () => {
    const { ffmpeg } = await bins();
    const { stdout } = await execFileAsync(ffmpeg, buildPcmPeaksCommand({ input: fixturePath('wav'), sampleRate: 8000 }).args, { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
    const peaks = peaksFromPcm(new Uint8Array(stdout), 8000, 10);
    expect(peaks.peaks.length).toBeGreaterThanOrEqual(19);
    expect(peaks.peaks.length).toBeLessThanOrEqual(21);
    // lavfi `sine` is generated at a low fixed amplitude; the point is that peaks are non-trivial and bounded.
    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.05);
    expect(Math.max(...peaks.peaks)).toBeLessThanOrEqual(1);
  });
});
