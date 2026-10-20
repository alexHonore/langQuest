/**
 * React Native renderers — turn the shared {@link SvgNode} trees into
 * react-native-svg elements. Only this file imports react-native-svg, so the
 * string renderers and the export script run in plain Node.
 */
import type { CharacterExpression, MascotState } from '@langquest/contracts';
import React, { useEffect, useState } from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { buildCharacterPortraitDocument } from './characters';
import { buildCoverDocument } from './covers';
import { ICON_NAMES, type IconName, buildIconDocument } from './icons';
import { type CourseFamilyId, type MascotTint, buildMascotDocument } from './mascot';
import type { ArtTheme } from './palette';
import { type SceneId, type SceneVariant, buildSceneDocument } from './scenes';
import type { SvgDocument, SvgNode, SvgTag } from './svg-node';
import { useTheme } from '../theme/ThemeProvider';

type AnyComponent = React.ComponentType<Record<string, unknown>>;

const TAG_COMPONENTS: Record<SvgTag, AnyComponent> = {
  g: G as AnyComponent,
  circle: Circle as AnyComponent,
  ellipse: Ellipse as AnyComponent,
  path: Path as AnyComponent,
  rect: Rect as AnyComponent,
  line: Line as AnyComponent,
  polyline: Polyline as AnyComponent,
  polygon: Polygon as AnyComponent,
  defs: Defs as AnyComponent,
  linearGradient: LinearGradient as AnyComponent,
  radialGradient: RadialGradient as AnyComponent,
  stop: Stop as AnyComponent,
  clipPath: ClipPath as AnyComponent,
};

/** Render one node (and its subtree) as react-native-svg elements. */
export function renderSvgNode(node: SvgNode, key: string | number): React.ReactElement {
  const Component = TAG_COMPONENTS[node.tag];
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v !== undefined) props[k] = v;
  }
  const children = node.children
    ? node.children.map((child, i) => renderSvgNode(child, i))
    : undefined;
  return React.createElement(Component, props, children);
}

/**
 * True when rendering into a browser DOM (Expo web / react-native-web). Detected from the runtime
 * rather than `Platform` so this module keeps `react-native-svg` as its only React Native import
 * (the string renderers, the export script and the Node tests load it without the RN runtime).
 */
const isWebDom = (): boolean =>
  typeof document !== 'undefined' && typeof document.createElement === 'function';

/**
 * Accessibility props for the `<Svg>` root, chosen per platform. On web react-native-svg forwards
 * unknown props to the DOM `<svg>`, where `accessible={true}` is an invalid attribute (React warns
 * "Received `true` for a non-boolean attribute"), so the root gets `role="img"` + `aria-label` there
 * and the React Native trio (`accessible`, `accessibilityRole`, `accessibilityLabel`) elsewhere.
 */
export function svgAccessibilityProps(label: string): Record<string, unknown> {
  if (isWebDom()) return { role: 'img', 'aria-label': label };
  return { accessible: true, accessibilityRole: 'image', accessibilityLabel: label };
}

/** Render a whole document inside an accessible `<Svg>` root. */
export function renderSvgDocument(doc: SvgDocument, label?: string): React.JSX.Element {
  const { x, y, width, height } = doc.viewBox;
  const a11y = svgAccessibilityProps(label ?? doc.label);
  return (
    <Svg width={doc.width} height={doc.height} viewBox={`${x} ${y} ${width} ${height}`} {...a11y}>
      {doc.children.map((n, i) => renderSvgNode(n, i))}
    </Svg>
  );
}

/* --------------------------------------------------------------- Mascot --- */

export interface MascotSvgProps {
  state: MascotState;
  size?: number;
  theme?: ArtTheme;
  /** Disables every animation hook (also honoured when the OS reduce-motion setting is on). */
  reducedMotion?: boolean;
  accessibilityLabel?: string;
  /** Opt-in subtle idle animation (breathing + occasional blink). Static by default. */
  animate?: boolean;
  /** Explicit chameleon tint (wins over `courseFamily` / `trackId`). Default: the state's tint. */
  tint?: MascotTint;
  /** Course family for the chameleon tint dial (wins over `trackId`). */
  courseFamily?: CourseFamilyId | string | null;
  /** Course track id for the chameleon tint dial (`COURSE_TRACK_IDS`). */
  trackId?: string | null;
}

type MascotTintProps = Pick<MascotSvgProps, 'tint' | 'courseFamily' | 'trackId'>;

/** Idle loop (breathing + occasional blink + one-eye scan). Only mounted when animation is requested and allowed. */
function AnimatedMascot(
  props: {
    state: MascotState;
    size: number;
    theme: ArtTheme;
    accessibilityLabel?: string;
  } & MascotTintProps,
): React.JSX.Element {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 400), 100);
    return () => clearInterval(id);
  }, []);
  const breath = Math.sin((phase / 400) * Math.PI * 2 * 10); // ~4 s cycle
  const blinkTick = phase % 40; // every ~4 s
  const blink = blinkTick >= 37 ? (blinkTick === 38 ? 1 : 0.6) : 0;
  // Chameleon scan: every ~7 s the left eye drifts for ~1 s, then snaps back.
  const scanTick = phase % 70;
  const gazeL = scanTick >= 60 && scanTick < 69 ? ([0.6, 0] as const) : undefined;
  return renderSvgDocument(
    buildMascotDocument(props.state, {
      size: props.size,
      theme: props.theme,
      blink,
      breath,
      gazeL,
      tint: props.tint,
      courseFamily: props.courseFamily,
      trackId: props.trackId,
    }),
    props.accessibilityLabel,
  );
}

/**
 * Melo, the original chameleon mascot, in one of the 17 contract states.
 * Static by default (no hooks, no timers); `animate` enables a gentle idle loop
 * unless `reducedMotion` is set. `tint` / `courseFamily` / `trackId` drive the
 * chameleon colour (default: the state's own tint).
 */
export function MascotSvg(props: MascotSvgProps): React.JSX.Element {
  const {
    state,
    size = 96,
    theme = 'light',
    reducedMotion = false,
    accessibilityLabel,
    animate = false,
    tint,
    courseFamily,
    trackId,
  } = props;
  if (animate && !reducedMotion) {
    return (
      <AnimatedMascot
        state={state}
        size={size}
        theme={theme}
        accessibilityLabel={accessibilityLabel}
        tint={tint}
        courseFamily={courseFamily}
        trackId={trackId}
      />
    );
  }
  return renderSvgDocument(
    buildMascotDocument(state, { size, theme, tint, courseFamily, trackId }),
    accessibilityLabel,
  );
}

/* ----------------------------------------------------------- Characters --- */

export interface CharacterPortraitSvgProps {
  characterId: string;
  expression: CharacterExpression;
  size?: number;
  theme?: ArtTheme;
}

/** Portrait of a roster character in one of the 9 required expressions. */
export function CharacterPortraitSvg(props: CharacterPortraitSvgProps): React.JSX.Element {
  const { characterId, expression, size = 120, theme = 'light' } = props;
  return renderSvgDocument(
    buildCharacterPortraitDocument(characterId, expression, { size, theme }),
  );
}

/* --------------------------------------------------------------- Scenes --- */

export interface SceneArtSvgProps {
  sceneId: SceneId;
  width?: number;
  height?: number;
  theme?: ArtTheme;
  variant?: SceneVariant;
}

/** Layered 16:9 scene environment with an uncluttered centre. */
export function SceneArtSvg(props: SceneArtSvgProps): React.JSX.Element {
  const { sceneId, width = 320, height, theme = 'light', variant = 'day' } = props;
  return renderSvgDocument(buildSceneDocument(sceneId, { width, height, theme, variant }));
}

/* --------------------------------------------------------------- Covers --- */

export interface CourseCoverSvgProps {
  trackId: string;
  width?: number;
  height?: number;
  /** Localized alt text (`t(coverAltTextKey(trackId))`); English catalog name by default. */
  altText?: string;
}

/** Abstract 3:2 course cover; the UI renders the track name on top. */
export function CourseCoverSvg(props: CourseCoverSvgProps): React.JSX.Element {
  const { trackId, width = 300, height, altText } = props;
  return renderSvgDocument(buildCoverDocument(trackId, { width, height, altText }));
}

/* ---------------------------------------------------------------- Icons --- */

export interface IconProps {
  size?: number;
  /**
   * Stroke colour. When omitted the icon takes the active theme's `textPrimary`
   * (`InlineIcon` in `components/primitives` resolves a tone instead); never a
   * hard-coded hex, so icons follow the scheme and the high-contrast palettes.
   */
  color?: string;
}

/** Icon painted with the theme's primary text colour (the no-`color` default). */
function ThemedIconSvg(props: { name: IconName; size: number }): React.JSX.Element {
  const theme = useTheme();
  return renderSvgDocument(
    buildIconDocument(props.name, { size: props.size, color: theme.colors.textPrimary }),
  );
}

function makeIcon(name: IconName): (props: IconProps) => React.JSX.Element {
  const Icon = (props: IconProps): React.JSX.Element => {
    const size = props.size ?? 24;
    if (props.color !== undefined)
      return renderSvgDocument(buildIconDocument(name, { size, color: props.color }));
    return <ThemedIconSvg name={name} size={size} />;
  };
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/** 24-grid stroke icon components keyed by name. */
export const ICONS: Record<IconName, (props: IconProps) => React.JSX.Element> = Object.fromEntries(
  ICON_NAMES.map((n) => [n, makeIcon(n)]),
) as Record<IconName, (props: IconProps) => React.JSX.Element>;
