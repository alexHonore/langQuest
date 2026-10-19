/**
 * Per-request service context (ADR-003): the learner's RLS-bound client, the service client for
 * server-validated writes, repositories for both, the media store, the edge cache, the domain-event
 * dispatcher and lazily-built AI services. Constructed once per request by `app.ts`.
 */
import type { AiServices } from '@langquest/ai';
import type { Role } from '@langquest/contracts';
import { createServiceClient, createUserClient, type DbClient } from '@langquest/db/client';
import { createRepositories, type Repositories } from '@langquest/db/repositories/index';
import type { Insert } from '@langquest/db/types';
import { sha256Hex } from '@langquest/telemetry/privacy';
import type { AppConfig, ExecutionContextLike } from '../env';
import { problem } from '../http/envelope';
import type { Logger } from '../middleware/logging';
import { buildAiServices } from './ai';
import type { EdgeCache } from './cache';
import { createEventDispatcher, type EventDispatcher } from './events';
import type { MediaStore } from './r2';
import type { Principal } from '../types';

export interface SharedServices {
  config: AppConfig;
  media: MediaStore;
  cache: EdgeCache;
  /** Service-role client, one per isolate (stateless HTTP client). */
  service: DbClient;
  serviceRepos: Repositories;
  fetch: typeof fetch;
  /** Test hook: replace the AI factory (never used in production). */
  aiFactory?: (deps: Parameters<typeof buildAiServices>[0]) => Promise<AiServices>;
}

export interface RequestServices {
  readonly config: AppConfig;
  readonly log: Logger;
  readonly requestId: string;
  readonly principal: Principal | null;
  /** RLS-bound client for the authenticated learner (null for public requests). */
  readonly user: DbClient | null;
  readonly service: DbClient;
  readonly repos: Repositories;
  readonly userRepos: Repositories | null;
  readonly media: MediaStore;
  readonly cache: EdgeCache;
  readonly events: EventDispatcher;
  /** Aborted on request timeout or client disconnect (undefined outside the middleware chain). */
  readonly signal: AbortSignal | undefined;
  /** Build (memoised) AI services bound to this request's principal. */
  ai(sessionId?: string | null): Promise<AiServices>;
  waitUntil(p: Promise<unknown>): void;
  /** Append an audit log row for an admin mutation (service role, never blocks the response). */
  audit(entry: { action: string; entityTable?: string | null; entityId?: string | null; before?: unknown; after?: unknown; /** Record without an actor FK (account deletion: the actor row is about to disappear). */ anonymousActor?: boolean }): void;
  /** The learner client — throws `unauthorized` when the request is anonymous. */
  requireUser(): { db: DbClient; repos: Repositories; principal: Principal };
}

export function createSharedServices(input: { config: AppConfig; media: MediaStore; cache: EdgeCache; fetch?: typeof fetch; aiFactory?: SharedServices['aiFactory'] }): SharedServices {
  const service = createServiceClient({ SUPABASE_URL: input.config.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: input.config.env.SUPABASE_SERVICE_ROLE_KEY });
  return { config: input.config, media: input.media, cache: input.cache, service, serviceRepos: createRepositories(service), fetch: input.fetch ?? fetch, aiFactory: input.aiFactory };
}

export function createRequestServices(shared: SharedServices, request: { log: Logger; requestId: string; principal: Principal | null; executionCtx: ExecutionContextLike; clientKey: string; /** Request timeout / client-disconnect signal, threaded into provider calls. */ signal?: AbortSignal }): RequestServices {
  const user = request.principal ? createUserClient({ SUPABASE_URL: shared.config.env.SUPABASE_URL, SUPABASE_ANON_KEY: shared.config.env.SUPABASE_ANON_KEY }, request.principal.accessToken) : null;
  const userRepos = user ? createRepositories(user) : null;
  const waitUntil = (p: Promise<unknown>) => request.executionCtx.waitUntil(p.catch((error) => request.log.error('background.failed', { error })));
  const events = createEventDispatcher({ jobs: shared.serviceRepos.processingJobs, queue: shared.config.bindings.JOBS_QUEUE ?? null, backend: shared.config.env.JOBS_BACKEND, log: request.log, waitUntil });
  // Cache invalidation on publish/unpublish (idempotent: deleting a missing key is a no-op).
  events.on('manifest.invalidated', async (event) => {
    const p = event.payload;
    if (p.kind === 'course' && p.courseTrackId) await shared.cache.invalidateCourse(p.courseTrackId, p.sourceLanguageCode);
    if (p.kind === 'audio_collection' && p.collectionId) await shared.cache.invalidateAudioCollection(p.collectionId, p.sourceLanguageCode);
  });
  let aiPromise: Promise<AiServices> | null = null;
  const services: RequestServices = {
    config: shared.config,
    log: request.log,
    requestId: request.requestId,
    principal: request.principal,
    user,
    service: shared.service,
    repos: shared.serviceRepos,
    userRepos,
    media: shared.media,
    cache: shared.cache,
    events,
    signal: request.signal,
    ai(sessionId) {
      aiPromise ??= (shared.aiFactory ?? buildAiServices)({
        env: shared.config.env,
        service: shared.service,
        media: shared.media,
        log: request.log,
        waitUntil,
        userId: request.principal?.userId ?? null,
        sessionId: sessionId ?? null,
        fetch: shared.fetch,
        signal: request.signal,
      });
      return aiPromise;
    },
    waitUntil,
    audit(entry) {
      const row: Insert<'audit_logs'> = {
        actor_id: entry.anonymousActor ? null : (request.principal?.userId ?? null),
        actor_role: request.principal?.roles[0] ?? null,
        action: entry.action,
        entity_table: entry.entityTable ?? null,
        entity_id: entry.entityId ?? null,
        before: (entry.before ?? null) as Insert<'audit_logs'>['before'],
        after: (entry.after ?? null) as Insert<'audit_logs'>['after'],
        ip_hash: sha256Hex(request.clientKey).slice(0, 32),
        request_id: request.requestId,
      };
      waitUntil(
        Promise.resolve(
          shared.service
            .from('audit_logs')
            .insert(row)
            .then((res) => {
              if (res.error) request.log.error('audit.failed', { error: res.error.message, action: entry.action });
            }),
        ),
      );
    },
    requireUser() {
      if (!user || !userRepos || !request.principal) throw problem.unauthorized();
      return { db: user, repos: userRepos, principal: request.principal };
    },
  };
  return services;
}

/** Narrow helper used by admin routes. */
export const principalRoles = (s: RequestServices): Role[] => s.principal?.roles ?? [];
