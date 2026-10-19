#!/usr/bin/env python3
"""C3 'Ink & Fill' exploration generator for LangQuest.

Original hand-drawn-look vector portraits. Every line is a *ribbon*: a filled
polygon whose width varies along the stroke (pen pressure), with a slight
deterministic wobble. Fills are flat and intentionally misregistered from the
ink (like a two-pass print). No gradients, no filters on production art.
"""
import math, random, os, colorsys

OUT = os.path.dirname(os.path.abspath(__file__))

# ------------------------------------------------------------------ palette
INK = "#2A2320"          # warm near-black ink
PAPER = "#F6EFE3"        # warm paper
PAPER_DEEP = "#EADFCB"
OCHRE = "#E0A43A"
TERRA = "#D9663D"
SAGE = "#5B9B8A"
DUSK = "#5C7DA3"
OAT = "#E3D3B3"
CAMEL = "#C9A36B"
BLUSH = "#EFA38A"
MOUTH = "#5A2E2C"
TONGUE = "#C9655A"

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def rgb2hex(r, g, b):
    return '#%02X%02X%02X' % tuple(max(0, min(255, round(v * 255))) for v in (r, g, b))

def shade(h, f=0.80, warm=0.015):
    """Flat shadow tone: darker, slightly warmer/more saturated (ink-wash feel)."""
    r, g, b = hex2rgb(h)
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    hh = (hh - warm) % 1.0
    l *= f; s = min(1, s * 1.12)
    return rgb2hex(*colorsys.hls_to_rgb(hh, l, s))

def gray(h):
    r, g, b = hex2rgb(h); y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return rgb2hex(y, y, y)

# ------------------------------------------------------------------ geometry
def f(v):
    s = '%.1f' % v
    return s[:-2] if s.endswith('.0') else s

def cr(pts, closed, n=9):
    m = len(pts); out = []
    segs = m if closed else m - 1
    for i in range(segs):
        if closed:
            p0, p1, p2, p3 = pts[(i - 1) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        else:
            p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, m - 1)]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y, i + t))
    if not closed:
        out.append((pts[-1][0], pts[-1][1], float(m - 1)))
    return out

def wobble(seed, N, closed, amp):
    rnd = random.Random(seed)
    if closed:
        k1, k2 = rnd.choice([2, 3, 4]), rnd.choice([5, 6, 7])
        ph1, ph2 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
        return [amp * (math.sin(2 * math.pi * k1 * j / N + ph1) + 0.5 * math.sin(2 * math.pi * k2 * j / N + ph2)) for j in range(N)]
    f1, f2 = rnd.uniform(0.18, 0.32), rnd.uniform(0.5, 0.8)
    ph1, ph2 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
    return [amp * (math.sin(f1 * j + ph1) + 0.5 * math.sin(f2 * j + ph2)) for j in range(N)]

def normals(samples, closed):
    N = len(samples); res = []
    for j in range(N):
        if closed:
            a, b = samples[(j - 1) % N], samples[(j + 1) % N]
        else:
            a, b = samples[max(j - 1, 0)], samples[min(j + 1, N - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1
        res.append((-ty / L, tx / L))
    return res

class Pen:
    """Collects svg elements; carries the ink scale (for tiny renders) and the
    fill misregistration offset."""
    def __init__(self, ink=1.0, dx=1.6, dy=1.3, wob=0.35, color=INK, opacity=None):
        self.ink = ink; self.dx = dx; self.dy = dy; self.wob = wob
        self.color = color; self.opacity = opacity; self.el = []

    def _attrs(self, color=None, opacity=None):
        c = color or self.color; o = opacity if opacity is not None else self.opacity
        return f' fill="{c}"' + (f' fill-opacity="{o}"' if o is not None else '')

    def stroke(self, pts, widths, seed, closed=False, color=None, opacity=None, n=9, taper=True):
        """Variable-width ink ribbon. widths: one width per control point."""
        if isinstance(widths, (int, float)):
            widths = [widths] * len(pts)
        s = cr(pts, closed, n); N = len(s); nm = normals(s, closed)
        wb = wobble(seed, N, closed, self.wob)
        m = len(pts)
        def w_at(u):
            i = int(math.floor(u)); t = u - i
            w0 = widths[i % m]; w1 = widths[(i + 1) % m] if closed else widths[min(i + 1, m - 1)]
            return (w0 + (w1 - w0) * t) * self.ink
        L, R = [], []
        for j, (x, y, u) in enumerate(s):
            nx, ny = nm[j]
            w = w_at(u)
            if taper and not closed:
                e = min(j, N - 1 - j)
                if e < 4:
                    w *= 0.45 + 0.55 * e / 4
            cx, cy = x + nx * wb[j], y + ny * wb[j]
            L.append((cx + nx * w / 2, cy + ny * w / 2)); R.append((cx - nx * w / 2, cy - ny * w / 2))
        if closed:
            d = 'M' + ' '.join(f'{f(x)},{f(y)}' for x, y in L) + 'Z M' + ' '.join(f'{f(x)},{f(y)}' for x, y in reversed(R)) + 'Z'
            self.el.append(f'<path d="{d}" fill-rule="evenodd"{self._attrs(color, opacity)}/>')
        else:
            d = 'M' + ' '.join(f'{f(x)},{f(y)}' for x, y in L) + ' L' + ' '.join(f'{f(x)},{f(y)}' for x, y in reversed(R)) + 'Z'
            self.el.append(f'<path d="{d}"{self._attrs(color, opacity)}/>')

    def fill(self, pts, color, seed, closed=True, n=9, offset=True, opacity=None, wob=None):
        s = cr(pts, closed, n); N = len(s); nm = normals(s, closed)
        wb = wobble(seed + 7, N, closed, (self.wob if wob is None else wob) * 0.6)
        ox = self.dx if offset else 0; oy = self.dy if offset else 0
        d = 'M' + ' '.join(f'{f(x + nm[j][0] * wb[j] + ox)},{f(y + nm[j][1] * wb[j] + oy)}' for j, (x, y, u) in enumerate(s)) + 'Z'
        op = f' fill-opacity="{opacity}"' if opacity is not None else ''
        self.el.append(f'<path d="{d}" fill="{color}"{op}/>')

    def dot(self, x, y, r, color, offset=True):
        ox = self.dx if offset else 0; oy = self.dy if offset else 0
        self.el.append(f'<circle cx="{f(x + ox)}" cy="{f(y + oy)}" r="{f(r)}" fill="{color}"/>')

    def hatch(self, x, y, count, length, angle, gap, seed, w=1.1):
        a = math.radians(angle); dx, dy = math.cos(a), math.sin(a)
        px, py = -dy, dx
        for i in range(count):
            sx, sy = x + px * gap * i, y + py * gap * i
            self.stroke([(sx, sy), (sx + dx * length * 0.5, sy + dy * length * 0.5), (sx + dx * length, sy + dy * length)], [0.5, w, 0.5], seed + i, n=5)

    def group(self, transform=None, opacity=None):
        inner = ''.join(self.el); self.el = []
        t = f' transform="{transform}"' if transform else ''
        o = f' opacity="{opacity}"' if opacity is not None else ''
        return f'<g{t}{o}>{inner}</g>'

    def flush(self):
        s = ''.join(self.el); self.el = []; return s

def ellipse_pts(cx, cy, rx, ry, n=12, a0=0, a1=360, jaw=0.0, chin=1.0):
    pts = []
    for i in range(n):
        t = math.radians(a0 + (a1 - a0) * i / n)
        sn, cs = math.sin(t), math.cos(t)
        x = cx + rx * cs * (1 - jaw * max(0, sn) ** 1.5)
        y = cy + ry * sn * (chin if sn > 0 else 1)
        pts.append((x, y))
    return pts

def rot(pts, ang, cx=0, cy=0):
    a = math.radians(ang); c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]

def tr(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]

def sc(pts, k, cx=0, cy=0):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]

# ------------------------------------------------------------------ cast
CAST = {
    'nadia': dict(name='Nadia', label='Nadia, café staff in Casablanca', skin='#C98A5E', hair='#2B1E1A', hair_hi='#4A3630',
                  bg='#F3D7BC', iris='#3A2418', garment=SAGE, garment2=OAT, accent=OCHRE,
                  rx=40, ry=50, jaw=0.22, chin=1.02, seed=11),
    'kenji': dict(name='Kenji', label='Kenji, neighbour in Tokyo', skin='#E6C19B', hair='#B3ADA6', hair_hi='#DAD5CE',
                  bg='#DCE5D8', iris='#2E2420', garment=CAMEL, garment2=PAPER, accent=DUSK,
                  rx=42, ry=50, jaw=0.14, chin=1.06, seed=23),
    'lucia': dict(name='Lucía', label='Lucía, coworker in Madrid', skin='#E4B98F', hair='#7A4A2B', hair_hi='#9A6440',
                  bg='#F1D5CF', iris='#4A3020', garment=DUSK, garment2='#F6EFE3', accent=TERRA,
                  rx=38, ry=50, jaw=0.26, chin=1.0, seed=37),
}

EXPR = {
    'neutral':   dict(eyes='open', brows='rest', mouth='small', tilt=0, hand=None, blush=False, gaze=0),
    'greeting':  dict(eyes='happy', brows='up', mouth='grin', tilt=-3, hand='wave', blush=True, gaze=0),
    'talking':   dict(eyes='open', brows='up', mouth='open', tilt=2, hand='explain', blush=False, gaze=0),
    'listening': dict(eyes='open', brows='one', mouth='closed', tilt=-9, hand='ear', blush=False, gaze=-2),
}

def hand_shape():
    # open palm, fingers up, in local coords (origin at wrist centre)
    return [(-12, 22), (-16, 8), (-19, -2), (-17, -9), (-13, -7), (-11, -12), (-9.5, -20), (-7, -23), (-4.5, -20), (-4, -12),
            (-2.5, -22), (0, -25.5), (2.5, -22), (3, -12), (5, -20), (7.5, -23), (9.5, -19), (9.5, -11), (11.5, -16), (13.5, -17),
            (14.5, -12), (14, -2), (14, 8), (12, 22)]

def draw_hand(p, char, seed, x, y, ang, k=1.0, sleeve_to=None, sleeve_w=26):
    hs = tr(rot(sc(hand_shape(), k), ang), x, y)
    skin = char['skin']
    if sleeve_to:
        # sleeve: from wrist to an off-frame point
        wx, wy = x, y
        sx, sy = sleeve_to
        d = rot([(-14 * k, 18 * k), (14 * k, 18 * k)], ang)
        sl = [(wx + d[0][0], wy + d[0][1]), (wx + d[1][0], wy + d[1][1]), (sx + sleeve_w, sy), (sx - sleeve_w, sy)]
        p.fill(sl, char['garment'], seed + 90)
        p.fill([(sl[0][0], sl[0][1]), (sl[1][0], sl[1][1]), (sl[1][0] + 2, sl[1][1] + 10), (sl[0][0] + 2, sl[0][1] + 10)], shade(char['garment']), seed + 91, offset=False)
        p.stroke([sl[0], sl[3]], [2.6, 1.2], seed + 92)
        p.stroke([sl[1], sl[2]], [2.6, 1.2], seed + 93)
        p.stroke([sl[0], ((sl[0][0] + sl[1][0]) / 2, (sl[0][1] + sl[1][1]) / 2 + 2), sl[1]], [1.2, 2.2, 1.2], seed + 94)
    p.fill(hs, skin, seed + 95)
    # palm shadow (flat)
    pal = tr(rot(sc([(-10, 20), (-13, 4), (-6, 2), (2, 4), (10, 2), (12, 20)], k), ang), x, y)
    p.fill(pal, shade(skin), seed + 96, offset=False)
    ws = [2.2, 2.6, 2.8, 2.4, 1.8, 1.8, 2.0, 2.2, 2.0, 1.6, 1.8, 2.2, 1.8, 1.6, 1.8, 2.2, 1.8, 1.6, 1.8, 2.0, 2.0, 2.2, 2.4, 2.4]
    p.wob, wsave = 0.18, p.wob
    p.stroke(hs, ws, seed + 97, closed=True)
    # finger separations: short, thin, from the valley down
    for fx in (-4, 3, 9.5):
        a = tr(rot(sc([(fx, -12), (fx + 0.3, -8), (fx + 0.5, -4)], k), ang), x, y)
        p.stroke(a, [1.2, 1.0, 0.4], seed + 98 + int(fx), n=5)
    p.wob = wsave

def draw_eye(p, char, ex, ey, kind, seed, gaze=0, flip=1):
    skin = char['skin']
    if kind == 'happy':
        p.stroke([(ex - 9, ey + 2), (ex, ey - 5), (ex + 9, ey + 2)], [1.4, 3.4, 1.4], seed)
        return
    # sclera
    sclera = [(ex - 9, ey + 1), (ex - 4, ey - 4), (ex + 3, ey - 4.5), (ex + 9, ey + 0.5), (ex + 4, ey + 4.5), (ex - 4, ey + 4.5)]
    p.fill(sclera, PAPER, seed + 1, offset=False, wob=0.15)
    p.dot(ex + gaze, ey + 0.6, 4.3, char['iris'], offset=False)
    p.dot(ex + gaze, ey + 0.6, 2.2, INK, offset=False)
    p.dot(ex + gaze - 1.6, ey - 1.0, 1.1, PAPER, offset=False)
    # upper lid (thick lash line) and lower lid (hairline)
    p.stroke([(ex - 10, ey + 1.5), (ex - 4, ey - 4), (ex + 3, ey - 5), (ex + 10, ey + 0.5)], [1.0, 2.6, 3.2, 1.6], seed + 2)
    p.stroke([(ex - 7, ey + 4), (ex, ey + 5.2), (ex + 8, ey + 3.5)], [0.5, 1.1, 0.7], seed + 3)
    # lid crease
    p.stroke([(ex - 6, ey - 6.5), (ex + 1, ey - 8.5), (ex + 8, ey - 6)], [0.4, 0.9, 0.5], seed + 4)

def draw_brow(p, char, bx, by, kind, seed, side, bush=1.0):
    # side: -1 left (viewer's), +1 right
    if kind == 'up':
        by -= 4
    if kind == 'one' and side == 1:
        by -= 5
    inner = bx + 8 * side; outer = bx - 9 * side
    p.stroke([(outer, by + 2), (bx - 2 * side, by - 2.5), (inner, by - 0.5)], [1.0 * bush, 3.0 * bush, 2.6 * bush], seed)

def draw_mouth(p, char, mx, my, kind, seed):
    if kind == 'small':
        p.stroke([(mx - 8, my - 1), (mx, my + 2), (mx + 8, my - 1.5)], [1.0, 2.2, 1.0], seed)
    elif kind == 'closed':
        p.stroke([(mx - 7, my - 0.5), (mx, my + 1.5), (mx + 9, my - 2.5)], [1.0, 2.2, 1.4], seed)
        p.stroke([(mx + 9, my - 2.5), (mx + 8, my + 1)], [1.4, 0.5], seed + 1)
    elif kind == 'grin':
        shape = [(mx - 14, my - 3), (mx, my - 1), (mx + 14, my - 3), (mx + 9, my + 8), (mx, my + 11), (mx - 9, my + 8)]
        p.fill(shape, MOUTH, seed + 1, offset=False, wob=0.1)
        p.fill([(mx - 11, my - 1.5), (mx + 11, my - 1.5), (mx + 8, my + 3), (mx - 8, my + 3)], PAPER, seed + 2, offset=False, wob=0.1)
        p.stroke([(mx - 15, my - 4), (mx, my - 1), (mx + 15, my - 4)], [1.4, 3.0, 1.4], seed + 3)
        p.stroke([(mx + 15, my - 4), (mx + 9, my + 8), (mx, my + 11), (mx - 9, my + 8), (mx - 15, my - 4)], [1.2, 1.8, 2.0, 1.8, 1.2], seed + 4)
    elif kind == 'open':
        shape = [(mx - 9, my - 3), (mx, my - 4.5), (mx + 9, my - 3), (mx + 10, my + 5), (mx, my + 12), (mx - 10, my + 5)]
        p.fill(shape, MOUTH, seed + 1, offset=False, wob=0.1)
        p.fill([(mx - 7, my - 2), (mx + 7, my - 2), (mx + 5, my + 1), (mx - 5, my + 1)], PAPER, seed + 2, offset=False, wob=0.1)
        p.fill([(mx - 6, my + 9), (mx, my + 5), (mx + 6, my + 9), (mx, my + 12)], TONGUE, seed + 5, offset=False, wob=0.1)
        p.stroke(shape, [2.4, 2.8, 2.4, 1.6, 2.0, 1.6], seed + 3, closed=True)

def draw_nose(p, char, cx, cy, seed):
    p.stroke([(cx + 2, cy - 2), (cx + 6, cy + 10), (cx + 1, cy + 16), (cx - 5, cy + 13.5)], [0.5, 1.4, 2.6, 1.0], seed)

def figure(cid, eid, ink=1.0, scene=False):
    """Returns svg markup of the character in a 256x256 space (no clip)."""
    c = CAST[cid]; e = EXPR[eid]
    S = c['seed'] * 100
    p = Pen(ink=ink)
    cx, cy, rx, ry = 128, 112, c['rx'], c['ry']
    skin, hair = c['skin'], c['hair']
    neck_y = cy + ry * c['chin'] - 4
    out = []

    # ---- torso & garment
    torso = [(28, 236), (56, 204), (96, 186), (112, 182), (144, 182), (160, 186), (200, 204), (228, 236), (232, 300), (24, 300)]
    if cid == 'nadia':
        p.fill(torso, c['garment'], S + 1)
        p.fill([(160, 186), (200, 204), (228, 236), (232, 300), (170, 300), (172, 236)], shade(c['garment']), S + 2, offset=False)
        bib = [(98, 300), (100, 214), (106, 198), (128, 194), (150, 198), (156, 214), (158, 300)]
        p.fill(bib, c['garment2'], S + 3)
        p.fill([(140, 300), (142, 214), (150, 198), (156, 214), (158, 300)], shade(c['garment2'], 0.86), S + 4, offset=False)
        p.stroke(torso[:8], [1.2, 2.6, 3.0, 2.0, 2.0, 3.0, 2.8, 1.2], S + 5)
        p.stroke(bib[1:6], [1.2, 2.4, 2.8, 2.4, 1.2], S + 6)
        p.stroke([(100, 300), (100, 214)], [2.2, 2.4], S + 7); p.stroke([(156, 214), (156, 300)], [2.4, 2.2], S + 8)
        # straps up around the neck
        p.stroke([(108, 198), (110, 186), (116, 176)], [2.2, 2.0, 1.4], S + 9)
        p.stroke([(148, 198), (146, 186), (140, 176)], [2.2, 2.0, 1.4], S + 10)
        # tee neckline
        p.stroke([(108, 184), (128, 196), (148, 184)], [1.0, 2.2, 1.0], S + 11)
    elif cid == 'kenji':
        p.fill(torso, c['garment'], S + 1)
        p.fill([(160, 186), (200, 204), (228, 236), (232, 300), (178, 300), (176, 220)], shade(c['garment']), S + 2, offset=False)
        # shirt V and collar
        shirt = [(104, 184), (128, 236), (152, 184)]
        p.fill([(104, 182), (128, 232), (152, 182), (146, 178), (128, 190), (110, 178)], c['garment2'], S + 3)
        p.stroke(torso[:8], [1.2, 2.6, 3.0, 2.0, 2.0, 3.0, 2.8, 1.2], S + 5)
        p.stroke([(104, 184), (116, 212), (128, 236)], [2.6, 2.2, 1.6], S + 6)
        p.stroke([(152, 184), (140, 212), (128, 236)], [2.6, 2.2, 1.6], S + 7)
        p.stroke([(110, 176), (104, 184), (120, 196)], [1.2, 2.2, 1.2], S + 8)
        p.stroke([(146, 176), (152, 184), (136, 196)], [1.2, 2.2, 1.2], S + 9)
        p.stroke([(120, 196), (128, 200), (136, 196)], [1.0, 1.8, 1.0], S + 10)
        # buttons
        for by in (248, 270, 292):
            p.dot(128, by, 2.3, INK, offset=False)
        # cardigan cable-knit hint: two faint vertical lines
        p.stroke([(74, 214), (72, 300)], [0.6, 1.0], S + 12); p.stroke([(184, 214), (186, 300)], [0.6, 1.0], S + 13)
    else:  # lucia: blazer with lapels over a cream top
        p.fill(torso, c['garment'], S + 1)
        p.fill([(160, 186), (200, 204), (228, 236), (232, 300), (176, 300), (174, 216)], shade(c['garment']), S + 2, offset=False)
        p.fill([(100, 182), (128, 248), (156, 182), (146, 176), (128, 190), (110, 176)], c['garment2'], S + 3)
        p.stroke(torso[:8], [1.2, 2.6, 3.0, 2.0, 2.0, 3.0, 2.8, 1.2], S + 5)
        # lapels
        lapL = [(100, 182), (114, 214), (128, 248)]; lapR = [(156, 182), (142, 214), (128, 248)]
        p.fill([(100, 182), (128, 248), (116, 250), (88, 206)], shade(c['garment'], 0.9), S + 4, offset=False)
        p.fill([(156, 182), (168, 206), (140, 250), (128, 248)], shade(c['garment'], 0.74), S + 14, offset=False)
        p.stroke(lapL, [2.6, 2.4, 1.6], S + 6); p.stroke(lapR, [2.6, 2.4, 1.6], S + 7)
        p.stroke([(100, 182), (88, 206), (116, 250)], [1.2, 2.0, 1.4], S + 8)
        p.stroke([(156, 182), (168, 206), (140, 250)], [1.2, 2.0, 1.4], S + 9)
        # top neckline
        p.stroke([(112, 182), (128, 192), (144, 182)], [1.0, 2.0, 1.0], S + 10)
    out.append(p.flush())

    # ---- long hair behind (lucia) — before neck/head
    if cid == 'lucia':
        back = [(cx - 44, cy - 24), (cx - 52, cy + 10), (cx - 50, cy + 40), (cx - 58, cy + 70), (cx - 52, cy + 96), (cx - 36, cy + 104), (cx - 22, cy + 90), (cx - 16, cy + 56),
                (cx - 15, cy + 40), (cx, cy + 36), (cx + 15, cy + 40), (cx + 16, cy + 56), (cx + 22, cy + 90), (cx + 36, cy + 104), (cx + 52, cy + 96), (cx + 58, cy + 70),
                (cx + 50, cy + 40), (cx + 52, cy + 10), (cx + 44, cy - 24), (cx, cy - 60)]
        p.fill(back, hair, S + 20)
        p.fill([(cx + 50, cy + 40), (cx + 58, cy + 70), (cx + 52, cy + 96), (cx + 36, cy + 104), (cx + 40, cy + 70), (cx + 42, cy + 40)], shade(hair, 0.8), S + 25, offset=False)
        p.stroke(back[:7], [1.6, 2.6, 3.0, 3.4, 3.0, 2.6, 1.6], S + 21)
        p.stroke(back[13:19], [1.6, 2.6, 3.2, 3.2, 2.8, 1.6], S + 22)
        p.stroke([(cx - 42, cy + 10), (cx - 46, cy + 40), (cx - 40, cy + 72)], [0.5, 1.4, 0.5], S + 23)
        p.stroke([(cx + 40, cy + 14), (cx + 44, cy + 44), (cx + 38, cy + 76)], [0.5, 1.4, 0.5], S + 24)
        out.append(p.flush())

    # ---- neck
    neck = [(113, neck_y - 10), (143, neck_y - 10), (146, neck_y + 22), (110, neck_y + 22)]
    p.fill(neck, skin, S + 30)
    p.fill([(113, neck_y - 10), (143, neck_y - 10), (141, neck_y + 1), (128, neck_y + 5), (115, neck_y + 1)], shade(skin, 0.78), S + 31, offset=False)
    p.stroke([(114, neck_y - 6), (112, neck_y + 10), (114, neck_y + 20)], [1.8, 2.4, 1.2], S + 32)
    p.stroke([(142, neck_y - 6), (144, neck_y + 10), (142, neck_y + 20)], [1.8, 2.4, 1.2], S + 33)
    out.append(p.flush())

    # ---- head group (tilt)
    head = []
    face = ellipse_pts(cx, cy, rx, ry, n=16, jaw=c['jaw'], chin=c['chin'])
    # ears
    for side in (-1, 1):
        ex, ey = cx + side * (rx - 1), cy + 8
        ear = [(ex, ey - 9), (ex + side * 6, ey - 7), (ex + side * 7, ey + 2), (ex + side * 3, ey + 9), (ex - side * 1, ey + 8)]
        p.fill(ear, skin, S + 40 + side)
        p.stroke(ear, [1.2, 2.2, 2.4, 1.8, 1.2], S + 42 + side)
        p.stroke([(ex + side * 3, ey - 3), (ex + side * 4, ey + 2), (ex + side * 1, ey + 4)], [0.5, 1.2, 0.5], S + 44 + side)
    # face
    p.fill(face, skin, S + 50)
    # hard shadow on the right side (light from upper-left)
    sh = []
    for (x, y) in face[0:7]:
        sh.append((x, y))
    for (x, y) in reversed(face[0:7]):
        sh.append((x - 8, y))
    p.fill(sh, shade(skin, 0.85), S + 51, offset=False)
    # forehead shadow: a 5-unit strip that follows this character's hair edge (left to right)
    hl = cy - ry + (28 if cid != 'kenji' else 22)
    if cid == 'nadia':
        edge = [(cx - rx + 2, hl - 4), (cx - 18, hl - 9), (cx, hl - 7), (cx + 18, hl - 9), (cx + rx - 2, hl - 4)]
    elif cid == 'kenji':
        edge = [(cx - rx + 12, hl - 10), (cx - 6, hl - 6), (cx + 10, hl - 4), (cx + rx - 12, hl - 10)]
    else:
        edge = [(cx - rx + 2, cy - 30), (cx - 20, cy - 44), (cx - 6, cy - 50), (cx + 12, cy - 42), (cx + rx - 8, cy - 28), (cx + rx - 3, cy - 10)]
    p.fill([(x, y - 6) for x, y in edge] + [(x, y + 5) for x, y in reversed(edge)], shade(skin, 0.88), S + 52, offset=False, wob=0.1)
    # face contour: heavier on the shadow side and under the chin
    wf = [2.2, 2.8, 3.2, 3.4, 3.0, 3.6, 3.2, 2.6, 2.2, 2.0, 2.2, 2.2, 2.0, 1.8, 1.8, 2.0]
    p.stroke(face, wf, S + 53, closed=True)
    # hatch on shaded cheek
    p.hatch(cx + rx - 16, cy + 18, 3, 9, 62, 3.6, S + 54, w=0.9)

    # features
    ey_ = cy - 4; ex_ = 19
    gz = e['gaze']
    draw_eye(p, c, cx - ex_, ey_, e['eyes'], S + 60, gaze=gz)
    draw_eye(p, c, cx + ex_, ey_, e['eyes'], S + 65, gaze=gz)
    bush = 1.35 if cid == 'kenji' else (0.85 if cid == 'lucia' else 1.0)
    draw_brow(p, c, cx - ex_, cy - 22, e['brows'], S + 70, -1, bush)
    draw_brow(p, c, cx + ex_, cy - 22, e['brows'], S + 71, 1, bush)
    draw_nose(p, c, cx, cy, S + 72)
    draw_mouth(p, c, cx, cy + 30, e['mouth'], S + 73)
    if cid == 'kenji':
        # age marks: smile lines, crow's feet, one forehead line
        p.stroke([(cx - 12, cy + 14), (cx - 15, cy + 24), (cx - 11, cy + 33)], [0.5, 1.2, 0.6], S + 74)
        p.stroke([(cx + 12, cy + 14), (cx + 15, cy + 24), (cx + 11, cy + 33)], [0.5, 1.2, 0.6], S + 75)
        for side in (-1, 1):
            p.stroke([(cx + side * 30, ey_ - 2), (cx + side * 35, ey_ - 4)], [0.9, 0.4], S + 76 + side)
            p.stroke([(cx + side * 30, ey_ + 2), (cx + side * 35, ey_ + 4)], [0.9, 0.4], S + 78 + side)
        p.stroke([(cx - 14, cy - 34), (cx, cy - 36), (cx + 14, cy - 34)], [0.4, 1.0, 0.4], S + 80)
        # glasses: round, thin ink, no fill
        for side in (-1, 1):
            ring = ellipse_pts(cx + side * ex_, ey_, 14.5, 13, n=12)
            p.stroke(ring, [1.6, 1.9, 2.1, 1.9, 1.6, 1.5, 1.6, 1.9, 2.1, 1.9, 1.6, 1.5], S + 82 + side, closed=True)
        p.stroke([(cx - 4.5, ey_ - 3), (cx, ey_ - 5), (cx + 4.5, ey_ - 3)], [1.4, 1.8, 1.4], S + 85)
        for side in (-1, 1):
            p.stroke([(cx + side * (ex_ + 14), ey_ - 2), (cx + side * (rx - 2), ey_ + 2)], [1.6, 1.2], S + 86 + side)
    if cid == 'lucia':
        # lash tick
        for side in (-1, 1):
            p.stroke([(cx + side * (ex_ + 9), ey_ - 1), (cx + side * (ex_ + 12), ey_ - 4)], [1.6, 0.4], S + 88 + side)
    if e['blush']:
        for side in (-1, 1):
            p.fill(ellipse_pts(cx + side * 26, cy + 14, 6, 3.4, n=8), BLUSH, S + 90 + side, offset=False, opacity=0.85)

    # ---- hair front
    if cid == 'nadia':
        # tied-back curls: a big soft mass above a wide fabric band at the hairline
        top = []
        for i in range(15):
            t = math.radians(192 + 156 * i / 14)
            r = 1 + 0.09 * math.sin(i * 2.4 + 0.4)
            top.append((cx + (rx + 10) * r * math.cos(t), cy - 20 + (ry + 18) * r * math.sin(t)))
        hairline = [(cx + rx - 2, hl - 4), (cx + 18, hl - 9), (cx, hl - 7), (cx - 18, hl - 9), (cx - rx + 2, hl - 4)]
        shape = top + hairline
        p.fill(shape, hair, S + 100)
        p.fill([top[7], top[8], top[9], top[10], (cx + 22, cy - 52), (cx, cy - 56)], c['hair_hi'], S + 101, offset=False, opacity=0.45)
        ws = [1.8] + [3.4, 2.8, 3.8, 3.0, 3.6, 3.0, 3.8, 2.8, 3.6, 3.0, 3.4, 3.0, 3.4] + [1.8] + [2.0, 1.8, 2.2, 1.8, 2.0]
        p.stroke(shape, ws, S + 102, closed=True)
        # curl marks inside the mass
        for i, (hx, hy) in enumerate([(cx - 30, cy - 58), (cx - 8, cy - 74), (cx + 18, cy - 76), (cx + 36, cy - 58), (cx + 4, cy - 58)]):
            p.stroke([(hx - 5, hy + 3), (hx - 1, hy - 4), (hx + 4, hy + 1), (hx + 1, hy + 5), (hx - 2, hy + 2)], [0.5, 1.5, 1.3, 1.0, 0.4], S + 110 + i, color=c['hair_hi'])
        # band across the hairline
        by0 = hl - 6
        band = [(cx - rx - 6, by0 + 4), (cx - 20, by0 - 10), (cx + 18, by0 - 11), (cx + rx + 6, by0 + 2), (cx + rx + 3, by0 + 11), (cx + 18, by0 - 1), (cx - 20, by0), (cx - rx - 3, by0 + 13)]
        p.fill(band, c['accent'], S + 103)
        p.fill([(cx + 18, by0 - 1), (cx + rx + 6, by0 + 2), (cx + rx + 3, by0 + 11), (cx + 18, by0 + 4)], shade(c['accent'], 0.84), S + 108, offset=False)
        p.stroke(band[:4], [1.6, 2.6, 2.6, 1.6], S + 104)
        p.stroke(band[4:], [1.6, 2.4, 2.4, 1.6], S + 105)
        # knot at the side
        knot = [(cx + rx + 4, by0 + 4), (cx + rx + 16, by0 - 6), (cx + rx + 19, by0 + 5), (cx + rx + 10, by0 + 12)]
        p.fill(knot, c['accent'], S + 106)
        p.stroke(knot, [1.6, 2.2, 2.0, 1.4], S + 107, closed=True)
        # hoop earrings
        for side in (-1, 1):
            exx = cx + side * (rx + 3); eyy = cy + 24
            ring = ellipse_pts(exx, eyy, 6.5, 7, n=10)
            p.stroke(ring, [1.5, 1.8, 2.0, 1.8, 1.5, 1.4, 1.5, 1.8, 2.0, 1.6], S + 120 + side, closed=True, color=c['accent'])
            p.stroke(ring, [0.6, 0.9, 1.1, 0.9, 0.6, 0.5, 0.6, 0.9, 1.1, 0.7], S + 122 + side, closed=True)
    elif cid == 'kenji':
        cap = [(cx - rx + 4, hl + 2), (cx - rx + 8, cy - 40), (cx - 22, cy - 58), (cx, cy - 62), (cx + 22, cy - 58), (cx + rx - 8, cy - 40), (cx + rx - 4, hl + 2),
               (cx + rx - 12, hl - 10), (cx + 10, hl - 4), (cx - 6, hl - 6), (cx - rx + 12, hl - 10)]
        p.fill(cap, hair, S + 100)
        p.fill([(cx - 22, cy - 58), (cx, cy - 62), (cx + 22, cy - 58), (cx + 8, cy - 50), (cx - 10, cy - 50)], c['hair_hi'], S + 101, offset=False, opacity=0.7)
        p.stroke(cap, [1.6, 2.6, 3.2, 3.4, 3.2, 2.6, 1.6, 1.8, 2.2, 2.2, 1.8], S + 102, closed=True)
        # short directional strokes
        for i in range(5):
            hx = cx - 24 + i * 12; hy = cy - 50 + abs(i - 2) * 3
            p.stroke([(hx, hy + 8), (hx + 3, hy)], [1.2, 0.4], S + 110 + i, color=shade(hair, 0.7))
    else:  # lucia: side part on the left, fringe sweeping across to the right temple
        front = [(cx - rx - 4, cy - 28), (cx - rx - 1, cy - 50), (cx - 18, cy - 64), (cx + 8, cy - 67), (cx + 30, cy - 60), (cx + rx + 4, cy - 44),
                 (cx + rx + 7, cy - 14), (cx + rx + 2, cy + 6), (cx + rx - 3, cy - 10), (cx + rx - 8, cy - 28), (cx + 12, cy - 42), (cx - 6, cy - 50),
                 (cx - 20, cy - 44), (cx - rx + 2, cy - 30)]
        p.fill(front, hair, S + 100)
        p.fill([(cx - 18, cy - 64), (cx + 8, cy - 67), (cx + 30, cy - 60), (cx + 18, cy - 54), (cx - 6, cy - 56)], c['hair_hi'], S + 101, offset=False, opacity=0.55)
        p.stroke(front, [2.0, 2.8, 3.6, 3.6, 3.0, 2.6, 2.4, 2.0, 2.2, 2.4, 2.4, 2.2, 2.0, 1.8], S + 102, closed=True)
        # part line + a strand following the sweep
        p.stroke([(cx - 16, cy - 46), (cx - 10, cy - 58), (cx - 2, cy - 65)], [1.6, 1.0, 0.4], S + 110)
        p.stroke([(cx + 4, cy - 56), (cx + 24, cy - 50), (cx + 36, cy - 34)], [0.5, 1.3, 0.5], S + 111, color=c['hair_hi'])
        # stud earrings
        for side in (-1, 1):
            p.dot(cx + side * (rx + 2), cy + 18, 2.6, c['accent'], offset=False)
            p.stroke(ellipse_pts(cx + side * (rx + 2), cy + 18, 2.8, 2.8, n=8), 0.9, S + 120 + side, closed=True)
    head_svg = p.flush()
    tilt = e['tilt']
    out.append(f'<g transform="rotate({tilt} {cx} {f(neck_y)})">{head_svg}</g>' if tilt else head_svg)

    # ---- hands
    hand = e['hand']
    if hand == 'wave':
        draw_hand(p, c, S + 200, 208, 150, 14, k=1.0, sleeve_to=(236, 236))
    elif hand == 'ear':
        draw_hand(p, c, S + 200, 190, 128, -28, k=0.95, sleeve_to=(246, 232))
    elif hand == 'explain':
        draw_hand(p, c, S + 200, 206, 196, 38, k=0.95, sleeve_to=(250, 250))
    out.append(p.flush())
    return ''.join(out)

def portrait_svg(cid, eid):
    c = CAST[cid]
    label = f"{c['name']}, {eid}"
    p = Pen()
    ring = ellipse_pts(128, 128, 118, 118, n=16)
    p.stroke(ring, [3.0, 3.6, 4.0, 3.4, 2.8, 2.6, 3.0, 3.6, 4.2, 3.8, 3.0, 2.6, 2.8, 3.4, 3.8, 3.2], 991, closed=True)
    rim = p.flush()
    body = figure(cid, eid)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="{label}">'
            f'<title>{label}</title>'
            f'<defs><clipPath id="c3-{cid}-{eid}"><circle cx="128" cy="128" r="117"/></clipPath></defs>'
            f'<circle cx="128" cy="128" r="117" fill="{c["bg"]}"/>'
            f'<g clip-path="url(#c3-{cid}-{eid})">{body}</g>{rim}</svg>')

# ------------------------------------------------------------------ scene
def scene_svg():
    p = Pen()
    bg = Pen(ink=0.6, opacity=0.72, dx=1.2, dy=1.0, wob=0.3)   # environment pen: lighter, thinner, slightly transparent ink
    out = []
    out.append(f'<rect width="640" height="360" fill="{PAPER}"/>')
    # back wall
    bg.fill([(0, 0), (640, 0), (640, 244), (0, 244)], PAPER_DEEP, 1, offset=False, wob=0)
    # geometric tile band (original 8-point star lattice, two muted tones)
    out.append(bg.flush())
    out.append('<defs><pattern id="c3-tile" width="36" height="36" patternUnits="userSpaceOnUse">'
               f'<rect width="36" height="36" fill="#E3D4BB"/>'
               f'<path d="M18,2 L22,14 L34,18 L22,22 L18,34 L14,22 L2,18 L14,14 Z" fill="#CFDBD3"/>'
               f'<path d="M18,9 L27,18 L18,27 L9,18 Z" fill="#E0A43A" fill-opacity="0.28"/>'
               f'<path d="M18,2 L22,14 L34,18 L22,22 L18,34 L14,22 L2,18 L14,14 Z" fill="none" stroke="{INK}" stroke-opacity="0.45" stroke-width="0.8"/>'
               f'<path d="M0,0 L0,36 M0,0 L36,0" fill="none" stroke="{INK}" stroke-opacity="0.25" stroke-width="0.7"/>'
               '</pattern></defs>')
    out.append('<rect x="0" y="170" width="640" height="74" fill="url(#c3-tile)"/>')
    bg.stroke([(0, 170), (320, 171), (640, 170)], [1.2, 2.2, 1.2], 2)
    bg.stroke([(0, 244), (320, 243), (640, 244)], [1.2, 2.2, 1.2], 3)
    # window (left) with warm light and a hint of the street outside
    bg.fill([(40, 38), (176, 38), (176, 160), (40, 160)], '#FBE7BE', 4)
    bg.fill([(40, 38), (176, 38), (176, 60), (40, 60)], '#F6D89B', 5, offset=False)  # sky warmer at top
    # distant buildings outside, flat paper tints only
    bg.fill([(42, 158), (42, 112), (74, 112), (74, 96), (118, 96), (118, 120), (150, 120), (150, 104), (174, 104), (174, 158)], '#EFD9AC', 6, offset=False, wob=0.1)
    bg.stroke([(40, 38), (176, 38), (176, 160), (40, 160)], [2.0, 2.4, 2.4, 2.0], 7, closed=True)
    bg.stroke([(108, 40), (108, 158)], [1.6, 1.6], 8); bg.stroke([(42, 100), (174, 100)], [1.6, 1.6], 9)
    # top-right shelf with tea glasses and a teapot
    bg.fill([(452, 92), (628, 92), (628, 100), (452, 100)], '#C8A078', 11)
    bg.stroke([(450, 92), (540, 91), (630, 92)], [1.6, 2.4, 1.6], 12)
    bg.stroke([(450, 100), (540, 101), (630, 100)], [1.0, 1.6, 1.0], 13)
    for i, gx in enumerate((472, 494, 516)):
        g = [(gx - 6, 66), (gx + 6, 66), (gx + 5, 92), (gx - 5, 92)]
        bg.fill(g, '#CFE0D8', 14 + i)
        bg.fill([(gx - 5, 80), (gx + 5, 80), (gx + 5, 92), (gx - 5, 92)], '#B9A270', 20 + i, offset=False)
        bg.stroke(g, [1.2, 1.2, 1.4, 1.4], 26 + i, closed=True)
    # teapot (bulbous body, conical lid, long curved spout) — original silhouette
    pot = [(560, 92), (548, 80), (548, 66), (556, 56), (566, 52), (580, 52), (592, 58), (598, 70), (596, 82), (586, 92)]
    bg.fill(pot, '#C9CDD2', 30)
    bg.fill([(586, 92), (596, 82), (598, 70), (592, 58), (584, 60), (588, 74), (584, 86)], '#A2A7AE', 31, offset=False)
    bg.stroke(pot, [1.4, 2.0, 2.2, 2.0, 1.8, 1.8, 2.0, 2.2, 2.0, 1.4], 32, closed=True)
    bg.fill([(564, 52), (572, 40), (580, 52)], '#C9CDD2', 33); bg.stroke([(564, 52), (572, 40), (580, 52)], [1.2, 1.6, 1.2], 34)
    bg.dot(572, 39, 2.2, INK, offset=False)
    bg.stroke([(548, 72), (534, 66), (526, 52)], [2.4, 2.6, 1.0], 35)  # spout
    bg.stroke([(596, 68), (610, 62), (612, 76), (600, 84)], [1.2, 2.0, 2.0, 1.2], 36)  # handle
    # a framed small picture on the wall (abstract, no text)
    bg.fill([(380, 60), (430, 60), (430, 104), (380, 104)], '#F6EFE3', 40)
    bg.fill([(386, 66), (424, 66), (424, 98), (386, 98)], '#CFE0D8', 41, offset=False)
    bg.fill([(386, 86), (404, 74), (416, 84), (424, 78), (424, 98), (386, 98)], SAGE, 42, offset=False, opacity=0.6)
    bg.dot(412, 74, 4, OCHRE, offset=False)
    bg.stroke([(380, 60), (430, 60), (430, 104), (380, 104)], [1.6, 2.0, 2.0, 1.6], 43, closed=True)
    out.append(bg.flush())

    # ---- Nadia, half body behind the counter (full-strength ink)
    fig = figure('nadia', 'talking', ink=0.95)
    # the 256-space figure is scaled 1.05 and placed so her head sits left of centre
    out.append(f'<g transform="translate(118 -16) scale(1.05)">{fig}</g>')

    # ---- counter (foreground)
    p.fill([(0, 262), (640, 262), (640, 360), (0, 360)], '#A06A43', 50, wob=0)
    p.fill([(0, 262), (640, 262), (640, 280), (0, 280)], '#7D5234', 51, offset=False, wob=0)
    p.fill([(0, 248), (640, 248), (640, 264), (0, 264)], '#D5A871', 52, wob=0)
    p.stroke([(0, 248), (320, 247), (640, 248)], [2.4, 3.0, 2.4], 53)
    p.stroke([(0, 264), (320, 265), (640, 264)], [1.6, 2.4, 1.6], 54)
    # wood grain hint: 3 hairlines
    for i, yy in enumerate((300, 322, 344)):
        p.stroke([(20 + i * 60, yy), (260 + i * 40, yy + 1.5), (480 + i * 30, yy)], [0.4, 1.0, 0.4], 55 + i, opacity=0.5)
    # Nadia's resting hand on the counter (viewer's left)
    hp = Pen(ink=0.95)
    draw_hand(hp, CAST['nadia'], 7000, 206, 236, -118, k=0.9, sleeve_to=(168, 192), sleeve_w=15)
    out.append(p.flush())
    out.append(hp.flush())
    # tea glass with mint next to her hand
    g = [(266, 210), (288, 210), (286, 250), (268, 250)]
    p.fill(g, '#CFE0D8', 60); p.fill([(268, 224), (286, 224), (286, 250), (268, 250)], '#C2A24D', 61, offset=False)
    p.fill([(270, 212), (276, 204), (282, 214), (278, 218)], SAGE, 62, offset=False)
    p.stroke(g, [1.6, 1.6, 2.2, 2.2], 63, closed=True)
    p.stroke([(270, 212), (276, 204), (282, 214)], [0.6, 1.4, 0.6], 64)
    # glass dome with pastries (right of centre, low so the overlay zone stays clear)
    dome = ellipse_pts(470, 236, 52, 30, n=12, a0=180, a1=360)
    dome = dome + [(522, 246), (418, 246)]
    p.fill(dome, '#F2EADA', 70, opacity=0.85)
    p.stroke(dome[:13], [1.6, 2.2, 2.6, 2.8, 2.6, 2.4, 2.2, 2.2, 2.4, 2.6, 2.6, 2.2, 1.6], 71)
    p.stroke([(416, 246), (470, 247), (524, 246)], [2.4, 3.0, 2.4], 72)
    p.dot(470, 206, 3.2, INK, offset=False)
    for i, (px, py, col) in enumerate(((446, 236, OCHRE), (470, 232, TERRA), (494, 236, CAMEL))):
        ps = ellipse_pts(px, py, 13, 8, n=10)
        p.fill(ps, col, 80 + i)
        p.fill(ellipse_pts(px + 2, py + 3, 10, 4, n=8), shade(col), 84 + i, offset=False)
        p.stroke(ps, [1.2, 1.6, 1.8, 1.6, 1.2, 1.2, 1.6, 1.8, 1.6, 1.2], 88 + i, closed=True)
    # espresso machine (far right, boxy, flat chrome)
    mach = [(548, 150), (628, 150), (632, 250), (544, 250)]
    p.fill(mach, '#B9B3AC', 90)
    p.fill([(548, 150), (628, 150), (628, 168), (548, 168)], '#8E8781', 91, offset=False)
    p.fill([(600, 168), (628, 168), (632, 250), (604, 250)], '#8E8781', 92, offset=False)
    p.stroke(mach, [2.2, 2.6, 2.8, 2.4], 93, closed=True)
    p.stroke([(548, 168), (628, 168)], [1.4, 1.8], 94)
    p.fill([(560, 196), (596, 196), (596, 212), (560, 212)], '#D9D4CC', 95); p.stroke([(560, 196), (596, 196), (596, 212), (560, 212)], 1.2, 96, closed=True)
    p.stroke([(566, 212), (566, 228)], [2.4, 1.6], 97); p.stroke([(590, 212), (590, 228)], [2.4, 1.6], 98)
    p.fill([(556, 232), (600, 232), (600, 236), (556, 236)], '#8E8781', 99, offset=False)
    p.dot(612, 184, 4.5, TERRA, offset=False); p.stroke(ellipse_pts(612, 184, 4.5, 4.5, n=8), 1.1, 100, closed=True)
    out.append(p.flush())
    # hand-inked frame
    fr = Pen(wob=0.5)
    fr.stroke([(8, 8), (320, 7), (632, 8), (633, 180), (632, 352), (320, 353), (8, 352), (7, 180)], [2.6, 3.2, 2.6, 3.4, 2.6, 3.2, 2.6, 3.4], 500, closed=True)
    out.append(fr.flush())
    label = 'Nadia at a Casablanca café counter, talking to the learner; tea glasses, a teapot and pastries behind her'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="{label}">'
            f'<title>{label}</title>' + ''.join(out) + '</svg>')

# ------------------------------------------------------------------ style sheet
FONT = "font-family=\"system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\""

def text(x, y, s, size=13, weight=400, color=INK, anchor='start', op=None):
    o = f' fill-opacity="{op}"' if op else ''
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}"{o} {FONT}>{s}</text>'

def style_sheet_svg():
    W, H = 1280, 1090
    o = [f'<rect width="{W}" height="{H}" fill="{PAPER}"/>']
    o.append(text(40, 46, 'C3 · Ink &amp; Fill — character style sheet', 24, 700))
    o.append(text(40, 68, 'Variable-width ink ribbons · flat fills · deliberate misregistration · warm paper. Spec document, not production art (labels use system fonts).', 12, 400, INK, op=0.75))

    # A. line weight
    o.append(text(40, 110, 'A · Line weights (units on a 256 canvas)', 15, 700))
    p = Pen()
    rows = [('Hairline 0.6–1.2 · hatching, strand, wrinkle', [0.5, 1.1, 0.5]), ('Feature 1.4–2.6 · eyes, brows, mouth, nose', [1.0, 2.6, 1.2]),
            ('Contour 2.2–3.6 · face, neck, hands', [2.2, 3.4, 2.4]), ('Silhouette 3.0–4.4 · hair, garment edge, crop ring', [3.0, 4.4, 3.2])]
    for i, (lab, ws) in enumerate(rows):
        y = 136 + i * 34
        p.stroke([(48, y + 6), (120, y - 4), (200, y + 8), (290, y - 2)], ws + [ws[1]], 600 + i)
        o.append(text(310, y + 4, lab, 12))
    o.append(text(40, 282, 'Ends taper to ≈45 %. Pressure is heavier on the shadow side (lower-right) and under the chin.', 11.5, 400, INK, op=0.8))
    o.append(text(40, 300, 'A stroke never has a uniform width. Wobble ≤ 0.35 units at 256, deterministic per feature,', 11.5, 400, INK, op=0.8))
    o.append(text(40, 318, 'so a face stays identical across expressions. Gaps allowed on interior lines, never on the silhouette.', 11.5, 400, INK, op=0.8))
    o.append(p.flush())

    # B. shading stages (egg)
    o.append(text(640, 110, 'B · Shading in three steps (light from upper-left)', 15, 700))
    for i, lab in enumerate((('1 · flat fill', 'misregistered +1.6 / +1.3'), ('2 · + one hard shadow', '−18 % lightness, warmer'), ('3 · + hatching', 'three lines maximum'))):
        cx = 720 + i * 190; cy = 190
        egg = ellipse_pts(cx, cy, 34, 44, n=14, jaw=0.2, chin=1.04)
        p.fill(egg, CAST['nadia']['skin'], 700 + i)
        if i >= 1:
            sh = egg[0:6] + [(x - 10, y) for x, y in reversed(egg[0:6])]
            p.fill(sh, shade(CAST['nadia']['skin']), 710 + i, offset=False)
        if i >= 2:
            p.hatch(cx + 20, cy + 14, 3, 9, 62, 3.6, 720 + i, w=0.9)
        p.stroke(egg, [2.2, 2.8, 3.2, 3.4, 3.0, 3.6, 3.0, 2.4, 2.0, 1.8, 2.0, 2.0, 1.8, 2.0], 730 + i, closed=True)
        o.append(p.flush())
        o.append(text(cx, 256, lab[0], 11, 640, INK, 'middle'))
        o.append(text(cx, 270, lab[1], 10.5, 400, INK, 'middle', 0.8))
    o.append(text(660, 300, 'No gradients, blur, soft shadows or second shadow tone. Highlights are paper showing through', 11.5, 400, INK, op=0.8))
    o.append(text(660, 318, '(eye glint) or one lighter flat shape on hair. Environment pen: ink at 60 % width, 72 % opacity,', 11.5, 400, INK, op=0.8))
    o.append(text(660, 336, 'fills pushed toward paper tints, so the character always wins over the room.', 11.5, 400, INK, op=0.8))

    # C. palette
    o.append(text(40, 372, 'C · Palette (hex) with grayscale check', 15, 700))
    sw = [('Ink', INK), ('Paper', PAPER), ('Paper deep', PAPER_DEEP), ('Ochre', OCHRE), ('Terracotta', TERRA), ('Sage', SAGE), ('Dusk blue', DUSK), ('Oat', OAT), ('Camel', CAMEL), ('Blush', BLUSH),
          ('Skin 1', CAST['kenji']['skin']), ('Skin 2', CAST['lucia']['skin']), ('Skin 3', CAST['nadia']['skin']), ('Skin 4', '#8C5A3A'), ('Hair dark', CAST['nadia']['hair']), ('Hair chestnut', CAST['lucia']['hair']), ('Hair grey', CAST['kenji']['hair'])]
    for i, (lab, col) in enumerate(sw):
        x = 40 + (i % 9) * 134; y = 388 + (i // 9) * 92
        o.append(f'<rect x="{x}" y="{y}" width="110" height="34" rx="4" fill="{col}" stroke="{INK}" stroke-width="1.2"/>')
        o.append(f'<rect x="{x}" y="{y + 36}" width="110" height="10" fill="{gray(col)}" stroke="{INK}" stroke-width="0.6"/>')
        o.append(text(x, y + 62, f'{lab} {col}', 10.5))
    o.append(text(40, 578, 'One accent colour per character (band, earring, lapel); garments stay in the muted set. Skin tones are a four-step family that extends per course;', 11.5, 400, INK, op=0.8))
    o.append(text(40, 596, 'shadow tones are derived (−20 % lightness, +12 % saturation, hue nudged warm), never hand-picked.', 11.5, 400, INK, op=0.8))

    # D. do / don't
    o.append(text(40, 640, 'D · Do', 15, 700, SAGE))
    o.append(text(640, 640, 'E · Don\'t', 15, 700, TERRA))
    dos = ['tapered ribbon strokes, heavier on the shadow side', 'flat fills offset from the ink (two-pass print feel)', 'warm paper backgrounds, ink is warm near-black, never #000',
           'contemporary clothing you would see in that city today', 'one accessory that carries the silhouette (band, glasses, lapel)', 'expressions through brows + mouth + head tilt + one hand']
    donts = ['uniform-width outlines (the baseline look)', 'gradients, blur, soft drop shadows, glossy highlights', 'cross-hatching everywhere — three lines maximum per area',
             'baked-in text, logos, flags, national or religious costume', 'real-person likeness or recognisable brand characters', 'pure black ink, saturated neon fills, pastel vignettes']
    for i, s in enumerate(dos):
        o.append(text(60, 666 + i * 20, '✓  ' + s, 12))
    for i, s in enumerate(donts):
        o.append(text(660, 666 + i * 20, '✕  ' + s, 12))
    # uniform vs ribbon demo
    o.append(f'<path d="M60,802 C120,780 180,830 300,802" fill="none" stroke="{INK}" stroke-width="2.4"/>')
    o.append(text(310, 806, 'uniform stroke (don\'t)', 11, 400, INK, op=0.7))
    p.stroke([(60, 830), (140, 816), (220, 846), (300, 830)], [0.8, 3.4, 2.0, 0.6], 800)
    o.append(p.flush())
    o.append(text(310, 834, 'ribbon stroke (do)', 11, 400, INK, op=0.7))

    # F. scale check with the three neutral portraits at 96 / 48 / 24 and in grayscale
    o.append(text(40, 886, 'F · Scale and grayscale check (neutral portraits at 96, 48 and 24 px; right column desaturated)', 15, 700))
    o.append('<defs><filter id="c3-gray"><feColorMatrix type="saturate" values="0"/></filter>')
    for cid in CAST:
        c = CAST[cid]
        o.append(f'<symbol id="c3-sym-{cid}" viewBox="0 0 256 256"><clipPath id="c3-sc-{cid}"><circle cx="128" cy="128" r="117"/></clipPath>'
                 f'<circle cx="128" cy="128" r="117" fill="{c["bg"]}"/><g clip-path="url(#c3-sc-{cid})">{figure(cid, "neutral")}</g></symbol>')
    o.append('</defs>')
    for j, cid in enumerate(CAST):
        x0 = 40 + j * 300
        o.append(f'<use href="#c3-sym-{cid}" x="{x0}" y="906" width="96" height="96"/>')
        o.append(f'<use href="#c3-sym-{cid}" x="{x0 + 106}" y="954" width="48" height="48"/>')
        o.append(f'<use href="#c3-sym-{cid}" x="{x0 + 164}" y="978" width="24" height="24"/>')
        o.append(f'<g filter="url(#c3-gray)"><use href="#c3-sym-{cid}" x="{x0 + 200}" y="906" width="96" height="96"/>'
                 f'<use href="#c3-sym-{cid}" x="{x0 + 230}" y="978" width="24" height="24"/></g>')
        o.append(text(x0, 1024, CAST[cid]['name'], 11, 600))
    o.append(text(40, 1052, 'At 24 px the ink collapses to a halo and the fills carry recognition: hair mass + skin + one accent colour + the garment tone must stay four distinct grayscale values.', 11.5, 400, INK, op=0.8))
    o.append(text(40, 1070, 'For icon exports (&lt; 48 px) regenerate with ink × 1.6 and drop hatching, lid creases and age marks (figure(ink=1.6) in the generator).', 11.5, 400, INK, op=0.8))
    label = 'C3 Ink and Fill character style sheet'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{label}"><title>{label}</title>' + ''.join(o) + '</svg>')

# ------------------------------------------------------------------ main
if __name__ == '__main__':
    os.makedirs(os.path.join(OUT, 'portraits'), exist_ok=True)
    files = []
    for cid in CAST:
        for eid in EXPR:
            path = os.path.join(OUT, 'portraits', f'{cid}-{eid}.svg')
            open(path, 'w').write(portrait_svg(cid, eid)); files.append(path)
    path = os.path.join(OUT, 'scene-cafe.svg'); open(path, 'w').write(scene_svg()); files.append(path)
    path = os.path.join(OUT, 'style-sheet.svg'); open(path, 'w').write(style_sheet_svg()); files.append(path)
    for fp in files:
        print(f'{os.path.getsize(fp):7d}  {fp}')
