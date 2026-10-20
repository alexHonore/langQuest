import { describe, expect, it } from 'vitest';
import { COURSE_TRACKS, LANGUAGE_CODES } from '@langquest/contracts';
import { ALL_SKILLS, INTENTS, SKILLS, SYSTEM_SKILL_KEYS, skillNameKey, type Skill } from '@langquest/curriculum';
import { buildCurriculumSeedPlan } from '../seed-curriculum';
import { buildSeedPlan } from '../seed-languages';
import { buildCoverageSeedSql, buildIntentsSeedSql, buildSkillsSeedSql, countStatements, curriculumSeedsFromCoverage } from './seed-sql';
import { buildSkillSeedPlan, skillSeedId } from './skills-seed';

describe('seed SQL builders', () => {
  it('emits one idempotent upsert per intent and per skill with escaped literals', () => {
    const intents = buildIntentsSeedSql();
    expect(countStatements(intents)).toBe(INTENTS.length);
    expect(intents).toContain("on conflict (intent_key) do update");
    expect(intents).toContain("'Say one''s own name.'"); // quote escaping
    const skills = buildSkillsSeedSql();
    expect(countStatements(skills)).toBe(ALL_SKILLS.length);
    expect(skills).toContain('on conflict (skill_key) do update');
  });

  it('seeds the same full skill set, with the same ids, as seed-curriculum (registry + system skills)', () => {
    const sql = buildSkillsSeedSql();
    const lines = sql.split('\n').filter((l) => /^insert into public\.skills /.test(l));
    // 59 registry + 3 system skills (speaking.intelligibility, speaking.pronunciation, general.participation).
    expect(lines).toHaveLength(SKILLS.length + SYSTEM_SKILL_KEYS.length);
    expect(sql.split('\n')[0]).toBe(`-- skills (from @langquest/curriculum ALL_SKILLS: ${SKILLS.length} registry + ${SYSTEM_SKILL_KEYS.length} system; same rows and ids as seed-curriculum)`);
    const curriculum = buildCurriculumSeedPlan().skills;
    expect(curriculum.problems).toEqual([]);
    expect(curriculum.planned.map((p) => p.row.skill_key)).toEqual(ALL_SKILLS.map((s) => s.skillKey));
    curriculum.planned.forEach(({ row }, i) => {
      const line = lines[i]!;
      // New rows get the deterministic seed id (the one seed-curriculum inserts), in the same order.
      expect(row.id).toBe(skillSeedId(row.skill_key));
      expect(line).toContain(`values ('${row.id}', '${row.skill_key}', `);
      expect(line).toContain(`, ${row.difficulty}, null, '${row.cefr_can_do}', `);
    });
    for (const key of SYSTEM_SKILL_KEYS) expect(sql).toContain(`'${skillSeedId(key)}', '${key}'`);
  });

  it('never rewrites an existing id and skips unchanged rows (a re-run writes nothing)', () => {
    const line = buildSkillsSeedSql().split('\n').find((l) => l.includes(`'speaking.intelligibility'`))!;
    const update = line.slice(line.indexOf(' on conflict (skill_key) do update set '));
    expect(update).toBe(
      ' on conflict (skill_key) do update set descriptor = excluded.descriptor, difficulty = excluded.difficulty, target_language_id = excluded.target_language_id, cefr_can_do = excluded.cefr_can_do, can_do_statement = excluded.can_do_statement, prerequisite_skill_keys = excluded.prerequisite_skill_keys' +
        ' where public.skills.descriptor is distinct from excluded.descriptor or public.skills.difficulty is distinct from excluded.difficulty or public.skills.target_language_id is distinct from excluded.target_language_id or public.skills.cefr_can_do is distinct from excluded.cefr_can_do or public.skills.can_do_statement is distinct from excluded.can_do_statement or public.skills.prerequisite_skill_keys is distinct from excluded.prerequisite_skill_keys;',
    );
    expect(update).not.toMatch(/\bid = excluded\.id\b/);
  });

  it('escapes literals and refuses a plan with problems (like seed-curriculum, nothing partial is emitted)', () => {
    const custom: Skill = { ...ALL_SKILLS[0]!, skillKey: 'say_ones_name', descriptor: "Say one's own name", canDoStatement: "Can say one's name.", prerequisites: ["greet_politely"] };
    const name = skillNameKey(custom.skillKey);
    const plan = buildSkillSeedPlan({ skills: [custom], references: new Map(), catalogs: { en: { [name]: 'Say your name' }, fr: { [name]: 'Dire son nom' } } });
    expect(plan.problems).toEqual([]);
    const sql = buildSkillsSeedSql(plan);
    expect(countStatements(sql)).toBe(1);
    expect(sql).toContain("'Say one''s own name'");
    expect(sql).toContain("array['greet_politely']::text[]");
    // A seeded mission that references a key the evaluator invented: no SQL at all.
    const broken = buildSkillSeedPlan({ missions: [{ goals: [{ id: 'greet', skill_keys: ['greetings.basic'] }], prerequisite_skill_keys: [], scoring_rubric: { objectives: [] } }] });
    expect(broken.problems.some((p) => p.includes('greetings.basic'))).toBe(true);
    expect(() => buildSkillsSeedSql(broken)).toThrow(/skills seed has 1 problem\(s\): skill greetings\.basic is referenced/);
  });

  it('emits honest coverage rows for every track × source and never upgrades reviewed rows', () => {
    const sql = buildCoverageSeedSql();
    expect(countStatements(sql)).toBe(COURSE_TRACKS.length * LANGUAGE_CODES.length);
    expect(sql).toContain("where public.course_source_localizations.native_reviewed = false and public.course_source_localizations.status <> 'complete'");
    expect(sql).not.toContain("'complete'," ); // no row is seeded as complete
    const seeds = curriculumSeedsFromCoverage(['en', 'fr']);
    expect(seeds.some((s) => s.courseTrackId === 'arabic-moroccan' && s.sourceLanguageCode === 'fr')).toBe(true);
    expect(seeds.every((s) => s.nativeReviewed === false)).toBe(true);
    const fr = buildCoverageSeedSql(['fr']);
    expect(fr).toContain("('arabic-moroccan', 'fr', 'partial'");
    expect(fr).toContain("('lingala', 'fr', 'planned'");
  });

  it('builds a full plan with the catalog seed from @langquest/db', () => {
    const plan = buildSeedPlan({ withIntents: true, withCoverage: true, sources: ['en'] });
    expect(plan.sections.map((s) => s.name.split(' ')[0])).toEqual(['catalog', 'skills', 'communicative_intents', 'course_source_localizations']);
    expect(plan.sql).toContain("insert into public.course_tracks");
    expect(plan.sections[0]!.statements).toBeGreaterThan(30);
    const minimal = buildSeedPlan({ withIntents: false, withCoverage: false });
    expect(minimal.sections).toHaveLength(1);
  });
});
