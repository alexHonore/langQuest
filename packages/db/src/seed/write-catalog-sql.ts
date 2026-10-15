/** CLI: writes the generated catalog seed migration. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCatalogSeedSql } from './catalog-sql';

const target = process.argv[2] ?? resolve(import.meta.dirname, '../../../../supabase/migrations/20261014100800_080_seed_catalog.sql');
writeFileSync(target, buildCatalogSeedSql(), 'utf8');
console.log(`wrote ${target}`);
