/**
 * Seed runner: (re)applies the generated catalog seed SQL to a database.
 * The same SQL ships as migration 080, so this is only needed to refresh an existing database after
 * the contracts catalog changed without writing a new migration (idempotent: INSERT … ON CONFLICT DO UPDATE).
 *
 * Target selection: `DATABASE_URL` env, else the local stack (`supabase status`). Never runs against a
 * hosted project unless DATABASE_URL is set explicitly.
 */
import postgres from 'postgres';
import { buildCatalogSeedSql } from './catalog-sql';
import { detectLocalStack } from '../local-stack';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? detectLocalStack()?.dbUrl ?? null;
  if (!url) {
    console.error('No database reachable: set DATABASE_URL or start the local stack (pnpm --filter @langquest/db local:start).');
    process.exitCode = 1;
    return;
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(buildCatalogSeedSql());
    const [tracks] = await sql`select count(*)::int as n from public.course_tracks`;
    const [coverage] = await sql`select count(*)::int as n from public.course_source_localizations`;
    const [profiles] = await sql`select count(*)::int as n from public.ai_model_profiles`;
    console.log(`catalog seeded: ${tracks?.n} tracks, ${coverage?.n} coverage rows, ${profiles?.n} model profiles`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
