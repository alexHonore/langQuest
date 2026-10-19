/**
 * Typed Worker environment (bindings + secrets) for the LangQuest API.
 *
 * Secrets (`wrangler secret put`): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_JWT_SECRET (optional, legacy HS256), OPENROUTER_API_KEY, AI_SESSION_TICKET_SECRET (required as soon as
 * OPENROUTER_API_KEY is set), LEARNER_PSEUDONYM_SALT / MEDIA_STREAM_SECRET (optional, default to the ticket secret),
 * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID (optional, S3 presigning), AZURE_SPEECH_KEY/REGION (optional).
 * Vars (`wrangler.toml [vars]`): CORS_ALLOWED_ORIGINS, R2_BUCKET, R2_PUBLIC_BUCKET, JOBS_BACKEND, LOG_LEVEL, API_ENV
 * (required: there is no implicit "development" profile, so a plain deploy can never run with dev-only CORS/HSTS rules).
 * Bindings (optional): MEDIA (R2), RATE_LIMIT (KV), IDEMPOTENCY (KV), JOBS_QUEUE (Queue).
 *
 * Nothing here is ever shipped to a mobile/admin bundle; the Worker is the only holder of these values. Public values
 * (the Supabase anon key) are never used as HMAC key material or pseudonymisation salts: `parseEnv` fails closed instead.
 */
import { z } from 'zod';

// --- minimal structural types for Cloudflare bindings ---------------------------------
// Kept local (instead of @cloudflare/workers-types) so the package typechecks with `types: ["node"]`
// and the same code runs under Vitest/Node where no binding exists.

export interface R2ObjectLike {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  body?: ReadableStream<Uint8Array>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  range?: { offset: number; length?: number } | { suffix: number };
}
export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string, options?: { range?: { offset: number; length?: number } | { suffix: number } }): Promise<(R2ObjectLike & { body: ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<R2ObjectLike>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}
export interface KVNamespaceLike {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface QueueLike {
  send(message: unknown): Promise<void>;
}
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/** Raw bindings object as handed to `fetch(request, env, ctx)`. */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Legacy HS256 secret; when absent, JWKS (ES256/RS256) is used, then a Supabase `auth/v1/user` check. */
  SUPABASE_JWT_SECRET?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  /** HMAC secret for conversation session tickets; mandatory whenever AI features are enabled. */
  AI_SESSION_TICKET_SECRET?: string;
  /** Salt for learner pseudonyms in `ai_requests` / quality incidents (defaults to a derivation of the ticket secret). */
  LEARNER_PSEUDONYM_SALT?: string;
  AI_REALTIME_CONNECT_URL?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  /** R2 S3-compatible credentials for presigned URLs and multipart uploads (optional until R2 is enabled). */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_BUCKET?: string;
  R2_PUBLIC_BASE_URL?: string;
  /** Comma-separated origin allowlist; `*` is never honoured for credentialed requests. */
  CORS_ALLOWED_ORIGINS?: string;
  JOBS_BACKEND?: 'postgres' | 'cloudflare_queues' | string;
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error' | string;
  API_ENV?: 'development' | 'staging' | 'production' | string;
  /** HMAC secret for worker-proxied media stream tokens (falls back to AI_SESSION_TICKET_SECRET, never to a Supabase key). */
  MEDIA_STREAM_SECRET?: string;
  MEDIA?: R2BucketLike;
  RATE_LIMIT?: KVNamespaceLike;
  IDEMPOTENCY?: KVNamespaceLike;
  JOBS_QUEUE?: QueueLike;
}

const nonEmpty = z.string().trim().min(1);
/** Minimum length for HMAC secrets/salts (mirrors `AiEnvSchema`; 32+ random characters are recommended). */
export const MIN_SECRET_LENGTH = 16;

export const ApiEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  SUPABASE_JWT_SECRET: nonEmpty.optional(),
  OPENROUTER_API_KEY: nonEmpty.optional(),
  OPENROUTER_BASE_URL: z.string().url().optional(),
  AI_SESSION_TICKET_SECRET: z.string().min(MIN_SECRET_LENGTH).optional(),
  LEARNER_PSEUDONYM_SALT: z.string().min(MIN_SECRET_LENGTH).optional(),
  AI_REALTIME_CONNECT_URL: nonEmpty.optional(),
  AZURE_SPEECH_KEY: nonEmpty.optional(),
  AZURE_SPEECH_REGION: nonEmpty.optional(),
  R2_ACCOUNT_ID: nonEmpty.optional(),
  R2_ACCESS_KEY_ID: nonEmpty.optional(),
  R2_SECRET_ACCESS_KEY: nonEmpty.optional(),
  R2_BUCKET: nonEmpty.default('langquest-media'),
  R2_PUBLIC_BUCKET: nonEmpty.default('langquest-public'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  JOBS_BACKEND: z.enum(['postgres', 'cloudflare_queues']).default('postgres'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** No default on purpose: an unset profile must never silently behave like development (localhost CORS, no HSTS). */
  API_ENV: z.enum(['development', 'staging', 'production']),
  MEDIA_STREAM_SECRET: z.string().min(MIN_SECRET_LENGTH).optional(),
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Parsed configuration + bindings, validated once per isolate. */
export interface AppConfig {
  env: ApiEnv;
  bindings: Pick<Env, 'MEDIA' | 'RATE_LIMIT' | 'IDEMPOTENCY' | 'JOBS_QUEUE'>;
  corsOrigins: string[];
}

/** Thrown by `parseEnv` for cross-field misconfiguration (fail closed at isolate start, never per request). */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

/**
 * Validate the raw env. Empty strings are treated as unset so `wrangler.toml` placeholders never
 * masquerade as configured secrets. Cross-field rules (fail closed):
 * - `OPENROUTER_API_KEY` set ⇒ `AI_SESSION_TICKET_SECRET` set (tickets are never derived from a public key);
 * - `API_ENV` ≠ development ⇒ `CORS_ALLOWED_ORIGINS` non-empty (a deployed Worker always has an explicit allowlist);
 * - a secret may not equal a Supabase key (copy-paste mistakes would turn a public value into key material).
 */
export function parseEnv(raw: Env): AppConfig {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      if (v.trim() !== '') cleaned[k] = v;
    }
  }
  const env = ApiEnvSchema.parse(cleaned);
  const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (env.OPENROUTER_API_KEY && !env.AI_SESSION_TICKET_SECRET) {
    throw new EnvConfigError('AI_SESSION_TICKET_SECRET is required when OPENROUTER_API_KEY is set: session tickets are never derived from the Supabase anon key');
  }
  if (env.API_ENV !== 'development' && corsOrigins.length === 0) {
    throw new EnvConfigError(`CORS_ALLOWED_ORIGINS must list the admin/web origins when API_ENV=${env.API_ENV}`);
  }
  const publicOrKeyValues = new Set([env.SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_JWT_SECRET].filter((v): v is string => Boolean(v)));
  for (const [name, value] of [['AI_SESSION_TICKET_SECRET', env.AI_SESSION_TICKET_SECRET], ['LEARNER_PSEUDONYM_SALT', env.LEARNER_PSEUDONYM_SALT], ['MEDIA_STREAM_SECRET', env.MEDIA_STREAM_SECRET]] as const) {
    if (value && publicOrKeyValues.has(value)) throw new EnvConfigError(`${name} must be a dedicated random secret, not a Supabase key`);
  }
  return {
    env,
    bindings: { MEDIA: raw.MEDIA, RATE_LIMIT: raw.RATE_LIMIT, IDEMPOTENCY: raw.IDEMPOTENCY, JOBS_QUEUE: raw.JOBS_QUEUE },
    corsOrigins,
  };
}

/** True when R2 S3 credentials are present (presigned URLs, multipart uploads). */
export const hasR2S3 = (env: ApiEnv): boolean => Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
