import { describe, expect, it } from 'vitest';
import { VISUAL_ASSET_TYPE_VALUES, VisualAssetEntityTableSchema, VisualAssetSlotSchema } from '@langquest/contracts';
import { ApiClientError } from '../api';
import { clampUnit, isStorageUnavailable, slotsFor, suggestedTypeForSlot, VISUAL_ENTITY_TABLES, VISUAL_SLOTS_BY_TABLE } from './slots';

describe('visual slots', () => {
  it('covers every contract entity table with contract slots only', () => {
    expect([...VISUAL_ENTITY_TABLES].sort()).toEqual([...VisualAssetEntityTableSchema.options].sort());
    for (const slots of Object.values(VISUAL_SLOTS_BY_TABLE)) {
      expect(slots.length).toBeGreaterThan(0);
      for (const s of slots) expect(VisualAssetSlotSchema.options).toContain(s);
    }
    expect(slotsFor('missions')).toContain('scene');
    expect(slotsFor('audio_lessons')).toEqual(['cover']);
  });

  it('suggests a contract asset type per slot', () => {
    expect(suggestedTypeForSlot('cover', 'audio_course_collections')).toBe('audio_cover');
    expect(suggestedTypeForSlot('cover', 'lesson_courses')).toBe('course_cover');
    expect(suggestedTypeForSlot('portrait', 'characters')).toBe('character_portrait');
    for (const table of VISUAL_ENTITY_TABLES) for (const slot of slotsFor(table)) expect(VISUAL_ASSET_TYPE_VALUES).toContain(suggestedTypeForSlot(slot, table));
  });

  it('recognises the R2-not-configured refusal and nothing else', () => {
    expect(isStorageUnavailable(new ApiClientError('capability_unsupported', 'Media storage (Cloudflare R2) is not enabled', 501))).toBe(true);
    expect(isStorageUnavailable(new ApiClientError('conflict', 'duplicate', 409))).toBe(false);
    expect(isStorageUnavailable(new Error('x'))).toBe(false);
  });

  it('clamps unit coordinates', () => {
    expect(clampUnit(1.7)).toBe(1);
    expect(clampUnit(-2)).toBe(0);
    expect(clampUnit(0.33333)).toBe(0.333);
    expect(clampUnit(Number.NaN)).toBe(0);
  });
});
