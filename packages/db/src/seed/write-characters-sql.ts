/** CLI: writes the generated character cast seed migration. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCharacterSeedSql } from './characters-sql';

const target = process.argv[2] ?? resolve(import.meta.dirname, '../../../../supabase/migrations/20261019150000_130_seed_characters.sql');
writeFileSync(target, buildCharacterSeedSql(), 'utf8');
console.log(`wrote ${target}`);
