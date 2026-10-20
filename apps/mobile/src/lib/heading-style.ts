/**
 * Layout style for display / title headings (pure, shared by the onboarding frame and the hero
 * screens). A heading is a flex child of a column (often centred with `alignItems: 'center'`); it
 * must never get a fixed width or a single-line constraint, and it must be allowed to shrink and
 * span the column so long translations ("Parlez dès le premier jour" at 375–430 px) wrap instead
 * of clipping. `tests`: `heading-style.test.ts`.
 */
import type { TextStyle } from 'react-native';

export const HEADING_WRAP_STYLE: Readonly<TextStyle> = Object.freeze({
  alignSelf: 'stretch',
  flexShrink: 1,
  maxWidth: '100%',
});

/** Keys a wrapping heading must not carry (a fixed box or a no-wrap constraint). */
export const HEADING_FORBIDDEN_STYLE_KEYS: readonly (keyof TextStyle)[] = ['width', 'minWidth', 'height', 'flexWrap'];

/** True when a style lets a heading wrap: shrinkable, stretched across its column, no fixed width. */
export function headingCanWrap(style: TextStyle | null | undefined): boolean {
  if (!style) return false;
  if (HEADING_FORBIDDEN_STYLE_KEYS.some((k) => style[k] !== undefined)) return false;
  return (style.flexShrink ?? 0) > 0 && style.alignSelf === 'stretch';
}
