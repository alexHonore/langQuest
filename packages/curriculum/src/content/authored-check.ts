#!/usr/bin/env tsx
/**
 * Checks authored chapters before they are registered: `pnpm exec tsx packages/curriculum/src/content/authored-check.ts
 * [track …]` (every file of `content/authored/chapter-2/` without arguments). Prints what is wrong with each, as
 * sentences a writer can act on, with a summary of each mission; exits 1 when any chapter has a problem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthoredChapterSchema, checkAuthoredChapter } from './authored';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'authored', 'chapter-2');
const wanted = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => wanted.length === 0 || wanted.includes(f.replace(/\.json$/, '')))
  .sort();
if (files.length === 0) {
  console.error(`No chapter file for ${wanted.join(', ') || 'any track'} in ${dir}`);
  process.exit(1);
}
let failed = 0;
for (const file of files) {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (e) {
    console.log(`✗ ${file}: not valid JSON (${e instanceof Error ? e.message : e})`);
    failed += 1;
    continue;
  }
  if ((input as { track?: string }).track !== file.replace(/\.json$/, '')) {
    console.log(`✗ ${file}: "track" must be "${file.replace(/\.json$/, '')}"`);
    failed += 1;
    continue;
  }
  const problems = checkAuthoredChapter(input);
  const parsed = AuthoredChapterSchema.safeParse(input);
  if (problems.length === 0 && parsed.success) {
    const lines = parsed.data.missions.reduce((n, m) => n + m.lines.length, 0);
    console.log(`✓ ${file}: ${parsed.data.missions.length} missions, ${lines} lines`);
    for (const m of parsed.data.missions) {
      const dialogue = m.lines.filter((l) => l.slot !== null);
      console.log(`    ${m.blueprint}: ${dialogue.filter((l) => l.by === 'learner').length} learner + ${dialogue.filter((l) => l.by === 'character').length} character lines, ${m.lines.length - dialogue.length} variants`);
    }
  } else {
    failed += 1;
    console.log(`✗ ${file}: ${problems.length} problem(s)`);
    for (const p of problems) console.log(`    - ${p}`);
  }
}
process.exit(failed ? 1 : 0);
