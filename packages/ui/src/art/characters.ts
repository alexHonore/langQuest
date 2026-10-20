/**
 * Recurring conversational characters (§10.2A) — an original roster of native-speaking
 * interlocutors plus the parametric clay portrait generator (C2 "soft dimensional",
 * owner-approved 2026-10-19) that renders every character in the 9 required expressions.
 *
 * This module is the stable public surface; the implementation lives under
 * `./characters/`:
 *  - `types.ts`        roster + rig types
 *  - `uuid.ts`         deterministic character uuids (shared with `@langquest/db`)
 *  - `expressions.ts`  the 9 expression poses
 *  - `clay.ts`         the C2 recipe helpers (gradients, rim light, specular, shadows)
 *  - `portrait.ts`     the rig, with a flat level of detail at ≤ 48 px
 *  - `situations.ts`   situation tags ↔ curriculum intents
 *  - `cast.ts`         casting-sheet builder
 *  - `roster.ts` + `roster/*` the 97-character cast
 *
 * Characters are fictional; names/looks are not based on real people or existing
 * franchises. Clothing is contemporary (no costumes, flags or logos). Each character is
 * bound to ONE language variety and never substituted across variety boundaries.
 *
 * Coordinate space: 120 × 120 viewBox, clean circular background for avatars.
 */
import type { CharacterExpression } from '@langquest/contracts';
import type { ArtTheme } from './palette';
import type { SvgDocument, SvgNode } from './svg-node';
import {
  type PortraitRenderOptions,
  buildPortraitDocument,
  buildPortraitNodes,
  portraitLabel,
  portraitSvgString,
} from './characters/portrait';
import { findCharacter } from './characters/roster';

export type {
  AgeBand,
  AgeGroup,
  CharacterVoiceNotes,
  Clothing,
  Earrings,
  Extra,
  FacialHair,
  GenderPresentation,
  Glasses,
  HairStyle,
  HeadShape,
  LangQuestCharacter,
  PortraitDetail,
  PortraitParams,
  SkinToneFamily,
  Stature,
} from './characters/types';
export {
  CHARACTER_UUID_NAMESPACE,
  CHARACTER_UUID_NAME_PREFIX,
  characterKey,
  stableCharacterUuid,
  uuidV5,
} from './characters/uuid';
export {
  CHARACTER_EXPRESSIONS,
  CHARACTER_EXPRESSION_POSES,
  EXPRESSION_LABELS,
} from './characters/expressions';
export type { ExpressionPose, PBrows, PEyes, PHand, PMouth } from './characters/expressions';
export {
  CHARACTER_SITUATIONS,
  SITUATION_TAGS,
  intentsForSituations,
  isSituationTag,
  situationFitsAge,
} from './characters/situations';
export type {
  CharacterSituation,
  CurriculumIntentKey,
  SituationTag,
} from './characters/situations';
export { CHARACTER_STYLE_VERSION, DISC_TINTS, cast, skinToneFamily } from './characters/cast';
export type { CastSheet } from './characters/cast';
export {
  CHARACTER_ROSTER,
  LEGACY_ROSTER_IDS,
  castMatchesMission,
  charactersForIntent,
  charactersForMission,
  charactersForSituation,
  charactersForTrack,
  charactersForVariety,
  findCharacter,
  missionIntentKeys,
  missionIntentsCovered,
} from './characters/roster';
export type { CharacterRef } from './characters/roster';
export {
  PORTRAIT_FLAT_MAX_SIZE,
  PORTRAIT_VIEWBOX,
  portraitDetailForSize,
} from './characters/portrait';
export type { PortraitRenderOptions } from './characters/portrait';
export {
  ClayContext,
  KEY_LIGHT,
  RIM_COLOR,
  RIM_OPACITY,
  SHADOW_INK,
  mix,
  specular,
} from './characters/clay';
export type { ClayMaterial } from './characters/clay';

function requireCharacter(characterId: string) {
  const c = findCharacter(characterId);
  if (!c) throw new Error(`Unknown character: ${characterId}`);
  return c;
}

/**
 * Build the portrait node tree for a character × expression.
 * `opts.size` (or an explicit `opts.detail`) selects the level of detail: ≤ 48 px renders
 * the flat two-value version for list thumbnails.
 */
export function buildCharacterPortraitNodes(
  characterId: string,
  expression: CharacterExpression,
  opts: PortraitRenderOptions = {},
): SvgNode[] {
  return buildPortraitNodes(requireCharacter(characterId), expression, opts);
}

/** Accessible label for a portrait (expression appended for assistive tech). */
export function characterPortraitLabel(
  characterId: string,
  expression: CharacterExpression,
): string {
  const c = findCharacter(characterId);
  return portraitLabel(c ? c.name : characterId, expression);
}

/** Full document description for a portrait (level of detail follows `size`). */
export function buildCharacterPortraitDocument(
  characterId: string,
  expression: CharacterExpression,
  opts: { size?: number; theme?: ArtTheme; detail?: 'full' | 'flat' } = {},
): SvgDocument {
  return buildPortraitDocument(requireCharacter(characterId), expression, opts);
}

/** Standalone `<svg>` markup for a character portrait. */
export function characterPortraitSvgString(
  characterId: string,
  expression: CharacterExpression,
  opts: { size?: number; theme?: ArtTheme; detail?: 'full' | 'flat' } = {},
): string {
  return portraitSvgString(requireCharacter(characterId), expression, opts);
}
