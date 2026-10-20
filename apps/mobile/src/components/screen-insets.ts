/**
 * Safe-area padding for the learner `Screen` shell (pure; no React Native import so it is unit-tested).
 *
 * Every screen owns its TOP inset: the root stack and the learner tabs both run with `headerShown: false`,
 * so nothing above the screen pads for the status bar / Dynamic Island. (Before 2026-10-20 tab screens
 * skipped it, which only looked right on web where the inset is 0; on iPhone the course header was drawn
 * under the clock — docs/evidence/device-qa-2026-10-19.md.) The BOTTOM inset belongs to whoever draws the
 * bottom edge: the tab bar inside the tabs, a screen footer elsewhere, nothing otherwise (content scrolls).
 */
export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ScreenInsetOptions {
  /** Rendered inside the learner tab navigator (its tab bar pads the bottom edge). */
  insideTabs?: boolean;
  /** The screen draws a footer, which sits on the bottom edge. */
  hasFooter?: boolean;
}

export function screenInsets(safe: EdgeInsets, options: ScreenInsetOptions = {}): EdgeInsets {
  return {
    top: safe.top,
    bottom: options.hasFooter && !options.insideTabs ? safe.bottom : 0,
    left: safe.left,
    right: safe.right,
  };
}
