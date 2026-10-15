/**
 * Zod validation helpers for bodies, queries and path params. Failures become `validation_failed`
 * with a compact issue list (never the raw payload).
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import { problem, zodIssues } from './envelope';
import type { AppEnv } from '../types';

export async function parseBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  const text = await c.req.text();
  if (text.trim() === '') raw = {};
  else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw problem.validation('Request body is not valid JSON');
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw problem.validation('Request body failed validation', zodIssues(result.error));
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  const url = new URL(c.req.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  const result = schema.safeParse(raw);
  if (!result.success) throw problem.validation('Query parameters failed validation', zodIssues(result.error));
  return result.data;
}

export function parseParams<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) throw problem.validation('Path parameters failed validation', zodIssues(result.error));
  return result.data;
}
