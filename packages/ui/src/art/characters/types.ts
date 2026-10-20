/**
 * Types of the character roster and the parametric portrait system.
 *
 * Everything that used to live in `../characters.ts` is re-exported from there unchanged;
 * the new fields (`ageBand`, `genderPresentation`, `regionalOption`, `skinFamily`,
 * `situations`, `intents`, `look.stature`) are additive.
 */
import type { CharacterVisualProfile, CourseTrackId, VarietyId } from '@langquest/contracts';
import type { ClothColorId, HairColorId, SkinToneId } from '../palette';
import type { SituationTag } from './situations';

export type HeadShape = 'round' | 'oval' | 'square' | 'heart' | 'long';
export type HairStyle =
  | 'short'
  | 'buzz'
  | 'curlyShort'
  | 'curlyVolume'
  | 'afro'
  | 'longStraight'
  | 'bob'
  | 'bun'
  | 'braids'
  | 'locs'
  | 'wavyMedium'
  | 'sidePart'
  | 'ponytail'
  | 'headscarf'
  | 'bald'
  | 'pigtails'
  | 'twists'
  | 'cornrows'
  | 'topknot';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'moustache' | 'goatee';
export type Glasses = 'none' | 'round' | 'rect';
export type Earrings = 'none' | 'studs' | 'hoops';
export type Clothing =
  | 'crew'
  | 'collar'
  | 'vneck'
  | 'apron'
  | 'coat'
  | 'hoodie'
  | 'blazer'
  | 'hiVis'
  | 'scarf'
  | 'cardigan'
  | 'scrubs'
  | 'polo'
  | 'turtleneck'
  | 'kurta'
  | 'jersey'
  | 'overalls';
export type Extra =
  | 'cap'
  | 'earbud'
  | 'lanyard'
  | 'pen'
  | 'headband'
  | 'beanie'
  | 'kippah'
  | 'bindi'
  | 'headphones'
  | 'stethoscope'
  | 'tie';
/** Legacy coarse age group kept on `PortraitParams.age` (drives senior lines / young proportions). */
export type AgeGroup = 'young' | 'adult' | 'senior';
/** Casting age band (child 6–11, teen 12–17, adult, elder 65+). */
export type AgeBand = 'child' | 'teen' | 'adult' | 'elder';
export type GenderPresentation = 'feminine' | 'masculine';
/** Coarse skin-tone family used by the diversity invariants (two tones per family). */
export type SkinToneFamily = 'light' | 'medium' | 'brown' | 'deep';
/** Body proportions of the portrait rig. */
export type Stature = 'child' | 'teen' | 'adult';
/** Level of detail of a rendered portrait. */
export type PortraitDetail = 'full' | 'flat';

/** Parametric look of one character (the "model sheet" in data form). */
export interface PortraitParams {
  skin: SkinToneId;
  head: HeadShape;
  hair: HairStyle;
  hairColor: HairColorId;
  facialHair: FacialHair;
  glasses: Glasses;
  earrings: Earrings;
  clothing: Clothing;
  clothColor: ClothColorId;
  clothAccent: ClothColorId;
  /** Background tint for the avatar disc (light theme base; the dark disc is derived). */
  backdrop: string;
  eyeColor: string;
  age: AgeGroup;
  extras: Extra[];
  /** Rig proportions; defaults to the value implied by the age band. */
  stature?: Stature;
  /** A few freckles on the cheeks (children / teens mostly). */
  freckles?: boolean;
}

/** Voice identity notes — no provider voice ids are claimed until a reviewed `CharacterVoiceProfile` exists. */
export interface CharacterVoiceNotes {
  pitch: 'low' | 'mid' | 'high';
  pace: 'relaxed' | 'natural' | 'brisk';
  warmth: 'reserved' | 'warm' | 'bubbly';
  /** Regional option id within the variety (matches `COURSE_TRACKS[].regionalOptions[].id`). */
  regionalOption: string | null;
  notes: string;
}

/** A LangQuest character: contract visual profile + roster metadata. */
export interface LangQuestCharacter extends CharacterVisualProfile {
  /** Stable slug id (`<variety>-<role>-<name>`), used by components and the asset manifest. */
  id: string;
  name: string;
  /** Pronunciation / native-script hint for the name (never used as a label on art). */
  nameNative: string | null;
  role: string;
  city: string;
  region: string;
  varietyId: VarietyId;
  trackIds: CourseTrackId[];
  personality: string;
  lifeContext: string;
  voice: CharacterVoiceNotes;
  look: PortraitParams;
  altText: string;
  /** Casting age band. */
  ageBand: AgeBand;
  genderPresentation: GenderPresentation;
  /** Regional option within the variety (same value as `voice.regionalOption`). */
  regionalOption: string | null;
  /** Derived from `look.skin`; used by the per-track diversity invariants. */
  skinFamily: SkinToneFamily;
  /** Free-text situation tags this character naturally carries (see `CHARACTER_SITUATIONS`). */
  situations: SituationTag[];
  /** Curriculum intent keys (`@langquest/curriculum` `INTENT_KEYS`) derived from the situations. */
  intents: string[];
}
