#!/usr/bin/env tsx
/**
 * synthesize-narration — the narrator's sentences recorded by a natural AI voice, for every learner.
 *
 * The narrator reads each exercise's context and question aloud in the learner's instruction language (a mission's
 * scene, "How do you say “…”?", "Your line — say it out loud", an audio lesson's guidance). Without a recording, the
 * app has only the server's AI narrator (signed in) and otherwise says nothing: the device's synthesizer sounds
 * robotic next to the courses' natural clips, so it never narrates.
 *
 * The sentences are listed by the app itself, so they are exactly what it says:
 *   (cd apps/mobile_flutter && flutter test tool/narration_texts_test.dart)   → apps/mobile_flutter/build/narration_texts.json
 * Each is read once by the instruction language's narrator voice (a calm, warm teacher; not one of the course voices),
 * loudness-normalised and saved as `apps/mobile_flutter/assets/audio/narration/<voice>-<hash>.mp3`, then checked by the
 * same listening check as the course lines (`synthesize-bundle-audio`). `assets/content/narration/<lang>/<track>.json`
 * maps each sentence of a course to its clip: the app reads the active course's. A course's map is written only once
 * every one of its sentences is recorded (half a narration, some sentences said and others not, sounds broken).
 *
 * Google's Gemini API first, OpenRouter when Google fails (as `synthesize-bundle-audio`). Existing clips are kept; a
 * clip no sentence uses any more is removed after a full run.
 *
 * Usage: pnpm --filter @langquest/scripts synthesize-narration [-- --track arabic-moroccan] [-- --source fr] [-- --dry-run]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { repoRoot, writeTextFileSync } from './lib/io';
import type { BundleVoice } from './lib/bundle-voices';
import { clipName, googlePace, listen, Providers, SECOND_LISTENER_MODEL, synthesize } from './synthesize-bundle-audio';
import { buildVoiceFiles } from './export-flutter-content';
import { BUNDLE_DIR } from './lib/flutter-bundle';

export const NARRATION_DIR = 'apps/mobile_flutter/assets/audio/narration';
export const NARRATION_MAPS_DIR = 'apps/mobile_flutter/assets/content/narration';
export const NARRATION_TEXTS = 'apps/mobile_flutter/build/narration_texts.json';

export const spec: CliSpec = {
  name: 'synthesize-narration',
  summary: "Record the narrator's sentences (exercise context and questions) with a natural AI voice into the Flutter assets.",
  flags: [
    { name: 'track', type: 'string', description: 'Only this course track.' },
    { name: 'source', type: 'string', description: 'Only this instruction language (en or fr).' },
    { name: 'limit', type: 'number', description: 'Record at most this many new clips.', default: 0 },
    { name: 'concurrency', type: 'number', description: 'Parallel requests.', default: 4 },
    { name: 'no-verify', type: 'boolean', description: 'Keep clips without the listening check.', default: false },
    { name: 'attempts', type: 'number', description: 'Takes tried per clip before giving up.', default: 3 },
    { name: 'provider', type: 'string', description: 'auto (Google, then OpenRouter on failure), google or openrouter.', default: 'auto' },
    { name: 'google-rpm', type: 'number', description: "Voice requests per minute on Google's API (its limit per model; 10 by default).", default: 10 },
  ],
  examples: ['synthesize-narration -- --dry-run', 'synthesize-narration -- --track arabic-moroccan --source fr'],
};

const GEMINI = 'google/gemini-3.8-flash-tts';

/** The narrator of each instruction language: one calm, warm voice, unlike any course voice (Aoede, Orus, Puck, Kore, Charon). */
export const NARRATOR_VOICES: Readonly<Record<string, BundleVoice>> = {
  fr: {
    id: 'narrator-fr-sulafat',
    model: GEMINI,
    voice: 'Sulafat',
    instructions: 'Speak in natural French from France, like a calm, friendly language teacher guiding a lesson: clear, warm, unhurried.',
    format: 'pcm',
    label: 'Sulafat (Gemini TTS, French narrator)',
  },
  en: {
    id: 'narrator-en-sulafat',
    model: GEMINI,
    voice: 'Sulafat',
    instructions: 'Speak in natural American English, like a calm, friendly language teacher guiding a lesson: clear, warm, unhurried.',
    format: 'pcm',
    label: 'Sulafat (Gemini TTS, English narrator)',
  },
};

/** `{ "<track>": { "<source>": ["sentence", …] } }`, as the app lists them. */
export type NarrationTexts = Record<string, Record<string, string[]>>;

/** The narration map of one course in one instruction language: what the app reads. */
export function narrationMap(texts: readonly string[], voice: BundleVoice, has: (file: string) => boolean): Record<string, string> {
  const clips: Record<string, string> = {};
  for (const text of [...texts].sort()) {
    const name = clipName(voice, text);
    if (has(name)) clips[text] = `assets/audio/narration/${name}`;
  }
  return clips;
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const textsFile = resolve(root, NARRATION_TEXTS);
  if (!existsSync(textsFile)) {
    io.error(`${NARRATION_TEXTS} is missing: run (cd apps/mobile_flutter && flutter test tool/narration_texts_test.dart) first`);
    return 2;
  }
  const all = JSON.parse(readFileSync(textsFile, 'utf8')) as NarrationTexts;
  const onlyTrack = flagString(args, 'track');
  const onlySource = flagString(args, 'source');
  const dir = resolve(root, NARRATION_DIR);
  const todo = new Map<string, { text: string; voice: BundleVoice }>();
  let sentences = 0;
  for (const [track, bySource] of Object.entries(all)) {
    if (onlyTrack && track !== onlyTrack) continue;
    for (const [source, texts] of Object.entries(bySource)) {
      const voice = NARRATOR_VOICES[source];
      if (!voice || (onlySource && source !== onlySource)) continue;
      sentences += texts.length;
      for (const text of texts) {
        const name = clipName(voice, text);
        if (!existsSync(resolve(dir, name)) && !todo.has(name)) todo.set(name, { text, voice });
      }
    }
  }
  const chars = [...todo.values()].reduce((n, l) => n + l.text.length, 0);
  io.log(`${sentences} sentences, ${todo.size} clips to record (${chars} characters)`);
  if (args.dryRun) return 0;
  const mode = flagString(args, 'provider') ?? 'auto';
  if (mode !== 'auto' && mode !== 'google' && mode !== 'openrouter') {
    io.error(`--provider must be auto, google or openrouter (got ${mode})`);
    return 2;
  }
  const providers = new Providers(mode);
  googlePace.voiceRpm = flagNumber(args, 'google-rpm') ?? 10;
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
          await synthesize(line, out, providers);
          if (verify) {
            let heard = await listen(out, line.text, providers);
            if (!heard.ok) {
              const second = await listen(out, line.text, providers, SECOND_LISTENER_MODEL);
              heard = { ok: second.ok, note: `${heard.note}; second opinion: ${second.note}` };
            }
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
        io.error(`  ${line.text}: ${(error as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  if (todo.size) io.log(`requests served: Google ${providers.used.google}, OpenRouter ${providers.used.openrouter}`);
  for (const e of providers.googleErrors) io.log(`  Google said: ${e}`);

  // Every course's map, from the clips that exist; a full run also removes the clips no sentence uses any more.
  const has = (file: string): boolean => existsSync(resolve(dir, file));
  const used = new Set<string>();
  let mapped = 0;
  let total = 0;
  for (const [track, bySource] of Object.entries(all)) {
    for (const [source, texts] of Object.entries(bySource)) {
      const voice = NARRATOR_VOICES[source];
      if (!voice) continue;
      const clips = narrationMap(texts, voice, has);
      for (const file of Object.values(clips)) used.add(file.slice(file.lastIndexOf('/') + 1));
      mapped += Object.keys(clips).length;
      total += texts.length;
      const out = resolve(root, NARRATION_MAPS_DIR, source, `${track}.json`);
      // Only a whole course is published: half a narration (some sentences said, others not) sounds broken.
      if (Object.keys(clips).length < new Set(texts).size) {
        rmSync(out, { force: true });
        continue;
      }
      writeTextFileSync(out, `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/src/synthesize-narration.ts', synthetic: true, voice: voice.label, clips }, null, 1)}\n`);
    }
  }
  if (!onlyTrack && !onlySource && existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.mp3') && !used.has(f)) rmSync(resolve(dir, f));
  // Each course's voices file says which of its narrations exist (the app reads only those).
  for (const [name, text] of Object.entries(buildVoiceFiles(root))) writeTextFileSync(resolve(root, BUNDLE_DIR, name), text);
  io.log(`${mapped} of ${total} sentences recorded; a course's narration is published once all of its sentences are${failed ? `; ${failed} failed` : ''}`);
  return failed ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
