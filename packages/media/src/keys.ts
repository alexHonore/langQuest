/**
 * R2 object-key scheme (§4.4, §11).
 *
 *   masters:  media/{assetId}/{contentHash}.{ext}
 *   derived:  derived/{assetId}/{variant}/{hash}.{ext}
 *   public:   public/{kind}/{assetId}/{contentHash}.{ext}   (explicitly approved kinds only)
 *   staging:  uploads/{uploadId}/{clientChecksum}.{ext}     (multipart staging before verification)
 *
 * Keys are built only from generated ids, content hashes and an extension derived from the
 * *verified* MIME type — never from user-controlled filenames. The DB owns labels; renaming a
 * lesson never moves an object.
 */
import type { AssetKind } from '@langquest/contracts';
import { AssetKindSchema, Sha256Schema, UuidSchema } from '@langquest/contracts';

export const MASTER_KEY_PREFIX = 'media' as const;
export const DERIVED_KEY_PREFIX = 'derived' as const;
export const PUBLIC_KEY_PREFIX = 'public' as const;
export const UPLOAD_STAGING_PREFIX = 'uploads' as const;

/** Rendition/derivative variants stored under `derived/`. */
export const DERIVED_VARIANTS = [
  'aac', // mobile_encoded AAC (m4a)
  'opus', // mobile_encoded Opus (ogg)
  'slow_075', // atempo 0.75, pitch preserved
  'slow_085', // atempo 0.85, pitch preserved
  'clip', // ms-range extraction
  'review', // low-bitrate review copy for editors
  'cover', // embedded cover extracted from the master
  'waveform', // waveform peaks JSON
  'thumb', // image thumbnail
  'transcript', // exported transcript (srt/vtt/json)
] as const;
export type DerivedVariant = (typeof DERIVED_VARIANTS)[number];

/** Asset kinds that may ever live under a public bucket/custom domain (§4.4: approved images/animations only). */
export const PUBLIC_ELIGIBLE_KINDS: readonly AssetKind[] = ['image', 'animation'];

/** Verified MIME type → canonical extension used in object keys. Unknown types are rejected. */
export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/vtt': 'vtt',
  'application/x-subrip': 'srt',
  'video/mp4': 'mp4',
  'application/zip': 'zip',
};

const EXT_RE = /^[a-z0-9]{1,8}$/;

/** Resolve the object-key extension for a verified MIME type (`null` when the type is not allowed). */
export function extensionForMime(mimeType: string): string | null {
  const ext = MIME_EXTENSIONS[mimeType.toLowerCase().split(';')[0]!.trim()];
  return ext ?? null;
}

function assertUuid(value: string, label: string): string {
  const r = UuidSchema.safeParse(value);
  if (!r.success) throw new Error(`${label} must be a UUID`);
  return value.toLowerCase();
}
function assertHash(value: string, label: string): string {
  const r = Sha256Schema.safeParse(value.toLowerCase());
  if (!r.success) throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  return value.toLowerCase();
}
function assertExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (!EXT_RE.test(e)) throw new Error(`Invalid key extension: ${ext}`);
  return e;
}

export interface MasterKeyInput {
  assetId: string;
  contentHash: string;
  /** Verified MIME type (preferred) — resolved to an extension via `MIME_EXTENSIONS`. */
  mimeType?: string;
  /** Explicit extension (only when the MIME type is not known yet, e.g. staging). */
  ext?: string;
}

function resolveExt(input: { mimeType?: string; ext?: string }): string {
  if (input.mimeType) {
    const ext = extensionForMime(input.mimeType);
    if (!ext) throw new Error(`Unsupported MIME type for object key: ${input.mimeType}`);
    return ext;
  }
  if (input.ext) return assertExt(input.ext);
  throw new Error('mimeType or ext is required');
}

/** `media/{assetId}/{contentHash}.{ext}` — the private master object key. */
export function buildMasterKey(input: MasterKeyInput): string {
  return `${MASTER_KEY_PREFIX}/${assertUuid(input.assetId, 'assetId')}/${assertHash(input.contentHash, 'contentHash')}.${resolveExt(input)}`;
}

export interface DerivedKeyInput {
  assetId: string;
  variant: DerivedVariant;
  /** Hash of the derived object's bytes (or of its recipe when bytes are not yet produced). */
  hash: string;
  mimeType?: string;
  ext?: string;
}

/** `derived/{assetId}/{variant}/{hash}.{ext}` — renditions and derivatives of a master. */
export function buildDerivedKey(input: DerivedKeyInput): string {
  if (!DERIVED_VARIANTS.includes(input.variant)) throw new Error(`Unknown derived variant: ${input.variant}`);
  return `${DERIVED_KEY_PREFIX}/${assertUuid(input.assetId, 'assetId')}/${input.variant}/${assertHash(input.hash, 'hash')}.${resolveExt(input)}`;
}

export interface PublicKeyInput extends MasterKeyInput {
  kind: AssetKind;
  /** Must be `'public'` — explicit opt-in recorded on the asset row (§4.4). */
  visibility: 'private' | 'authenticated' | 'public';
}

/**
 * `public/{kind}/{assetId}/{contentHash}.{ext}` for assets that were explicitly approved for public
 * distribution. Throws for any non-eligible kind or non-public visibility so private licensed audio
 * can never be addressed under the public prefix by mistake.
 */
export function buildPublicKey(input: PublicKeyInput): string {
  if (!AssetKindSchema.safeParse(input.kind).success) throw new Error(`Unknown asset kind: ${input.kind}`);
  if (input.visibility !== 'public') throw new Error('Public keys require visibility === "public"');
  if (!PUBLIC_ELIGIBLE_KINDS.includes(input.kind)) throw new Error(`Asset kind "${input.kind}" is never public`);
  return `${PUBLIC_KEY_PREFIX}/${input.kind}/${assertUuid(input.assetId, 'assetId')}/${assertHash(input.contentHash, 'contentHash')}.${resolveExt(input)}`;
}

/** `uploads/{uploadId}/{clientChecksum}.{ext}` — multipart staging key; promoted to a master key after verification. */
export function buildUploadStagingKey(input: { uploadId: string; clientChecksumSha256: string; mimeType?: string; ext?: string }): string {
  return `${UPLOAD_STAGING_PREFIX}/${assertUuid(input.uploadId, 'uploadId')}/${assertHash(input.clientChecksumSha256, 'clientChecksumSha256')}.${resolveExt(input)}`;
}

export type ParsedObjectKey =
  | { scope: 'master'; assetId: string; contentHash: string; ext: string }
  | { scope: 'derived'; assetId: string; variant: DerivedVariant; hash: string; ext: string }
  | { scope: 'public'; kind: AssetKind; assetId: string; contentHash: string; ext: string }
  | { scope: 'upload'; uploadId: string; clientChecksumSha256: string; ext: string };

const UUID_RE = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const HASH_RE = '([a-f0-9]{64})';
const EXT_PART = '([a-z0-9]{1,8})';
const MASTER_RE = new RegExp(`^${MASTER_KEY_PREFIX}/${UUID_RE}/${HASH_RE}\\.${EXT_PART}$`);
const DERIVED_RE = new RegExp(`^${DERIVED_KEY_PREFIX}/${UUID_RE}/([a-z0-9_]+)/${HASH_RE}\\.${EXT_PART}$`);
const PUBLIC_RE = new RegExp(`^${PUBLIC_KEY_PREFIX}/([a-z]+)/${UUID_RE}/${HASH_RE}\\.${EXT_PART}$`);
const UPLOAD_RE = new RegExp(`^${UPLOAD_STAGING_PREFIX}/${UUID_RE}/${HASH_RE}\\.${EXT_PART}$`);

/** Parse a key produced by this module; returns `null` for anything else (including user-shaped keys). */
export function parseObjectKey(key: string): ParsedObjectKey | null {
  let m = MASTER_RE.exec(key);
  if (m) return { scope: 'master', assetId: m[1]!, contentHash: m[2]!, ext: m[3]! };
  m = DERIVED_RE.exec(key);
  if (m) {
    const variant = m[2] as DerivedVariant;
    if (!DERIVED_VARIANTS.includes(variant)) return null;
    return { scope: 'derived', assetId: m[1]!, variant, hash: m[3]!, ext: m[4]! };
  }
  m = PUBLIC_RE.exec(key);
  if (m) {
    const kind = m[1] as AssetKind;
    if (!PUBLIC_ELIGIBLE_KINDS.includes(kind)) return null;
    return { scope: 'public', kind, assetId: m[2]!, contentHash: m[3]!, ext: m[4]! };
  }
  m = UPLOAD_RE.exec(key);
  if (m) return { scope: 'upload', uploadId: m[1]!, clientChecksumSha256: m[2]!, ext: m[3]! };
  return null;
}

/** True when the key is well-formed under this scheme. */
export function isValidObjectKey(key: string): boolean {
  return parseObjectKey(key) !== null;
}

/** True when a key lives under the public prefix (safe to serve from the public custom domain). */
export function isPublicKey(key: string): boolean {
  return parseObjectKey(key)?.scope === 'public';
}
