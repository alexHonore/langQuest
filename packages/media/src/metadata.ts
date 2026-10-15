/**
 * Audio metadata extraction and container sniffing (§7.2).
 *
 * - `sniffContainer` inspects magic bytes so a spoofed `Content-Type` (e.g. an executable uploaded
 *   as `audio/mpeg`) is rejected before any parser runs.
 * - `extractAudioMetadata` uses `music-metadata` (core API only, so it also runs in Workers when
 *   given a buffer or Web stream) and returns a normalized, serialisable summary: duration,
 *   bitrate, sample rate, channels, codec, ID3/container tags and embedded-cover presence.
 * - `normalizeFilename` / `assertSafeRelativePath` sanitise user-supplied names that are stored as
 *   *legacy metadata only* — they never become object keys (see `keys.ts`).
 */
import { parseBuffer, parseWebStream, selectCover, type IAudioMetadata, type IOptions } from 'music-metadata';

export const SNIFFED_FORMATS = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'png', 'jpeg', 'webp', 'avif', 'gif'] as const;
export type SniffedFormat = (typeof SNIFFED_FORMATS)[number];

export interface SniffResult {
  format: SniffedFormat;
  /** Canonical MIME type for the sniffed container. */
  mimeType: string;
  kind: 'audio' | 'image';
}

/** Canonical MIME per sniffed format. */
export const FORMAT_MIME: Readonly<Record<SniffedFormat, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

/** Declared MIME types accepted for each sniffed format (aliases are common in browsers/OSes). */
export const FORMAT_MIME_ALIASES: Readonly<Record<SniffedFormat, readonly string[]>> = {
  mp3: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-m4b', 'audio/mp4a-latm'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  aac: ['audio/aac', 'audio/aacp', 'audio/x-aac'],
  flac: ['audio/flac', 'audio/x-flac'],
  ogg: ['audio/ogg', 'audio/opus', 'audio/vorbis', 'application/ogg'],
  png: ['image/png'],
  jpeg: ['image/jpeg', 'image/jpg'],
  webp: ['image/webp'],
  avif: ['image/avif'],
  gif: ['image/gif'],
};

/** Minimum number of leading bytes `sniffContainer` needs for a reliable answer. */
export const SNIFF_BYTES = 16;

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

/** Detect the container from magic bytes. Returns `null` for unknown/unsupported content. */
export function sniffContainer(head: Uint8Array): SniffResult | null {
  if (head.length < 4) return null;
  const b0 = head[0] as number;
  const b1 = head[1] as number;
  const tag4 = ascii(head, 0, 4);
  if (tag4 === 'fLaC') return { format: 'flac', mimeType: FORMAT_MIME.flac, kind: 'audio' };
  if (tag4 === 'OggS') return { format: 'ogg', mimeType: FORMAT_MIME.ogg, kind: 'audio' };
  if (tag4 === 'RIFF' && head.length >= 12) {
    const riffType = ascii(head, 8, 4);
    if (riffType === 'WAVE') return { format: 'wav', mimeType: FORMAT_MIME.wav, kind: 'audio' };
    if (riffType === 'WEBP') return { format: 'webp', mimeType: FORMAT_MIME.webp, kind: 'image' };
    return null;
  }
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return { format: 'avif', mimeType: FORMAT_MIME.avif, kind: 'image' };
    // M4A, M4B, isom, iso2, mp41, mp42, dash … are all MP4-family audio containers for our purposes.
    return { format: 'm4a', mimeType: FORMAT_MIME.m4a, kind: 'audio' };
  }
  if (b0 === 0x89 && ascii(head, 1, 3) === 'PNG') return { format: 'png', mimeType: FORMAT_MIME.png, kind: 'image' };
  if (b0 === 0xff && b1 === 0xd8 && (head[2] as number) === 0xff) return { format: 'jpeg', mimeType: FORMAT_MIME.jpeg, kind: 'image' };
  if (ascii(head, 0, 3) === 'GIF') return { format: 'gif', mimeType: FORMAT_MIME.gif, kind: 'image' };
  if (ascii(head, 0, 3) === 'ID3') return { format: 'mp3', mimeType: FORMAT_MIME.mp3, kind: 'audio' };
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
    // MPEG audio frame sync (11 bits). Layer bits 01 = Layer III → mp3; ADTS AAC has layer 00 and
    // the "MPEG version" bit pattern 1111 0xx1 / 1111 1xx1.
    const layer = (b1 >> 1) & 0x03;
    if ((b1 & 0xf6) === 0xf0) return { format: 'aac', mimeType: FORMAT_MIME.aac, kind: 'audio' };
    if (layer === 0x01) return { format: 'mp3', mimeType: FORMAT_MIME.mp3, kind: 'audio' };
    // Layer I/II streams are still MPEG audio; treat as mp3 family for extraction purposes.
    if (layer === 0x02 || layer === 0x03) return { format: 'mp3', mimeType: FORMAT_MIME.mp3, kind: 'audio' };
  }
  return null;
}

export type ContentTypeCheck =
  | { ok: true; format: SniffedFormat; mimeType: string; kind: 'audio' | 'image' }
  | { ok: false; reason: 'unrecognized_content' | 'content_type_mismatch'; declared: string; sniffed: SniffResult | null };

/**
 * Verify that the declared `Content-Type` matches the sniffed container. Spoofed uploads
 * (e.g. `audio/mpeg` declared for a PNG or a ZIP) are rejected with a structured reason.
 */
export function verifyDeclaredContentType(declared: string, head: Uint8Array): ContentTypeCheck {
  const sniffed = sniffContainer(head);
  const declaredNorm = declared.toLowerCase().split(';')[0]!.trim();
  if (!sniffed) return { ok: false, reason: 'unrecognized_content', declared: declaredNorm, sniffed: null };
  if (!FORMAT_MIME_ALIASES[sniffed.format].includes(declaredNorm)) {
    return { ok: false, reason: 'content_type_mismatch', declared: declaredNorm, sniffed };
  }
  return { ok: true, format: sniffed.format, mimeType: sniffed.mimeType, kind: sniffed.kind };
}

/** True when a declared MIME type is an accepted alias of the canonical MIME of a sniffed container. */
export function isCompatibleMime(declared: string, sniffedMime: string): boolean {
  const declaredNorm = declared.toLowerCase().split(';')[0]!.trim();
  const sniffedNorm = sniffedMime.toLowerCase().split(';')[0]!.trim();
  if (declaredNorm === sniffedNorm) return true;
  for (const format of SNIFFED_FORMATS) {
    if (FORMAT_MIME[format] === sniffedNorm) return FORMAT_MIME_ALIASES[format].includes(declaredNorm);
  }
  return false;
}

/** Normalised, serialisable audio metadata summary. */
export interface AudioMetadata {
  container: string | null;
  codec: string | null;
  durationMs: number | null;
  /** Average audio bitrate in kbps (rounded). */
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  bitsPerSample: number | null;
  lossless: boolean | null;
  /** True when the duration was estimated from the first frames rather than a full scan. */
  durationEstimated: boolean;
  tags: {
    title: string | null;
    artist: string | null;
    album: string | null;
    albumArtist: string | null;
    track: { no: number | null; of: number | null };
    disc: { no: number | null; of: number | null };
    year: number | null;
    genre: string[];
    comment: string | null;
    /** Language tag(s) from ID3 `TLAN`/Vorbis `LANGUAGE` when present — a hint only, never authoritative. */
    language: string[];
  };
  /** Which tag families were present (e.g. `ID3v2.4`, `iTunes`, `vorbis`). */
  tagTypes: string[];
  embeddedCover: { present: boolean; mimeType: string | null; byteLength: number | null };
  /** Sniffed container, independent of tags. */
  sniffed: SniffResult | null;
}

export interface ExtractOptions {
  /** Declared MIME type; when given, a mismatch with the sniffed container throws `ContentTypeMismatchError`. */
  declaredMimeType?: string;
  /** Scan the whole file for an exact duration (slower for big VBR MP3s without a Xing header). Default `true` for buffers. */
  exactDuration?: boolean;
  /** Upper bound on bytes music-metadata may buffer (defaults to 64 MiB inside the library). */
  maxMemoryAllocation?: number;
}

/** Thrown when the declared content type does not match the sniffed container. */
export class ContentTypeMismatchError extends Error {
  constructor(public readonly check: Extract<ContentTypeCheck, { ok: false }>) {
    super(check.reason === 'unrecognized_content' ? `Unrecognised content for declared type ${check.declared}` : `Declared ${check.declared} but content sniffs as ${check.sniffed?.mimeType}`);
    this.name = 'ContentTypeMismatchError';
  }
}

function asInt(n: number | undefined | null): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

function firstString(values: unknown): string | null {
  if (Array.isArray(values)) return typeof values[0] === 'string' ? values[0] : null;
  return typeof values === 'string' ? values : null;
}

/** Map a raw `music-metadata` result to the normalised summary. */
export function normalizeMetadata(meta: IAudioMetadata, sniffed: SniffResult | null, durationEstimated: boolean): AudioMetadata {
  const { format, common } = meta;
  const cover = selectCover(common.picture);
  const nativeLanguage: string[] = [];
  for (const tags of Object.values(meta.native ?? {})) {
    for (const tag of tags) {
      if (/^(TLAN|LANGUAGE|language)$/i.test(tag.id) && typeof tag.value === 'string') nativeLanguage.push(tag.value);
    }
  }
  const comment = common.comment?.[0];
  return {
    container: format.container ?? null,
    codec: format.codec ?? null,
    durationMs: typeof format.duration === 'number' ? Math.round(format.duration * 1000) : null,
    bitrateKbps: typeof format.bitrate === 'number' ? Math.round(format.bitrate / 1000) : null,
    sampleRateHz: asInt(format.sampleRate),
    channels: asInt(format.numberOfChannels),
    bitsPerSample: asInt(format.bitsPerSample),
    lossless: typeof format.lossless === 'boolean' ? format.lossless : null,
    durationEstimated,
    tags: {
      title: common.title ?? null,
      artist: common.artist ?? null,
      album: common.album ?? null,
      albumArtist: common.albumartist ?? null,
      track: { no: common.track?.no ?? null, of: common.track?.of ?? null },
      disc: { no: common.disk?.no ?? null, of: common.disk?.of ?? null },
      year: common.year ?? null,
      genre: common.genre ?? [],
      comment: comment ? (typeof comment === 'string' ? comment : (firstString((comment as { text?: unknown }).text) ?? null)) : null,
      language: nativeLanguage,
    },
    tagTypes: [...format.tagTypes],
    embeddedCover: { present: cover !== null, mimeType: cover?.format ?? null, byteLength: cover ? cover.data.byteLength : null },
    sniffed,
  };
}

/** Accepted inputs: a whole buffer, a Web `ReadableStream`, or a Node readable (any async iterable of chunks). */
export type MetadataSource = Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

async function* prependChunk(first: Uint8Array, rest: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  yield first;
  for await (const chunk of rest) yield chunk;
}

function iterableToWebStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

async function* webStreamToIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract metadata from a buffer or stream. The container is sniffed from the first bytes before
 * parsing; when `declaredMimeType` is set a mismatch throws `ContentTypeMismatchError`.
 * `filename` is only a parsing hint (extension) and is never trusted for the format.
 */
export async function extractAudioMetadata(source: MetadataSource, filename?: string, options: ExtractOptions = {}): Promise<AudioMetadata> {
  const mmOptions: IOptions = { skipPostHeaders: true };
  if (options.maxMemoryAllocation) mmOptions.maxMemoryAllocation = options.maxMemoryAllocation;
  const hint = filename ? { path: normalizeFilename(filename) } : undefined;

  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    const sniffed = sniffContainer(bytes.subarray(0, SNIFF_BYTES));
    if (options.declaredMimeType) {
      const check = verifyDeclaredContentType(options.declaredMimeType, bytes.subarray(0, SNIFF_BYTES));
      if (!check.ok) throw new ContentTypeMismatchError(check);
    }
    const exact = options.exactDuration ?? true;
    const meta = await parseBuffer(bytes, { ...hint, size: bytes.byteLength, mimeType: sniffed?.mimeType }, { ...mmOptions, duration: exact });
    return normalizeMetadata(meta, sniffed, !exact);
  }

  // Streaming path: peek the first bytes for sniffing, then hand a reconstructed stream to the parser.
  const iterable = source instanceof ReadableStream ? webStreamToIterable(source) : source;
  const iterator = iterable[Symbol.asyncIterator]();
  const headParts: Uint8Array[] = [];
  let headLength = 0;
  while (headLength < SNIFF_BYTES) {
    const { done, value } = await iterator.next();
    if (done) break;
    headParts.push(value);
    headLength += value.byteLength;
  }
  const head = new Uint8Array(headLength);
  let off = 0;
  for (const p of headParts) {
    head.set(p, off);
    off += p.byteLength;
  }
  const sniffed = sniffContainer(head.subarray(0, SNIFF_BYTES));
  if (options.declaredMimeType) {
    const check = verifyDeclaredContentType(options.declaredMimeType, head.subarray(0, SNIFF_BYTES));
    if (!check.ok) {
      await iterator.return?.();
      throw new ContentTypeMismatchError(check);
    }
  }
  const rest: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => iterator };
  const stream = iterableToWebStream(prependChunk(head, rest));
  const exact = options.exactDuration ?? false;
  const meta = await parseWebStream(stream, { ...hint, mimeType: sniffed?.mimeType }, { ...mmOptions, duration: exact });
  return normalizeMetadata(meta, sniffed, !exact);
}

// --- filenames and paths --------------------------------------------------------

export const MAX_FILENAME_LENGTH = 255;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/**
 * Normalise a user-supplied filename for storage as legacy metadata and for display:
 * NFC, strips control/bidi characters, path separators and leading dots, collapses whitespace,
 * neutralises Windows reserved names and caps the length while keeping the extension.
 * The result is never used as an object key.
 */
export function normalizeFilename(name: string): string {
  let base = name.normalize('NFC').replace(CONTROL_CHARS, '');
  base = base.split(/[\\/]/).pop() ?? '';
  base = base.replace(/\s+/g, ' ').trim();
  base = base.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (base.length === 0) base = 'untitled';
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  if (base.length > MAX_FILENAME_LENGTH) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : '';
    base = base.slice(0, MAX_FILENAME_LENGTH - ext.length).trimEnd() + ext;
  }
  return base;
}

/** Lower-cased extension without the dot, or `null`. */
export function filenameExtension(name: string): string | null {
  const base = normalizeFilename(name);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

export type PathCheck = { ok: true; segments: string[]; normalized: string } | { ok: false; reason: string };

/**
 * Validate a relative path from a folder upload / rclone import. Rejects absolute paths, drive
 * letters, `..` (also URL-encoded), null bytes, backslashes as separators and empty segments.
 * Returns the normalised `a/b/c.mp3` form on success.
 */
export function checkRelativePath(path: string): PathCheck {
  if (typeof path !== 'string' || path.length === 0) return { ok: false, reason: 'empty path' };
  if (path.length > 2048) return { ok: false, reason: 'path too long' };
  if (path.includes('\u0000')) return { ok: false, reason: 'null byte in path' };
  if (/%2e|%2f|%5c/i.test(path)) return { ok: false, reason: 'url-encoded traversal sequence' };
  const unified = path.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || unified.startsWith('//')) return { ok: false, reason: 'absolute path not allowed' };
  const segments = unified.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, reason: 'empty path' };
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'path traversal segment' };
    if (CONTROL_CHARS.test(seg)) {
      CONTROL_CHARS.lastIndex = 0;
      return { ok: false, reason: 'control characters in path' };
    }
    CONTROL_CHARS.lastIndex = 0;
  }
  const normalizedSegments = segments.map((s, i) => (i === segments.length - 1 ? normalizeFilename(s) : s.normalize('NFC').replace(/\s+/g, ' ').trim()));
  return { ok: true, segments: normalizedSegments, normalized: normalizedSegments.join('/') };
}

/** Like `checkRelativePath` but throws. */
export function assertSafeRelativePath(path: string): string {
  const check = checkRelativePath(path);
  if (!check.ok) throw new Error(`Unsafe relative path: ${check.reason}`);
  return check.normalized;
}
