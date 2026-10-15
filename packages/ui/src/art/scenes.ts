/**
 * Mission scene / location art (§10.2A) — twelve layered vector environments
 * with an uncluttered centre (for character overlays and readable UI), warm
 * light, day/evening variants and alt text. No baked-in text, no logos.
 *
 * Coordinate space: 160 × 90 (16:9). The centre band x∈[48,112] stays clear of
 * tall objects so a half-body portrait or caption can sit on top.
 */
import { type ArtTheme, SCENE_BASE, type SceneBasePalette, shade } from './palette';
import {
  type SvgDocument,
  type SvgNode,
  circle,
  el,
  ellipse,
  g,
  line,
  linearGradient,
  path,
  polygon,
  radialGradient,
  rect,
  roundedRect,
  stroke,
  toSvgString,
} from './svg-node';

export type SceneId =
  | 'cafe'
  | 'street'
  | 'airport'
  | 'market'
  | 'home'
  | 'office'
  | 'transit'
  | 'restaurant'
  | 'gathering'
  | 'station'
  | 'park'
  | 'clinic';
export type SceneVariant = 'day' | 'evening';

export interface SceneDefinition {
  id: SceneId;
  title: string;
  altText: string;
  placeType: string;
  /** Tracks whose flagship missions typically use this setting (hint only; any track may use any scene). */
  suggestedTracks: string[];
}

/** The twelve scene definitions. */
export const SCENES: readonly SceneDefinition[] = [
  {
    id: 'cafe',
    title: 'Café counter',
    altText:
      'A warm café interior with a wooden counter, a coffee machine, pastries under glass and a sunny window.',
    placeType: 'cafe',
    suggestedTracks: [
      'arabic-moroccan',
      'french',
      'italian',
      'portuguese-european',
      'spanish-spain',
    ],
  },
  {
    id: 'street',
    title: 'Neighbourhood street',
    altText:
      'A quiet neighbourhood street with low buildings, a lamppost, a bicycle and a corner shop awning.',
    placeType: 'street',
    suggestedTracks: ['arabic-egyptian', 'arabic-eastern', 'german', 'ukrainian', 'romanian'],
  },
  {
    id: 'airport',
    title: 'Airport hall',
    altText:
      'A bright airport hall with tall windows, a departures board without text, a check-in desk and a suitcase.',
    placeType: 'airport',
    suggestedTracks: ['english', 'japanese', 'korean', 'chinese-mandarin'],
  },
  {
    id: 'market',
    title: 'Open-air market',
    altText:
      'A lively open-air market with striped stall canopies, crates of fruit and vegetables and hanging lights.',
    placeType: 'market',
    suggestedTracks: ['spanish-latin-american', 'swahili', 'lingala', 'vietnamese', 'hindi'],
  },
  {
    id: 'home',
    title: 'Living room',
    altText:
      'A cosy living room with a sofa, a bookshelf, a floor lamp, a plant and a window with curtains.',
    placeType: 'home',
    suggestedTracks: ['french', 'haitian-creole', 'kinyarwanda', 'danish', 'swedish'],
  },
  {
    id: 'office',
    title: 'Shared office',
    altText:
      'A modern shared office with desks, monitors, a whiteboard without text and a tall window.',
    placeType: 'office',
    suggestedTracks: ['spanish-spain', 'german', 'english', 'korean', 'hebrew'],
  },
  {
    id: 'transit',
    title: 'Bus stop',
    altText:
      'A city bus stop with a shelter, a bench, the front of a bus and apartment blocks behind.',
    placeType: 'transit',
    suggestedTracks: ['swahili', 'arabic-egyptian', 'chinese-cantonese', 'russian'],
  },
  {
    id: 'restaurant',
    title: 'Restaurant table',
    altText: 'A restaurant interior with a set table, pendant lamps, a plant and a window at dusk.',
    placeType: 'restaurant',
    suggestedTracks: ['italian', 'chinese-cantonese', 'japanese', 'greek', 'vietnamese'],
  },
  {
    id: 'gathering',
    title: 'Friends gathering',
    altText:
      'A rooftop gathering at golden hour with string lights, a table of snacks, cushions and a city skyline.',
    placeType: 'gathering',
    suggestedTracks: ['portuguese-brazilian', 'ukrainian', 'lingala', 'spanish-latin-american'],
  },
  {
    id: 'station',
    title: 'Train station',
    altText:
      'A train station platform with a clock without numerals, a waiting train, benches and a glass roof.',
    placeType: 'station',
    suggestedTracks: ['german', 'french', 'japanese', 'portuguese-european', 'chinese-simplified'],
  },
  {
    id: 'park',
    title: 'City park',
    altText: 'A green city park with rolling lawns, trees, a bench, a path and a small pond.',
    placeType: 'park',
    suggestedTracks: ['danish', 'swedish', 'kinyarwanda', 'korean', 'haitian-creole'],
  },
  {
    id: 'clinic',
    title: 'Pharmacy counter',
    altText:
      'A calm pharmacy interior with shelves of unlabeled boxes, a counter, a plant and soft daylight.',
    placeType: 'clinic',
    suggestedTracks: ['portuguese-european', 'hebrew', 'greek', 'hindi', 'arabic-msa'],
  },
];

export const SCENE_IDS: readonly SceneId[] = SCENES.map((s) => s.id);
const sceneById = new Map<string, SceneDefinition>(SCENES.map((s) => [s.id, s]));

/** Look up a scene definition. */
export function findScene(id: string): SceneDefinition | undefined {
  return sceneById.get(id);
}

export const SCENE_VIEWBOX = { x: 0, y: 0, width: 160, height: 90 } as const;
const W = 160;
const H = 90;

interface Ctx {
  base: SceneBasePalette;
  theme: ArtTheme;
  evening: boolean;
  /** Accent & material colours adjusted for theme/time. */
  wood: string;
  wall: string;
  wallShade: string;
  floor: string;
  metal: string;
  glass: string;
  leaf: string;
  leafDark: string;
  accentA: string;
  accentB: string;
  ink: string;
  lamp: string;
}

function makeCtx(theme: ArtTheme, variant: SceneVariant): Ctx {
  const base = SCENE_BASE[theme];
  const evening = variant === 'evening';
  const dim = theme === 'dark' ? -0.35 : evening ? -0.12 : 0;
  const tone = (hex: string): string => (dim === 0 ? hex : shade(hex, dim));
  return {
    base,
    theme,
    evening,
    wood: tone('#B98A5C'),
    wall: tone(evening ? '#E9D9CF' : '#F3E9DF'),
    wallShade: tone(evening ? '#D3BFB4' : '#E4D5C7'),
    floor: tone(evening ? '#C4A98C' : '#D6BB9C'),
    metal: tone('#9BA6AD'),
    glass: evening ? '#F6C98B' : tone('#CFE6F3'),
    leaf: tone('#6FAE7C'),
    leafDark: tone('#4E8A5C'),
    accentA: tone('#E98A6B'),
    accentB: tone('#5FA9B8'),
    ink: base.ink,
    lamp: evening ? '#FFD98A' : tone('#F2E7D3'),
  };
}

/* ---------------------------------------------------------------- parts --- */

function sky(c: Ctx, id: string): SvgNode[] {
  const [a, b] = c.evening ? c.base.skyEvening : c.base.skyDay;
  return [
    el('defs', {}, [
      linearGradient(`${id}-sky`, [
        [0, a],
        [1, b],
      ]),
    ]),
    rect(0, 0, W, H, { fill: `url(#${id}-sky)` }),
  ];
}

function sunOrMoon(c: Ctx, cx: number, cy: number, r: number): SvgNode[] {
  if (c.evening) {
    return [
      circle(cx, cy, r, { fill: c.base.sunEvening, fillOpacity: 0.95 }),
      circle(cx, cy, r * 1.9, { fill: c.base.sunEvening, fillOpacity: 0.14 }),
    ];
  }
  return [
    circle(cx, cy, r, { fill: c.base.sunDay, fillOpacity: 0.9 }),
    circle(cx, cy, r * 1.8, { fill: c.base.sunDay, fillOpacity: 0.18 }),
  ];
}

function floorBand(c: Ctx, y: number, color?: string): SvgNode {
  return rect(0, y, W, H - y, { fill: color ?? c.floor });
}

function windowPane(c: Ctx, x: number, y: number, w: number, h: number, lit = false): SvgNode[] {
  const glass = lit || c.evening ? c.glass : c.base.skyDay[0];
  return [
    rect(x, y, w, h, { fill: glass, stroke: c.ink, strokeWidth: 0.9, strokeOpacity: 0.55 }),
    line(x + w / 2, y, x + w / 2, y + h, { stroke: c.ink, strokeWidth: 0.7, strokeOpacity: 0.4 }),
    line(x, y + h / 2, x + w, y + h / 2, { stroke: c.ink, strokeWidth: 0.7, strokeOpacity: 0.4 }),
    ...(c.evening ? [rect(x, y, w, h, { fill: c.base.glow, fillOpacity: 0.25 })] : []),
  ];
}

function plant(c: Ctx, x: number, y: number, s = 1): SvgNode[] {
  return [
    path(roundedRect(x - 5 * s, y - 6 * s, 10 * s, 7 * s, 1.5 * s), {
      fill: c.accentA,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ellipse(x, y - 11 * s, 7 * s, 6 * s, { fill: c.leaf }),
    ellipse(x - 5 * s, y - 14 * s, 4.5 * s, 4 * s, { fill: c.leafDark }),
    ellipse(x + 5 * s, y - 15 * s, 4.5 * s, 4 * s, { fill: c.leafDark }),
    ellipse(x, y - 18 * s, 4 * s, 4 * s, { fill: c.leaf }),
  ];
}

function tree(c: Ctx, x: number, y: number, s = 1): SvgNode[] {
  return [
    rect(x - 1.6 * s, y - 14 * s, 3.2 * s, 14 * s, { fill: shade(c.wood, -0.3) }),
    circle(x, y - 20 * s, 9 * s, { fill: c.leafDark }),
    circle(x - 6 * s, y - 15 * s, 6 * s, { fill: c.leaf }),
    circle(x + 6 * s, y - 16 * s, 6.5 * s, { fill: c.leaf }),
    circle(x + 1 * s, y - 25 * s, 6 * s, { fill: c.leaf }),
  ];
}

function lamppost(c: Ctx, x: number, y: number, h: number): SvgNode[] {
  return [
    rect(x - 0.9, y - h, 1.8, h, { fill: c.metal }),
    path(roundedRect(x - 3.5, y - h - 6, 7, 6, 1.5), {
      fill: c.lamp,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ...(c.evening ? [circle(x, y - h - 3, 10, { fill: c.base.glow, fillOpacity: 0.22 })] : []),
  ];
}

function pendantLamp(c: Ctx, x: number, y: number): SvgNode[] {
  return [
    line(x, 0, x, y - 6, { stroke: c.ink, strokeWidth: 0.8, strokeOpacity: 0.6 }),
    path(`M${x - 6},${y} L${x - 3},${y - 6} H${x + 3} L${x + 6},${y}Z`, {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ellipse(x, y + 0.5, 4.5, 1.2, { fill: c.lamp }),
    ...(c.evening ? [ellipse(x, y + 10, 12, 8, { fill: c.base.glow, fillOpacity: 0.16 })] : []),
  ];
}

function stringLights(c: Ctx, y: number, sag: number): SvgNode[] {
  const nodes: SvgNode[] = [
    path(`M0,${y} Q${W / 4},${y + sag} ${W / 2},${y} T${W},${y}`, {
      fill: 'none',
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.6,
    }),
  ];
  for (let i = 1; i < 12; i += 1) {
    const x = (W / 12) * i;
    const t = (x % (W / 2)) / (W / 2);
    const yy = y + sag * 4 * t * (1 - t) * 0.5;
    nodes.push(
      circle(x, yy + 2, 1.3, {
        fill: c.evening ? c.base.glow : c.lamp,
        stroke: c.ink,
        strokeWidth: 0.4,
        strokeOpacity: 0.5,
      }),
    );
    if (c.evening) nodes.push(circle(x, yy + 2, 3.2, { fill: c.base.glow, fillOpacity: 0.25 }));
  }
  return nodes;
}

function chair(c: Ctx, x: number, y: number, flip = false): SvgNode {
  const d = `M${x},${y} v-10 h7 v10 M${x + 1},${y - 10} v-7 h5 v7`;
  return path(d, {
    ...stroke(c.wood, 1.6),
    transform: flip ? `translate(${2 * x + 7},0) scale(-1,1)` : undefined,
  });
}

function cushion(c: Ctx, x: number, y: number, color: string): SvgNode {
  return path(roundedRect(x, y, 14, 7, 3), {
    fill: color,
    stroke: c.ink,
    strokeWidth: 0.6,
    strokeOpacity: 0.5,
  });
}

function skyline(
  c: Ctx,
  y: number,
  color: string,
  blocks: ReadonlyArray<readonly [x: number, w: number, h: number]>,
  lit: boolean,
): SvgNode[] {
  const nodes: SvgNode[] = [];
  for (const [x, w, h] of blocks) {
    nodes.push(rect(x, y - h, w, h, { fill: color }));
    if (lit) {
      for (let wy = y - h + 3; wy < y - 4; wy += 5) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if ((wx * 7 + wy * 13) % 5 !== 0)
            nodes.push(rect(wx, wy, 2, 2.4, { fill: c.base.glow, fillOpacity: 0.85 }));
        }
      }
    }
  }
  return nodes;
}

/* --------------------------------------------------------------- scenes --- */

function cafe(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    rect(0, 0, W, 60, { fill: c.wall }),
    rect(0, 44, W, 2, { fill: c.wallShade }),
    floorBand(c, 60),
    // window on the left with light
    ...windowPane(c, 8, 10, 30, 30),
    ...(c.evening
      ? []
      : [
          polygon(
            [
              [8, 40],
              [38, 40],
              [60, 62],
              [20, 62],
            ],
            { fill: c.base.sunDay, fillOpacity: 0.25 },
          ),
        ]),
    // shelves with cups on the right
    rect(114, 14, 40, 1.6, { fill: c.wood }),
    rect(114, 26, 40, 1.6, { fill: c.wood }),
    ...[118, 126, 134, 142].map((x) =>
      path(roundedRect(x, 8, 5, 5.5, 1.2), {
        fill: c.accentB,
        stroke: c.ink,
        strokeWidth: 0.5,
        strokeOpacity: 0.5,
      }),
    ),
    ...[120, 131, 142].map((x) =>
      path(roundedRect(x, 19, 6, 6.5, 1.4), {
        fill: c.accentA,
        stroke: c.ink,
        strokeWidth: 0.5,
        strokeOpacity: 0.5,
      }),
    ),
    // counter spanning the lower band, low enough to keep the centre free
    path(roundedRect(0, 64, W, 26, [4, 4, 0, 0]), {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    rect(0, 64, W, 3, { fill: shade(c.wood, 0.25) }),
    // coffee machine on the right end of the counter
    path(roundedRect(120, 42, 26, 22, 3), {
      fill: c.metal,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.6,
    }),
    rect(124, 46, 18, 5, { fill: c.ink, fillOpacity: 0.35 }),
    rect(128, 56, 3, 6, { fill: c.ink, fillOpacity: 0.5 }),
    rect(136, 56, 3, 6, { fill: c.ink, fillOpacity: 0.5 }),
    // pastry dome on the left end
    path('M12,64 a12,12 0 0 1 24,0Z', {
      fill: c.glass,
      fillOpacity: 0.55,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ellipse(18, 61, 4, 2.4, { fill: c.accentA }),
    ellipse(26, 61, 4, 2.4, { fill: shade(c.accentA, 0.2) }),
    ellipse(22, 57, 3.6, 2.2, { fill: c.wood }),
    ...plant(c, 150, 64, 0.8),
    ...pendantLamp(c, 44, 14),
    ...pendantLamp(c, 104, 14),
  ];
}

function street(c: Ctx, id: string): SvgNode[] {
  const bld = shade(c.wall, c.evening ? -0.08 : 0);
  return [
    ...sky(c, id),
    ...sunOrMoon(c, 132, 16, 6),
    // far buildings
    ...skyline(
      c,
      58,
      shade(c.wallShade, -0.1),
      [
        [0, 30, 36],
        [30, 22, 44],
        [52, 18, 30],
        [100, 26, 34],
        [126, 34, 46],
      ],
      c.evening,
    ),
    // near buildings framing left/right
    rect(0, 26, 38, 34, { fill: bld, stroke: c.ink, strokeWidth: 0.8, strokeOpacity: 0.4 }),
    ...windowPane(c, 6, 32, 9, 10, c.evening),
    ...windowPane(c, 22, 32, 9, 10, c.evening),
    path('M0,26 H38 L34,21 H4Z', { fill: c.accentA }),
    rect(122, 30, 38, 30, {
      fill: shade(bld, -0.06),
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.4,
    }),
    ...windowPane(c, 128, 36, 9, 10, c.evening),
    ...windowPane(c, 144, 36, 9, 10, c.evening),
    // corner shop awning on the right
    path('M118,46 H160 V52 L156,56 H122Z', {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ...[122, 130, 138, 146, 154].map((x) =>
      rect(x, 46, 4, 10, { fill: '#FFFFFF', fillOpacity: 0.35 }),
    ),
    // pavement + road
    rect(0, 60, W, 8, { fill: shade(c.floor, 0.1) }),
    rect(0, 68, W, 22, { fill: shade(c.base.groundDay, c.theme === 'dark' ? -0.3 : -0.2) }),
    ...[10, 40, 70, 100, 130].map((x) =>
      rect(x, 78, 16, 1.6, { fill: '#FFFFFF', fillOpacity: 0.55 }),
    ),
    ...lamppost(c, 44, 60, 26),
    // bicycle leaning on the left
    circle(16, 64, 5, stroke(c.ink, 1.2, { strokeOpacity: 0.8 })),
    circle(30, 64, 5, stroke(c.ink, 1.2, { strokeOpacity: 0.8 })),
    path('M16,64 L22,54 L30,64 M22,54 L27,54 M20,52 h4', stroke(c.accentA, 1.2)),
    ...tree(c, 110, 60, 0.8),
  ];
}

function airport(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    // tall glass wall
    rect(0, 0, W, 58, { fill: c.evening ? '#3B3D6E' : c.base.skyDay[0], fillOpacity: 0.6 }),
    ...[0, 32, 64, 96, 128].map((x) => rect(x, 0, 1.6, 58, { fill: c.metal })),
    rect(0, 28, W, 1.4, { fill: c.metal }),
    ...sunOrMoon(c, 112, 14, 5),
    // plane silhouette far away
    path('M80,18 l10,-2 l12,0 l-8,4 l-12,1z', { fill: c.ink, fillOpacity: 0.35 }),
    // ceiling
    rect(0, 0, W, 6, { fill: c.wallShade }),
    floorBand(c, 58, shade(c.wall, c.theme === 'dark' ? -0.35 : 0.1)),
    ...[20, 60, 100, 140].map((x) =>
      line(x, 58, x - 10, 90, { stroke: c.ink, strokeWidth: 0.5, strokeOpacity: 0.2 }),
    ),
    // departures board (no text): rows of blank slats
    path(roundedRect(10, 10, 36, 20, 2), {
      fill: c.ink,
      fillOpacity: 0.75,
      stroke: c.ink,
      strokeWidth: 0.8,
    }),
    ...[14, 18, 22, 26].map((y) => rect(13, y, 30, 2, { fill: c.base.glow, fillOpacity: 0.6 })),
    // check-in desk on the right
    path(roundedRect(112, 48, 44, 18, 2), {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    rect(112, 48, 44, 2.5, { fill: shade(c.accentB, 0.3) }),
    path(roundedRect(126, 36, 14, 10, 1.5), { fill: c.ink, fillOpacity: 0.7 }),
    rect(132, 46, 2, 3, { fill: c.metal }),
    // suitcase on the left
    path(roundedRect(14, 62, 16, 22, 3), {
      fill: c.accentA,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.6,
    }),
    rect(18, 56, 8, 6, { fill: 'none', stroke: c.ink, strokeWidth: 1.4, strokeOpacity: 0.7 }),
    rect(14, 70, 16, 1.4, { fill: c.ink, fillOpacity: 0.25 }),
    circle(17, 85, 1.6, { fill: c.ink, fillOpacity: 0.7 }),
    circle(27, 85, 1.6, { fill: c.ink, fillOpacity: 0.7 }),
    ...plant(c, 8, 60, 0.7),
  ];
}

function market(c: Ctx, id: string): SvgNode[] {
  const stall = (x: number, canopy: string): SvgNode[] => [
    rect(x + 2, 40, 1.6, 30, { fill: c.wood }),
    rect(x + 38, 40, 1.6, 30, { fill: c.wood }),
    path(`M${x - 2},40 H${x + 44} L${x + 40},30 H${x + 2}Z`, {
      fill: canopy,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    ...[0, 8, 16, 24, 32].map((s) =>
      rect(x + 2 + s, 30.6, 4, 9.4, { fill: '#FFFFFF', fillOpacity: 0.4 }),
    ),
    ...[0, 6, 12, 18, 24, 30, 36].map((s) =>
      path(`M${x + s},40 q3,4 6,0`, {
        fill: canopy,
        stroke: c.ink,
        strokeWidth: 0.5,
        strokeOpacity: 0.5,
      }),
    ),
    path(roundedRect(x, 58, 42, 12, 1.5), {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
  ];
  const crate = (x: number, y: number, fruit: string): SvgNode[] => [
    rect(x, y, 14, 8, {
      fill: shade(c.wood, -0.15),
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    ...[2, 6, 10].map((dx) => circle(x + dx + 1, y - 1, 2.2, { fill: fruit })),
    ...[4, 8].map((dx) => circle(x + dx + 1, y - 3.5, 2.2, { fill: shade(fruit, 0.15) })),
  ];
  return [
    ...sky(c, id),
    ...sunOrMoon(c, 80, 12, 6),
    ...skyline(
      c,
      48,
      shade(c.wallShade, -0.12),
      [
        [0, 24, 20],
        [24, 30, 26],
        [110, 24, 22],
        [134, 26, 28],
      ],
      c.evening,
    ),
    floorBand(c, 62, shade(c.floor, -0.05)),
    ...stall(2, c.accentA),
    ...stall(116, c.accentB),
    ...crate(4, 52, '#E25A3C'),
    ...crate(22, 52, '#F2B134'),
    ...crate(120, 52, '#6FAE7C'),
    ...crate(138, 52, '#9B5FA7'),
    ...stringLights(c, 20, 8),
    // baskets on the ground at the edges
    path('M8,78 h14 l-2,8 h-10z', {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    path('M138,78 h14 l-2,8 h-10z', {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
  ];
}

function home(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    rect(0, 0, W, 62, { fill: c.wall }),
    rect(0, 58, W, 4, { fill: c.wallShade }),
    floorBand(c, 62),
    // rug in the centre, flat so overlays stay readable
    ellipse(80, 80, 44, 8, { fill: c.accentB, fillOpacity: 0.35 }),
    // window with curtains at the left
    ...windowPane(c, 14, 10, 28, 28),
    path('M8,8 q4,14 0,34 h8 q-4,-20 0,-34z', {
      fill: c.accentA,
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    path('M48,8 q-4,14 0,34 h-8 q4,-20 0,-34z', {
      fill: c.accentA,
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    // bookshelf at the right
    path(roundedRect(118, 12, 34, 50, 1.5), {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    ...[22, 34, 46].map((y) => rect(121, y, 28, 1.4, { fill: shade(c.wood, -0.25) })),
    ...[
      [122, 14, 3, '#5FA9B8'],
      [126, 15, 2.5, '#E98A6B'],
      [129.5, 13, 3.5, '#7A4B7D'],
      [134, 16, 2.5, '#7F8C4F'],
      [138, 14, 3, '#E0A93A'],
      [142, 15, 4, '#2F4A6D'],
    ].map(([x, y, w, col]) =>
      rect(x as number, y as number, w as number, 22 - (y as number) + 0.5, {
        fill: col as string,
      }),
    ),
    ...[
      [122, 25, 4, '#D86B8A'],
      [127, 26, 3, '#3A9D8F'],
      [131, 24, 3, '#B5562F'],
      [135, 27, 5, '#4A6FA5'],
      [141, 25, 3, '#E0A93A'],
    ].map(([x, y, w, col]) =>
      rect(x as number, y as number, w as number, 34 - (y as number) + 0.5, {
        fill: col as string,
      }),
    ),
    ...plant(c, 136, 46, 0.6),
    // sofa low on the left
    path(roundedRect(6, 56, 44, 18, 4), {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    path(roundedRect(4, 50, 8, 24, 3), {
      fill: shade(c.accentB, -0.12),
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    path(roundedRect(44, 50, 8, 24, 3), {
      fill: shade(c.accentB, -0.12),
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.5,
    }),
    cushion(c, 14, 58, c.accentA),
    cushion(c, 30, 58, '#E0A93A'),
    // floor lamp at the right
    rect(111, 40, 1.2, 36, { fill: c.metal }),
    path('M104,40 L118,40 L116,30 L106,30Z', {
      fill: c.lamp,
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    ...(c.evening ? [circle(111, 42, 14, { fill: c.base.glow, fillOpacity: 0.18 })] : []),
    ...plant(c, 150, 86, 1),
  ];
}

function office(c: Ctx, id: string): SvgNode[] {
  const desk = (x: number): SvgNode[] => [
    rect(x, 56, 44, 2.5, {
      fill: shade(c.wood, 0.2),
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    rect(x + 3, 58.5, 2, 20, { fill: c.metal }),
    rect(x + 39, 58.5, 2, 20, { fill: c.metal }),
    path(roundedRect(x + 12, 40, 20, 14, 1.5), {
      fill: c.ink,
      fillOpacity: 0.8,
      stroke: c.ink,
      strokeWidth: 0.8,
    }),
    rect(x + 13, 41, 18, 12, { fill: c.evening ? '#5B7BD5' : c.accentB, fillOpacity: 0.8 }),
    rect(x + 21, 54, 2, 2.5, { fill: c.metal }),
    path(roundedRect(x + 4, 52, 6, 4, 1), {
      fill: '#FFFFFF',
      fillOpacity: 0.7,
      stroke: c.ink,
      strokeWidth: 0.5,
      strokeOpacity: 0.5,
    }),
  ];
  return [
    ...sky(c, id),
    rect(0, 0, W, 58, { fill: c.wall }),
    floorBand(c, 58, shade(c.wall, c.theme === 'dark' ? -0.3 : -0.12)),
    // tall window at the right
    ...windowPane(c, 112, 6, 40, 44),
    ...skyline(
      c,
      50,
      shade(c.wallShade, -0.15),
      [
        [114, 10, 18],
        [126, 12, 26],
        [140, 10, 14],
      ],
      c.evening,
    ),
    // whiteboard with no text, left
    path(roundedRect(8, 10, 42, 26, 1.5), { fill: '#FFFFFF', stroke: c.metal, strokeWidth: 1.4 }),
    path('M14,18 q6,-4 10,0 t10,0', {
      fill: 'none',
      stroke: c.accentA,
      strokeWidth: 1.2,
      strokeLinecap: 'round',
    }),
    rect(14, 24, 12, 1.6, { fill: c.accentB }),
    rect(14, 28, 18, 1.6, { fill: c.accentB }),
    circle(40, 26, 4, stroke(c.leafDark, 1.2)),
    ...desk(2),
    ...desk(114),
    chair(c, 18, 80),
    chair(c, 128, 80, true),
    ...plant(c, 96, 58, 0.7),
    ...pendantLamp(c, 80, 12),
  ];
}

function transit(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    ...sunOrMoon(c, 28, 14, 5),
    ...skyline(
      c,
      56,
      shade(c.wallShade, -0.1),
      [
        [0, 22, 34],
        [24, 18, 28],
        [44, 30, 40],
        [96, 24, 30],
        [122, 20, 38],
        [144, 16, 26],
      ],
      c.evening,
    ),
    rect(0, 56, W, 10, { fill: shade(c.floor, 0.1) }),
    rect(0, 66, W, 24, { fill: shade(c.base.groundDay, c.theme === 'dark' ? -0.3 : -0.2) }),
    ...[6, 36, 66, 96, 126].map((x) => rect(x, 80, 16, 1.6, { fill: '#FFFFFF', fillOpacity: 0.5 })),
    // shelter on the left
    rect(6, 32, 2, 40, { fill: c.metal }),
    rect(44, 32, 2, 40, { fill: c.metal }),
    path('M2,32 H50 L48,27 H4Z', {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    rect(8, 34, 36, 26, {
      fill: c.glass,
      fillOpacity: 0.35,
      stroke: c.ink,
      strokeWidth: 0.5,
      strokeOpacity: 0.3,
    }),
    // bench
    rect(12, 58, 28, 2.4, { fill: c.wood }),
    rect(14, 60, 2, 8, { fill: c.metal }),
    rect(36, 60, 2, 8, { fill: c.metal }),
    // bus front on the right
    path(roundedRect(112, 36, 52, 40, [6, 6, 2, 2]), {
      fill: c.accentA,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.6,
    }),
    path(roundedRect(116, 40, 44, 18, 3), { fill: c.glass, fillOpacity: 0.8 }),
    rect(116, 62, 44, 3, { fill: '#FFFFFF', fillOpacity: 0.6 }),
    circle(122, 70, 3, { fill: c.lamp, stroke: c.ink, strokeWidth: 0.6 }),
    circle(154, 70, 3, { fill: c.lamp, stroke: c.ink, strokeWidth: 0.6 }),
    ...(c.evening
      ? [
          circle(122, 70, 7, { fill: c.base.glow, fillOpacity: 0.25 }),
          circle(154, 70, 7, { fill: c.base.glow, fillOpacity: 0.25 }),
        ]
      : []),
    rect(120, 76, 8, 5, { fill: c.ink, fillOpacity: 0.8 }),
    rect(148, 76, 8, 5, { fill: c.ink, fillOpacity: 0.8 }),
    ...lamppost(c, 60, 56, 30),
  ];
}

function restaurant(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    rect(0, 0, W, 60, { fill: shade(c.wall, -0.06) }),
    rect(0, 30, W, 30, { fill: c.wallShade }),
    rect(0, 29, W, 1.5, { fill: c.wood }),
    floorBand(c, 60, shade(c.wood, c.theme === 'dark' ? -0.35 : -0.1)),
    ...windowPane(c, 116, 8, 34, 20, true),
    ...pendantLamp(c, 30, 16),
    ...pendantLamp(c, 80, 14),
    ...pendantLamp(c, 130, 16),
    // table in the lower centre-left, low profile
    ellipse(50, 70, 36, 6, { fill: c.ink, fillOpacity: 0.12 }),
    path(roundedRect(14, 62, 72, 6, 3), {
      fill: '#FFFFFF',
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    rect(48, 68, 4, 18, { fill: c.wood }),
    ellipse(50, 86, 10, 2.5, { fill: c.wood }),
    // place setting
    circle(36, 64, 6, {
      fill: shade(c.accentB, 0.5),
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.5,
    }),
    circle(36, 64, 3.6, { fill: c.accentA }),
    rect(26, 60, 1.2, 8, { fill: c.metal }),
    rect(46, 60, 1.2, 8, { fill: c.metal }),
    path(roundedRect(62, 54, 5, 11, 1.5), {
      fill: c.glass,
      fillOpacity: 0.7,
      stroke: c.ink,
      strokeWidth: 0.5,
      strokeOpacity: 0.4,
    }),
    circle(72, 58, 3, { fill: c.accentA }),
    rect(71.4, 61, 1.2, 4, { fill: c.leafDark }),
    chair(c, 6, 82),
    chair(c, 88, 82, true),
    ...plant(c, 130, 60, 0.9),
  ];
}

function gathering(c: Ctx, id: string): SvgNode[] {
  const ctxEvening: Ctx = { ...c, evening: true };
  return [
    ...sky(ctxEvening, id),
    ...sunOrMoon(ctxEvening, 118, 20, 7),
    ...skyline(
      c,
      50,
      shade(c.base.skyEvening[0], -0.25),
      [
        [0, 18, 22],
        [20, 26, 32],
        [48, 14, 18],
        [96, 22, 24],
        [120, 28, 36],
        [150, 10, 20],
      ],
      true,
    ),
    // rooftop floor
    rect(0, 50, W, 40, { fill: shade(c.base.groundEvening, c.theme === 'dark' ? -0.2 : 0.1) }),
    rect(0, 49, W, 2, { fill: shade(c.base.groundEvening, 0.3) }),
    ...stringLights(ctxEvening, 10, 10),
    // low table with snacks (left)
    path(roundedRect(8, 64, 40, 5, 2), {
      fill: c.wood,
      stroke: c.ink,
      strokeWidth: 0.7,
      strokeOpacity: 0.5,
    }),
    rect(12, 69, 2, 10, { fill: shade(c.wood, -0.3) }),
    rect(42, 69, 2, 10, { fill: shade(c.wood, -0.3) }),
    circle(18, 62, 4, { fill: '#F2B134' }),
    circle(27, 62, 4, { fill: '#E25A3C' }),
    path(roundedRect(34, 55, 4, 9, 1.2), { fill: c.glass, fillOpacity: 0.8 }),
    path(roundedRect(40, 56, 4, 8, 1.2), { fill: c.glass, fillOpacity: 0.8 }),
    // cushions and potted plants (right)
    cushion(c, 114, 70, c.accentA),
    cushion(c, 132, 72, c.accentB),
    cushion(c, 122, 78, '#E0A93A'),
    ...plant(ctxEvening, 150, 70, 1),
    ...plant(ctxEvening, 6, 86, 0.7),
    // speaker
    path(roundedRect(100, 60, 8, 12, 1.5), { fill: c.ink, fillOpacity: 0.7 }),
    circle(104, 66, 2, { fill: c.base.glow, fillOpacity: 0.7 }),
  ];
}

function station(c: Ctx, id: string): SvgNode[] {
  return [
    ...sky(c, id),
    // glass roof
    path('M0,20 Q80,-6 160,20 V0 H0Z', { fill: c.metal, fillOpacity: 0.5 }),
    ...[0, 20, 40, 60, 80, 100, 120, 140].map((x) =>
      line(
        x,
        20 - Math.sin((x / W) * Math.PI) * 12,
        x + 20,
        20 - Math.sin(((x + 20) / W) * Math.PI) * 12,
        { stroke: c.metal, strokeWidth: 1.2 },
      ),
    ),
    ...[20, 60, 100, 140].map((x) => rect(x - 1, 8, 2, 54, { fill: c.metal })),
    // platform
    rect(0, 62, W, 28, { fill: shade(c.wall, c.theme === 'dark' ? -0.3 : -0.1) }),
    rect(0, 62, W, 2.5, { fill: c.accentA, fillOpacity: 0.9 }),
    // train on the right, partially visible
    path(roundedRect(104, 28, 70, 36, [10, 2, 2, 2]), {
      fill: c.accentB,
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.6,
    }),
    ...[112, 130, 148].map((x) =>
      path(roundedRect(x, 34, 14, 12, 2), { fill: c.glass, fillOpacity: 0.85 }),
    ),
    rect(104, 50, 70, 3, { fill: '#FFFFFF', fillOpacity: 0.6 }),
    circle(110, 59, 2.2, { fill: c.lamp }),
    // clock (no numerals)
    circle(40, 30, 7, { fill: '#FFFFFF', stroke: c.ink, strokeWidth: 1 }),
    line(40, 30, 40, 25.5, stroke(c.ink, 1)),
    line(40, 30, 43.5, 31.5, stroke(c.ink, 1)),
    rect(39.2, 37, 1.6, 25, { fill: c.metal }),
    // benches
    rect(8, 66, 26, 2.4, { fill: c.wood }),
    rect(10, 68, 2, 7, { fill: c.metal }),
    rect(30, 68, 2, 7, { fill: c.metal }),
    ...plant(c, 60, 64, 0.6),
    ...(c.evening ? [rect(0, 0, W, 62, { fill: c.base.skyEvening[0], fillOpacity: 0.18 })] : []),
  ];
}

function park(c: Ctx, id: string): SvgNode[] {
  const lawn = c.evening ? shade(c.leaf, -0.2) : c.leaf;
  return [
    ...sky(c, id),
    ...sunOrMoon(c, 130, 14, 7),
    // distant hills
    path('M0,52 Q40,34 80,48 T160,44 V60 H0Z', { fill: shade(lawn, -0.25) }),
    rect(0, 56, W, 34, { fill: lawn }),
    // path curving through the lower centre
    path('M0,88 Q60,70 160,84 V90 H0Z', { fill: shade(c.floor, 0.1) }),
    // pond right-centre, low
    ellipse(118, 76, 26, 6, {
      fill: c.evening ? '#9FB4D9' : '#A9D4E8',
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.3,
    }),
    ellipse(112, 75, 6, 1.2, { fill: '#FFFFFF', fillOpacity: 0.5 }),
    ...tree(c, 16, 60, 1.1),
    ...tree(c, 40, 56, 0.8),
    ...tree(c, 146, 58, 1),
    ...tree(c, 128, 54, 0.6),
    // bench on the left
    rect(24, 66, 22, 2.4, { fill: c.wood }),
    rect(24, 62, 22, 2, { fill: c.wood }),
    rect(26, 68, 2, 7, { fill: c.metal }),
    rect(42, 68, 2, 7, { fill: c.metal }),
    ...lamppost(c, 100, 60, 18),
    // flowers at the bottom-left
    ...[6, 12, 18].map((x, i) =>
      g({}, [
        rect(x - 0.4, 80, 0.8, 6, { fill: c.leafDark }),
        circle(x, 79, 2, { fill: [c.accentA, '#E0A93A', '#D86B8A'][i] ?? c.accentA }),
      ]),
    ),
  ];
}

function clinic(c: Ctx, id: string): SvgNode[] {
  const box = (x: number, y: number, w: number, col: string): SvgNode =>
    rect(x, y, w, 6, { fill: col, stroke: c.ink, strokeWidth: 0.5, strokeOpacity: 0.4 });
  const cols = ['#FFFFFF', '#CFE6F3', '#D7F0E3', '#FCE3D5'];
  const shelf = (x: number, y: number, w: number, seed: number): SvgNode[] => {
    const nodes: SvgNode[] = [rect(x, y + 6, w, 1.4, { fill: c.metal })];
    let cx = x + 1;
    let i = seed;
    while (cx + 5 <= x + w) {
      const bw = 4 + (i % 3);
      nodes.push(box(cx, y, bw, cols[i % cols.length] ?? '#FFFFFF'));
      cx += bw + 1.2;
      i += 1;
    }
    return nodes;
  };
  return [
    ...sky(c, id),
    rect(0, 0, W, 60, {
      fill: c.evening ? shade('#EAF2F5', -0.08) : shade('#EAF2F5', c.theme === 'dark' ? -0.4 : 0),
    }),
    rect(0, 58, W, 2, { fill: c.accentB, fillOpacity: 0.6 }),
    floorBand(c, 60, shade('#DCE6EA', c.theme === 'dark' ? -0.45 : c.evening ? -0.1 : 0)),
    // shelves left and right
    ...shelf(6, 10, 40, 0),
    ...shelf(6, 22, 40, 2),
    ...shelf(6, 34, 40, 1),
    ...shelf(114, 10, 40, 1),
    ...shelf(114, 22, 40, 0),
    ...shelf(114, 34, 40, 2),
    // counter low in the frame
    path(roundedRect(0, 66, W, 24, [3, 3, 0, 0]), {
      fill: '#FFFFFF',
      stroke: c.ink,
      strokeWidth: 0.8,
      strokeOpacity: 0.4,
    }),
    rect(0, 66, W, 3, { fill: c.accentB, fillOpacity: 0.8 }),
    // small cross sign (universal pharmacy mark, no text)
    path(roundedRect(74, 12, 12, 12, 2), {
      fill: '#FFFFFF',
      stroke: c.ink,
      strokeWidth: 0.6,
      strokeOpacity: 0.4,
    }),
    rect(78.5, 14, 3, 8, { fill: c.leafDark }),
    rect(76, 16.5, 8, 3, { fill: c.leafDark }),
    ...windowPane(c, 56, 28, 48, 24),
    ...plant(c, 150, 66, 0.8),
    ...plant(c, 10, 66, 0.6),
    path(roundedRect(120, 56, 10, 10, 1.5), { fill: c.ink, fillOpacity: 0.6 }),
  ];
}

const BUILDERS: Record<SceneId, (c: Ctx, id: string) => SvgNode[]> = {
  cafe,
  street,
  airport,
  market,
  home,
  office,
  transit,
  restaurant,
  gathering,
  station,
  park,
  clinic,
};

export interface SceneRenderOptions {
  theme?: ArtTheme;
  variant?: SceneVariant;
  width?: number;
  height?: number;
}

/** Build the node tree for a scene. */
export function buildSceneNodes(sceneId: SceneId, opts: SceneRenderOptions = {}): SvgNode[] {
  const builder = BUILDERS[sceneId];
  if (!builder) throw new Error(`Unknown scene: ${sceneId}`);
  const c = makeCtx(opts.theme ?? 'light', opts.variant ?? 'day');
  const id = `scene-${sceneId}-${opts.variant ?? 'day'}`;
  const nodes = builder(c, id);
  // soft vignette for depth; keeps centre bright
  nodes.push(
    el('defs', {}, [
      radialGradient(
        `${id}-vig`,
        [
          [0.6, c.base.shadow, 0],
          [1, c.base.shadow, c.theme === 'dark' ? 0.4 : 0.18],
        ],
        { cx: 0.5, cy: 0.5, r: 0.75 },
      ),
    ]),
  );
  nodes.push(rect(0, 0, W, H, { fill: `url(#${id}-vig)` }));
  return nodes;
}

/** Full document for a scene. */
export function buildSceneDocument(sceneId: SceneId, opts: SceneRenderOptions = {}): SvgDocument {
  const def = findScene(sceneId);
  const width = opts.width ?? 320;
  const height = opts.height ?? Math.round((width * 9) / 16);
  return {
    viewBox: SCENE_VIEWBOX,
    width,
    height,
    label: def ? def.altText : sceneId,
    children: buildSceneNodes(sceneId, opts),
  };
}

/** Standalone `<svg>` markup for a scene. */
export function sceneArtSvgString(
  sceneId: SceneId,
  opts: { width?: number; height?: number; theme?: ArtTheme; variant?: SceneVariant } = {},
): string {
  return toSvgString(buildSceneDocument(sceneId, opts));
}
