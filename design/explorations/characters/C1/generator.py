#!/usr/bin/env python3
"""C1 — Geometric flat (refined baseline) character style generator for LangQuest.

Writes 12 circle-cropped portraits (256x256), one café vignette (640x360) and a style sheet.
All geometry is original, parametric, and shares one rule set:
  * no outlines on fills — edges are made by colour contrast
  * exactly one flat shade tone per material, light from top-left
  * line only where a fill cannot carry the shape: brows, closed mouth, glasses (3 px @256)
  * solid dark eyes with a single highlight (no white sclera; reads at 24 px)
"""
import os, math

OUT = os.path.dirname(os.path.abspath(__file__))  
CX, CY = 128.0, 112.0  # head centre in the 256 portrait frame


# ----------------------------------------------------------------- colour helpers
def hex_to_rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return '#%02X%02X%02X' % tuple(max(0, min(255, int(round(c)))) for c in rgb)

def mix(a, b, t):
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(tuple(ra[i] + (rb[i] - ra[i]) * t for i in range(3)))

def shade(h, t=0.18):
    """One flat shade: mix toward a warm dark, never toward black."""
    return mix(h, '#3B2A2A', t)

def luminance(h):
    r, g, b = [c / 255 for c in hex_to_rgb(h)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

INK = '#2A2320'      # eyes, mouth line, glasses
HILITE = '#FFFFFF'
GOLD = '#D9A441'

# Warm skin ramp (seven steps) + matching blush
SKIN_RAMP = ['#F4DCC4', '#EAC6A2', '#DDAD86', '#C98F62', '#AD7046', '#875431', '#5E3A22']
BLUSH = {'#F4DCC4': '#F2B8A6', '#EAC6A2': '#E8A68E', '#DDAD86': '#D98E74', '#C98F62': '#C67A5A',
         '#AD7046': '#A95F43', '#875431': '#7F4A32', '#5E3A22': '#5A3524'}


# ----------------------------------------------------------------- characters
CHARACTERS = {
    'nadia': dict(
        name='Nadia', role='café staff, Casablanca',
        skin='#C98F62', hair='#2E1F1A', hairStyle='curls',
        bg='#F5E2CC', bgShape='#EFD2B3',
        faceW=43, faceH=50, chin=0.55, jaw=0.62,
        top='#C9623F', apron='#2F3B44', headband='#D9A441', earring='hoop',
        brow=4.2,
    ),
    'kenji': dict(
        name='Kenji', role='neighbour, Tokyo',
        skin='#EAC6A2', hair='#B9B5AE', hairStyle='short-receding',
        bg='#E4EADB', bgShape='#D3DCC6',
        faceW=44, faceH=49, chin=0.70, jaw=0.75,
        cardigan='#7A8757', shirt='#F1EADB', glasses=True, earring=None,
        brow=4.6,
    ),
    'lucia': dict(
        name='Lucía', role='coworker, Madrid',
        skin='#DDAD86', hair='#6A3B2A', hairStyle='bob-bangs',
        bg='#F6E1DC', bgShape='#EFCBC3',
        faceW=42, faceH=51, chin=0.50, jaw=0.58,
        blazer='#4A7D8C', blouse='#F3E9DA', earring='stud', necklace=True,
        brow=3.8,
    ),
}

EXPRESSIONS = {
    'neutral':   dict(tilt=0,  brows=0,  browAsym=0,  eyes='open',   mouth='smile',  hand=None,  gaze=(0, 0)),
    'greeting':  dict(tilt=-5, brows=-5, browAsym=0,  eyes='bright', mouth='grin',   hand='wave', gaze=(0, 0)),
    'talking':   dict(tilt=-2, brows=-1, browAsym=0,  eyes='open',   mouth='open',   hand='palm', gaze=(0, 0)),
    'listening': dict(tilt=7,  brows=-1, browAsym=-4, eyes='soft',   mouth='small',  hand=None,  gaze=(-2.2, 0)),
}


# ----------------------------------------------------------------- drawing primitives
def face_path(cx, cy, w, h, chin, jaw):
    """Closed face outline: top width, cheek width, chin width (fractions of w)."""
    top, bot = cy - h, cy + h
    return (f"M{cx},{top} "
            f"C{cx + w * 0.62},{top} {cx + w},{cy - h * 0.55} {cx + w},{cy + h * 0.02} "
            f"C{cx + w},{cy + h * (0.02 + jaw * 0.6)} {cx + w * chin},{bot} {cx},{bot} "
            f"C{cx - w * chin},{bot} {cx - w},{cy + h * (0.02 + jaw * 0.6)} {cx - w},{cy + h * 0.02} "
            f"C{cx - w},{cy - h * 0.55} {cx - w * 0.62},{top} {cx},{top}Z")


def brow(ex, ey, lift, colour, width, flip=False):
    # a thick rounded stroke; the only line on the upper face
    y = ey - 14 + lift
    return (f'<path d="M{ex - 8.5},{y + 1.5} Q{ex},{y - 2.5} {ex + 8.5},{y + 1}" fill="none" '
            f'stroke="{colour}" stroke-width="{width}" stroke-linecap="round"/>')


def eye(ex, ey, kind, gaze):
    gx, gy = gaze
    if kind == 'soft':      # listening: attentive — slightly narrower eye, gaze toward the speaker
        return (f'<ellipse cx="{ex + gx}" cy="{ey + 0.5}" rx="5.2" ry="5.4" fill="{INK}"/>'
                f'<circle cx="{ex - 1.5 + gx * 1.5}" cy="{ey - 1.4}" r="1.6" fill="{HILITE}"/>')
    ry = 7.2 if kind == 'bright' else 6.4
    return (f'<ellipse cx="{ex}" cy="{ey}" rx="5.6" ry="{ry}" fill="{INK}"/>'
            f'<circle cx="{ex - 1.7 + gx}" cy="{ey - 2.1 + gy}" r="1.7" fill="{HILITE}"/>')


def mouth(cx, cy, kind):
    y = cy + 27
    if kind == 'smile':
        return f'<path d="M{cx - 8},{y} Q{cx},{y + 6} {cx + 8},{y}" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
    if kind == 'small':
        return f'<path d="M{cx - 6},{y + 1} Q{cx},{y + 5} {cx + 6},{y + 1}" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
    if kind == 'grin':   # open smile, flat: dark shape + warm tongue block
        return (f'<path d="M{cx - 12},{y - 2} Q{cx},{y + 1} {cx + 12},{y - 2} Q{cx + 8},{y + 13} {cx},{y + 13} Q{cx - 8},{y + 13} {cx - 12},{y - 2}Z" fill="{INK}"/>'
                f'<path d="M{cx - 7},{y + 9} Q{cx},{y + 4} {cx + 7},{y + 9} Q{cx + 4},{y + 13} {cx},{y + 13} Q{cx - 4},{y + 13} {cx - 7},{y + 9}Z" fill="#C45C5C"/>')
    if kind == 'open':   # talking: rounded open mouth
        return (f'<ellipse cx="{cx}" cy="{y + 4}" rx="6.5" ry="6" fill="{INK}"/>'
                f'<ellipse cx="{cx}" cy="{y + 7.5}" rx="3.6" ry="2.4" fill="#C45C5C"/>')
    return ''


def nose(cx, cy, skin_shade):
    return (f'<ellipse cx="{cx + 1}" cy="{cy + 14}" rx="4.8" ry="2.6" fill="{skin_shade}"/>'
            f'<path d="M{cx + 1.5},{cy + 5} Q{cx + 3.5},{cy + 10} {cx + 3.6},{cy + 13} L{cx + 0.4},{cy + 13} Z" fill="{skin_shade}"/>')


def hand(x, y, skin, skin_shade, sleeve, pose):
    """Flat hand: palm disc + finger capsules + thumb, with a sleeve block."""
    rot = {'wave': -18, 'palm': -42}[pose]
    sleeve_len = 70 if pose == 'wave' else 48
    fingers = ''.join(
        f'<line x1="{x - 9 + i * 6}" y1="{y - 2}" x2="{x - 10.5 + i * 6.6}" y2="{y - 22 + abs(i - 1.5) * 1.6}" '
        f'stroke="{skin}" stroke-width="6.2" stroke-linecap="round"/>' for i in range(4))
    thumb = f'<line x1="{x - 11}" y1="{y}" x2="{x - 21}" y2="{y - 11}" stroke="{skin}" stroke-width="6.4" stroke-linecap="round"/>'
    palm = f'<circle cx="{x}" cy="{y}" r="13.5" fill="{skin}"/>'
    palm_shade = f'<path d="M{x - 13.5},{y + 1} A13.5,13.5 0 0 0 {x + 13.5},{y + 1} Z" fill="{skin_shade}"/>'
    sleeve_block = (f'<rect x="{x - 15}" y="{y + 7}" width="30" height="{sleeve_len}" rx="9" fill="{sleeve}"/>'
                    f'<rect x="{x - 15}" y="{y + 7}" width="30" height="9" rx="4" fill="{shade(sleeve)}"/>')
    return f'<g transform="rotate({rot} {x} {y})">{sleeve_block}{thumb}{palm}{palm_shade}{fingers}</g>'


# ----------------------------------------------------------------- hair styles
def hair_layers(c, cx, cy):
    """Return (back, front) hair SVG for a character; drawn behind / in front of the face."""
    h, hs = c['hair'], shade(c['hair'], 0.25)
    w, fh = c['faceW'], c['faceH']
    style = c['hairStyle']
    back, front = '', ''
    if style == 'curls':
        # big curly mass: rounded cloud built from discs on a core ellipse
        back += f'<ellipse cx="{cx}" cy="{cy - 10}" rx="{w + 14}" ry="{fh + 16}" fill="{h}"/>'
        for i in range(11):
            a = math.radians(185 + i * 17)
            r = 11 - (i % 3) * 1.6
            back += f'<circle cx="{cx + math.cos(a) * (w + 12):.1f}" cy="{cy - 10 + math.sin(a) * (fh + 14):.1f}" r="{r}" fill="{h}"/>'
        # lower side curls framing the jaw
        for sx in (-1, 1):
            back += (f'<circle cx="{cx + sx * (w + 8)}" cy="{cy + 18}" r="12" fill="{h}"/>'
                     f'<circle cx="{cx + sx * (w + 4)}" cy="{cy + 36}" r="10" fill="{hs}"/>')
        # top knot (half-up) with hair tie
        back += (f'<circle cx="{cx + 6}" cy="{cy - fh - 22}" r="17" fill="{h}"/>'
                 f'<circle cx="{cx + 1}" cy="{cy - fh - 12}" r="6" fill="{hs}"/>')
        # front: hairline with curl bumps, a headband, and a flat shade on the forehead
        y0 = cy - fh + 4
        front += f'<path d="M{cx - w - 2},{cy - 6} C{cx - w - 2},{y0 - 20} {cx + w + 2},{y0 - 20} {cx + w + 2},{cy - 6} L{cx + w + 2},{cy - 30} Q{cx},{cy - fh + 12} {cx - w - 2},{cy - 30}Z" fill="{h}"/>'
        front = f'<path d="M{cx - w + 4},{y0 + 4} Q{cx},{y0 + 16} {cx + w - 4},{y0 + 4} L{cx + w - 4},{y0 + 12} Q{cx},{y0 + 22} {cx - w + 4},{y0 + 12}Z" fill="{{FOREHEAD}}"/>' + front
        for i in range(7):
            x = cx - w + 8 + i * (2 * w - 16) / 6
            yy = y0 + 2 + (3 if i % 2 else 0)
            front += f'<circle cx="{x:.1f}" cy="{yy:.1f}" r="8.5" fill="{h}"/>'
        front += (f'<path d="M{cx - w - 1},{cy - 24} C{cx - w + 2},{cy - fh - 8} {cx + w - 2},{cy - fh - 8} {cx + w + 1},{cy - 24}" '
                  f'fill="none" stroke="{c["headband"]}" stroke-width="9" stroke-linecap="round"/>')
    elif style == 'short-receding':
        back += f'<path d="M{cx - w - 4},{cy - 6} C{cx - w - 6},{cy - fh - 4} {cx - 18},{cy - fh - 12} {cx},{cy - fh - 11} C{cx + 18},{cy - fh - 12} {cx + w + 6},{cy - fh - 4} {cx + w + 4},{cy - 6} L{cx + w + 4},{cy + 6} L{cx - w - 4},{cy + 6}Z" fill="{h}"/>'
        # front: short grey hair with deep temples (receding), low centre tuft
        t = cy - fh
        front += (f'<path d="M{cx - w - 1},{cy - 4} C{cx - w - 3},{t - 2} {cx - 20},{t - 9} {cx},{t - 8} '
                  f'C{cx + 20},{t - 9} {cx + w + 3},{t - 2} {cx + w + 1},{cy - 4} '
                  f'L{cx + w + 1},{cy - 18} Q{cx + w - 8},{t + 12} {cx + 24},{t + 14} '
                  f'Q{cx + 14},{t + 4} {cx},{t + 10} Q{cx - 14},{t + 4} {cx - 24},{t + 14} '
                  f'Q{cx - w + 8},{t + 12} {cx - w - 1},{cy - 18}Z" fill="{h}"/>')
        # one flat shade on the right of the cap + short sideburn blocks
        front += f'<path d="M{cx + 22},{t - 7} C{cx + 36},{t - 4} {cx + w + 3},{t + 8} {cx + w + 1},{cy - 4} L{cx + w + 1},{cy - 18} Q{cx + w - 6},{t + 4} {cx + 22},{t - 1}Z" fill="{hs}"/>'
        for sx in (-1, 1):
            front += f'<rect x="{cx + sx * (w + 1) - 3}" y="{cy - 18}" width="6" height="20" rx="2" fill="{hs}"/>'
    elif style == 'bob-bangs':
        # back: chin-length bob, slightly inward at the ends
        back += (f'<path d="M{cx - w - 10},{cy + 34} C{cx - w - 16},{cy - 20} {cx - w - 10},{cy - fh - 16} {cx},{cy - fh - 14} '
                 f'C{cx + w + 10},{cy - fh - 16} {cx + w + 16},{cy - 20} {cx + w + 10},{cy + 34} '
                 f'Q{cx + w + 2},{cy + 46} {cx + w - 8},{cy + 44} L{cx - w + 8},{cy + 44} Q{cx - w - 2},{cy + 46} {cx - w - 10},{cy + 34}Z" fill="{h}"/>')
        # inner shade so the face reads as in front of the hair
        back += f'<path d="M{cx + w + 1},{cy - 10} L{cx + w + 2},{cy + 44} L{cx + w + 12},{cy + 40} Q{cx + w + 14},{cy + 10} {cx + w + 10},{cy - 10}Z" fill="{hs}"/>'
        # front: blunt bangs with a soft side part
        t = cy - fh
        front += (f'<path d="M{cx - w - 3},{cy - 2} C{cx - w - 4},{t - 8} {cx - 16},{t - 15} {cx},{t - 14} '
                  f'C{cx + 16},{t - 15} {cx + w + 4},{t - 8} {cx + w + 3},{cy - 2} '
                  f'L{cx + w + 3},{cy - 24} Q{cx + w - 10},{cy - 22} {cx + 12},{cy - 26} '
                  f'Q{cx + 4},{cy - 20} {cx - 8},{cy - 27} Q{cx - w + 10},{cy - 24} {cx - w - 3},{cy - 24}Z" fill="{h}"/>')
        # shade on the forehead just under the fringe (skin shade is applied by the caller)
        front = (f'<path d="M{cx - w + 10},{cy - 24} Q{cx - 8},{cy - 27} {cx + 4},{cy - 20} Q{cx + 12},{cy - 26} {cx + w - 10},{cy - 22} '
                 f'L{cx + w - 10},{cy - 17} Q{cx},{cy - 13} {cx - w + 10},{cy - 19}Z" fill="{{FOREHEAD}}"/>') + front
    return back, front


# ----------------------------------------------------------------- garments
def garment(c, cx, torso_top):
    """Torso block from torso_top to the bottom of the frame + garment details."""
    s = ''
    L, R, B = cx - 118, cx + 118, 256 + 40
    torso = (f'M{L},{B} C{L},{torso_top + 36} {cx - 70},{torso_top + 4} {cx - 24},{torso_top} '
             f'L{cx + 24},{torso_top} C{cx + 70},{torso_top + 4} {R},{torso_top + 36} {R},{B}Z')
    if 'apron' in c:            # Nadia: crew tee + bib apron
        s += f'<path d="{torso}" fill="{c["top"]}"/>'
        s += f'<path d="M{cx - 24},{torso_top} Q{cx},{torso_top + 14} {cx + 24},{torso_top} Q{cx},{torso_top + 6} {cx - 24},{torso_top}Z" fill="{shade(c["top"])}"/>'
        # straps
        for sx in (-1, 1):
            s += f'<line x1="{cx + sx * 24}" y1="{torso_top + 20}" x2="{cx + sx * 15}" y2="{torso_top + 1}" stroke="{c["apron"]}" stroke-width="9" stroke-linecap="round"/>'
        s += f'<path d="M{cx - 26},{torso_top + 16} L{cx + 26},{torso_top + 16} L{cx + 40},{B} L{cx - 40},{B}Z" fill="{c["apron"]}"/>'
        s += f'<path d="M{cx - 26},{torso_top + 16} L{cx + 26},{torso_top + 16} L{cx + 27},{torso_top + 24} L{cx - 27},{torso_top + 24}Z" fill="{shade(c["apron"], 0.3)}"/>'
        s += f'<rect x="{cx + 6}" y="{torso_top + 40}" width="18" height="22" rx="3" fill="{shade(c["apron"], 0.3)}"/>'
    elif 'cardigan' in c:       # Kenji: collared shirt under a buttoned cardigan
        s += f'<path d="{torso}" fill="{c["cardigan"]}"/>'
        s += f'<path d="M{cx - 30},{torso_top - 2} L{cx},{torso_top + 50} L{cx + 30},{torso_top - 2}Z" fill="{c["shirt"]}"/>'
        s += f'<path d="M{cx - 14},{torso_top - 8} L{cx},{torso_top + 14} L{cx - 30},{torso_top - 2}Z" fill="{shade(c["shirt"], 0.12)}"/>'
        s += f'<path d="M{cx + 14},{torso_top - 8} L{cx},{torso_top + 14} L{cx + 30},{torso_top - 2}Z" fill="{shade(c["shirt"], 0.12)}"/>'
        s += f'<path d="M{cx - 36},{torso_top - 2} L{cx - 6},{torso_top + 56} L{cx - 6},{B} L{cx - 44},{B} L{cx - 44},{torso_top + 16}Z" fill="{shade(c["cardigan"])}"/>'
        s += f'<path d="M{cx + 36},{torso_top - 2} L{cx + 6},{torso_top + 56} L{cx + 6},{B} L{cx + 44},{B} L{cx + 44},{torso_top + 16}Z" fill="{shade(c["cardigan"])}"/>'
        s += f'<rect x="{cx - 6}" y="{torso_top + 54}" width="12" height="{B - torso_top - 54}" fill="{c["cardigan"]}"/>'
        for by in (torso_top + 66, torso_top + 86):
            s += f'<circle cx="{cx}" cy="{by}" r="3.2" fill="{INK}"/>'
    elif 'blazer' in c:         # Lucía: blouse under an open blazer with notch lapels
        s += f'<path d="{torso}" fill="{c["blazer"]}"/>'
        s += f'<path d="M{cx - 26},{torso_top - 2} L{cx},{torso_top + 62} L{cx + 26},{torso_top - 2}Z" fill="{c["blouse"]}"/>'
        s += f'<path d="M{cx - 26},{torso_top - 2} Q{cx},{torso_top + 10} {cx + 26},{torso_top - 2} Q{cx},{torso_top + 2} {cx - 26},{torso_top - 2}Z" fill="{shade(c["blouse"], 0.1)}"/>'
        for sx in (-1, 1):
            s += (f'<path d="M{cx + sx * 32},{torso_top - 1} L{cx + sx * 4},{torso_top + 64} L{cx + sx * 20},{torso_top + 70} '
                  f'L{cx + sx * 42},{torso_top + 22}Z" fill="{shade(c["blazer"], 0.28)}"/>')
        if c.get('necklace'):
            s += (f'<path d="M{cx - 12},{torso_top - 4} Q{cx},{torso_top + 20} {cx + 12},{torso_top - 4}" fill="none" stroke="{GOLD}" stroke-width="1.8"/>'
                  f'<circle cx="{cx}" cy="{torso_top + 15}" r="3" fill="{GOLD}"/>')
    return s


# ----------------------------------------------------------------- character assembly
def character(c, exp, cx=CX, cy=CY, with_hands=True, uid='x'):
    """Full head + shoulders character. Head group is tilted around the neck base."""
    skin, skin_s = c['skin'], shade(c['skin'])
    blush = BLUSH[c['skin']]
    w, fh = c['faceW'], c['faceH']
    e = EXPRESSIONS[exp]
    tilt = e['tilt']
    pivot = (cx, cy + fh + 18)
    torso_top = cy + fh + 12
    neck_top = cy + fh - 14

    back_hair, front_hair = hair_layers(c, cx, cy)
    front_hair = front_hair.replace('{FOREHEAD}', skin_s)
    fid = f'face-{uid}'
    head = []
    head.append(f'<defs><clipPath id="{fid}"><path d="{face_path(cx, cy, w, fh, c["chin"], c["jaw"])}"/></clipPath></defs>')
    head.append(back_hair)
    # ears
    for sx in (-1, 1):
        head.append(f'<ellipse cx="{cx + sx * (w - 1)}" cy="{cy + 4}" rx="6.5" ry="9.5" fill="{skin}"/>')
        head.append(f'<ellipse cx="{cx + sx * (w - 1)}" cy="{cy + 6}" rx="3" ry="4.5" fill="{skin_s}"/>')
    if c.get('earring') == 'hoop':
        for sx in (-1, 1):
            head.append(f'<circle cx="{cx + sx * (w + 1)}" cy="{cy + 20}" r="6" fill="none" stroke="{GOLD}" stroke-width="2.4"/>')
    elif c.get('earring') == 'stud':
        for sx in (-1, 1):
            head.append(f'<circle cx="{cx + sx * (w - 1)}" cy="{cy + 12}" r="2.6" fill="{GOLD}"/>')
    # face + one flat shade along the left jaw / under the fringe (light from top-left → shade right side)
    # face: shade colour underneath, lit ellipse offset to the top-left and clipped → one crescent of shade
    head.append(f'<path d="{face_path(cx, cy, w, fh, c["chin"], c["jaw"])}" fill="{skin_s}"/>')
    head.append(f'<g clip-path="url(#{fid})"><ellipse cx="{cx - w * 0.09}" cy="{cy - fh * 0.07}" rx="{w * 0.98}" ry="{fh * 0.985}" fill="{skin}"/></g>')
    # blush, nose, mouth
    for sx in (-1, 1):
        head.append(f'<ellipse cx="{cx + sx * 25}" cy="{cy + 13}" rx="7.5" ry="4" fill="{blush}"/>')
    head.append(nose(cx, cy, skin_s))
    head.append(mouth(cx, cy, e['mouth']))
    # smile lines for the 60s character (talking/greeting only)
    if c['hairStyle'] == 'short-receding' and e['mouth'] in ('grin', 'open'):
        for sx in (-1, 1):
            head.append(f'<path d="M{cx + sx * 12},{cy + 20} Q{cx + sx * 16},{cy + 28} {cx + sx * 12},{cy + 36}" fill="none" stroke="{skin_s}" stroke-width="2.4" stroke-linecap="round"/>')
    # eyes + brows
    ex = 17
    for sx in (-1, 1):
        head.append(eye(cx + sx * ex, cy - 2, e['eyes'], e['gaze']))
        lift = e['brows'] + (e['browAsym'] if sx < 0 else 0)
        head.append(brow(cx + sx * ex, cy - 2, lift, shade(c['hair'], 0.1) if c['hairStyle'] != 'short-receding' else '#8E8A84', c['brow']))
    if c.get('glasses'):
        head.append(f'<g fill="none" stroke="{INK}" stroke-width="2.6">'
                    f'<circle cx="{cx - ex}" cy="{cy - 1}" r="11.5"/><circle cx="{cx + ex}" cy="{cy - 1}" r="11.5"/>'
                    f'<path d="M{cx - 5.5},{cy - 3} Q{cx},{cy - 6} {cx + 5.5},{cy - 3}"/>'
                    f'<path d="M{cx - ex - 11.5},{cy - 3} L{cx - w + 1},{cy - 6}"/><path d="M{cx + ex + 11.5},{cy - 3} L{cx + w - 1},{cy - 6}"/></g>')
    head.append(front_hair)
    head_svg = f'<g transform="rotate({tilt} {pivot[0]} {pivot[1]})">{"".join(head)}</g>'

    # neck (shade = chin shadow) then torso, then head on top
    neck = (f'<rect x="{cx - 15}" y="{neck_top}" width="30" height="{torso_top - neck_top + 6}" fill="{skin}"/>'
            f'<rect x="{cx - 15}" y="{neck_top}" width="30" height="12" fill="{skin_s}"/>')
    body = garment(c, cx, torso_top)
    hands = ''
    if with_hands and e['hand'] == 'wave':
        sleeve = c.get('top') or c.get('cardigan') or c.get('blazer')
        hands = hand(cx + 74, cy + 86, skin, skin_s, sleeve, 'wave')
    elif with_hands and e['hand'] == 'palm':
        sleeve = c.get('top') or c.get('cardigan') or c.get('blazer')
        hands = hand(cx - 76, cy + 92, skin, skin_s, sleeve, 'palm')
    return neck + body + head_svg + hands


def portrait_svg(cid, exp):
    c = CHARACTERS[cid]
    title = f"{c['name']}, {exp}"
    bg = (f'<circle cx="128" cy="128" r="128" fill="{c["bg"]}"/>'
          f'<circle cx="186" cy="64" r="92" fill="{c["bgShape"]}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="{title}">'
            f'<title>{title}</title>'
            f'<defs><clipPath id="crop-{cid}-{exp}"><circle cx="128" cy="128" r="128"/></clipPath></defs>'
            f'<g clip-path="url(#crop-{cid}-{exp})">{bg}{character(c, exp, uid=f"{cid}-{exp}")}</g></svg>')


# ----------------------------------------------------------------- café vignette (640x360)
def scene_svg():
    c = CHARACTERS['nadia']
    wall, wall_s = '#F2E3CF', '#E6D1B5'
    teal, terra, cream = '#3F8F86', '#C9623F', '#F7EEDF'
    wood, wood_s, wood_t = '#B98A5C', '#9C6F45', '#D2A878'
    steel, steel_s = '#C3C9CE', '#9AA3AA'
    parts = []
    parts.append(f'<rect width="640" height="360" fill="{wall}"/>')
    parts.append(f'<rect y="176" width="640" height="70" fill="{wall_s}"/>')
    # geometric tile band (contemporary, abstract)
    for i in range(0, 640, 32):
        col = teal if (i // 32) % 2 == 0 else terra
        parts.append(f'<path d="M{i},186 L{i + 16},176 L{i + 32},186 L{i + 16},196Z" fill="{col}"/>')
        parts.append(f'<path d="M{i + 16},196 L{i + 32},186 L{i + 32},196Z" fill="{shade(col, 0.3)}"/>')
    # arched window with a flat daytime sky and simple rooftops
    parts.append(f'<path d="M58,180 L58,96 A72,72 0 0 1 202,96 L202,180Z" fill="{shade(wall, 0.22)}"/>')
    parts.append(f'<path d="M68,180 L68,100 A62,62 0 0 1 192,100 L192,180Z" fill="#CFE4EE"/>')
    parts.append(f'<path d="M68,180 L68,142 L92,142 L92,128 L116,128 L116,150 L140,150 L140,122 L166,122 L166,146 L192,146 L192,180Z" fill="#F7F3EA"/>')
    parts.append(f'<path d="M68,180 L68,156 L116,156 L116,162 L192,162 L192,180Z" fill="#E6DDCD"/>')
    parts.append(f'<rect x="128" y="100" width="4" height="80" fill="{shade(wall, 0.22)}"/>')
    # palm fronds just outside the window
    parts.append(f'<path d="M150,124 Q176,96 196,104 Q178,108 160,128Z M150,124 Q172,112 186,120 Q170,120 156,130Z" fill="#6E9A5B"/>')
    # pendant lamps
    for lx in (330, 420):
        parts.append(f'<line x1="{lx}" y1="0" x2="{lx}" y2="58" stroke="{shade(wall, 0.35)}" stroke-width="2"/>')
        parts.append(f'<path d="M{lx - 22},84 L{lx - 8},58 L{lx + 8},58 L{lx + 22},84Z" fill="{terra}"/>')
        parts.append(f'<path d="M{lx},84 L{lx + 8},58 L{lx + 22},84Z" fill="{shade(terra)}"/>')
        parts.append(f'<ellipse cx="{lx}" cy="84" rx="22" ry="4" fill="#F3C96B"/>')
    # shelves with cups and a plant (right, kept sparse so UI overlays can sit here)
    for sy in (92, 146):
        parts.append(f'<rect x="460" y="{sy}" width="150" height="6" rx="2" fill="{wood_s}"/>')
    cups = [(474, 72, teal), (504, 72, cream), (534, 72, terra), (564, 72, teal), (480, 126, cream), (512, 126, teal), (542, 126, terra)]
    for x, y, col in cups:
        parts.append(f'<rect x="{x}" y="{y}" width="20" height="20" rx="4" fill="{col}"/>')
        parts.append(f'<rect x="{x}" y="{y}" width="20" height="5" rx="2" fill="{shade(col, 0.22)}"/>')
        parts.append(f'<path d="M{x + 20},{y + 5} a5,5 0 0 1 0,10" fill="none" stroke="{shade(col, 0.22)}" stroke-width="2.5"/>')
    parts.append(f'<rect x="584" y="114" width="20" height="32" rx="3" fill="{terra}"/>')
    parts.append(f'<path d="M594,114 Q572,96 580,78 Q594,92 594,114 Q596,86 616,80 Q610,100 594,114Z" fill="#5F8E52"/>')

    # ---- Nadia behind the counter (half body; hands are drawn after the counter so they rest on it)
    s = 0.98
    hx, hy = 258, 150
    tx, ty = hx - CX * s, hy - CY * s
    parts.append(f'<g transform="translate({tx:.1f},{ty:.1f}) scale({s})">{character(c, "greeting", with_hands=False, uid="scene")}</g>')
    # arms down to the counter
    for ax, hxx in ((hx - 56, hx - 62), (hx + 56, hx + 60)):
        parts.append(f'<path d="M{ax},{hy + 86} L{hxx},{hy + 100}" stroke="{c["top"]}" stroke-width="24" stroke-linecap="round"/>')

    # counter
    parts.append(f'<rect y="246" width="640" height="114" fill="{wood}"/>')
    parts.append(f'<rect y="246" width="640" height="14" fill="{wood_t}"/>')
    parts.append(f'<rect y="260" width="640" height="4" fill="{wood_s}"/>')
    for i in range(0, 640, 80):
        parts.append(f'<rect x="{i + 6}" y="276" width="68" height="84" rx="4" fill="{wood_s}"/>')
    # hands resting on the counter
    skin, skin_s = c['skin'], shade(c['skin'])
    for px, d in ((hx - 62, -1), (hx + 60, 1)):
        parts.append(f'<path d="M{px - 20},{250} Q{px - 22},{238} {px - 8},{236} L{px + 12},{236} Q{px + 24},{238} {px + 22},{250}Z" fill="{skin}"/>')
        for i in range(4):
            fx = px - 15 + i * 9.5
            parts.append(f'<path d="M{fx},{248} L{fx + d * 1.5},{266}" stroke="{skin}" stroke-width="7.6" stroke-linecap="round"/>')
        parts.append(f'<path d="M{px - 20},{250} L{px + 22},{250} L{px + 20},{256} L{px - 18},{256}Z" fill="{skin_s}"/>')
    # a cup of coffee being served
    parts.append(f'<ellipse cx="330" cy="258" rx="22" ry="6" fill="{cream}"/>')
    parts.append(f'<path d="M314,240 L318,258 L342,258 L346,240Z" fill="{cream}"/>')
    parts.append(f'<path d="M314,240 L346,240 L345,245 L315,245Z" fill="{shade(cream, 0.12)}"/>')
    parts.append(f'<path d="M346,244 a6,6 0 0 1 0,12" fill="none" stroke="{cream}" stroke-width="3.5"/>')
    parts.append(f'<ellipse cx="330" cy="240" rx="16" ry="3.5" fill="#6B4A32"/>')
    # pastry dome (left)
    parts.append(f'<ellipse cx="120" cy="246" rx="62" ry="8" fill="{cream}"/>')
    for i, px in enumerate((92, 120, 148)):
        parts.append(f'<path d="M{px - 16},244 Q{px},214 {px + 16},244Z" fill="#D9A05B"/>')
        parts.append(f'<path d="M{px},244 Q{px + 10},226 {px + 16},244Z" fill="#B77F3E"/>')
    parts.append(f'<path d="M58,246 A62,62 0 0 1 182,246Z" fill="#CFE4EE" opacity="0.45"/>')
    parts.append(f'<path d="M66,246 A54,54 0 0 1 94,200" fill="none" stroke="#FFFFFF" stroke-width="3" opacity="0.7" stroke-linecap="round"/>')
    # espresso machine (right)
    parts.append(f'<rect x="458" y="166" width="132" height="84" rx="8" fill="{steel}"/>')
    parts.append(f'<rect x="458" y="166" width="132" height="18" rx="8" fill="{steel_s}"/>')
    parts.append(f'<rect x="470" y="188" width="108" height="36" rx="4" fill="{shade(steel, 0.35)}"/>')
    parts.append(f'<rect x="484" y="224" width="28" height="8" rx="2" fill="{INK}"/><rect x="536" y="224" width="28" height="8" rx="2" fill="{INK}"/>')
    parts.append(f'<circle cx="500" cy="206" r="5" fill="{terra}"/><circle cx="548" cy="206" r="5" fill="{teal}"/>')
    parts.append(f'<rect x="488" y="232" width="20" height="14" rx="3" fill="{cream}"/><rect x="540" y="232" width="20" height="14" rx="3" fill="{cream}"/>')
    parts.append(f'<rect x="470" y="150" width="108" height="16" rx="3" fill="{steel_s}"/>')

    title = "Nadia greeting a customer at a sunny Casablanca café counter, with pastries under a glass dome and an espresso machine."
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="{title}">'
            f'<title>{title}</title>{"".join(parts)}</svg>')


# ----------------------------------------------------------------- style sheet
def style_sheet_svg():
    FONT = "-apple-system, 'Segoe UI', system-ui, Helvetica, Arial, sans-serif"
    W, H = 1280, 1000
    p = []
    t = lambda x, y, s, size=14, w='400', col=INK, anchor='start': p.append(
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{w}" fill="{col}" text-anchor="{anchor}">{s}</text>')
    p.append(f'<rect width="{W}" height="{H}" fill="#FBF7F1"/>')
    t(40, 48, 'C1 — Geometric flat (refined baseline)', 26, '700')
    t(40, 72, 'Flat fills, no outlines, one shade per material, line only where a fill cannot carry the shape. Character style sheet for comparison with C2–C5.', 14, '400', '#5B534E')

    # --- block 1: line weight
    t(40, 118, '1. Line weight', 16, '700')
    t(40, 138, 'Fills have no stroke. Lines exist for three things only (values at 256 px):', 12, '400', '#5B534E')
    p.append(f'<rect x="40" y="150" width="380" height="150" rx="10" fill="#FFFFFF"/>')
    p.append(brow(90, 200, 0, '#4A2E24', 4.2)); t(130, 194, 'brow — 4 px rounded stroke, hair-shade colour', 12)
    p.append(mouth(90, 198, 'smile')); t(130, 230, 'closed mouth — 3 px rounded stroke, ink', 12)
    p.append(f'<g fill="none" stroke="{INK}" stroke-width="2.6"><circle cx="78" cy="268" r="11.5"/><circle cx="104" cy="268" r="11.5"/><path d="M85.5,266 Q91,263 96.5,266"/></g>')
    t(130, 272, 'glasses — 2.6 px (thicken to 4 px below 48 px)', 12)

    # --- block 2: shading
    t(460, 118, '2. Shading', 16, '700')
    t(460, 138, 'Light from top-left. One flat shade per material (base → 18 % #3B2A2A).', 12, '400', '#5B534E')
    p.append(f'<rect x="460" y="150" width="380" height="150" rx="10" fill="#FFFFFF"/>')
    sk = '#C98F62'
    p.append(f'<path d="{face_path(540, 225, 36, 42, 0.55, 0.62)}" fill="{sk}"/>')
    p.append(f'<path d="M{540 + 36 * 0.55},{225 + 42 * 0.5} C{540 + 36 * 0.95},{225 + 42 * 0.35} {540 + 36 * 0.75},{225 + 42 * 0.95} {540 + 36 * 0.2},{225 + 42} C{540 + 36 * 0.55},{225 + 42} {540 + 36},{225 + 42 * 0.6} {540 + 36},{225 + 42 * 0.02}Z" fill="{shade(sk)}"/>')
    p.append(nose(540, 225, shade(sk)))
    t(600, 190, 'shade lives on the right jaw, under the fringe,', 12)
    t(600, 208, 'under the chin (neck band) and inside ears', 12)
    t(600, 236, 'blush = flat ellipse from the skin table', 12)
    t(600, 254, 'nose = one shade shape, no line', 12)
    p.append(f'<ellipse cx="760" cy="280" rx="10" ry="5" fill="{BLUSH[sk]}"/>')

    # --- block 3: proportions
    t(880, 118, '3. Proportions', 16, '700')
    t(880, 138, 'Eyes on centre line; mouth +27.', 12, '400', '#5B534E')
    p.append(f'<rect x="880" y="150" width="360" height="150" rx="10" fill="#FFFFFF"/>')
    p.append(f'<g transform="translate(1000,150) scale(0.42)"><circle cx="128" cy="128" r="128" fill="#F5E2CC"/>'
             f'<defs><clipPath id="crop-ss"><circle cx="128" cy="128" r="128"/></clipPath></defs><g clip-path="url(#crop-ss)">{character(CHARACTERS["lucia"], "neutral", with_hands=False, uid="prop")}</g></g>')
    for yy, lab in ((150 + 112 * 0.42 - 2 * 0.42, 'eye line'), (150 + (112 + 27) * 0.42, 'mouth'), (150 + (112 + 51 + 12) * 0.42, 'torso top')):
        p.append(f'<line x1="896" y1="{yy:.1f}" x2="1230" y2="{yy:.1f}" stroke="#C9623F" stroke-width="1" stroke-dasharray="4 3"/>')
        t(900, yy - 3, lab, 10, '400', '#C9623F')

    # --- block 4: palette
    t(40, 340, '4. Palette', 16, '700')
    t(40, 360, 'Warm skin ramp (7 steps, each with its blush), then hair, garment and background families. Touching materials differ by ≥ 0.12 luminance.', 12, '400', '#5B534E')
    for i, s in enumerate(SKIN_RAMP):
        x = 40 + i * 84
        p.append(f'<rect x="{x}" y="372" width="76" height="44" rx="8" fill="{s}"/>')
        p.append(f'<rect x="{x}" y="372" width="38" height="44" rx="8" fill="{shade(s)}"/>')
        p.append(f'<circle cx="{x + 62}" cy="404" r="7" fill="{BLUSH[s]}"/>')
        t(x, 432, s, 10, '400', '#5B534E')
    hair = ['#2E1F1A', '#4A2E24', '#6A3B2A', '#8E5B3A', '#B9B5AE', '#E3D5C0', '#1F2A3A']
    for i, s in enumerate(hair):
        x = 40 + i * 84
        p.append(f'<rect x="{x}" y="446" width="76" height="30" rx="8" fill="{s}"/>')
        p.append(f'<rect x="{x}" y="446" width="38" height="30" rx="8" fill="{shade(s, 0.25)}"/>')
    t(40, 492, 'hair', 11, '600', '#5B534E')
    garments = ['#C9623F', '#2F3B44', '#7A8757', '#F1EADB', '#4A7D8C', '#F3E9DA', '#3F8F86', '#D9A441']
    for i, s in enumerate(garments):
        x = 40 + i * 84
        p.append(f'<rect x="{x}" y="504" width="76" height="30" rx="8" fill="{s}"/>')
        p.append(f'<rect x="{x}" y="504" width="38" height="30" rx="8" fill="{shade(s)}"/>')
    t(40, 550, 'garments + accents', 11, '600', '#5B534E')
    bgs = [('#F5E2CC', '#EFD2B3'), ('#E4EADB', '#D3DCC6'), ('#F6E1DC', '#EFCBC3'), ('#DDE7EE', '#C9D8E3')]
    for i, (a, b) in enumerate(bgs):
        x = 760 + i * 84
        p.append(f'<rect x="{x}" y="446" width="76" height="88" rx="8" fill="{a}"/>')
        p.append(f'<circle cx="{x + 56}" cy="466" r="26" fill="{b}"/>')
    t(760, 550, 'portrait backgrounds: flat tint + one offset disc', 11, '600', '#5B534E')

    # --- block 5: do / don't
    t(40, 600, '5. Do / don’t', 16, '700')
    cell = lambda x, label, good: (p.append(f'<rect x="{x}" y="612" width="220" height="190" rx="10" fill="#FFFFFF"/>'),
                                   p.append(f'<rect x="{x}" y="612" width="220" height="26" rx="10" fill="{"#3F8F86" if good else "#C45C5C"}"/>'),
                                   t(x + 12, 630, ('DO  ' if good else "DON’T  ") + label, 12, '700', '#FFFFFF'))
    # pair A: flat shade vs gradient
    cell(40, 'one flat shade', True)
    p.append(f'<circle cx="150" cy="720" r="44" fill="#C98F62"/><path d="M150,676 A44,44 0 0 1 150,764 A30,44 0 0 0 150,676Z" fill="{shade("#C98F62")}"/>')
    cell(280, 'gradients / airbrush', False)
    p.append('<defs><radialGradient id="bad-grad" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#E8B48C"/><stop offset="1" stop-color="#8E5533"/></radialGradient></defs>')
    p.append('<circle cx="390" cy="720" r="44" fill="url(#bad-grad)"/>')
    # pair B: contrast edges vs outlines
    cell(520, 'edges by contrast', True)
    p.append(f'<rect x="580" y="676" width="100" height="88" rx="14" fill="#2E3B5B"/><rect x="600" y="676" width="60" height="88" fill="#F3E9DA"/>')
    cell(760, 'outline everything', False)
    p.append(f'<rect x="820" y="676" width="100" height="88" rx="14" fill="#2E3B5B" stroke="{INK}" stroke-width="2.5"/><rect x="840" y="676" width="60" height="88" fill="#F3E9DA" stroke="{INK}" stroke-width="2.5"/>')
    # pair C: solid eyes vs sclera
    cell(1000, 'solid eyes + highlight', True)
    p.append(eye(1090, 720, 'open', (0, 0)) + eye(1130, 720, 'open', (0, 0)))
    p.append(f'<g transform="translate(0,-60) scale(0.4) translate(1650,1300)">{eye(1090, 720, "open", (0, 0))}{eye(1130, 720, "open", (0, 0))}</g>')
    t(1012, 790, 'reads at 24 px', 11, '400', '#5B534E')

    # --- block 6: scale + grayscale test
    t(40, 846, '6. Scale and grayscale test', 16, '700')
    t(40, 866, 'Each head at 96 / 48 / 24 px, then the same row desaturated. Silhouettes (hair mass, apron bib, glasses, bob) stay distinct.', 12, '400', '#5B534E')
    p.append('<defs><filter id="gray"><feColorMatrix type="saturate" values="0"/></filter></defs>')
    x = 40
    for grey in (False, True):
        for cid in ('nadia', 'kenji', 'lucia'):
            for size in (96, 48, 24):
                sc = size / 256
                g = f'<g transform="translate({x},{880}) scale({sc})"><circle cx="128" cy="128" r="128" fill="{CHARACTERS[cid]["bg"]}"/>' \
                    f'<defs><clipPath id="crop-{cid}-{size}-{int(grey)}"><circle cx="128" cy="128" r="128"/></clipPath></defs><g clip-path="url(#crop-{cid}-{size}-{int(grey)})">' \
                    f'{character(CHARACTERS[cid], "neutral", with_hands=False, uid=f"{cid}-{size}-{int(grey)}")}</g></g>'
                p.append(f'<g filter="url(#gray)">{g}</g>' if grey else g)
                x += size + 10
            x += 14
        x += 30
    t(1240, 990, 'LangQuest · design/explorations/C1 · system fonts only · original work', 10, '400', '#8A827C', 'end')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="C1 style sheet">'
            f'<title>C1 style sheet — geometric flat</title>{"".join(p)}</svg>')


# ----------------------------------------------------------------- main
def main():
    os.makedirs(os.path.join(OUT, 'portraits'), exist_ok=True)
    written = []
    for cid in CHARACTERS:
        for exp in EXPRESSIONS:
            path = os.path.join(OUT, 'portraits', f'{cid}-{exp}.svg')
            with open(path, 'w') as f:
                f.write(portrait_svg(cid, exp))
            written.append(path)
    with open(os.path.join(OUT, 'scene-cafe.svg'), 'w') as f:
        f.write(scene_svg()); written.append(os.path.join(OUT, 'scene-cafe.svg'))
    with open(os.path.join(OUT, 'style-sheet.svg'), 'w') as f:
        f.write(style_sheet_svg()); written.append(os.path.join(OUT, 'style-sheet.svg'))
    # grayscale separation report
    print('grayscale luminance check (skin / hair / main garment / background):')
    for cid, c in CHARACTERS.items():
        garment_col = c.get('top') or c.get('cardigan') or c.get('blazer')
        vals = {'skin': c['skin'], 'hair': c['hair'], 'garment': garment_col, 'bg': c['bg']}
        lum = {k: round(luminance(v), 3) for k, v in vals.items()}
        print(' ', cid, lum)
    for w in written:
        print(f'{os.path.getsize(w):7d}  {w}')

if __name__ == '__main__':
    main()
