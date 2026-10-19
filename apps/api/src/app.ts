/**
 * Hono application factory for the LangQuest API (spec §6, CONVENTIONS §3).
 *
 * Every route is registered from the `ROUTES` constants in `@langquest/contracts` through `defineRoute`,
 * which applies the right auth class (public / learner / admin role set), abuse-control bucket, body limit,
 * idempotency and timeout. Responses always use the ok/err envelope; errors map through `toProblem`.
 */
import { ROUTES, type Role, type RouteDef, type RouteKey } from '@langquest/contracts';
import { Hono, type Context, type Handler, type MiddlewareHandler } from 'hono';
import { parseEnv, type Env, type ExecutionContextLike } from './env';
import { respondErr, toProblem } from './http/envelope';
import { authenticate, createTokenVerifier, requireRoles, type RoleSet, type TokenVerifier } from './middleware/auth';
import { idempotency, KvIdempotencyStore, MemoryIdempotencyStore, type IdempotencyStore } from './middleware/idempotency';
import { createLogger, requestLogging, type LogLevel } from './middleware/logging';
import { KvRateLimitStore, MemoryRateLimitStore, rateLimit, type RateClass, type RateLimitStore } from './middleware/rate-limit';
import { bodyLimit, corsAllowlist, DEFAULT_BODY_LIMIT_BYTES, requestTimeout, securityHeaders } from './middleware/security';
import { registerAdminRoutes } from './routes/admin';
import { registerAudioRoutes } from './routes/audio';
import { registerLearnerRoutes } from './routes/learner';
import { deleteEnrollmentHandler } from './routes/learner/enrollments';
import { registerSpeechRoutes } from './routes/speech';
import { registerMediaProxyRoutes } from './routes/media-proxy';
import { createEdgeCache, type EdgeCache } from './services/cache';
import { createRequestServices, createSharedServices, type SharedServices } from './services/context';
import { createMediaStore, type MediaStore } from './services/r2';
import { sha256Hex } from '@langquest/telemetry/privacy';
import type { AppEnv } from './types';

export interface AppOptions {
  env: Env;
  fetch?: typeof fetch;
  logSink?: (line: string) => void;
  rateLimitStore?: RateLimitStore;
  idempotencyStore?: IdempotencyStore;
  verifier?: TokenVerifier;
  /** Test hook: offline role resolution. */
  roleResolver?: (userId: string) => Promise<Role[]>;
  cache?: EdgeCache;
  media?: MediaStore;
  aiFactory?: SharedServices['aiFactory'];
  /** Node/tests: collect `waitUntil` promises so they can be awaited. */
  background?: Set<Promise<unknown>>;
}

export interface RouteOptions {
  /** Admin routes: which role set is required (defaults to `staff` for `auth: 'admin'`). */
  role?: RoleSet;
  /**
   * Override the contract's auth class for the middleware chain (documented exception). Used by the session
   * refresh route, whose credential is the refresh token itself: the contract lists it as `learner` but a
   * mandatory Bearer check would reject exactly the expired access token the route exists to replace.
   */
  auth?: RouteDef['auth'];
  rate?: RateClass;
  /** `client`: key the per-route bucket by hashed client IP even for authenticated callers (credential endpoints). */
  rateKeyBy?: 'principal' | 'client';
  bodyLimitBytes?: number;
  timeoutMs?: number;
  /** Skip the Idempotency-Key layer (routes with their own domain idempotency and large bodies). */
  idempotent?: boolean;
}

export interface AppContext {
  app: Hono<AppEnv>;
  shared: SharedServices;
  registered: Set<RouteKey>;
  /** Await all background work started during handled requests (tests / Node). */
  flush(): Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 25_000;
export const AI_TIMEOUT_MS = 60_000;

/** Build the app once per isolate/env. */
export function createApp(options: AppOptions): AppContext {
  const config = parseEnv(options.env);
  const media = options.media ?? createMediaStore(config.env, { fetch: options.fetch, binding: config.bindings.MEDIA });
  const cache = options.cache ?? createEdgeCache();
  const shared = createSharedServices({ config, media, cache, fetch: options.fetch, aiFactory: options.aiFactory });
  const verifier = options.verifier ?? createTokenVerifier(config.env, { fetch: options.fetch });
  const rateStore = options.rateLimitStore ?? (config.bindings.RATE_LIMIT ? new KvRateLimitStore(config.bindings.RATE_LIMIT) : new MemoryRateLimitStore());
  const idemStore = options.idempotencyStore ?? (config.bindings.IDEMPOTENCY ? new KvIdempotencyStore(config.bindings.IDEMPOTENCY) : new MemoryIdempotencyStore());
  const background = options.background ?? new Set<Promise<unknown>>();
  const registered = new Set<RouteKey>();
  const rootLog = createLogger(config.env.LOG_LEVEL as LogLevel, { service: 'langquest-api' }, options.logSink);

  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('config', config);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    c.set('clientKey', sha256Hex(`${ip}|${config.env.SUPABASE_ANON_KEY.slice(0, 8)}`).slice(0, 32));
    c.set('executionCtx', resolveExecutionCtx(c, background));
    await next();
  });
  app.use('*', requestLogging({ level: config.env.LOG_LEVEL as LogLevel, sink: options.logSink }));
  app.use('*', securityHeaders());
  app.use('*', corsAllowlist());

  app.notFound((c) => respondErr(c, 'not_found', `No route for ${c.req.method} ${c.req.path}`));
  app.onError((error, c) => {
    const p = toProblem(error);
    const log = c.get('log') ?? rootLog;
    if (p.code === 'internal') log.error('http.unhandled', { error });
    else log.warn('http.problem', { code: p.code, message: p.message });
    return respondErr(c, p.code, p.message, p.details);
  });

  const authDeps = { verifier, serviceClient: () => shared.service, roleResolver: options.roleResolver, failureStore: rateStore };

  /**
   * Middleware order (§11): body limit → pre-auth ingress bucket (per client key, BEFORE any token verification so
   * unauthenticated floods never trigger a Supabase Auth call or a `user_roles` query) → authentication (failed
   * tokens are counted per client key inside `authenticate`) → roles → per-principal class bucket → idempotency →
   * abortable timeout → request services.
   */
  const buildChain = (def: RouteDef, opts: RouteOptions): MiddlewareHandler<AppEnv>[] => {
    const auth = opts.auth ?? def.auth;
    const chain: MiddlewareHandler<AppEnv>[] = [];
    chain.push(bodyLimit(opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));
    chain.push(rateLimit({ store: rateStore, classify: () => 'ingress', keyBy: 'client' }));
    if (auth === 'public') chain.push(authenticate(authDeps, { optional: true, resolveRoles: false }));
    else chain.push(authenticate(authDeps));
    if (auth === 'admin') chain.push(requireRoles(opts.role ?? 'staff'));
    chain.push(rateLimit({ store: rateStore, classify: () => opts.rate ?? (auth === 'public' ? 'public' : auth === 'admin' ? 'admin' : 'learner'), keyBy: opts.rateKeyBy }));
    if (opts.idempotent !== false && def.method !== 'GET') chain.push(idempotency(idemStore));
    chain.push(requestTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    chain.push(async (c, next) => {
      c.set('services', createRequestServices(shared, { log: c.get('log'), requestId: c.get('requestId'), principal: c.get('principal') ?? null, executionCtx: c.get('executionCtx'), clientKey: c.get('clientKey'), signal: c.get('abortSignal') }));
      await next();
    });
    return chain;
  };
  const defineRoute = (key: RouteKey, opts: RouteOptions, handler: Handler<AppEnv>): void => {
    const def = ROUTES[key];
    app.on(def.method, [def.path], ...buildChain(def, opts), handler);
    registered.add(key);
  };

  registerLearnerRoutes(defineRoute);
  registerSpeechRoutes(defineRoute);
  registerAudioRoutes(defineRoute);
  registerAdminRoutes(defineRoute);
  registerMediaProxyRoutes(defineRoute);
  defineRoute('enrollmentDelete', {}, deleteEnrollmentHandler);

  app.get('/', (c) => c.json({ ok: true, data: { service: 'langquest-api', env: config.env.API_ENV, routes: registered.size } }));
  app.get('/healthz', (c) => c.json({ ok: true, data: { status: 'ok', media: media.mode, time: new Date().toISOString() } }));

  return {
    app,
    shared,
    registered,
    async flush() {
      while (background.size > 0) {
        const batch = [...background];
        background.clear();
        await Promise.allSettled(batch);
      }
    },
  };
}

export type DefineRoute = (key: RouteKey, opts: RouteOptions, handler: Handler<AppEnv>) => void;

/** Use the real Worker execution context when present; otherwise collect promises for `flush()`. */
function resolveExecutionCtx(c: Context<AppEnv>, background: Set<Promise<unknown>>): ExecutionContextLike {
  try {
    const ctx = c.executionCtx as unknown as ExecutionContextLike | undefined;
    if (ctx && typeof ctx.waitUntil === 'function') {
      return { waitUntil: (p) => ctx.waitUntil(p), passThroughOnException: () => ctx.passThroughOnException?.() };
    }
  } catch {
    /* no execution context (Node) */
  }
  return {
    waitUntil: (p) => {
      const tracked = p.finally(() => background.delete(tracked));
      background.add(tracked);
    },
  };
}
