import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildOverlappingSegmentCommands, buildSegmentCommand, buildToneCommand, decideTranscodeProfile, formatSegmentPath, planSegments } from './ffmpeg';
import { findFfmpeg } from './test/fixtures';

const execFileAsync = promisify(execFile);
const profile = decideTranscodeProfile({ channels: 1, bitrateKbps: null, codec: null, sampleRateHz: null, durationMs: null }).aac;

describe('planSegments', () => {
  it('plans non-overlapping chunks that cover the duration exactly', () => {
    const plan = planSegments({ durationMs: 95_000, segmentSeconds: 30 });
    expect(plan.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 30_000],
      [30_000, 60_000],
      [60_000, 90_000],
      [90_000, 95_000],
    ]);
    expect(plan.every((p) => p.overlapMs === 0)).toBe(true);
    expect(planSegments({ durationMs: 0, segmentSeconds: 30 })).toEqual([]);
  });

  it('adds overlap past each nominal end and folds a tiny tail', () => {
    const plan = planSegments({ durationMs: 95_000, segmentSeconds: 30, overlapSeconds: 2.5, minTailSeconds: 10 });
    expect(plan.map((p) => [p.index, p.startMs, p.endMs, p.overlapMs])).toEqual([
      [0, 0, 32_500, 0],
      [1, 30_000, 62_500, 2500],
      [2, 60_000, 95_000, 2500],
    ]);
    const last = planSegments({ durationMs: 60_000, segmentSeconds: 30, overlapSeconds: 5 });
    expect(last.at(-1)).toMatchObject({ startMs: 30_000, endMs: 60_000 });
  });

  it('validates arguments', () => {
    expect(() => planSegments({ durationMs: -1, segmentSeconds: 30 })).toThrow(/durationMs/);
    expect(() => planSegments({ durationMs: 10, segmentSeconds: 5 })).toThrow(/segmentSeconds/);
    expect(() => planSegments({ durationMs: 10, segmentSeconds: 30, overlapSeconds: 30 })).toThrow(/overlapSeconds/);
    expect(formatSegmentPath('/tmp/c-%03d.m4a', 7)).toBe('/tmp/c-007.m4a');
    expect(formatSegmentPath('/tmp/c-%d.m4a', 12)).toBe('/tmp/c-12.m4a');
    expect(() => formatSegmentPath('/tmp/c.m4a', 1)).toThrow(/placeholder/);
  });
});

describe('segment and tone builders', () => {
  it('buildSegmentCommand matches the apps/jobs shape', () => {
    const cmd = buildSegmentCommand({ input: '/in/master.wav', outputPattern: '/out/chunk-%03d.m4a', segmentSeconds: 600, profile });
    expect(cmd.bin).toBe('ffmpeg');
    expect(cmd.args).toEqual(expect.arrayContaining(['-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', '-segment_format', 'mp4', '-c:a', 'aac']));
    expect(cmd.args.at(-1)).toBe('/out/chunk-%03d.m4a');
    expect(cmd.args).not.toContain('-ss');
    const opus = buildSegmentCommand({ input: '/in/master.wav', outputPattern: '/out/chunk-%03d.ogg', segmentSeconds: 60, profile: { ...profile, codec: 'opus' } });
    expect(opus.args).toEqual(expect.arrayContaining(['-c:a', 'libopus', '-segment_format', 'ogg']));
    expect(() => buildSegmentCommand({ input: '/in/x', outputPattern: '/out/x.m4a', segmentSeconds: 60, profile })).toThrow(/%03d/);
    expect(() => buildSegmentCommand({ input: '/in/x', outputPattern: '/out/%03d', segmentSeconds: 5, profile })).toThrow(/segmentSeconds/);
    expect(() => buildSegmentCommand({ input: '-i', outputPattern: '/out/%03d', segmentSeconds: 60, profile })).toThrow(/option/);
  });

  it('buildOverlappingSegmentCommands emits one sample-accurate cut per planned chunk', () => {
    const cmds = buildOverlappingSegmentCommands({ input: '/in/master.wav', outputPattern: '/out/chunk-%03d.m4a', segmentSeconds: 30, overlapSeconds: 2, durationMs: 65_000, profile });
    expect(cmds.map((c) => c.output)).toEqual(['/out/chunk-000.m4a', '/out/chunk-001.m4a', '/out/chunk-002.m4a']);
    expect(cmds[1]!.command.args).toEqual(expect.arrayContaining(['-ss', '30.000', '-to', '62.000', '-c:a', 'aac', '-f', 'mp4']));
    expect(cmds[2]!.segment).toMatchObject({ startMs: 60_000, endMs: 65_000, overlapMs: 2000 });
    expect(cmds.every((c) => c.command.args.indexOf('-ss') > c.command.args.indexOf('-i'))).toBe(true);
  });

  it('buildToneCommand builds lavfi sine/silence fixtures', () => {
    const wav = buildToneCommand({ output: '/tmp/t.wav', seconds: 2 });
    expect(wav.args).toEqual(expect.arrayContaining(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-ac', '1', '-c:a', 'pcm_s16le', '/tmp/t.wav']));
    const mp3 = buildToneCommand({ output: '/tmp/t.mp3', seconds: 1.5, frequencyHz: 220, sampleRateHz: 22050, channels: 2, format: 'mp3' });
    expect(mp3.args).toEqual(expect.arrayContaining(['sine=frequency=220:sample_rate=22050:duration=1.5', '-ac', '2', '-c:a', 'libmp3lame']));
    const silence = buildToneCommand({ output: '/tmp/s.flac', seconds: 3, kind: 'silence', format: 'flac', channels: 2 });
    expect(silence.args).toEqual(expect.arrayContaining(['anullsrc=r=44100:cl=stereo', '-t', '3', '-c:a', 'flac']));
    expect(buildToneCommand({ output: '/tmp/t.m4a', seconds: 1, format: 'm4a' }).args).toContain('aac');
    expect(() => buildToneCommand({ output: '/tmp/t.wav', seconds: 0 })).toThrow(/seconds/);
    expect(() => buildToneCommand({ output: '-o', seconds: 1 })).toThrow(/option/);
  });

  it('generates a tone and segments it with real ffmpeg when available', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) return;
    const dir = await mkdtemp(join(tmpdir(), 'lq-seg-'));
    const tone = buildToneCommand({ output: join(dir, 'tone.wav'), seconds: 25, sampleRateHz: 16000 });
    await execFileAsync(ffmpeg, tone.args);
    const seg = buildSegmentCommand({ input: join(dir, 'tone.wav'), outputPattern: join(dir, 'chunk-%03d.m4a'), segmentSeconds: 10, profile });
    await execFileAsync(ffmpeg, seg.args);
    const chunks = (await readdir(dir)).filter((f) => f.startsWith('chunk-')).sort();
    expect(chunks).toEqual(['chunk-000.m4a', 'chunk-001.m4a', 'chunk-002.m4a']);
    const overlapping = buildOverlappingSegmentCommands({ input: join(dir, 'tone.wav'), outputPattern: join(dir, 'ov-%03d.m4a'), segmentSeconds: 10, overlapSeconds: 1, durationMs: 25_000, profile });
    for (const c of overlapping) await execFileAsync(ffmpeg, c.command.args);
    expect((await readdir(dir)).filter((f) => f.startsWith('ov-')).sort()).toEqual(['ov-000.m4a', 'ov-001.m4a', 'ov-002.m4a']);
  });
});
