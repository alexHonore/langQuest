/**
 * Expression vocabulary of the portrait rig — the 9 contract expressions as
 * brows + eyes + mouth + head tilt + (optional) hand. Following the C2 style rule,
 * an expression never changes colour, so every state reads in grayscale and at 24 px.
 */
import { CHARACTER_EXPRESSION_VALUES, type CharacterExpression } from '@langquest/contracts';

/** The 9 required lead-character expressions, in contract order. */
export const CHARACTER_EXPRESSIONS: readonly CharacterExpression[] = CHARACTER_EXPRESSION_VALUES;

export type PEyes = 'open' | 'happy' | 'wide' | 'side' | 'half';
export type PBrows = 'neutral' | 'raised' | 'raisedOne' | 'furrowed' | 'soft';
export type PMouth =
  'closedSmile' | 'smile' | 'open' | 'wideOpen' | 'o' | 'wavy' | 'grin' | 'flat' | 'ee';
export type PHand = 'none' | 'wave' | 'chin';

export interface ExpressionPose {
  eyes: PEyes;
  brows: PBrows;
  mouth: PMouth;
  tilt: number;
  hand: PHand;
  blush: boolean;
  gaze: readonly [number, number];
}

/** Expression vocabulary for lead characters. */
export const CHARACTER_EXPRESSION_POSES: Record<CharacterExpression, ExpressionPose> = {
  neutral: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'closedSmile',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
  greeting: {
    eyes: 'open',
    brows: 'raised',
    mouth: 'smile',
    tilt: -3,
    hand: 'wave',
    blush: true,
    gaze: [0, 0],
  },
  listening: {
    eyes: 'side',
    brows: 'soft',
    mouth: 'closedSmile',
    tilt: 6,
    hand: 'none',
    blush: false,
    gaze: [-1, 0],
  },
  talking: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'open',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
  surprise: {
    eyes: 'wide',
    brows: 'raised',
    mouth: 'o',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, -0.3],
  },
  confusion: {
    eyes: 'open',
    brows: 'raisedOne',
    mouth: 'wavy',
    tilt: 4,
    hand: 'chin',
    blush: false,
    gaze: [0.8, -0.4],
  },
  friendly_success: {
    eyes: 'happy',
    brows: 'soft',
    mouth: 'grin',
    tilt: -2,
    hand: 'none',
    blush: true,
    gaze: [0, 0],
  },
  follow_up_question: {
    eyes: 'open',
    brows: 'raisedOne',
    mouth: 'smile',
    tilt: -5,
    hand: 'none',
    blush: false,
    gaze: [0.6, 0],
  },
  /** Alternate "ee" mouth used as the second lip-sync frame (talking = open vowel). */
  lip_sync: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'ee',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
};

/** Accessible description of each expression (appended to the character name). */
export const EXPRESSION_LABELS: Record<CharacterExpression, string> = {
  neutral: 'neutral',
  greeting: 'waving hello',
  listening: 'listening',
  talking: 'talking',
  surprise: 'surprised',
  confusion: 'puzzled',
  friendly_success: 'smiling, pleased',
  follow_up_question: 'asking a follow-up question',
  lip_sync: 'mid-word',
};
