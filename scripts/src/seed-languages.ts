#!/usr/bin/env tsx
/**
 * seed-languages — idempotent catalog seed: languages, writing systems, varieties, the 30
 * course tracks, default model profiles (generated SQL from `@langquest/db`), plus the
 * curriculum registries (intents, skills) and honest per-(track, source) coverage rows.
 *
 * Target: `DATABASE_URL`, else the local stack (`supabase status`). Hosted databases are only
 * touched when DATABASE_URL is set explicitly. `--dry-run` prints statement counts and can
 * write the SQL to a file for review.
 *
 * Usage: pnpm --filter @langquest/scripts seed-languages -- [--with-intents] [--with-coverage] [--sql-out data/derived/seed.sql]
 */
import { resolve } from 'node:path';
import postgres from 'postgres';
import { buildCatalogSeedSql } from '@langquest/db/seed/catalog-sql';
import { detectLocalStack } from '@langquest/db';
import { flagBool, flagList, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { loadRootEnv, repoRoot, writeTextFileSync } from './lib/io';
import { buildCoverageSeedSql, buildIntentsSeedSql, buildSkillsSeedSql, countStatements } from './lib/seed-sql';
import type { SourceLanguageCode } from '@langquest/contracts';

export const spec: CliSpec = {
  name: 'seed-languages',
  summary: 'Idempotent catalog seed (languages, varieties, 30 tracks, model profiles) + intents/skills + coverage rows.',
  flags: [
    { name: 'with-intents', type: 'boolean', description: 'Also upsert communicative_intents and skills from @langquest/curriculum.', default: true },
    { name: 'with-coverage', type: 'boolean', description: 'Also upsert course_source_localizations from @langquest/locales + curriculum coverage.', default: true },
    { name: 'sources', type: 'list', description: 'Source languages for coverage rows (default: all 23).' },
    { name: 'sql-out', type: 'string', description: 'Write the combined SQL to this file (works with --dry-run).' },
    { name: 'database-url', type: 'string', description: 'Postgres URL (overrides DATABASE_URL / local stack).' },
  ],
  examples: ['seed-languages -- --dry-run --sql-out data/derived/seed.sql', 'seed-languages', 'DATABASE_URL=postgres://… seed-languages -- --no-with-coverage'],
};

export interface SeedPlan {
  sections: Array<{ name: string; statements: number; sql: string }>;
  sql: string;
}

/** Build the full seed plan (pure). */
export function buildSeedPlan(options: { withIntents: boolean; withCoverage: boolean; sources?: readonly SourceLanguageCode[] }): SeedPlan {
  const sections: SeedPlan['sections'] = [];
  const catalog = buildCatalogSeedSql();
  sections.push({ name: 'catalog (languages, writing_systems, language_varieties, course_tracks, course_source_localizations placeholders, ai_model_profiles)', statements: countStatements(catalog), sql: catalog });
  if (options.withIntents) {
    const intents = buildIntentsSeedSql();
    const skills = buildSkillsSeedSql();
    sections.push({ name: 'skills', statements: countStatements(skills), sql: skills });
    sections.push({ name: 'communicative_intents', statements: countStatements(intents), sql: intents });
  }
  if (options.withCoverage) {
    const coverage = buildCoverageSeedSql(options.sources);
    sections.push({ name: 'course_source_localizations (honest coverage)', statements: countStatements(coverage), sql: coverage });
  }
  return { sections, sql: sections.map((s) => s.sql).join('\n') };
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const sources = flagList(args, 'sources') as SourceLanguageCode[];
  const plan = buildSeedPlan({ withIntents: flagBool(args, 'with-intents'), withCoverage: flagBool(args, 'with-coverage'), ...(sources.length ? { sources } : {}) });
  for (const s of plan.sections) io.log(`${s.statements.toString().padStart(5)} statements — ${s.name}`);
  const sqlOut = flagString(args, 'sql-out');
  if (sqlOut) {
    const path = resolve(repoRoot(), sqlOut);
    writeTextFileSync(path, plan.sql);
    io.log(`wrote ${path}`);
  }
  if (args.dryRun) {
    io.log('dry-run: nothing applied');
    return 0;
  }
  const url = flagString(args, 'database-url') ?? process.env.DATABASE_URL ?? detectLocalStack()?.dbUrl ?? null;
  if (!url) {
    io.error('No database reachable: set DATABASE_URL or start the local stack (pnpm supabase start).');
    return 1;
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(plan.sql);
    const [tracks] = await sql`select count(*)::int as n from public.course_tracks`;
    const [coverage] = await sql`select count(*)::int as n from public.course_source_localizations`;
    const [intents] = await sql`select count(*)::int as n from public.communicative_intents`;
    const [skills] = await sql`select count(*)::int as n from public.skills`;
    io.log(`seeded ${url.replace(/\/\/[^@]+@/, '//***@')}: ${tracks?.n} tracks, ${coverage?.n} coverage rows, ${intents?.n} intents, ${skills?.n} skills`);
    return tracks?.n === 30 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
