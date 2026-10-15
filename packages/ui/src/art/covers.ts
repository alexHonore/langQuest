/**
 * Course cover art (§10.2A) — 30 distinct covers generated from a palette +
 * motif system. Motifs are abstract and culture-neutral (no flags, no clichés,
 * no script glyphs); the display name is rendered by the UI, never baked in.
 * The lower-left quarter is kept calm for the UI's text overlay.
 *
 * Coordinate space: 150 × 100 (3:2).
 */
import {
  COURSE_TRACKS,
  type CourseTrackId,
  getCourseTrack,
  isCourseTrackId,
} from '@langquest/contracts';
import { hsl } from './palette';
import {
  type SvgDocument,
  type SvgNode,
  circle,
  el,
  g,
  line,
  linearGradient,
  path,
  polygon,
  polyline,
  rect,
  starPoints,
  stroke,
  toSvgString,
} from './svg-node';

export type CoverMotif =
  | 'waves'
  | 'arcs'
  | 'dots'
  | 'bands'
  | 'rings'
  | 'lattice'
  | 'petals'
  | 'steps'
  | 'chevrons'
  | 'orbits';

export interface CoverRecipe {
  trackId: CourseTrackId;
  /** Base hue 0..360. */
  hue: number;
  /** Secondary hue 0..360 for the motif. */
  hue2: number;
  motif: CoverMotif;
  /** 0..3 layout variant (motif anchor / density). */
  variant: number;
}

/** One curated recipe per track — every combination is unique. */
export const COVER_RECIPES: readonly CoverRecipe[] = [
  { trackId: 'arabic-eastern', hue: 24, hue2: 44, motif: 'arcs', variant: 0 },
  { trackId: 'arabic-moroccan', hue: 12, hue2: 190, motif: 'lattice', variant: 1 },
  { trackId: 'arabic-egyptian', hue: 36, hue2: 210, motif: 'bands', variant: 2 },
  { trackId: 'arabic-msa', hue: 200, hue2: 36, motif: 'rings', variant: 0 },
  { trackId: 'chinese-cantonese', hue: 350, hue2: 40, motif: 'petals', variant: 1 },
  { trackId: 'chinese-mandarin', hue: 358, hue2: 48, motif: 'waves', variant: 0 },
  { trackId: 'chinese-simplified', hue: 8, hue2: 330, motif: 'dots', variant: 3 },
  { trackId: 'english', hue: 214, hue2: 8, motif: 'steps', variant: 0 },
  { trackId: 'danish', hue: 206, hue2: 30, motif: 'bands', variant: 0 },
  { trackId: 'french', hue: 226, hue2: 350, motif: 'arcs', variant: 2 },
  { trackId: 'german', hue: 44, hue2: 220, motif: 'chevrons', variant: 1 },
  { trackId: 'greek', hue: 198, hue2: 50, motif: 'waves', variant: 2 },
  { trackId: 'haitian-creole', hue: 160, hue2: 20, motif: 'petals', variant: 0 },
  { trackId: 'hebrew', hue: 232, hue2: 42, motif: 'lattice', variant: 3 },
  { trackId: 'hindi', hue: 28, hue2: 300, motif: 'rings', variant: 2 },
  { trackId: 'italian', hue: 130, hue2: 10, motif: 'orbits', variant: 1 },
  { trackId: 'japanese', hue: 345, hue2: 200, motif: 'rings', variant: 3 },
  { trackId: 'korean', hue: 262, hue2: 350, motif: 'orbits', variant: 0 },
  { trackId: 'portuguese-brazilian', hue: 96, hue2: 46, motif: 'waves', variant: 3 },
  { trackId: 'portuguese-european', hue: 180, hue2: 30, motif: 'steps', variant: 2 },
  { trackId: 'romanian', hue: 48, hue2: 230, motif: 'dots', variant: 1 },
  { trackId: 'russian', hue: 220, hue2: 20, motif: 'chevrons', variant: 3 },
  { trackId: 'spanish-latin-american', hue: 18, hue2: 170, motif: 'petals', variant: 2 },
  { trackId: 'spanish-spain', hue: 6, hue2: 44, motif: 'bands', variant: 3 },
  { trackId: 'swahili', hue: 150, hue2: 32, motif: 'steps', variant: 1 },
  { trackId: 'kinyarwanda', hue: 170, hue2: 54, motif: 'arcs', variant: 3 },
  { trackId: 'swedish', hue: 212, hue2: 52, motif: 'lattice', variant: 0 },
  { trackId: 'lingala', hue: 40, hue2: 200, motif: 'chevrons', variant: 0 },
  { trackId: 'ukrainian', hue: 210, hue2: 50, motif: 'orbits', variant: 2 },
  { trackId: 'vietnamese', hue: 140, hue2: 16, motif: 'dots', variant: 0 },
];

const recipeByTrack = new Map<string, CoverRecipe>(COVER_RECIPES.map((r) => [r.trackId, r]));

/** Recipe lookup (throws for unknown tracks so tests catch catalog drift). */
export function getCoverRecipe(trackId: string): CoverRecipe {
  const r = recipeByTrack.get(trackId);
  if (!r) throw new Error(`No cover recipe for track: ${trackId}`);
  return r;
}

export const COVER_VIEWBOX = { x: 0, y: 0, width: 150, height: 100 } as const;
const W = 150;
const H = 100;

interface CoverPalette {
  bgTop: string;
  bgBottom: string;
  motif: string;
  motifSoft: string;
  highlight: string;
  ink: string;
}

function coverPalette(r: CoverRecipe): CoverPalette {
  return {
    bgTop: hsl(r.hue, 0.5, 0.42),
    bgBottom: hsl(r.hue + 12, 0.55, 0.3),
    motif: hsl(r.hue2, 0.6, 0.62),
    motifSoft: hsl(r.hue2, 0.5, 0.75),
    highlight: hsl(r.hue + 30, 0.6, 0.82),
    ink: hsl(r.hue, 0.5, 0.16),
  };
}

function motifNodes(r: CoverRecipe, p: CoverPalette): SvgNode[] {
  const v = r.variant;
  const nodes: SvgNode[] = [];
  switch (r.motif) {
    case 'waves': {
      const amp = 5 + v * 1.5;
      for (let i = 0; i < 6; i += 1) {
        const y = 16 + i * 13 + v * 3;
        const d =
          `M-10,${y} ` +
          Array.from({ length: 6 }, (_, k) => `q14,${k % 2 === 0 ? -amp : amp} 28,0`).join(' ');
        nodes.push(
          path(
            d,
            stroke(i % 2 === 0 ? p.motif : p.motifSoft, 2.2 + (i % 3), {
              strokeOpacity: 0.55 + (i % 2) * 0.25,
            }),
          ),
        );
      }
      break;
    }
    case 'arcs': {
      const cx = v % 2 === 0 ? W + 10 : -10;
      const cy = v < 2 ? -10 : H + 10;
      for (let i = 1; i <= 7; i += 1) {
        nodes.push(
          circle(
            cx,
            cy,
            i * 17,
            stroke(i % 2 ? p.motif : p.motifSoft, 3.5 - i * 0.3, { strokeOpacity: 0.7 }),
          ),
        );
      }
      break;
    }
    case 'dots': {
      const step = 12 + v * 2;
      for (let y = 8; y < H; y += step) {
        for (let x = 8 + ((y / step) % 2) * (step / 2); x < W; x += step) {
          const t = (x + y) / (W + H);
          nodes.push(
            circle(x, y, 1.6 + t * 3.5, {
              fill: t > 0.5 ? p.motif : p.motifSoft,
              fillOpacity: 0.75,
            }),
          );
        }
      }
      break;
    }
    case 'bands': {
      const angle = v % 2 === 0 ? -18 : 18;
      for (let i = 0; i < 7; i += 1) {
        const y = -10 + i * 22 + v * 4;
        nodes.push(
          rect(-40, y, W + 80, 6 + (i % 3) * 3, {
            fill: i % 2 ? p.motif : p.motifSoft,
            fillOpacity: 0.55,
            transform: `rotate(${angle} ${W / 2} ${H / 2})`,
          }),
        );
      }
      break;
    }
    case 'rings': {
      const cx = [112, 38, 118, 40][v] ?? 112;
      const cy = [34, 30, 66, 60][v] ?? 34;
      for (let i = 1; i <= 6; i += 1)
        nodes.push(
          circle(
            cx,
            cy,
            i * 9,
            stroke(i % 2 ? p.motif : p.motifSoft, 2.4, { strokeOpacity: 0.75 }),
          ),
        );
      nodes.push(circle(cx, cy, 4, { fill: p.highlight }));
      break;
    }
    case 'lattice': {
      const s = 16 + v * 3;
      for (let x = -H; x < W + H; x += s) {
        nodes.push(line(x, 0, x + H, H, stroke(p.motif, 1.6, { strokeOpacity: 0.6 })));
        nodes.push(line(x, H, x + H, 0, stroke(p.motifSoft, 1.6, { strokeOpacity: 0.6 })));
      }
      for (let x = -H; x < W + H; x += s) {
        for (let y = 0; y <= H; y += s)
          nodes.push(circle(x + y, y, 1.6, { fill: p.highlight, fillOpacity: 0.8 }));
      }
      break;
    }
    case 'petals': {
      const cx = v % 2 === 0 ? 112 : 40;
      const cy = v < 2 ? 36 : 62;
      for (let i = 0; i < 8; i += 1) {
        const a = (i * 360) / 8;
        nodes.push(
          path(`M${cx},${cy} q18,-14 36,0 q-18,14 -36,0Z`, {
            fill: i % 2 ? p.motif : p.motifSoft,
            fillOpacity: 0.6,
            transform: `rotate(${a} ${cx} ${cy})`,
          }),
        );
      }
      nodes.push(circle(cx, cy, 5, { fill: p.highlight }));
      break;
    }
    case 'steps': {
      const n = 7 + v;
      for (let i = 0; i < n; i += 1) {
        const w = (W / n) * (i + 1);
        const h = (H / n) * (i + 1);
        const x = v % 2 === 0 ? W - w : 0;
        const y = v < 2 ? 0 : H - h;
        nodes.push(rect(x, y, w, h, { fill: i % 2 ? p.motif : p.motifSoft, fillOpacity: 0.16 }));
      }
      break;
    }
    case 'chevrons': {
      const s = 22 + v * 2;
      for (let y = -10; y < H + 10; y += s / 2) {
        const pts: Array<[number, number]> = [];
        for (let x = -10; x <= W + 10; x += s)
          pts.push([x, y], [x + s / 2, y + (v % 2 === 0 ? 8 : -8)]);
        nodes.push(
          polyline(
            pts,
            stroke(((y / (s / 2)) | 0) % 2 ? p.motif : p.motifSoft, 2.4, { strokeOpacity: 0.6 }),
          ),
        );
      }
      break;
    }
    case 'orbits': {
      const cx = [100, 46, 108, 50][v] ?? 100;
      const cy = [40, 38, 64, 60][v] ?? 40;
      for (let i = 1; i <= 4; i += 1) {
        nodes.push(
          el('ellipse', {
            cx,
            cy,
            rx: i * 16,
            ry: i * 7,
            ...stroke(i % 2 ? p.motif : p.motifSoft, 1.8, { strokeOpacity: 0.7 }),
            transform: `rotate(${-20 + i * 10} ${cx} ${cy})`,
          }),
        );
        const a = (i * 1.9 + v) % (Math.PI * 2);
        nodes.push(
          circle(cx + Math.cos(a) * i * 16, cy + Math.sin(a) * i * 7, 2.4, { fill: p.highlight }),
        );
      }
      nodes.push(circle(cx, cy, 5, { fill: p.highlight }));
      break;
    }
    default:
      break;
  }
  return nodes;
}

/** Build the cover node tree for a track. */
export function buildCoverNodes(trackId: string): SvgNode[] {
  const r = getCoverRecipe(trackId);
  const p = coverPalette(r);
  const id = `cover-${trackId}`;
  return [
    el('defs', {}, [
      linearGradient(
        `${id}-bg`,
        [
          [0, p.bgTop],
          [1, p.bgBottom],
        ],
        { x1: 0, y1: 0, x2: 1, y2: 1 },
      ),
      linearGradient(`${id}-text`, [
        [0, p.ink, 0],
        [1, p.ink, 0.55],
      ]),
      el('clipPath', { id: `${id}-clip` }, [rect(0, 0, W, H, { rx: 6 })]),
    ]),
    g({ clipPath: `url(#${id}-clip)` }, [
      rect(0, 0, W, H, { fill: `url(#${id}-bg)` }),
      ...motifNodes(r, p),
      // calm zone for the UI title overlay (bottom-left), subtle gradient only
      rect(0, 52, W, 48, { fill: `url(#${id}-text)` }),
      // track mark: small star-like accent in the corner keeps covers from feeling identical
      polygon(starPoints(138, 88, 4.5 + (r.variant % 2) * 1.5, 2, 4 + (r.variant % 3)), {
        fill: p.highlight,
        fillOpacity: 0.9,
      }),
    ]),
  ];
}

/** Full document for a cover. */
export interface CoverRenderOptions {
  width?: number;
  height?: number;
  /**
   * Localized accessible description (`t(coverAltTextKey(trackId))`). Falls
   * back to the English catalog display name. Never rendered as visible text.
   */
  altText?: string;
}

/**
 * Locale catalog key for a cover's alt text: `catalog.cover.<trackId>` (the
 * track slug as-is, e.g. `catalog.cover.arabic-moroccan`). Also exposed per
 * cover as `ART_MANIFEST.coverAltTextKeys[trackId]`.
 */
export function coverAltTextKey(trackId: string): string {
  return `catalog.cover.${trackId}`;
}

/** Default (English) alt text when no localized `altText` is supplied. */
export function defaultCoverAltText(trackId: string): string {
  const track = isCourseTrackId(trackId) ? getCourseTrack(trackId) : undefined;
  return track ? `Course cover art for ${track.displayName}` : `Course cover art for ${trackId}`;
}

export function buildCoverDocument(trackId: string, opts: CoverRenderOptions = {}): SvgDocument {
  const width = opts.width ?? 300;
  const height = opts.height ?? Math.round((width * 2) / 3);
  const label = opts.altText?.trim() ? opts.altText.trim() : defaultCoverAltText(trackId);
  return { viewBox: COVER_VIEWBOX, width, height, label, children: buildCoverNodes(trackId) };
}

/** Standalone `<svg>` markup for a course cover. */
export function courseCoverSvgString(trackId: string, opts: CoverRenderOptions = {}): string {
  return toSvgString(buildCoverDocument(trackId, opts));
}

/** Sanity: every catalog track has a recipe (checked by tests). */
export const COVER_TRACK_IDS: readonly CourseTrackId[] = COURSE_TRACKS.map((t) => t.id);
