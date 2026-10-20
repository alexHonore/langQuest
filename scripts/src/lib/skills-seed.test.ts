/**
 * Skills seed (device QA 2026-10-19 §6.2: Progress showed raw skill keys such as `speaking.intelligibility`).
 * Offline: the plan is checked against the bundled curriculum and catalogs, and the apply path runs against an
 * in-memory `skills` table that refuses primary-key rewrites.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_SKILL_KEYS, SKILL_KEYS, SYSTEM_SKILL_KEYS, getSkill, skillNameKey } from '@langquest/curriculum';
import type { DbClient, Insert } from '@langquest/db';
import { curriculumSeedKeys, curriculumUuid } from '@langquest/db/seed/curriculum-uuid';
import { getFlatCatalog } from '@langquest/locales';
import { describe, expect, it } from 'vitest';
import { applyCurriculumSeedPlan, buildCurriculumSeedPlan, main, spec, type SeedCurriculumDeps } from '../seed-curriculum';
import { memoryIo, runCli } from './cli';
import { repoRoot } from './io';
import { applySkillSeed, buildSkillSeedPlan, diffSkillSeed, missionRowSkillReferences, skillSeedId, type ExistingSkillRow } from './skills-seed';

const en = getFlatCatalog('en');
const fr = getFlatCatalog('fr');

/** In-memory `public.skills`: upsert on `skill_key`, and a primary-key rewrite throws (skill_variants reference it). */
function fakeSkillsTable(initial: ExistingSkillRow[] = []) {
  const rows = new Map(initial.map((r) => [r.skill_key, { ...r, prerequisite_skill_keys: [...r.prerequisite_skill_keys] }]));
  const writes: { rows: Insert<'skills'>[]; onConflict: string | undefined }[] = [];
  const db = {
    from(table: string) {
      if (table !== 'skills') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: async (column: string, keys: string[]) => {
            if (column !== 'skill_key') throw new Error(`unexpected filter ${column}`);
            return { data: keys.flatMap((k) => (rows.has(k) ? [{ ...rows.get(k)! }] : [])), error: null };
          },
        }),
        upsert: async (batch: Insert<'skills'>[], options?: { onConflict?: string }) => {
          writes.push({ rows: batch, onConflict: options?.onConflict });
          for (const r of batch) {
            const prev = rows.get(r.skill_key);
            if (prev && r.id !== undefined && r.id !== prev.id) throw new Error(`primary key rewrite for ${r.skill_key}`);
            rows.set(r.skill_key, {
              id: prev?.id ?? r.id!,
              skill_key: r.skill_key,
              descriptor: r.descriptor,
              difficulty: r.difficulty ?? 0.5,
              target_language_id: r.target_language_id ?? null,
              cefr_can_do: r.cefr_can_do ?? null,
              can_do_statement: r.can_do_statement ?? null,
              prerequisite_skill_keys: [...(r.prerequisite_skill_keys ?? [])],
            });
          }
          return { error: null };
        },
      };
    },
  };
  return { db: db as unknown as DbClient, rows, writes };
}

describe('skills seed plan (seed-curriculum)', () => {
  const plan = buildCurriculumSeedPlan();
  const byKey = new Map(plan.skills.planned.map((p) => [p.row.skill_key, p]));

  it('plans one row per registry and system skill, with no problems', () => {
    expect(plan.skills.problems).toEqual([]);
    expect(plan.rows.skills.map((r) => r.skill_key)).toEqual([...ALL_SKILL_KEYS]);
    expect(plan.skills.planned.filter((p) => p.kind === 'system').map((p) => p.row.skill_key).sort()).toEqual([...SYSTEM_SKILL_KEYS].sort());
    expect(plan.skills.planned.filter((p) => p.kind === 'registry')).toHaveLength(SKILL_KEYS.length);
  });

  it('every skill key referenced by the curriculum or the seeded missions (goals, prerequisites, rubric objectives) has a row and en + fr names', () => {
    const missionRefs = missionRowSkillReferences(plan.rows.missions);
    expect(missionRefs.size).toBeGreaterThan(0);
    for (const [key, sources] of missionRefs) {
      expect(sources.has('mission_goal') || sources.has('mission_prerequisite') || sources.has('mission_rubric'), key).toBe(true);
    }
    for (const m of plan.rows.missions) {
      const rubric = m.scoring_rubric as { objectives: { skillKeys: string[] }[] };
      const goals = m.goals as { skill_keys: string[] }[];
      const keys = [...goals.flatMap((g) => g.skill_keys), ...(m.prerequisite_skill_keys ?? []), ...rubric.objectives.flatMap((o) => o.skillKeys)];
      expect(keys.length, m.id).toBeGreaterThan(0);
      for (const k of keys) expect(byKey.has(k), `${m.id} references ${k}`).toBe(true);
    }
    expect(plan.skills.referencedKeys.length).toBeGreaterThanOrEqual(missionRefs.size);
    for (const key of plan.skills.referencedKeys) {
      const p = byKey.get(key);
      expect(p, key).toBeDefined();
      expect(p!.nameKey).toBe(skillNameKey(key));
      for (const locale of ['en', 'fr'] as const) {
        expect(p!.names[locale], `${locale} ${key}`).toBeTruthy();
        expect(p!.names[locale], `${locale} ${key}`).not.toBe(key);
      }
      expect(p!.names.en).toBe(en[skillNameKey(key)]);
      expect(p!.names.fr).toBe(fr[skillNameKey(key)]);
    }
    expect(byKey.get('greet_politely')!.referencedBy).toEqual(expect.arrayContaining(['registry', 'intent', 'blueprint_objective', 'mission_goal', 'mission_rubric']));
  });

  it('names the system skills the API records (what Progress showed as raw keys)', () => {
    expect(byKey.get('speaking.intelligibility')!.names).toEqual({ en: 'Be understood when speaking', fr: "Se faire comprendre à l'oral" });
    expect(byKey.get('general.participation')!.names).toEqual({ en: 'Take part in the conversation', fr: 'Participer à la conversation' });
    expect(byKey.get('speaking.pronunciation')!.names.fr).toBe('Prononciation');
  });

  it('the catalogs carry exactly the planned skill names (no stale or missing progress.skill keys), and fr is translated', () => {
    const named = (flat: Record<string, string>) => Object.keys(flat).filter((k) => k.startsWith('progress.skill.')).sort();
    expect(named(en)).toEqual(ALL_SKILL_KEYS.map(skillNameKey).sort());
    expect(named(fr)).toEqual(named(en));
    const copies = ALL_SKILL_KEYS.filter((k) => en[skillNameKey(k)] === fr[skillNameKey(k)]);
    expect(copies).toEqual([]);
  });

  it('rows mirror the curriculum registry and carry deterministic ids', () => {
    for (const row of plan.rows.skills) {
      const s = getSkill(row.skill_key);
      expect(row).toEqual({ id: curriculumUuid('skill', curriculumSeedKeys.skill(row.skill_key)), skill_key: s.skillKey, descriptor: s.descriptor, difficulty: s.difficulty, target_language_id: null, cefr_can_do: s.cefrCanDo, can_do_statement: s.canDoStatement, prerequisite_skill_keys: [...s.prerequisites] });
    }
    // Pinned so a refactor cannot silently re-key the seeded skills.
    expect(skillSeedId('greet_politely')).toBe('c3bf4b19-3eaa-5ec9-adee-4365733ac0d1');
    expect(skillSeedId('speaking.intelligibility')).toBe('8e3cf2a0-590c-5e82-95a3-7f7929729f7c');
    expect(new Set(plan.rows.skills.map((r) => r.id)).size).toBe(plan.rows.skills.length);
    expect(buildCurriculumSeedPlan().rows.skills).toEqual(plan.rows.skills);
    // Skills are language independent: a track filter never narrows them.
    expect(buildCurriculumSeedPlan({ tracks: ['japanese'] }).rows.skills).toEqual(plan.rows.skills);
  });
});

describe('skills seed problems (nothing is applied while any exist)', () => {
  it('flags a mission reference to an unknown skill key', () => {
    const plan = buildSkillSeedPlan({ missions: [{ goals: [{ id: 'greet', skill_keys: ['greetings.basic'] }], prerequisite_skill_keys: [], scoring_rubric: { objectives: [] } }] });
    expect(plan.problems).toEqual([expect.stringMatching(/^skill greetings\.basic is referenced \(mission_goal\) but has no skills row/)]);
  });

  it('flags a missing or raw-key name, and a catalog name without a skill', () => {
    const catalogs = { en: { ...en }, fr: { ...fr } };
    delete (catalogs.fr as Record<string, string>)[skillNameKey('ask_price')];
    (catalogs.en as Record<string, string>)[skillNameKey('take_leave')] = 'take_leave';
    (catalogs.en as Record<string, string>)['progress.skill.retired_skill'] = 'Retired';
    const plan = buildSkillSeedPlan({ catalogs });
    expect(plan.problems).toEqual(
      expect.arrayContaining([
        'skill ask_price has no fr name (catalog key progress.skill.ask_price)',
        'skill take_leave: the en name is the raw key',
        'en catalog name progress.skill.retired_skill has no skill',
      ]),
    );
    expect(plan.problems).toHaveLength(3);
  });

  it('flags a duplicate or constraint-violating skill key', () => {
    const s = getSkill('ask_price');
    const plan = buildSkillSeedPlan({ skills: [s, s, { ...s, skillKey: 'Bad-Key' }], references: new Map(), catalogs: { en: { [skillNameKey('ask_price')]: 'Ask the price', [skillNameKey('Bad-Key')]: 'x' }, fr: { [skillNameKey('ask_price')]: 'Demander le prix', [skillNameKey('Bad-Key')]: 'x' } } });
    expect(plan.problems).toEqual(['skill ask_price is defined twice', 'skill Bad-Key does not match the skills.skill_key check constraint']);
  });

  it('applyCurriculumSeedPlan refuses a plan with skill problems before touching the database', async () => {
    const plan = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'] });
    const untouchable = { from: () => { throw new Error('database touched'); } } as unknown as DbClient;
    await expect(applyCurriculumSeedPlan(untouchable, { ...plan, skills: { ...plan.skills, problems: ['skill x has no fr name'] } }, memoryIo())).rejects.toThrow(/skills plan has 1 problem\(s\); nothing applied/);
  });

  it('the bundled plan dry-runs cleanly (exit 0) and reports the skills line', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--track', 'arabic-moroccan', '--dry-run'], main, io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toContain(`skills   ${ALL_SKILL_KEYS.length} rows (registry=${SKILL_KEYS.length} system=${SYSTEM_SKILL_KEYS.length}) referenced=${ALL_SKILL_KEYS.length} named(en+fr)=${ALL_SKILL_KEYS.length}/${ALL_SKILL_KEYS.length} problems=0`);
    expect(text).toMatch(new RegExp(`plan: skills=${ALL_SKILL_KEYS.length} `));
    expect(io.lines).toContain('dry-run: nothing applied');
    expect(io.errors).toEqual([]);
  });

  it.each([['--dry-run'], ['--apply']])('the CLI exits 1 with %s when a seeded mission references an unknown skill, before any database is resolved', async (flag) => {
    // A real plan problem: one extra mission row references a key the evaluator invented (seen in the local DB).
    const deps: SeedCurriculumDeps = {
      buildPlan: (options) => {
        const p = buildCurriculumSeedPlan(options);
        return { ...p, skills: buildSkillSeedPlan({ missions: [...p.rows.missions, { goals: [{ id: 'greet', skill_keys: ['greetings.basic'] }], prerequisite_skill_keys: [], scoring_rubric: { objectives: [] } }] }) };
      },
      resolveDb: () => {
        throw new Error('database resolved');
      },
    };
    const io = memoryIo();
    expect(await runCli(spec, ['--track', 'arabic-moroccan', flag], (args, cliIo) => main(args, cliIo, deps), io)).toBe(1);
    // Exactly the gate's lines: had the gate moved after the dry-run or apply branch, this would show exit 0 or the resolver's error.
    expect(io.errors).toEqual([
      expect.stringMatching(/^skills: skill greetings\.basic is referenced \(mission_goal\) but has no skills row/),
      'skills plan has problems: nothing applied (every referenced skill needs a row and en+fr names)',
    ]);
    expect(io.lines.join('\n')).toContain('problems=1');
    expect(io.lines.some((l) => l.startsWith('applying to') || l.includes('nothing applied'))).toBe(false);
  });
});

describe('skills seed apply (idempotent, id-stable)', () => {
  const planned = buildSkillSeedPlan().planned.map((p) => p.row);

  it('inserts every row with its deterministic id, then a second run writes nothing', async () => {
    const t = fakeSkillsTable();
    const first = await applySkillSeed(t.db, planned);
    expect(first).toEqual({ inserted: planned.length, updated: 0, deleted: 0, skipped: 0, keptExistingIds: 0 });
    expect(t.writes.every((w) => w.onConflict === 'skill_key')).toBe(true);
    expect([...t.rows.values()].map((r) => r.id)).toEqual(planned.map((r) => r.id));
    const ids = new Map([...t.rows.values()].map((r) => [r.skill_key, r.id]));
    const writesAfterFirst = t.writes.length;
    const second = await applySkillSeed(t.db, planned);
    expect(second).toEqual({ inserted: 0, updated: 0, deleted: 0, skipped: planned.length, keptExistingIds: 0 });
    expect(t.writes.length).toBe(writesAfterFirst);
    expect(new Map([...t.rows.values()].map((r) => [r.skill_key, r.id]))).toEqual(ids);
  });

  it('keeps the id of a row written before ids were deterministic, updates drifted columns, and never deletes foreign rows', async () => {
    const legacy: ExistingSkillRow = { id: '11111111-1111-4111-8111-111111111111', skill_key: 'greet_politely', descriptor: 'Old wording', difficulty: 0.05, target_language_id: null, cefr_can_do: 'A1', can_do_statement: getSkill('greet_politely').canDoStatement, prerequisite_skill_keys: [] };
    const editorRow: ExistingSkillRow = { id: '22222222-2222-4222-8222-222222222222', skill_key: 'editor_only_skill', descriptor: 'Editor skill', difficulty: 0.5, target_language_id: null, cefr_can_do: null, can_do_statement: null, prerequisite_skill_keys: [] };
    const unchanged = planned.find((r) => r.skill_key === 'ask_price')!;
    const legacyUnchanged: ExistingSkillRow = { ...unchanged, id: '33333333-3333-4333-8333-333333333333' };
    const t = fakeSkillsTable([legacy, editorRow, legacyUnchanged]);
    const first = await applySkillSeed(t.db, planned);
    expect(first).toEqual({ inserted: planned.length - 2, updated: 1, deleted: 0, skipped: 1, keptExistingIds: 2 });
    expect(t.rows.get('greet_politely')).toMatchObject({ id: legacy.id, descriptor: 'Greet someone politely' });
    expect(t.rows.get('ask_price')!.id).toBe(legacyUnchanged.id);
    expect(t.rows.get('editor_only_skill')).toEqual(editorRow);
    expect(t.rows.get('speaking.intelligibility')!.id).toBe(skillSeedId('speaking.intelligibility'));
    const second = await applySkillSeed(t.db, planned);
    expect(second).toEqual({ inserted: 0, updated: 0, deleted: 0, skipped: planned.length, keptExistingIds: 2 });
    expect(t.rows.get('greet_politely')!.id).toBe(legacy.id);
  });

  it('diffSkillSeed compares numeric difficulty by value and prerequisite lists in order', () => {
    const row = planned.find((r) => r.skill_key === 'repair_misunderstanding')!;
    expect(row.prerequisite_skill_keys.length).toBeGreaterThan(1);
    const diff = diffSkillSeed([row], [{ ...row, difficulty: Number(String(row.difficulty)) + 1e-12 }]);
    expect(diff).toEqual({ inserts: [], updates: [], unchanged: ['repair_misunderstanding'], keptExistingIds: [] });
    expect(diffSkillSeed([row], [{ ...row, prerequisite_skill_keys: [] }]).updates).toEqual([row]);
    expect(diffSkillSeed([row], [{ ...row, prerequisite_skill_keys: [...row.prerequisite_skill_keys].reverse() }]).updates).toEqual([row]);
    expect(diffSkillSeed([row], [{ ...row, difficulty: row.difficulty + 0.01 }]).updates).toEqual([row]);
  });
});

describe('runtime skill keys stay registered (drift guard)', () => {
  /** Hard-coded skill keys in API / jobs source: `skillKey: '…'`, `…Skill = '…'`, `…skills = … ['…']`. */
  const PATTERNS = [/skillKey:\s*'([^']+)'/g, /\b[A-Za-z]*[sS]kill\s*=\s*'([^']+)'/g, /\b[A-Za-z]*[sS]kills\s*=[^;\n]*\[\s*'([^']+)'/g];

  function hardCodedSkillKeys(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const dir of ['apps/api/src', 'apps/jobs/src']) {
      const root = join(repoRoot(), dir);
      for (const rel of readdirSync(root, { recursive: true }) as string[]) {
        if (!rel.endsWith('.ts') || rel.endsWith('.test.ts') || rel.includes('__tests__') || rel.includes('test-support')) continue;
        const text = readFileSync(join(root, rel), 'utf8');
        for (const re of PATTERNS) {
          for (const m of text.matchAll(re)) found.set(m[1]!, [...(found.get(m[1]!) ?? []), `${dir}/${rel}`]);
        }
      }
    }
    return found;
  }

  it('every skill key the API or the jobs hard-code is a known skill with a seed row', () => {
    const found = hardCodedSkillKeys();
    // The scan itself works: it sees the three system skills the API records today.
    for (const k of SYSTEM_SKILL_KEYS) expect(found.has(k), `scan finds ${k}`).toBe(true);
    const unknown = [...found.entries()].filter(([k]) => !ALL_SKILL_KEYS.includes(k)).map(([k, files]) => `${k} (${files.join(', ')})`);
    expect(unknown).toEqual([]);
  });
});
