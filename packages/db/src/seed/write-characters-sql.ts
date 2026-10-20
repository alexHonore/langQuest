/** CLI: writes the generated character cast seed migration. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHARACTER_SEED_MIGRATION_FILE, buildCharacterSeedSql } from './characters-sql';

const target = process.argv[2] ?? resolve(import.meta.dirname, `../../../../supabase/migrations/${CHARACTER_SEED_MIGRATION_FILE}`);
writeFileSync(target, buildCharacterSeedSql(), 'utf8');
console.log(`wrote ${target}`);
