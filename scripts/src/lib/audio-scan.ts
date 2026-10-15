/**
 * Bulk audio folder scan (spec §7.2 rclone migration): walks a local tree that `rclone` will
 * upload, computes SHA-256 + byte length and extracts container/duration/ID3 metadata through
 * `@langquest/media`, infers collection/chapter/lesson hierarchy from the path with
 * `parseImportPath`, and produces the rows of a CSV manifest the admin `import-manifest`
 * endpoint understands (ImportManifestRow columns + extra provenance columns it ignores).
 *
 * The filename/path is preserved as `legacyPath` only — never as the storage key.
 */
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AUDIO_EXTENSIONS, extractAudioMetadata, mergeImportMetadata, parseImportPath, type AudioMetadata, type ImportDefaults } from '@langquest/media';
import { stringify } from 'csv-stringify/sync';
import { sha256File } from './io';

export interface ScannedFile {
  legacyPath: string;
  legacyFilename: string;
  byteLength: number;
  sha256: string | null;
  mimeType: string | null;
  container: string | null;
  codec: string | null;
  durationMs: number | null;
  durationEstimated: boolean | null;
  sampleRateHz: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  tags: { title: string | null; artist: string | null; album: string | null; trackNo: number | null; language: string[] };
  inherited: ReturnType<typeof parseImportPath>['inherited'];
  storageKey: string | null;
  manifestRow: Record<string, string | number | string[] | undefined>;
  provenanceOfFields: Record<string, string>;
  error: string | null;
}

export interface ScanOptions {
  root: string;
  /** Prefix under which rclone uploads the tree (e.g. `uploads/legacy/pimsleur`); builds `storageKey`. */
  prefix?: string | null;
  defaults?: ImportDefaults;
  /** Skip hashing/metadata (fast listing for dry runs). */
  listOnly?: boolean;
  exactDuration?: boolean;
  maxFiles?: number;
  onProgress?: (done: number, total: number, file: string) => void;
}

const AUDIO_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

/** List audio files under `root` (relative POSIX paths, hidden entries skipped, sorted). */
export function listAudioFiles(root: string, maxFiles = 0): Array<{ rel: string; abs: string; size: number }> {
  const out: Array<{ rel: string; abs: string; size: number }> = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 16) return;
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name === '__MACOSX') continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) visit(abs, depth + 1);
      else if (AUDIO_RE.test(name)) {
        out.push({ rel: relative(root, abs).split(sep).join('/'), abs, size: st.size });
        if (maxFiles > 0 && out.length >= maxFiles) return;
      }
    }
  };
  visit(root, 0);
  return maxFiles > 0 ? out.slice(0, maxFiles) : out;
}

/** Columns of the CSV manifest: admin-recognised names first, then provenance extras (ignored by the importer). */
export const MANIFEST_COLUMNS = [
  'legacyPath', 'storageKey', 'collectionTitle', 'chapterTitle', 'chapterOrder', 'lessonTitle', 'lessonOrder', 'episodeNumber', 'targetVarietyId', 'instructionLanguage', 'level', 'licenseId', 'rightsOwner',
  'sha256', 'byteLength', 'mimeType', 'container', 'codec', 'durationMs', 'durationEstimated', 'sampleRateHz', 'channels', 'bitrateKbps', 'tagTitle', 'tagArtist', 'tagAlbum', 'tagTrackNo', 'tagLanguage', 'unitNumber', 'error',
] as const;

async function readMetadata(abs: string, filename: string, exactDuration: boolean): Promise<AudioMetadata> {
  const stream = createReadStream(abs);
  try {
    return await extractAudioMetadata(stream, filename, { exactDuration });
  } finally {
    stream.destroy();
  }
}

/** Scan one file. Never throws: errors land in `error`. */
export async function scanFile(root: string, rel: string, options: ScanOptions): Promise<ScannedFile> {
  const abs = join(root, ...rel.split('/'));
  const parsed = parseImportPath(rel);
  const merged = mergeImportMetadata(parsed, null, options.defaults ?? {});
  const storageKey = options.prefix ? `${options.prefix.replace(/\/+$/, '')}/${parsed.legacyPath}` : null;
  const base: ScannedFile = {
    legacyPath: parsed.legacyPath,
    legacyFilename: parsed.legacyFilename,
    byteLength: statSync(abs).size,
    sha256: null,
    mimeType: null,
    container: null,
    codec: null,
    durationMs: null,
    durationEstimated: null,
    sampleRateHz: null,
    channels: null,
    bitrateKbps: null,
    tags: { title: null, artist: null, album: null, trackNo: null, language: [] },
    inherited: parsed.inherited,
    storageKey,
    manifestRow: { ...merged.values, legacyPath: parsed.legacyPath, ...(storageKey ? { storageKey } : {}) },
    provenanceOfFields: merged.provenance,
    error: null,
  };
  if (options.listOnly) return base;
  try {
    const [hash, meta] = await Promise.all([sha256File(abs), readMetadata(abs, parsed.legacyFilename, options.exactDuration ?? false)]);
    base.sha256 = hash.sha256;
    base.byteLength = hash.byteLength;
    if (!meta.sniffed && meta.durationMs === null) throw new Error('unrecognized_content: not a known audio container');
    base.mimeType = meta.sniffed?.mimeType ?? null;
    base.container = meta.container;
    base.codec = meta.codec;
    base.durationMs = meta.durationMs;
    base.durationEstimated = meta.durationEstimated;
    base.sampleRateHz = meta.sampleRateHz;
    base.channels = meta.channels;
    base.bitrateKbps = meta.bitrateKbps;
    base.tags = { title: meta.tags.title, artist: meta.tags.artist, album: meta.tags.album, trackNo: meta.tags.track.no, language: meta.tags.language };
    // ID3 title/album fill gaps the path left (provenance recorded as `tag`).
    if (!base.manifestRow.lessonTitle && meta.tags.title) {
      base.manifestRow.lessonTitle = meta.tags.title;
      base.provenanceOfFields.lessonTitle = 'tag';
    }
    if (!base.manifestRow.collectionTitle && meta.tags.album) {
      base.manifestRow.collectionTitle = meta.tags.album;
      base.provenanceOfFields.collectionTitle = 'tag';
    }
    if (base.manifestRow.lessonOrder === undefined && meta.tags.track.no !== null) {
      base.manifestRow.lessonOrder = meta.tags.track.no;
      base.provenanceOfFields.lessonOrder = 'tag';
    }
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }
  return base;
}

/** Scan a whole tree sequentially (hashing is I/O bound; concurrency keeps memory bounded). */
export async function scanTree(options: ScanOptions): Promise<ScannedFile[]> {
  const files = listAudioFiles(options.root, options.maxFiles ?? 0);
  const out: ScannedFile[] = [];
  let done = 0;
  for (const f of files) {
    out.push(await scanFile(options.root, f.rel, options));
    done += 1;
    options.onProgress?.(done, files.length, f.rel);
  }
  return out;
}

/** Render the CSV manifest for admin `import-manifest`. */
export function toManifestCsv(files: readonly ScannedFile[]): string {
  const rows = files.map((f) => ({
    legacyPath: f.legacyPath,
    storageKey: f.storageKey ?? '',
    collectionTitle: f.manifestRow.collectionTitle ?? '',
    chapterTitle: f.manifestRow.chapterTitle ?? '',
    chapterOrder: f.manifestRow.chapterOrder ?? '',
    lessonTitle: f.manifestRow.lessonTitle ?? '',
    lessonOrder: f.manifestRow.lessonOrder ?? '',
    episodeNumber: f.manifestRow.episodeNumber ?? '',
    targetVarietyId: f.manifestRow.targetVarietyId ?? '',
    instructionLanguage: f.manifestRow.instructionLanguage ?? '',
    level: f.manifestRow.level ?? '',
    licenseId: f.manifestRow.licenseId ?? '',
    rightsOwner: f.manifestRow.rightsOwner ?? '',
    sha256: f.sha256 ?? '',
    byteLength: f.byteLength,
    mimeType: f.mimeType ?? '',
    container: f.container ?? '',
    codec: f.codec ?? '',
    durationMs: f.durationMs ?? '',
    durationEstimated: f.durationEstimated === null ? '' : String(f.durationEstimated),
    sampleRateHz: f.sampleRateHz ?? '',
    channels: f.channels ?? '',
    bitrateKbps: f.bitrateKbps ?? '',
    tagTitle: f.tags.title ?? '',
    tagArtist: f.tags.artist ?? '',
    tagAlbum: f.tags.album ?? '',
    tagTrackNo: f.tags.trackNo ?? '',
    tagLanguage: f.tags.language.join('|'),
    unitNumber: f.inherited.unitNumber ?? '',
    error: f.error ?? '',
  }));
  return stringify(rows, { header: true, columns: [...MANIFEST_COLUMNS] });
}

/** Duplicate content (same sha256, different paths) — flagged, never merged (§7.2). */
export function findDuplicates(files: readonly ScannedFile[]): Array<{ sha256: string; paths: string[] }> {
  const by = new Map<string, string[]>();
  for (const f of files) if (f.sha256) by.set(f.sha256, [...(by.get(f.sha256) ?? []), f.legacyPath]);
  return [...by.entries()].filter(([, p]) => p.length > 1).map(([sha256, paths]) => ({ sha256, paths }));
}
