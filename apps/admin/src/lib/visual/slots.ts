/**
 * §10.2A assignment slots for visual assets. Mirrors the API's `VISUAL_SLOT_TARGETS`
 * (`@langquest/db/repositories/visual-assets`): the server is the authority and rejects an
 * invalid (table, slot) pair with `validation_failed`; the map here only drives the pickers.
 */
import type { ContentOrigin, VisualAssetAssignmentTarget, VisualAssetRegisterRequest, VisualAssetType } from '@langquest/contracts';
import { ApiClientError } from '../api';

// The contracts export the schemas (`VisualAssetEntityTableSchema`, `VisualAssetSlotSchema`, `CropRectSchema`)
// but not these inferred types; derive them from the exported request types (cross-package note).
export type VisualAssetEntityTable = VisualAssetAssignmentTarget['entityTable'];
export type VisualAssetSlot = VisualAssetAssignmentTarget['slot'];
export type CropRect = NonNullable<VisualAssetRegisterRequest['crop']>;

export const VISUAL_SLOTS_BY_TABLE: Readonly<Record<VisualAssetEntityTable, readonly VisualAssetSlot[]>> = {
  audio_course_collections: ['cover'],
  audio_chapters: ['cover'],
  audio_lessons: ['cover'],
  lesson_courses: ['cover'],
  chapters: ['cover', 'map'],
  characters: ['portrait'],
  missions: ['scene', 'context_object', 'story_panel', 'celebration', 'map'],
};

export const VISUAL_ENTITY_TABLES = Object.keys(VISUAL_SLOTS_BY_TABLE) as VisualAssetEntityTable[];

/** Tables whose rows the Studio can pick from a list (audio library); the others take a pasted uuid. */
export const PICKABLE_ENTITY_TABLES: readonly VisualAssetEntityTable[] = ['audio_course_collections', 'audio_chapters', 'audio_lessons'];

export function slotsFor(table: VisualAssetEntityTable): readonly VisualAssetSlot[] {
  return VISUAL_SLOTS_BY_TABLE[table] ?? [];
}

/** Default `visual_assets.type` for a slot (editors can still override). */
export function suggestedTypeForSlot(slot: VisualAssetSlot, table: VisualAssetEntityTable): VisualAssetType {
  switch (slot) {
    case 'cover':
      return table.startsWith('audio_') ? 'audio_cover' : 'course_cover';
    case 'map':
      return 'map_region';
    case 'portrait':
      return 'character_portrait';
    case 'scene':
      return 'mission_scene';
    case 'context_object':
      return 'context_object';
    case 'story_panel':
      return 'story_panel';
    case 'celebration':
      return 'celebration';
  }
}

/** Origins an editor can declare for an uploaded file (in-code vectors / voices are not uploads). */
export const UPLOAD_ORIGINS: readonly ContentOrigin[] = ['original_upload', 'licensed_stock', 'open_license', 'ai_generated', 'public_dataset'];

/**
 * True when the API refused because media storage (Cloudflare R2) is not enabled on that
 * deployment (`capability_unsupported` from upload-initiate / register). The screen then shows
 * the server's own message instead of pretending the upload is possible.
 */
export function isStorageUnavailable(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.code === 'capability_unsupported';
}

/** Clamp a focal point / crop coordinate into the unit interval with 3-decimal precision. */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}
