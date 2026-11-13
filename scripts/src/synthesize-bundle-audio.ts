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
 * Every new clip is checked before it is kept: a light listening model writes down what it hears without being told the
 * line, then compares it with the line and rates how natural the voice sounds; a clip that does not say the line or
 * sounds below 8/10 is heard again by a stronger model (a second opinion), and synthesized again only if that one
 * turns it down too (`--attempts`, 3 by default), since a TTS model occasionally garbles a line.
 * A line no take passes stays without a bundled clip (the app then uses the server's voice or the device's).
 *
 * Both the voices and the listening check are Gemini models. They are called on **Google's Gemini API first** (the
 * owner's own key and budget: `LANG_GEMINI_API_KEY`, or a network secret for generativelanguage.googleapis.com that
 * the session's proxy adds as `x-goog-api-key`), and on **OpenRouter** (`OPENROUTER_API_KEY`, or its proxy secret)
 * only when Google fails — an error, a quota or the monthly spending limit. After several Google failures in a row
 * the run stops asking Google. `--provider google|openrouter` uses one only. Keys are never printed. Behind an HTTPS
 * proxy, Node's fetch must be told to use it (`NODE_USE_ENV_PROXY=1`, set by the package script).
 *
 * Needs `ffmpeg`. Existing clips are kept (a line is synthesized again only when its text or voice changes); a clip is
 * named by its model and voice, so the same line made on either provider is the same clip.
 *
 * Usage: pnpm --filter @langquest/scripts synthesize-bundle-audio [-- --track spanish-spain] [-- --limit 5] [-- --dry-run]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { repoRoot, writeTextFileSync } from './lib/io';
import { BUNDLE_VOICES, voiceForLine, type BundleVoice } from './lib/bundle-voices';
import { BUNDLE_DIR, readBundleChapters } from './lib/flutter-bundle';
import { buildVoiceFiles } from './export-flutter-content';

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
    { name: 'provider', type: 'string', description: 'auto (Google, then OpenRouter on failure), google or openrouter.', default: 'auto' },
    { name: 'google-rpm', type: 'number', description: "Voice requests per minute on Google's API (its limit per model; 10 by default).", default: 10 },
  ],
  examples: ['synthesize-bundle-audio -- --dry-run', 'synthesize-bundle-audio -- --track spanish-spain --limit 3'],
};

export interface Line {
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

// --- Providers: Google's Gemini API first, OpenRouter when it fails ---------------------------------------------

const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';

/** A Gemini model's id on Google's own API (`google/gemini-3.8-flash-tts` → `gemini-3.8-flash-tts`). */
export const googleModelId = (model: string): string => model.replace(/^google\//, '');

/** What Gemini TTS is asked on Google's API: the delivery instructions, then the line alone (the listening check
 * catches a take that reads the instructions too). */
export function speechPrompt(instructions: string | null, text: string): string {
  return instructions ? `${instructions}\nRead aloud only this line, nothing else:\n${text}` : text;
}

/** Which provider served what in this run, and whether Google is still asked. */
export class Providers {
  constructor(readonly mode: 'auto' | 'google' | 'openrouter' = 'auto') {}
  googleFailuresInARow = 0;
  readonly used = { google: 0, openrouter: 0 };
  readonly googleErrors: string[] = [];

  get askGoogle(): boolean {
    return this.mode !== 'openrouter' && (this.mode === 'google' || this.googleFailuresInARow < 5);
  }

  get askOpenRouter(): boolean {
    return this.mode !== 'google';
  }

  /** Runs [google] first while Google is asked, else (or when it fails) [openrouter]. */
  async call<T>(google: () => Promise<T>, openrouter: () => Promise<T>): Promise<T> {
    if (this.askGoogle) {
      try {
        const result = await google();
        this.googleFailuresInARow = 0;
        this.used.google += 1;
        return result;
      } catch (error) {
        this.googleFailuresInARow += 1;
        if (this.googleErrors.length < 5) this.googleErrors.push((error as Error).message);
        if (!this.askOpenRouter) throw error;
      }
    }
    if (!this.askOpenRouter) throw new Error('no provider left to ask');
    const result = await openrouter();
    this.used.openrouter += 1;
    return result;
  }
}

/** Requests per minute allowed per Google voice model (`--google-rpm`): the run paces itself under it. */
export const googlePace = { voiceRpm: 10 };
const nextGoogleSlot = new Map<string, number>();
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Waits for [model]'s next free slot: voice models are paced at `googlePace.voiceRpm`; others only back off on 429. */
async function paceGoogle(model: string): Promise<void> {
  if (!model.endsWith('-tts')) return;
  const gap = 60_000 / Math.max(1, googlePace.voiceRpm);
  const now = Date.now();
  const slot = Math.max(now, nextGoogleSlot.get(model) ?? 0);
  nextGoogleSlot.set(model, slot + gap);
  if (slot > now) await wait(slot - now);
}

/** How long Google asks to wait before retrying (`retryDelay` of a 429), in ms. */
export function googleRetryDelay(body: string): number | null {
  const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

const googleKey = (): string => process.env.LANG_GEMINI_API_KEY || process.env.GEMINI_API_KEY || 'proxy-injected';
const openRouterKey = (): string => process.env.OPENROUTER_API_KEY || 'proxy-injected';

async function google(model: string, body: unknown): Promise<{ candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] } }[] }> {
  // A rate limit (429) is waited out and retried on Google, as Google says; only a lasting failure goes to OpenRouter.
  for (let attempt = 1; ; attempt++) {
    await paceGoogle(model);
    const res = await fetch(`${GOOGLE_API}/${googleModelId(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': googleKey(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as never;
    const text = await res.text();
    const delay = res.status === 429 ? googleRetryDelay(text) ?? 30_000 : null;
    // A daily quota names no short delay worth waiting for: give up on Google then.
    if (delay !== null && attempt < 5 && !/PerDay/.test(text)) {
      await wait(delay + 1000);
      continue;
    }
    throw new Error(`Google ${googleModelId(model)}: HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

/**
 * The listening check: a light model hears every new clip; a clip it turns down gets a second opinion from a
 * stronger one before it is recorded again (a light model misreads a dialect more often than the voice garbles it).
 */
export const LISTENER_MODEL = 'google/gemini-3.5-flash-lite';
export const SECOND_LISTENER_MODEL = 'google/gemini-3.8-flash';

/** The listening check of a clip: what is heard (written before comparing), whether it is the line, how natural. */
export function listenPrompt(text: string): string {
  return [
    'First write exactly what you hear in this clip, in its own script, as if you did not know what was expected ("heard").',
    `Then compare it with the expected words: "${text}".`,
    'Answer with JSON only: {"heard": string, "matches": boolean (true only if the same words are said; ignore punctuation and spelling variants such as kana or kanji), "naturalness": integer 1-10 (10 = indistinguishable from a native human speaker, 1 = obviously robotic), "issues": string}',
  ].join('\n');
}

export async function listen(file: string, text: string, providers: Providers, model: string = LISTENER_MODEL): Promise<{ ok: boolean; note: string }> {
  const audio = readFileSync(file).toString('base64');
  const content = await providers.call(
    async () => {
      const j = await google(model, {
        contents: [{ role: 'user', parts: [{ text: listenPrompt(text) }, { inlineData: { mimeType: 'audio/mp3', data: audio } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      });
      const answer = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (!answer.includes('{')) throw new Error(`Google ${googleModelId(model)}: no answer`);
      return answer;
    },
    async () => {
      const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${openRouterKey()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [{ type: 'text', text: listenPrompt(text) }, { type: 'input_audio', input_audio: { data: audio, format: 'mp3' } }] }],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
    },
  );
  try {
    const j = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)) as { heard?: string; matches?: boolean; naturalness?: number; issues?: string };
    return { ok: j.matches === true && (j.naturalness ?? 0) >= 8, note: `heard "${j.heard ?? ''}", natural ${j.naturalness ?? '?'}/10${j.issues && j.issues !== 'none' ? `, ${j.issues}` : ''}` };
  } catch {
    return { ok: false, note: 'no usable answer from the listener' };
  }
}

export async function synthesize(line: Pick<Line, 'text' | 'voice'>, out: string, providers: Providers): Promise<void> {
  const v = line.voice;
  const viaOpenRouter = async (): Promise<{ bytes: Buffer; rate: string; format: 'pcm' | 'mp3' }> => {
    const res = await fetch(`${OPENROUTER_API}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${openRouterKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.model, input: line.text, voice: v.voice, response_format: v.format, ...(v.instructions ? { instructions: v.instructions } : {}) }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${v.model} ${v.voice}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), rate: /rate=(\d+)/.exec(res.headers.get('content-type') ?? '')?.[1] ?? '24000', format: v.format };
  };
  // Google speaks Gemini voices only (raw 16-bit PCM); any other model goes to OpenRouter.
  const viaGoogle = async (): Promise<{ bytes: Buffer; rate: string; format: 'pcm' | 'mp3' }> => {
    if (!v.model.startsWith('google/')) throw new Error(`${v.model} is not on Google's API`);
    const j = await google(v.model, {
      contents: [{ role: 'user', parts: [{ text: speechPrompt(v.instructions, line.text) }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.voice } } } },
    });
    const part = (j.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error(`Google ${googleModelId(v.model)}: no audio in the answer`);
    return { bytes: Buffer.from(part.inlineData.data, 'base64'), rate: /rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? '24000', format: 'pcm' };
  };
  const { bytes, rate, format } = await providers.call(viaGoogle, viaOpenRouter);
  // Mono MP3 at a speech bitrate, loudness-normalised so every voice plays at the same level.
  const input = format === 'pcm' ? ['-f', 's16le', '-ar', rate, '-ac', '1', '-i', 'pipe:0'] : ['-i', 'pipe:0'];
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
        io.error(`  ${line.expressionId}: ${(error as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  if (todo.size) {
    io.log(`requests served: Google ${providers.used.google}, OpenRouter ${providers.used.openrouter}`);
    for (const e of providers.googleErrors) io.log(`  Google said: ${e}`);
  }

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
  // And each course's own voices file, which is what the app reads.
  for (const [name, text] of Object.entries(buildVoiceFiles(root))) writeTextFileSync(resolve(root, BUNDLE_DIR, name), text);
  return failed ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
