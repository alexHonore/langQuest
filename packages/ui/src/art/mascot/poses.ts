/**
 * Melo's expression vocabulary — one {@link MascotPose} per contract state (the model
 * sheet in data form). Every state differs by pose and/or prop, never by colour alone,
 * and reads without a caption at 24 px (eye turrets + crest + tail are the silhouette).
 *
 * Independent eyes are the chameleon trait: `gazeL` / `gazeR` (and `eyesL` / `eyesR`,
 * `lidL` / `lidR`) override the shared `gaze` / `eyes` / `lid` per eye.
 */
import type { MascotState } from '@langquest/contracts';
import type { ArmPose, EyeShape, MouthShape, PropKind, TailSpec } from './geometry';

export interface MascotPose {
  /** Both eyes (overridden per eye by `eyesL` / `eyesR`). */
  eyes: EyeShape;
  eyesL?: EyeShape;
  eyesR?: EyeShape;
  /** Pupil offset −1..1 per axis (overridden per eye by `gazeL` / `gazeR`). */
  gaze: readonly [number, number];
  gazeL?: readonly [number, number];
  gazeR?: readonly [number, number];
  /** Lid closure 0..1 (overridden per eye). */
  lid?: number;
  lidL?: number;
  lidR?: number;
  /** Turret scale per eye (1.08 = the eye that "leads"). */
  eyeScaleL?: number;
  eyeScaleR?: number;
  mouth: MouthShape;
  /** Horizontal mouth offset (the small "o" sits off-centre). */
  mouthDx?: number;
  arms: ArmPose;
  tail: TailSpec;
  /** Whole-figure tilt in degrees about (50, 60); positive = clockwise. */
  tilt: number;
  cheeks: boolean;
  prop: PropKind;
  /** Network states: desaturated tint, muted props. Mirrors `MASCOT_STATE_TINTS[state].muted`. */
  muted?: boolean;
}

const TAIL_NEUTRAL: TailSpec = {
  attach: [73, 77],
  startDir: [0.1, 1],
  R: 10,
  turns: 1.45,
  dir: -1,
};

/** The expression vocabulary, one entry per contract state. */
export const MASCOT_POSES: Record<MascotState, MascotPose> = {
  neutral: {
    eyes: 'open',
    gaze: [0, 0],
    mouth: 'smile',
    arms: 'down',
    tail: TAIL_NEUTRAL,
    tilt: 0,
    cheeks: false,
    prop: 'none',
  },
  welcome: {
    eyes: 'wide',
    gaze: [0, -0.1],
    mouth: 'grin',
    arms: 'wave',
    tail: {
      attach: [73, 76],
      startDir: [1, 0.2],
      lead: { c: [88, 72], b: [92, 58] },
      R: 6.5,
      turns: 1.1,
      dir: -1,
    },
    tilt: -4,
    cheeks: true,
    prop: 'sparkle',
  },
  happy: {
    eyes: 'happy',
    gaze: [0, 0],
    mouth: 'grin',
    arms: 'out',
    tail: {
      attach: [73, 75],
      startDir: [1, -0.3],
      lead: { c: [88, 70], b: [92, 60] },
      R: 7,
      turns: 1.2,
      dir: -1,
    },
    tilt: 0,
    cheeks: true,
    prop: 'none',
  },
  curious: {
    eyes: 'open',
    eyesR: 'wide',
    gaze: [0.2, 0],
    gazeR: [1, -0.9],
    eyeScaleR: 1.1,
    mouth: 'o',
    mouthDx: 3,
    arms: 'down',
    tail: {
      attach: [73, 74],
      startDir: [1, -0.6],
      lead: { c: [92, 66], b: [90, 50] },
      R: 5.5,
      turns: 1,
      dir: 1,
    },
    tilt: -8,
    cheeks: false,
    prop: 'sparkle',
  },
  listening: {
    eyes: 'open',
    gaze: [-1, 0.1],
    eyeScaleL: 1.08,
    mouth: 'small',
    arms: 'ear',
    tail: { attach: [73, 77], startDir: [0.1, 1], R: 8.5, turns: 1.9, dir: -1, shrink: 0.82 },
    tilt: 7,
    cheeks: false,
    prop: 'soundIn',
  },
  speaking: {
    eyes: 'open',
    gaze: [0, 0],
    mouth: 'open',
    arms: 'gesture',
    tail: {
      attach: [73, 75],
      startDir: [1, -0.1],
      lead: { c: [86, 72], b: [93, 78] },
      R: 4.5,
      turns: 1,
      dir: 1,
    },
    tilt: 0,
    cheeks: false,
    prop: 'soundOut',
  },
  thinking: {
    eyes: 'open',
    gaze: [0.2, 0.1],
    gazeR: [0.9, -0.9],
    lidL: 0.16,
    mouth: 'o',
    arms: 'chin',
    tail: {
      attach: [73, 74],
      startDir: [1, -0.6],
      lead: { c: [92, 66], b: [88, 46] },
      R: 6,
      turns: 1.1,
      dir: -1,
    },
    tilt: 3,
    cheeks: false,
    prop: 'thoughtBubbles',
  },
  encouraging: {
    eyes: 'open',
    eyesR: 'happy',
    gaze: [0, -0.2],
    mouth: 'grin',
    arms: 'thumbs',
    tail: {
      attach: [73, 75],
      startDir: [1, 0],
      lead: { c: [89, 70], b: [93, 55] },
      R: 6.5,
      turns: 1.15,
      dir: -1,
    },
    tilt: -3,
    cheeks: true,
    prop: 'sparkle',
  },
  try_again: {
    eyes: 'open',
    gaze: [0, 0.1],
    lid: 0.22,
    mouth: 'small',
    arms: 'clasp',
    tail: { attach: [73, 78], startDir: [0.4, 1], R: 9, turns: 1.2, dir: -1 },
    tilt: 4,
    cheeks: false,
    prop: 'replayArrow',
  },
  celebrate: {
    eyes: 'happy',
    gaze: [0, 0],
    mouth: 'grin',
    arms: 'up',
    tail: {
      attach: [73, 74],
      startDir: [1, -0.8],
      lead: { c: [92, 64], b: [86, 42] },
      R: 7,
      turns: 1.3,
      dir: 1,
    },
    tilt: -3,
    cheeks: true,
    prop: 'confetti',
  },
  achievement: {
    eyes: 'wide',
    gaze: [0.3, -0.8],
    mouth: 'grin',
    arms: 'up',
    tail: {
      attach: [73, 74],
      startDir: [1, -0.8],
      lead: { c: [92, 66], b: [88, 48] },
      R: 6,
      turns: 1.25,
      dir: 1,
    },
    tilt: 0,
    cheeks: true,
    prop: 'starMedal',
  },
  quiet_audio: {
    eyes: 'open',
    gaze: [0, 0.3],
    lid: 0.4,
    mouth: 'small',
    arms: 'down',
    tail: { attach: [73, 78], startDir: [0.3, 1], R: 9, turns: 1.4, dir: -1 },
    tilt: 0,
    cheeks: false,
    prop: 'headphones',
  },
  sleep: {
    eyes: 'closed',
    gaze: [0, 0],
    mouth: 'tiny',
    arms: 'hug',
    tail: {
      attach: [73, 78],
      startDir: [0.4, 1],
      lead: { c: [80, 92], b: [88, 88] },
      R: 4.5,
      turns: 1,
      dir: -1,
      wStart: 8,
      wEnd: 2.2,
    },
    tilt: 6,
    cheeks: false,
    prop: 'zzz',
  },
  offline: {
    eyes: 'open',
    gaze: [0.2, 0.9],
    mouth: 'line',
    arms: 'down',
    tail: {
      attach: [73, 78],
      startDir: [0.5, 1],
      lead: { c: [82, 90], b: [90, 84] },
      R: 4,
      turns: 0.9,
      dir: -1,
      wStart: 8,
      wEnd: 2.2,
    },
    tilt: 0,
    cheeks: false,
    prop: 'cloudSlash',
    muted: true,
  },
  connection_error: {
    eyes: 'open',
    gaze: [0.6, -0.4],
    gazeR: [-0.3, 0.3],
    mouth: 'wavy',
    arms: 'out',
    tail: {
      attach: [73, 78],
      startDir: [0.6, 1],
      lead: { c: [84, 88], b: [91, 82] },
      R: 4,
      turns: 0.8,
      dir: -1,
      wStart: 8,
      wEnd: 2.2,
    },
    tilt: -3,
    cheeks: false,
    prop: 'brokenLink',
    muted: true,
  },
  success: {
    eyes: 'happy',
    gaze: [0, 0],
    mouth: 'smile',
    arms: 'thumbs',
    tail: {
      attach: [73, 75],
      startDir: [1, -0.5],
      lead: { c: [90, 66], b: [90, 50] },
      R: 6,
      turns: 1.2,
      dir: -1,
    },
    tilt: 0,
    cheeks: true,
    prop: 'checkBadge',
  },
  gentle_hint: {
    eyes: 'open',
    gaze: [-0.4, -0.3],
    gazeL: [-1, -0.6],
    eyeScaleL: 1.06,
    mouth: 'small',
    arms: 'point',
    tail: {
      attach: [73, 76],
      startDir: [0.8, 0.6],
      lead: { c: [88, 76], b: [92, 64] },
      R: 6,
      turns: 1.3,
      dir: -1,
    },
    tilt: -5,
    cheeks: false,
    prop: 'lightbulb',
  },
};
