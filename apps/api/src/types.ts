/**
 * Hono environment typing shared by every middleware and route: raw bindings plus the per-request
 * variables set by the middleware chain (request id, logger, parsed config, auth principal, services).
 */
import type { Role } from '@langquest/contracts';
import type { AppConfig, Env, ExecutionContextLike } from './env';
import type { Logger } from './middleware/logging';
import type { RequestServices } from './services/context';

/** Verified JWT principal (never trusted from the client beyond the signature). */
export interface Principal {
  userId: string;
  email: string | null;
  /** Raw access token, forwarded to supabase-js so RLS applies. */
  accessToken: string;
  /** JWT `role` claim (`authenticated`, `anon`, `service_role`). */
  tokenRole: string;
  /** Staff roles resolved server-side from `user_roles` (empty for learners). */
  roles: Role[];
  expiresAt: number;
}

export interface AppVariables {
  requestId: string;
  startedAt: number;
  config: AppConfig;
  log: Logger;
  executionCtx: ExecutionContextLike;
  principal?: Principal;
  services?: RequestServices;
  /** Hash of the client IP used for rate limiting / audit (never the raw address). */
  clientKey: string;
  /** Idempotency-Key header when provided (already validated). */
  idempotencyKey?: string;
  /** Aborted when the request times out or the client disconnects; threaded into every provider call. */
  abortSignal?: AbortSignal;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
