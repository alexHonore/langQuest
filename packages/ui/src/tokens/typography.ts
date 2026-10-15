/**
 * Typography scale with script-aware font stacks. System fonts only (no
 * bundled commercial fonts). Scripts with tall ascenders/descenders or dense
 * glyphs (Devanagari, Arabic, Hangul, CJK) get larger line-heights and a small
 * size adjustment so they stay legible at the same nominal size as Latin.
 */
import type { ScriptId } from '@langquest/contracts';

export interface ScriptTypography {
  /** Ordered system font families (web `font-family` list / first installed on native). */
  fontStack: readonly string[];
  /** Line-height multiplier applied to the role's font size. */
  lineHeight: number;
  /** Multiplier applied to the role's font size (1 = Latin baseline). */
  sizeAdjust: number;
  /** Text direction of the script. */
  direction: 'ltr' | 'rtl';
}

const SYSTEM_SANS: readonly string[] = [
  'System',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];

export const SCRIPT_TYPOGRAPHY: Readonly<Record<ScriptId, ScriptTypography>> = {
  Latn: { fontStack: SYSTEM_SANS, lineHeight: 1.4, sizeAdjust: 1, direction: 'ltr' },
  Cyrl: { fontStack: SYSTEM_SANS, lineHeight: 1.45, sizeAdjust: 1, direction: 'ltr' },
  Grek: { fontStack: SYSTEM_SANS, lineHeight: 1.45, sizeAdjust: 1, direction: 'ltr' },
  Arab: {
    fontStack: [
      'Geeza Pro',
      'Noto Naskh Arabic',
      'Noto Sans Arabic',
      'Segoe UI',
      'Tahoma',
      'Arial',
      'sans-serif',
    ],
    lineHeight: 1.75,
    sizeAdjust: 1.1,
    direction: 'rtl',
  },
  Hebr: {
    fontStack: ['Arial Hebrew', 'Noto Sans Hebrew', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
    lineHeight: 1.55,
    sizeAdjust: 1.05,
    direction: 'rtl',
  },
  Deva: {
    fontStack: [
      'Kohinoor Devanagari',
      'Devanagari Sangam MN',
      'Noto Sans Devanagari',
      'Nirmala UI',
      'Mangal',
      'sans-serif',
    ],
    lineHeight: 1.75,
    sizeAdjust: 1.05,
    direction: 'ltr',
  },
  Hans: {
    fontStack: [
      'PingFang SC',
      'Hiragino Sans GB',
      'Noto Sans CJK SC',
      'Noto Sans SC',
      'Microsoft YaHei',
      'sans-serif',
    ],
    lineHeight: 1.65,
    sizeAdjust: 1.05,
    direction: 'ltr',
  },
  Hant: {
    fontStack: [
      'PingFang HK',
      'PingFang TC',
      'Noto Sans CJK TC',
      'Noto Sans HK',
      'Microsoft JhengHei',
      'sans-serif',
    ],
    lineHeight: 1.65,
    sizeAdjust: 1.05,
    direction: 'ltr',
  },
  Jpan: {
    fontStack: [
      'Hiragino Sans',
      'Hiragino Kaku Gothic ProN',
      'Noto Sans CJK JP',
      'Noto Sans JP',
      'Yu Gothic',
      'Meiryo',
      'sans-serif',
    ],
    lineHeight: 1.7,
    sizeAdjust: 1.05,
    direction: 'ltr',
  },
  Kore: {
    fontStack: [
      'Apple SD Gothic Neo',
      'Noto Sans CJK KR',
      'Noto Sans KR',
      'Malgun Gothic',
      'sans-serif',
    ],
    lineHeight: 1.6,
    sizeAdjust: 1,
    direction: 'ltr',
  },
};

/** Scripts that need more vertical room than Latin (used by tests and layout maths). */
export const TALL_SCRIPTS: readonly ScriptId[] = ['Arab', 'Deva', 'Hans', 'Hant', 'Jpan', 'Kore'];

export type FontWeight = '400' | '500' | '600' | '700';

export interface TypeRole {
  fontSize: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  /** Line-height multiplier for Latin; scripts override via `SCRIPT_TYPOGRAPHY`. */
  lineHeight: number;
}

/**
 * Type roles. `phrase` is the large target-language phrase in speaking /
 * pronunciation screens; `scriptSample` is the native-script sample on course tiles.
 */
export const TYPE_ROLES = {
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -0.4, lineHeight: 1.2 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.2, lineHeight: 1.25 },
  heading: { fontSize: 20, fontWeight: '600', letterSpacing: 0, lineHeight: 1.3 },
  subheading: { fontSize: 17, fontWeight: '600', letterSpacing: 0, lineHeight: 1.35 },
  bodyLarge: { fontSize: 18, fontWeight: '400', letterSpacing: 0, lineHeight: 1.45 },
  body: { fontSize: 16, fontWeight: '400', letterSpacing: 0, lineHeight: 1.45 },
  label: { fontSize: 14, fontWeight: '500', letterSpacing: 0.1, lineHeight: 1.35 },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0.2, lineHeight: 1.35 },
  phrase: { fontSize: 28, fontWeight: '600', letterSpacing: 0, lineHeight: 1.35 },
  transliteration: { fontSize: 16, fontWeight: '400', letterSpacing: 0.2, lineHeight: 1.4 },
  scriptSample: { fontSize: 22, fontWeight: '500', letterSpacing: 0, lineHeight: 1.3 },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof TYPE_ROLES;

/** Text scale bounds mirror `AccessibilityOptionsSchema.text_scale` (0.8 .. 2). */
export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 2;

export const clampTextScale = (scale: number): number =>
  Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Number.isFinite(scale) ? scale : 1));

export interface ResolvedTextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  /** Set only when the script needs a non-default family on native. */
  fontFamily?: string;
  /** Full stack for web (`font-family`). */
  fontFamilyCss: string;
  writingDirection: 'ltr' | 'rtl';
}

/** CSS `font-family` list for a script (families with spaces quoted). */
export function fontFamilyCss(script: ScriptId = 'Latn'): string {
  return SCRIPT_TYPOGRAPHY[script].fontStack.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');
}

/**
 * Resolve a role into concrete numbers for a script and text scale.
 * Line-height is rounded to whole pixels (RN requires absolute line heights).
 */
export function resolveTextStyle(
  role: TypeRoleName,
  options: { script?: ScriptId; textScale?: number } = {},
): ResolvedTextStyle {
  const base = TYPE_ROLES[role];
  const script = options.script ?? 'Latn';
  const meta = SCRIPT_TYPOGRAPHY[script];
  const scale = clampTextScale(options.textScale ?? 1);
  const fontSize = Math.round(base.fontSize * meta.sizeAdjust * scale * 2) / 2;
  const multiplier = Math.max(base.lineHeight, meta.lineHeight);
  const style: ResolvedTextStyle = {
    fontSize,
    lineHeight: Math.ceil(fontSize * multiplier),
    fontWeight: base.fontWeight,
    letterSpacing: base.letterSpacing,
    fontFamilyCss: fontFamilyCss(script),
    writingDirection: meta.direction,
  };
  if (script !== 'Latn' && script !== 'Cyrl' && script !== 'Grek') {
    // Let the OS pick its best installed family for the script (first entry is the platform default).
    style.fontFamily = meta.fontStack[0];
  }
  return style;
}
