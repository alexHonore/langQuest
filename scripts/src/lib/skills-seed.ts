/**
 * Skills seed for `seed-curriculum` (device QA 2026-10-19 §6.2: Progress showed raw skill keys).
 *
 * One `public.skills` row per registry or system skill (`ALL_SKILLS` in `@langquest/curriculum`), each with a
 * learner-facing name in the en and fr catalogs under `skillNameKey(skillKey)` (`progress.skill.<key>`). The table
 * has no name column: the name key is derived from `skill_key`, and the plan carries the resolved names so a dry run
 * shows them.
 *
 * Before anything is written the plan proves that every skill key the curriculum references (registry, system
 * skills, blueprint objectives and prerequisites, intents, story milestones) and every key the seeded mission rows
 * reference (`goals[].skill_keys`, `prerequisite_skill_keys`, `scoring_rubric.objectives[].skillKeys`) has a row
 * and both names. Any gap is a plan problem and nothing is applied.
 *
 * Idempotent and id-stable:
 *  - a new row gets the deterministic id `curriculumUuid('skill', key)`;
 *  - a row that already exists keeps its id (rows written earlier by `ensureSkills` / `seed-languages` have
 *    random ids, and `skill_variants.skill_id` references them, so a primary key is never rewritten);
 *  - unchanged rows are not written, so a second run writes nothing;
 *  - rows that are not in the plan (editor-authored skills) are never touched or deleted.
 */
import { ALL_SKILLS, SYSTEM_SKILL_KEYS, skillNameKey, SKILL_NAME_KEY_PREFIX, type Skill } from '@langquest/curriculum';
import { curriculumSkillReferences } from '@langquest/curriculum/skill-references';
import type { DbClient, Insert, Row } from '@langquest/db';
import { curriculumSeedKeys, curriculumUuid } from '@langquest/db/seed/curriculum-uuid';
import { getFlatCatalog, type FlatCatalog } from '@langquest/locales';

/** Locales whose catalogs must name every seeded skill (CONVENTIONS §6: en and fr complete). */
export const SKILL_NAME_LOCALES = ['en', 'fr'] as const;
export type SkillNameLocale = (typeof SKILL_NAME_LOCALES)[number];

/** `skills.skill_key` check constraint (migration 020). */
const SKILL_KEY_PATTERN = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/;

/** Columns of `public.skills` the seed owns. */
export interface SkillSeedRow {
  id: string;
  skill_key: string;
  descriptor: string;
  difficulty: number;
  target_language_id: null;
  cefr_can_do: string;
  can_do_statement: string;
  prerequisite_skill_keys: string[];
}

export interface PlannedSkill {
  row: SkillSeedRow;
  kind: 'registry' | 'system';
  /** Catalog key of the learner-facing name. */
  nameKey: string;
  /** Resolved names (`null` when the catalog lacks the key, which is a plan problem). */
  names: Record<SkillNameLocale, string | null>;
  /** Sorted kinds of data that reference this key. */
  referencedBy: string[];
}

export interface SkillSeedPlan {
  planned: PlannedSkill[];
  /** Every referenced key, sorted. */
  referencedKeys: string[];
  /** Empty when the seed may be applied. */
  problems: string[];
}

/** The parts of a planned `missions` row that reference skills (jsonb columns arrive untyped). */
export interface MissionSkillRefRow {
  id?: string;
  goals?: unknown;
  prerequisite_skill_keys?: readonly string[] | null;
  scoring_rubric?: unknown;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => asArray(v).filter((x): x is string => typeof x === 'string');

/** Skill keys referenced by seeded mission rows, by kind (`mission_goal`, `mission_prerequisite`, `mission_rubric`). */
export function missionRowSkillReferences(missions: readonly MissionSkillRefRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, source: string): void => {
    const set = out.get(key) ?? new Set<string>();
    set.add(source);
    out.set(key, set);
  };
  for (const m of missions) {
    for (const g of asArray(m.goals)) for (const k of strings(asRecord(g).skill_keys)) add(k, 'mission_goal');
    for (const k of m.prerequisite_skill_keys ?? []) add(k, 'mission_prerequisite');
    for (const o of asArray(asRecord(m.scoring_rubric).objectives)) for (const k of strings(asRecord(o).skillKeys)) add(k, 'mission_rubric');
  }
  return out;
}

export interface SkillSeedPlanOptions {
  /** Skills to seed (default `ALL_SKILLS`: the registry, then the system skills). */
  skills?: readonly Skill[];
  /** Seeded mission rows whose skill references must be covered. */
  missions?: readonly MissionSkillRefRow[];
  /** Curriculum references (default `curriculumSkillReferences()`). */
  references?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Flat catalogs used to resolve names (default: the bundled en and fr catalogs). */
  catalogs?: Record<SkillNameLocale, FlatCatalog>;
}

/** Deterministic id of a skill row the seed inserts. */
export const skillSeedId = (skillKey: string): string => curriculumUuid('skill', curriculumSeedKeys.skill(skillKey));

/** Build the skills part of the curriculum seed plan. Pure. */
export function buildSkillSeedPlan(options: SkillSeedPlanOptions = {}): SkillSeedPlan {
  const skills = options.skills ?? ALL_SKILLS;
  const catalogs = options.catalogs ?? { en: getFlatCatalog('en'), fr: getFlatCatalog('fr') };
  const references = new Map<string, Set<string>>();
  const merge = (src: ReadonlyMap<string, ReadonlySet<string>>): void => {
    for (const [key, sources] of src) {
      const set = references.get(key) ?? new Set<string>();
      for (const s of sources) set.add(s);
      references.set(key, set);
    }
  };
  merge(options.references ?? curriculumSkillReferences());
  merge(missionRowSkillReferences(options.missions ?? []));

  const problems: string[] = [];
  const planned: PlannedSkill[] = [];
  const seen = new Set<string>();
  const system = new Set(SYSTEM_SKILL_KEYS);
  for (const s of skills) {
    if (seen.has(s.skillKey)) {
      problems.push(`skill ${s.skillKey} is defined twice`);
      continue;
    }
    seen.add(s.skillKey);
    if (!SKILL_KEY_PATTERN.test(s.skillKey)) problems.push(`skill ${s.skillKey} does not match the skills.skill_key check constraint`);
    const nameKey = skillNameKey(s.skillKey);
    const names = {} as Record<SkillNameLocale, string | null>;
    for (const locale of SKILL_NAME_LOCALES) {
      const name = catalogs[locale][nameKey]?.trim() ?? '';
      names[locale] = name.length > 0 ? name : null;
      if (!names[locale]) problems.push(`skill ${s.skillKey} has no ${locale} name (catalog key ${nameKey})`);
      else if (name === s.skillKey || name === nameKey) problems.push(`skill ${s.skillKey}: the ${locale} name is the raw key`);
    }
    planned.push({
      row: {
        id: skillSeedId(s.skillKey),
        skill_key: s.skillKey,
        descriptor: s.descriptor,
        difficulty: s.difficulty,
        target_language_id: null,
        cefr_can_do: s.cefrCanDo,
        can_do_statement: s.canDoStatement,
        prerequisite_skill_keys: [...s.prerequisites],
      },
      kind: system.has(s.skillKey) ? 'system' : 'registry',
      nameKey,
      names,
      referencedBy: [...(references.get(s.skillKey) ?? [])].sort(),
    });
  }
  for (const [key, sources] of references) {
    if (!seen.has(key)) problems.push(`skill ${key} is referenced (${[...sources].sort().join(', ')}) but has no skills row: add it to SKILLS or SYSTEM_SKILLS in @langquest/curriculum`);
  }
  for (const locale of SKILL_NAME_LOCALES) {
    for (const key of Object.keys(catalogs[locale])) {
      if (!key.startsWith(`${SKILL_NAME_KEY_PREFIX}.`)) continue;
      const skillKey = key.slice(SKILL_NAME_KEY_PREFIX.length + 1);
      if (!seen.has(skillKey)) problems.push(`${locale} catalog name ${key} has no skill`);
    }
  }
  return { planned, referencedKeys: [...references.keys()].sort(), problems };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ExistingSkillRow = Pick<Row<'skills'>, 'id' | 'skill_key' | 'descriptor' | 'difficulty' | 'target_language_id' | 'cefr_can_do' | 'can_do_statement' | 'prerequisite_skill_keys'>;

export interface SkillSeedDiff {
  /** New rows (deterministic ids). */
  inserts: SkillSeedRow[];
  /** Changed rows, carrying the existing id. */
  updates: SkillSeedRow[];
  /** Keys whose row already matches the plan (not written). */
  unchanged: string[];
  /** Keys whose existing row has a non-deterministic id that is kept as is. */
  keptExistingIds: string[];
}

const sameRow = (a: SkillSeedRow, b: ExistingSkillRow): boolean =>
  a.descriptor === b.descriptor &&
  Math.abs(Number(a.difficulty) - Number(b.difficulty)) < 1e-9 &&
  a.target_language_id === (b.target_language_id ?? null) &&
  a.cefr_can_do === (b.cefr_can_do ?? null) &&
  a.can_do_statement === (b.can_do_statement ?? null) &&
  a.prerequisite_skill_keys.length === (b.prerequisite_skill_keys ?? []).length &&
  a.prerequisite_skill_keys.every((k, i) => b.prerequisite_skill_keys[i] === k);

/** Compare planned rows with what the table holds (pure). */
export function diffSkillSeed(planned: readonly SkillSeedRow[], existing: readonly ExistingSkillRow[]): SkillSeedDiff {
  const byKey = new Map(existing.map((r) => [r.skill_key, r] as const));
  const diff: SkillSeedDiff = { inserts: [], updates: [], unchanged: [], keptExistingIds: [] };
  for (const row of planned) {
    const current = byKey.get(row.skill_key);
    if (!current) {
      diff.inserts.push(row);
      continue;
    }
    if (current.id !== row.id) diff.keptExistingIds.push(row.skill_key);
    if (sameRow(row, current)) diff.unchanged.push(row.skill_key);
    else diff.updates.push({ ...row, id: current.id });
  }
  return diff;
}

export interface SkillSeedCounts {
  inserted: number;
  updated: number;
  deleted: number;
  /** Rows already matching the plan (not written). */
  skipped: number;
  /** Existing rows whose (non-deterministic) id was kept. */
  keptExistingIds: number;
}

const CHUNK = 200;
const chunked = <T,>(rows: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
};

/** Upsert the planned skills (on `skill_key`), writing only new or changed rows. Never deletes. */
export async function applySkillSeed(db: DbClient, planned: readonly SkillSeedRow[]): Promise<SkillSeedCounts> {
  const existing: ExistingSkillRow[] = [];
  for (const part of chunked(planned.map((r) => r.skill_key))) {
    const res = await db.from('skills').select('id, skill_key, descriptor, difficulty, target_language_id, cefr_can_do, can_do_statement, prerequisite_skill_keys').in('skill_key', part);
    if (res.error) throw new Error(`skills.select: ${res.error.message}`);
    existing.push(...((res.data ?? []) as ExistingSkillRow[]));
  }
  const diff = diffSkillSeed(planned, existing);
  const writes: Insert<'skills'>[] = [...diff.inserts, ...diff.updates];
  for (const part of chunked(writes)) {
    const res = await db.from('skills').upsert(part, { onConflict: 'skill_key' });
    if (res.error) throw new Error(`skills.upsert: ${res.error.message}`);
  }
  return { inserted: diff.inserts.length, updated: diff.updates.length, deleted: 0, skipped: diff.unchanged.length, keptExistingIds: diff.keptExistingIds.length };
}

/** One-line plan summary for the CLI. */
export function describeSkillSeedPlan(plan: SkillSeedPlan): string {
  const system = plan.planned.filter((p) => p.kind === 'system').length;
  const named = plan.planned.filter((p) => SKILL_NAME_LOCALES.every((l) => p.names[l])).length;
  return `skills   ${plan.planned.length} rows (registry=${plan.planned.length - system} system=${system}) referenced=${plan.referencedKeys.length} named(${SKILL_NAME_LOCALES.join('+')})=${named}/${plan.planned.length} problems=${plan.problems.length}`;
}
