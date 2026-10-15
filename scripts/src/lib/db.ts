/**
 * Database access for the scripts: resolves a service-role client from the environment or
 * the local Supabase stack, checks reachability, and upserts the curriculum registries
 * (`communicative_intents`, `skills`) that imported expressions reference by id.
 *
 * Resolution order for `--apply`: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the
 * environment (set `LANGQUEST_DB_TARGET=hosted` to allow a non-local URL), then the local
 * stack via `supabase status`. Nothing here ever writes without an explicit `--apply`.
 */
import { INTENTS, SKILLS } from '@langquest/curriculum';
import { createServiceClient, detectLocalStack, type DbClient } from '@langquest/db';
import type { Insert } from '@langquest/db';

export interface ResolvedDb {
  client: DbClient;
  url: string;
  source: 'env' | 'local_stack';
  /** Postgres connection string when known (local stack only). */
  dbUrl: string | null;
}

const isLocalUrl = (url: string): boolean => /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(:|\/|$)/.test(url);

/** Resolve a service client; returns `null` (never throws) when no database is configured/reachable. */
export function resolveServiceDb(env: Record<string, string | undefined> = process.env): ResolvedDb | null {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && (isLocalUrl(url) || env.LANGQUEST_DB_TARGET === 'hosted')) {
    return { client: createServiceClient({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key }), url, source: 'env', dbUrl: env.DATABASE_URL ?? null };
  }
  const local = detectLocalStack({ env });
  if (local) return { client: createServiceClient({ SUPABASE_URL: local.url, SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey }), url: local.url, source: 'local_stack', dbUrl: local.dbUrl };
  return null;
}

/** Cheap reachability probe (one catalog read). */
export async function probeDb(db: DbClient): Promise<{ ok: true; trackCount: number } | { ok: false; reason: string }> {
  try {
    const { count, error } = await db.from('course_tracks').select('id', { count: 'exact', head: true });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, trackCount: count ?? 0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Upsert every curriculum intent (idempotent on `intent_key`). Returns the key → id map. */
export async function ensureIntents(db: DbClient): Promise<Map<string, string>> {
  const rows: Insert<'communicative_intents'>[] = INTENTS.map((i) => ({
    intent_key: i.intentKey,
    description: i.description,
    social_meaning: i.socialMeaning,
    polarity: i.polarity,
    politeness: i.politeness,
    skill_keys: [...i.skillKeys],
    response_constraints: { ...i.responseConstraints, conceptId: i.conceptId, socialRisk: i.socialRisk, acceptableVariants: i.acceptableVariants, broaderIntentKeys: i.broaderIntentKeys },
  }));
  const { error } = await db.from('communicative_intents').upsert(rows, { onConflict: 'intent_key' });
  if (error) throw new Error(`communicative_intents upsert failed: ${error.message}`);
  return loadIntentIds(db);
}

/** Load intent key → id without writing. */
export async function loadIntentIds(db: DbClient): Promise<Map<string, string>> {
  const { data, error } = await db.from('communicative_intents').select('id, intent_key');
  if (error) throw new Error(`communicative_intents read failed: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.intent_key, r.id]));
}

/** Upsert every curriculum skill (idempotent on `skill_key`). */
export async function ensureSkills(db: DbClient): Promise<number> {
  const rows: Insert<'skills'>[] = SKILLS.map((s) => ({
    skill_key: s.skillKey,
    descriptor: s.descriptor,
    difficulty: s.difficulty,
    target_language_id: null,
    cefr_can_do: s.cefrCanDo,
    can_do_statement: s.canDoStatement,
    prerequisite_skill_keys: [...s.prerequisites],
  }));
  const { error } = await db.from('skills').upsert(rows, { onConflict: 'skill_key' });
  if (error) throw new Error(`skills upsert failed: ${error.message}`);
  return rows.length;
}

/** Count rows of a table with optional equality filters (service role). */
export async function countRows(db: DbClient, table: 'expressions' | 'expression_translations' | 'expression_audio' | 'missions' | 'content_rights' | 'media_assets' | 'course_source_localizations' | 'course_tracks' | 'languages' | 'language_varieties' | 'communicative_intents' | 'skills' | 'audio_lessons', filters: Record<string, string | boolean> = {}): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table} failed: ${error.message}`);
  return count ?? 0;
}
