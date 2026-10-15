import { describe, expect, it } from 'vitest';
import { COURSE_TRACKS, LANGUAGE_CODES } from '@langquest/contracts';
import { INTENTS, SKILLS } from '@langquest/curriculum';
import { buildSeedPlan } from '../seed-languages';
import { buildCoverageSeedSql, buildIntentsSeedSql, buildSkillsSeedSql, countStatements, curriculumSeedsFromCoverage } from './seed-sql';

describe('seed SQL builders', () => {
  it('emits one idempotent upsert per intent and per skill with escaped literals', () => {
    const intents = buildIntentsSeedSql();
    expect(countStatements(intents)).toBe(INTENTS.length);
    expect(intents).toContain("on conflict (intent_key) do update");
    expect(intents).toContain("'Say one''s own name.'"); // quote escaping
    const skills = buildSkillsSeedSql();
    expect(countStatements(skills)).toBe(SKILLS.length);
    expect(skills).toContain('on conflict (skill_key) do update');
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
