#!/usr/bin/env tsx
/**
 * synthesize-bundle-audio — natural AI voices for every line of the Flutter app's courses, bundled with the app.
 *
 * Without them, a learner who is not signed in (or offline) hears the device's own synthesizer, often robotic. Each
 * line of the bundled courses (`apps/mobile_flutter/assets/content/chapters/<trackId>.json`) is read once by the voice `lib/bundle-voices.ts` casts
 * for it (the mission's character, or the learner's role, so the two sides of a dialogue sound different), loudness
 * normalised and saved as `apps/mobile_flutter/assets/audio/lines/<voice>-<sha>.mp3`; `assets/content/voices.json`
 * maps each expression id to its clip and voice. Slow playback is done by the app (a slower playback rate), so one
 * clip serves both speeds. The clips are synthetic and the app says so.
 *
 * Every new clip is checked before it is kept: a listening model writes down what it hears without being told the
 * line, then compares it with the line and rates how natural the voice sounds; a clip that does not say the line or
 * sounds below 8/10 is synthesized again (`--attempts`, 3 by default), since a TTS model occasionally garbles a line.
 * A line no take passes stays without a bundled clip (the app then uses the server's voice or the device's).
 *
 * Needs `OPENROUTER_API_KEY` in the environment (never printed) and `ffmpeg`. Existing clips are kept (a line is
 * synthesized again only when its text or voice changes).
 *
 * Usage: OPENROUTER_API_KEY=… pnpm --filter @langquest/scripts synthesize-bundle-audio [-- --track spanish-spain] [-- --limit 5] [-- --dry-run]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { repoRoot, writeTextFileSync } from './lib/io';
import { BUNDLE_VOICES, voiceForLine, type BundleVoice } from './lib/bundle-voices';
import { readBundleChapters } from './lib/flutter-bundle';

export const LINES_DIR = 'apps/mobile_flutter/assets/audio/lines';
export const VOICES_FILE = 'apps/mobile_flutter/assets/content/voices.json';

export const spec: CliSpec = {
  name: 'synthesize-bundle-audio',
  summary: 'Synthesize every bundled course line with natural AI voices (character vs learner) into the Flutter assets.',
  flags: [
    { name: 'track', type: 'string', description: 'Only this course track.' },
    { name: 'limit', type: 'number', description: 'Synthesize at most this many new clips.', default: 0 },
    { name: 'concurrency', type: 'number', description: 'Parallel requests.', default: 4 },
    { name: 'no-verify', type: 'boolean', description: 'Keep clips without the listening check.', default: false },
    { name: 'attempts', type: 'number', description: 'Takes tried per clip before giving up.', default: 3 },
  ],
  examples: ['synthesize-bundle-audio -- --dry-run', 'synthesize-bundle-audio -- --track spanish-spain --limit 3'],
};

interface Line {
  expressionId: string;
  trackId: string;
  text: string;
  voice: BundleVoice;
}

/** A clip's file name: the voice and a hash of what it says (so a changed line gets a new clip). */
export const clipName = (voice: BundleVoice, text: string): string =>
  `${voice.id}-${createHash('sha256').update(`${voice.model}|${voice.voice}|${voice.instructions ?? ''}|${text}`).digest('hex').slice(0, 16)}.mp3`;

/** A chapter of the Flutter bundle, as far as the voices need it. */
export type BundleChapter = {
  courseTrackId: string;
  characters: { key: string; voice?: 'female' | 'male' | null }[];
  missions: { characterKey: string; expressions: { id: string; text: string; speaker: string }[] }[];
};

/** Every line of the bundle's chapters ({@link readBundleChapters}) with the voice cast for it. */
export function bundleLines(chapters: readonly BundleChapter[], onlyTrack?: string): Line[] {
  const lines: Line[] = [];
  for (const ch of chapters) {
    if (onlyTrack && ch.courseTrackId !== onlyTrack) continue;
    const cast = new Map(ch.characters.map((c) => [c.key, c.voice ?? null]));
    for (const m of ch.missions) {
      for (const e of m.expressions) {
        const voice = voiceForLine(ch.courseTrackId, e.speaker === 'character' ? 'character' : 'learner', cast.get(m.characterKey) ?? null);
        if (voice) lines.push({ expressionId: e.id, trackId: ch.courseTrackId, text: e.text, voice });
      }
    }
  }
  return lines;
}

export const LISTENER_MODEL = 'google/gemini-3.8-flash';

/** The listening check of a clip: what is heard (written before comparing), whether it is the line, how natural. */
export function listenPrompt(text: string): string {
  return [
    'First write exactly what you hear in this clip, in its own script, as if you did not know what was expected ("heard").',
    `Then compare it with the expected words: "${text}".`,
    'Answer with JSON only: {"heard": string, "matches": boolean (true only if the same words are said; ignore punctuation and spelling variants such as kana or kanji), "naturalness": integer 1-10 (10 = indistinguishable from a native human speaker, 1 = obviously robotic), "issues": string}',
  ].join('\n');
}

async function listen(file: string, text: string, key: string): Promise<{ ok: boolean; note: string }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: LISTENER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: listenPrompt(text) }, { type: 'input_audio', input_audio: { data: readFileSync(file).toString('base64'), format: 'mp3' } }] }],
    }),
  });
  const content = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
  try {
    const j = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)) as { heard?: string; matches?: boolean; naturalness?: number; issues?: string };
    return { ok: j.matches === true && (j.naturalness ?? 0) >= 8, note: `heard "${j.heard ?? ''}", natural ${j.naturalness ?? '?'}/10${j.issues && j.issues !== 'none' ? `, ${j.issues}` : ''}` };
  } catch {
    return { ok: false, note: 'no usable answer from the listener' };
  }
}

async function synthesize(line: Line, out: string, key: string): Promise<void> {
  const v = line.voice;
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: v.model, input: line.text, voice: v.voice, response_format: v.format, ...(v.instructions ? { instructions: v.instructions } : {}) }),
  });
  if (!res.ok) throw new Error(`${v.model} ${v.voice}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const rate = /rate=(\d+)/.exec(res.headers.get('content-type') ?? '')?.[1] ?? '24000';
  // Mono MP3 at a speech bitrate, loudness-normalised so every voice plays at the same level.
  const input = v.format === 'pcm' ? ['-f', 's16le', '-ar', rate, '-ac', '1', '-i', 'pipe:0'] : ['-i', 'pipe:0'];
  // A short lead-in and tail of silence: browsers can swallow the first syllable of a clip that starts at once.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-af', 'adelay=120,apad=pad_dur=0.25,loudnorm=I=-18:TP=-2:LRA=11', '-ac', '1', '-ar', '24000', '-b:a', '48k', out], { input: bytes });
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const only = flagString(args, 'track');
  const lines = bundleLines(readBundleChapters<BundleChapter>(root), only);
  const dir = resolve(root, LINES_DIR);
  const todo = new Map<string, Line>();
  for (const l of lines) {
    const name = clipName(l.voice, l.text);
    if (!existsSync(resolve(dir, name)) && !todo.has(name)) todo.set(name, l);
  }
  const chars = [...todo.values()].reduce((n, l) => n + l.text.length, 0);
  io.log(`${lines.length} lines, ${todo.size} clips to synthesize (${chars} characters)`);
  if (args.dryRun) return 0;
  const key = process.env.OPENROUTER_API_KEY;
  if (todo.size && !key) {
    io.error('OPENROUTER_API_KEY is not set');
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  const limit = flagNumber(args, 'limit') ?? 0;
  const verify = !flagBool(args, 'no-verify');
  const attempts = Math.max(1, flagNumber(args, 'attempts') ?? 3);
  const queue = [...todo.entries()].slice(0, limit > 0 ? limit : undefined);
  let failed = 0;
  const workers = Array.from({ length: Math.max(1, flagNumber(args, 'concurrency') ?? 4) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [name, line] = next;
      const out = resolve(dir, name);
      try {
        let kept = false;
        for (let attempt = 1; attempt <= attempts && !kept; attempt++) {
          await synthesize(line, out, key!);
          if (verify) {
            const heard = await listen(out, line.text, key!);
            kept = heard.ok;
            io.log(`  ${kept ? 'kept' : 'retry'} ${name}  ${line.text}  (${heard.note})`);
          } else {
            kept = true;
            io.log(`  ${name}  ${line.text}`);
          }
        }
        if (!kept) {
          rmSync(out, { force: true });
          throw new Error('no take passed the listening check');
        }
      } catch (error) {
        failed += 1;
        io.error(`  ${line.expressionId}: ${(error as Error).message}`);
      }
    }
  });
  await Promise.all(workers);

  // The map of every bundle line whose clip exists; clips no line uses any more are removed.
  const all = bundleLines(readBundleChapters<BundleChapter>(root));
  const used = new Set<string>();
  const map: Record<string, { file: string; voice: string }> = {};
  for (const l of all) {
    const name = clipName(l.voice, l.text);
    if (!existsSync(resolve(dir, name))) continue;
    used.add(name);
    map[l.expressionId] = { file: `assets/audio/lines/${name}`, voice: l.voice.id };
  }
  if (!only) for (const f of readdirSync(dir)) if (f.endsWith('.mp3') && !used.has(f)) rmSync(resolve(dir, f));
  const voices = Object.fromEntries(Object.values(BUNDLE_VOICES).flatMap((c) => [c.female, c.male, c.learner]).map((v) => [v.id, { model: v.model, label: v.label }]));
  writeTextFileSync(
    resolve(root, VOICES_FILE),
    `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/src/synthesize-bundle-audio.ts', synthetic: true, voices, lines: Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) }, null, 1)}\n`,
  );
  io.log(`wrote ${VOICES_FILE}: ${Object.keys(map).length} of ${all.length} lines voiced${failed ? `, ${failed} failed` : ''}`);
  return failed ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
