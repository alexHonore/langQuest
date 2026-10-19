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

/**
 * Configuration errors (missing/invalid secrets) are reported as an honest 503 envelope instead of an opaque
 * Cloudflare 1101 exception, so operators can see what is wrong without tailing logs. No learner data is served
 * until the Worker is configured (fail closed).
 */
function configurationErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'config.invalid', message }));
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'API is not configured yet (missing or invalid Worker secrets). See infra/cloudflare/README.md.',
        details: { reason: message.slice(0, 500) },
      },
    }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    let context: AppContext;
    try {
      context = getApp(env);
    } catch (error) {
      return configurationErrorResponse(error);
    }
    return context.app.fetch(request, env, ctx as never);
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
