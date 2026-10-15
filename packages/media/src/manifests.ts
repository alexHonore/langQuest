/**
 * Versioned manifests (§4.4): course manifests, audio collection manifests and offline download
 * packs, with deterministic checksums, lazy asset references and cache/invalidation keys.
 */
import type { AssetKind, AssetRef, AudioCollectionManifest, CourseManifest, CourseTrackId, DownloadPackFile, DownloadPackManifest, SourceLanguageCode } from '@langquest/contracts';
import { AudioCollectionManifestSchema, CourseManifestSchema, DownloadPackManifestSchema, MANIFEST_FORMAT_VERSION } from '@langquest/contracts';
import { sha256HexSync } from './hashing';

/** Stable JSON: object keys sorted recursively, arrays in order, `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 of the canonical JSON body with `checksum` removed. */
export function computeManifestChecksum(manifest: Record<string, unknown>): string {
  const { checksum: _omit, ...rest } = manifest;
  void _omit;
  return sha256HexSync(canonicalJson(rest));
}

/** Verify that a manifest's checksum matches its body. */
export function verifyManifestChecksum(manifest: { checksum: string } & Record<string, unknown>): boolean {
  return computeManifestChecksum(manifest) === manifest.checksum;
}

/** Minimal asset row fields needed to build a lazy `AssetRef`. */
export interface AssetForRef {
  id: string;
  kind: AssetKind;
  checksumSha256: string;
  byteLength: number | null;
  mimeType: string;
  durationMs: number | null;
  visibility: 'private' | 'authenticated' | 'public';
  /** Public URL already resolved by the caller for `visibility === 'public'` assets. */
  publicUrl?: string | null;
  altTextKey?: string | null;
}

/**
 * Build a lazy asset reference. Private/authenticated assets never carry a URL in a manifest;
 * the client resolves them through the playback-url endpoint (§4.4).
 */
export function lazyAssetRef(asset: AssetForRef): AssetRef {
  return {
    assetId: asset.id,
    kind: asset.kind,
    contentHash: asset.checksumSha256,
    byteLength: asset.byteLength,
    mimeType: asset.mimeType,
    durationMs: asset.durationMs,
    publicUrl: asset.visibility === 'public' ? (asset.publicUrl ?? null) : null,
    altTextKey: asset.altTextKey ?? null,
  };
}

/** Default edge cache TTL for non-personal manifests. */
export const DEFAULT_MANIFEST_CACHE_TTL_SECONDS = 300;

type CourseManifestInput = Omit<CourseManifest, 'formatVersion' | 'checksum' | 'generatedAt' | 'cacheTtlSeconds'> & { cacheTtlSeconds?: number };

/** Build and validate a course manifest, filling format version, timestamp and checksum. */
export function buildCourseManifest(input: CourseManifestInput, now: Date = new Date()): CourseManifest {
  const body = {
    ...input,
    formatVersion: MANIFEST_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    cacheTtlSeconds: input.cacheTtlSeconds ?? DEFAULT_MANIFEST_CACHE_TTL_SECONDS,
    chapters: [...input.chapters].sort((a, b) => a.order - b.order).map((c) => ({ ...c, missions: [...c.missions].sort((a, b) => a.order - b.order).map((m) => ({ ...m, steps: [...m.steps].sort((a, b) => a.order - b.order) })) })),
  };
  const checksum = computeManifestChecksum(body);
  return CourseManifestSchema.parse({ ...body, checksum });
}

type AudioCollectionManifestInput = Omit<AudioCollectionManifest, 'formatVersion' | 'checksum' | 'generatedAt'>;

/** Build and validate an audio collection manifest (lazy URLs, attribution included when required). */
export function buildAudioCollectionManifest(input: AudioCollectionManifestInput, now: Date = new Date()): AudioCollectionManifest {
  const body = {
    ...input,
    formatVersion: MANIFEST_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    chapters: [...input.chapters].sort((a, b) => a.order - b.order).map((c) => ({ ...c, lessons: [...c.lessons].sort((a, b) => a.order - b.order) })),
  };
  const checksum = computeManifestChecksum(body);
  return AudioCollectionManifestSchema.parse({ ...body, checksum });
}

type DownloadPackInput = Omit<DownloadPackManifest, 'formatVersion' | 'checksum' | 'generatedAt' | 'totalBytes'>;

/**
 * Build a download pack manifest. Throws when `distributionAllowed` is false — a pack must never be
 * generated for content without redistribution rights (§7.6); callers surface that as `rights_blocked`.
 */
export function buildDownloadPackManifest(input: DownloadPackInput, now: Date = new Date()): DownloadPackManifest {
  if (!input.distributionAllowed) throw new Error('Cannot build a download pack for content without distribution rights');
  const seen = new Set<string>();
  for (const f of input.files) {
    if (seen.has(f.path)) throw new Error(`Duplicate pack path: ${f.path}`);
    seen.add(f.path);
    if (f.path.startsWith('/') || f.path.split('/').some((s) => s === '..' || s === '')) throw new Error(`Unsafe pack path: ${f.path}`);
  }
  const body = { ...input, formatVersion: MANIFEST_FORMAT_VERSION, generatedAt: now.toISOString(), totalBytes: input.files.reduce((n, f) => n + f.byteLength, 0) };
  const checksum = computeManifestChecksum(body);
  return DownloadPackManifestSchema.parse({ ...body, checksum });
}

/** Relative path for an asset inside a pack directory: `{assetId}.{ext}` derived from the MIME type. */
export function packFilePath(file: Pick<DownloadPackFile, 'assetId' | 'mimeType'>, ext: string): string {
  return `${file.assetId}.${ext.replace(/^\./, '')}`;
}

// --- cache keys and invalidation ----------------------------------------------------

export type ManifestCacheKeyInput =
  | { kind: 'course'; courseTrackId: CourseTrackId; sourceLanguageCode: SourceLanguageCode; version?: number }
  | { kind: 'audio_collection'; collectionId: string; instructionLanguageCode?: SourceLanguageCode | null; version?: number };

/** Edge cache key: `manifest:course:{track}:{source}:v{n}` or `manifest:audio:{collection}:{lang|any}:v{n}`. */
export function manifestCacheKey(input: ManifestCacheKeyInput): string {
  const v = input.version === undefined ? '' : `:v${input.version}`;
  if (input.kind === 'course') return `manifest:course:${input.courseTrackId}:${input.sourceLanguageCode}${v}`;
  return `manifest:audio:${input.collectionId}:${input.instructionLanguageCode ?? 'any'}${v}`;
}

export interface InvalidationInput {
  kind: 'course' | 'audio_collection';
  courseTrackId: CourseTrackId | null;
  collectionId: string | null;
  /** Null = every source language. */
  sourceLanguageCode: SourceLanguageCode | null;
}

/** Cache key prefixes to purge for a `manifest.invalidated` event payload. */
export function manifestInvalidationPrefixes(input: InvalidationInput): string[] {
  if (input.kind === 'course') {
    if (!input.courseTrackId) throw new Error('courseTrackId is required for course invalidation');
    return [input.sourceLanguageCode ? `manifest:course:${input.courseTrackId}:${input.sourceLanguageCode}` : `manifest:course:${input.courseTrackId}:`];
  }
  if (!input.collectionId) throw new Error('collectionId is required for audio collection invalidation');
  return [input.sourceLanguageCode ? `manifest:audio:${input.collectionId}:${input.sourceLanguageCode}` : `manifest:audio:${input.collectionId}:`];
}

/** Whether a cached key is covered by any invalidation prefix. */
export function isKeyInvalidated(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => key === p || key.startsWith(p));
}

export interface ManifestDiff {
  versionChanged: boolean;
  checksumChanged: boolean;
  addedIds: string[];
  removedIds: string[];
  changedIds: string[];
  /** Asset ids referenced only by the new manifest (to prefetch) and only by the old one (to evict). */
  assetsAdded: string[];
  assetsRemoved: string[];
}

interface Node {
  id: string;
  [k: string]: unknown;
}

function collectNodes(manifest: CourseManifest | AudioCollectionManifest): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (node: Node) => {
    const { chapters, missions, lessons, steps, ...own } = node as Node & { chapters?: Node[]; missions?: Node[]; lessons?: Node[]; steps?: Node[] };
    map.set(node.id, sha256HexSync(canonicalJson(own)));
    for (const child of [...(chapters ?? []), ...(missions ?? []), ...(lessons ?? []), ...(steps ?? [])]) visit(child);
  };
  for (const chapter of manifest.chapters) visit(chapter as unknown as Node);
  return map;
}

function collectAssetIds(manifest: CourseManifest | AudioCollectionManifest): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.assetId === 'string' && typeof obj.contentHash === 'string') ids.add(obj.assetId);
      Object.values(obj).forEach(walk);
    }
  };
  walk(manifest);
  return ids;
}

/** Structural diff of two manifests of the same kind (chapters/missions/lessons/steps by id, assets by id). */
export function diffManifests(previous: CourseManifest | AudioCollectionManifest, next: CourseManifest | AudioCollectionManifest): ManifestDiff {
  const a = collectNodes(previous);
  const b = collectNodes(next);
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const changedIds: string[] = [];
  for (const [id, hash] of b) {
    if (!a.has(id)) addedIds.push(id);
    else if (a.get(id) !== hash) changedIds.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) removedIds.push(id);
  const assetsA = collectAssetIds(previous);
  const assetsB = collectAssetIds(next);
  return {
    versionChanged: previous.version !== next.version,
    checksumChanged: previous.checksum !== next.checksum,
    addedIds,
    removedIds,
    changedIds,
    assetsAdded: [...assetsB].filter((id) => !assetsA.has(id)),
    assetsRemoved: [...assetsA].filter((id) => !assetsB.has(id)),
  };
}

/** Next monotonic version for a manifest (never reuses or decreases). */
export function nextManifestVersion(currentVersion: number | null | undefined): number {
  return (currentVersion ?? 0) + 1;
}
