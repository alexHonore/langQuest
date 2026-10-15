import { execFile } from 'node:child_process';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FFMPEG_CANDIDATES = [process.env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter((p): p is string => Boolean(p));

export async function findFfmpeg(): Promise<string | null> {
  for (const candidate of FFMPEG_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  try {
    const { stdout } = await execFileAsync('which', ['ffmpeg']);
    const p = stdout.trim();
    return p || null;
  } catch {
    return null;
  }
}

export const FIXTURE_FILES = {
  wav: 'tone.wav',
  mp3: 'tone.mp3',
  m4a: 'tone.m4a',
  flac: 'tone.flac',
  png: 'cover.png',
} as const;

/** Fixture metadata written into the files so tests can assert exact values. */
export const FIXTURE_TAGS = { title: 'Leçon 3 — Au café', artist: 'LangQuest Test Voice', album: 'Fixtures Unit 2', track: '3', language: 'fra' } as const;
export const FIXTURE_DURATION_SEC = 2;

/** Generate fixtures once (idempotent). Returns the directory, or null when ffmpeg is missing. */
export async function generateFixtures(): Promise<string | null> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return null;
  const dir = join(tmpdir(), 'langquest-media-fixtures-v1');
  await mkdir(dir, { recursive: true });
  const exists = async (name: string) => {
    try {
      return (await stat(join(dir, name))).size > 0;
    } catch {
      return false;
    }
  };
  const tone = ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=22050:duration=${FIXTURE_DURATION_SEC}`];
  const tags = ['-metadata', `title=${FIXTURE_TAGS.title}`, '-metadata', `artist=${FIXTURE_TAGS.artist}`, '-metadata', `album=${FIXTURE_TAGS.album}`, '-metadata', `track=${FIXTURE_TAGS.track}`, '-metadata', `language=${FIXTURE_TAGS.language}`];
  const run = (args: string[]) => execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 30_000 });
  if (!(await exists(FIXTURE_FILES.wav))) await run([...tone, '-ac', '1', '-c:a', 'pcm_s16le', join(dir, FIXTURE_FILES.wav)]);
  if (!(await exists(FIXTURE_FILES.png))) await run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', join(dir, FIXTURE_FILES.png)]);
  if (!(await exists(FIXTURE_FILES.mp3))) {
    // MP3 with ID3v2 tags and an embedded cover picture.
    await run([...tone, '-i', join(dir, FIXTURE_FILES.png), '-map', '0:a', '-map', '1:v', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-c:v', 'png', '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', ...tags, join(dir, FIXTURE_FILES.mp3)]);
  }
  if (!(await exists(FIXTURE_FILES.m4a))) await run([...tone, '-ac', '2', '-c:a', 'aac', '-b:a', '96k', ...tags, join(dir, FIXTURE_FILES.m4a)]);
  if (!(await exists(FIXTURE_FILES.flac))) await run([...tone, '-ac', '1', '-c:a', 'flac', ...tags, join(dir, FIXTURE_FILES.flac)]);
  return dir;
}

export function fixturesDir(): string | null {
  return process.env.LANGQUEST_MEDIA_FIXTURES ?? null;
}

export async function readFixture(name: keyof typeof FIXTURE_FILES): Promise<Uint8Array> {
  const dir = fixturesDir();
  if (!dir) throw new Error('fixtures not generated');
  return new Uint8Array(await readFile(join(dir, FIXTURE_FILES[name])));
}

export function fixturePath(name: keyof typeof FIXTURE_FILES): string {
  const dir = fixturesDir();
  if (!dir) throw new Error('fixtures not generated');
  return join(dir, FIXTURE_FILES[name]);
}
