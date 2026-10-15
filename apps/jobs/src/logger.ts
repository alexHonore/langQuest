/**
 * Minimal structured logger (JSON lines on stderr). Values are redacted with the shared telemetry
 * redaction so a job log never carries e-mails, bearer tokens or long free text.
 */
import { redactDeep } from '@langquest/telemetry';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  level: LogLevel;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Line writer (defaults to stderr). */
  write?: (line: string) => void;
  base?: Record<string, unknown>;
  now?: () => string;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = { name: err.name, message: err.message };
    const anyErr = err as Error & { code?: unknown; kind?: unknown; status?: unknown };
    if (anyErr.code !== undefined) out.code = anyErr.code;
    if (anyErr.kind !== undefined) out.kind = anyErr.kind;
    if (anyErr.status !== undefined) out.status = anyErr.status;
    if (err.stack) out.stack = err.stack.split('\n').slice(0, 6).join('\n');
    return out;
  }
  return { message: String(err) };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date().toISOString());
  const base = options.base ?? {};

  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const payload: Record<string, unknown> = { ...base, ...(fields ?? {}) };
    if (payload.error !== undefined) payload.error = serializeError(payload.error);
    const redacted = redactDeep(payload) as Record<string, unknown>;
    write(JSON.stringify({ ts: now(), level: lvl, msg, ...redacted }));
  };

  const logger: Logger = {
    level,
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger({ ...options, level, base: { ...base, ...fields } }),
  };
  return logger;
}

/** Logger that drops everything (tests). */
export const silentLogger: Logger = createLogger({ level: 'error', write: () => {} });
