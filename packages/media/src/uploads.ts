/**
 * Multipart upload session state machine (§7.2, §11, §14.1 A18).
 *
 *   initiated → uploading → completed → verified
 *        \          \            \
 *         aborted / expired / failed  (terminal)
 *
 * Everything here is pure: functions take the current session and return a new session plus a
 * structured result. Persistence (the `uploads` row) and R2 calls belong to the API/jobs layers.
 *
 * Security invariants encoded here:
 *  - MIME allow-list and per-kind size caps are enforced at initiate time;
 *  - the object key is derived from generated ids + the client checksum, never the filename;
 *  - completion verifies part count, part sizes, ETags and the declared whole-file checksum;
 *  - a later `verify` step re-hashes the object server-side and sniffs the container before
 *    the upload becomes a verified draft asset;
 *  - dedupe by content hash links a physical blob but never merges logical assets with
 *    distinct rights/metadata.
 */
import type { AssetKind, ContentState, UploadInitiateRequest, UploadRow, UploadStatus } from '@langquest/contracts';
import { ALLOWED_UPLOAD_MIME_TYPES } from '@langquest/contracts';
import { sha256HexSync } from './hashing';
import { buildMasterKey, extensionForMime } from './keys';
import { checkRelativePath, isCompatibleMime, normalizeFilename, verifyDeclaredContentType } from './metadata';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Hard limits for direct browser → R2 multipart uploads. */
export const UPLOAD_LIMITS = {
  /** Absolute cap for any single object. */
  maxFileBytes: 8 * GiB,
  /** Per-kind caps (an image declared as 2 GB is rejected even though audio may be that large). */
  maxFileBytesByKind: { audio: 8 * GiB, image: 64 * MiB, document: 256 * MiB, subtitle: 32 * MiB, video: 0, animation: 64 * MiB, archive: 0 } as Readonly<Record<AssetKind, number>>,
  minPartBytes: 5 * MiB,
  maxPartBytes: 512 * MiB,
  defaultPartBytes: 16 * MiB,
  maxParts: 10_000,
  maxPartsPerSignRequest: 100,
  /** Session lifetime; an incomplete multipart upload older than this is aborted by the orphan sweeper. */
  sessionTtlMs: 24 * 60 * 60 * 1000,
  /** Presigned part URL lifetime. */
  signedPartTtlMs: 60 * 60 * 1000,
  allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
} as const;

/** Allowed state transitions. */
export const UPLOAD_TRANSITIONS: Readonly<Record<UploadStatus, readonly UploadStatus[]>> = {
  initiated: ['uploading', 'completed', 'aborted', 'expired', 'failed'],
  uploading: ['uploading', 'completed', 'aborted', 'expired', 'failed'],
  completed: ['verified', 'failed'],
  verified: [],
  aborted: [],
  failed: [],
  expired: [],
};

export const TERMINAL_UPLOAD_STATUSES: readonly UploadStatus[] = ['verified', 'aborted', 'failed', 'expired'];

export function canTransitionUpload(from: UploadStatus, to: UploadStatus): boolean {
  return UPLOAD_TRANSITIONS[from].includes(to);
}

export function isTerminalUploadStatus(status: UploadStatus): boolean {
  return TERMINAL_UPLOAD_STATUSES.includes(status);
}

export type UploadFailureCode =
  | 'mime_not_allowed'
  | 'file_too_large'
  | 'file_empty'
  | 'invalid_part_size'
  | 'invalid_filename'
  | 'invalid_path'
  | 'invalid_state'
  | 'expired'
  | 'idempotency_conflict'
  | 'unknown_part'
  | 'part_count_mismatch'
  | 'part_size_mismatch'
  | 'etag_mismatch'
  | 'byte_length_mismatch'
  | 'checksum_mismatch'
  | 'content_type_mismatch'
  | 'unrecognized_content';

export interface CompletedPart {
  partNumber: number;
  etag: string;
  byteLength: number;
}

/** In-memory representation of an upload session (maps 1:1 onto the `uploads` row). */
export interface UploadSession {
  uploadId: string;
  /** Draft asset id reserved at initiate time; becomes the `media_assets.id` on verification. */
  assetId: string;
  userId: string;
  status: UploadStatus;
  kind: AssetKind;
  storageKey: string;
  declaredMimeType: string;
  declaredByteLength: number;
  clientChecksumSha256: string;
  originalFilename: string;
  originalPath: string | null;
  partSizeBytes: number;
  partCount: number;
  completedParts: CompletedPart[];
  /** Provider multipart upload id (R2 `UploadId`); null until the API creates it. */
  multipartUploadId: string | null;
  idempotencyKey: string;
  /** Hash of the idempotency-relevant request fields; a retry with the same key but different fields is a conflict. */
  fingerprint: string;
  verifiedChecksumSha256: string | null;
  failureCode: UploadFailureCode | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface PartPlan {
  partSizeBytes: number;
  partCount: number;
}

/**
 * Choose a part size and count for a file: honours the requested size when valid, grows it when
 * the part count would exceed `maxParts`, and allows a single sub-minimum part for small files.
 */
export function planParts(byteLength: number, requestedPartSizeBytes?: number): PartPlan {
  if (!Number.isInteger(byteLength) || byteLength <= 0) throw new Error('byteLength must be a positive integer');
  let partSize = requestedPartSizeBytes ?? UPLOAD_LIMITS.defaultPartBytes;
  if (!Number.isInteger(partSize) || partSize < UPLOAD_LIMITS.minPartBytes || partSize > UPLOAD_LIMITS.maxPartBytes) {
    throw new Error(`partSizeBytes must be an integer between ${UPLOAD_LIMITS.minPartBytes} and ${UPLOAD_LIMITS.maxPartBytes}`);
  }
  if (Math.ceil(byteLength / partSize) > UPLOAD_LIMITS.maxParts) {
    partSize = Math.ceil(byteLength / UPLOAD_LIMITS.maxParts / MiB) * MiB;
    if (partSize > UPLOAD_LIMITS.maxPartBytes) throw new Error('File too large for the multipart part limits');
  }
  if (byteLength <= partSize) return { partSizeBytes: partSize, partCount: 1 };
  return { partSizeBytes: partSize, partCount: Math.ceil(byteLength / partSize) };
}

/** Fingerprint used for idempotent initiate: same key + same payload ⇒ resume; different payload ⇒ conflict. */
export function idempotencyFingerprint(req: UploadInitiateRequest, userId: string): string {
  return sha256HexSync(
    JSON.stringify([userId, req.idempotencyKey, req.filename, req.relativePath ?? null, req.contentType, req.byteLength, req.clientChecksumSha256, req.kind]),
  );
}

export type ValidationResult = { ok: true } | { ok: false; failureCode: UploadFailureCode; message: string };

/** Validate an initiate request against limits (independent of the DB). */
export function validateInitiateRequest(req: UploadInitiateRequest): ValidationResult {
  const mime = req.contentType.toLowerCase();
  if (!(UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(mime) || !extensionForMime(mime)) {
    return { ok: false, failureCode: 'mime_not_allowed', message: `Content type ${req.contentType} is not accepted` };
  }
  if (req.byteLength <= 0) return { ok: false, failureCode: 'file_empty', message: 'Empty files are not accepted' };
  const kindCap = UPLOAD_LIMITS.maxFileBytesByKind[req.kind] ?? 0;
  const cap = Math.min(UPLOAD_LIMITS.maxFileBytes, kindCap);
  if (cap === 0) return { ok: false, failureCode: 'mime_not_allowed', message: `Asset kind ${req.kind} cannot be uploaded` };
  if (req.byteLength > cap) return { ok: false, failureCode: 'file_too_large', message: `File exceeds the ${Math.round(cap / MiB)} MiB limit for ${req.kind}` };
  const expectedKind = kindForMime(mime);
  if (expectedKind !== req.kind) return { ok: false, failureCode: 'mime_not_allowed', message: `Content type ${req.contentType} is not a ${req.kind}` };
  if (normalizeFilename(req.filename) === 'untitled' && req.filename.trim().length > 0 && !/untitled/i.test(req.filename)) {
    return { ok: false, failureCode: 'invalid_filename', message: 'Filename contains no usable characters' };
  }
  if (req.relativePath !== undefined) {
    const check = checkRelativePath(req.relativePath);
    if (!check.ok) return { ok: false, failureCode: 'invalid_path', message: check.reason };
  }
  if (req.partSizeBytes !== undefined) {
    try {
      planParts(req.byteLength, req.partSizeBytes);
    } catch (e) {
      return { ok: false, failureCode: 'invalid_part_size', message: (e as Error).message };
    }
  }
  return { ok: true };
}

/** Broad asset kind implied by an allowed MIME type. */
export function kindForMime(mimeType: string): AssetKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m === 'text/vtt' || m === 'application/x-subrip') return 'subtitle';
  if (m === 'application/zip') return 'archive';
  return 'document';
}

export interface InitiateContext {
  uploadId: string;
  assetId: string;
  userId: string;
  now: Date;
  /** Session previously stored under the same (user, idempotencyKey), if any. */
  existing?: UploadSession | null;
}

export type InitiateResult =
  | { outcome: 'created'; session: UploadSession }
  | { outcome: 'resumed'; session: UploadSession; completedPartNumbers: number[] }
  | { outcome: 'rejected'; failureCode: UploadFailureCode; message: string };

/** Create (or idempotently resume) an upload session. */
export function initiateUpload(req: UploadInitiateRequest, ctx: InitiateContext): InitiateResult {
  const fingerprint = idempotencyFingerprint(req, ctx.userId);
  if (ctx.existing) {
    if (ctx.existing.fingerprint !== fingerprint) {
      return { outcome: 'rejected', failureCode: 'idempotency_conflict', message: 'Idempotency key reused with a different payload' };
    }
    const existing = isExpired(ctx.existing, ctx.now) && !isTerminalUploadStatus(ctx.existing.status) ? expireUpload(ctx.existing, ctx.now) : ctx.existing;
    if (existing.status === 'aborted' || existing.status === 'expired' || existing.status === 'failed') {
      // A dead session under the same key starts over with a fresh session (same key is allowed because the payload matches).
    } else {
      return { outcome: 'resumed', session: existing, completedPartNumbers: existing.completedParts.map((p) => p.partNumber).sort((a, b) => a - b) };
    }
  }
  const validation = validateInitiateRequest(req);
  if (!validation.ok) return { outcome: 'rejected', failureCode: validation.failureCode, message: validation.message };
  const plan = planParts(req.byteLength, req.partSizeBytes);
  const nowIso = ctx.now.toISOString();
  const session: UploadSession = {
    uploadId: ctx.uploadId,
    assetId: ctx.assetId,
    userId: ctx.userId,
    status: 'initiated',
    kind: req.kind,
    storageKey: buildMasterKey({ assetId: ctx.assetId, contentHash: req.clientChecksumSha256, mimeType: req.contentType }),
    declaredMimeType: req.contentType.toLowerCase(),
    declaredByteLength: req.byteLength,
    clientChecksumSha256: req.clientChecksumSha256.toLowerCase(),
    originalFilename: normalizeFilename(req.filename),
    originalPath: req.relativePath !== undefined ? (checkRelativePath(req.relativePath) as { normalized: string }).normalized : null,
    partSizeBytes: plan.partSizeBytes,
    partCount: plan.partCount,
    completedParts: [],
    multipartUploadId: null,
    idempotencyKey: req.idempotencyKey,
    fingerprint,
    verifiedChecksumSha256: null,
    failureCode: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(ctx.now.getTime() + UPLOAD_LIMITS.sessionTtlMs).toISOString(),
  };
  return { outcome: 'created', session };
}

export function isExpired(session: UploadSession, now: Date): boolean {
  return now.getTime() >= Date.parse(session.expiresAt);
}

function withStatus(session: UploadSession, status: UploadStatus, now: Date, patch: Partial<UploadSession> = {}): UploadSession {
  if (session.status !== status && !canTransitionUpload(session.status, status)) {
    throw new Error(`Illegal upload transition ${session.status} → ${status}`);
  }
  return { ...session, ...patch, status, updatedAt: now.toISOString() };
}

export type StepResult<T = object> = ({ ok: true; session: UploadSession } & T) | { ok: false; session: UploadSession; failureCode: UploadFailureCode; message: string };

function reject(session: UploadSession, failureCode: UploadFailureCode, message: string, now: Date, markFailed: boolean): StepResult<never> {
  const next = markFailed && canTransitionUpload(session.status, 'failed') ? withStatus(session, 'failed', now, { failureCode }) : session;
  return { ok: false, session: next, failureCode, message };
}

/** Record that presigned URLs were issued for `partNumbers` (moves the session into `uploading`). */
export function signParts(session: UploadSession, partNumbers: number[], now: Date): StepResult<{ partNumbers: number[]; urlExpiresAt: string }> {
  if (isExpired(session, now)) return reject(expireUpload(session, now), 'expired', 'Upload session has expired', now, false);
  if (session.status !== 'initiated' && session.status !== 'uploading') return reject(session, 'invalid_state', `Cannot sign parts while ${session.status}`, now, false);
  if (partNumbers.length === 0 || partNumbers.length > UPLOAD_LIMITS.maxPartsPerSignRequest) return reject(session, 'unknown_part', `Sign between 1 and ${UPLOAD_LIMITS.maxPartsPerSignRequest} parts per request`, now, false);
  const unique = [...new Set(partNumbers)].sort((a, b) => a - b);
  for (const n of unique) {
    if (!Number.isInteger(n) || n < 1 || n > session.partCount) return reject(session, 'unknown_part', `Part ${n} is outside 1..${session.partCount}`, now, false);
  }
  return { ok: true, session: withStatus(session, 'uploading', now), partNumbers: unique, urlExpiresAt: new Date(now.getTime() + UPLOAD_LIMITS.signedPartTtlMs).toISOString() };
}

/** Record a part the client reports as uploaded (ETag from R2). Re-uploading a part replaces the record. */
export function recordCompletedPart(session: UploadSession, part: CompletedPart, now: Date): StepResult {
  if (session.status !== 'initiated' && session.status !== 'uploading') return reject(session, 'invalid_state', `Cannot record parts while ${session.status}`, now, false);
  if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > session.partCount) return reject(session, 'unknown_part', `Part ${part.partNumber} is outside 1..${session.partCount}`, now, false);
  const sizeCheck = checkPartSize(session, part.partNumber, part.byteLength);
  if (sizeCheck) return reject(session, 'part_size_mismatch', sizeCheck, now, false);
  const completedParts = [...session.completedParts.filter((p) => p.partNumber !== part.partNumber), { ...part }].sort((a, b) => a.partNumber - b.partNumber);
  return { ok: true, session: withStatus(session, 'uploading', now, { completedParts }) };
}

function checkPartSize(session: UploadSession, partNumber: number, byteLength: number): string | null {
  const isLast = partNumber === session.partCount;
  if (!isLast && byteLength !== session.partSizeBytes) return `Part ${partNumber} must be exactly ${session.partSizeBytes} bytes`;
  if (isLast) {
    const expected = session.declaredByteLength - session.partSizeBytes * (session.partCount - 1);
    if (byteLength !== expected) return `Last part must be ${expected} bytes`;
  }
  return null;
}

export interface CompleteRequest {
  parts: CompletedPart[];
  clientChecksumSha256: string;
}

/** What the API observed from R2 after `CompleteMultipartUpload` / `HEAD` (and optionally the first bytes). */
export interface ObservedObject {
  byteLength: number;
  etag?: string | null;
  /** First ≥16 bytes of the object, when the API fetched them, for container sniffing. */
  head?: Uint8Array;
}

/**
 * Complete an upload: verifies part count/sizes/ETags against what was recorded, the declared
 * checksum, and the object size reported by storage. On success the session is `completed` and
 * awaits the server-side `verify` step (re-hash + sniff + metadata).
 */
export function completeUpload(session: UploadSession, req: CompleteRequest, observed: ObservedObject, now: Date): StepResult<{ nextStep: 'verify' }> {
  if (isExpired(session, now)) return reject(expireUpload(session, now), 'expired', 'Upload session has expired', now, false);
  if (session.status !== 'initiated' && session.status !== 'uploading') return reject(session, 'invalid_state', `Cannot complete while ${session.status}`, now, false);
  if (req.clientChecksumSha256.toLowerCase() !== session.clientChecksumSha256) return reject(session, 'checksum_mismatch', 'Client checksum differs from the one declared at initiate', now, true);
  const parts = [...req.parts].sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== session.partCount) return reject(session, 'part_count_mismatch', `Expected ${session.partCount} parts, received ${parts.length}`, now, true);
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as CompletedPart;
    if (p.partNumber !== i + 1) return reject(session, 'part_count_mismatch', `Part ${i + 1} is missing`, now, true);
    const sizeCheck = checkPartSize(session, p.partNumber, p.byteLength);
    if (sizeCheck) return reject(session, 'part_size_mismatch', sizeCheck, now, true);
    const recorded = session.completedParts.find((r) => r.partNumber === p.partNumber);
    if (recorded && recorded.etag !== p.etag) return reject(session, 'etag_mismatch', `ETag for part ${p.partNumber} does not match the recorded upload`, now, true);
    total += p.byteLength;
  }
  if (total !== session.declaredByteLength) return reject(session, 'byte_length_mismatch', 'Parts do not add up to the declared size', now, true);
  if (observed.byteLength !== session.declaredByteLength) return reject(session, 'byte_length_mismatch', `Storage reports ${observed.byteLength} bytes, expected ${session.declaredByteLength}`, now, true);
  if (observed.head) {
    const check = verifyDeclaredContentType(session.declaredMimeType, observed.head);
    if (!check.ok) return reject(session, check.reason, `Declared ${session.declaredMimeType} but content sniffs as ${check.sniffed?.mimeType ?? 'unknown'}`, now, true);
  }
  return { ok: true, session: withStatus(session, 'completed', now, { completedParts: parts }), nextStep: 'verify' };
}

export interface ServerVerification {
  /** SHA-256 computed by re-reading the stored object. */
  serverChecksumSha256: string;
  /** Sniffed MIME type from the stored object's first bytes. */
  sniffedMimeType: string | null;
}

/** Final server-side verification: checksum must equal the declared one and the container must match. */
export function verifyUpload(session: UploadSession, verification: ServerVerification, now: Date): StepResult<{ contentState: ContentState }> {
  if (session.status !== 'completed') return reject(session, 'invalid_state', `Cannot verify while ${session.status}`, now, false);
  const server = verification.serverChecksumSha256.toLowerCase();
  if (server !== session.clientChecksumSha256) return reject(session, 'checksum_mismatch', 'Server-side checksum does not match the client checksum', now, true);
  if (verification.sniffedMimeType && !isCompatibleMime(session.declaredMimeType, verification.sniffedMimeType)) {
    return reject(session, 'content_type_mismatch', `Stored object is ${verification.sniffedMimeType}, not ${session.declaredMimeType}`, now, true);
  }
  return { ok: true, session: withStatus(session, 'verified', now, { verifiedChecksumSha256: server, failureCode: null }), contentState: 'imported_draft' };
}

export function abortUpload(session: UploadSession, now: Date): UploadSession {
  if (isTerminalUploadStatus(session.status)) return session;
  return withStatus(session, 'aborted', now);
}

export function expireUpload(session: UploadSession, now: Date): UploadSession {
  if (isTerminalUploadStatus(session.status)) return session;
  return withStatus(session, 'expired', now, { failureCode: 'expired' });
}

// --- orphan cleanup -------------------------------------------------------------

/** Storage lifecycle policy for abandoned uploads; mirrored as an R2 lifecycle rule by infra. */
export const ORPHAN_CLEANUP_POLICY = {
  /** Abort incomplete multipart uploads this long after the session expires. */
  abortIncompleteAfterMs: UPLOAD_LIMITS.sessionTtlMs,
  /** Delete objects of failed/aborted sessions after this grace period (allows support inspection). */
  deleteFailedObjectsAfterMs: 6 * 60 * 60 * 1000,
  /** Sessions `completed` but never verified are re-queued for verification, then failed after this. */
  verifyTimeoutMs: 12 * 60 * 60 * 1000,
  /** R2 bucket lifecycle rule (days) applied to the `uploads/` and multipart prefixes as a safety net. */
  r2AbortIncompleteMultipartDays: 2,
} as const;

export type OrphanAction =
  | { uploadId: string; action: 'expire_session' }
  | { uploadId: string; action: 'abort_multipart'; multipartUploadId: string; storageKey: string }
  | { uploadId: string; action: 'delete_object'; storageKey: string }
  | { uploadId: string; action: 'requeue_verify' }
  | { uploadId: string; action: 'fail_unverified' };

/** Plan sweeper actions for a batch of sessions. Verified sessions are never touched. */
export function planOrphanCleanup(sessions: readonly UploadSession[], now: Date): OrphanAction[] {
  const actions: OrphanAction[] = [];
  const t = now.getTime();
  for (const s of sessions) {
    const updated = Date.parse(s.updatedAt);
    switch (s.status) {
      case 'initiated':
      case 'uploading':
        if (isExpired(s, now)) {
          actions.push({ uploadId: s.uploadId, action: 'expire_session' });
          if (s.multipartUploadId) actions.push({ uploadId: s.uploadId, action: 'abort_multipart', multipartUploadId: s.multipartUploadId, storageKey: s.storageKey });
        }
        break;
      case 'expired':
      case 'aborted':
      case 'failed':
        if (s.multipartUploadId && s.status !== 'failed') actions.push({ uploadId: s.uploadId, action: 'abort_multipart', multipartUploadId: s.multipartUploadId, storageKey: s.storageKey });
        if (t - updated >= ORPHAN_CLEANUP_POLICY.deleteFailedObjectsAfterMs) actions.push({ uploadId: s.uploadId, action: 'delete_object', storageKey: s.storageKey });
        break;
      case 'completed':
        if (t - updated >= ORPHAN_CLEANUP_POLICY.verifyTimeoutMs) actions.push({ uploadId: s.uploadId, action: 'fail_unverified' });
        else actions.push({ uploadId: s.uploadId, action: 'requeue_verify' });
        break;
      case 'verified':
        break;
    }
  }
  return actions;
}

// --- dedupe ---------------------------------------------------------------------

export interface ExistingAssetForDedupe {
  assetId: string;
  checksumSha256: string;
  storageKey: string;
  contentRightsId: string | null;
  ownerId: string | null;
  disposition: 'active' | 'quarantined' | 'revoked' | 'deleted';
  state: ContentState;
}

export interface DedupeInput {
  incomingChecksumSha256: string;
  /** Rights record the uploader intends to attach (null when unknown yet). */
  incomingContentRightsId: string | null;
  incomingOwnerId: string;
  /** Verified assets whose checksum equals the incoming one. */
  existing: readonly ExistingAssetForDedupe[];
  /** Caller explicitly asked to reuse the existing logical asset instead of creating a new one. */
  allowReuse?: boolean;
}

export type DedupeDecision =
  | { decision: 'new_blob'; duplicateOfAssetId: null; reason: string }
  | { decision: 'link_existing_blob'; duplicateOfAssetId: string; storageKey: string; reason: string }
  | { decision: 'reuse_asset'; duplicateOfAssetId: string; storageKey: string; reason: string }
  | { decision: 'blocked'; duplicateOfAssetId: string; reason: string };

/**
 * Decide what to do with an upload whose bytes already exist.
 *  - no match → `new_blob`;
 *  - match with a *different* rights record / owner → `link_existing_blob` (shares the physical object,
 *    keeps a separate logical asset with its own rights/metadata — never merged silently);
 *  - match with the same rights record and owner → `reuse_asset` only when the caller opted in, else link;
 *  - match that is revoked/quarantined → `blocked` (the takedown must not be bypassed by re-uploading).
 */
export function decideDedupe(input: DedupeInput): DedupeDecision {
  const hash = input.incomingChecksumSha256.toLowerCase();
  const matches = input.existing.filter((a) => a.checksumSha256.toLowerCase() === hash && a.disposition !== 'deleted');
  if (matches.length === 0) return { decision: 'new_blob', duplicateOfAssetId: null, reason: 'no verified asset shares this content hash' };
  const blocked = matches.find((a) => a.disposition === 'revoked' || a.disposition === 'quarantined');
  if (blocked) return { decision: 'blocked', duplicateOfAssetId: blocked.assetId, reason: `identical content was ${blocked.disposition}; re-upload cannot bypass a takedown` };
  const sameRights = matches.find((a) => a.contentRightsId !== null && a.contentRightsId === input.incomingContentRightsId && a.ownerId === input.incomingOwnerId);
  if (sameRights && input.allowReuse) {
    return { decision: 'reuse_asset', duplicateOfAssetId: sameRights.assetId, storageKey: sameRights.storageKey, reason: 'identical bytes, same rights record and owner; caller opted in to reuse' };
  }
  const first = matches[0] as ExistingAssetForDedupe;
  return {
    decision: 'link_existing_blob',
    duplicateOfAssetId: first.assetId,
    storageKey: first.storageKey,
    reason: sameRights ? 'identical bytes and rights; new logical asset created (reuse not requested)' : 'identical bytes but distinct rights/metadata; physical blob shared, logical assets kept separate',
  };
}

// --- DB mapping -----------------------------------------------------------------

/** Map a session to the `uploads` row columns (without `id`/timestamps managed by the DB). */
export function toUploadRow(session: UploadSession): Omit<UploadRow, 'id' | 'created_at' | 'updated_at'> & { id: string } {
  return {
    id: session.uploadId,
    user_id: session.userId,
    draft_asset_id: session.assetId,
    storage_key: session.storageKey,
    multipart_upload_id: session.multipartUploadId,
    part_size_bytes: session.partSizeBytes,
    part_count: session.partCount,
    completed_parts: session.completedParts.map((p) => ({ part_number: p.partNumber, etag: p.etag, byte_length: p.byteLength })),
    original_filename: session.originalFilename,
    original_path: session.originalPath,
    declared_mime_type: session.declaredMimeType,
    declared_byte_length: session.declaredByteLength,
    client_checksum_sha256: session.clientChecksumSha256,
    verified_checksum_sha256: session.verifiedChecksumSha256,
    status: session.status,
    failure_code: session.failureCode,
    idempotency_key: session.idempotencyKey,
    expires_at: session.expiresAt,
  };
}

/** Rebuild a session from an `uploads` row plus the fields the row does not store. */
export function fromUploadRow(row: UploadRow, extra: { kind: AssetKind; fingerprint: string }): UploadSession {
  return {
    uploadId: row.id,
    assetId: row.draft_asset_id ?? row.id,
    userId: row.user_id,
    status: row.status,
    kind: extra.kind,
    storageKey: row.storage_key,
    declaredMimeType: row.declared_mime_type,
    declaredByteLength: row.declared_byte_length,
    clientChecksumSha256: row.client_checksum_sha256,
    originalFilename: row.original_filename,
    originalPath: row.original_path,
    partSizeBytes: row.part_size_bytes,
    partCount: row.part_count,
    completedParts: row.completed_parts.map((p) => ({ partNumber: p.part_number, etag: p.etag, byteLength: p.byte_length })),
    multipartUploadId: row.multipart_upload_id,
    idempotencyKey: row.idempotency_key,
    fingerprint: extra.fingerprint,
    verifiedChecksumSha256: row.verified_checksum_sha256,
    failureCode: (row.failure_code as UploadFailureCode | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}
