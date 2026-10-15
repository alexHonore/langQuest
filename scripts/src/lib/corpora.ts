/**
 * Documented adapters for speech corpora the operator has already downloaded (spec §9.1, §9.4):
 * FLEURS, Mozilla Common Voice and OpenSLR. The adapters only **validate and inventory** files
 * under `data/raw/<source>/`; they never download, mirror or copy audio, and they refuse to run
 * without a `LICENSE_ACKNOWLEDGEMENT.md` the operator wrote after reading the actual terms.
 *
 * Rights posture per adapter:
 *  - FLEURS (CC BY 4.0 per dataset card): redistribution of derived app assets still needs review; drafts are
 *    `commercialRedistribution: true` only when the acknowledgement says `redistribution_permitted: yes`.
 *  - Common Voice (CC0 clips, but Mozilla Data Collective terms forbid re-posting/mirroring): always
 *    `commercialRedistribution: false`, `internal benchmark only`; the inventory records local paths only.
 *  - OpenSLR (collection; every corpus has its own license): nothing is assumed; the acknowledgement's
 *    `license` is the only source, and unknown licenses yield no permissions.
 *
 * Acknowledgement file format (Markdown with `key: value` lines, one per line):
 *   dataset: FLEURS
 *   version: 2.0
 *   license: CC BY 4.0
 *   license_url: https://huggingface.co/datasets/google/fleurs
 *   source_url: https://huggingface.co/datasets/google/fleurs
 *   acquired_at: 2026-10-14
 *   acquired_by: <operator name>
 *   terms_accepted: yes
 *   redistribution_permitted: no
 *   locales: fr_fr, ar_eg
 *   notes: free text
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { VarietyId } from '@langquest/contracts';
import { classifyLicense, type InputFileHash, type RightsRecord } from './drafts';
import { fileExists, readLines, sha256File } from './io';

export const CORPUS_SOURCES = ['fleurs', 'common-voice', 'openslr'] as const;
export type CorpusSource = (typeof CORPUS_SOURCES)[number];

export const ACKNOWLEDGEMENT_FILENAME = 'LICENSE_ACKNOWLEDGEMENT.md';

export const AcknowledgementSchema = z.object({
  dataset: z.string().min(1),
  version: z.string().min(1),
  license: z.string().min(1),
  license_url: z.string().url(),
  source_url: z.string().url(),
  acquired_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  acquired_by: z.string().min(1),
  terms_accepted: z.literal('yes'),
  redistribution_permitted: z.enum(['yes', 'no']),
  locales: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type Acknowledgement = z.infer<typeof AcknowledgementSchema>;

/** Parse the `key: value` lines of an acknowledgement file. Throws a readable error listing missing keys. */
export async function readAcknowledgement(path: string): Promise<Acknowledgement> {
  if (!fileExists(path)) throw new Error(`Missing ${path}. Write it after reading the dataset's actual license/terms; see scripts/src/lib/corpora.ts for the format.`);
  const raw: Record<string, string> = {};
  for await (const line of readLines(path)) {
    const m = /^\s*(?:[-*]\s*)?([a-z_]+)\s*:\s*(.*)$/i.exec(line);
    if (m) raw[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const parsed = AcknowledgementSchema.safeParse({ ...raw, locales: raw.locales ? raw.locales.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [] });
  if (!parsed.success) throw new Error(`Invalid ${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** FLEURS / Common Voice locale codes → LangQuest variety. Unknown codes stay unmapped (never guessed). */
export const CORPUS_LOCALE_TO_VARIETY: Readonly<Record<string, VarietyId>> = {
  // FLEURS
  en_us: 'en', fr_fr: 'fr', de_de: 'de', it_it: 'it', es_419: 'es-419', pt_br: 'pt-BR', ru_ru: 'ru', uk_ua: 'uk', el_gr: 'el', he_il: 'he', hi_in: 'hi', ja_jp: 'ja', ko_kr: 'ko', da_dk: 'da', sv_se: 'sv', ro_ro: 'ro', vi_vn: 'vi', sw_ke: 'sw', ln_cd: 'ln', ar_eg: 'arz', cmn_hans_cn: 'cmn', yue_hant_hk: 'yue',
  // Common Voice
  en: 'en', fr: 'fr', de: 'de', it: 'it', ru: 'ru', uk: 'uk', el: 'el', he: 'he', hi: 'hi', ja: 'ja', ko: 'ko', da: 'da', sv: 'sv', 'sv-SE': 'sv', ro: 'ro', vi: 'vi', sw: 'sw', rw: 'rw', ln: 'ln', ht: 'ht', 'pt': 'pt-BR', 'zh-CN': 'cmn', 'zh-HK': 'yue', 'yue': 'yue', 'es': 'es-419', 'ar': 'arb',
};

/** Locale codes whose mapping is deliberately ambiguous and needs the operator to decide. */
export const AMBIGUOUS_CORPUS_LOCALES: Readonly<Record<string, string>> = {
  es: 'Common Voice `es` mixes Spain and Latin American speakers; mapped to es-419 for benchmarking only — never treat clips as a single variety.',
  pt: 'Common Voice `pt` mixes Brazil and Portugal; mapped to pt-BR for benchmarking only.',
  ar: 'Common Voice `ar` is mostly MSA read speech with dialect leakage; mapped to arb for benchmarking only.',
  zh_cn: 'FLEURS `cmn_hans_cn` is Mandarin (Hans); the chinese-simplified track shares these assets.',
};

export interface LocaleInventory {
  locale: string;
  varietyId: VarietyId | null;
  mappingNote: string | null;
  dir: string;
  transcriptFiles: InputFileHash[];
  audioFileCount: number;
  audioBytes: number;
  transcriptRows: number;
  /** Adapter-specific counters (e.g. validated/invalidated for Common Voice). */
  extra: Record<string, number>;
  problems: string[];
}

export interface CorpusInventory {
  source: CorpusSource;
  acknowledgement: Acknowledgement;
  rootDir: string;
  locales: LocaleInventory[];
  rights: RightsRecord;
  /** Hard rule for the operator UI: Common Voice must never be mirrored or played back to learners. */
  internalBenchmarkOnly: boolean;
  problems: string[];
}

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus|m4a|aac)$/i;

function walk(dir: string, out: { path: string; size: number }[] = [], depth = 0): { path: string; size: number }[] {
  if (depth > 8) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out, depth + 1);
    else out.push({ path: p, size: st.size });
  }
  return out;
}

async function countRows(path: string): Promise<number> {
  let n = 0;
  for await (const line of readLines(path)) if (line.trim()) n += 1;
  return Math.max(0, n - 1); // header
}

function localeDirs(root: string): string[] {
  if (!fileExists(root)) return [];
  return readdirSync(root).filter((n) => !n.startsWith('.') && n !== ACKNOWLEDGEMENT_FILENAME && statSync(join(root, n)).isDirectory());
}

/** Rights record for the whole corpus drop, derived only from the acknowledgement + adapter rule. */
export function corpusRights(source: CorpusSource, ack: Acknowledgement): RightsRecord {
  const lic = classifyLicense(ack.license);
  const cv = source === 'common-voice';
  const permitted = !cv && ack.redistribution_permitted === 'yes' && lic.commercialRedistribution;
  return {
    licenseId: lic.licenseId,
    licenseVersion: lic.licenseVersion,
    licenseSource: 'operator_acknowledgement',
    authors: [ack.dataset],
    originUrl: ack.source_url,
    attributionRequired: lic.attributionRequired,
    attributionText: `${ack.dataset} ${ack.version} (${ack.license}) — ${ack.source_url}`,
    commercialRedistribution: permitted,
    alterationsPermitted: !cv && lic.alterationsPermitted && ack.redistribution_permitted === 'yes',
    aiProcessingPermitted: lic.aiProcessingPermitted,
    verified: false,
    notes: [
      `Acknowledged by ${ack.acquired_by} on ${ack.acquired_at}; terms page ${ack.license_url}.`,
      cv ? 'Common Voice: Mozilla Data Collective terms request no re-posting/mirroring; clips are internal STT/accent benchmarks only; no speaker re-identification or voice cloning (§9.4).' : '',
      source === 'openslr' ? 'OpenSLR is a collection: this license applies to the specific resource named in the acknowledgement only.' : '',
      source === 'fleurs' ? 'FLEURS is read speech (evaluation/reference); derived app assets need separate rights review before publishing.' : '',
      ack.notes,
    ].filter(Boolean),
  };
}

/** Inventory a FLEURS drop: `<root>/<locale>/{train,dev,test}.tsv` + `audio/`. */
async function inventoryFleurs(root: string, ack: Acknowledgement, hashAudio: boolean): Promise<LocaleInventory[]> {
  const out: LocaleInventory[] = [];
  for (const locale of localeDirs(root)) {
    const dir = join(root, locale);
    const files = walk(dir);
    const tsvs = files.filter((f) => /\.tsv$/i.test(f.path));
    const audio = files.filter((f) => AUDIO_EXT.test(f.path));
    const problems: string[] = [];
    if (!tsvs.length) problems.push('no .tsv transcript files (expected train/dev/test.tsv)');
    if (!audio.length) problems.push('no audio files found');
    const transcriptFiles: InputFileHash[] = [];
    let rows = 0;
    for (const t of tsvs) {
      const h = await sha256File(t.path);
      transcriptFiles.push({ file: relative(root, t.path), sha256: h.sha256, byteLength: h.byteLength });
      rows += await countRows(t.path);
    }
    if (hashAudio) for (const a of audio) await sha256File(a.path);
    const key = locale.toLowerCase();
    out.push({ locale, varietyId: CORPUS_LOCALE_TO_VARIETY[key] ?? null, mappingNote: AMBIGUOUS_CORPUS_LOCALES[key] ?? (CORPUS_LOCALE_TO_VARIETY[key] ? null : 'locale not mapped to a LangQuest variety; map explicitly before use'), dir, transcriptFiles, audioFileCount: audio.length, audioBytes: audio.reduce((s, f) => s + f.size, 0), transcriptRows: rows, extra: {}, problems });
  }
  if (ack.locales.length) for (const l of ack.locales) if (!out.some((o) => o.locale === l)) out.push({ locale: l, varietyId: null, mappingNote: null, dir: join(root, l), transcriptFiles: [], audioFileCount: 0, audioBytes: 0, transcriptRows: 0, extra: {}, problems: ['listed in acknowledgement but directory missing'] });
  return out;
}

/** Inventory a Common Voice drop: `<root>/<version>/<locale>/{validated,invalidated,other,...}.tsv` + `clips/`. */
async function inventoryCommonVoice(root: string, _ack: Acknowledgement): Promise<LocaleInventory[]> {
  const out: LocaleInventory[] = [];
  const versions = localeDirs(root);
  for (const version of versions) {
    const vdir = join(root, version);
    // Either `<version>/<locale>/...` or the version dir IS the locale dir.
    const hasTsv = fileExists(join(vdir, 'validated.tsv')) || fileExists(join(vdir, 'clips'));
    const locales = hasTsv ? [''] : localeDirs(vdir);
    for (const locale of locales) {
      const dir = locale ? join(vdir, locale) : vdir;
      const localeName = locale || version;
      const problems: string[] = [];
      const extra: Record<string, number> = {};
      const transcriptFiles: InputFileHash[] = [];
      let rows = 0;
      for (const name of ['validated.tsv', 'invalidated.tsv', 'other.tsv', 'train.tsv', 'dev.tsv', 'test.tsv']) {
        const p = join(dir, name);
        if (!fileExists(p)) continue;
        const h = await sha256File(p);
        transcriptFiles.push({ file: relative(root, p), sha256: h.sha256, byteLength: h.byteLength });
        const n = await countRows(p);
        extra[name.replace('.tsv', '')] = n;
        if (name === 'validated.tsv') rows = n;
      }
      if (!fileExists(join(dir, 'validated.tsv'))) problems.push('validated.tsv missing');
      const clipsDir = join(dir, 'clips');
      const clips = fileExists(clipsDir) ? walk(clipsDir).filter((f) => AUDIO_EXT.test(f.path)) : [];
      if (!clips.length) problems.push('clips/ missing or empty');
      const key = localeName;
      out.push({ locale: localeName, varietyId: CORPUS_LOCALE_TO_VARIETY[key] ?? null, mappingNote: AMBIGUOUS_CORPUS_LOCALES[key] ?? (CORPUS_LOCALE_TO_VARIETY[key] ? null : 'locale not mapped to a LangQuest variety'), dir, transcriptFiles, audioFileCount: clips.length, audioBytes: clips.reduce((s, f) => s + f.size, 0), transcriptRows: rows, extra, problems });
    }
  }
  return out;
}

/** Inventory an OpenSLR drop: `<root>/SLR<n>/...` free-form; the acknowledgement names the locale(s). */
async function inventoryOpenSlr(root: string, ack: Acknowledgement): Promise<LocaleInventory[]> {
  const out: LocaleInventory[] = [];
  for (const res of localeDirs(root)) {
    const dir = join(root, res);
    const files = walk(dir);
    const audio = files.filter((f) => AUDIO_EXT.test(f.path));
    const transcripts = files.filter((f) => /\.(tsv|csv|txt|json)$/i.test(f.path) && !/LICENSE|README/i.test(f.path));
    const problems: string[] = [];
    if (!/^SLR\d+/i.test(res)) problems.push(`directory "${res}" does not look like an OpenSLR resource id (SLR<n>)`);
    if (!files.some((f) => /LICENSE|COPYING/i.test(f.path))) problems.push('no LICENSE/COPYING file inside the resource; verify the license page on openslr.org');
    const transcriptFiles: InputFileHash[] = [];
    for (const t of transcripts.slice(0, 50)) {
      const h = await sha256File(t.path);
      transcriptFiles.push({ file: relative(root, t.path), sha256: h.sha256, byteLength: h.byteLength });
    }
    const locale = ack.locales[0] ?? 'unspecified';
    out.push({ locale: `${res}:${locale}`, varietyId: CORPUS_LOCALE_TO_VARIETY[locale] ?? null, mappingNote: CORPUS_LOCALE_TO_VARIETY[locale] ? null : 'set `locales:` in the acknowledgement to a known code to map the variety', dir, transcriptFiles, audioFileCount: audio.length, audioBytes: audio.reduce((s, f) => s + f.size, 0), transcriptRows: 0, extra: { transcriptFiles: transcripts.length }, problems });
  }
  return out;
}

/** Run the adapter for one source. Reads only; never copies or downloads. */
export async function inventoryCorpus(source: CorpusSource, rawRoot: string, options: { hashAudio?: boolean } = {}): Promise<CorpusInventory> {
  const root = resolve(rawRoot, source);
  const ack = await readAcknowledgement(join(root, ACKNOWLEDGEMENT_FILENAME));
  const problems: string[] = [];
  let locales: LocaleInventory[];
  switch (source) {
    case 'fleurs':
      locales = await inventoryFleurs(root, ack, options.hashAudio ?? false);
      break;
    case 'common-voice':
      locales = await inventoryCommonVoice(root, ack);
      if (ack.redistribution_permitted === 'yes') problems.push('Acknowledgement claims redistribution_permitted: yes for Common Voice; the adapter ignores this (platform terms forbid mirroring).');
      break;
    case 'openslr':
      locales = await inventoryOpenSlr(root, ack);
      break;
  }
  if (!locales.length) problems.push(`no locale/resource directories under ${root}`);
  return { source, acknowledgement: ack, rootDir: root, locales, rights: corpusRights(source, ack), internalBenchmarkOnly: source === 'common-voice' || ack.redistribution_permitted !== 'yes', problems };
}
