// M3 "chubby chameleon" mascot generator — writes SVGs into design/explorations/mascots/M3.
// Pure Node, no dependencies. All geometry is original and drawn in a 100x100 figure space.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = '/Volumes/SSD-1tb/LangQuest/design/explorations/mascots/M3';
fs.mkdirSync(path.join(OUT, 'states'), { recursive: true });

// ---------- colour helpers ----------
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}
const r1 = (n) => Math.round(n * 10) / 10;

// Base body hue 123 (leaf green). Per-state hue offsets show the "adaptation" mechanic.
function makePalette({ dark = false, hue = 0, muted = false } = {}) {
  const H = 123 + hue;
  const L = dark ? { body: 62, shade: 48, belly: 92 } : { body: 59, shade: 45, belly: 94 };
  const p = {
    body: hslToHex(H, 40, L.body),
    bodyShade: hslToHex(H, 40, L.shade),
    belly: hslToHex(H - 20, 45, L.belly),
    accent: dark ? '#FFBC4F' : '#F2A93B',
    accentShade: dark ? '#E09A2E' : '#D98C1F',
    outline: dark ? '#0E1A12' : '#243B2A',
    pupil: dark ? '#0F1A20' : '#1F2A2E',
    eyeWhite: dark ? '#F4F7F2' : '#FFFFFF',
    cheek: dark ? '#FF9E8A' : '#FFB08A',
    tongue: dark ? '#FF8E9B' : '#F07C8A',
    prop: dark ? '#E8F1EA' : '#243B2A',
    propFill: dark ? '#1C2B20' : '#FFFFFF',
    danger: dark ? '#FF7A7E' : '#E0565B',
    sky: dark ? '#7CC8EA' : '#5FB3D9',
    pink: dark ? '#FF8E9B' : '#F07C8A',
    bg: dark ? '#121A14' : '#FFFFFF',
  };
  if (muted) {
    p.body = dark ? '#5C6A66' : '#C9D1D4';
    p.bodyShade = dark ? '#46524F' : '#A5AFB4';
    p.belly = dark ? '#7E8A87' : '#E8EDEF';
    p.accent = dark ? '#8C9792' : '#B8C0C5';
    p.accentShade = dark ? '#6F7A76' : '#9AA3A8';
    p.cheek = p.belly;
  }
  return p;
}

// ---------- geometry helpers ----------
function bez2(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/**
 * Tapered tail as one filled polygon. Centreline = optional quadratic lead + inward spiral.
 * attach: root point (hidden behind body). startDir: initial tangent.
 * lead: {c:[x,y], b:[x,y]} optional. R: spiral start radius. turns: spiral turns. dir: +1 clockwise on screen, -1 ccw.
 */
function tailPath({ attach, startDir, lead = null, R = 10, turns = 1.5, dir = -1, wStart = 9, wEnd = 2.4, shrink = 0.8 }) {
  const pts = [];
  let dirAtSpiral = norm(startDir);
  let spiralStart = attach;
  if (lead) {
    const n = 14;
    for (let i = 0; i <= n; i++) pts.push(bez2(attach, lead.c, lead.b, i / n));
    spiralStart = lead.b;
    dirAtSpiral = norm([lead.b[0] - lead.c[0], lead.b[1] - lead.c[1]]);
  }
  const s = dir;
  const th0 = Math.atan2(-s * dirAtSpiral[0], s * dirAtSpiral[1]);
  const C = [spiralStart[0] - R * Math.cos(th0), spiralStart[1] - R * Math.sin(th0)];
  const n = Math.round(44 * turns);
  const T = s * turns * Math.PI * 2;
  for (let i = lead ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const r = R * (1 - shrink * t);
    const th = th0 + T * t;
    pts.push([C[0] + r * Math.cos(th), C[1] + r * Math.sin(th)]);
  }
  // arc-length param for width
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tg = norm([b[0] - a[0], b[1] - a[1]]);
    const nrm = [-tg[1], tg[0]];
    const f = cum[i] / total;
    const w = (wStart * (1 - f) + wEnd * f) / 2;
    left.push([pts[i][0] + nrm[0] * w, pts[i][1] + nrm[1] * w]);
    right.push([pts[i][0] - nrm[0] * w, pts[i][1] - nrm[1] * w]);
  }
  // round tip
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const tg = norm([last[0] - prev[0], last[1] - prev[1]]);
  const tip = [];
  for (let k = 1; k < 6; k++) {
    const ang = Math.atan2(-tg[1], -tg[0]) + Math.PI / 2 - (Math.PI * k) / 6; // from left normal round the tip to right normal
    const ang2 = Math.atan2(tg[1], tg[0]) + Math.PI / 2 - (Math.PI * k) / 6;
    tip.push([last[0] + (wEnd / 2) * Math.cos(ang2), last[1] + (wEnd / 2) * Math.sin(ang2)]);
  }
  const poly = [...left, ...tip, ...right.reverse()];
  return 'M' + poly.map((p) => `${r1(p[0])},${r1(p[1])}`).join('L') + 'Z';
}

// ---------- part drawers (front/three-quarter share these) ----------
function eyeTurret(cx, cy, P, { r = 11, gaze = [0, 0], shape = 'open', lid = 0, scale = 1 }) {
  const rr = r * scale, ew = 8 * scale, pr = 4.2 * scale;
  let s = `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${P.bodyShade}" stroke="${P.outline}" stroke-width="2.2"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r1(rr - 1.9)}" fill="none" stroke="${P.belly}" stroke-opacity="0.45" stroke-width="1.2"/>`;
  if (shape === 'happy') {
    s += `<circle cx="${cx}" cy="${cy}" r="${ew}" fill="${P.body}" stroke="${P.outline}" stroke-width="1.8"/>`;
    s += `<path d="M${r1(cx - 5.2 * scale)},${r1(cy + 1.6 * scale)} Q${cx},${r1(cy - 6 * scale)} ${r1(cx + 5.2 * scale)},${r1(cy + 1.6 * scale)}" fill="none" stroke="${P.outline}" stroke-width="2.6" stroke-linecap="round"/>`;
    return s;
  }
  if (shape === 'closed') {
    s += `<circle cx="${cx}" cy="${cy}" r="${ew}" fill="${P.body}" stroke="${P.outline}" stroke-width="1.8"/>`;
    s += `<path d="M${r1(cx - 5 * scale)},${r1(cy - 1)} Q${cx},${r1(cy + 4 * scale)} ${r1(cx + 5 * scale)},${r1(cy - 1)}" fill="none" stroke="${P.outline}" stroke-width="2.4" stroke-linecap="round"/>`;
    return s;
  }
  const wide = shape === 'wide' ? 1.12 : 1;
  s += `<circle cx="${cx}" cy="${cy}" r="${r1(ew * wide)}" fill="${P.eyeWhite}" stroke="${P.outline}" stroke-width="1.8"/>`;
  const px = r1(cx + gaze[0] * 3.2 * scale), py = r1(cy + gaze[1] * 3.2 * scale);
  s += `<circle cx="${px}" cy="${py}" r="${r1(pr * wide)}" fill="${P.pupil}"/>`;
  s += `<circle cx="${r1(px - 1.5 * scale)}" cy="${r1(py - 1.6 * scale)}" r="${r1(1.5 * scale)}" fill="${P.eyeWhite}"/>`;
  if (lid > 0) {
    const R = ew * wide, lidY = cy - R + 2 * R * lid, hc = Math.sqrt(Math.max(0, R * R - (lidY - cy) ** 2));
    const large = lid > 0.5 ? 1 : 0;
    s += `<path d="M${r1(cx - hc)},${r1(lidY)} A${r1(R)},${r1(R)} 0 ${large} 1 ${r1(cx + hc)},${r1(lidY)} Z" fill="${P.bodyShade}" stroke="${P.outline}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }
  return s;
}

function mouth(kind, P, cx = 50, cy = 60) {
  const w = 2.4;
  switch (kind) {
    case 'smile': return `<path d="M${cx - 12},${cy - 2} Q${cx},${cy + 7} ${cx + 12},${cy - 2}" fill="none" stroke="${P.outline}" stroke-width="${w}" stroke-linecap="round"/>`;
    case 'small': return `<path d="M${cx - 6},${cy - 1} Q${cx},${cy + 3.5} ${cx + 6},${cy - 1}" fill="none" stroke="${P.outline}" stroke-width="${w}" stroke-linecap="round"/>`;
    case 'grin': return `<path d="M${cx - 13},${cy - 3} Q${cx},${cy + 12} ${cx + 13},${cy - 3} Q${cx},${cy + 2} ${cx - 13},${cy - 3} Z" fill="${P.pupil}" stroke="${P.outline}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M${cx - 5},${cy + 2.2} Q${cx},${cy + 8.5} ${cx + 5},${cy + 2.2} Z" fill="${P.tongue}"/>`;
    case 'open': return `<ellipse cx="${cx}" cy="${cy + 1.5}" rx="6" ry="5.2" fill="${P.pupil}" stroke="${P.outline}" stroke-width="2"/>` +
      `<ellipse cx="${cx}" cy="${cy + 4.2}" rx="3.2" ry="1.9" fill="${P.tongue}"/>`;
    case 'o': return `<circle cx="${cx + 4}" cy="${cy}" r="2.7" fill="${P.pupil}" stroke="${P.outline}" stroke-width="1.6"/>`;
    case 'line': return `<path d="M${cx - 8},${cy} L${cx + 8},${cy}" fill="none" stroke="${P.outline}" stroke-width="${w}" stroke-linecap="round"/>`;
    case 'wavy': return `<path d="M${cx - 9},${cy} Q${cx - 4.5},${cy - 3} ${cx},${cy} Q${cx + 4.5},${cy + 3} ${cx + 9},${cy}" fill="none" stroke="${P.outline}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  return '';
}

function arm(P, from, ctrl, to) {
  const d = `M${from[0]},${from[1]} Q${ctrl[0]},${ctrl[1]} ${to[0]},${to[1]}`;
  const tg = norm([to[0] - ctrl[0], to[1] - ctrl[1]]);
  const n = [-tg[1], tg[0]];
  const h1 = [r1(to[0] + n[0] * 1.9), r1(to[1] + n[1] * 1.9)], h2 = [r1(to[0] - n[0] * 1.9), r1(to[1] - n[1] * 1.9)];
  let s = `<path d="${d}" fill="none" stroke="${P.outline}" stroke-width="7.6" stroke-linecap="round"/>`;
  s += `<circle cx="${h1[0]}" cy="${h1[1]}" r="3.9" fill="${P.outline}"/><circle cx="${h2[0]}" cy="${h2[1]}" r="3.9" fill="${P.outline}"/>`;
  s += `<path d="${d}" fill="none" stroke="${P.bodyShade}" stroke-width="4.8" stroke-linecap="round"/>`;
  s += `<circle cx="${h1[0]}" cy="${h1[1]}" r="2.6" fill="${P.bodyShade}"/><circle cx="${h2[0]}" cy="${h2[1]}" r="2.6" fill="${P.bodyShade}"/>`;
  return s;
}

function foot(P, x, y) {
  return `<circle cx="${x - 2.3}" cy="${y}" r="3.9" fill="${P.outline}"/><circle cx="${x + 2.3}" cy="${y}" r="3.9" fill="${P.outline}"/>` +
    `<circle cx="${x - 2.3}" cy="${y}" r="2.4" fill="${P.bodyShade}"/><circle cx="${x + 2.3}" cy="${y}" r="2.4" fill="${P.bodyShade}"/>`;
}

const BODY_FRONT = 'M50,18 C63,18 73,28 73,40 C73,50 78,60 77,70 C76,82 64,88 50,88 C36,88 24,82 23,70 C22,60 27,50 27,40 C27,28 37,18 50,18 Z';
const CASQUE_FRONT = 'M36,27 C38,6 62,6 64,27 Z';

// ---------- props ----------
function star4(x, y, r, fill) { return `<path d="M${x},${r1(y - r)} Q${x},${y} ${r1(x + r)},${y} Q${x},${y} ${x},${r1(y + r)} Q${x},${y} ${r1(x - r)},${y} Q${x},${y} ${x},${r1(y - r)} Z" fill="${fill}"/>`; }
function soundArcs(P, x, y, dirx) {
  let s = '';
  for (let i = 0; i < 3; i++) {
    const r = 5 + i * 4.2;
    s += `<path d="M${r1(x + dirx * 0)},${r1(y - r)} A${r},${r} 0 0 ${dirx > 0 ? 1 : 0} ${r1(x)},${r1(y + r)}" fill="none" stroke="${P.prop}" stroke-width="2.2" stroke-linecap="round" stroke-opacity="${1 - i * 0.22}" transform="translate(${dirx * i * 1.2},0)"/>`;
  }
  return s;
}
function thoughtBubbles(P, x, y) {
  return `<circle cx="${x}" cy="${y}" r="1.8" fill="${P.propFill}" stroke="${P.prop}" stroke-width="1.6"/>` +
    `<circle cx="${x + 4.5}" cy="${y - 5}" r="2.8" fill="${P.propFill}" stroke="${P.prop}" stroke-width="1.6"/>` +
    `<circle cx="${x + 11}" cy="${y - 12}" r="5" fill="${P.propFill}" stroke="${P.prop}" stroke-width="1.8"/>`;
}
function confetti(P) {
  const pieces = [[14, 20, -20, P.accent], [22, 10, 30, P.sky], [80, 12, 15, P.pink], [90, 24, -35, P.accent], [10, 40, 50, P.pink], [92, 44, -15, P.sky], [30, 6, 0, P.pink], [70, 6, 40, P.sky]];
  let s = pieces.map(([x, y, a, c]) => `<rect x="${x - 1.6}" y="${y - 3}" width="3.2" height="6" rx="1" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join('');
  s += star4(18, 30, 4, P.accent) + star4(84, 34, 5, P.accent) + star4(50, 6, 3.5, P.accent);
  return s;
}
function replayArrow(P, x, y) {
  return `<circle cx="${x}" cy="${y}" r="9.5" fill="${P.propFill}" stroke="${P.prop}" stroke-width="1.8"/>` +
    `<path d="M${x + 5.2},${y - 1.5} A5.5,5.5 0 1 0 ${x + 3.8},${y + 4}" fill="none" stroke="${P.accentShade}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M${x + 1.8},${y - 4.8} L${x + 6.2},${y - 1.2} L${x + 1.4},${y + 0.4} Z" fill="${P.accentShade}"/>`;
}
function offlineCloud(P, x, y) {
  return `<path d="M${x - 9},${y + 4} a4.5,4.5 0 0 1 0.6,-9 a6,6 0 0 1 11.4,-2.4 a5,5 0 0 1 6.2,6.1 a3.6,3.6 0 0 1 -0.6,5.3 Z" fill="${P.propFill}" stroke="${P.prop}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<path d="M${x - 9},${y + 6} L${x + 10},${y - 10}" fill="none" stroke="${P.danger}" stroke-width="2.6" stroke-linecap="round"/>`;
}
function sparkles(P, list) { return list.map(([x, y, r]) => star4(x, y, r, P.accent)).join(''); }

// ---------- figure assembly (front view) ----------
function figure(P, pose) {
  const {
    tilt = 0, gaze = [0, 0], gazeL = null, gazeR = null, eyes = 'open', eyesL = null, eyesR = null, lid = 0, lidL = null, lidR = null,
    eyeScaleR = 1, eyeScaleL = 1, mouthKind = 'smile', mouthDx = 0, arms = 'down', cheeks = false, tail, stripes = true, shiftX = 0,
  } = pose;
  let s = `<g transform="translate(50,60) rotate(${tilt}) translate(${-50 + shiftX},-60)">`;
  // tail (behind body)
  s += `<path d="${tailPath(tail)}" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  // casque (behind body)
  s += `<path d="${CASQUE_FRONT}" fill="${P.accent}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  // feet (behind body bottom edge)
  s += foot(P, 39, 87) + foot(P, 61, 87);
  // body
  s += `<path d="${BODY_FRONT}" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M27,66 C34,84 66,84 73,66 C66,80 34,80 27,66 Z" fill="${P.bodyShade}" fill-opacity="0.4"/>`;
  s += `<ellipse cx="50" cy="72" rx="15" ry="10" fill="${P.belly}" fill-opacity="0.92"/>`;
  if (stripes) {
    s += `<path d="M28.5,55 Q35,62 30,71" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
    s += `<path d="M71.5,55 Q65,62 70,71" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
    s += `<circle cx="35" cy="77" r="1.7" fill="${P.accent}" fill-opacity="0.75"/><circle cx="65" cy="77" r="1.7" fill="${P.accent}" fill-opacity="0.75"/>`;
  }
  s += `<ellipse cx="40" cy="27" rx="7" ry="3.2" fill="#FFFFFF" fill-opacity="0.35" transform="rotate(-28 40 27)"/>`;
  // arms
  const A = {
    down: [[[26, 63], [20, 70], [22, 77]], [[74, 63], [80, 70], [78, 77]]],
    wave: [[[26, 63], [20, 70], [22, 77]], [[74, 60], [85, 55], [86, 43]]],
    out: [[[26, 62], [15, 58], [11, 62]], [[74, 62], [85, 58], [89, 62]]],
    chin: [[[26, 63], [20, 70], [22, 77]], [[74, 63], [72, 72], [61, 67]]],
    clasp: [[[26, 64], [33, 78], [47, 75]], [[74, 64], [67, 78], [53, 75]]],
    up: [[[26, 60], [15, 52], [16, 40]], [[74, 60], [85, 52], [84, 40]]],
    gesture: [[[26, 62], [16, 60], [12, 66]], [[74, 61], [86, 54], [92, 56]]],
    hug: [[[26, 64], [30, 74], [40, 73]], [[74, 64], [70, 74], [60, 73]]],
  }[arms];
  s += arm(P, ...A[0]) + arm(P, ...A[1]);
  // cheeks
  if (cheeks) s += `<ellipse cx="35" cy="56" rx="4" ry="2.4" fill="${P.cheek}" fill-opacity="0.8"/><ellipse cx="65" cy="56" rx="4" ry="2.4" fill="${P.cheek}" fill-opacity="0.8"/>`;
  // mouth
  s += mouth(mouthKind, P, 50 + mouthDx, 60);
  // eyes
  s += eyeTurret(33, 42, P, { gaze: gazeL || gaze, shape: eyesL || eyes, lid: lidL ?? lid, scale: eyeScaleL });
  s += eyeTurret(67, 42, P, { gaze: gazeR || gaze, shape: eyesR || eyes, lid: lidR ?? lid, scale: eyeScaleR });
  s += '</g>';
  return s;
}

const TAIL_NEUTRAL = { attach: [73, 77], startDir: [0.1, 1], R: 10, turns: 1.45, dir: -1 };

const STATES = {
  neutral: { hue: 0, label: 'Mascot, relaxed', pose: { tail: TAIL_NEUTRAL } },
  welcome: {
    hue: -16, label: 'Mascot waving hello',
    pose: { eyes: 'wide', mouthKind: 'grin', arms: 'wave', cheeks: true, tilt: -4, tail: { attach: [73, 76], startDir: [1, 0.2], lead: { c: [88, 72], b: [92, 58] }, R: 6.5, turns: 1.1, dir: -1, wStart: 9, wEnd: 2.4 } },
    props: (P) => sparkles(P, [[88, 28, 4], [95, 40, 2.6], [8, 30, 3]]),
  },
  listening: {
    hue: 36, label: 'Mascot listening to you',
    pose: { tilt: 7, gaze: [-1, 0.1], eyeScaleL: 1.08, mouthKind: 'small', arms: 'down', tail: { attach: [73, 77], startDir: [0.1, 1], R: 8.5, turns: 1.9, dir: -1, shrink: 0.82 } },
    props: (P) => soundArcs(P, 12, 44, -1),
  },
  speaking: {
    hue: -18, label: 'Mascot speaking',
    pose: { mouthKind: 'open', arms: 'gesture', eyes: 'open', tail: { attach: [73, 75], startDir: [1, -0.1], lead: { c: [86, 72], b: [93, 78] }, R: 4.5, turns: 1, dir: 1, wStart: 9, wEnd: 2.4 } },
    props: (P) => soundArcs(P, 88, 30, 1),
  },
  thinking: {
    hue: 62, label: 'Mascot thinking',
    pose: { tilt: 3, gazeL: [0.2, 0.1], gazeR: [0.9, -0.9], lidL: 0.16, mouthKind: 'o', arms: 'chin', tail: { attach: [73, 74], startDir: [1, -0.6], lead: { c: [92, 66], b: [88, 46] }, R: 6, turns: 1.1, dir: -1, wStart: 9, wEnd: 2.4 } },
    props: (P) => thoughtBubbles(P, 78, 28),
  },
  celebrate: {
    hue: -34, label: 'Mascot celebrating',
    pose: { eyes: 'happy', mouthKind: 'grin', arms: 'up', cheeks: true, tilt: -3, tail: { attach: [73, 74], startDir: [1, -0.8], lead: { c: [92, 64], b: [86, 42] }, R: 7, turns: 1.3, dir: 1, wStart: 9, wEnd: 2.4 } },
    props: (P) => confetti(P),
  },
  try_again: {
    hue: 14, label: 'Mascot inviting you to try again',
    pose: { tilt: 4, lid: 0.22, mouthKind: 'small', arms: 'clasp', tail: { attach: [73, 78], startDir: [0.4, 1], R: 9, turns: 1.2, dir: -1 } },
    props: (P) => replayArrow(P, 86, 26),
  },
  offline: {
    hue: 0, muted: true, label: 'Mascot, offline',
    pose: { gaze: [0.2, 0.9], mouthKind: 'line', arms: 'down', stripes: true, tail: { attach: [73, 78], startDir: [0.5, 1], lead: { c: [82, 90], b: [90, 84] }, R: 4, turns: 0.9, dir: -1, wStart: 8, wEnd: 2.2 } },
    props: (P) => offlineCloud(P, 84, 24),
  },
};

function svgDoc(inner, { size = 256, label, dark = false, bg = false, vb = '0 0 100 100' } = {}) {
  const [, , vw, vh] = vb.split(' ').map(Number);
  const w = size, h = Math.round((size * vh) / vw);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="${label}">\n<title>${label}</title>\n` +
    (bg ? `<rect width="${vw}" height="${vh}" rx="${Math.min(vw, vh) * 0.08}" fill="${bg}"/>\n` : '') + inner + '\n</svg>\n';
}

// ---------- write states ----------
for (const [name, st] of Object.entries(STATES)) {
  const P = makePalette({ hue: st.hue, muted: !!st.muted });
  const inner = figure(P, st.pose) + (st.props ? st.props(P) : '');
  fs.writeFileSync(path.join(OUT, 'states', `${name}.svg`), svgDoc(inner, { label: st.label }));
}

// ---------- dark variant (neutral on dark palette) ----------
{
  const P = makePalette({ dark: true });
  fs.writeFileSync(path.join(OUT, 'dark-variant.svg'), svgDoc(figure(P, STATES.neutral.pose), { label: 'Mascot, relaxed (dark theme)', bg: P.bg }));
}

// ---------- icon 24 ----------
{
  const P = makePalette();
  const inner = `<g>` +
    // tail: two thick strokes, outline then fill
    `<path d="M17,18.2 C20.5,20.6 22.8,18 21.2,15.6 C20.2,14.2 18.6,15 19.2,16.6" fill="none" stroke="${P.outline}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M17,18.2 C20.5,20.6 22.8,18 21.2,15.6 C20.2,14.2 18.6,15 19.2,16.6" fill="none" stroke="${P.body}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>` +
    // casque
    `<path d="M8.6,7.2 C9.3,1.6 14.7,1.6 15.4,7.2 Z" fill="${P.accent}" stroke="${P.outline}" stroke-width="1.3" stroke-linejoin="round"/>` +
    // body
    `<path d="M12,4.5 C15.2,4.5 17.4,7 17.4,9.8 C17.4,12.2 18.6,14.4 18.3,16.8 C18,19.8 15.2,21.2 12,21.2 C8.8,21.2 6,19.8 5.7,16.8 C5.4,14.4 6.6,12.2 6.6,9.8 C6.6,7 8.8,4.5 12,4.5 Z" fill="${P.body}" stroke="${P.outline}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<ellipse cx="12" cy="17" rx="3.4" ry="2.3" fill="${P.belly}" fill-opacity="0.9"/>` +
    // mouth
    `<path d="M9.6,13.6 Q12,15.6 14.4,13.6" fill="none" stroke="${P.outline}" stroke-width="1.2" stroke-linecap="round"/>` +
    // eye turrets
    `<circle cx="8" cy="10" r="3.1" fill="${P.bodyShade}" stroke="${P.outline}" stroke-width="1.3"/><circle cx="16" cy="10" r="3.1" fill="${P.bodyShade}" stroke="${P.outline}" stroke-width="1.3"/>` +
    `<circle cx="8" cy="10" r="1.9" fill="${P.eyeWhite}"/><circle cx="16" cy="10" r="1.9" fill="${P.eyeWhite}"/>` +
    `<circle cx="8.2" cy="10.2" r="1.05" fill="${P.pupil}"/><circle cx="16.2" cy="10.2" r="1.05" fill="${P.pupil}"/>` +
    `</g>`;
  fs.writeFileSync(path.join(OUT, 'icon-24.svg'), svgDoc(inner, { size: 24, label: 'Mascot icon', vb: '0 0 24 24' }));
}

// ---------- palette sheet ----------
{
  const L = makePalette(), D = makePalette({ dark: true }), M = makePalette({ muted: true });
  const font = 'font-family="-apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif"';
  const rows = [
    ['body', L.body, D.body], ['bodyShade', L.bodyShade, D.bodyShade], ['belly', L.belly, D.belly], ['accent (casque, bands)', L.accent, D.accent],
    ['accentShade', L.accentShade, D.accentShade], ['outline', L.outline, D.outline], ['pupil', L.pupil, D.pupil], ['eyeWhite', L.eyeWhite, D.eyeWhite],
    ['cheek', L.cheek, D.cheek], ['tongue', L.tongue, D.tongue], ['danger (slash)', L.danger, D.danger], ['muted body', M.body, makePalette({ dark: true, muted: true }).body],
    ['muted accent', M.accent, makePalette({ dark: true, muted: true }).accent], ['prop fill', L.propFill, D.propFill], ['background (dark)', '—', D.bg],
  ];
  let s = `<rect width="860" height="640" fill="#F7F7F5"/>`;
  s += `<text x="24" y="36" ${font} font-size="20" font-weight="700" fill="#243B2A">M3 chameleon palette</text>`;
  s += `<text x="24" y="58" ${font} font-size="12" fill="#55665A">Semantic tokens. Left swatch = light theme, right swatch = dark theme. Body hue shifts per state / course family (see dial).</text>`;
  s += `<text x="24" y="86" ${font} font-size="11" font-weight="700" fill="#55665A">TOKEN</text><text x="230" y="86" ${font} font-size="11" font-weight="700" fill="#55665A">LIGHT</text><text x="400" y="86" ${font} font-size="11" font-weight="700" fill="#55665A">DARK</text>`;
  rows.forEach(([name, l, d], i) => {
    const y = 98 + i * 30;
    s += `<text x="24" y="${y + 19}" ${font} font-size="13" fill="#243B2A">${name}</text>`;
    if (l !== '—') s += `<rect x="230" y="${y}" width="40" height="26" rx="6" fill="${l}" stroke="#243B2A" stroke-opacity="0.25"/>`;
    s += `<text x="280" y="${y + 18}" ${font} font-size="12" fill="#243B2A">${l}</text>`;
    s += `<rect x="400" y="${y}" width="40" height="26" rx="6" fill="${d}" stroke="#243B2A" stroke-opacity="0.25"/>`;
    s += `<text x="450" y="${y + 18}" ${font} font-size="12" fill="#243B2A">${d}</text>`;
  });
  // hue dial: six course-family tints of the body hue
  const tints = [['Tint 1  (−40°)', -40], ['Tint 2  (−18°)', -18], ['Tint 3  (base)', 0], ['Tint 4  (+20°)', 20], ['Tint 5  (+42°)', 42], ['Tint 6  (+66°)', 66]];
  s += `<text x="560" y="86" ${font} font-size="11" font-weight="700" fill="#55665A">BODY HUE DIAL (course-family tints)</text>`;
  tints.forEach(([name, h], i) => {
    const y = 98 + i * 54;
    const Pt = makePalette({ hue: h });
    s += `<rect x="560" y="${y}" width="44" height="44" rx="10" fill="${Pt.body}" stroke="#243B2A" stroke-opacity="0.25"/>`;
    s += `<rect x="604" y="${y + 8}" width="14" height="28" rx="4" fill="${Pt.bodyShade}"/>`;
    s += `<text x="628" y="${y + 18}" ${font} font-size="12" fill="#243B2A">${name}</text><text x="628" y="${y + 34}" ${font} font-size="11" fill="#55665A">${Pt.body} / ${Pt.bodyShade}</text>`;
  });
  s += `<text x="560" y="436" ${font} font-size="10.5" fill="#55665A">Accent, outline and belly never shift, so the</text><text x="560" y="450" ${font} font-size="10.5" fill="#55665A">silhouette + crest stay the brand anchor.</text>`;
  s += `<text x="560" y="470" ${font} font-size="10.5" fill="#55665A">Tint-to-family mapping is a product decision;</text><text x="560" y="484" ${font} font-size="10.5" fill="#55665A">tints are abstract and never echo a flag.</text>`;
  // grayscale check strip
  s += `<text x="24" y="574" ${font} font-size="11" font-weight="700" fill="#55665A">GRAYSCALE CHECK (luminance order: outline &lt; bodyShade &lt; body &lt; accent &lt; belly)</text>`;
  [L.outline, L.bodyShade, L.body, L.accent, L.belly].forEach((c, i) => {
    const hex = c.slice(1); const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    s += `<rect x="${24 + i * 70}" y="584" width="60" height="30" rx="6" fill="${c}"/><rect x="${24 + i * 70}" y="616" width="60" height="12" fill="rgb(${y},${y},${y})"/>`;
  });
  fs.writeFileSync(path.join(OUT, 'palette.svg'), svgDoc(s, { size: 860, label: 'M3 chameleon palette sheet', vb: '0 0 860 640' }));
}

// ---------- model sheet ----------
function sideView(P) {
  let s = '';
  // tail behind body, curling under to the left
  s += `<path d="${tailPath({ attach: [30, 80], startDir: [-0.3, 1], R: 9.5, turns: 1.4, dir: 1, wStart: 9, wEnd: 2.4 })}" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  // casque on the back of the head
  s += `<path d="M27,36 C25,10 50,3 61,18 Z" fill="${P.accent}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += foot(P, 40, 87) + foot(P, 60, 87);
  // body profile with snout
  s += `<path d="M42,18 C56,15 72,28 75,45 C76,50 73,54 66,55 C72,66 73,80 62,87 C52,90 36,90 29,84 C21,78 20,60 24,46 C27,30 32,20 42,18 Z" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M28,70 C38,86 60,86 68,68 C60,80 36,82 28,70 Z" fill="${P.bodyShade}" fill-opacity="0.4"/>`;
  s += `<ellipse cx="52" cy="74" rx="14" ry="9.5" fill="${P.belly}" fill-opacity="0.92"/>`;
  s += `<path d="M34,50 Q42,60 36,72" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
  s += `<path d="M48,56 Q56,64 50,78" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
  s += `<ellipse cx="44" cy="26" rx="7" ry="3.2" fill="#FFFFFF" fill-opacity="0.35" transform="rotate(-20 44 26)"/>`;
  // mouth: long chameleon smile running back from the snout
  s += `<path d="M72,50 Q62,58 46,54" fill="none" stroke="${P.outline}" stroke-width="2.4" stroke-linecap="round"/>`;
  // arm
  s += arm(P, [58, 66], [64, 72], [62, 79]);
  // eye turret (single, mid-head)
  s += eyeTurret(56, 38, P, { gaze: [0.6, 0], scale: 1.05 });
  return s;
}
function threeQuarterView(P) {
  let s = '';
  s += `<path d="${tailPath({ attach: [74, 77], startDir: [0.2, 1], R: 10, turns: 1.45, dir: -1 })}" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M33,26 C35,6 60,5 64,25 Z" fill="${P.accent}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += foot(P, 41, 87) + foot(P, 62, 87);
  s += `<path d="M48,17 C62,17 73,27 74,42 C76,48 76,52 71,54 C77,62 79,72 75,78 C70,88 57,89 48,89 C36,89 24,84 23,72 C21,60 26,50 27,40 C27,28 36,17 48,17 Z" fill="${P.body}" stroke="${P.outline}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M27,68 C34,86 66,86 73,68 C66,82 34,82 27,68 Z" fill="${P.bodyShade}" fill-opacity="0.4"/>`;
  s += `<ellipse cx="51" cy="73" rx="15" ry="10" fill="${P.belly}" fill-opacity="0.92"/>`;
  s += `<path d="M29,55 Q36,62 31,72" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
  s += `<path d="M66,60 Q71,66 68,75" fill="none" stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.85"/>`;
  s += `<ellipse cx="40" cy="26" rx="7" ry="3.2" fill="#FFFFFF" fill-opacity="0.35" transform="rotate(-28 40 26)"/>`;
  s += `<path d="M42,58 Q56,67 69,55" fill="none" stroke="${P.outline}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += arm(P, [26, 63], [20, 70], [22, 77]) + arm(P, [74, 64], [80, 70], [78, 77]);
  s += eyeTurret(36, 41, P, { gaze: [0.4, 0], scale: 0.9 });
  s += eyeTurret(65, 40, P, { gaze: [0.3, 0], scale: 1.08 });
  return s;
}
{
  const P = makePalette();
  const font = 'font-family="-apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif"';
  const G = '#8A948C';
  let s = `<rect width="1200" height="700" fill="#F7F7F5"/>`;
  s += `<text x="32" y="44" ${font} font-size="22" font-weight="700" fill="#243B2A">M3 — chubby chameleon mascot · model sheet</text>`;
  s += `<text x="32" y="66" ${font} font-size="12" fill="#55665A">Figure space 100 × 100 units. Outline 2.2 u everywhere; props 1.8–2.2 u. No neck, no claws, no teeth. Tail always attaches lower-right (mirror whole figure for RTL).</text>`;
  const views = [['FRONT', (p) => figure(p, STATES.neutral.pose)], ['THREE-QUARTER', threeQuarterView], ['SIDE', sideView]];
  views.forEach(([name, fn], i) => {
    const x = 40 + i * 300, y = 100, sc = 2.6;
    s += `<text x="${x}" y="${y - 8}" ${font} font-size="12" font-weight="700" fill="#55665A">${name}</text>`;
    // guide lines
    [[18, 'crown'], [42, 'eye axis'], [60, 'mouth'], [88, 'ground']].forEach(([gy, lbl]) => {
      s += `<line x1="${x}" y1="${y + gy * sc}" x2="${x + 100 * sc}" y2="${y + gy * sc}" stroke="${G}" stroke-width="1" stroke-dasharray="3 3"/>`;
      if (i === 0) s += `<text x="${x + 100 * sc + 6}" y="${y + gy * sc + 4}" ${font} font-size="10" fill="${G}">${lbl}</text>`;
    });
    s += `<g transform="translate(${x},${y}) scale(${sc})">${fn(P)}</g>`;
  });
  // proportions / notes column
  const nx = 40, ny = 395;
  s += `<text x="${nx}" y="${ny}" ${font} font-size="12" font-weight="700" fill="#55665A">PROPORTIONS</text>`;
  const notes = [
    'Body: pear, 50 u wide at head, 54 u at hips, 70 u tall (crown 18 → ground 88). The head IS the body.',
    'Eye turrets: Ø 22 u, centred on the eye axis (y 42), bulging 5 u past the head edge — the signature of the silhouette.',
    'Each eye swivels independently (chameleon trait) — used for listening, thinking and curiosity.',
    'Crest (casque): soft dome 20 u wide × 9 u tall, accent colour; never pointed.',
    'Tail: tapered 9 → 2.4 u, inward spiral Ø ~20 u; used as a gesture (wave, point, curl, droop).',
    'Mouth: wide, low (y 60), 24 u span — reads as friendly at 24 px. Limbs: stubby, two-lobed mitten hands/feet.',
    'Bands: two accent bands on the flanks + two dots; the body hue shifts per state/course family, bands do not.',
  ];
  notes.forEach((t, i) => s += `<text x="${nx}" y="${ny + 20 + i * 18}" ${font} font-size="11.5" fill="#243B2A">${t}</text>`);
  // size ladder + grayscale
  const lx = 40, ly = 560;
  s += `<text x="${lx}" y="${ly}" ${font} font-size="12" font-weight="700" fill="#55665A">SIZE LADDER (24 / 40 / 64 / 96 px) AND GRAYSCALE READ</text>`;
  const icon = fs.readFileSync(path.join(OUT, 'icon-24.svg'), 'utf8').replace(/^[\s\S]*?<title>[^<]*<\/title>/, '').replace(/<\/svg>\s*$/, '');
  [24, 40].forEach((sz, i) => { s += `<g transform="translate(${lx + i * 60},${ly + 14}) scale(${sz / 24})">${icon}</g>`; });
  [64, 96].forEach((sz, i) => { s += `<g transform="translate(${lx + 140 + i * 120},${ly + 14}) scale(${sz / 100})">${figure(P, STATES.neutral.pose)}</g>`; });
  // grayscale copy via filter (self-contained)
  s += `<defs><filter id="gray"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  s += `<g filter="url(#gray)">`;
  [24, 40].forEach((sz, i) => { s += `<g transform="translate(${lx + 420 + i * 60},${ly + 14}) scale(${sz / 24})">${icon}</g>`; });
  s += `<g transform="translate(${lx + 560},${ly + 14}) scale(0.96)">${figure(P, STATES.neutral.pose)}</g>`;
  s += `</g>`;
  // small state strip at right of proportions
  s += `<text x="770" y="${ny}" ${font} font-size="12" font-weight="700" fill="#55665A">STATE STRIP (64 px)</text>`;
  Object.entries(STATES).forEach(([name, st], i) => {
    const Pp = makePalette({ hue: st.hue, muted: !!st.muted });
    const x = 770 + (i % 4) * 105, y = ny + 12 + Math.floor(i / 4) * 80;
    s += `<g transform="translate(${x},${y}) scale(0.64)">${figure(Pp, st.pose)}${st.props ? st.props(Pp) : ''}</g>`;
    s += `<text x="${x + 32}" y="${y + 76}" ${font} font-size="10" fill="${G}" text-anchor="middle">${name}</text>`;
  });
  fs.writeFileSync(path.join(OUT, 'model-sheet.svg'), svgDoc(s, { size: 1200, label: 'M3 chameleon model sheet', vb: '0 0 1200 700' }));
}

console.log('written', fs.readdirSync(OUT), fs.readdirSync(path.join(OUT, 'states')));
