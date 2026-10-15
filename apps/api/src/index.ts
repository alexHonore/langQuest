/**
 * Cloudflare Worker entry (spec §4.3). The Hono app is built once per isolate from the bindings handed to the
 * first `fetch`; `env` carries secrets (never bundled into clients) and optional bindings (R2 `MEDIA`, KV
 * `RATE_LIMIT` / `IDEMPOTENCY`, queue `JOBS_QUEUE`). A queue consumer is exported for `JOBS_BACKEND=cloudflare_queues`.
 */
import { createApp, type AppContext } from './app';
import type { Env, ExecutionContextLike } from './env';

let appContext: AppContext | null = null;

function getApp(env: Env): AppContext {
  appContext ??= createApp({ env });
  return appContext;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const { app } = getApp(env);
    return app.fetch(request, env, ctx as never);
  },
  /** Cloudflare Queues consumer (optional backend): acknowledges job notifications; the Node runner executes them. */
  async queue(batch: { messages: { body: unknown; ack(): void }[] }, env: Env): Promise<void> {
    const { shared } = getApp(env);
    for (const message of batch.messages) {
      const body = message.body as { jobId?: string } | null;
      if (body?.jobId) {
        const job = await shared.serviceRepos.processingJobs.getById(body.jobId).catch(() => null);
        console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'queue.job_notified', jobId: body.jobId, state: job?.state ?? 'unknown' }));
      }
      message.ack();
    }
  },
};

export { createApp } from './app';
export type { Env } from './env';
