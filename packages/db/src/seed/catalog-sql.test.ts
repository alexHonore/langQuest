import { COURSE_TRACKS, AI_TASK_NAME_VALUES, LANGUAGES, LANGUAGE_VARIETIES, WRITING_SYSTEMS } from '@langquest/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalogSeedSql, DEFAULT_MODEL_PROFILES, TASKS_SEEDED_LATER, sqlJsonb, sqlLiteral, sqlTextArray } from './catalog-sql';

describe('sql helpers', () => {
  it('escapes single quotes and keeps unicode', () => {
    expect(sqlLiteral("l'été")).toBe("'l''été'");
    expect(sqlLiteral('العربية')).toBe("'العربية'");
  });
  it('renders arrays and jsonb', () => {
    expect(sqlTextArray([])).toBe("'{}'::text[]");
    expect(sqlTextArray(['a', "b'c"])).toBe("array['a','b''c']::text[]");
    expect(sqlJsonb({ a: 1 })).toBe(`'{"a":1}'::jsonb`);
  });
});

describe('buildCatalogSeedSql', () => {
  const sql = buildCatalogSeedSql();

  it('seeds every language, writing system, variety and all 30 tracks', () => {
    expect((sql.match(/insert into public\.languages /g) ?? []).length).toBe(LANGUAGES.length);
    expect((sql.match(/insert into public\.writing_systems /g) ?? []).length).toBe(WRITING_SYSTEMS.length);
    expect((sql.match(/insert into public\.language_varieties /g) ?? []).length).toBe(LANGUAGE_VARIETIES.length);
    expect((sql.match(/insert into public\.course_tracks /g) ?? []).length).toBe(30);
    for (const t of COURSE_TRACKS) expect(sql).toContain(`'${t.id}', ${t.order}, '${t.displayName}'`);
  });

  it('seeds en + fr coverage rows as planned for every track and one disabled profile per AI task', () => {
    expect((sql.match(/insert into public\.course_source_localizations /g) ?? []).length).toBe(60);
    expect(sql).not.toMatch(/course_source_localizations[^\n]*'complete'/);
    const seededHere = AI_TASK_NAME_VALUES.filter((t) => !TASKS_SEEDED_LATER[t]);
    expect((sql.match(/insert into public\.ai_model_profiles /g) ?? []).length).toBe(seededHere.length);
    expect(sql).not.toMatch(/ai_model_profiles[^\n]*\btrue, 1, 'unbenchmarked'/);
    expect(DEFAULT_MODEL_PROFILES.map((p) => p.task).sort()).toEqual([...seededHere].sort());
  });

  it('a task added later is seeded, disabled, by the migration that widened the task domain for it', () => {
    for (const [task, file] of Object.entries(TASKS_SEEDED_LATER)) {
      const migration = readFileSync(resolve(__dirname, '../../../../', file!), 'utf8');
      expect(migration).toContain(`'${task}'));`);
      expect(migration).toMatch(new RegExp(`insert into public\\.ai_model_profiles [^\\n]*values \\('${task}'[^\\n]*, false, 1, 'unbenchmarked'\\)`));
    }
  });

  it('is idempotent SQL (every insert carries on conflict) and inserts shared-asset tracks after their targets', () => {
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert into'));
    expect(inserts.every((l) => l.includes(' on conflict '))).toBe(true);
    const mandarin = sql.indexOf("insert into public.course_tracks (id, sort_order, display_name, language_id, primary_target_variety_id, default_locale, regional_options, scripts, script_mode_options, default_script_mode, script_focus, default_voices, teaching_focus, shares_assets_with_track_id, tonal, assumptions, automated_scoring_support, publication_state) values ('chinese-mandarin'");
    const simplified = sql.indexOf("values ('chinese-simplified'");
    expect(mandarin).toBeGreaterThan(-1);
    expect(simplified).toBeGreaterThan(mandarin);
  });

  it('matches the committed migration file exactly (re-run seed:catalog-sql after changing the catalog)', () => {
    const committed = readFileSync(resolve(import.meta.dirname, '../../../../supabase/migrations/20261014100800_080_seed_catalog.sql'), 'utf8');
    expect(committed).toBe(sql);
  });
});
