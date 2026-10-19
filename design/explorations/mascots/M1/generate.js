'use strict';
// M1 editable master — refined orbit-creature. Pure Node (fs/path only, no dependencies).
// Run `node generate.js` from this folder to regenerate every SVG next to it from the pose data below.
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

// ---------------------------------------------------------------- palettes
const LIGHT = {
  name: 'light',
  body: '#35B8A5', bodyShade: '#1F9484', bodyLight: '#9BE8DA', belly: '#F2FBF8',
  ribbon: '#FF9E72', ribbonUnder: '#FFC6A8', ribbonShade: '#D9623A',
  outline: '#1B3338', eyeWhite: '#FFFFFF', iris: '#2A5A63', pupil: '#121E24', mouth: '#121E24',
  tongue: '#FF8D8D', cheek: '#FFB4A2', accent: '#FFC94D', danger: '#E0565B',
  muted: '#8A979E', mutedFill: '#DEE5E8', mutedShade: '#6F7D85', mutedRibbon: '#B9C3C8', mutedRibbonUnder: '#D5DCE0',
  shadow: '#1B3338', propStroke: '#1B3338', propFill: '#FFFFFF', bg: null,
};
const DARK = {
  name: 'dark',
  body: '#4ECDB9', bodyShade: '#2FA896', bodyLight: '#A9EFE2', belly: '#E4F7F2',
  ribbon: '#FFAA82', ribbonUnder: '#FFD0B6', ribbonShade: '#E26F47',
  outline: '#0B171A', eyeWhite: '#F7FBFB', iris: '#2E6670', pupil: '#0B151A', mouth: '#0B151A',
  tongue: '#FF8D8D', cheek: '#FF9E8A', accent: '#FFD46A', danger: '#FF7A7E',
  muted: '#9AA8B0', mutedFill: '#2E3B41', mutedShade: '#7A8890', mutedRibbon: '#6F7D85', mutedRibbonUnder: '#8A979E',
  shadow: '#000000', propStroke: '#E8F1F2', propFill: '#1C2B2F', bg: '#0F1D21',
};

// line weights (100-unit space)
const W_OUT = 2.6;   // silhouette: body, limbs, tail, feet
const W_IN = 2.0;    // interior: eyes, brows, mouth, props

const f = (n) => (Math.round(n * 100) / 100).toString();

// ---------------------------------------------------------------- geometry helpers
function pebble(cx, cy, rx, ry, flatTop = 0.84, lean = 0) {
  const k = 0.5523, kt = k * flatTop, kb = k * 1.03;
  const top = cy - ry, bot = cy + ry, L = cx - rx, R = cx + rx;
  return `M${f(L)},${f(cy)} C${f(L)},${f(cy - ry * kt)} ${f(cx - rx * k + lean)},${f(top)} ${f(cx + lean)},${f(top)} ` +
    `C${f(cx + rx * k + lean)},${f(top)} ${f(R)},${f(cy - ry * kt)} ${f(R)},${f(cy)} ` +
    `C${f(R)},${f(cy + ry * kb)} ${f(cx + rx * k)},${f(bot)} ${f(cx)},${f(bot)} ` +
    `C${f(cx - rx * k)},${f(bot)} ${f(L)},${f(cy + ry * kb)} ${f(L)},${f(cy)}Z`;
}
function bez(p, t) {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
}
function bezT(p, t) {
  const u = 1 - t;
  return [
    3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The ribbon tail: a filled, twisted, tapering ribbon built from a sampled centre-line.
 * Segment 1 (t < twist) shows the top face, segment 2 shows the underside (lighter), tapering to a soft curl.
 */
function ribbon(attach, lift, curl, pal, muted, scaleX = 1) {
  const [ax, ay] = attach;
  const L = lift;
  const c1 = [
    [ax, ay],
    [ax + 10 * scaleX, ay + 9 - 6 * L],
    [ax + 22 * scaleX, ay + 10 - 20 * L],
    [ax + 29 * scaleX, ay + 1 - 27 * L],
  ];
  const e = c1[3];
  const c2 = [
    e,
    [e[0] + 3.5 * scaleX, e[1] - 4 - 5 * curl],
    [e[0] + (1 - 3 * curl) * scaleX, e[1] - 8 - 8 * curl],
    [e[0] - (3.5 + 5 * curl) * scaleX, e[1] - 7 - 6 * curl],
  ];
  const N = 48, twist = 0.55;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let p, d;
    if (t < 0.62) { const s = t / 0.62; p = bez(c1, s); d = bezT(c1, s); }
    else { const s = (t - 0.62) / 0.38; p = bez(c2, s); d = bezT(c2, s); }
    const len = Math.hypot(d[0], d[1]) || 1;
    const n = [-d[1] / len, d[0] / len];
    // width profile: wide at root, pinch at twist, swell, taper to a point
    let w;
    if (t < twist) w = lerp(5.4, 1.0, smooth(0.08, twist, t));
    else w = lerp(1.0, 3.1, smooth(twist, twist + 0.14, t)) * (1 - smooth(0.78, 1, t) * 0.95);
    if (t > 0.985) w = 0.2;
    pts.push({ p, n, w, t });
  }
  const poly = (sel) => {
    const a = sel.map(s => `${f(s.p[0] + s.n[0] * s.w)},${f(s.p[1] + s.n[1] * s.w)}`);
    const b = sel.slice().reverse().map(s => `${f(s.p[0] - s.n[0] * s.w)},${f(s.p[1] - s.n[1] * s.w)}`);
    return `M${a.join(' L')} L${b.join(' L')}Z`;
  };
  const i1 = pts.filter(s => s.t <= twist + 0.0001);
  const i2 = pts.filter(s => s.t >= twist - 0.0001);
  const top = muted ? pal.mutedRibbon : pal.ribbon;
  const under = muted ? pal.mutedRibbonUnder : pal.ribbonUnder;
  const shade = muted ? pal.mutedShade : pal.ribbonShade;
  const d1 = poly(i1), d2 = poly(i2);
  // a thin shade stripe along the lower edge of segment 1 for a touch of dimension
  const edge = i1.filter((s, i) => i > 2 && s.t < twist - 0.06).map(s => `${f(s.p[0] - s.n[0] * (s.w - 0.9))},${f(s.p[1] - s.n[1] * (s.w - 0.9))}`);
  return `<g>` +
    `<path d="${d1}" fill="${top}" stroke="${pal.outline}" stroke-width="${W_OUT}" stroke-linejoin="round"/>` +
    `<path d="${d2}" fill="${under}" stroke="${pal.outline}" stroke-width="${W_OUT}" stroke-linejoin="round"/>` +
    `<path d="${d1}" fill="${top}"/>` +
    `<path d="${d2}" fill="${under}"/>` +
    (edge.length > 1 ? `<path d="M${edge.join(' L')}" fill="none" stroke="${shade}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.75"/>` : '') +
    `</g>`;
}

// ---------------------------------------------------------------- face parts
function eye(cx, cy, shape, gaze, pal, rxScale = 1) {
  let rx = 7.4 * rxScale, ry = 8.2;
  if (shape === 'happy') {
    return `<path d="M${f(cx - 6.6 * rxScale)},${f(cy + 2.4)} Q${f(cx)},${f(cy - 9)} ${f(cx + 6.6 * rxScale)},${f(cy + 2.4)}" fill="none" stroke="${pal.pupil}" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (shape === 'closed') {
    return `<path d="M${f(cx - 6 * rxScale)},${f(cy - 1)} Q${f(cx)},${f(cy + 5.5)} ${f(cx + 6 * rxScale)},${f(cy - 1)}" fill="none" stroke="${pal.pupil}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  let pr = 3.7, ir = 5.0;
  if (shape === 'wide') { rx *= 1.1; ry *= 1.1; pr = 3.2; ir = 4.6; }
  const px = cx + gaze[0], py = cy + gaze[1];
  let s = `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${pal.eyeWhite}" stroke="${pal.outline}" stroke-width="${W_IN}"/>`;
  s += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(ir)}" fill="${pal.iris}"/>`;
  s += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(pr)}" fill="${pal.pupil}"/>`;
  s += `<circle cx="${f(px - 1.5)}" cy="${f(py - 1.8)}" r="1.7" fill="#FFFFFF"/>`;
  s += `<circle cx="${f(px + 1.4)}" cy="${f(py + 1.5)}" r="0.8" fill="#FFFFFF" fill-opacity="0.9"/>`;
  const lidFrac = shape === 'half' ? 0.48 : shape === 'soft' ? 0.26 : 0;
  if (lidFrac > 0) {
    const yl = cy - ry + 2 * ry * lidFrac;
    const hx = rx * Math.sqrt(Math.max(0, 1 - ((yl - cy) / ry) ** 2));
    const large = lidFrac > 0.5 ? 1 : 0;
    s += `<path d="M${f(cx - hx)},${f(yl)} A${f(rx)},${f(ry)} 0 ${large} 1 ${f(cx + hx)},${f(yl)}Z" fill="${pal.body}"/>`;
    s += `<path d="M${f(cx - hx)},${f(yl)} A${f(rx)},${f(ry)} 0 ${large} 1 ${f(cx + hx)},${f(yl)}" fill="none" stroke="${pal.outline}" stroke-width="${W_IN}"/>`;
    s += `<line x1="${f(cx - hx)}" y1="${f(yl)}" x2="${f(cx + hx)}" y2="${f(yl)}" stroke="${pal.outline}" stroke-width="${W_IN}" stroke-linecap="round"/>`;
  }
  return s;
}
function eyeMuted(cx, cy, shape, gaze, pal, rxScale) {
  return eye(cx, cy, shape, gaze, { ...pal, body: pal.mutedFill }, rxScale);
}

function brow(cx, cy, kind, side, pal) {
  // side: -1 left, +1 right. Brows sit 11.5 above the eye centre.
  if (kind === 'none') return '';
  let y = cy - 11.5, rot = 0, arch = 1.6;
  const raised = kind === 'raised' || (kind === 'raisedLeft' && side < 0) || (kind === 'raisedRight' && side > 0);
  if (raised) { y -= 2.6; arch = 2.4; }
  if (kind === 'worried') rot = 14 * side;       // inner ends up
  if (kind === 'low') { y += 1.6; arch = 0.6; }
  if (kind === 'raisedLeft' && side > 0) { y += 0.6; }
  if (kind === 'raisedRight' && side < 0) { y += 0.6; }
  const d = `M${f(cx - 4.2)},${f(y + arch * 0.4)} Q${f(cx)},${f(y - arch)} ${f(cx + 4.2)},${f(y + arch * 0.4)}`;
  return `<path d="${d}" fill="none" stroke="${pal.outline}" stroke-width="2.3" stroke-linecap="round" transform="rotate(${rot} ${f(cx)} ${f(y)})"/>`;
}

function mouth(cx, cy, kind, pal) {
  const st = `fill="none" stroke="${pal.mouth}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'smile': return `<path d="M${f(cx - 6)},${f(cy - 1.4)} Q${f(cx)},${f(cy + 4.8)} ${f(cx + 6)},${f(cy - 1.4)}" ${st}/>`;
    case 'small': return `<path d="M${f(cx - 3.6)},${f(cy - 0.4)} Q${f(cx)},${f(cy + 2.8)} ${f(cx + 3.6)},${f(cy - 0.4)}" ${st}/>`;
    case 'tiny': return `<path d="M${f(cx - 2)},${f(cy)} Q${f(cx)},${f(cy + 1.6)} ${f(cx + 2)},${f(cy)}" ${st}/>`;
    case 'line': return `<path d="M${f(cx - 4.5)},${f(cy + 0.6)} L${f(cx + 4.5)},${f(cy + 0.6)}" ${st}/>`;
    case 'wavy': return `<path d="M${f(cx - 6)},${f(cy + 0.6)} Q${f(cx - 3)},${f(cy - 2)} ${f(cx)},${f(cy + 0.6)} T${f(cx + 6)},${f(cy + 0.6)}" ${st}/>`;
    case 'o': return `<circle cx="${f(cx)}" cy="${f(cy + 1)}" r="2.7" fill="${pal.mouth}"/>`;
    case 'grin':
      return `<path d="M${f(cx - 8.5)},${f(cy - 2.6)} Q${f(cx)},${f(cy + 12)} ${f(cx + 8.5)},${f(cy - 2.6)} Q${f(cx)},${f(cy)} ${f(cx - 8.5)},${f(cy - 2.6)}Z" fill="${pal.mouth}"/>` +
        `<path d="M${f(cx - 4.2)},${f(cy + 2.6)} Q${f(cx)},${f(cy + 7.6)} ${f(cx + 4.2)},${f(cy + 2.6)} Q${f(cx)},${f(cy + 4)} ${f(cx - 4.2)},${f(cy + 2.6)}Z" fill="${pal.tongue}"/>`;
    case 'open':
      return `<ellipse cx="${f(cx)}" cy="${f(cy + 1.6)}" rx="5.2" ry="5.6" fill="${pal.mouth}"/>` +
        `<ellipse cx="${f(cx)}" cy="${f(cy + 4.8)}" rx="3" ry="2" fill="${pal.tongue}"/>`;
    default: return '';
  }
}

// ---------------------------------------------------------------- limbs
function arm(shoulder, ctrl, hand, pal, muted, big = false) {
  const col = muted ? pal.mutedShade : pal.bodyShade;
  const d = `M${f(shoulder[0])},${f(shoulder[1])} Q${f(ctrl[0])},${f(ctrl[1])} ${f(hand[0])},${f(hand[1])}`;
  const hr = big ? 4.3 : 3.9;
  return `<g>` +
    `<path d="${d}" fill="none" stroke="${pal.outline}" stroke-width="${f(5 + W_OUT * 2)}" stroke-linecap="round"/>` +
    `<circle cx="${f(hand[0])}" cy="${f(hand[1])}" r="${f(hr + W_OUT / 2)}" fill="${pal.outline}"/>` +
    `<path d="${d}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="${f(hand[0])}" cy="${f(hand[1])}" r="${f(hr)}" fill="${col}"/>` +
    `</g>`;
}
const SH_L = [25, 61], SH_R = [75, 61];
function arms(pose, pal, muted) {
  const L = (c, h, big) => arm(SH_L, c, h, pal, muted, big);
  const R = (c, h, big) => arm(SH_R, c, h, pal, muted, big);
  const downL = L([19, 68], [21, 73]), downR = R([81, 68], [79, 73]);
  switch (pose) {
    case 'down': return downL + downR;
    case 'up': return L([15, 52], [16, 39]) + R([85, 52], [84, 39]);
    case 'out': return L([16, 61], [11, 58]) + R([84, 61], [89, 58]);
    case 'wave': return downL + R([85, 50], [86, 38], true);
    case 'ear': return L([17, 56], [23, 50]) + downR;
    case 'chin': return L([25, 72], [41, 72]) + downR;
    case 'clasp': return L([30, 75], [46.5, 73]) + R([70, 75], [53.5, 73]);
    case 'tucked': return L([21, 65], [26, 69]) + R([79, 65], [74, 69]);
    case 'point': return L([14, 52], [13, 40]) + downR;
    case 'thumbs': return downL + R([84, 56], [85, 46], true);
    default: return downL + downR;
  }
}

// ---------------------------------------------------------------- props
function star4(cx, cy, r, fill, pal) {
  const q = r * 0.32;
  return `<path d="M${f(cx)},${f(cy - r)} Q${f(cx + q * 0.4)},${f(cy - q * 0.4)} ${f(cx + r)},${f(cy)} Q${f(cx + q * 0.4)},${f(cy + q * 0.4)} ${f(cx)},${f(cy + r)} Q${f(cx - q * 0.4)},${f(cy + q * 0.4)} ${f(cx - r)},${f(cy)} Q${f(cx - q * 0.4)},${f(cy - q * 0.4)} ${f(cx)},${f(cy - r)}Z" fill="${fill}" stroke="${pal.outline}" stroke-width="1.2" stroke-linejoin="round"/>`;
}
function star5(cx, cy, r, fill, pal) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${pal.outline}" stroke-width="1.2" stroke-linejoin="round"/>`;
}
function soundArcs(cx, cy, radii, a0deg, a1deg, pal) {
  // concentric arcs radiating from (cx, cy), drawn between angles a0..a1 (degrees, SVG clockwise)
  let s = '';
  const a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
  radii.forEach((r, i) => {
    const x1 = cx + Math.cos(a0) * r, y1 = cy + Math.sin(a0) * r;
    const x2 = cx + Math.cos(a1) * r, y2 = cy + Math.sin(a1) * r;
    s += `<path d="M${f(x1)},${f(y1)} A${r},${r} 0 0 1 ${f(x2)},${f(y2)}" fill="none" stroke="${pal.propStroke}" stroke-width="${f(2.4 - i * 0.3)}" stroke-linecap="round" stroke-opacity="${f(1 - i * 0.2)}"/>`;
  });
  return s;
}
function props(kind, pal, muted) {
  switch (kind) {
    case 'sparkles':
      return star4(72, 22, 6, pal.accent, pal) + star4(95, 28, 3.4, pal.accent, pal) + star4(16, 32, 4.2, pal.ribbon, pal);
    case 'soundIn': return soundArcs(-1, 52, [6, 11, 16], -48, 48, pal);
    case 'soundOut': return soundArcs(74, 40, [8, 13, 18], -78, 18, pal);
    case 'thoughtBubbles':
      return `<circle cx="78" cy="38" r="2.2" fill="${pal.propFill}" stroke="${pal.outline}" stroke-width="${W_IN}"/>` +
        `<circle cx="84" cy="30" r="3.3" fill="${pal.propFill}" stroke="${pal.outline}" stroke-width="${W_IN}"/>` +
        `<circle cx="91" cy="19" r="6" fill="${pal.propFill}" stroke="${pal.outline}" stroke-width="${W_IN}"/>`;
    case 'confetti': {
      const piece = (x, y, col, rot) => `<rect x="${x}" y="${y}" width="3.6" height="6.4" rx="1" fill="${col}" transform="rotate(${rot} ${x + 1.8} ${y + 3.2})"/>`;
      return piece(12, 18, pal.ribbon, 22) + piece(84, 14, pal.accent, -28) + piece(92, 58, pal.body, 40) + piece(22, 86, pal.accent, 15) + piece(78, 88, pal.body, -20) +
        `<circle cx="22" cy="34" r="2.4" fill="${pal.accent}"/><circle cx="8" cy="60" r="2" fill="${pal.body}"/><circle cx="68" cy="12" r="2" fill="${pal.ribbon}"/>` +
        star5(28, 14, 5.2, pal.accent, pal) + star5(76, 26, 4.2, pal.ribbon, pal) + star4(10, 80, 3.6, pal.accent, pal);
    }
    case 'replayArrow': {
      const cx = 20, cy = 33, r = 7.5;
      return `<path d="M${f(cx + r * Math.cos(-0.6))},${f(cy + r * Math.sin(-0.6))} A${r},${r} 0 1 0 ${f(cx + r * Math.cos(-2.2))},${f(cy + r * Math.sin(-2.2))}" fill="none" stroke="${pal.propStroke}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<polygon points="${f(cx + r * Math.cos(-2.2) - 4)},${f(cy + r * Math.sin(-2.2) - 2.5)} ${f(cx + r * Math.cos(-2.2) + 3.6)},${f(cy + r * Math.sin(-2.2) - 3.2)} ${f(cx + r * Math.cos(-2.2) + 0.6)},${f(cy + r * Math.sin(-2.2) + 4)}" fill="${pal.accent}" stroke="${pal.outline}" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
    case 'cloudSlash':
      return `<path d="M68,32 a6,6 0 0 1 6,-6 a7.5,7.5 0 0 1 14,1.5 a5,5 0 0 1 2,9.5 h-20 a5,5 0 0 1 -2,-5Z" fill="${pal.propFill}" stroke="${pal.outline}" stroke-width="${W_IN}" stroke-linejoin="round"/>` +
        `<line x1="66" y1="40" x2="92" y2="18" stroke="${pal.danger}" stroke-width="2.6" stroke-linecap="round"/>`;
    default: return '';
  }
}

// ---------------------------------------------------------------- figure
const DEF = {
  eyes: 'open', gaze: [0, 0], brows: 'relaxed', mouth: 'smile', arms: 'down',
  lift: 0.15, curl: 0.4, tilt: 0, cheeks: false, prop: 'none', muted: false, view: 'front',
};

function figure(poseIn, pal, opts = {}) {
  const P = { ...DEF, ...poseIn };
  const muted = !!P.muted;
  const view = P.view;
  const body = muted ? pal.mutedFill : pal.body;
  const shade = muted ? pal.mutedShade : pal.bodyShade;
  const cx = 50, cy = 55;
  let rx = 27, ry = 24, lean = -1.4;
  let eyeL = [40.6, 52], eyeR = [59.4, 52], eyeLs = 1, eyeRs = 1, mouthX = 50, bellyX = 50, attach = [71, 62];
  let tailScale = 1;
  if (view === 'threeq') { eyeL = [36.5, 52]; eyeR = [55, 52]; eyeLs = 1.02; eyeRs = 0.82; mouthX = 45.5; bellyX = 46.5; lean = -2.6; }
  if (view === 'side') { rx = 22; lean = -3; eyeL = [39, 52]; eyeR = null; eyeLs = 0.9; mouthX = 33; bellyX = 43; attach = [64, 62]; tailScale = 1.12; }
  const bottom = cy + ry;
  let s = '';
  s += `<g transform="rotate(${P.tilt} ${cx} ${cy})">`;
  // hover shadow
  if (!opts.noShadow) s += `<ellipse cx="${cx}" cy="${f(bottom + 9.5)}" rx="${f(rx * 0.62)}" ry="2.6" fill="${pal.shadow}" fill-opacity="0.13"/>`;
  // tail (behind body)
  s += ribbon(attach, P.lift, P.curl, pal, muted, tailScale);
  // feet
  const feet = view === 'side' ? [[46, bottom - 0.6], [54, bottom - 0.2]] : [[42.5, bottom - 0.6], [57.5, bottom - 0.6]];
  feet.forEach(([x, y]) => { s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="4.4" ry="2.7" fill="${shade}" stroke="${pal.outline}" stroke-width="${W_OUT}"/>`; });
  // body
  s += `<path d="${pebble(cx, cy, rx, ry, 0.84, lean)}" fill="${body}" stroke="${pal.outline}" stroke-width="${W_OUT}" stroke-linejoin="round"/>`;
  // lower shade crescent
  s += `<path d="M${f(cx - rx + 4)},${f(cy + 6)} C${f(cx - rx + 10)},${f(bottom + 1)} ${f(cx + rx - 10)},${f(bottom + 1)} ${f(cx + rx - 4)},${f(cy + 6)} C${f(cx + rx - 10)},${f(bottom - 4)} ${f(cx - rx + 10)},${f(bottom - 4)} ${f(cx - rx + 4)},${f(cy + 6)}Z" fill="${shade}" fill-opacity="0.38"/>`;
  // belly
  s += `<ellipse cx="${f(bellyX)}" cy="${f(cy + 9.5)}" rx="${f(view === 'side' ? 10 : 13.5)}" ry="8.6" fill="${muted ? '#F3F5F6' : pal.belly}" fill-opacity="0.92"/>`;
  // top-left highlight
  s += `<path d="M${f(cx - 17)},${f(cy - 11)} C${f(cx - 13)},${f(cy - 18)} ${f(cx - 4)},${f(cy - 21)} ${f(cx + 2)},${f(cy - 20.5)} C${f(cx - 6)},${f(cy - 19)} ${f(cx - 12)},${f(cy - 15)} ${f(cx - 15)},${f(cy - 8)}Z" fill="${pal.bodyLight}" fill-opacity="${muted ? 0.35 : 0.8}"/>`;
  // arms
  s += arms(P.arms, pal, muted);
  // cheeks
  if (P.cheeks && view !== 'side') s += `<ellipse cx="${f(eyeL[0] - 6)}" cy="${f(cy + 5)}" rx="4" ry="2.3" fill="${pal.cheek}" fill-opacity="0.85"/><ellipse cx="${f(eyeR[0] + 6)}" cy="${f(cy + 5)}" rx="4" ry="2.3" fill="${pal.cheek}" fill-opacity="0.85"/>`;
  // eyes
  const E = muted ? eyeMuted : eye;
  s += E(eyeL[0], eyeL[1], P.eyes, P.gaze, pal, eyeLs);
  if (eyeR) s += E(eyeR[0], eyeR[1], P.wink ? 'happy' : P.eyes, P.gaze, pal, eyeRs);
  // brows
  if (P.eyes !== 'happy' || P.brows === 'raised') {
    s += brow(eyeL[0], eyeL[1], P.brows, -1, pal);
    if (eyeR) s += brow(eyeR[0], eyeR[1], P.brows, 1, pal);
  }
  // mouth
  s += mouth(mouthX, cy + 10.5, P.mouth, pal);
  s += `</g>`;
  // props (not tilted)
  s += props(P.prop, pal, muted);
  return s;
}

// ---------------------------------------------------------------- state poses
const STATES = {
  neutral: { eyes: 'open', gaze: [0, 0], brows: 'relaxed', mouth: 'smile', arms: 'down', lift: 0.15, curl: 0.45 },
  welcome: { eyes: 'open', gaze: [0.4, -0.4], brows: 'raised', mouth: 'grin', arms: 'wave', lift: 0.6, curl: 0.7, tilt: -4, cheeks: true, prop: 'sparkles' },
  listening: { eyes: 'open', gaze: [-1.8, 0.2], brows: 'raisedLeft', mouth: 'small', arms: 'ear', lift: 0.25, curl: 0.5, tilt: 5, prop: 'soundIn' },
  speaking: { eyes: 'open', gaze: [0.6, -0.4], brows: 'raised', mouth: 'open', arms: 'out', lift: -0.05, curl: 0.4, prop: 'soundOut' },
  thinking: { eyes: 'soft', gaze: [1.6, -1.6], brows: 'raisedRight', mouth: 'line', arms: 'chin', lift: 0, curl: 0.3, tilt: 3, prop: 'thoughtBubbles' },
  celebrate: { eyes: 'happy', brows: 'raised', mouth: 'grin', arms: 'up', lift: 1, curl: 1, tilt: -3, cheeks: true, prop: 'confetti' },
  try_again: { eyes: 'soft', gaze: [-0.6, 0.6], brows: 'worried', mouth: 'small', arms: 'clasp', lift: 0.1, curl: 0.35, tilt: 4, prop: 'replayArrow' },
  offline: { eyes: 'open', gaze: [0, 1.6], brows: 'worried', mouth: 'line', arms: 'tucked', lift: -0.55, curl: 0.2, muted: true, prop: 'cloudSlash' },
};
const LABELS = {
  neutral: 'Mascot, relaxed', welcome: 'Mascot waving hello', listening: 'Mascot listening to you', speaking: 'Mascot speaking',
  thinking: 'Mascot thinking', celebrate: 'Mascot celebrating', try_again: 'Mascot inviting you to try again', offline: 'Mascot, offline',
};

function stateSvg(name, pal, withBg = false) {
  const pose = STATES[name];
  const bg = withBg && pal.bg ? `<rect width="256" height="256" rx="32" fill="${pal.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${LABELS[name]}">\n` +
    `<title>${LABELS[name]}</title>\n${bg}<g transform="translate(4,2) scale(2.4)">${figure(pose, pal)}</g>\n</svg>\n`;
}

// ---------------------------------------------------------------- icon 24
function icon24(pal) {
  // Hand-simplified silhouette: body, two eyes, one filled ribbon, smile. 1 px strokes on a 24 grid.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Mascot icon">
<title>Mascot icon</title>
<path d="M15.2,12.2 C17.6,13.4 18.6,16.6 21,15.4 C22.9,14.4 23.4,11.2 22.8,8.6 C22.3,11 21.2,12.4 19.8,12.1 C18.4,11.8 17.2,10.4 15.2,12.2Z" fill="${pal.ribbon}" stroke="${pal.outline}" stroke-width="0.9" stroke-linejoin="round"/>
<path d="M19.9,12.3 C20.9,12.8 21.7,13.7 22,15" fill="none" stroke="${pal.ribbonShade}" stroke-width="0.7" stroke-linecap="round" stroke-opacity="0.7"/>
<ellipse cx="10.5" cy="12" rx="7.6" ry="6.9" fill="${pal.body}" stroke="${pal.outline}" stroke-width="1.2"/>
<ellipse cx="10.5" cy="14.6" rx="3.4" ry="2.3" fill="${pal.belly}" fill-opacity="0.9"/>
<circle cx="7.9" cy="11" r="2.2" fill="#FFFFFF" stroke="${pal.outline}" stroke-width="0.9"/>
<circle cx="13.1" cy="11" r="2.2" fill="#FFFFFF" stroke="${pal.outline}" stroke-width="0.9"/>
<circle cx="8" cy="11.1" r="1.15" fill="${pal.pupil}"/>
<circle cx="13.2" cy="11.1" r="1.15" fill="${pal.pupil}"/>
<path d="M9,14.6 Q10.5,16 12,14.6" fill="none" stroke="${pal.mouth}" stroke-width="1" stroke-linecap="round"/>
</svg>
`;
}

// ---------------------------------------------------------------- palette sheet
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const gray = (hex) => { const l = lum(hex); const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; const v = Math.round(s * 255).toString(16).padStart(2, '0'); return `#${v}${v}${v}`.toUpperCase(); };
const GRAYPAL = Object.fromEntries(Object.entries(LIGHT).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('#') ? gray(v) : v]));
const FONT = `font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`;

function paletteSvg() {
  const rows = [
    ['body', 'Body fill'], ['bodyShade', 'Body shade, limbs, feet'], ['bodyLight', 'Top highlight'], ['belly', 'Belly'],
    ['ribbon', 'Ribbon top face'], ['ribbonUnder', 'Ribbon underside'], ['ribbonShade', 'Ribbon edge shade'],
    ['outline', 'Outlines'], ['iris', 'Iris ring'], ['pupil', 'Pupil, mouth'], ['tongue', 'Tongue'], ['cheek', 'Blush'],
    ['accent', 'Stars, sparkles, arrow head'], ['danger', 'Slash, error marks'],
    ['muted', 'Muted stroke'], ['mutedFill', 'Muted body (offline/error)'], ['mutedRibbon', 'Muted ribbon'],
    ['propFill', 'Prop fill'], ['propStroke', 'Prop stroke'],
  ];
  const rowH = 30, top = 92, W = 1040, H = top + rows.length * rowH + 150;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="M1 palette">\n<title>M1 palette</title>\n`;
  s += `<rect width="${W}" height="${H}" fill="#F6F8F8"/>`;
  s += `<text x="32" y="40" ${FONT} font-size="22" font-weight="700" fill="#1B3338">M1 palette — refined orbit-creature</text>`;
  s += `<text x="32" y="64" ${FONT} font-size="13" fill="#5B6B70">Token · light · dark · grayscale check (relative luminance of the light value)</text>`;
  const cols = [['Token', 32], ['Light', 330], ['Dark', 560], ['Gray', 790]];
  cols.forEach(([t, x]) => s += `<text x="${x}" y="${top - 8}" ${FONT} font-size="11" font-weight="700" fill="#5B6B70" letter-spacing="1">${t.toUpperCase()}</text>`);
  rows.forEach(([k, desc], i) => {
    const y = top + i * rowH;
    const l = LIGHT[k], d = DARK[k], g = gray(l);
    s += `<text x="32" y="${y + 18}" ${FONT} font-size="13" fill="#1B3338" font-weight="600">${k}</text>`;
    s += `<text x="140" y="${y + 18}" ${FONT} font-size="11" fill="#5B6B70">${desc}</text>`;
    s += `<rect x="330" y="${y + 3}" width="44" height="22" rx="6" fill="${l}" stroke="#1B3338" stroke-opacity="0.25"/><text x="384" y="${y + 18}" ${FONT} font-size="12" fill="#1B3338">${l}</text>`;
    s += `<rect x="560" y="${y + 3}" width="44" height="22" rx="6" fill="${d}" stroke="#1B3338" stroke-opacity="0.25"/><text x="614" y="${y + 18}" ${FONT} font-size="12" fill="#1B3338">${d}</text>`;
    s += `<rect x="790" y="${y + 3}" width="44" height="22" rx="6" fill="${g}" stroke="#1B3338" stroke-opacity="0.25"/><text x="844" y="${y + 18}" ${FONT} font-size="12" fill="#1B3338">${g} · L ${lum(l).toFixed(2)}</text>`;
  });
  // dark preview strip
  const py = top + rows.length * rowH + 20;
  s += `<rect x="32" y="${py}" width="${W - 64}" height="110" rx="16" fill="${DARK.bg}"/>`;
  s += `<g transform="translate(60,${py + 2}) scale(1.05)">${figure(STATES.neutral, DARK)}</g>`;
  s += `<g transform="translate(180,${py + 2}) scale(1.05)">${figure(STATES.welcome, DARK)}</g>`;
  s += `<rect x="330" y="${py + 10}" width="${W - 64 - 310}" height="90" rx="12" fill="#FFFFFF"/>`;
  s += `<g transform="translate(350,${py + 0}) scale(1.05)">${figure(STATES.neutral, LIGHT)}</g>`;
  s += `<g transform="translate(470,${py + 0}) scale(1.05)">${figure(STATES.welcome, LIGHT)}</g>`;
  s += `<g transform="translate(590,${py + 0}) scale(1.05)">${figure(STATES.neutral, GRAYPAL)}</g>`;
  s += `<text x="730" y="${py + 40}" ${FONT} font-size="11" fill="#5B6B70">Three distinct grays:</text>`;
  s += `<text x="730" y="${py + 56}" ${FONT} font-size="11" fill="#5B6B70">outline (dark) · body (mid)</text>`;
  s += `<text x="730" y="${py + 72}" ${FONT} font-size="11" fill="#5B6B70">ribbon (light) · belly (lightest)</text>`;
  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------- model sheet
function dim(x1, y1, x2, y2, label, pal, vertical = false, labelLeft = false) {
  const col = '#5B6B70';
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1"/>`;
  if (vertical) {
    s += `<line x1="${x1 - 3}" y1="${y1}" x2="${x1 + 3}" y2="${y1}" stroke="${col}" stroke-width="1"/><line x1="${x2 - 3}" y1="${y2}" x2="${x2 + 3}" y2="${y2}" stroke="${col}" stroke-width="1"/>`;
    s += labelLeft
      ? `<text x="${x1 - 6}" y="${(y1 + y2) / 2 + 4}" ${FONT} font-size="10" fill="${col}" text-anchor="end">${label}</text>`
      : `<text x="${x1 + 6}" y="${(y1 + y2) / 2 + 4}" ${FONT} font-size="10" fill="${col}">${label}</text>`;
  } else {
    s += `<line x1="${x1}" y1="${y1 - 3}" x2="${x1}" y2="${y1 + 3}" stroke="${col}" stroke-width="1"/><line x1="${x2}" y1="${y2 - 3}" x2="${x2}" y2="${y2 + 3}" stroke="${col}" stroke-width="1"/>`;
    s += `<text x="${(x1 + x2) / 2}" y="${y1 - 5}" ${FONT} font-size="10" fill="${col}" text-anchor="middle">${label}</text>`;
  }
  return s;
}

function modelSheet() {
  const pal = LIGHT;
  const W = 1280, H = 760;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="M1 model sheet">\n<title>M1 model sheet</title>\n`;
  s += `<rect width="${W}" height="${H}" fill="#F6F8F8"/>`;
  s += `<text x="36" y="44" ${FONT} font-size="24" font-weight="700" fill="#1B3338">M1 — refined orbit-creature · model sheet</text>`;
  s += `<text x="36" y="66" ${FONT} font-size="13" fill="#5B6B70">Front · three-quarter · side at 2.1× · proportions · expression vocabulary · size check. Units: 100-unit figure space.</text>`;
  const cap = (x, y, t) => `<text x="${x}" y="${y}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" text-anchor="middle" letter-spacing="1">${t}</text>`;
  // three views
  const views = [['front', 'FRONT'], ['threeq', 'THREE-QUARTER'], ['side', 'SIDE']];
  views.forEach(([v, label], i) => {
    const x = 36 + i * 250, y = 86;
    s += `<rect x="${x}" y="${y}" width="230" height="250" rx="16" fill="#FFFFFF" stroke="#E1E7EA"/>`;
    // ground guides
    [31, 52, 65.5, 79].forEach(gy => s += `<line x1="${x + 8}" y1="${y + 12 + gy * 2.1}" x2="${x + 222}" y2="${y + 12 + gy * 2.1}" stroke="#D5DCE0" stroke-width="1" stroke-dasharray="3 3"/>`);
    s += `<g transform="translate(${x + 4},${y + 12}) scale(2.1)">${figure({ ...STATES.neutral, view: v }, pal)}</g>`;
    s += cap(x + 115, y + 242, label);
  });
  // proportions panel
  {
    const x = 786, y = 86;
    s += `<rect x="${x}" y="${y}" width="458" height="250" rx="16" fill="#FFFFFF" stroke="#E1E7EA"/>`;
    const sc = 2.4, ox = x + 30, oy = y + 4;
    // grid
    for (let g = 0; g <= 100; g += 10) {
      s += `<line x1="${ox + g * sc}" y1="${oy}" x2="${ox + g * sc}" y2="${oy + 100 * sc}" stroke="#EEF2F3" stroke-width="1"/>`;
      s += `<line x1="${ox}" y1="${oy + g * sc}" x2="${ox + 100 * sc}" y2="${oy + g * sc}" stroke="#EEF2F3" stroke-width="1"/>`;
    }
    s += `<g transform="translate(${ox},${oy}) scale(${sc})" opacity="0.95">${figure(STATES.neutral, pal, { noShadow: true })}</g>`;
    const X = (u) => ox + u * sc, Y = (u) => oy + u * sc;
    s += dim(X(23), Y(30), X(77), Y(30), 'body 54 wide', pal);
    s += dim(X(105), Y(31), X(105), Y(79), 'body 48 tall', pal, true);
    s += dim(X(16), Y(43.8), X(16), Y(60.2), 'eye 15 × 16.4', pal, true, true);
    s += dim(X(98), Y(31), X(98), Y(52), 'eye line 0.44', pal, true);
    s += dim(X(23), Y(91), X(99), Y(91), 'tail reach 29 (lift 0.15)', pal);
    s += `<text x="${X(2)}" y="${Y(5)}" ${FONT} font-size="10" fill="#5B6B70">line weight: silhouette 2.6 · interior 2.0</text>`;
    s += `<text x="${X(2)}" y="${Y(10.5)}" ${FONT} font-size="10" fill="#5B6B70">body = pebble, top 16 % flatter than bottom, top leans 1.4 to the left (away from tail)</text>`;
    s += `<text x="${X(2)}" y="${Y(16)}" ${FONT} font-size="10" fill="#5B6B70">tail root at (71, 62), one twist at 55 % length, underside lighter</text>`;
    s += `<text x="${X(2)}" y="${Y(21.5)}" ${FONT} font-size="10" fill="#5B6B70">eye centres 18.8 apart on the 44 % line · hands r 3.9 · feet 8.8 × 5.4</text>`;
    s += cap(x + 229, y + 242, 'PROPORTIONS');
  }
  // expression vocabulary row
  {
    const y = 352;
    s += `<text x="36" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">EYES</text>`;
    const eyes = ['open', 'wide', 'happy', 'half', 'soft', 'closed'];
    eyes.forEach((e, i) => {
      const x = 90 + i * 62;
      s += `<rect x="${x}" y="${y}" width="54" height="54" rx="10" fill="#FFFFFF" stroke="#E1E7EA"/>`;
      s += `<g transform="translate(${x + 27},${y + 27}) scale(2.6) translate(-50,-52)"><rect x="40" y="42" width="20" height="20" fill="${pal.body}" rx="6"/>${eye(50, 52, e, [0, 0], pal)}</g>`;
      s += `<text x="${x + 27}" y="${y + 68}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${e}</text>`;
    });
    s += `<text x="${90 + 6 * 62 + 26}" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">BROWS</text>`;
    const brows = ['relaxed', 'raised', 'raisedRight', 'worried', 'low'];
    brows.forEach((b, i) => {
      const x = 90 + 6 * 62 + 90 + i * 62;
      s += `<rect x="${x}" y="${y}" width="54" height="54" rx="10" fill="#FFFFFF" stroke="#E1E7EA"/>`;
      s += `<g transform="translate(${x + 27},${y + 30}) scale(1.5) translate(-50,-48)"><rect x="28" y="30" width="44" height="36" fill="${pal.body}" rx="10"/>${eye(40.6, 52, 'open', [0, 0], pal)}${eye(59.4, 52, 'open', [0, 0], pal)}${brow(40.6, 52, b, -1, pal)}${brow(59.4, 52, b, 1, pal)}</g>`;
      s += `<text x="${x + 27}" y="${y + 68}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${b === 'raisedRight' ? 'one up' : b}</text>`;
    });
  }
  {
    const y = 440;
    s += `<text x="36" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">MOUTHS</text>`;
    const mouths = ['smile', 'small', 'tiny', 'grin', 'open', 'o', 'line', 'wavy'];
    mouths.forEach((m, i) => {
      const x = 90 + i * 62;
      s += `<rect x="${x}" y="${y}" width="54" height="54" rx="10" fill="#FFFFFF" stroke="#E1E7EA"/>`;
      s += `<g transform="translate(${x + 27},${y + 27}) scale(2.2) translate(-50,-66)"><rect x="38" y="54" width="24" height="24" fill="${pal.body}" rx="6"/>${mouth(50, 65.5, m, pal)}</g>`;
      s += `<text x="${x + 27}" y="${y + 68}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${m}</text>`;
    });
    s += `<text x="${90 + 8 * 62 + 26}" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">ARMS</text>`;
    const poses = ['down', 'up', 'out', 'wave', 'ear', 'chin', 'clasp', 'tucked', 'point', 'thumbs'];
    poses.forEach((p, i) => {
      const x = 90 + 8 * 62 + 80 + i * 60;
      if (x + 54 > W - 36) return;
      s += `<rect x="${x}" y="${y}" width="54" height="54" rx="10" fill="#FFFFFF" stroke="#E1E7EA"/>`;
      s += `<g transform="translate(${x + 27},${y + 27}) scale(0.62) translate(-50,-56)">${figure({ ...STATES.neutral, arms: p, brows: 'none', mouth: 'tiny' }, pal, { noShadow: true })}</g>`;
      s += `<text x="${x + 27}" y="${y + 68}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${p}</text>`;
    });
  }
  // tail lift row + size check
  {
    const y = 532;
    s += `<text x="36" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">TAIL</text>`;
    const lifts = [[-0.8, 0.2, 'droop'], [-0.3, 0.3, 'low'], [0.15, 0.45, 'rest'], [0.6, 0.7, 'lifted'], [1, 1, 'high + curl']];
    lifts.forEach(([l, c, label], i) => {
      const x = 90 + i * 120;
      s += `<rect x="${x}" y="${y}" width="112" height="112" rx="12" fill="#FFFFFF" stroke="#E1E7EA"/>`;
      s += `<g transform="translate(${x + 4},${y + 6}) scale(1.0)">${figure({ ...STATES.neutral, lift: l, curl: c, brows: 'none', mouth: 'small' }, pal, { noShadow: true })}</g>`;
      s += `<text x="${x + 56}" y="${y + 126}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${label} (lift ${l})</text>`;
    });
    const sx = 90 + 5 * 120 + 30;
    s += `<text x="${sx}" y="${y + 18}" ${FONT} font-size="12" font-weight="600" fill="#5B6B70" letter-spacing="1">SIZE CHECK</text>`;
    s += `<rect x="${sx}" y="${y + 28}" width="${W - 36 - sx}" height="112" rx="12" fill="#FFFFFF" stroke="#E1E7EA"/>`;
    const sizes = [[24, 'icon'], [40, 'full'], [64, 'full'], [96, 'full']];
    let cx = sx + 20;
    sizes.forEach(([px, kind]) => {
      if (kind === 'icon') {
        s += `<g transform="translate(${cx},${y + 36})">${icon24(pal).replace(/<svg[^>]*>|<\/svg>|<title>.*<\/title>/g, '')}</g>`;
        s += `<text x="${cx + 12}" y="${y + 154}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">24 (icon)</text>`;
        cx += 60;
      } else {
        const sc = px / 100;
        s += `<g transform="translate(${cx},${y + 34}) scale(${sc})">${figure(STATES.neutral, pal)}</g>`;
        s += `<text x="${cx + px / 2}" y="${y + 154}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">${px}</text>`;
        cx += px + 24;
      }
    });
    // grayscale mini
    s += `<g transform="translate(${cx + 4},${y + 34}) scale(0.8)">${figure(STATES.neutral, GRAYPAL)}</g>`;
    s += `<text x="${cx + 44}" y="${y + 154}" ${FONT} font-size="10" fill="#5B6B70" text-anchor="middle">grayscale</text>`;
  }
  s += `<text x="36" y="${H - 18}" ${FONT} font-size="11" fill="#8A979E">Original vector work for LangQuest · no text is baked into production states · system fonts only on this sheet.</text>`;
  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------- write
fs.mkdirSync(path.join(OUT, 'states'), { recursive: true });
for (const name of Object.keys(STATES)) fs.writeFileSync(path.join(OUT, 'states', `${name}.svg`), stateSvg(name, LIGHT));
fs.writeFileSync(path.join(OUT, 'dark-variant.svg'), stateSvg('neutral', DARK, true));
fs.writeFileSync(path.join(OUT, 'icon-24.svg'), icon24(LIGHT));
fs.writeFileSync(path.join(OUT, 'palette.svg'), paletteSvg());
fs.writeFileSync(path.join(OUT, 'model-sheet.svg'), modelSheet());

// grayscale report
const report = ['outline', 'body', 'bodyShade', 'ribbon', 'ribbonUnder', 'belly'].map(k => `${k}: ${LIGHT[k]} L=${lum(LIGHT[k]).toFixed(3)} ${gray(LIGHT[k])}`);
console.log(report.join('\n'));
console.log('written to', OUT);
