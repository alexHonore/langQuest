// LangQuest style exploration C4 — "Bold Minimal" (poster cut-outs).
// Original vector work drawn in code. Run: node generator.js  (no dependencies)
// Writes portraits/*.svg, scene-cafe.svg, style-sheet.svg, preview-grid.svg next to this file.
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const INK = '#1F1D2B';
const PAPER = '#FFF8EF';

const CHARS = {
  nadia: {
    name: 'Nadia', role: 'café staff, Casablanca · Moroccan Darija · 30s',
    skin: ['#D79C74', '#AE6F4C'],
    hair: '#241B1E',
    grad: ['#E04F36', '#F5BC46'],
    garment: '#F1E4D0', garment2: '#36444F', garment3: '#4A5B68',
    head: { rx: 52, ry: 60 },
  },
  kenji: {
    name: 'Kenji', role: 'neighbour, Tokyo · Japanese · 60s',
    skin: ['#EBC19A', '#C18C64'],
    hair: '#9A9CAC',
    grad: ['#1B6673', '#93C9A8'],
    garment: '#F6F1EA', garment2: '#4F6390', garment3: '#3E4F76',
    head: { rx: 54, ry: 57 },
  },
  lucia: {
    name: 'Lucía', role: 'coworker, Madrid · Spanish · 20s',
    skin: ['#EDBF9C', '#C58A66'],
    hair: '#3A2622',
    grad: ['#7A3A97', '#F2895C'],
    garment: '#F6F1EA', garment2: '#2E2A44', garment3: '#443E62',
    head: { rx: 50, ry: 60 },
  },
};

const STATES = {
  neutral:   { tilt: 0,  brow: 'flat',  eye: 'dot',   mouth: 'smile',  hand: null,      gaze: 0 },
  greeting:  { tilt: -4, brow: 'up',    eye: 'happy', mouth: 'grin',   hand: 'wave',    gaze: 0 },
  talking:   { tilt: 3,  brow: 'up2',   eye: 'dot',   mouth: 'open',   hand: 'palm',    gaze: 0 },
  listening: { tilt: 7,  brow: 'one',   eye: 'dot',   mouth: 'small',  hand: 'ear',     gaze: -3 },
};

const CX = 128, CY = 116;
const f = (n) => (Math.round(n * 10) / 10).toString();
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- primitives ----------
function hand(x, y, rot, c, kind) {
  // palm-forward hand, flat shapes. kind: 'wave' | 'palm' | 'ear'
  const [L, S] = c.skin;
  const sleeve = c.sleeve || c.garment2;
  // four finger capsules rising above the palm (middle two taller), one thumb capsule
  const fingers = [[-18, 22], [-7, 27], [4, 26], [15, 20]].map(([dx, h]) =>
    `<rect x="${f(x + dx)}" y="${f(y - 12 - h)}" width="11" height="${h + 14}" rx="5.5" fill="${L}"/>`).join('');
  const thumb = `<rect x="${f(x - 30)}" y="${f(y - 14)}" width="12" height="24" rx="6" fill="${L}" transform="rotate(-28 ${f(x - 24)} ${f(y - 2)})"/>`;
  const palm = `<rect x="${f(x - 18)}" y="${f(y - 14)}" width="36" height="32" rx="11" fill="${L}"/>`;
  // one shade plane on the palm (lower-right)
  const shade = `<path d="M${f(x + 17)},${f(y - 2)} C${f(x + 17)},${f(y + 12)} ${f(x + 6)},${f(y + 18)} ${f(x - 6)},${f(y + 18)} L${f(x + 6)},${f(y + 18)} A11,11 0 0 0 ${f(x + 17)},${f(y + 7)} Z" fill="${S}"/>`;
  const cuff = `<rect x="${f(x - 15)}" y="${f(y + 14)}" width="30" height="26" rx="8" fill="${sleeve}"/>`;
  const wrist = `<rect x="${f(x - 9)}" y="${f(y + 10)}" width="18" height="14" rx="5" fill="${S}"/>`;
  return `<g transform="rotate(${rot} ${f(x)} ${f(y)})">${cuff}${wrist}${palm}${shade}${fingers}${thumb}</g>`;
}

function torsoBase(c) {
  return `<path d="M-20,256 L-20,238 C-20,204 56,186 100,185 L156,185 C200,186 276,204 276,238 L276,256 Z" fill="${c.garment}"/>`;
}

function clothing(key, c) {
  const g2 = c.garment2, g3 = c.garment3, g = c.garment;
  if (key === 'nadia') {
    // cream tee, slate apron with straps and a shade plane
    return [
      `<path d="M104,204 L120,186 M152,204 L136,186" stroke="${g2}" stroke-width="10" stroke-linecap="round"/>`,
      `<path d="M92,202 L164,202 L172,256 L84,256 Z" fill="${g2}"/>`,
      `<path d="M164,202 L172,256 L136,256 L136,202 Z" fill="${g3}" opacity="0.9"/>`,
    ].join('');
  }
  if (key === 'kenji') {
    // cardigan over collared shirt: V opening, shawl band, two buttons
    return [
      `<path d="M-20,256 L-20,238 C-20,204 56,186 100,185 L128,240 L156,185 C200,186 276,204 276,238 L276,256 Z" fill="${g2}"/>`,
      `<path d="M156,185 C200,186 276,204 276,238 L276,256 L128,256 L128,240 Z" fill="${g3}" opacity="0.9"/>`,
      `<path d="M100,185 L128,240 L156,185" fill="none" stroke="${g3}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<path d="M106,182 L128,212 L122,180 Z M150,182 L128,212 L134,180 Z" fill="${PAPER}"/>`,
      `<circle cx="128" cy="246" r="3.2" fill="${PAPER}"/>`,
    ].join('');
  }
  // lucia: blazer with lapels over a cream top
  return [
    `<path d="M-20,256 L-20,238 C-20,204 56,186 100,185 L112,256 L144,256 L156,185 C200,186 276,204 276,238 L276,256 Z" fill="${g2}"/>`,
    `<path d="M156,185 C200,186 276,204 276,238 L276,256 L144,256 Z" fill="${g3}" opacity="0.9"/>`,
    `<path d="M100,185 L124,214 L112,256 Z M156,185 L132,214 L144,256 Z" fill="${g3}"/>`,
    `<path d="M156,185 L132,214 L144,256 Z" fill="${g2}" opacity="0.6"/>`,
  ].join('');
}

function neck(c, key) {
  const [, S] = c.skin;
  const collar = key === 'kenji' ? `<path d="M110,170 L128,196 L146,170 L146,186 L128,206 L110,186 Z" fill="${PAPER}"/>` : '';
  return `<rect x="111" y="150" width="34" height="52" rx="7" fill="${S}"/>${collar}`;
}

function hairBack(key, c) {
  if (key !== 'lucia') return '';
  // long hair: one mass behind the head that falls just past the shoulders, slightly fuller on the viewer's left
  return `<path d="M74,124 C68,66 98,44 128,44 C160,44 186,64 182,124 C186,160 182,192 192,222 C176,236 150,236 138,230 L118,230 C106,236 80,238 62,222 C76,192 72,160 74,124 Z" fill="${c.hair}"/>`;
}

function hairFront(key, c, st) {
  const h = c.hair;
  if (key === 'nadia') {
    const bumps = [[84, 74, 10], [100, 58, 11], [128, 48, 12], [156, 56, 11], [174, 72, 10], [96, 80, 7], [114, 72, 7], [146, 72, 7], [162, 80, 7]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${h}"/>`).join('');
    const bun = `<circle cx="170" cy="50" r="21" fill="${h}"/><circle cx="184" cy="62" r="9" fill="${h}"/><path d="M152,56 Q160,66 168,70" stroke="${c.grad[1]}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    return `<path d="M72,122 C66,78 92,50 128,50 C166,50 190,78 184,122 L184,108 C178,82 160,74 138,74 C112,74 92,78 76,108 Z" fill="${h}"/>${bumps}${bun}`;
  }
  if (key === 'kenji') {
    return `<path d="M74,104 C72,70 96,56 128,56 C160,56 184,70 182,104 L182,100 C176,84 160,78 140,78 C112,76 96,82 76,102 Z" fill="${h}"/>` +
      `<path d="M74,104 L74,122 L84,122 L84,106 Z M182,104 L182,122 L172,122 L172,106 Z" fill="${h}"/>`;
  }
  // lucia: side part on viewer's left, fringe sweeps right
  // side part on the viewer's left (x≈102); the fringe sweeps right and sits lowest over the right temple
  return `<path d="M78,120 C76,74 98,52 128,52 C160,52 182,76 180,120 C178,100 170,84 150,82 C136,82 124,90 116,104 C114,94 108,88 102,86 C94,92 84,106 78,120 Z" fill="${h}"/>`;
}

function face(key, c, st) {
  const [L, S] = c.skin;
  const { rx, ry } = c.head;
  const ink = INK;
  const gz = st.gaze || 0;
  const parts = [];
  // ears
  parts.push(`<ellipse cx="${CX - rx + 2}" cy="${CY + 4}" rx="8" ry="12" fill="${L}"/><ellipse cx="${CX + rx - 2}" cy="${CY + 4}" rx="8" ry="12" fill="${S}"/>`);
  // head + single shade plane (light from upper-left)
  parts.push(`<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="${L}"/>`);
  const shade = `M${f(CX + rx * 0.3)},${CY - ry - 2} C${f(CX + rx * 0.16)},${f(CY - ry * 0.3)} ${f(CX + rx * 0.5)},${f(CY + ry * 0.2)} ${f(CX + rx * 0.22)},${f(CY + ry * 0.62)} C${f(CX + rx * 0.06)},${f(CY + ry * 0.9)} ${f(CX - rx * 0.3)},${f(CY + ry * 0.98)} ${f(CX - rx * 0.55)},${CY + ry + 2} L${CX + rx + 6},${CY + ry + 6} L${CX + rx + 6},${CY - ry - 6} Z`;
  parts.push(`<path d="${shade}" fill="${S}" clip-path="url(#__ID__-head)"/>`);
  // age cue for Kenji: two soft lines, shade tone
  if (key === 'kenji') parts.push(`<path d="M110,132 Q106,142 111,152 M146,132 Q150,142 145,152" stroke="${S}" stroke-width="3" stroke-linecap="round" fill="none"/>`);
  // nose wedge (shade tone)
  parts.push(`<path d="M${CX + 1},${CY - 2} L${CX + 10},${CY + 13} Q${CX + 10},${CY + 16} ${CX + 6},${CY + 16} L${CX - 1},${CY + 16} Z" fill="${S}"/>`);
  // brows
  const by = CY - 26;
  const browY = { flat: [by, by], up: [by - 4, by - 4], up2: [by - 2, by - 2], one: [by - 5, by + 1] }[st.brow];
  parts.push(`<path d="M${CX - 32},${browY[0] + 2} L${CX - 11},${browY[0]}" stroke="${ink}" stroke-width="5.5" stroke-linecap="round" fill="none"/>`);
  parts.push(`<path d="M${CX + 11},${browY[1]} L${CX + 32},${browY[1] + 2}" stroke="${ink}" stroke-width="5.5" stroke-linecap="round" fill="none"/>`);
  // eyes
  const ey = CY - 8;
  if (st.eye === 'dot') {
    parts.push(`<ellipse cx="${CX - 21 + gz}" cy="${ey}" rx="4.8" ry="5.8" fill="${ink}"/><ellipse cx="${CX + 21 + gz}" cy="${ey}" rx="4.8" ry="5.8" fill="${ink}"/>`);
  } else {
    parts.push(`<path d="M${CX - 30},${ey + 3} Q${CX - 21},${ey - 9} ${CX - 12},${ey + 3} M${CX + 12},${ey + 3} Q${CX + 21},${ey - 9} ${CX + 30},${ey + 3}" stroke="${ink}" stroke-width="5.5" stroke-linecap="round" fill="none"/>`);
  }
  if (key === 'kenji') {
    parts.push(`<g fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"><circle cx="${CX - 21}" cy="${ey}" r="16"/><circle cx="${CX + 21}" cy="${ey}" r="16"/><path d="M${CX - 5},${ey - 2} L${CX + 5},${ey - 2} M${CX - 37},${ey - 1} L${CX - rx + 4},${ey + 2} M${CX + 37},${ey - 1} L${CX + rx - 4},${ey + 2}"/></g>`);
  }
  // mouth
  const my = CY + 30;
  const mouths = {
    smile: `<path d="M${CX - 11},${my} Q${CX + 1},${my + 8} ${CX + 13},${my}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    grin: `<path d="M${CX - 15},${my - 3} Q${CX + 1},${my + 24} ${CX + 17},${my - 3} Z" fill="${ink}"/><path d="M${CX - 11},${my - 1} L${CX + 13},${my - 1}" stroke="${PAPER}" stroke-width="3.5" stroke-linecap="round"/>`,
    open: `<path d="M${CX - 10},${my - 4} Q${CX + 1},${my - 6} ${CX + 12},${my - 4} Q${CX + 13},${my + 14} ${CX + 1},${my + 15} Q${CX - 11},${my + 14} ${CX - 10},${my - 4} Z" fill="${ink}"/><path d="M${CX - 7},${my - 2} L${CX + 9},${my - 2}" stroke="${PAPER}" stroke-width="3" stroke-linecap="round"/>`,
    small: `<path d="M${CX - 6},${my + 1} Q${CX + 2},${my + 6} ${CX + 10},${my + 1}" stroke="${ink}" stroke-width="4.5" stroke-linecap="round" fill="none"/>`,
  };
  parts.push(mouths[st.mouth]);
  if (key === 'lucia') {
    // small hoop earrings in the accent tone
    parts.push(`<circle cx="${CX - rx + 2}" cy="${CY + 20}" r="5" fill="none" stroke="${c.grad[1]}" stroke-width="3"/><circle cx="${CX + rx - 2}" cy="${CY + 20}" r="5" fill="none" stroke="${c.grad[1]}" stroke-width="3"/>`);
  }
  return parts.join('');
}

// Character figure in 256-space (no background, no clip). id = unique prefix for defs.
function figure(key, stateName, id) {
  const c = CHARS[key];
  const st = STATES[stateName];
  const { rx, ry } = c.head;
  const defs = `<clipPath id="${id}-head"><ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}"/></clipPath>`;
  const headGroup = `<g transform="rotate(${st.tilt} ${CX} ${CY + ry})">${hairBack(key, c)}${face(key, c, st).replace(/__ID__/g, id)}${hairFront(key, c, st)}</g>`;
  let hands = '';
  if (st.hand === 'wave') hands = hand(key === 'kenji' ? 208 : 212, key === 'kenji' ? 178 : 162, key === 'kenji' ? 10 : 14, c, 'wave');
  if (st.hand === 'palm') hands = hand(208, 222, -32, c, 'palm');
  if (st.hand === 'ear') hands = hand(62, 150, 30, c, 'ear');
  const body = `${torsoBase(c)}${clothing(key, c)}${neck(c, key)}`;
  // for Lucía, hair-back must sit over the shoulders but behind the neck → draw with the head group (rotates with head)
  return { defs, body: `${body}`, head: headGroup, hands };
}

function avatar(key, stateName) {
  const c = CHARS[key];
  const id = `${key}-${stateName}`;
  const fig = figure(key, stateName, id);
  const title = `${c.name}, ${stateName}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${title}">
<title>${title}</title>
<desc>LangQuest style exploration C4 (bold minimal). ${c.name}, ${c.role}. Original character drawn in code; no real-person likeness; no text in artwork.</desc>
<defs>
<linearGradient id="${id}-bg" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${c.grad[0]}"/><stop offset="1" stop-color="${c.grad[1]}"/></linearGradient>
<clipPath id="${id}-crop"><circle cx="128" cy="128" r="128"/></clipPath>
${fig.defs}
</defs>
<g clip-path="url(#${id}-crop)">
<rect width="256" height="256" fill="url(#${id}-bg)"/>
${fig.body}${fig.head}${fig.hands}
</g>
</svg>
`;
}

// embed a figure inside another document at (x,y) with scale s and optional circle crop
function embed(key, stateName, id, x, y, s, { crop = true, gray = false } = {}) {
  const c = CHARS[key];
  const fig = figure(key, stateName, id);
  const defs = `<linearGradient id="${id}-bg" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${c.grad[0]}"/><stop offset="1" stop-color="${c.grad[1]}"/></linearGradient><clipPath id="${id}-crop"><circle cx="128" cy="128" r="128"/></clipPath>${fig.defs}`;
  const inner = `<g ${crop ? `clip-path="url(#${id}-crop)"` : ''}><rect width="256" height="256" fill="url(#${id}-bg)"/>${fig.body}${fig.head}${fig.hands}</g>`;
  const body = `<g transform="translate(${x} ${y}) scale(${s})"${gray ? ' filter="url(#gray)"' : ''}>${inner}</g>`;
  return { defs, body };
}

// ---------- outputs ----------
const written = [];
function write(name, content) {
  const p = path.join(OUT, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  written.push(name);
}

for (const key of Object.keys(CHARS)) for (const s of Object.keys(STATES)) write(`portraits/${key}-${s}.svg`, avatar(key, s));

// ----- scene -----
function scene() {
  const c = CHARS.nadia;
  const id = 'scene-nadia';
  // Nadia with a custom pose: greeting-smile face, no hand prop (hands drawn on the counter)
  STATES.scene = { tilt: -3, brow: 'up2', eye: 'dot', mouth: 'grin', hand: null, gaze: 0 };
  const fig = figure('nadia', 'scene', id);
  delete STATES.scene;
  const S = 1.12, TX = 80, TY = 0;
  const [L, Sh] = c.skin;
  const sand = '#EADBC3', sandShade = '#D6C2A4';
  const wood = '#B8865A', woodShade = '#8E6340', woodTop = '#D9AC7C';
  const steel = '#C9CED6', steelShade = '#8F97A6';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="Nadia at the café counter">
<title>Nadia at the café counter</title>
<desc>LangQuest style exploration C4 (bold minimal). Half-body vignette: Nadia, café staff in Casablanca, behind a counter with an espresso machine, a tray of mint tea glasses and a cup she is handing over. Flat two-tone shapes, one gradient halo, no text in artwork.</desc>
<defs>
<linearGradient id="${id}-halo" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${c.grad[0]}"/><stop offset="1" stop-color="${c.grad[1]}"/></linearGradient>
<clipPath id="${id}-stage"><rect width="640" height="360"/></clipPath>
${fig.defs}
</defs>
<g clip-path="url(#${id}-stage)">
<!-- wall -->
<rect width="640" height="360" fill="${sand}"/>
<rect x="0" y="0" width="640" height="26" fill="${sandShade}"/>
<!-- pendant lamp -->
<path d="M96,26 L96,78" stroke="${INK}" stroke-width="3"/>
<path d="M62,112 Q96,66 130,112 Z" fill="${INK}"/>
<ellipse cx="96" cy="113" rx="22" ry="5" fill="${c.grad[1]}"/>
<!-- gradient halo arch (the one gradient in the scene) -->
<path d="M94,330 L94,180 A128,128 0 0 1 350,180 L350,330 Z" fill="url(#${id}-halo)"/>
<!-- shelf with teapot and tea glasses -->
<rect x="420" y="96" width="190" height="8" rx="3" fill="${woodShade}"/>
<rect x="430" y="104" width="12" height="20" fill="${woodShade}"/>
<rect x="590" y="104" width="12" height="20" fill="${woodShade}"/>
<g>
  <path d="M452,96 L452,62 Q452,46 468,46 L486,46 Q502,46 502,62 L502,96 Z" fill="${steel}"/>
  <path d="M484,96 L484,46 Q502,46 502,62 L502,96 Z" fill="${steelShade}"/>
  <path d="M502,60 Q526,54 520,80" stroke="${steelShade}" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M452,62 Q436,62 438,78" stroke="${steel}" stroke-width="6" stroke-linecap="round" fill="none"/>
  <rect x="462" y="36" width="30" height="12" rx="4" fill="${steelShade}"/>
  <circle cx="477" cy="32" r="5" fill="${INK}"/>
  ${[540, 566, 592].map((x) => `<path d="M${x - 9},96 L${x - 7},62 L${x + 7},62 L${x + 9},96 Z" fill="${PAPER}"/><path d="M${x + 1},96 L${x + 2},62 L${x + 7},62 L${x + 9},96 Z" fill="${sandShade}"/><rect x="${x - 7}" y="72" width="14" height="24" fill="#B9A24A"/><rect x="${x + 1}" y="72" width="8" height="24" fill="#8F7C33"/><circle cx="${x - 2}" cy="66" r="4" fill="#4E8A52"/><circle cx="${x + 3}" cy="63" r="3.5" fill="#6AA66B"/>`).join('')}
</g>
<!-- espresso machine -->
<g>
  <rect x="432" y="150" width="168" height="104" rx="14" fill="${steel}"/>
  <path d="M520,150 L586,150 Q600,150 600,164 L600,240 Q600,254 586,254 L520,254 Z" fill="${steelShade}"/>
  <rect x="432" y="150" width="168" height="26" rx="12" fill="${INK}"/>
  <rect x="454" y="188" width="46" height="12" rx="6" fill="${INK}"/>
  <rect x="520" y="188" width="46" height="12" rx="6" fill="${INK}"/>
  <rect x="470" y="200" width="14" height="22" rx="4" fill="${INK}"/>
  <rect x="536" y="200" width="14" height="22" rx="4" fill="${INK}"/>
  <circle cx="586" cy="212" r="10" fill="${c.grad[1]}"/>
  <circle cx="586" cy="212" r="4" fill="${INK}"/>
  <rect x="454" y="236" width="112" height="6" rx="3" fill="${INK}"/>
  <path d="M446,150 L446,134 Q446,126 454,126 L578,126 Q586,126 586,134 L586,150 Z" fill="${steelShade}"/>
  <circle cx="470" cy="136" r="7" fill="${PAPER}"/><circle cx="492" cy="136" r="7" fill="${PAPER}"/><circle cx="514" cy="136" r="7" fill="${PAPER}"/><circle cx="536" cy="136" r="7" fill="${PAPER}"/>
</g>
<!-- Nadia (behind counter) -->
<g transform="translate(${TX} ${TY}) scale(${S})">${fig.body}${fig.head}</g>
<!-- forearms (skin shade tone; she wears a tee) coming forward from the shoulders -->
<rect x="150" y="226" width="32" height="34" rx="12" fill="${Sh}"/>
<rect x="292" y="228" width="32" height="30" rx="12" fill="${Sh}"/>
<!-- second cup and a saucer, standing on the counter -->
<ellipse cx="401" cy="256" rx="26" ry="5" fill="${PAPER}"/>
<path d="M384,228 L418,228 L414,256 L388,256 Z" fill="${c.grad[0]}"/>
<path d="M404,228 L418,228 L414,256 L402,256 Z" fill="#B93F2B"/>
<rect x="384" y="228" width="34" height="5" fill="${INK}" opacity="0.85"/>
<!-- counter -->
<rect x="0" y="252" width="640" height="108" fill="${wood}"/>
<path d="M0,252 L640,252 L640,266 L0,266 Z" fill="${woodTop}"/>
<rect x="0" y="266" width="640" height="10" fill="${woodShade}"/>
<!-- geometric tile band on the counter front -->
<g>
  ${Array.from({ length: 11 }, (_, i) => { const x = 20 + i * 60; return `<path d="M${x},318 L${x + 26},296 L${x + 52},318 L${x + 26},340 Z" fill="${i % 2 ? c.grad[1] : PAPER}" opacity="0.9"/><path d="M${x + 26},296 L${x + 52},318 L${x + 26},340 Z" fill="${i % 2 ? '#CD9540' : sandShade}" opacity="0.9"/>`; }).join('')}
</g>
<rect x="0" y="288" width="640" height="6" fill="${woodShade}"/>
<rect x="0" y="346" width="640" height="14" fill="${woodShade}"/>
<!-- Nadia's hands on the counter top -->
<g>
  <!-- left hand resting flat, fingers toward the viewer -->
  <rect x="142" y="238" width="50" height="22" rx="10" fill="${L}"/>
  <rect x="146" y="250" width="10" height="20" rx="5" fill="${L}"/><rect x="158" y="250" width="10" height="22" rx="5" fill="${L}"/><rect x="170" y="250" width="10" height="22" rx="5" fill="${L}"/><rect x="182" y="250" width="10" height="19" rx="5" fill="${L}"/>
  <path d="M142,250 C142,258 150,262 158,262 L158,250 Z" fill="${Sh}"/>
  <!-- right hand offering a cup: palm behind the cup, two fingers in front -->
  <rect x="290" y="232" width="40" height="26" rx="10" fill="${L}"/>
  <g>
    <path d="M300,222 L338,222 L334,256 L304,256 Z" fill="${PAPER}"/>
    <path d="M322,222 L338,222 L334,256 L320,256 Z" fill="${sandShade}"/>
    <path d="M338,228 Q352,230 348,244 Q346,250 336,250" stroke="${PAPER}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="300" y="222" width="38" height="5" fill="${INK}" opacity="0.85"/>
    <path d="M312,212 Q306,204 312,196 M324,212 Q330,204 324,196" stroke="${PAPER}" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.9"/>
  </g>
  <rect x="298" y="236" width="20" height="9" rx="4.5" fill="${L}"/><rect x="298" y="247" width="20" height="9" rx="4.5" fill="${L}"/>
</g>
</g>
</svg>
`;
}
write('scene-cafe.svg', scene());

// ----- preview grid -----
function previewGrid() {
  const keys = Object.keys(CHARS), states = Object.keys(STATES);
  const cell = 176, pad = 40, top = 90, left = 150;
  const W = left + states.length * cell + 20, H = top + keys.length * cell + 20;
  let defs = '', body = '';
  const T = (x, y, s, size, w = 400, extra = '') => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${INK}" ${extra}>${esc(s)}</text>`;
  body += T(pad, 44, 'C4 · Bold Minimal — cast comparison grid', 26, 700);
  body += T(pad, 68, 'Same three cast members, four conversation states. Labels are sheet annotations (system font), not artwork.', 13, 400, 'fill-opacity="0.7"');
  states.forEach((s, j) => { body += T(left + j * cell + 80, top - 10, s, 14, 600, 'text-anchor="middle"'); });
  keys.forEach((k, i) => {
    body += T(pad, top + i * cell + 84, CHARS[k].name, 18, 700);
    body += T(pad, top + i * cell + 104, CHARS[k].role.split(' · ')[0], 11, 400, 'fill-opacity="0.7"');
    states.forEach((s, j) => {
      const e = embed(k, s, `pg-${k}-${s}`, left + j * cell, top + i * cell, 160 / 256);
      defs += e.defs; body += e.body;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="C4 cast comparison grid"><title>C4 cast comparison grid</title><defs>${defs}</defs><rect width="${W}" height="${H}" fill="#F4EFE6"/>${body}</svg>\n`;
}
write('preview-grid.svg', previewGrid());

// ----- style sheet -----
function styleSheet() {
  const W = 1280, H = 1400;
  let defs = `<filter id="gray"><feColorMatrix type="saturate" values="0"/></filter><radialGradient id="bad-skin" cx="0.4" cy="0.4" r="0.7"><stop offset="0" stop-color="#F5D2B4"/><stop offset="1" stop-color="#9A6240"/></radialGradient>`;
  let body = '';
  const T = (x, y, s, size = 12, w = 400, extra = '') => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${INK}" ${extra}>${esc(s)}</text>`;
  const H2 = (x, y, s, len = 300) => T(x, y, s, 16, 700) + `<path d="M${x},${y + 8} L${x + len},${y + 8}" stroke="${INK}" stroke-width="2" opacity="0.25"/>`;
  const sw = (x, y, fill, label, sub) => `<rect x="${x}" y="${y}" width="56" height="56" rx="12" fill="${fill}"/>` + T(x, y + 72, label, 11, 600) + (sub ? T(x, y + 86, sub, 10, 400, 'fill-opacity="0.7"') : '');
  const lines = (x, y, arr, size = 11, w = 400, extra = '', lh = 14) => arr.map((s, i) => T(x, y + i * lh, s, size, w, extra)).join('');

  body += `<rect width="${W}" height="${H}" fill="#F4EFE6"/>`;
  body += T(40, 46, 'C4 · Bold Minimal — character style sheet', 24, 700);
  body += T(40, 68, 'Poster cut-outs: large simplified shapes · two-tone faces · one accent gradient per character (the backing disc) · no outlines · ink features only.', 12, 400, 'fill-opacity="0.75"');
  body += T(40, 84, 'Spec sheet, not production art; labels use system fonts and are not part of the artwork.', 12, 400, 'fill-opacity="0.75"');

  // ---- Section 1: construction (left column) ----
  body += H2(40, 124, '1 · Construction, line weight and shading', 760);
  const big = embed('nadia', 'neutral', 'ss-build', 40, 146, 300 / 256, { crop: true });
  defs += big.defs; body += big.body;
  body += `<path d="M86,162 L130,206" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M118,206 L130,206 L130,194" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  body += T(66, 156, 'light', 11, 700);
  const ax = 370;
  const note = (y, head, arr) => T(ax, y, head, 12, 700) + lines(ax, y + 16, arr, 11, 400, 'fill-opacity="0.8"', 14);
  body += note(162, 'No outlines, anywhere.', ['Shape meets shape. Edges are carried by value contrast, never by a stroke.']);
  body += note(204, 'Two tones per face, one plane.', ['Light tone + shade tone. The shade is a single curved plane on the right side', 'and under the chin: light comes from the upper-left at about 35°.']);
  body += note(260, 'Nose = a shade wedge.', ['No nose outline. One small wedge in the shade tone, inside the light plane.']);
  body += note(302, 'Ink features: 5.5 / 5 / 4.5 px (on 256).', ['Brows and closed eyes 5.5, neutral mouth 5, listening mouth 4.5, round caps.', 'Open eyes are 4.8 × 5.8 ellipses. Nothing thinner than 3 px.']);
  body += note(358, 'One gradient only: the backing disc.', ['Linear 135°, dark stop top-left → light stop bottom-right.', 'Skin, hair and cloth are always flat.']);
  body += note(414, 'Hair is one silhouette.', ['A cap plus a few circle bumps (curls), or one swept path. No strands, no highlights.']);
  const sy = 528;
  [['5.5', 0], ['5', 1], ['4.5', 2], ['3', 3]].forEach(([wgt, i]) => {
    body += `<path d="M${40 + i * 120},${sy} L${40 + i * 120 + 80},${sy}" stroke="${INK}" stroke-width="${wgt}" stroke-linecap="round"/>` + T(40 + i * 120, sy + 20, `${wgt} px`, 11, 600);
  });
  body += T(40, sy + 40, 'brows and closed eyes · mouth · listening mouth · earrings, hair tie and age lines', 10, 400, 'fill-opacity="0.7"');
  body += note(456, 'Clothing: two flat tones + one lighter plane.', ['Garment, garment-shade and the cream base layer; a 90 % shade plane on the right half.', 'Contemporary everyday clothes; the job is shown by one prop (apron, cardigan, blazer).']);

  // ---- Section 2: palette (right column) ----
  body += H2(860, 124, '2 · Palette', 380);
  body += sw(860, 146, INK, 'Ink', INK) + sw(930, 146, PAPER, 'Paper', PAPER);
  body += lines(1010, 170, ['Ink: all facial features, lamp, machine trim.', 'Paper: teeth line, highlights on props, shirt.'], 10, 400, 'fill-opacity="0.75"', 14);
  Object.keys(CHARS).forEach((k, i) => {
    const c = CHARS[k];
    const y = 270 + i * 128;
    body += T(860, y - 10, c.name, 12, 700);
    body += sw(860, y, c.skin[0], 'Skin light', c.skin[0]) + sw(930, y, c.skin[1], 'Skin shade', c.skin[1]) + sw(1000, y, c.hair, 'Hair', c.hair) + sw(1070, y, c.garment2, 'Garment', c.garment2);
    defs += `<linearGradient id="ss-g-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.grad[0]}"/><stop offset="1" stop-color="${c.grad[1]}"/></linearGradient>`;
    body += `<rect x="1140" y="${y}" width="100" height="56" rx="12" fill="url(#ss-g-${k})"/>` + T(1140, y + 72, 'Accent gradient', 11, 600) + T(1140, y + 86, `${c.grad[0]} → ${c.grad[1]}`, 9, 400, 'fill-opacity="0.7"');
  });
  body += lines(860, 648, ['Rule: five distinct grayscale values per avatar:', 'ink < hair < skin shade < skin light < paper. The disc sits between', 'hair and skin-light in value, so the head always separates from', 'its backing. Hue carries identity; value carries legibility.'], 10, 400, 'fill-opacity="0.75"', 14);

  // ---- Section 3: expression vocabulary (left) ----
  body += H2(40, 600, '3 · Expression vocabulary (conversation states)', 760);
  const exp = [['neutral', ['relaxed', 'brows flat · dot eyes', 'small smile']], ['greeting', ['tilt −4° · brows up', 'closed happy eyes · grin', 'hand up']], ['talking', ['tilt +3° · brows up', 'open mouth', 'open palm']], ['listening', ['tilt +7° toward speaker', 'one brow · gaze left', 'hand to ear']]];
  exp.forEach(([s, d], i) => {
    const e = embed('kenji', s, `ss-exp-${s}`, 40 + i * 200, 622, 150 / 256);
    defs += e.defs; body += e.body;
    body += T(40 + i * 200 + 75, 794, s, 12, 700, 'text-anchor="middle"');
    body += lines(40 + i * 200 + 75, 810, d, 10, 400, 'text-anchor="middle" fill-opacity="0.75"', 13);
  });

  // ---- Section 4: scale check (right) ----
  body += H2(860, 720, '4 · Scale check · colour | grayscale', 380);
  const sizes = [96, 48, 24];
  Object.keys(CHARS).forEach((k, i) => {
    let x = 860;
    const y = 742 + i * 128;
    sizes.forEach((sz) => { const e = embed(k, 'greeting', `ss-sc-${k}-${sz}`, x, y + (96 - sz), sz / 256); defs += e.defs; body += e.body; x += sz + 10; });
    x += 14;
    sizes.forEach((sz) => { const e = embed(k, 'greeting', `ss-sg-${k}-${sz}`, x, y + (96 - sz), sz / 256, { gray: true }); defs += e.defs; body += e.body; x += sz + 10; });
    body += T(860, y + 112, `${CHARS[k].name} · 96 / 48 / 24 px`, 10, 400, 'fill-opacity="0.75"');
  });

  // ---- Section 5: do / don't (full width) ----
  body += H2(40, 1120, '5 · Do / Don’t', 1200);
  const pairs = [
    [['Do', 'flat two-tone face,', 'one shade plane'], ['Don’t', 'outlines, nose line,', 'gradient-shaded skin']],
    [['Do', 'one gradient,', 'on the disc only'], ['Don’t', 'gradients on', 'garments or hair']],
    [['Do', 'bold hair silhouette,', 'ink-only features'], ['Don’t', 'small details: lashes,', 'strands, freckles']],
  ];
  const s = 130 / 256, py = 1142;
  pairs.forEach(([good, bad], i) => {
    const x0 = 40 + i * 420;
    const g = embed('lucia', 'neutral', `ss-do-${i}`, x0, py, s);
    defs += g.defs; body += g.body;
    body += T(x0 + 65, py + 150, good[0], 11, 700, 'text-anchor="middle"') + lines(x0 + 65, py + 165, good.slice(1), 10, 400, 'text-anchor="middle" fill-opacity="0.75"', 13);
    const bx = x0 + 170;
    const b = embed('lucia', 'neutral', `ss-dont-${i}`, bx, py, s);
    defs += b.defs; body += b.body;
    if (i === 0) {
      body += `<g transform="translate(${bx} ${py}) scale(${s})"><ellipse cx="${CX}" cy="${CY}" rx="50" ry="60" fill="url(#bad-skin)"/><ellipse cx="${CX}" cy="${CY}" rx="50" ry="60" fill="none" stroke="${INK}" stroke-width="4"/><path d="M${CX - 32},${CY - 24} L${CX - 11},${CY - 26} M${CX + 11},${CY - 26} L${CX + 32},${CY - 24}" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/><ellipse cx="${CX - 21}" cy="${CY - 8}" rx="4.8" ry="5.8" fill="${INK}"/><ellipse cx="${CX + 21}" cy="${CY - 8}" rx="4.8" ry="5.8" fill="${INK}"/><path d="M${CX - 11},${CY + 30} Q${CX + 1},${CY + 38} ${CX + 13},${CY + 30}" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${CX},${CY - 2} L${CX + 9},${CY + 14} L${CX - 2},${CY + 14}" stroke="${INK}" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M78,120 C76,74 98,52 128,52 C160,52 182,76 180,120 C178,100 170,84 150,82 C136,82 124,90 116,104 C114,94 108,88 102,86 C94,92 84,106 78,120 Z" fill="${CHARS.lucia.hair}" stroke="${INK}" stroke-width="4"/></g>`;
    }
    if (i === 1) {
      defs += `<linearGradient id="bad-cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A7BC2"/><stop offset="1" stop-color="#2E2A44"/></linearGradient><linearGradient id="bad-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9A6B52"/><stop offset="1" stop-color="#3A2622"/></linearGradient>`;
      body += `<g transform="translate(${bx} ${py}) scale(${s})" clip-path="url(#ss-dont-1-crop)"><path d="M-20,256 L-20,238 C-20,204 56,186 100,185 L112,256 L144,256 L156,185 C200,186 276,204 276,238 L276,256 Z" fill="url(#bad-cloth)"/><path d="M74,124 C68,66 98,44 128,44 C160,44 186,64 182,124 C186,160 182,192 192,222 C176,236 150,236 138,230 L118,230 C106,236 80,238 62,222 C76,192 72,160 74,124 Z" fill="url(#bad-hair)"/><rect x="111" y="150" width="34" height="52" rx="7" fill="${CHARS.lucia.skin[1]}"/><ellipse cx="${CX}" cy="${CY}" rx="50" ry="60" fill="${CHARS.lucia.skin[0]}"/><path d="M78,120 C76,74 98,52 128,52 C160,52 182,76 180,120 C178,100 170,84 150,82 C136,82 124,90 116,104 C114,94 108,88 102,86 C94,92 84,106 78,120 Z" fill="url(#bad-hair)"/><path d="M${CX - 32},${CY - 24} L${CX - 11},${CY - 26} M${CX + 11},${CY - 26} L${CX + 32},${CY - 24}" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/><ellipse cx="${CX - 21}" cy="${CY - 8}" rx="4.8" ry="5.8" fill="${INK}"/><ellipse cx="${CX + 21}" cy="${CY - 8}" rx="4.8" ry="5.8" fill="${INK}"/><path d="M${CX - 11},${CY + 30} Q${CX + 1},${CY + 38} ${CX + 13},${CY + 30}" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/></g>`;
    }
    if (i === 2) {
      body += `<g transform="translate(${bx} ${py}) scale(${s})" fill="none" stroke="${INK}" stroke-linecap="round"><path d="M${CX - 30},${CY - 12} L${CX - 33},${CY - 18} M${CX - 24},${CY - 15} L${CX - 25},${CY - 21} M${CX + 30},${CY - 12} L${CX + 33},${CY - 18} M${CX + 24},${CY - 15} L${CX + 25},${CY - 21}" stroke-width="1.6"/><path d="M${CX},${CY - 2} L${CX + 9},${CY + 14} L${CX - 2},${CY + 14}" stroke-width="1.6" stroke-linejoin="round"/><path d="M84,70 Q100,60 120,62 M90,84 Q110,70 136,70 M150,70 Q166,76 176,96 M82,140 Q78,170 84,200 M176,140 Q180,170 174,200" stroke-width="1.4" stroke="#7A5A50"/><path d="M${CX - 34},${CY + 8} l1,1 m4,-3 l1,1 m-9,5 l1,1 m52,-5 l1,1 m4,3 l1,1 m-9,-7 l1,1" stroke-width="1.6"/></g>`;
    }
    body += T(bx + 65, py + 150, bad[0], 11, 700, 'text-anchor="middle"') + lines(bx + 65, py + 165, bad.slice(1), 10, 400, 'text-anchor="middle" fill-opacity="0.75"', 13);
  });
  body += lines(40, 1330, [
    'Always: contemporary everyday clothing for people; no flags, national or religious costume, no ethnic caricature, no real-person likeness; no text, numerals or logos in artwork.',
    'Always: every expression differs by pose or shape, never by colour alone; every avatar keeps ≥ 5 grayscale values; nothing thinner than 3 px on 256 (≈ 0.3 px at 24 px).',
    'Avatar crop: full 256 circle, head centre at (128, 116), head height 0.47 of the disc; shoulders exit the crop so the figure feels larger than the disc.',
  ], 11, 400, 'fill-opacity="0.8"', 16);
  body += T(40, 1386, 'Provenance: original work drawn in code (generator.js). No traced, stock, CC0 or AI-generated sources. No fonts embedded.', 10, 400, 'fill-opacity="0.6"');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="C4 Bold Minimal character style sheet"><title>C4 Bold Minimal character style sheet</title><desc>Style sheet for LangQuest character style exploration C4 (bold minimal): construction, line weights, shading rule, palette, expression vocabulary, scale and grayscale checks, do and don't examples.</desc><defs>${defs}</defs>${body}</svg>\n`;
}
write('style-sheet.svg', styleSheet());

console.log(written.map((w) => `${w}\t${fs.statSync(path.join(OUT, w)).size} B`).join('\n'));
