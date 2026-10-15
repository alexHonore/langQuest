/**
 * Uploads (§7.2) and the Postgres-backed processing queue (ADR-005).
 * Claim/complete/fail go through SECURITY DEFINER RPCs using FOR UPDATE SKIP LOCKED.
 */
import type { DbClient } from '../client';
import { DbError, unwrap, unwrapMaybe } from '../errors';
import type { FnReturns, Insert, Row, Update } from '../types';

export interface EnqueueJobInput {
  jobType: Row<'processing_jobs'>['job_type'];
  /** Stable key (e.g. `${jobType}:${assetId}:${contentHash}`) — re-enqueue returns the existing job. */
  idempotencyKey: string;
  params?: Record<string, unknown>;
  parentAssetId?: string | null;
  parentEntityTable?: string | null;
  parentEntityId?: string | null;
  priority?: number;
  /** Only honoured by the service role; an authenticated editor is always recorded as the requester. */
  requestedBy?: string | null;
  provider?: string | null;
  maxAttempts?: number;
}

/**
 * Everything the caller knows when opening an upload. The row id and the staging key are generated
 * here (`uploads/{id}/{clientChecksum}.{ext}`, enforced by `guard_upload_row`); the lifecycle columns
 * (`status`, multipart id, completed parts, verified checksum, promoted key, draft asset) are
 * server-managed and cannot be set by a JWT session (`guard_upload_client_write`). `part_count` may be
 * declared up front (it is only frozen for JWT sessions on UPDATE).
 */
export type InitiateUploadInput = Omit<
  Insert<'uploads'>,
  | 'id'
  | 'storage_key'
  | 'status'
  | 'multipart_upload_id'
  | 'completed_parts'
  | 'verified_checksum_sha256'
  | 'draft_asset_id'
> & {
  /** File extension for the staging key, derived from the verified MIME type (`mp3`, `wav`, …) — never from the user filename. */
  extension: string;
};

export interface UploadsRepository {
  getById(id: string): Promise<Row<'uploads'> | null>;
  /**
   * Opens an upload session. The id is generated client-side (`crypto.randomUUID`) so the staging key
   * can name its own row before the insert. Idempotent on (user_id, idempotency_key): a replay — or a
   * concurrent duplicate that loses the race — returns the existing session with `replayed: true`.
   */
  initiate(input: InitiateUploadInput): Promise<{ upload: Row<'uploads'>; replayed: boolean }>;
  /** Service role (API Worker) only: lifecycle columns are rejected for JWT sessions by `guard_upload_client_write`. */
  update(id: string, patch: Update<'uploads'>): Promise<Row<'uploads'>>;
  listByStatus(status: Row<'uploads'>['status'], limit?: number): Promise<Row<'uploads'>[]>;
}

export type RequeuedJob = FnReturns<'requeue_expired_jobs'>[number];

export interface ProcessingJobsRepository {
  enqueue(input: EnqueueJobInput): Promise<Row<'processing_jobs'>>;
  /** Claims one job (or none) for this worker. Service role only: every claim burns an attempt. */
  claim(
    workerId: string,
    jobTypes?: Row<'processing_jobs'>['job_type'][] | null,
    leaseSeconds?: number,
  ): Promise<Row<'processing_jobs'> | null>;
  heartbeat(
    jobId: string,
    workerId: string,
    progressPct?: number,
    leaseSeconds?: number,
  ): Promise<boolean>;
  complete(
    jobId: string,
    workerId: string,
    output?: Record<string, unknown> | null,
    outputAssetIds?: string[],
    costActualUsd?: number | null,
  ): Promise<Row<'processing_jobs'>>;
  fail(
    jobId: string,
    workerId: string,
    failureCode: string,
    failureMessage?: string | null,
    opts?: { retry?: boolean; backoffSeconds?: number },
  ): Promise<Row<'processing_jobs'>>;
  /**
   * Sweeps `running` jobs whose lease expired without a heartbeat (crashed worker): attempts left →
   * `pending`, exhausted → `review_needed`. Service role only; call it from the runner loop (or pg_cron).
   */
  requeueExpired(limit?: number): Promise<RequeuedJob[]>;
  getById(id: string): Promise<Row<'processing_jobs'> | null>;
  listForAsset(assetId: string): Promise<Row<'processing_jobs'>[]>;
  listByState(
    state: Row<'processing_jobs'>['state'],
    limit?: number,
  ): Promise<Row<'processing_jobs'>[]>;
  recordProvenance(row: Insert<'asset_provenance_events'>): Promise<Row<'asset_provenance_events'>>;
}

const EXTENSION_RE = /^[a-z0-9]{1,8}$/;

/**
 * Staging key for an upload row: `uploads/{uploadId}/{clientChecksumSha256}.{ext}` (object_key_scope → 'upload').
 * @throws Error when the extension or checksum cannot form a valid key.
 */
export function buildUploadStagingKey(
  uploadId: string,
  clientChecksumSha256: string,
  extension: string,
): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (!EXTENSION_RE.test(ext))
    throw new Error(`Invalid upload extension: ${JSON.stringify(extension)}`);
  const checksum = clientChecksumSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    throw new Error('client_checksum_sha256 must be a lowercase SHA-256 hex digest');
  return `uploads/${uploadId}/${checksum}.${ext}`;
}

export function uploadsRepository(db: DbClient): UploadsRepository {
  const findByIdempotencyKey = async (userId: string, idempotencyKey: string) =>
    unwrapMaybe(
      await db
        .from('uploads')
        .select('*')
        .eq('user_id', userId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle(),
      'uploads.initiate.lookup',
    );
  return {
    async getById(id) {
      return unwrapMaybe(
        await db.from('uploads').select('*').eq('id', id).single(),
        'uploads.getById',
      );
    },
    async initiate(input) {
      const existing = await findByIdempotencyKey(input.user_id, input.idempotency_key);
      if (existing) return { upload: existing, replayed: true };
      const { extension, ...rest } = input;
      const id = crypto.randomUUID();
      const row: Insert<'uploads'> = {
        ...rest,
        id,
        storage_key: buildUploadStagingKey(id, input.client_checksum_sha256, extension),
      };
      const inserted = await db.from('uploads').insert(row).select('*').single();
      if (inserted.error) {
        const err = new DbError(inserted.error, 'uploads.initiate');
        if (err.isUniqueViolation) {
          const raced = await findByIdempotencyKey(input.user_id, input.idempotency_key);
          if (raced) return { upload: raced, replayed: true };
        }
        throw err;
      }
      return { upload: inserted.data, replayed: false };
    },
    async update(id, patch) {
      return unwrap(
        await db.from('uploads').update(patch).eq('id', id).select('*').single(),
        'uploads.update',
      );
    },
    async listByStatus(status, limit = 100) {
      return unwrap(
        await db.from('uploads').select('*').eq('status', status).order('created_at').limit(limit),
        'uploads.listByStatus',
      );
    },
  };
}

export function processingJobsRepository(db: DbClient): ProcessingJobsRepository {
  return {
    async enqueue(input) {
      return unwrap(
        await db
          .rpc('enqueue_processing_job', {
            p_job_type: input.jobType,
            p_idempotency_key: input.idempotencyKey,
            p_params: (input.params ?? {}) as never,
            p_parent_asset_id: input.parentAssetId ?? undefined,
            p_parent_entity_table: input.parentEntityTable ?? undefined,
            p_parent_entity_id: input.parentEntityId ?? undefined,
            p_priority: input.priority,
            p_requested_by: input.requestedBy ?? undefined,
            p_provider: input.provider ?? undefined,
            p_max_attempts: input.maxAttempts,
          })
          .single(),
        'jobs.enqueue',
      ) as Row<'processing_jobs'>;
    },
    async claim(workerId, jobTypes, leaseSeconds) {
      const rows = unwrap(
        await db.rpc('claim_processing_job', {
          p_worker_id: workerId,
          p_job_types: jobTypes ?? undefined,
          p_lease_seconds: leaseSeconds,
        }),
        'jobs.claim',
      ) as Row<'processing_jobs'>[];
      return rows[0] ?? null;
    },
    async heartbeat(jobId, workerId, progressPct, leaseSeconds) {
      return unwrap(
        await db.rpc('heartbeat_processing_job', {
          p_job_id: jobId,
          p_worker_id: workerId,
          p_progress_pct: progressPct,
          p_lease_seconds: leaseSeconds,
        }),
        'jobs.heartbeat',
      );
    },
    async complete(jobId, workerId, output, outputAssetIds, costActualUsd) {
      return unwrap(
        await db
          .rpc('complete_processing_job', {
            p_job_id: jobId,
            p_worker_id: workerId,
            p_output: (output ?? undefined) as never,
            p_output_asset_ids: outputAssetIds ?? [],
            p_cost_actual_usd: costActualUsd ?? undefined,
          })
          .single(),
        'jobs.complete',
      ) as Row<'processing_jobs'>;
    },
    async fail(jobId, workerId, failureCode, failureMessage, opts) {
      return unwrap(
        await db
          .rpc('fail_processing_job', {
            p_job_id: jobId,
            p_worker_id: workerId,
            p_failure_code: failureCode,
            p_failure_message: failureMessage ?? undefined,
            p_retry: opts?.retry ?? true,
            p_backoff_seconds: opts?.backoffSeconds,
          })
          .single(),
        'jobs.fail',
      ) as Row<'processing_jobs'>;
    },
    async requeueExpired(limit) {
      return unwrap(
        await db.rpc('requeue_expired_jobs', { p_limit: limit }),
        'jobs.requeueExpired',
      );
    },
    async getById(id) {
      return unwrapMaybe(
        await db.from('processing_jobs').select('*').eq('id', id).single(),
        'jobs.getById',
      );
    },
    async listForAsset(assetId) {
      return unwrap(
        await db
          .from('processing_jobs')
          .select('*')
          .eq('parent_asset_id', assetId)
          .order('created_at', { ascending: false }),
        'jobs.listForAsset',
      );
    },
    async listByState(state, limit = 100) {
      return unwrap(
        await db
          .from('processing_jobs')
          .select('*')
          .eq('state', state)
          .order('created_at')
          .limit(limit),
        'jobs.listByState',
      );
    },
    async recordProvenance(row) {
      return unwrap(
        await db.from('asset_provenance_events').insert(row).select('*').single(),
        'jobs.recordProvenance',
      );
    },
  };
}
