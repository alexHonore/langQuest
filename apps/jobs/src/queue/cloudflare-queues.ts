/**
 * `JOBS_BACKEND=cloudflare_queues` — optional adapter (ADR-005). **Requires the Workers Paid plan**; the
 * account currently runs on the free plan, so the default backend stays Postgres polling.
 *
 * Design: `processing_jobs` remains the system of record. The API enqueues the row with
 * `enqueue_processing_job` and then publishes `{ jobId, jobType }` to the queue as a wake-up signal. The
 * consumer below claims work with the same `claim_processing_job` RPC and runs the same handler registry
 * as the Node runner, so semantics (leases, backoff, `review_needed`) are identical.
 *
 * Runtime caveat: handlers marked `runtime: 'node'` (ffmpeg, large downloads) can never run inside a
 * Worker isolate. A consumer created with `runtime: 'worker'` acknowledges such messages without claiming
 * them, leaving the rows `pending` for the Node runner (or a container-based consumer created with
 * `runtime: 'node'`). Nothing is dropped: the DB row is still the queue.
 */
import type { ProcessingJobTypeAll } from '@langquest/contracts';
import type { Logger } from '../logger';
import type { JobServices } from '../services';
import { JobExecutor, type JobOutcome } from './runner';
import { resolveHandlerName, type HandlerRegistry } from './types';

export interface QueueMessageBody {
  jobId: string;
  jobType?: ProcessingJobTypeAll | string;
}

/** Minimal structural subset of Cloudflare's `Message` / `MessageBatch` (no `@cloudflare/workers-types` dependency). */
export interface QueueMessageLike<T = QueueMessageBody> {
  id: string;
  body: T;
  attempts?: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}
export interface QueueBatchLike<T = QueueMessageBody> {
  queue: string;
  messages: readonly QueueMessageLike<T>[];
  ackAll?(): void;
  retryAll?(options?: { delaySeconds?: number }): void;
}

export interface QueueConsumerOptions {
  services: JobServices;
  registry: HandlerRegistry;
  workerId: string;
  /** `worker` = Cloudflare isolate (no ffmpeg); `node` = container / Node consumer with full capability. */
  runtime: 'worker' | 'node';
  log?: Logger;
  leaseSeconds?: number;
  /** Delay before re-delivering a message whose job is still pending but was not claimed by us. */
  retryDelaySeconds?: number;
}

export interface QueueConsumer {
  /** Cloudflare `queue()` export shape: `export default { queue: consumer.queue }`. */
  queue(batch: QueueBatchLike, env?: unknown, ctx?: { waitUntil?(p: Promise<unknown>): void }): Promise<void>;
  /** Process one message (exported for tests and for custom batching). */
  handleMessage(message: QueueMessageLike): Promise<{ action: 'ack' | 'retry'; outcome: JobOutcome | null; reason: string }>;
}

export function createQueueConsumer(options: QueueConsumerOptions): QueueConsumer {
  const log = options.log ?? options.services.log.child({ backend: 'cloudflare_queues' });
  const executor = new JobExecutor({ services: options.services, registry: options.registry, workerId: options.workerId, leaseSeconds: options.leaseSeconds, log });
  const jobs = options.services.repos.processingJobs;
  const retryDelay = options.retryDelaySeconds ?? 30;

  async function handleMessage(message: QueueMessageLike): Promise<{ action: 'ack' | 'retry'; outcome: JobOutcome | null; reason: string }> {
    const body = message.body;
    if (!body || typeof body.jobId !== 'string') return { action: 'ack', outcome: null, reason: 'malformed_message' };
    const row = await jobs.getById(body.jobId);
    if (!row) return { action: 'ack', outcome: null, reason: 'job_missing' };
    if (row.state !== 'pending') return { action: 'ack', outcome: null, reason: `state_${row.state}` };
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { action: 'retry', outcome: null, reason: 'backoff_pending' };

    const handlerName = resolveHandlerName(row);
    const handler = handlerName ? options.registry.get(handlerName) : null;
    if (!handler) return { action: 'ack', outcome: null, reason: 'no_handler' };
    if (handler.runtime === 'node' && options.runtime === 'worker') {
      log.info('queue.deferred_to_node_runner', { jobId: row.id, handler: handler.name });
      return { action: 'ack', outcome: null, reason: 'node_only_handler' };
    }

    const claimed = await jobs.claim(options.workerId, [row.job_type], options.leaseSeconds);
    if (!claimed) return { action: 'ack', outcome: null, reason: 'claimed_elsewhere' };
    const outcome = await executor.execute(claimed);
    if (claimed.id !== row.id) {
      // We did useful work on a sibling job; the message's own job is still pending — redeliver it.
      const fresh = await jobs.getById(row.id);
      return { action: fresh && fresh.state === 'pending' ? 'retry' : 'ack', outcome, reason: 'claimed_sibling' };
    }
    return { action: 'ack', outcome, reason: outcome.status };
  }

  async function queue(batch: QueueBatchLike): Promise<void> {
    for (const message of batch.messages) {
      try {
        const res = await handleMessage(message);
        if (res.action === 'ack') message.ack();
        else message.retry({ delaySeconds: retryDelay });
        log.info('queue.message', { messageId: message.id, jobId: message.body?.jobId, action: res.action, reason: res.reason });
      } catch (error) {
        log.error('queue.message_failed', { messageId: message.id, error });
        message.retry({ delaySeconds: retryDelay });
      }
    }
  }

  return { queue, handleMessage };
}

// ---------------------------------------------------------------------------------------------
// HTTP pull consumer (Node) — lets `JOBS_BACKEND=cloudflare_queues` run from this process using the
// Queues REST API (`/accounts/{account}/queues/{queue}/messages/pull` + `/messages/ack`). Workers Paid only.
// ---------------------------------------------------------------------------------------------

export interface QueuePullOptions extends Omit<QueueConsumerOptions, 'runtime'> {
  runtime?: 'node';
  accountId?: string;
  queueId?: string;
  apiToken?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  batchSize?: number;
  visibilityTimeoutMs?: number;
  /** Sleep between empty pulls. */
  idleMs?: number;
  apiBase?: string;
}

interface PulledMessage {
  id: string;
  lease_id: string;
  body: unknown;
  attempts?: number;
}

export async function startQueuePullLoop(options: QueuePullOptions): Promise<{ pulled: number; acked: number; retried: number }> {
  const env = options.services.env as unknown as Record<string, string | undefined>;
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? env.CLOUDFLARE_ACCOUNT_ID;
  const queueId = options.queueId ?? process.env.CLOUDFLARE_QUEUE_ID ?? env.CLOUDFLARE_QUEUE_ID;
  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !queueId || !apiToken) throw new Error('Cloudflare Queues pull consumer needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_QUEUE_ID and CLOUDFLARE_API_TOKEN (Workers Paid plan)');
  const log = options.log ?? options.services.log.child({ backend: 'cloudflare_queues' });
  const consumer = createQueueConsumer({ ...options, runtime: 'node', log });
  const fetchImpl = options.fetch ?? fetch;
  const base = `${options.apiBase ?? 'https://api.cloudflare.com/client/v4'}/accounts/${accountId}/queues/${queueId}/messages`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  const stats = { pulled: 0, acked: 0, retried: 0 };
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    options.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

  while (!options.signal?.aborted) {
    let messages: PulledMessage[] = [];
    try {
      const res = await fetchImpl(`${base}/pull`, { method: 'POST', headers, body: JSON.stringify({ batch_size: options.batchSize ?? 5, visibility_timeout_ms: options.visibilityTimeoutMs ?? 10 * 60_000 }) });
      if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
      const json = (await res.json()) as { result?: { messages?: PulledMessage[] } };
      messages = json.result?.messages ?? [];
    } catch (error) {
      log.error('queue.pull_failed', { error });
      await sleep(options.idleMs ?? 5000);
      continue;
    }
    if (!messages.length) {
      await sleep(options.idleMs ?? 5000);
      continue;
    }
    const acks: Array<{ lease_id: string }> = [];
    const retries: Array<{ lease_id: string; delay_seconds: number }> = [];
    for (const m of messages) {
      stats.pulled += 1;
      const body = (typeof m.body === 'string' ? safeJson(m.body) : m.body) as QueueMessageBody;
      const decision: { action: 'ack' | 'retry' } = { action: 'retry' };
      try {
        const res = await consumer.handleMessage({ id: m.id, body, attempts: m.attempts, ack: () => void (decision.action = 'ack'), retry: () => void (decision.action = 'retry') });
        decision.action = res.action;
      } catch (error) {
        log.error('queue.message_failed', { messageId: m.id, error });
      }
      if (decision.action === 'ack') acks.push({ lease_id: m.lease_id });
      else retries.push({ lease_id: m.lease_id, delay_seconds: options.retryDelaySeconds ?? 30 });
    }
    try {
      const res = await fetchImpl(`${base}/ack`, { method: 'POST', headers, body: JSON.stringify({ acks, retries }) });
      if (!res.ok) throw new Error(`ack failed: HTTP ${res.status}`);
      stats.acked += acks.length;
      stats.retried += retries.length;
    } catch (error) {
      log.error('queue.ack_failed', { error });
    }
  }
  return stats;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Minimal producer-side binding shape (`Queue<T>` in workers-types). */
export interface QueueProducerLike<T = QueueMessageBody> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>;
}

/** Publish a wake-up message for a job row that was already inserted with `enqueue_processing_job`. */
export async function publishJobMessage(queue: QueueProducerLike, job: { id: string; job_type: string }, options: { delaySeconds?: number } = {}): Promise<void> {
  await queue.send({ jobId: job.id, jobType: job.job_type }, options);
}
