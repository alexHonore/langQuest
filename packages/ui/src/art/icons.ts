/**
 * Icon set — simple 24-grid stroke icons (2px round caps) used across the app.
 * Geometry is data so the RN component and string renderer share it.
 */
import {
  type SvgAttrValue,
  type SvgDocument,
  type SvgNode,
  circle,
  line,
  path,
  polyline,
  rect,
  stroke,
  toSvgString,
} from './svg-node';

export const ICON_NAMES = [
  'mic',
  'micOff',
  'play',
  'pause',
  'replay',
  'slow',
  'hint',
  'translate',
  'transcript',
  'skip10back',
  'skip10forward',
  'bookmark',
  'download',
  'offline',
  'settings',
  'home',
  'missions',
  'audio',
  'speak',
  'progress',
  'check',
  'warning',
  'info',
  'close',
  'chevronRight',
  'chevronLeft',
  'star',
  'flame',
  'map',
  'characters',
  'headphones',
  'volume',
  'sleep',
  'search',
  'edit',
  'globe',
  'rtl',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const ICON_VIEWBOX = { x: 0, y: 0, width: 24, height: 24 } as const;

/** Accessibility labels for icons (English source; localise via `icon.<name>`). */
export const ICON_LABELS: Record<IconName, string> = {
  mic: 'Microphone',
  micOff: 'Microphone off',
  play: 'Play',
  pause: 'Pause',
  replay: 'Replay',
  slow: 'Slow playback',
  hint: 'Hint',
  translate: 'Translate',
  transcript: 'Transcript',
  skip10back: 'Back 10 seconds',
  skip10forward: 'Forward 10 seconds',
  bookmark: 'Bookmark',
  download: 'Download',
  offline: 'Offline',
  settings: 'Settings',
  home: 'Home',
  missions: 'Missions',
  audio: 'Audio',
  speak: 'Speak',
  progress: 'Progress',
  check: 'Done',
  warning: 'Warning',
  info: 'Information',
  close: 'Close',
  chevronRight: 'Next',
  chevronLeft: 'Previous',
  star: 'Star',
  flame: 'Streak',
  map: 'Map',
  characters: 'Characters',
  headphones: 'Headphones',
  volume: 'Volume',
  sleep: 'Sleep timer',
  search: 'Search',
  edit: 'Edit',
  globe: 'Language',
  rtl: 'Right-to-left text',
};

type IconBuilder = (s: Record<string, SvgAttrValue>, color: string) => SvgNode[];

const ICON_GEOMETRY: Record<IconName, IconBuilder> = {
  mic: (s) => [
    path('M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', s),
    path('M5 11a7 7 0 0 0 14 0', s),
    line(12, 18, 12, 21, s),
    line(9, 21, 15, 21, s),
  ],
  micOff: (s) => [
    path('M9 6a3 3 0 0 1 6 0v6', s),
    path('M5 11a7 7 0 0 0 10.6 6', s),
    path('M19 11a7 7 0 0 1-.9 3.4', s),
    line(12, 18, 12, 21, s),
    line(9, 21, 15, 21, s),
    line(4, 4, 20, 20, s),
  ],
  play: (s, c) => [path('M8 5.5v13l10-6.5z', { ...s, fill: c })],
  pause: (s, c) => [
    rect(6, 5, 4, 14, { ...s, fill: c, rx: 1 }),
    rect(14, 5, 4, 14, { ...s, fill: c, rx: 1 }),
  ],
  replay: (s, c) => [
    path('M4 12a8 8 0 1 0 2.5-5.8', s),
    path('M4 4v5h5', s),
    circle(12, 12, 0.1, { fill: c, stroke: 'none' }),
  ],
  slow: (s, c) => [
    path('M4 14c3-7 10-9 16-4', s),
    path('M8 14c0 2 1 3 2 3', s),
    path('M12 12c0 3 1 5 3 5', s),
    circle(17, 12, 1, { fill: c, stroke: 'none' }),
  ],
  hint: (s) => [
    path('M9 18h6', s),
    path('M10 21h4', s),
    path('M8.5 14a5.5 5.5 0 1 1 7 0c-.8.7-1.5 1.6-1.5 3h-4c0-1.4-.7-2.3-1.5-3z', s),
  ],
  translate: (s) => [
    path('M4 6h9', s),
    path('M8.5 4v2', s),
    path('M11 6c-1 4-3.5 7-7 9', s),
    path('M6 10c1 2.5 3 4.5 6 5', s),
    path('M13 20l4-9 4 9', s),
    path('M14.5 17h5', s),
  ],
  transcript: (s) => [
    rect(4, 4, 16, 16, { ...s, rx: 2 }),
    line(8, 9, 16, 9, s),
    line(8, 13, 16, 13, s),
    line(8, 17, 12, 17, s),
  ],
  skip10back: (s) => [
    path('M5 12a7 7 0 1 0 2-5', s),
    path('M4 4v4h4', s),
    path('M10 15v-5l-1.5 1', s),
    path('M14.5 10a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-3 0v-2a1.5 1.5 0 0 1 1.5-1.5z', s),
  ],
  skip10forward: (s) => [
    path('M19 12a7 7 0 1 1-2-5', s),
    path('M20 4v4h-4', s),
    path('M10 15v-5l-1.5 1', s),
    path('M14.5 10a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-3 0v-2a1.5 1.5 0 0 1 1.5-1.5z', s),
  ],
  bookmark: (s) => [path('M7 4h10v16l-5-3.5L7 20z', s)],
  download: (s) => [path('M12 4v11', s), path('M7.5 11 12 15.5 16.5 11', s), path('M5 19h14', s)],
  offline: (s) => [
    path('M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 17 8.5a4 4 0 0 1 1.5 7.6', s),
    line(4, 4, 20, 20, s),
  ],
  settings: (s) => [
    circle(12, 12, 3, s),
    path(
      'M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
      s,
    ),
  ],
  home: (s) => [path('M4 11 12 4l8 7', s), path('M6 10v10h12V10', s), path('M10 20v-6h4v6', s)],
  missions: (s, c) => [
    path('M5 4h14l-4 4 4 4H5', s),
    line(5, 4, 5, 21, s),
    circle(5, 4, 0.1, { fill: c, stroke: 'none' }),
  ],
  audio: (s) => [path('M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4', s)],
  speak: (s) => [
    path('M4 6h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4 3v-3H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', s),
    path('M20 8c1.5 1.5 1.5 6.5 0 8', s),
  ],
  progress: (s) => [path('M4 20V10M10 20V4M16 20v-8M22 20H2', s)],
  check: (s) => [
    polyline(
      [
        [5, 12.5],
        [9.5, 17],
        [19, 7],
      ],
      s,
    ),
  ],
  warning: (s, c) => [
    path('M12 4 2.5 20h19z', s),
    line(12, 10, 12, 14, s),
    circle(12, 17, 1, { fill: c, stroke: 'none' }),
  ],
  info: (s, c) => [
    circle(12, 12, 9, s),
    line(12, 11, 12, 16, s),
    circle(12, 8, 1, { fill: c, stroke: 'none' }),
  ],
  close: (s) => [line(6, 6, 18, 18, s), line(18, 6, 6, 18, s)],
  chevronRight: (s) => [
    polyline(
      [
        [9, 5],
        [16, 12],
        [9, 19],
      ],
      s,
    ),
  ],
  chevronLeft: (s) => [
    polyline(
      [
        [15, 5],
        [8, 12],
        [15, 19],
      ],
      s,
    ),
  ],
  star: (s) => [path('m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z', s)],
  flame: (s) => [
    path('M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1.5-4 .5 1.5 1.5 2 2.5 2 0-3-1-5 0-7z', s),
  ],
  map: (s) => [
    path('M3 6 9 4l6 2 6-2v14l-6 2-6-2-6 2z', s),
    line(9, 4, 9, 18, s),
    line(15, 6, 15, 20, s),
  ],
  characters: (s) => [
    circle(9, 8, 3.5, s),
    path('M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6', s),
    circle(17, 9, 2.5, s),
    path('M15.5 14c2.5 0 5 2 5 5', s),
  ],
  headphones: (s) => [
    path('M4 14V12a8 8 0 0 1 16 0v2', s),
    rect(4, 14, 4, 6, { ...s, rx: 1.5 }),
    rect(16, 14, 4, 6, { ...s, rx: 1.5 }),
  ],
  volume: (s) => [
    path('M4 9h4l5-4v14l-5-4H4z', s),
    path('M16 9a4 4 0 0 1 0 6', s),
    path('M18.5 6.5a7.5 7.5 0 0 1 0 11', s),
  ],
  sleep: (s) => [path('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', s)],
  search: (s) => [circle(10.5, 10.5, 6.5, s), line(15.5, 15.5, 20.5, 20.5, s)],
  edit: (s) => [path('M4 20h4l11-11-4-4L4 16z', s), line(13, 7, 17, 11, s)],
  globe: (s) => [
    circle(12, 12, 9, s),
    path('M3 12h18', s),
    path('M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', s),
  ],
  rtl: (s) => [
    path('M20 6h-9a3 3 0 0 0 0 6h3V6M14 12v6', s),
    path('M7 14l-4 3 4 3', s),
    path('M3 17h8', s),
  ],
};

/** Build the node tree for an icon. */
export function buildIconNodes(name: IconName, color = 'currentColor', strokeWidth = 2): SvgNode[] {
  const s = stroke(color, strokeWidth);
  const builder = ICON_GEOMETRY[name];
  if (!builder) throw new Error(`Unknown icon: ${name}`);
  return builder(s, color);
}

/** Full document for an icon. */
export function buildIconDocument(
  name: IconName,
  opts: { size?: number; color?: string } = {},
): SvgDocument {
  const size = opts.size ?? 24;
  return {
    viewBox: ICON_VIEWBOX,
    width: size,
    height: size,
    label: ICON_LABELS[name],
    children: buildIconNodes(name, opts.color ?? 'currentColor'),
  };
}

/** Standalone `<svg>` markup for an icon. */
export function iconSvgString(
  name: IconName,
  opts: { size?: number; color?: string } = {},
): string {
  return toSvgString(buildIconDocument(name, opts));
}
