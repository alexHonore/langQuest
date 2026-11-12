#!/usr/bin/env tsx
/**
 * attach-tatoeba-examples — real examples for the Flutter app's phrases, from Tatoeba (spec §9.1/§9.2).
 *
 * For every phrase of the offline bundle (`apps/mobile_flutter/assets/content/chapters/<track>.json`), finds in the Tatoeba
 * exports of the course's language: the sentence that *is* the phrase (attested by a native contributor), and short
 * sentences that use it, each with its translation in the course's instruction languages. Recordings are kept only
 * when their own license allows redistribution (CC BY / CC BY-SA / CC0): those are downloaded into
 * `apps/mobile_flutter/assets/audio/tatoeba/` and played as "native speaker" audio. Everything is attributed per
 * sentence and per recording; the snapshot id and the SHA-256 of every input are recorded.
 *
 * Reads the exports already downloaded (never downloads them): per language `<lang>_sentences_detailed.tsv[.bz2]`,
 * `<lang>-<src>_links`, `<src>_sentences_detailed` for the instruction languages, `<lang>_sentences_with_audio`, and
 * `SNAPSHOT_DATE.txt`. Output is deterministic for a given snapshot.
 *
 * Usage: pnpm --filter @langquest/scripts attach-tatoeba-examples -- --dir data/raw/tatoeba [--no-audio] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { repoRoot, writeTextFileSync } from './lib/io';
import { TATOEBA_DOWNLOADS_URL, TATOEBA_LANGUAGES, TATOEBA_TERMS_URL, TATOEBA_TEXT_LICENSE } from './lib/tatoeba';
import { findExamples, type ExampleSentence, type PhraseExamples, type PhraseQuery } from './lib/tatoeba-examples';
import { readBundleChaptersJson } from './lib/flutter-bundle';

export const EXAMPLES_FILE = 'apps/mobile_flutter/assets/content/examples.json';
export const AUDIO_DIR = 'apps/mobile_flutter/assets/audio/tatoeba';

export const spec: CliSpec = {
  name: 'attach-tatoeba-examples',
  summary: 'Attach real Tatoeba examples (attested phrases, short sentences, licensed native recordings) to the Flutter bundle.',
  flags: [
    { name: 'dir', type: 'string', description: 'Directory holding the Tatoeba exports.', default: 'data/raw/tatoeba' },
    { name: 'per-phrase', type: 'number', description: 'Examples kept per phrase.', default: 2 },
    { name: 'max-words', type: 'number', description: 'Longest example, in words.', default: 9 },
    { name: 'no-audio', type: 'boolean', description: 'Do not download recordings (they are still listed when licensed).', default: false },
  ],
  examples: ['attach-tatoeba-examples -- --dir data/raw/tatoeba', 'attach-tatoeba-examples -- --dir data/raw/tatoeba --dry-run'],
};

interface BundleTrack {
  id: string;
  targetVarietyId: string;
}
interface BundleExpression {
  id: string;
  text: string;
  meanings: Record<string, unknown>;
}
interface BundleChapter {
  courseTrackId: string;
  missions: { expressions: BundleExpression[] }[];
}

/** The Tatoeba export of a variety: the one that feeds only it, else the first that lists it. */
export function tatoebaCodeFor(varietyId: string): string | null {
  const entries = Object.values(TATOEBA_LANGUAGES).filter((l) => (l.varieties as readonly string[]).includes(varietyId));
  return (entries.find((l) => l.varieties.length === 1) ?? entries[0])?.iso3 ?? null;
}

const recordingUrl = (audioId: string): string => `https://tatoeba.org/audio/download/${audioId}`;

async function download(audioId: string, path: string, io: CliIo): Promise<boolean> {
  if (existsSync(path)) return true;
  const res = await fetch(recordingUrl(audioId), { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('audio/')) {
    io.warn(`  recording ${audioId}: ${res.status} ${type} (skipped)`);
    return false;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 600_000) {
    io.warn(`  recording ${audioId}: ${bytes.byteLength} bytes, too large for the bundle (skipped)`);
    return false;
  }
  writeFileSync(path, bytes);
  return true;
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const dir = resolve(root, flagString(args, 'dir') ?? 'data/raw/tatoeba');
  const snapshotFile = resolve(dir, 'SNAPSHOT_DATE.txt');
  const snapshot = existsSync(snapshotFile) ? readFileSync(snapshotFile, 'utf8').trim() : 'unknown';
  const content = resolve(root, 'apps/mobile_flutter/assets/content');
  const tracks = (JSON.parse(readFileSync(resolve(content, 'catalog.json'), 'utf8')) as { tracks: BundleTrack[] }).tracks;
  const chapters = (JSON.parse(readBundleChaptersJson(root)) as { chapters: BundleChapter[] }).chapters;

  const phrasesByTrack = new Map<string, PhraseQuery[]>();
  for (const ch of chapters) {
    const list = phrasesByTrack.get(ch.courseTrackId) ?? [];
    for (const m of ch.missions) for (const e of m.expressions) if (!list.some((p) => p.id === e.id)) list.push({ id: e.id, text: e.text, sources: Object.keys(e.meanings) });
    phrasesByTrack.set(ch.courseTrackId, list);
  }

  const phrases: Record<string, PhraseExamples> = {};
  const courses: Record<string, unknown> = {};
  for (const [trackId, list] of [...phrasesByTrack.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const track = tracks.find((t) => t.id === trackId);
    const target = track ? tatoebaCodeFor(track.targetVarietyId) : null;
    if (!target) {
      io.warn(`${trackId}: no Tatoeba export for ${track?.targetVarietyId ?? 'an unknown variety'}`);
      continue;
    }
    io.log(`${trackId} (${target}): ${list.length} phrases`);
    const result = await findExamples({ dir, target, phrases: list, perPhrase: flagNumber(args, 'per-phrase') ?? 2, maxWords: flagNumber(args, 'max-words') ?? 9 }, io);
    Object.assign(phrases, result.byPhrase);
    const s = result.summary;
    io.log(`  attested=${s.attested} withExamples=${s.withExamples} examples=${s.examples} licensedRecordings=${s.recordings}`);
    // Tatoeba does not record which country a sentence of an ambiguous export (Spanish, Portuguese) comes from.
    const varietyTagged = (TATOEBA_LANGUAGES[target]?.varieties.length ?? 0) === 1;
    courses[trackId] = { tatoeba: target, varietyTagged, varietyNote: TATOEBA_LANGUAGES[target]?.note ?? '', inputs: result.inputs, summary: s };
  }

  const recordings = new Set<string>();
  const each = (e: PhraseExamples): ExampleSentence[] => [...(e.attested ? [e.attested] : []), ...e.examples];
  for (const e of Object.values(phrases)) for (const s of each(e)) if (s.audio) recordings.add(s.audio.id);
  if (args.dryRun) {
    io.log(`dry-run: ${Object.keys(phrases).length} phrases with examples, ${recordings.size} licensed recordings; nothing written`);
    return 0;
  }
  const audioDir = resolve(root, AUDIO_DIR);
  const kept = new Set<string>();
  if (!flagBool(args, 'no-audio') && recordings.size) {
    mkdirSync(audioDir, { recursive: true });
    for (const id of [...recordings].sort()) if (await download(id, resolve(audioDir, `${id}.mp3`), io)) kept.add(id);
  }
  // A recording that could not be bundled is not offered.
  for (const e of Object.values(phrases)) for (const s of each(e)) if (s.audio && !kept.has(s.audio.id)) s.audio = null;

  const out = {
    schemaVersion: 1,
    generatedBy: 'scripts/src/attach-tatoeba-examples.ts',
    source: {
      name: 'Tatoeba',
      url: 'https://tatoeba.org',
      downloads: TATOEBA_DOWNLOADS_URL,
      terms: TATOEBA_TERMS_URL,
      snapshot,
      textLicense: TATOEBA_TEXT_LICENSE,
      audio: `Native recordings only under a license allowing redistribution (CC BY, CC BY-SA, CC0), each with its own license and contributor; files in ${AUDIO_DIR}/<audio id>.mp3, from ${recordingUrl('<audio id>')}.`,
    },
    courses,
    phrases: Object.fromEntries(Object.entries(phrases).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeTextFileSync(resolve(root, EXAMPLES_FILE), `${JSON.stringify(out, null, 1)}\n`);
  io.log(`wrote ${EXAMPLES_FILE}: ${Object.keys(phrases).length} phrases, ${kept.size} recordings in ${AUDIO_DIR}`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
