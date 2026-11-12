#!/usr/bin/env tsx
/**
 * Checks authored chapters before they are registered: `pnpm exec tsx packages/curriculum/src/content/authored-check.ts
 * [--chapter N] [track …]` (every file of every `content/authored/chapter-N/` without arguments). Prints what is wrong
 * with each, as sentences a writer can act on, with a summary of each mission; exits 1 when any chapter has a problem.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORED_CHAPTER_INDEXES, AuthoredChapterSchema, checkAuthoredChapter } from './authored';

const root = join(dirname(fileURLToPath(import.meta.url)), 'authored');
const args = process.argv.slice(2);
const chapterFlag = args.indexOf('--chapter');
const onlyChapter = chapterFlag >= 0 ? Number(args[chapterFlag + 1]) : null;
const wanted = args.filter((a, i) => a !== '--chapter' && i !== chapterFlag + 1);
const chapters = AUTHORED_CHAPTER_INDEXES.filter((n) => onlyChapter === null || n === onlyChapter).filter((n) => existsSync(join(root, `chapter-${n}`)));
let failed = 0;
let checked = 0;
for (const chapterIndex of chapters) {
  const dir = join(root, `chapter-${chapterIndex}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => wanted.length === 0 || wanted.includes(f.replace(/\.json$/, '')))
    .sort();
  if (chapters.length > 1 && files.length) console.log(`chapter ${chapterIndex}`);
  for (const file of files) {
    checked += 1;
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
    const problems = checkAuthoredChapter(input, chapterIndex);
    const parsed = AuthoredChapterSchema.safeParse(input);
    if (problems.length === 0 && parsed.success) {
      const lines = parsed.data.missions.reduce((n, m) => n + m.lines.length, 0);
      console.log(`✓ ${file}: ${parsed.data.missions.length} missions, ${lines} lines`);
      for (const m of parsed.data.missions) {
        const dialogue = m.lines.filter((l) => l.slot !== null);
        console.log(
          `    ${m.blueprint}: ${dialogue.filter((l) => l.by === 'learner').length} learner + ${dialogue.filter((l) => l.by === 'character').length} character lines, ${m.lines.length - dialogue.length} variants`,
        );
      }
    } else {
      failed += 1;
      console.log(`✗ ${file}: ${problems.length} problem(s)`);
      for (const p of problems) console.log(`    - ${p}`);
    }
  }
}
if (checked === 0) {
  console.error(`No chapter file for ${wanted.join(', ') || 'any track'}${onlyChapter ? ` in chapter ${onlyChapter}` : ''}`);
  process.exit(1);
}
process.exit(failed ? 1 : 0);
