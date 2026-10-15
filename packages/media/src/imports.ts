/**
 * Bulk import reconciliation for rclone / R2-prefix migrations (§7.2, §7.3, §14.1 A19).
 *
 * - `parseImportPath` turns `Course/Unit 2/03 - Lesson 3.mp3` into inherited metadata
 *   (collection / chapter / lesson titles and numbering) while keeping the original path as
 *   *legacy* metadata — never as the canonical key.
 * - CSV/JSON sidecar manifests are validated with the shared `ImportManifestRowSchema`; the merge
 *   order is `sidecar > inherited (path) > defaults`, with per-field provenance so inheritance
 *   stays visible and reversible in the admin UI.
 * - `autoSortLessons` / `renumber` implement "auto-sort from filenames" and "move/renumber".
 */
import { z } from 'zod';
import type { ImportManifestRow } from '@langquest/contracts';
import { ImportManifestRowSchema } from '@langquest/contracts';
import { checkRelativePath, filenameExtension, normalizeFilename } from './metadata';

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'm4b', 'wav', 'aac', 'flac', 'ogg', 'opus'] as const;
export const SIDECAR_EXTENSIONS = ['json', 'csv'] as const;

/** Metadata inferred from a path. Every field is optional; `null` means "not inferable". */
export interface InheritedMetadata {
  collectionTitle: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  lessonTitle: string | null;
  lessonOrder: number | null;
  episodeNumber: number | null;
  /** Season/level-like grouping from patterns such as `S01E03` or `Level 2`. */
  unitNumber: number | null;
}

export interface ParsedImportPath {
  /** Normalised legacy path (stored separately, never the object key). */
  legacyPath: string;
  legacyFilename: string;
  extension: string | null;
  isAudio: boolean;
  isSidecar: boolean;
  /** Folder segments (without the filename). */
  folders: string[];
  inherited: InheritedMetadata;
}

const NUMBER_PREFIX = /^\s*(?:(?:track|lesson|lecon|leçon|lektion|lección|unit|chapter|chapitre|kapitel|part|episode|ep|no|n°|#)\s*[._-]?\s*)?0*(\d{1,4})\s*(?:[-–—._:)\]]+|\s+)\s*(.*)$/i;
const SEASON_EPISODE = /\bS(\d{1,3})\s*E(\d{1,4})\b/i;
const NAMED_NUMBER = /\b(?:unit|unité|chapter|chapitre|lesson|leçon|lecon|track|episode|ep|level|niveau|part|partie|section|module)\s*[._-]?\s*0*(\d{1,4})\b/i;
const TRAILING_NUMBER = /(?:^|[\s_\-.])0*(\d{1,4})\s*$/;

/** Extract `{ number, title }` from a segment like `03 - Lesson 3`, `Track 05`, `Unit 2`, `S01E03 Greetings`. */
export function parseNumberedSegment(segment: string): { number: number | null; title: string; unit: number | null } {
  const clean = segment.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const se = SEASON_EPISODE.exec(clean);
  if (se) {
    const title = clean.replace(SEASON_EPISODE, '').replace(/^[\s\-–—._:]+|[\s\-–—._:]+$/g, '').trim();
    return { number: Number.parseInt(se[2]!, 10), unit: Number.parseInt(se[1]!, 10), title: title || clean };
  }
  const prefix = NUMBER_PREFIX.exec(clean);
  if (prefix && prefix[2] !== undefined) {
    const num = Number.parseInt(prefix[1]!, 10);
    const rest = prefix[2].trim();
    return { number: num, unit: null, title: rest || clean };
  }
  const named = NAMED_NUMBER.exec(clean);
  if (named) return { number: Number.parseInt(named[1]!, 10), unit: null, title: clean };
  const trailing = TRAILING_NUMBER.exec(clean);
  if (trailing) {
    const title = clean.slice(0, trailing.index).replace(/[\s_\-.]+$/, '').trim();
    return { number: Number.parseInt(trailing[1]!, 10), unit: null, title: title || clean };
  }
  return { number: null, unit: null, title: clean };
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Parse a relative import path into legacy metadata + inherited course structure.
 *  - 1 folder level: `Collection/file` → collection title
 *  - 2+ levels: `Collection/Chapter/file` (deepest folder = chapter; the top folder = collection)
 * Throws for unsafe paths (traversal, absolute, control characters).
 */
export function parseImportPath(path: string): ParsedImportPath {
  const check = checkRelativePath(path);
  if (!check.ok) throw new Error(`Unsafe import path: ${check.reason}`);
  const segments = check.segments;
  const filename = segments[segments.length - 1]!;
  const folders = segments.slice(0, -1);
  const extension = filenameExtension(filename);
  const stem = stripExtension(filename);
  const lesson = parseNumberedSegment(stem);
  const chapterSegment = folders.length >= 2 ? folders[folders.length - 1]! : null;
  const collectionSegment = folders.length >= 1 ? folders[0]! : null;
  const chapter = chapterSegment ? parseNumberedSegment(chapterSegment) : null;
  const collection = collectionSegment ? parseNumberedSegment(collectionSegment) : null;
  return {
    legacyPath: check.normalized,
    legacyFilename: normalizeFilename(filename),
    extension,
    isAudio: extension !== null && (AUDIO_EXTENSIONS as readonly string[]).includes(extension),
    isSidecar: extension !== null && (SIDECAR_EXTENSIONS as readonly string[]).includes(extension),
    folders,
    inherited: {
      collectionTitle: collection ? collection.title : null,
      chapterTitle: chapter ? chapter.title : null,
      chapterOrder: chapter ? chapter.number : null,
      lessonTitle: lesson.title,
      lessonOrder: lesson.number,
      episodeNumber: lesson.number,
      unitNumber: lesson.unit ?? chapter?.unit ?? null,
    },
  };
}

// --- sidecar manifests (CSV / JSON) ----------------------------------------------------

/** Column aliases accepted in CSV headers (case/space/underscore-insensitive). */
const COLUMN_ALIASES: Readonly<Record<string, keyof ImportManifestRow>> = {
  storagekey: 'storageKey',
  key: 'storageKey',
  legacypath: 'legacyPath',
  path: 'legacyPath',
  file: 'legacyPath',
  filename: 'legacyPath',
  assetid: 'assetId',
  collectiontitle: 'collectionTitle',
  collection: 'collectionTitle',
  course: 'collectionTitle',
  coursetitle: 'collectionTitle',
  collectionid: 'collectionId',
  chaptertitle: 'chapterTitle',
  chapter: 'chapterTitle',
  unit: 'chapterTitle',
  chapterorder: 'chapterOrder',
  chapternumber: 'chapterOrder',
  unitnumber: 'chapterOrder',
  lessontitle: 'lessonTitle',
  lesson: 'lessonTitle',
  title: 'lessonTitle',
  lessonorder: 'lessonOrder',
  lessonnumber: 'lessonOrder',
  order: 'lessonOrder',
  track: 'lessonOrder',
  episodenumber: 'episodeNumber',
  episode: 'episodeNumber',
  targetvarietyid: 'targetVarietyId',
  targetvariety: 'targetVarietyId',
  variety: 'targetVarietyId',
  targetlanguage: 'targetVarietyId',
  instructionlanguage: 'instructionLanguage',
  sourcelanguage: 'instructionLanguage',
  spokenlanguagecodes: 'spokenLanguageCodes',
  spokenlanguages: 'spokenLanguageCodes',
  languages: 'spokenLanguageCodes',
  regionaldialect: 'regionalDialect',
  dialect: 'regionalDialect',
  region: 'regionalDialect',
  speakername: 'speakerName',
  speaker: 'speakerName',
  instructor: 'speakerName',
  level: 'level',
  topic: 'topic',
  tags: 'tags',
  keywords: 'tags',
  scene: 'scene',
  description: 'description',
  licenseid: 'licenseId',
  license: 'licenseId',
  licence: 'licenseId',
  rightsowner: 'rightsOwner',
  owner: 'rightsOwner',
};

const INT_FIELDS = new Set<keyof ImportManifestRow>(['chapterOrder', 'lessonOrder', 'episodeNumber']);
const LIST_FIELDS = new Set<keyof ImportManifestRow>(['spokenLanguageCodes', 'tags']);

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()]/g, '');
}

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export interface ManifestParseResult {
  rows: ImportManifestRow[];
  errors: Array<{ row: number; field: string; message: string }>;
  /** Header columns that were not recognised (ignored). */
  unknownColumns: string[];
}

/** Parse a CSV sidecar manifest into validated rows (1-based row numbers in errors, excluding the header). */
export function parseCsvManifest(text: string): ManifestParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [], unknownColumns: [] };
  const header = table[0]!.map((h) => h.trim());
  const mapping = header.map((h) => COLUMN_ALIASES[normalizeHeader(h)] ?? null);
  const unknownColumns = header.filter((_, i) => mapping[i] === null);
  const rows: ImportManifestRow[] = [];
  const errors: ManifestParseResult['errors'] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const raw: Record<string, unknown> = {};
    let rowHasError = false;
    for (let c = 0; c < mapping.length; c++) {
      const field = mapping[c];
      const value = (cells[c] ?? '').trim();
      if (!field || value.length === 0) continue;
      if (INT_FIELDS.has(field)) {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n < 0 || !/^\d+$/.test(value)) {
          errors.push({ row: r, field, message: `Expected a non-negative integer, got "${value}"` });
          rowHasError = true;
          continue;
        }
        raw[field] = n;
      } else if (LIST_FIELDS.has(field)) raw[field] = value.split(/[;|,]/).map((s) => s.trim()).filter(Boolean);
      else raw[field] = value;
    }
    const parsed = ImportManifestRowSchema.safeParse(raw);
    if (rowHasError) continue; // a row with any invalid field is reported, never partially applied
    if (parsed.success) rows.push(parsed.data);
    else for (const issue of parsed.error.issues) errors.push({ row: r, field: issue.path.join('.') || 'row', message: issue.message });
  }
  return { rows, errors, unknownColumns };
}

export const ImportManifestJsonSchema = z.union([z.array(z.unknown()), z.object({ rows: z.array(z.unknown()) })]);

/** Parse a JSON sidecar manifest (`[...]` or `{ rows: [...] }`). Keys may be camelCase or snake_case aliases. */
export function parseJsonManifest(text: string): ManifestParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { rows: [], errors: [{ row: 0, field: 'file', message: `Invalid JSON: ${(e as Error).message}` }], unknownColumns: [] };
  }
  const shape = ImportManifestJsonSchema.safeParse(json);
  if (!shape.success) return { rows: [], errors: [{ row: 0, field: 'file', message: 'Expected an array of rows or { rows: [...] }' }], unknownColumns: [] };
  const list = Array.isArray(shape.data) ? shape.data : shape.data.rows;
  const rows: ImportManifestRow[] = [];
  const errors: ManifestParseResult['errors'] = [];
  const unknown = new Set<string>();
  list.forEach((item, idx) => {
    const r = idx + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ row: r, field: 'row', message: 'Row must be an object' });
      return;
    }
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      const field = COLUMN_ALIASES[normalizeHeader(k)] ?? (k in ImportManifestRowSchema.shape ? (k as keyof ImportManifestRow) : null);
      if (!field) {
        unknown.add(k);
        continue;
      }
      if (v === null || v === undefined || v === '') continue;
      if (LIST_FIELDS.has(field) && typeof v === 'string') raw[field] = v.split(/[;|,]/).map((s) => s.trim()).filter(Boolean);
      else if (INT_FIELDS.has(field) && typeof v === 'string') raw[field] = Number.parseInt(v, 10);
      else raw[field] = v;
    }
    const parsed = ImportManifestRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else for (const issue of parsed.error.issues) errors.push({ row: r, field: issue.path.join('.') || 'row', message: issue.message });
  });
  return { rows, errors, unknownColumns: [...unknown] };
}

// --- merge rules -------------------------------------------------------------------------

export type ImportMetadataSource = 'sidecar' | 'inherited' | 'default';

/** Merged lesson metadata with provenance per field (inheritance is visible and reversible, §7.3). */
export interface MergedImportMetadata {
  values: ImportManifestRow;
  provenance: Partial<Record<keyof ImportManifestRow, ImportMetadataSource>>;
  legacyPath: string;
}

export type ImportDefaults = Partial<Pick<ImportManifestRow, 'targetVarietyId' | 'instructionLanguage' | 'collectionId' | 'collectionTitle' | 'licenseId' | 'rightsOwner' | 'level'>>;

function inheritedToRow(parsed: ParsedImportPath): Partial<ImportManifestRow> {
  const i = parsed.inherited;
  const row: Partial<ImportManifestRow> = { legacyPath: parsed.legacyPath };
  if (i.collectionTitle) row.collectionTitle = i.collectionTitle;
  if (i.chapterTitle) row.chapterTitle = i.chapterTitle;
  if (i.chapterOrder !== null) row.chapterOrder = i.chapterOrder;
  if (i.lessonTitle) row.lessonTitle = i.lessonTitle;
  if (i.lessonOrder !== null) row.lessonOrder = i.lessonOrder;
  if (i.episodeNumber !== null) row.episodeNumber = i.episodeNumber;
  return row;
}

/**
 * Merge metadata for one file: sidecar row (explicit) overrides path-inherited values, which
 * override import defaults. The legacy path is always preserved separately.
 */
export function mergeImportMetadata(parsed: ParsedImportPath, sidecar: Partial<ImportManifestRow> | null, defaults: ImportDefaults = {}): MergedImportMetadata {
  const values: Record<string, unknown> = {};
  const provenance: MergedImportMetadata['provenance'] = {};
  const apply = (src: Partial<ImportManifestRow>, source: ImportMetadataSource) => {
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
      values[k] = v;
      provenance[k as keyof ImportManifestRow] = source;
    }
  };
  apply(defaults, 'default');
  apply(inheritedToRow(parsed), 'inherited');
  if (sidecar) apply(sidecar, 'sidecar');
  values.legacyPath = parsed.legacyPath;
  provenance.legacyPath = 'inherited';
  return { values: ImportManifestRowSchema.parse(values), provenance, legacyPath: parsed.legacyPath };
}

/** Match sidecar rows to files by storage key, legacy path (normalised) or filename. */
export function indexSidecarRows(rows: readonly ImportManifestRow[]): { byKey: Map<string, ImportManifestRow>; byPath: Map<string, ImportManifestRow>; byFilename: Map<string, ImportManifestRow[]> } {
  const byKey = new Map<string, ImportManifestRow>();
  const byPath = new Map<string, ImportManifestRow>();
  const byFilename = new Map<string, ImportManifestRow[]>();
  for (const row of rows) {
    if (row.storageKey) byKey.set(row.storageKey, row);
    if (row.legacyPath) {
      const check = checkRelativePath(row.legacyPath);
      if (check.ok) {
        byPath.set(check.normalized, row);
        const name = check.segments[check.segments.length - 1]!;
        byFilename.set(name, [...(byFilename.get(name) ?? []), row]);
      }
    }
  }
  return { byKey, byPath, byFilename };
}

export function findSidecarRow(index: ReturnType<typeof indexSidecarRows>, file: { storageKey?: string | null; legacyPath: string; legacyFilename: string }): ImportManifestRow | null {
  if (file.storageKey && index.byKey.has(file.storageKey)) return index.byKey.get(file.storageKey)!;
  if (index.byPath.has(file.legacyPath)) return index.byPath.get(file.legacyPath)!;
  const candidates = index.byFilename.get(file.legacyFilename);
  return candidates && candidates.length === 1 ? candidates[0]! : null;
}

// --- reconciliation ----------------------------------------------------------------------

export interface PrefixObject {
  key: string;
  byteLength: number;
  etag?: string | null;
  lastModified?: string | null;
}

export interface ReconciledObject {
  key: string;
  byteLength: number;
  parsed: ParsedImportPath;
  sidecar: ImportManifestRow | null;
  merged: MergedImportMetadata;
  status: 'new' | 'known' | 'skipped';
  skipReason: string | null;
}

export interface ReconcileOptions {
  /** Bucket prefix to strip before path parsing (e.g. `imports/pimsleur-fr/`). */
  prefix: string;
  sidecarRows?: readonly ImportManifestRow[];
  defaults?: ImportDefaults;
  /** Object keys already imported (by legacy path or key) so re-runs are idempotent. */
  knownKeys?: ReadonlySet<string>;
  /** Minimum object size to consider audio (tiny files are usually junk/placeholders). */
  minAudioBytes?: number;
}

/** Reconcile an R2 prefix listing into import candidates (read-only; dry-run friendly). */
export function reconcilePrefix(objects: readonly PrefixObject[], options: ReconcileOptions): { entries: ReconciledObject[]; summary: { total: number; new: number; known: number; skipped: number } } {
  const prefix = options.prefix.endsWith('/') || options.prefix === '' ? options.prefix : `${options.prefix}/`;
  const index = indexSidecarRows(options.sidecarRows ?? []);
  const minAudio = options.minAudioBytes ?? 1024;
  const entries: ReconciledObject[] = [];
  for (const obj of objects) {
    if (!obj.key.startsWith(prefix)) continue;
    const relative = obj.key.slice(prefix.length);
    let parsed: ParsedImportPath;
    try {
      parsed = parseImportPath(relative);
    } catch (e) {
      entries.push({ key: obj.key, byteLength: obj.byteLength, parsed: emptyParsed(relative), sidecar: null, merged: { values: { legacyPath: relative } as ImportManifestRow, provenance: {}, legacyPath: relative }, status: 'skipped', skipReason: (e as Error).message });
      continue;
    }
    const sidecar = findSidecarRow(index, { storageKey: obj.key, legacyPath: parsed.legacyPath, legacyFilename: parsed.legacyFilename });
    const merged = mergeImportMetadata(parsed, sidecar, options.defaults);
    let status: ReconciledObject['status'] = 'new';
    let skipReason: string | null = null;
    if (!parsed.isAudio) {
      status = 'skipped';
      skipReason = parsed.isSidecar ? 'sidecar manifest' : `unsupported extension .${parsed.extension ?? ''}`;
    } else if (obj.byteLength < minAudio) {
      status = 'skipped';
      skipReason = `object smaller than ${minAudio} bytes`;
    } else if (options.knownKeys?.has(obj.key) || options.knownKeys?.has(parsed.legacyPath)) status = 'known';
    entries.push({ key: obj.key, byteLength: obj.byteLength, parsed, sidecar, merged, status, skipReason });
  }
  const summary = { total: entries.length, new: entries.filter((e) => e.status === 'new').length, known: entries.filter((e) => e.status === 'known').length, skipped: entries.filter((e) => e.status === 'skipped').length };
  return { entries, summary };
}

function emptyParsed(path: string): ParsedImportPath {
  return { legacyPath: path, legacyFilename: path, extension: null, isAudio: false, isSidecar: false, folders: [], inherited: { collectionTitle: null, chapterTitle: null, chapterOrder: null, lessonTitle: null, lessonOrder: null, episodeNumber: null, unitNumber: null } };
}

// --- sorting / renumbering -----------------------------------------------------------------

/** Natural comparison (`Lesson 2` < `Lesson 10`), case-insensitive, locale-aware. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface SortableLesson {
  legacyPath: string;
  chapterOrder?: number | null;
  lessonOrder?: number | null;
  lessonTitle?: string | null;
  chapterTitle?: string | null;
}

/** Auto-sort lessons: chapter order, then lesson order, then natural order of title/path. */
export function autoSortLessons<T extends SortableLesson>(lessons: readonly T[]): T[] {
  const num = (n: number | null | undefined) => (typeof n === 'number' ? n : Number.POSITIVE_INFINITY);
  return [...lessons].sort((a, b) => {
    const c = num(a.chapterOrder) - num(b.chapterOrder);
    if (c !== 0) return c;
    const ct = naturalCompare(a.chapterTitle ?? '', b.chapterTitle ?? '');
    if (ct !== 0 && (a.chapterOrder == null || b.chapterOrder == null)) return ct;
    const l = num(a.lessonOrder) - num(b.lessonOrder);
    if (l !== 0) return l;
    const t = naturalCompare(a.lessonTitle ?? '', b.lessonTitle ?? '');
    if (t !== 0) return t;
    return naturalCompare(a.legacyPath, b.legacyPath);
  });
}

/** Assign contiguous `lessonOrder` values (1-based by default) per chapter, preserving the current order. */
export function renumberLessons<T extends SortableLesson>(lessons: readonly T[], options: { start?: number; step?: number; perChapter?: boolean } = {}): T[] {
  const start = options.start ?? 1;
  const step = options.step ?? 1;
  const counters = new Map<string, number>();
  return lessons.map((lesson) => {
    const bucket = options.perChapter === false ? '*' : `${lesson.chapterOrder ?? ''}|${lesson.chapterTitle ?? ''}`;
    const n = counters.get(bucket) ?? start;
    counters.set(bucket, n + step);
    return { ...lesson, lessonOrder: n };
  });
}

/** Assign contiguous `chapterOrder` values based on first appearance (or numeric order when present). */
export function renumberChapters<T extends SortableLesson>(lessons: readonly T[], start = 1): T[] {
  const chapters = [...new Set(lessons.map((l) => `${l.chapterOrder ?? ''}|${l.chapterTitle ?? ''}`))];
  chapters.sort((a, b) => {
    const [ao, at] = a.split('|');
    const [bo, bt] = b.split('|');
    const an = ao === '' ? Number.POSITIVE_INFINITY : Number(ao);
    const bn = bo === '' ? Number.POSITIVE_INFINITY : Number(bo);
    return an - bn || naturalCompare(at ?? '', bt ?? '');
  });
  const order = new Map(chapters.map((c, i) => [c, start + i]));
  return lessons.map((l) => ({ ...l, chapterOrder: order.get(`${l.chapterOrder ?? ''}|${l.chapterTitle ?? ''}`)! }));
}
