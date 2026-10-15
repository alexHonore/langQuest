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
import { buildMascotDocument } from './mascot';
import type { ArtTheme } from './palette';
import { type SceneId, type SceneVariant, buildSceneDocument } from './scenes';
import type { SvgDocument, SvgNode, SvgTag } from './svg-node';

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

/** Render a whole document inside an accessible `<Svg>` root. */
export function renderSvgDocument(doc: SvgDocument, label?: string): React.JSX.Element {
  const { x, y, width, height } = doc.viewBox;
  return (
    <Svg
      width={doc.width}
      height={doc.height}
      viewBox={`${x} ${y} ${width} ${height}`}
      accessible
      accessibilityLabel={label ?? doc.label}
      accessibilityRole="image"
    >
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
}

/** Idle loop (breathing + occasional blink). Only mounted when animation is requested and allowed. */
function AnimatedMascot(props: {
  state: MascotState;
  size: number;
  theme: ArtTheme;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 400), 100);
    return () => clearInterval(id);
  }, []);
  const breath = Math.sin((phase / 400) * Math.PI * 2 * 10); // ~4 s cycle
  const blinkTick = phase % 40; // every ~4 s
  const blink = blinkTick >= 37 ? (blinkTick === 38 ? 1 : 0.6) : 0;
  return renderSvgDocument(
    buildMascotDocument(props.state, { size: props.size, theme: props.theme, blink, breath }),
    props.accessibilityLabel,
  );
}

/**
 * Original orbit-creature mascot in one of the 17 contract states.
 * Static by default (no hooks, no timers); `animate` enables a gentle idle loop
 * unless `reducedMotion` is set.
 */
export function MascotSvg(props: MascotSvgProps): React.JSX.Element {
  const {
    state,
    size = 96,
    theme = 'light',
    reducedMotion = false,
    accessibilityLabel,
    animate = false,
  } = props;
  if (animate && !reducedMotion) {
    return (
      <AnimatedMascot
        state={state}
        size={size}
        theme={theme}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return renderSvgDocument(buildMascotDocument(state, { size, theme }), accessibilityLabel);
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
}

/** Abstract 3:2 course cover; the UI renders the track name on top. */
export function CourseCoverSvg(props: CourseCoverSvgProps): React.JSX.Element {
  const { trackId, width = 300, height } = props;
  return renderSvgDocument(buildCoverDocument(trackId, { width, height }));
}

/* ---------------------------------------------------------------- Icons --- */

export interface IconProps {
  size?: number;
  color?: string;
}

function makeIcon(name: IconName): (props: IconProps) => React.JSX.Element {
  const Icon = (props: IconProps): React.JSX.Element =>
    renderSvgDocument(
      buildIconDocument(name, { size: props.size ?? 24, color: props.color ?? '#1E3A3A' }),
    );
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/** 24-grid stroke icon components keyed by name. */
export const ICONS: Record<IconName, (props: IconProps) => React.JSX.Element> = Object.fromEntries(
  ICON_NAMES.map((n) => [n, makeIcon(n)]),
) as Record<IconName, (props: IconProps) => React.JSX.Element>;
