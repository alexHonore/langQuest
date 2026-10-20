/**
 * Lesson screen fit (owner feedback 2026-10-20, device QA): a lesson / exercise page must always fit the
 * phone — no vertical or horizontal overflow, no scrolling to reach the options or "next". The fixed parts
 * (progress, phrase card, action zone, next) keep their natural size; the scene takes whatever height is
 * left, measured at runtime, and disappears when too little is left. Choice questions show at most
 * `MAX_CHOICE_OPTIONS` answers so the action zone stays bounded on a 667 pt phone.
 */

/** A scene shorter than this reads as a strip, not a place: hide it and give the room to the exercise. */
export const MIN_SCENE_HEIGHT = 72;
/** Never taller than a 16:9 band of the screen width (the illustrations are composed for that ratio). */
export const MAX_SCENE_ASPECT = 16 / 9;
/** Answer + three distractors. */
export const MAX_CHOICE_OPTIONS = 4;

export interface SceneFit {
  visible: boolean;
  /** Height to draw the scene at (0 when hidden). */
  height: number;
}

/** Fit the scene into the measured free box (`width` × `available`). */
export function fitScene(width: number, available: number): SceneFit {
  if (!(width > 0) || !(available >= MIN_SCENE_HEIGHT)) return { visible: false, height: 0 };
  const height = Math.floor(Math.min(available, width / MAX_SCENE_ASPECT));
  return height >= MIN_SCENE_HEIGHT ? { visible: true, height } : { visible: false, height: 0 };
}

export interface ChoiceOption {
  id: string;
  label: string;
}

/** Deterministic 32-bit FNV-1a, so an option order is stable across renders and devices. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Choice options for one step: the correct answer plus up to `max - 1` distractors, in an order that is
 * stable for the step (seeded by `seed`, e.g. the step id) but not "always first". Before this the correct
 * answer was always option 1 and every expression of the step was listed (8 rows on device).
 */
export function pickChoiceOptions(all: readonly ChoiceOption[], correctId: string | null, seed: string, max: number = MAX_CHOICE_OPTIONS): ChoiceOption[] {
  const correct = all.find((o) => o.id === correctId) ?? null;
  const distractors = all.filter((o) => o.id !== correctId && o.label.trim().length > 0 && o.label !== correct?.label);
  const rankedDistractors = [...distractors].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`)).slice(0, Math.max(0, max - (correct ? 1 : 0)));
  const chosen = correct ? [correct, ...rankedDistractors] : rankedDistractors;
  return chosen.sort((a, b) => hash(`${seed}#${a.id}`) - hash(`${seed}#${b.id}`));
}
