/**
 * §6.4 uploads (§7.2, A18): resumable multipart uploads straight to R2 with the `@langquest/media` upload state
 * machine as the single source of truth for transitions, part accounting and checksum/size verification.
 *
 * R2 multipart goes through the S3 API (`aws4fetch`): CreateMultipartUpload at initiate, presigned UploadPart
 * URLs on demand, CompleteMultipartUpload + HEAD + head-bytes sniff at complete, AbortMultipartUpload on abort.
 * Small objects are re-hashed in the Worker for immediate verification; large ones get a `verify` job for the
 * Node runner (no multi-GB hashing in a Worker). Object keys are generated (`media/{assetId}/{sha256}.{ext}`),
 * never user filenames; the original name/path is stored as legacy metadata only.
 */
import { UploadAbortRequestSchema, UploadAbortResponseSchema, UploadCompleteRequestSchema, UploadCompleteResponseSchema, UploadInitiateRequestSchema, UploadInitiateResponseSchema, UploadPartsSignRequestSchema, UploadPartsSignResponseSchema, UuidSchema, type ContentState } from '@langquest/contracts';
import type { Row } from '@langquest/db/types';
import { sha256Hex as mediaSha256 } from '@langquest/media/hashing';
import { parseObjectKey } from '@langquest/media/keys';
import { sniffContainer } from '@langquest/media/metadata';
import { abortUpload, completeUpload, decideDedupe, fromUploadRow, idempotencyFingerprint, initiateUpload, isTerminalUploadStatus, kindForMime, signParts, toUploadRow, UPLOAD_LIMITS, verifyUpload, type UploadSession } from '@langquest/media/uploads';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import { hasAnyRole } from '../../middleware/auth';
import type { RequestServices } from '../../services/context';
import { R2_UNAVAILABLE_MESSAGE } from '../../services/r2';

const IdParams = z.object({ id: UuidSchema });
/** Objects up to this size are re-hashed inline in the Worker; larger ones are verified by the jobs runner. */
export const INLINE_VERIFY_MAX_BYTES = 32 * 1024 * 1024;

async function loadSession(s: RequestServices, uploadId: string): Promise<{ row: Row<'uploads'>; session: UploadSession }> {
  const { principal } = s.requireUser();
  const res = await s.service.from('uploads').select('*').eq('id', uploadId).maybeSingle();
  if (!res.data) throw problem.notFound('Upload');
  if (res.data.user_id !== principal.userId && !hasAnyRole(principal, 'admin')) throw problem.forbidden('This upload belongs to another editor');
  const row = res.data;
  const kind = kindForMime(row.declared_mime_type);
  const session = fromUploadRow(row as unknown as Parameters<typeof fromUploadRow>[0], { kind, fingerprint: '' });
  session.assetId = parseObjectKey(row.storage_key)?.scope === 'master' ? (parseObjectKey(row.storage_key) as { assetId: string }).assetId : row.draft_asset_id ?? row.id;
  return { row, session };
}

async function persistSession(s: RequestServices, session: UploadSession, extra: Partial<Row<'uploads'>> = {}): Promise<void> {
  const { id, ...rest } = toUploadRow(session);
  const patch = { ...rest, ...extra, draft_asset_id: extra.draft_asset_id ?? null };
  const res = await s.service.from('uploads').update(patch).eq('id', id);
  if (res.error) throw problem.internal(`Could not persist the upload session: ${res.error.message}`);
}

export function registerUploadRoutes(define: DefineRoute): void {
  define('adminUploadInitiate', { role: 'contentEditor', idempotent: false }, async (c) => {
    const body = await parseBody(c, UploadInitiateRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const now = new Date();
    const fingerprint = idempotencyFingerprint(body, principal.userId);
    const existingRes = await s.service.from('uploads').select('*').eq('user_id', principal.userId).eq('idempotency_key', body.idempotencyKey).maybeSingle();
    const existing = existingRes.data ? fromUploadRow(existingRes.data as unknown as Parameters<typeof fromUploadRow>[0], { kind: kindForMime(existingRes.data.declared_mime_type), fingerprint }) : null;
    const assetId = existing ? (parseObjectKey(existing.storageKey) as { assetId?: string } | null)?.assetId ?? crypto.randomUUID() : crypto.randomUUID();
    const result = initiateUpload(body, { uploadId: existing?.uploadId ?? crypto.randomUUID(), assetId, userId: principal.userId, now, existing });
    if (result.outcome === 'rejected') {
      if (result.failureCode === 'idempotency_conflict') throw problem.conflict(result.message);
      throw problem.validation(result.message, { failureCode: result.failureCode });
    }
    const duplicates = await s.service.from('media_assets').select('id, checksum_sha256, storage_key, content_rights_id, owner_id, disposition, state').eq('checksum_sha256', body.clientChecksumSha256.toLowerCase()).limit(10);
    const dedupe = decideDedupe({ incomingChecksumSha256: body.clientChecksumSha256, incomingContentRightsId: null, incomingOwnerId: principal.userId, existing: (duplicates.data ?? []).map((a) => ({ assetId: a.id, checksumSha256: a.checksum_sha256, storageKey: a.storage_key, contentRightsId: a.content_rights_id, ownerId: a.owner_id, disposition: a.disposition as 'active', state: a.state as ContentState })) });
    if (dedupe.decision === 'blocked') throw problem.rights(`Upload refused: ${dedupe.reason}`, { duplicateOfAssetId: dedupe.duplicateOfAssetId });

    let session = result.session;
    let resumed = result.outcome === 'resumed';
    let completedPartNumbers = result.outcome === 'resumed' ? result.completedPartNumbers : [];
    if (result.outcome === 'created') {
      if (!s.media.canPresign) throw problem.unsupported(s.media.available ? 'Multipart uploads need R2 S3 credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)' : R2_UNAVAILABLE_MESSAGE);
      const multipartUploadId = await s.media.createMultipart(session.storageKey, session.declaredMimeType);
      session = { ...session, multipartUploadId };
      const { id, ...rest } = toUploadRow(session);
      const ins = existing
        ? await s.service.from('uploads').update({ ...rest, draft_asset_id: null }).eq('id', id)
        : await s.service.from('uploads').insert({ id, ...rest, draft_asset_id: null });
      if (ins.error) throw problem.internal(`Could not create the upload session: ${ins.error.message}`);
      s.audit({ action: 'upload.initiate', entityTable: 'uploads', entityId: id, after: { storageKey: session.storageKey, byteLength: session.declaredByteLength, parts: session.partCount, dedupe: dedupe.decision } });
    } else if (resumed) {
      completedPartNumbers = session.completedParts.map((p) => p.partNumber).sort((a, b) => a - b);
      resumed = true;
    }
    return respondOk(c, UploadInitiateResponseSchema.parse({ uploadId: session.uploadId, storageKey: session.storageKey, partSizeBytes: session.partSizeBytes, partCount: session.partCount, expiresAt: session.expiresAt, status: session.status, duplicateOfAssetId: dedupe.duplicateOfAssetId, resumed, completedPartNumbers }), resumed ? 200 : 201);
  });

  define('adminUploadPartsSign', { role: 'contentEditor', idempotent: false }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, UploadPartsSignRequestSchema);
    const s = c.get('services')!;
    const { session } = await loadSession(s, id);
    if (!session.multipartUploadId) throw problem.precondition('Upload has no multipart session; initiate again');
    const result = signParts(session, body.partNumbers, new Date());
    if (!result.ok) {
      await persistSession(s, result.session);
      throw problem.precondition(result.message, { failureCode: result.failureCode });
    }
    const ttl = Math.floor(UPLOAD_LIMITS.signedPartTtlMs / 1000);
    const parts = await Promise.all(result.partNumbers.map(async (partNumber) => ({ partNumber, url: await s.media.presignUploadPart(session.storageKey, session.multipartUploadId!, partNumber, ttl), expiresAt: result.urlExpiresAt })));
    if (result.session.status !== session.status) await persistSession(s, result.session);
    return respondOk(c, UploadPartsSignResponseSchema.parse({ parts }));
  });

  define('adminUploadComplete', { role: 'contentEditor', timeoutMs: 55_000 }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, UploadCompleteRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const { row, session } = await loadSession(s, id);
    const now = new Date();
    if (isTerminalUploadStatus(session.status)) {
      return respondOk(c, UploadCompleteResponseSchema.parse({ uploadId: id, status: session.status, assetId: row.draft_asset_id, verifiedChecksumSha256: session.verifiedChecksumSha256, byteLength: session.declaredByteLength, durationMs: null, contentState: row.draft_asset_id ? 'imported_draft' : null, queuedJobIds: [], failureCode: session.failureCode }));
    }
    if (!session.multipartUploadId) throw problem.precondition('Upload has no multipart session');
    // 1. Close the multipart upload in R2 and observe the resulting object.
    let observed: { byteLength: number; etag: string | null; head?: Uint8Array };
    try {
      const completed = await s.media.completeMultipart(session.storageKey, session.multipartUploadId, body.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
      const head = await s.media.head(session.storageKey);
      if (!head) throw problem.provider('Object missing after multipart completion');
      const first = await s.media.readBytes(session.storageKey, 0, 15);
      observed = { byteLength: head.size, etag: completed.etag ?? head.etag, head: first ?? undefined };
    } catch (error) {
      s.log.error('upload.complete_failed', { uploadId: id, error });
      throw error;
    }
    const completedResult = completeUpload(session, { parts: body.parts, clientChecksumSha256: body.clientChecksumSha256 }, observed, now);
    if (!completedResult.ok) {
      await persistSession(s, completedResult.session);
      s.audit({ action: 'upload.complete_rejected', entityTable: 'uploads', entityId: id, after: { failureCode: completedResult.failureCode } });
      return respondOk(c, UploadCompleteResponseSchema.parse({ uploadId: id, status: completedResult.session.status, assetId: null, verifiedChecksumSha256: null, byteLength: observed.byteLength, durationMs: null, contentState: null, queuedJobIds: [], failureCode: completedResult.failureCode }));
    }
    let current = completedResult.session;
    // 2. Verify: inline re-hash for small objects, otherwise a `verify` job for the Node runner.
    const queuedJobIds: string[] = [];
    let verifiedChecksum: string | null = null;
    if (observed.byteLength <= INLINE_VERIFY_MAX_BYTES && s.media.available) {
      const bytes = await s.media.readBytes(session.storageKey, 0, observed.byteLength - 1);
      if (bytes) {
        const sniffed = sniffContainer(bytes.subarray(0, 16));
        const verification = verifyUpload(current, { serverChecksumSha256: await mediaSha256(bytes), sniffedMimeType: sniffed?.mimeType ?? null }, now);
        if (!verification.ok) {
          await persistSession(s, verification.session);
          s.audit({ action: 'upload.verify_rejected', entityTable: 'uploads', entityId: id, after: { failureCode: verification.failureCode } });
          return respondOk(c, UploadCompleteResponseSchema.parse({ uploadId: id, status: verification.session.status, assetId: null, verifiedChecksumSha256: null, byteLength: observed.byteLength, durationMs: null, contentState: null, queuedJobIds: [], failureCode: verification.failureCode }));
        }
        current = verification.session;
        verifiedChecksum = current.verifiedChecksumSha256;
      }
    }
    // 3. Draft asset row (DB owns labels; the object key never changes) + jobs/events.
    const assetId = session.assetId;
    const assetIns = await s.service.from('media_assets').upsert({ id: assetId, storage_key: session.storageKey, bucket: s.media.bucket, owner_id: principal.userId, kind: session.kind, checksum_sha256: session.clientChecksumSha256, mime_type: session.declaredMimeType, byte_length: observed.byteLength, visibility: 'private', state: 'imported_draft', disposition: 'active', legacy_filename: session.originalFilename, legacy_path: session.originalPath, etag: observed.etag }, { onConflict: 'id' }).select('id').single();
    if (assetIns.error) throw problem.internal(`Could not create the draft asset: ${assetIns.error.message}`);
    await persistSession(s, current, { draft_asset_id: assetId });
    await s.repos.processingJobs.recordProvenance({ asset_id: assetId, event_type: 'uploaded', actor_id: principal.userId, details: { uploadId: id, filename: session.originalFilename, path: session.originalPath } }).catch(() => undefined);
    // One job row per type: the route enqueues with the exact keys/params the `apps/jobs` handlers expect and the
    // event dispatcher (`jobForEvent`) derives the same keys, so its idempotent re-enqueue returns these rows.
    if (verifiedChecksum) {
      const job = await s.repos.processingJobs.enqueue({ jobType: 'extract_metadata', idempotencyKey: `extract_metadata:${assetId}:${verifiedChecksum}`, parentAssetId: assetId, requestedBy: principal.userId, params: { assetId } });
      queuedJobIds.push(job.id);
      await s.events.emit('asset.verified', { assetId, durationMs: null, mimeType: session.declaredMimeType, checksumSha256: verifiedChecksum, duplicateOfAssetId: null, state: 'imported_draft' }, { idempotencyKey: `asset.verified:${assetId}:${verifiedChecksum}`, traceId: s.requestId });
      if (session.kind === 'audio') {
        const formats: Array<'aac' | 'opus'> = ['aac', 'opus'];
        const t = await s.repos.processingJobs.enqueue({ jobType: 'transcode', idempotencyKey: `transcode:${assetId}:${verifiedChecksum}`, parentAssetId: assetId, requestedBy: principal.userId, params: { assetId, formats } });
        queuedJobIds.push(t.id);
        await s.events.emit('transcode.requested', { assetId, jobId: t.id, targetFormats: formats, priority: 5 }, { idempotencyKey: `transcode.requested:${t.id}`, traceId: s.requestId });
      }
    } else {
      const job = await s.repos.processingJobs.enqueue({ jobType: 'verify', idempotencyKey: `verify:${id}:${session.clientChecksumSha256}`, parentAssetId: assetId, requestedBy: principal.userId, params: { uploadId: id, assetId, storageKey: session.storageKey, expectedChecksum: session.clientChecksumSha256 } });
      queuedJobIds.push(job.id);
    }
    // Verified inline ⇒ no `verify` job for this event (the dispatcher would otherwise create one).
    await s.events.emit('upload.finalized', { uploadId: id, assetId, storageKey: session.storageKey, checksumSha256: session.clientChecksumSha256, byteLength: observed.byteLength, mimeType: session.declaredMimeType, uploaderId: principal.userId }, { idempotencyKey: `upload.finalized:${id}`, traceId: s.requestId, enqueueJob: verifiedChecksum === null });
    s.audit({ action: 'upload.complete', entityTable: 'media_assets', entityId: assetId, after: { status: current.status, byteLength: observed.byteLength, verifiedInline: verifiedChecksum !== null, jobs: queuedJobIds } });
    return respondOk(c, UploadCompleteResponseSchema.parse({ uploadId: id, status: current.status, assetId, verifiedChecksumSha256: verifiedChecksum, byteLength: observed.byteLength, durationMs: null, contentState: 'imported_draft', queuedJobIds, failureCode: null }));
  });

  define('adminUploadAbort', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, UploadAbortRequestSchema);
    const s = c.get('services')!;
    const { session } = await loadSession(s, id);
    const aborted = abortUpload(session, new Date());
    if (aborted.status !== session.status) {
      if (session.multipartUploadId && s.media.canPresign) await s.media.abortMultipart(session.storageKey, session.multipartUploadId).catch((error) => s.log.warn('upload.abort_r2_failed', { error }));
      await persistSession(s, aborted);
      s.audit({ action: 'upload.abort', entityTable: 'uploads', entityId: id, after: { reason: body.reason ?? null } });
    }
    return respondOk(c, UploadAbortResponseSchema.parse({ uploadId: id, status: aborted.status }));
  });
}
