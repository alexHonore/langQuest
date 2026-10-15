/**
 * File-system helpers shared by the scripts: repo-root resolution, `.env` loading, streaming
 * line readers (including `.bz2` via the system `bzip2`, so no corpus is ever decompressed to
 * disk), SHA-256 of files, and JSONL read/write.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { hashNodeStream } from '@langquest/media';

/** Absolute path of the repository root (the directory holding `pnpm-workspace.yaml`). */
export function repoRoot(): string {
  const env = process.env.LANGQUEST_REPO_ROOT;
  if (env) return resolve(env);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/** Load the repo-root `.env` into `process.env` (never overrides existing values). */
export function loadRootEnv(): void {
  const file = resolve(repoRoot(), '.env');
  if (existsSync(file)) loadDotenv({ path: file, override: false, quiet: true });
}

export const ensureDirSync = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};
export const ensureDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
};

export const fileExists = (path: string): boolean => existsSync(path);
export const fileSize = (path: string): number => statSync(path).size;

/** SHA-256 hex of a file (streamed; never loads the whole file in memory). */
export async function sha256File(path: string): Promise<{ sha256: string; byteLength: number }> {
  const stream = createReadStream(path);
  return hashNodeStream(stream);
}

/** Async iterator over the lines of a plain text file or a `.bz2` file (decompressed with the system bzip2). */
export async function* readLines(path: string, options: { bzip2Bin?: string } = {}): AsyncGenerator<string> {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  if (path.endsWith('.bz2')) {
    const child = spawn(options.bzip2Bin ?? 'bzip2', ['-dc', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const exit = new Promise<number | null>((res) => child.on('close', (code) => res(code)));
    let drained = false;
    try {
      for await (const line of rl) yield line;
      drained = true;
    } finally {
      rl.close();
      if (!drained) {
        // Early exit (caller broke out of the loop): stop the decompressor so it does not block on a full pipe
        // and keep the process alive.
        child.stdout.destroy();
        child.kill('SIGTERM');
      }
    }
    const code = await exit;
    if (code !== 0) throw new Error(`bzip2 -dc ${path} failed (exit ${code}): ${stderr.trim()}`);
    return;
  }
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}

/** Write records as JSON Lines (one JSON object per line). Creates parent directories. */
export async function writeJsonl(path: string, records: Iterable<unknown>): Promise<number> {
  await ensureDir(dirname(path));
  let n = 0;
  const chunks: string[] = [];
  for (const r of records) {
    chunks.push(JSON.stringify(r));
    n += 1;
  }
  await writeFile(path, chunks.length ? chunks.join('\n') + '\n' : '', 'utf8');
  return n;
}

/** Append records as JSON Lines. */
export async function appendJsonl(path: string, records: Iterable<unknown>): Promise<number> {
  await ensureDir(dirname(path));
  let n = 0;
  const chunks: string[] = [];
  for (const r of records) {
    chunks.push(JSON.stringify(r));
    n += 1;
  }
  if (chunks.length) await appendFile(path, chunks.join('\n') + '\n', 'utf8');
  return n;
}

/** Read every record of a JSON Lines file (blank lines ignored). */
export async function* readJsonl<T = unknown>(path: string): AsyncGenerator<T> {
  for await (const line of readLines(path)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed) as T;
  }
}

export const readJsonFile = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const writeJsonFileSync = (path: string, value: unknown): void => {
  ensureDirSync(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
};
export const writeTextFileSync = (path: string, text: string): void => {
  ensureDirSync(dirname(path));
  writeFileSync(path, text, 'utf8');
};

/** ISO timestamp without milliseconds, safe in filenames when `forFilename` is set. */
export function nowStamp(forFilename = false, now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return forFilename ? iso.replace(/[:]/g, '-') : iso;
}
