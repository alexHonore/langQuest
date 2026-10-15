/**
 * Request id + structured JSON logging with redaction (§11 "log AI requests with redacted text and no
 * secret tokens"). One JSON line per request on completion; `log.debug/info/warn/error` inside handlers
 * carry the request id. Values pass through `redactDeep` (emails, phones, bearer tokens, long free text).
 */
import { redactDeep } from '@langquest/telemetry/privacy';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const SECRET_KEYS = /(secret|token|password|authorization|api[_-]?key|cookie|jwt|credential)/i;

/** Redact secrets by key name and PII by value, recursively, before anything is written. */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (v instanceof Error) {
      out[k] = { name: v.name, message: redactDeep(v.message), code: (v as { code?: unknown }).code ?? null };
      continue;
    }
    try {
      out[k] = redactDeep(v);
    } catch {
      out[k] = '[unserialisable]';
    }
  }
  return out;
}

export function createLogger(minLevel: LogLevel, base: Record<string, unknown> = {}, sink: (line: string) => void = defaultSink): Logger {
  const write = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const line = { ts: new Date().toISOString(), level, event, ...base, ...(fields ? redactFields(fields) : {}) };
    sink(JSON.stringify(line));
  };
  return {
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
    child: (fields) => createLogger(minLevel, { ...base, ...redactFields(fields) }, sink),
  };
}

function defaultSink(line: string): void {
  console.log(line);
}

/** Generate/propagate a request id; attach a child logger and log one summary line per request. */
export function requestLogging(options: { level: LogLevel; sink?: (line: string) => void }): MiddlewareHandler<AppEnv> {
  const root = createLogger(options.level, { service: 'langquest-api' }, options.sink);
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    const startedAt = Date.now();
    c.set('requestId', requestId);
    c.set('startedAt', startedAt);
    const log = root.child({ requestId, method: c.req.method, path: c.req.path });
    c.set('log', log);
    try {
      await next();
    } finally {
      const status = c.res?.status ?? 0;
      const principal = c.get('principal');
      log.info('http.request', {
        status,
        durationMs: Date.now() - startedAt,
        userId: principal?.userId ?? null,
        roles: principal?.roles ?? [],
        cf: { colo: (c.req.raw as unknown as { cf?: { colo?: string } }).cf?.colo ?? null },
      });
      c.res.headers.set('x-request-id', requestId);
    }
  };
}
