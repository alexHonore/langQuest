/**
 * Shared helpers for job handlers: asset download/hash, derived-object upload + `media_assets` rows,
 * local-file audio resolvers for the STT adapter, and a job-scoped `LanguageContext`.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AudioEncoding, CourseTrackId, LanguageContext, SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { buildLanguageContext, findCourseTrack, isSourceLanguageCode, isVarietyId, tracksForVariety, resolveAssetTrackId } from '@langquest/contracts';
import { resolveVariety, type AudioAssetResolver } from '@langquest/ai';
import type { Insert } from '@langquest/db';
import { buildDerivedKey, extensionForMime, hashNodeStream, sha256HexSync, type DerivedVariant } from '@langquest/media';
import type { MediaAssetRow } from '../db';
import { JobFailure, type JobContext } from '../queue/types';

export const UuidParam = z.string().uuid();

/**
 * The job's id when it has a `processing_jobs` row, else null: `runDirect` executes handlers outside the queue
 * with a synthetic row (`idempotency_key = 'direct:…'`), so FK columns such as `generated_by_job_id` /
 * `asset_suggestions.job_id` must not point at it.
 */
export const queuedJobId = (ctx: Pick<JobContext, 'job'>): string | null => (ctx.job.idempotency_key.startsWith('direct:') ? null : ctx.job.id);

/** Load the parent asset of a job (params.assetId wins over parent_asset_id). */
export async function requireAsset(ctx: JobContext<{ assetId?: string | null }>): Promise<MediaAssetRow> {
  const assetId = ctx.params.assetId ?? ctx.job.parent_asset_id;
  if (!assetId) throw new JobFailure('asset_missing', 'Job has no parent asset', { retry: false });
  const asset = await ctx.services.db.getAsset(assetId);
  if (!asset) throw new JobFailure('asset_not_found', `media_assets row ${assetId} not found`, { retry: false });
  if (asset.disposition === 'deleted' || asset.disposition === 'revoked') throw new JobFailure('asset_unavailable', `asset ${assetId} is ${asset.disposition}`, { retry: false });
  return asset;
}

/** Download an object into the job's scratch dir; returns the local path. Counts a class-B read. */
export async function downloadToWorkDir(ctx: JobContext<unknown>, key: string, filename: string): Promise<{ path: string; byteLength: number; contentType: string | null }> {
  const path = join(ctx.workDir, filename);
  const head = await ctx.services.store.getToFile(key, path).catch((error: unknown) => {
    throw new JobFailure('object_unavailable', `Cannot download ${key}: ${(error as Error).message}`, { retry: true, backoffSeconds: 120, cause: error });
  });
  ctx.cost.storage('get', head.byteLength);
  ctx.log.debug('download', { key, byteLength: head.byteLength });
  return { path, byteLength: head.byteLength, contentType: head.contentType };
}

/** Stream-hash a local file (SHA-256 + byte length). */
export async function hashFile(path: string): Promise<{ sha256: string; byteLength: number }> {
  return hashNodeStream(createReadStream(path));
}

/** Local filename for a master download (extension from MIME so ffmpeg/music-metadata get a hint). */
export function masterFilename(asset: Pick<MediaAssetRow, 'id' | 'mime_type' | 'storage_key'>): string {
  const ext = extensionForMime(asset.mime_type) ?? asset.storage_key.split('.').pop() ?? 'bin';
  return `master-${asset.id}.${ext}`;
}

export interface DerivedUpload {
  key: string;
  hash: string;
  byteLength: number;
  mimeType: string;
}

/** Upload a derived file under `derived/{assetId}/{variant}/{sha256}.{ext}` (idempotent: same bytes → same key). */
export async function uploadDerivedFile(ctx: JobContext<unknown>, input: { assetId: string; variant: DerivedVariant; path: string; mimeType: string; ext?: string }): Promise<DerivedUpload> {
  const { sha256, byteLength } = await hashFile(input.path);
  const key = buildDerivedKey({ assetId: input.assetId, variant: input.variant, hash: sha256, ...(input.ext ? { ext: input.ext } : { mimeType: input.mimeType }) });
  const existing = await ctx.services.store.head(key);
  if (!existing) {
    await ctx.services.store.putFile(key, input.path, { contentType: input.mimeType });
    ctx.cost.storage('put', byteLength);
  }
  return { key, hash: sha256, byteLength, mimeType: input.mimeType };
}

/** Upload derived bytes (JSON peaks, transcripts, manifests). */
export async function uploadDerivedBytes(ctx: JobContext<unknown>, input: { assetId: string; variant: DerivedVariant; bytes: Uint8Array | string; mimeType: string; ext?: string }): Promise<DerivedUpload> {
  const bytes = typeof input.bytes === 'string' ? new TextEncoder().encode(input.bytes) : input.bytes;
  const sha256 = sha256HexSync(bytes);
  const key = buildDerivedKey({ assetId: input.assetId, variant: input.variant, hash: sha256, ...(input.ext ? { ext: input.ext } : { mimeType: input.mimeType }) });
  const existing = await ctx.services.store.head(key);
  if (!existing) {
    await ctx.services.store.put(key, bytes, { contentType: input.mimeType });
    ctx.cost.storage('put', bytes.byteLength);
  }
  return { key, hash: sha256, byteLength: bytes.byteLength, mimeType: input.mimeType };
}

/** Insert (or reuse) a derived `media_assets` row for an uploaded derivative of `source`. */
export async function ensureDerivedAssetRow(
  ctx: JobContext<unknown>,
  source: MediaAssetRow,
  upload: DerivedUpload,
  extra: { kind: Insert<'media_assets'>['kind']; derivation: string; durationMs?: number | null; channels?: number | null; sampleRateHz?: number | null; bitrateKbps?: number | null },
): Promise<MediaAssetRow> {
  const existing = await ctx.services.db.findAssetByChecksum(upload.hash);
  if (existing && existing.storage_key === upload.key) return existing;
  const row: Insert<'media_assets'> = {
    storage_key: upload.key,
    bucket: ctx.services.store.bucket,
    owner_id: source.owner_id,
    kind: extra.kind,
    checksum_sha256: upload.hash,
    mime_type: upload.mimeType,
    byte_length: upload.byteLength,
    duration_ms: extra.durationMs ?? null,
    channels: extra.channels ?? null,
    sample_rate_hz: extra.sampleRateHz ?? null,
    bitrate_kbps: extra.bitrateKbps ?? null,
    source_asset_id: source.id,
    derivation: extra.derivation,
    visibility: source.visibility === 'public' ? 'public' : source.visibility,
    content_rights_id: source.content_rights_id,
    disposition: 'active',
    state: source.state === 'published' ? 'approved' : source.state,
  };
  return ctx.services.db.insertAsset(row);
}

/** Map a MIME type to the adapter's `AudioEncoding`. */
export function encodingForMime(mime: string): AudioEncoding {
  const m = mime.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('ogg') || m.includes('opus')) return 'opus';
  if (m.includes('webm')) return 'webm_opus';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return 'wav';
}

/** `AudioAssetResolver` serving local files by synthetic asset id (chunks produced by ffmpeg). */
export function fileAssetResolver(files: Map<string, { path: string; encoding: AudioEncoding; sampleRateHz: number | null }>): AudioAssetResolver {
  return {
    async resolve(assetId) {
      const entry = files.get(assetId);
      if (!entry) throw new Error(`Unknown local audio ${assetId}`);
      const bytes = new Uint8Array(await readFile(entry.path));
      return { bytes, encoding: entry.encoding, sampleRateHz: entry.sampleRateHz };
    },
  };
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/** Resolve a variety id from a locale / variety / track string; throws a non-retryable failure otherwise. */
export function requireVariety(value: string | null | undefined, field = 'locale'): VarietyId {
  if (!value) throw new JobFailure('variety_missing', `${field} is required (variety id, course track or BCP-47 locale)`, { retry: false });
  if (isVarietyId(value)) return value;
  const resolved = resolveVariety(value);
  if (!resolved) throw new JobFailure('variety_unresolved', `${field} "${value}" does not map to a single variety (ambiguous codes like es/pt/zh need a variety id)`, { retry: false });
  return resolved;
}

/** First course track teaching a variety (for prompt packs / language context). */
export function trackForVarietyOrThrow(variety: VarietyId, preferred?: string | null): CourseTrackId {
  if (preferred) {
    const t = findCourseTrack(preferred);
    if (t && t.targetVarietyId === variety) return t.id;
  }
  const track = tracksForVariety(variety)[0];
  if (!track) throw new JobFailure('track_missing', `No course track teaches variety ${variety}`, { retry: false });
  return resolveAssetTrackId(track.id);
}

export function requireSourceLanguage(value: string | null | undefined, field = 'sourceLanguage'): SourceLanguageCode {
  if (!value || !isSourceLanguageCode(value)) throw new JobFailure('source_language_invalid', `${field} "${value ?? ''}" is not a supported source language`, { retry: false });
  return value;
}

/**
 * `LanguageContext` for a job. Jobs have no enrollment; the job id (a UUID) fills `enrollmentId` so
 * AI request records stay traceable to the job. Never reuse this context for learner-facing calls.
 */
export function jobLanguageContext(ctx: JobContext<unknown>, input: { track: CourseTrackId; sourceLanguage: SourceLanguageCode; level?: LanguageContext['learnerLevel'] | null; regionalPreference?: string | null }): LanguageContext {
  return buildLanguageContext({ uiLocale: input.sourceLanguage, enrollmentId: ctx.job.id, sourceLanguageCode: input.sourceLanguage, courseTrackId: input.track, learnerLevel: input.level ?? 'beginner', regionalPreference: input.regionalPreference ?? null });
}

/** Stable idempotency key material. */
export function keyHash(...parts: Array<string | number | null | undefined>): string {
  return sha256HexSync(parts.map((p) => String(p ?? '')).join('|')).slice(0, 32);
}

/**
 * Localized text helper for `{ en: '…' }` jsonb columns, with an English fallback. Only for EDITOR-facing
 * evidence (prompts, log lines, chapter lookups); anything published to learners must use `localizedExact`.
 */
export function localized(translations: unknown, lang: string, fallback: string | null = null): string | null {
  const obj = (translations ?? {}) as Record<string, unknown>;
  const v = obj[lang] ?? obj.en;
  return typeof v === 'string' && v.length ? v : fallback;
}

/**
 * Strict variant: the requested language only, never a silent English substitution (§2.1). `null` when the
 * text is missing in that language or when no language is declared (`lang === null`).
 */
export function localizedExact(translations: unknown, lang: string | null): string | null {
  if (!lang) return null;
  const obj = (translations ?? {}) as Record<string, unknown>;
  const v = obj[lang];
  return typeof v === 'string' && v.length ? v : null;
}
