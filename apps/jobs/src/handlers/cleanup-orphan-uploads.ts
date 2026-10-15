/**
 * `cleanup_orphan_uploads` — storage lifecycle sweeper for abandoned multipart uploads (§7.2 "orphan
 * multipart cleanup and storage lifecycle policies"). The decisions come from the shared
 * `planOrphanCleanup` policy in `@langquest/media`; this handler only executes them: expire stale sessions,
 * abort their multipart uploads, delete staging objects of failed/aborted sessions after the grace period,
 * re-queue `completed`-but-unverified sessions for verification and fail them after the verify timeout.
 * Verified sessions are never touched. Runs under the carrier job type `describe` with
 * `params.handler = 'cleanup_orphan_uploads'`; `dryRun` reports the plan only.
 */
import { z } from 'zod';
import { fromUploadRow, kindForMime, planOrphanCleanup, type OrphanAction, type UploadSession } from '@langquest/media';
import type { JobHandler } from '../queue/types';

export const CleanupOrphanUploadsParamsSchema = z.object({
  dryRun: z.boolean().default(false),
  limitPerStatus: z.number().int().min(1).max(5000).default(500),
  statuses: z.array(z.enum(['initiated', 'uploading', 'completed', 'expired', 'aborted', 'failed'])).default(['initiated', 'uploading', 'completed', 'expired', 'aborted', 'failed']),
});
export type CleanupOrphanUploadsParams = z.infer<typeof CleanupOrphanUploadsParamsSchema>;

export const cleanupOrphanUploadsHandler: JobHandler<CleanupOrphanUploadsParams> = {
  name: 'cleanup_orphan_uploads',
  jobTypes: [],
  runtime: 'any',
  paramsSchema: CleanupOrphanUploadsParamsSchema,
  async run(ctx) {
    const { db, store } = ctx.services;
    const now = ctx.services.now();
    const sessions: UploadSession[] = [];
    for (const status of ctx.params.statuses) {
      const rows = await db.listUploadsByStatus(status, ctx.params.limitPerStatus);
      for (const row of rows) {
        // `completed_parts` is jsonb in the generated types; the media session model expects the typed array.
        const parts = Array.isArray(row.completed_parts) ? (row.completed_parts as Array<{ part_number: number; etag: string; byte_length: number }>) : [];
        sessions.push(fromUploadRow({ ...row, completed_parts: parts } as Parameters<typeof fromUploadRow>[0], { kind: kindForMime(row.declared_mime_type), fingerprint: row.idempotency_key }));
      }
    }
    const plan = planOrphanCleanup(sessions, now);
    await ctx.progress(20, `${plan.length} actions planned for ${sessions.length} sessions`);

    const counts: Record<OrphanAction['action'], number> = { expire_session: 0, abort_multipart: 0, delete_object: 0, requeue_verify: 0, fail_unverified: 0 };
    const failures: Array<{ uploadId: string; action: string; reason: string }> = [];
    const bySession = new Map(sessions.map((s) => [s.uploadId, s]));

    for (const [i, action] of plan.entries()) {
      counts[action.action] += 1;
      if (ctx.params.dryRun) continue;
      try {
        switch (action.action) {
          case 'expire_session':
            await db.updateUpload(action.uploadId, { status: 'expired', failure_code: 'expired' });
            break;
          case 'abort_multipart':
            await store.abortMultipart({ key: action.storageKey, uploadId: action.multipartUploadId }).catch((error: unknown) => ctx.log.warn('cleanup.abort_multipart_failed', { uploadId: action.uploadId, error }));
            ctx.cost.storage('multipart');
            await db.updateUpload(action.uploadId, { multipart_upload_id: null });
            break;
          case 'delete_object':
            if (await store.head(action.storageKey)) {
              await store.delete(action.storageKey);
              ctx.cost.storage('delete');
            }
            break;
          case 'requeue_verify': {
            const session = bySession.get(action.uploadId);
            if (session?.assetId) {
              await db.enqueueJob({ jobType: 'verify', idempotencyKey: `verify:${action.uploadId}:${session.clientChecksumSha256}`, params: { uploadId: action.uploadId, assetId: session.assetId, requeuedBy: 'cleanup_orphan_uploads' }, parentAssetId: session.assetId, requestedBy: null });
            }
            break;
          }
          case 'fail_unverified':
            await db.updateUpload(action.uploadId, { status: 'failed', failure_code: 'verify_timeout' });
            break;
        }
      } catch (error) {
        failures.push({ uploadId: action.uploadId, action: action.action, reason: (error as Error).message });
        ctx.log.warn('cleanup.action_failed', { uploadId: action.uploadId, action: action.action, error });
      }
      if (i % 25 === 0) await ctx.progress(20 + Math.round(((i + 1) / Math.max(1, plan.length)) * 78));
    }
    await ctx.progress(100);
    return { output: { dryRun: ctx.params.dryRun, sessions: sessions.length, planned: plan.length, counts, failures: failures.slice(0, 200), plan: ctx.params.dryRun ? plan.slice(0, 200) : undefined } };
  },
};
