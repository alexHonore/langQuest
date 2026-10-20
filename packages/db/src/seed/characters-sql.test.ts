import { COURSE_TRACKS, LANGUAGE_VARIETIES } from '@langquest/contracts';
import { CHARACTER_ROSTER, CHARACTER_UUID_NAMESPACE as UI_NAMESPACE, CHARACTER_UUID_NAME_PREFIX as UI_PREFIX, stableCharacterUuid } from '@langquest/ui/art/web';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTER_UUID_NAMESPACE, CHARACTER_UUID_NAME_PREFIX, characterUuid } from '../character-uuid';
import { CHARACTER_SAFETY_RULES, CHARACTER_SEED_MIGRATION_FILE, LEGACY_CHARACTER_SEED_MIGRATION_FILE, buildCharacterSeedSql, seededCharacterRows } from './characters-sql';

const CHARACTER_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

describe('art ↔ db character ids', () => {
  it('@langquest/ui and @langquest/db share the namespace, prefix and every roster uuid', () => {
    expect(UI_NAMESPACE).toBe(CHARACTER_UUID_NAMESPACE);
    expect(UI_PREFIX).toBe(CHARACTER_UUID_NAME_PREFIX);
    for (const c of CHARACTER_ROSTER) {
      expect(c.characterId, c.id).toBe(characterUuid(c.id));
      expect(stableCharacterUuid(c.id), c.id).toBe(characterUuid(c.id));
    }
  });
});

describe('seededCharacterRows', () => {
  const rows = seededCharacterRows();

  it('produces one published, fictional, synthetic-voice row per roster character', () => {
    expect(rows.length).toBe(CHARACTER_ROSTER.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.character_key)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.character_key).toMatch(CHARACTER_KEY_RE);
      expect(r.state).toBe('published');
      expect(r.voice_profile.synthetic).toBe(true);
      expect(r.voice_profile.providerVoiceId).toBeNull();
      expect(r.storyline_facts.length).toBeGreaterThanOrEqual(2);
      expect(r.storyline_facts.length).toBeLessThanOrEqual(3);
      expect(r.safety_rules).toEqual([...CHARACTER_SAFETY_RULES]);
      expect(r.safety_rules.join(' ')).toMatch(/manipulat/i);
    }
  });

  it('only references seeded varieties and valid regional options of the character tracks', () => {
    const varieties = new Set(LANGUAGE_VARIETIES.map((v) => v.id));
    for (const c of CHARACTER_ROSTER) {
      expect(varieties.has(c.varietyId), c.id).toBe(true);
      const tracks = c.trackIds.map((t) => COURSE_TRACKS.find((x) => x.id === t)!);
      for (const t of tracks) expect(t.targetVarietyId, `${c.id} track ${t.id}`).toBe(c.varietyId);
      if (c.voice.regionalOption)
        expect(tracks.some((t) => t.regionalOptions.some((o) => o.id === c.voice.regionalOption)), `${c.id} regionalOption ${c.voice.regionalOption}`).toBe(true);
    }
  });
});

describe('buildCharacterSeedSql', () => {
  const sql = buildCharacterSeedSql();

  it('upserts every roster character by character_key with its deterministic uuid', () => {
    expect((sql.match(/insert into public\.characters /g) ?? []).length).toBe(CHARACTER_ROSTER.length);
    for (const c of CHARACTER_ROSTER) expect(sql).toContain(`values ('${characterUuid(c.id)}', '${c.id}', `);
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert into'));
    expect(inserts.every((l) => l.includes(' on conflict (character_key) do update '))).toBe(true);
    expect(sql).not.toMatch(/do update set[^\n]*\bstate = excluded\.state/);
    expect(sql).toContain("check (character_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$')");
  });

  it('matches the committed 140 migration file exactly (re-run seed:characters-sql after changing the roster)', () => {
    const committed = readFileSync(resolve(import.meta.dirname, `../../../../supabase/migrations/${CHARACTER_SEED_MIGRATION_FILE}`), 'utf8');
    expect(committed).toBe(sql);
  });

  it('keeps every row of the frozen 130 seed (16 legacy characters) with the identical uuid and key', () => {
    const legacy = readFileSync(resolve(import.meta.dirname, `../../../../supabase/migrations/${LEGACY_CHARACTER_SEED_MIGRATION_FILE}`), 'utf8');
    const legacyRows = [...legacy.matchAll(/values \('([0-9a-f-]{36})', '([a-z0-9-]+)', /g)].map((m) => ({ id: m[1]!, key: m[2]! }));
    expect(legacyRows).toHaveLength(16);
    const rows = seededCharacterRows();
    for (const l of legacyRows) {
      const row = rows.find((r) => r.character_key === l.key);
      expect(row, l.key).toBeDefined();
      expect(row!.id, l.key).toBe(l.id);
      expect(sql).toContain(`values ('${l.id}', '${l.key}', `);
    }
    // Legacy rows come first so manifests / fixtures built on the first roster keep their order.
    expect(rows.slice(0, 16).map((r) => r.character_key)).toEqual(legacyRows.map((l) => l.key));
  });
});
