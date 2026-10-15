/**
 * FFmpeg / ffprobe execution for the Node runner (§7.2: "background transcode with an actual audio
 * processor … do not assume Workers can run FFmpeg"). Commands are built by `@langquest/media` as
 * argument arrays and executed here with `spawn(bin, args)` — never through a shell.
 */
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import type { FfCommand, RenditionProfile } from '@langquest/media';
import { assertSafePath, buildProbeCommand, parseProbeOutput, type ProbeSummary } from '@langquest/media';

export interface FfRunnerOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Default per-invocation timeout. */
  timeoutMs?: number;
}

export interface FfRunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  /** Wall-clock milliseconds. */
  durationMs: number;
  /** User+system CPU time of the child when available. */
  cpuMs: number | null;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly command: FfCommand,
    readonly result: Pick<FfRunResult, 'exitCode' | 'stderr'> | null,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface FfRunner {
  run(cmd: FfCommand, options?: { timeoutMs?: number; signal?: AbortSignal; maxStdoutBytes?: number }): Promise<FfRunResult>;
  probe(path: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ProbeSummary>;
  /** Resolves true when both binaries are executable. */
  available(): Promise<boolean>;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

/** Create a runner bound to specific binaries (defaults to `ffmpeg` / `ffprobe` on PATH). */
export function createFfRunner(options: FfRunnerOptions = {}): FfRunner {
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const defaultTimeout = options.timeoutMs ?? 30 * 60_000;

  const binFor = (cmd: FfCommand): string => (cmd.bin === 'ffprobe' ? ffprobePath : ffmpegPath);

  async function run(cmd: FfCommand, runOptions: { timeoutMs?: number; signal?: AbortSignal; maxStdoutBytes?: number } = {}): Promise<FfRunResult> {
    const maxStdout = runOptions.maxStdoutBytes ?? 512 * 1024 * 1024;
    const startedAt = Date.now();
    return new Promise<FfRunResult>((resolvePromise, reject) => {
      const child = spawn(binFor(cmd), cmd.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = '';
      let timedOut = false;
      let aborted = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, runOptions.timeoutMs ?? defaultTimeout);

      const onAbort = () => {
        aborted = true;
        child.kill('SIGTERM');
      };
      runOptions.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxStdout) {
          child.kill('SIGKILL');
          stderr += `\n[jobs] stdout exceeded ${maxStdout} bytes`;
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        runOptions.signal?.removeEventListener('abort', onAbort);
        reject(new FfmpegError(`Failed to start ${cmd.bin}: ${error.message}`, cmd, null));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        runOptions.signal?.removeEventListener('abort', onAbort);
        // Node does not expose a child's own CPU time; wall-clock duration is the honest measure we report.
        const result: FfRunResult = { stdout: Buffer.concat(stdoutChunks), stderr, exitCode: code ?? -1, durationMs: Date.now() - startedAt, cpuMs: null };
        if (timedOut) return reject(new FfmpegError(`${cmd.bin} timed out after ${runOptions.timeoutMs ?? defaultTimeout} ms`, cmd, result));
        if (aborted) return reject(new FfmpegError(`${cmd.bin} aborted (shutdown)`, cmd, result));
        if (code !== 0) return reject(new FfmpegError(`${cmd.bin} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`, cmd, result));
        resolvePromise(result);
      });
    });
  }

  async function probe(path: string, probeOptions: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProbeSummary> {
    const res = await run(buildProbeCommand(path), { timeoutMs: probeOptions.timeoutMs ?? 60_000, signal: probeOptions.signal });
    return parseProbeOutput(res.stdout.toString('utf8'));
  }

  async function available(): Promise<boolean> {
    const check = async (bin: string): Promise<boolean> => {
      if (bin.includes('/')) {
        try {
          await access(bin, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }
      return new Promise((res) => {
        const child = spawn(bin, ['-version'], { stdio: 'ignore' });
        child.on('error', () => res(false));
        child.on('close', (code) => res(code === 0));
      });
    };
    return (await check(ffmpegPath)) && (await check(ffprobePath));
  }

  return { run, probe, available, ffmpegPath, ffprobePath };
}

const COMMON_FLAGS = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'] as const;

/**
 * Split audio into fixed-length chunks for transcription (OpenRouter caps uploads at 25 MB and most STT
 * models degrade on very long inputs). Chunks are re-encoded with the given speech profile so every chunk
 * is small; the master is never modified. `outputPattern` must contain `%03d`.
 */
export function buildSegmentCommand(opts: { input: string; outputPattern: string; segmentSeconds: number; profile: RenditionProfile }): FfCommand {
  if (!Number.isInteger(opts.segmentSeconds) || opts.segmentSeconds < 10) throw new Error('segmentSeconds must be an integer ≥ 10');
  if (!opts.outputPattern.includes('%03d')) throw new Error('outputPattern must contain %03d');
  const { profile } = opts;
  const args: string[] = [...COMMON_FLAGS, '-i', assertSafePath(opts.input, 'input'), '-vn', '-map_metadata', '-1', '-ac', String(profile.channels), '-ar', String(profile.sampleRateHz)];
  if (profile.codec === 'aac') args.push('-c:a', 'aac', '-b:a', `${profile.bitrateKbps}k`);
  else args.push('-c:a', 'libopus', '-b:a', `${profile.bitrateKbps}k`);
  args.push('-f', 'segment', '-segment_time', String(opts.segmentSeconds), '-reset_timestamps', '1');
  if (profile.codec === 'aac') args.push('-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart');
  else args.push('-segment_format', 'ogg');
  args.push(assertSafePath(opts.outputPattern, 'outputPattern'));
  return { bin: 'ffmpeg', args };
}

/** Synthesize a test tone / silence WAV (fixtures and smoke tests). */
export function buildToneCommand(opts: { output: string; seconds: number; frequencyHz?: number; sampleRateHz?: number; channels?: 1 | 2; format?: 'wav' | 'mp3' }): FfCommand {
  const rate = opts.sampleRateHz ?? 44100;
  const ch = opts.channels ?? 1;
  const expr = `sine=frequency=${opts.frequencyHz ?? 440}:sample_rate=${rate}:duration=${opts.seconds}`;
  const args: string[] = [...COMMON_FLAGS, '-f', 'lavfi', '-i', expr, '-ac', String(ch)];
  if (opts.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '64k');
  else args.push('-c:a', 'pcm_s16le');
  args.push(assertSafePath(opts.output, 'output'));
  return { bin: 'ffmpeg', args };
}
