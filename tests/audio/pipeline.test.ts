/**
 * §7.2 / §4.4 audio fixture pipeline with the REAL ffmpeg/ffprobe binaries: fixtures are rendered on the fly
 * (sine tones with tags), probed with `buildProbeCommand` → `parseProbeOutput`, measured with `extractAudioMetadata`,
 * hashed with the streaming/sync hashers and the multipart checksum contract, transcoded/slowed/clipped with the
 * command builders, and peak-extracted for waveforms. Skips loudly when ffmpeg is not installed.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClipCommand, buildPcmPeaksCommand, buildProbeCommand, buildSlowCommand, buildTranscodeCommand, decideTranscodeProfile, formatCommandForLog, parseProbeOutput, peaksFromPcm, shouldTranscode, type FfCommand } from '@langquest/media/ffmpeg';
import { computeMultipartChecksum, hashNodeStream, sha256Hex, sha256HexSync, verifyMultipartChecksum } from '@langquest/media/hashing';
import { ContentTypeMismatchError, extractAudioMetadata, sniffContainer, verifyDeclaredContentType } from '@langquest/media/metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeWithPrerequisite } from '../src/harness';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 && spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;
const describeFfmpeg = describeWithPrerequisite('audio.pipeline', hasFfmpeg, 'ffmpeg and ffprobe must be on PATH (brew install ffmpeg).');

function run(cmd: FfCommand, opts: { stdoutBinary?: boolean } = {}): { status: number | null; stdout: Buffer | string; stderr: string } {
  const res = spawnSync(cmd.bin, cmd.args, { encoding: opts.stdoutBinary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status, stdout: res.stdout as Buffer | string, stderr: String(res.stderr ?? '') };
}

describeFfmpeg('audio fixture pipeline (ffmpeg)', () => {
  let dir: string;
  let mp3: string;
  let wav: string;
  const DURATION_S = 2;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'langquest-audio-'));
    mp3 = join(dir, 'fixture.mp3');
    wav = join(dir, 'fixture.wav');
    const sine = `sine=frequency=440:duration=${DURATION_S}:sample_rate=44100`;
    const mp3Res = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', sine, '-metadata', 'title=Darija lesson 1', '-metadata', 'artist=LangQuest Test Narrator', '-metadata', 'album=Everyday Darija', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-id3v2_version', '3', mp3], { encoding: 'utf8' });
    if (mp3Res.status !== 0) throw new Error(`fixture mp3 failed: ${mp3Res.stderr}`);
    const wavRes = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', sine, '-ac', '2', '-c:a', 'pcm_s16le', wav], { encoding: 'utf8' });
    if (wavRes.status !== 0) throw new Error(`fixture wav failed: ${wavRes.stderr}`);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('ffprobe → parseProbeOutput reports duration, codec, sample rate, channels and tags', () => {
    const probe = run(buildProbeCommand(mp3));
    expect(probe.status, probe.stderr).toBe(0);
    const summary = parseProbeOutput(String(probe.stdout));
    expect(summary.codec).toBe('mp3');
    expect(summary.container).toContain('mp3');
    expect(summary.channels).toBe(1);
    expect(summary.sampleRateHz).toBe(44100);
    expect(summary.durationMs).toBeGreaterThanOrEqual(DURATION_S * 1000 - 150);
    expect(summary.durationMs).toBeLessThanOrEqual(DURATION_S * 1000 + 250);
    expect(summary.tags.title).toBe('Darija lesson 1');
    expect(summary.tags.artist).toBe('LangQuest Test Narrator');
    expect(summary.byteLength).toBe(statSync(mp3).size);
    expect(summary.hasCover).toBe(false);
    expect(summary.chapters).toEqual([]);
    const wavSummary = parseProbeOutput(String(run(buildProbeCommand(wav)).stdout));
    expect(wavSummary.codec).toBe('pcm_s16le');
    expect(wavSummary.channels).toBe(2);
  });

  it('extractAudioMetadata agrees with ffprobe and sniffs the container; spoofed content types are rejected', async () => {
    const bytes = new Uint8Array(readFileSync(mp3));
    expect(sniffContainer(bytes.subarray(0, 16))?.format).toBe('mp3');
    expect(verifyDeclaredContentType('audio/mpeg', bytes.subarray(0, 16)).ok).toBe(true);
    expect(verifyDeclaredContentType('audio/wav', bytes.subarray(0, 16)).ok).toBe(false);
    const meta = await extractAudioMetadata(bytes, 'fixture.mp3', { declaredMimeType: 'audio/mpeg' });
    expect(meta.container?.toLowerCase()).toContain('mpeg');
    expect(meta.codec?.toLowerCase()).toContain('mp');
    expect(meta.channels).toBe(1);
    expect(meta.sampleRateHz).toBe(44100);
    expect(Math.abs((meta.durationMs ?? 0) - DURATION_S * 1000)).toBeLessThan(250);
    expect(meta.tags.title).toBe('Darija lesson 1');
    expect(meta.tags.album).toBe('Everyday Darija');
    expect(meta.lossless).toBe(false);
    await expect(extractAudioMetadata(bytes, 'fixture.mp3', { declaredMimeType: 'image/png' })).rejects.toBeInstanceOf(ContentTypeMismatchError);
    const wavMeta = await extractAudioMetadata(createReadStream(wav), 'fixture.wav', { declaredMimeType: 'audio/wav' });
    expect(wavMeta.channels).toBe(2);
    expect(wavMeta.lossless).toBe(true);
  });

  it('hashes are identical across sync, WebCrypto and Node-stream paths, and the multipart contract verifies', async () => {
    const bytes = new Uint8Array(readFileSync(mp3));
    const sync = sha256HexSync(bytes);
    expect(await sha256Hex(bytes)).toBe(sync);
    const streamed = await hashNodeStream(createReadStream(mp3));
    expect(streamed).toEqual({ sha256: sync, byteLength: bytes.byteLength });
    const partSize = 4096;
    const multipart = await computeMultipartChecksum(bytes, partSize);
    expect(multipart.wholeFileSha256).toBe(sync);
    expect(multipart.parts.length).toBe(Math.ceil(bytes.byteLength / partSize));
    expect(multipart.compositeSha256).toMatch(new RegExp(`-${multipart.parts.length}$`));
    expect(verifyMultipartChecksum(multipart)).toEqual({ ok: true });
    const tampered = { ...multipart, parts: multipart.parts.map((p, i) => (i === 0 ? { ...p, sha256: 'f'.repeat(64) } : p)) };
    expect(verifyMultipartChecksum(tampered).ok).toBe(false);
  });

  it('transcode builders produce playable AAC/Opus renditions with the expected layout', () => {
    const source = parseProbeOutput(String(run(buildProbeCommand(wav)).stdout));
    const profiles = decideTranscodeProfile({ channels: source.channels, bitrateKbps: source.bitrateKbps, codec: source.codec, sampleRateHz: source.sampleRateHz, durationMs: source.durationMs, speechOnly: true });
    expect(profiles.aac.channels).toBe(1); // speech: stereo carries no information
    expect(shouldTranscode({ channels: 2, bitrateKbps: 1411, codec: 'pcm_s16le', sampleRateHz: 44100, durationMs: 2000 }, profiles.aac).transcode).toBe(true);
    const aacOut = join(dir, 'rendition.m4a');
    const aac = run(buildTranscodeCommand({ input: wav, output: aacOut, profile: profiles.aac }));
    expect(aac.status, aac.stderr).toBe(0);
    const aacProbe = parseProbeOutput(String(run(buildProbeCommand(aacOut)).stdout));
    expect(aacProbe.codec).toBe('aac');
    expect(aacProbe.channels).toBe(1);
    expect(aacProbe.sampleRateHz).toBe(profiles.aac.sampleRateHz);
    expect(Math.abs((aacProbe.durationMs ?? 0) - DURATION_S * 1000)).toBeLessThan(300);
    expect(aacProbe.tags.title).toBeUndefined(); // metadata is stripped from renditions by default
    const opusOut = join(dir, 'rendition.ogg');
    const opus = run(buildTranscodeCommand({ input: wav, output: opusOut, profile: profiles.opus }));
    expect(opus.status, opus.stderr).toBe(0);
    expect(parseProbeOutput(String(run(buildProbeCommand(opusOut)).stdout)).codec).toBe('opus');
    expect(formatCommandForLog(buildTranscodeCommand({ input: wav, output: aacOut, profile: profiles.aac }))).toContain('ffmpeg -hide_banner');
  });

  it('slow renditions keep pitch and stretch duration by the factor; clips are sample-accurate', () => {
    const profile = decideTranscodeProfile({ channels: 1, bitrateKbps: 64, codec: 'mp3', sampleRateHz: 44100, durationMs: 2000 }).aac;
    const slowOut = join(dir, 'slow.m4a');
    const slow = run(buildSlowCommand({ input: mp3, output: slowOut, factor: 0.75, profile }));
    expect(slow.status, slow.stderr).toBe(0);
    const slowMs = parseProbeOutput(String(run(buildProbeCommand(slowOut)).stdout)).durationMs ?? 0;
    expect(Math.abs(slowMs - (DURATION_S * 1000) / 0.75)).toBeLessThan(350);
    const clipOut = join(dir, 'clip.m4a');
    const clip = run(buildClipCommand({ input: mp3, output: clipOut, startMs: 500, endMs: 1500, mode: 'encode', profile }));
    expect(clip.status, clip.stderr).toBe(0);
    const clipMs = parseProbeOutput(String(run(buildProbeCommand(clipOut)).stdout)).durationMs ?? 0;
    expect(Math.abs(clipMs - 1000)).toBeLessThan(200);
    expect(() => buildClipCommand({ input: mp3, output: clipOut, startMs: 900, endMs: 100 })).toThrow();
    expect(() => buildSlowCommand({ input: '-evil', output: clipOut, factor: 0.75, profile })).toThrow();
  });

  it('waveform peaks come from decoded PCM, not from a fake curve: a sine gives uniform non-zero peaks', () => {
    const cmd = buildPcmPeaksCommand({ input: mp3, sampleRate: 8000 });
    const res = run(cmd, { stdoutBinary: true });
    expect(res.status, res.stderr).toBe(0);
    const pcm = new Uint8Array(res.stdout as Buffer);
    expect(pcm.byteLength).toBeGreaterThan(8000 * DURATION_S * 0.9);
    const peaks = peaksFromPcm(pcm, 8000, 10);
    expect(peaks.version).toBe(1);
    expect(peaks.peaks.length).toBeGreaterThanOrEqual(DURATION_S * 10 - 1);
    expect(Math.abs(peaks.durationMs - DURATION_S * 1000)).toBeLessThan(300);
    const inner = peaks.peaks.slice(1, -1);
    // lavfi's sine is quiet (~-18 dBFS); what matters is that every window is non-silent and uniform.
    expect(Math.min(...inner)).toBeGreaterThan(0.05);
    expect(Math.max(...inner)).toBeLessThanOrEqual(1);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.1);
    expect(existsSync(mp3)).toBe(true);
  });
});
