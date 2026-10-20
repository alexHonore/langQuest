/**
 * Studio theme = the shared `@langquest/ui` tokens ("Night Market", U2) expressed as CSS
 * variables. Light is the default for a work tool; dark is the same token set. Nothing in
 * the admin hard-codes a colour: every Tailwind utility (`bg-surface`, `text-accent-text`, …)
 * maps onto a variable emitted here, so the direction can be swapped by editing the tokens
 * package alone.
 *
 * The lantern / accent family follows the active course (and, where known, the lesson) through
 * `courseAccentVars` — the same `resolveAccents` the learner apps use, so the Studio wears the
 * course's light while text stays WCAG AA (the tokens tune `primaryText` / `onPrimary`).
 */
import { COLOR_PALETTES, resolveAccents, type ColorTokens, type PaletteName } from '@langquest/ui/tokens';

export type AdminScheme = 'light' | 'dark';
export type SchemePreference = AdminScheme | 'system';
export const SCHEME_STORAGE_KEY = 'lq_admin_theme';
export const SCHEME_PREFERENCES: readonly SchemePreference[] = ['light', 'dark', 'system'];
export const DEFAULT_SCHEME_PREFERENCE: SchemePreference = 'light';

export const isSchemePreference = (value: unknown): value is SchemePreference =>
  typeof value === 'string' && (SCHEME_PREFERENCES as readonly string[]).includes(value);

/** CSS variable → semantic token (scalar tokens only). */
const SCALAR_VARS = {
  '--bg': 'background',
  '--surface': 'surface',
  '--elevated': 'elevated',
  '--surface-muted': 'surfaceMuted',
  '--fg': 'textPrimary',
  '--fg-secondary': 'textSecondary',
  '--fg-muted': 'textMuted',
  '--on-accent': 'onAccent',
  '--accent': 'accent',
  '--accent-strong': 'accentStrong',
  '--accent-soft': 'accentSoft',
  '--accent-text': 'accentText',
  '--amber': 'amber',
  '--amber-text': 'amberText',
  '--on-amber': 'onAmber',
  '--cyan': 'cyan',
  '--cyan-text': 'cyanText',
  '--on-cyan': 'onCyan',
  '--success': 'success',
  '--success-soft': 'successSoft',
  '--warning': 'warning',
  '--warning-soft': 'warningSoft',
  '--error': 'error',
  '--error-soft': 'errorSoft',
  '--info': 'info',
  '--info-soft': 'infoSoft',
  '--border': 'border',
  '--border-strong': 'borderStrong',
  '--focus': 'focusRing',
  '--overlay': 'overlay',
  '--scene-scrim': 'sceneScrim',
} as const satisfies Record<string, keyof ColorTokens>;

export type ThemeVarName = keyof typeof SCALAR_VARS | '--lantern-1' | '--lantern-2' | '--lantern-3' | '--lantern-opacity' | '--glass-fill' | '--glass-border' | '--glass-solid';

/** Every CSS variable of a palette, as `{ '--bg': '#…', … }`. */
export function paletteVars(scheme: AdminScheme): Record<ThemeVarName, string> {
  const p = COLOR_PALETTES[scheme];
  const out = {} as Record<ThemeVarName, string>;
  for (const [cssVar, token] of Object.entries(SCALAR_VARS) as [keyof typeof SCALAR_VARS, keyof ColorTokens][]) {
    out[cssVar] = p[token] as string;
  }
  out['--lantern-1'] = p.lantern[0];
  out['--lantern-2'] = p.lantern[1];
  out['--lantern-3'] = p.lantern[2];
  out['--lantern-opacity'] = scheme === 'dark' ? '0.3' : '0.18';
  out['--glass-fill'] = p.glass.fill;
  out['--glass-border'] = p.glass.border;
  out['--glass-solid'] = p.glass.solid;
  return out;
}

function block(selector: string, vars: Record<string, string>, extra = ''): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
  return `${selector}{${body}${extra}}`;
}

/**
 * The `<style>` text injected by the root layout: light on `:root`, dark on
 * `:root[data-theme='dark']` (the no-flash script resolves `system` to one of the two).
 */
export function themeCss(): string {
  return [
    block(':root', paletteVars('light'), 'color-scheme:light;'),
    block(":root[data-theme='dark']", paletteVars('dark'), 'color-scheme:dark;'),
  ].join('\n');
}

export type CourseAccentVarName =
  | '--accent'
  | '--accent-strong'
  | '--accent-soft'
  | '--accent-text'
  | '--on-accent'
  | '--lantern-1'
  | '--lantern-2'
  | '--lantern-3'
  | '--lantern-opacity'
  | '--course-ring';

/**
 * Accent family for the active course × lesson, as CSS variables to set on a container
 * (the shell root): primary buttons, links, selected rows and the lanterns then follow the
 * course like a chameleon. No track → the direction's default lanterns, unchanged.
 */
export function courseAccentVars(trackId: string | null | undefined, lessonKey: string | null | undefined, scheme: AdminScheme): Record<CourseAccentVarName, string> {
  const a = resolveAccents(trackId, lessonKey, { scheme: scheme satisfies PaletteName });
  return {
    '--accent': a.primary,
    '--accent-strong': a.primaryStrong,
    '--accent-soft': a.primarySoft,
    '--accent-text': a.primaryText,
    '--on-accent': a.onPrimary,
    '--lantern-1': a.lantern[0],
    '--lantern-2': a.lantern[1],
    '--lantern-3': a.lantern[2],
    '--lantern-opacity': String(a.lanternOpacity),
    '--course-ring': a.ring,
  };
}

/** Inline script that applies the stored preference before first paint (no theme flash). */
export const SCHEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(SCHEME_STORAGE_KEY)});var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;
