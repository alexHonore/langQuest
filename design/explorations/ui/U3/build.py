#!/usr/bin/env python3
"""Generates the U3 "Paper & Ink" mockups. Pure stdlib. Run: python3 -I build.py
Inlines the existing LangQuest mascot / character / scene / icon SVGs from assets/ as placeholders
(so directions can be compared fairly) and writes home / lesson / conversation (light + dark),
tokens.html and README.md next to this script. Nothing outside this folder is written."""
import os, re, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ASSETS = os.path.join(ROOT, "assets")

# ---------------------------------------------------------------- tokens
THEMES = {
    "light": dict(
        backdrop="#E6E1D6", paper="#F8F4EA", card="#FFFDF7", ink="#1B1A17", ink2="#58534B",
        ink3="#8C8578", hairline="#D8D1C3", accent="#1F49E0", accentInk="#FFFFFF", accentSoft="#E4E9FB",
        success="#1E7A4A", danger="#B42318", warn="#8A5A00", grainBlend="multiply", grainOpacity="0.07",
    ),
    "dark": dict(
        backdrop="#090908", paper="#151410", card="#1F1D18", ink="#F0EADD", ink2="#A9A295",
        ink3="#7D776B", hairline="#3A362E", accent="#8DA4FF", accentInk="#0E1A4D", accentSoft="#232A45",
        success="#6FD39A", danger="#FF8A80", warn="#F2C14E", grainBlend="screen", grainOpacity="0.05",
    ),
}

def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

def luminance(hexc):
    h = hexc.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---------------------------------------------------------------- asset inlining
def read_svg(rel):
    with open(os.path.join(ASSETS, rel), encoding="utf-8") as f:
        s = f.read().strip()
    s = re.sub(r'\s(width|height)="\d+"', "", s, count=2)  # let CSS size it
    return s

def mascot(state, theme):
    rel = f"mascot/{'dark/' if theme == 'dark' else ''}{state}.svg"
    return read_svg(rel)

def character(cid, expr):
    return read_svg(f"characters/{cid}/{expr}.svg")

def scene(sid, theme):
    return read_svg(f"scenes/{'dark/' if theme == 'dark' else ''}{sid}.svg")

def icon(name, size=22, label=None):
    s = read_svg(f"icons/{name}.svg").replace("#1E3A3A", "currentColor")
    s = s.replace("<svg ", f'<svg width="{size}" height="{size}" ', 1)
    if label is None:
        s = re.sub(r'role="img" aria-label="[^"]*"', 'aria-hidden="true"', s, count=1)
        s = re.sub(r"<title>[^<]*</title>", "", s, count=1)
    return s

# ---------------------------------------------------------------- original ink doodles (drawn here, no external source)
def hand_underline(color="var(--accent)", w="100%"):
    return (f'<svg class="hand-ul" style="width:{w}" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden="true">'
            f'<path d="M3 6 C 30 2, 55 9, 85 5 S 140 2, 170 6 S 190 7, 197 4" fill="none" stroke="{color}" '
            f'stroke-width="2.6" stroke-linecap="round"/></svg>')

def doodle_circle(size=112, color="var(--accent)"):
    # two slightly offset sketched rings, like a pen circling the mic
    return (f'<svg class="doodle-ring" width="{size}" height="{size}" viewBox="0 0 112 112" aria-hidden="true">'
            f'<path d="M56 8 C 84 6, 106 28, 104 56 C 102 84, 82 106, 54 104 C 26 102, 6 82, 8 54 C 10 28, 30 10, 58 10" '
            f'fill="none" stroke="{color}" stroke-width="2.4" stroke-linecap="round"/>'
            f'<path d="M60 11 C 86 12, 103 34, 101 60 C 99 86, 78 103, 52 101" fill="none" stroke="{color}" '
            f'stroke-width="1.4" stroke-linecap="round" opacity=".55"/></svg>')

def doodle_arrow():
    return ('<svg class="doodle" width="46" height="26" viewBox="0 0 46 26" aria-hidden="true">'
            '<path d="M2 20 C 12 4, 26 2, 40 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
            '<path d="M33 4 L 41 10 L 32 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

def doodle_asterisk():
    return ('<svg class="doodle" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">'
            '<path d="M11 2 V20 M3 6 L19 16 M19 6 L3 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>')

def doodle_cup():
    return ('<svg class="doodle" width="40" height="34" viewBox="0 0 40 34" aria-hidden="true">'
            '<path d="M5 12 Q 6 30, 18 30 Q 30 30, 31 12 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
            '<path d="M31 15 C 38 14, 38 24, 30 24" fill="none" stroke="currentColor" stroke-width="2"/>'
            '<path d="M14 3 C 12 6, 16 7, 14 10 M21 2 C 19 5, 23 6, 21 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>')

def tape(cls=""):
    return f'<span class="tape {cls}" aria-hidden="true"></span>'

def meter(value, total, w=300):
    # hand-drawn meter: a ruled line and a scribble fill
    pct = value / total
    fill_w = int((w - 8) * pct)
    strokes = []
    x = 6
    while x < fill_w:
        strokes.append(f"M{x} 4 L{x + 6} 14")
        x += 6
    return (f'<svg class="meter" width="{w}" height="18" viewBox="0 0 {w} 18" role="img" aria-label="{value} of {total} speaking turns today">'
            f'<path d="M3 9 H{w - 3}" stroke="var(--hairline)" stroke-width="2" stroke-linecap="round"/>'
            f'<path d="{" ".join(strokes)}" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" fill="none"/>'
            f'<path d="M3 3 V15 M{w - 3} 3 V15" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/></svg>')

def grain(t):
    return ('<svg class="grain" aria-hidden="true"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" '
            'numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>'
            '<rect width="100%" height="100%" filter="url(#grain)"/></svg>')

# ---------------------------------------------------------------- CSS
def css(t, theme):
    return f"""
:root{{--backdrop:{t['backdrop']};--paper:{t['paper']};--card:{t['card']};--ink:{t['ink']};--ink2:{t['ink2']};--ink3:{t['ink3']};
--hairline:{t['hairline']};--accent:{t['accent']};--accent-ink:{t['accentInk']};--accent-soft:{t['accentSoft']};
--success:{t['success']};--danger:{t['danger']};--warn:{t['warn']};
--serif:ui-serif,"New York","Iowan Old Style",Georgia,"Noto Serif","Hiragino Mincho ProN","Noto Serif CJK JP",serif;
--sans:-apple-system,system-ui,"SF Pro Text",Roboto,"Segoe UI","Noto Sans","Hiragino Sans","Noto Sans CJK JP","Noto Naskh Arabic",sans-serif;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,"Roboto Mono",monospace;
--r-s:6px;--r-m:12px;--r-l:18px;--r-pill:999px;
--lift:0 1px 0 var(--hairline),0 8px 18px -10px rgba(0,0,0,.35);
--ease-ink:cubic-bezier(.2,.8,.2,1);--ease-settle:cubic-bezier(.34,1.3,.64,1);
--d-fast:140ms;--d-base:220ms;--d-draw:420ms;
color-scheme:{theme};}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--backdrop);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;
display:flex;flex-wrap:wrap;gap:36px;justify-content:center;align-items:flex-start;padding:28px 16px 60px;min-height:100vh}}
.phone{{width:390px;height:844px;flex:0 0 390px;background:var(--paper);position:relative;overflow:hidden;border-radius:40px;
outline:1px solid var(--hairline);box-shadow:0 40px 80px -30px rgba(0,0,0,.55)}}
.grain{{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20;opacity:{t['grainOpacity']};mix-blend-mode:{t['grainBlend']}}}
.screen{{position:absolute;inset:0;overflow-y:auto;scrollbar-width:none;padding:0 20px 112px}}
.screen::-webkit-scrollbar{{display:none}}
.status{{height:50px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 6px 6px;font:600 14px/1 var(--sans)}}
.status .dots{{display:flex;gap:4px;align-items:center}}
.status .dots i{{display:block;width:4px;background:var(--ink);border-radius:1px}}
.status .batt{{width:24px;height:11px;border:1.5px solid var(--ink);border-radius:3px;padding:1.5px}}
.status .batt i{{display:block;height:100%;width:70%;background:var(--ink);border-radius:1px}}
h1,h2,h3,.serif{{font-family:var(--serif);font-weight:600;letter-spacing:-.01em}}
h1{{font-size:30px;line-height:1.1}}
h2{{font-size:22px;line-height:1.15}}
h3{{font-size:17px;line-height:1.2}}
.eyebrow{{font:600 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}}
.muted{{color:var(--ink2)}} .faint{{color:var(--ink3)}}
.small{{font-size:13px}} .tiny{{font-size:12px}}
.mono{{font-family:var(--mono);font-size:12px;letter-spacing:.02em}}
.hand-ul{{display:block;height:8px;margin-top:2px}}
.stamp{{display:inline-block;font:700 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);
border:1.5px dashed var(--accent);border-radius:4px;padding:5px 7px;transform:rotate(-4deg);white-space:nowrap}}
.card{{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-m);box-shadow:var(--lift);padding:14px;position:relative}}
.card.flat{{box-shadow:none}}
.row{{display:flex;align-items:center;gap:10px}} .between{{justify-content:space-between}} .col{{display:flex;flex-direction:column;gap:4px}}
.grow{{flex:1;min-width:0}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:var(--r-pill);
font:600 15px/1 var(--sans);border:1.5px solid var(--ink);color:var(--ink);background:transparent;cursor:default;white-space:nowrap}}
.btn.primary{{background:var(--ink);color:var(--paper);box-shadow:3px 3px 0 var(--accent)}}
.btn.wide{{width:100%}}
.btn.ghost{{border-color:var(--hairline);color:var(--ink)}}
.btn.text{{border:0;padding:0 8px;min-height:40px;text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:4px;text-decoration-thickness:2px}}
.chip{{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:var(--r-pill);border:1.5px solid var(--hairline);
font:500 13px/1 var(--sans);color:var(--ink);background:var(--card)}}
.chip.on{{border-color:var(--ink);box-shadow:2px 2px 0 var(--accent)}}
.iconbtn{{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid var(--hairline);background:var(--card);color:var(--ink)}}
.taped{{position:relative;border:1.5px solid var(--ink);border-radius:4px;overflow:hidden;background:var(--card)}}
.taped svg{{display:block;width:100%;height:auto}}
.tape{{position:absolute;width:64px;height:18px;background:var(--accent);opacity:.32;transform:rotate(-30deg);left:-18px;top:6px;border-radius:2px;z-index:2}}
.tape.r{{left:auto;right:-18px;transform:rotate(30deg)}}
.tape.br{{left:auto;right:-18px;top:auto;bottom:6px;transform:rotate(-30deg)}}
.tabbar{{position:absolute;left:0;right:0;bottom:0;height:88px;background:var(--paper);border-top:1.5px solid var(--ink);display:flex;padding:8px 6px 22px;z-index:10}}
.tab{{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--ink2);font:600 11px/1 var(--sans);position:relative;padding-top:6px}}
.tab.active{{color:var(--ink)}}
.tab.active .hand-ul{{width:34px;height:6px;position:absolute;bottom:-4px}}
.doodle{{display:inline-block;vertical-align:middle;color:var(--ink2)}}
.doodle.accent{{color:var(--accent)}}
.meter{{display:block}}
.mascot-slot svg{{width:100%;height:100%;display:block}}
.mic-wrap{{display:flex;flex-direction:column;align-items:center;gap:8px}}
.mic{{position:relative;width:112px;height:112px;display:flex;align-items:center;justify-content:center}}
.mic .doodle-ring{{position:absolute;inset:0}}
.mic .core{{width:84px;height:84px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;box-shadow:4px 4px 0 var(--accent)}}
.mic.disabled .core{{background:transparent;color:var(--ink3);border:2px dashed var(--ink3);box-shadow:none}}
.mic.disabled .doodle-ring{{opacity:.25}}
.rtl{{direction:rtl;unicode-bidi:isolate;text-align:right}}
.ar{{font-family:"Geeza Pro","Noto Naskh Arabic","Noto Sans Arabic",var(--sans);font-size:26px;line-height:1.5}}
.ja{{font-family:"Hiragino Sans","Noto Sans CJK JP","Noto Sans JP",var(--sans);line-height:1.5}}
.state{{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 12px;border-radius:var(--r-pill);border:1.5px solid var(--ink);background:var(--card);font:600 12px/1 var(--sans)}}
.state .dot{{width:8px;height:8px;border-radius:50%;background:var(--accent)}}
.state .dot.off{{background:transparent;border:1.5px solid var(--ink3)}}
.state .dots3{{display:inline-flex;gap:3px}} .state .dots3 i{{width:5px;height:5px;border-radius:50%;background:var(--ink)}}
.state.reconnect{{border-color:var(--warn);border-style:dashed}}
.banner{{border:1.5px dashed var(--warn);border-radius:var(--r-m);padding:10px 12px;background:var(--card);display:flex;gap:10px;align-items:flex-start;color:var(--ink)}}
.banner svg{{color:var(--warn);flex:0 0 auto}}
.sheet{{width:390px;flex:0 0 390px;background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-l);padding:20px;box-shadow:var(--lift);display:flex;flex-direction:column;gap:14px}}
.sheet h2{{font-size:20px}}
.sheet .note{{font-size:13px;color:var(--ink2);line-height:1.45}}
hr.rule{{border:0;border-top:1.5px dashed var(--hairline);margin:4px 0}}
.kv{{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px}}
.kv b{{font-weight:600}}
.trail{{display:flex;gap:5px;align-items:center}} .trail i{{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--ink)}} .trail i.done{{background:var(--ink)}} .trail i.now{{background:var(--accent);border-color:var(--accent)}}
.portrait{{width:96px;height:96px;border-radius:50%;border:2px solid var(--ink);background:var(--card);overflow:hidden;box-shadow:3px 3px 0 var(--accent)}}
.portrait svg{{width:100%;height:100%;display:block}}
.transcript{{border-left:2px solid var(--hairline);padding-left:12px;display:flex;flex-direction:column;gap:10px}}
.transcript .who{{font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);margin-bottom:3px}}
.cover{{width:52px;height:52px;border:1.5px solid var(--ink);border-radius:var(--r-s);background:var(--accent-soft);display:flex;align-items:center;justify-content:center;color:var(--accent)}}
.seek{{height:4px;background:var(--hairline);border-radius:2px;position:relative;margin-top:6px}}
.seek i{{position:absolute;left:0;top:0;bottom:0;background:var(--ink);border-radius:2px}}
.seek b{{position:absolute;top:-4px;width:12px;height:12px;border-radius:50%;background:var(--accent);margin-left:-6px}}
@media (prefers-reduced-motion:no-preference){{.pulse .dot{{animation:pulse 1.2s var(--ease-ink) infinite}}}}
@keyframes pulse{{0%,100%{{opacity:.35}}50%{{opacity:1}}}}
"""

def page(title, theme, body, extra_css=""):
    t = THEMES[theme]
    return f"""<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<!-- LangQuest UI direction U3 "Paper & Ink" ({theme}). Self-contained: inline CSS/SVG only, system fonts only.
     Mascot, character, scene and icon SVGs are the repo's existing assets (assets/mascot, assets/characters, assets/scenes, assets/icons)
     inlined as placeholders for fair comparison. All doodles/underlines/stamps are original, drawn in build.py. No CC0/stock assets used. -->
<style>{css(t, theme)}{extra_css}</style>
</head>
<body>
{body}
</body>
</html>
"""

def status_bar():
    return ('<div class="status"><span>9:41</span><span class="dots" aria-hidden="true"><i style="height:4px"></i><i style="height:6px"></i>'
            '<i style="height:8px"></i><i style="height:10px"></i><span class="batt"><i></i></span></span></div>')

def tabbar(active):
    tabs = [("home", "Home"), ("missions", "Missions"), ("audio", "Audio"), ("speak", "Speak"), ("characters", "Me")]
    out = ['<nav class="tabbar" aria-label="Main">']
    for key, label in tabs:
        cls = "tab active" if key == active else "tab"
        ul = hand_underline() if key == active else ""
        out.append(f'<a class="{cls}" aria-current="{"page" if key == active else "false"}">{icon(key, 24)}<span>{label}</span>{ul}</a>')
    out.append("</nav>")
    return "".join(out)

# ---------------------------------------------------------------- HOME
def home(theme):
    body = f"""
<div class="phone" role="region" aria-label="Home / today">
{grain(theme)}
<div class="screen">
{status_bar()}
<header class="row between" style="margin-top:4px;position:relative">
  <div class="row" style="gap:10px">
    <div class="mascot-slot" style="width:84px;height:84px;margin:-6px 0 -4px -4px">{mascot('welcome', theme)}</div>
    <div class="col" style="gap:2px">
      <h1 style="font-size:24px;white-space:nowrap">Welcome back</h1>
      <span class="small muted" style="white-space:nowrap">Ready for a short conversation?</span>
    </div>
  </div>
  <span class="stamp" style="position:absolute;right:0;top:-2px;font-size:10px;padding:4px 6px">Sun 19 Oct</span>
</header>

<section class="row between" style="margin-top:18px">
  <div class="col" style="gap:2px">
    <span class="eyebrow">Your course</span>
    <h2 style="font-size:24px">Moroccan Darija</h2>
    <span class="small muted">Instructions in <b style="color:var(--ink)">French</b> · Casablanca variety</span>
  </div>
  <button class="iconbtn" aria-label="Change course or instruction language">{icon('edit', 20)}</button>
</section>

<section style="margin-top:22px">
  <div class="row between" style="align-items:flex-end">
    <div><span class="eyebrow">Your next real conversation</span>{hand_underline(w="150px")}</div>
    <span class="doodle accent">{doodle_arrow()}</span>
  </div>
  <article class="card" style="margin-top:10px;padding:12px 12px 14px">
    <div class="taped">{tape()}{tape('r')}{scene('cafe', theme)}</div>
    <div class="row between" style="margin-top:12px;align-items:flex-start">
      <div class="col grow">
        <h2>Buy breakfast at the counter</h2>
        <span class="small muted">Mission 4 · about 7 min · you speak with Nadia</span>
      </div>
      <span class="doodle" style="color:var(--ink2)">{doodle_cup()}</span>
    </div>
    <button class="btn primary wide" style="margin-top:12px">{icon('mic', 20)} Start speaking</button>
  </article>
</section>

<section class="card flat" style="margin-top:14px">
  <div class="row between">
    <h3>Spoken today</h3>
    <span class="mono muted">4 / 10 turns</span>
  </div>
  <div style="margin-top:8px">{meter(4, 10, 320)}</div>
  <span class="tiny faint" style="display:block;margin-top:6px">Counts real speaking turns. Not a fluency score.</span>
</section>

<section class="card flat row" style="margin-top:12px;gap:12px">
  <div class="cover" aria-hidden="true">{icon('headphones', 26)}</div>
  <div class="col grow">
    <span class="eyebrow" style="font-size:11px">Continue audio</span>
    <b class="serif" style="font-size:16px">Au marché · chapter 3</b>
    <div class="seek" aria-hidden="true"><i style="width:70%"></i><b style="left:70%"></b></div>
    <span class="mono muted" style="margin-top:4px">12:40 · 18:05 left to play</span>
  </div>
  <button class="iconbtn" aria-label="Resume audio" style="border-color:var(--ink)">{icon('play', 20)}</button>
</section>

<section class="card flat" style="margin-top:12px">
  <div class="row between">
    <div class="row" style="gap:6px"><h3>Due reviews</h3><span class="doodle accent">{doodle_asterisk()}</span></div>
    <span class="mono muted">5 across your courses</span>
  </div>
  <ul style="list-style:none;margin-top:10px;display:flex;flex-direction:column;gap:10px">
    <li class="row between" style="align-items:flex-start">
      <div class="col grow">
        <span class="ar rtl" lang="ar-MA" style="font-size:22px">واش كاين شي بلاصة خاوية؟</span>
        <span class="small muted">Is there a free seat? · Darija</span>
      </div>
    </li>
    <li class="row between" style="align-items:flex-start;border-top:1.5px dashed var(--hairline);padding-top:10px">
      <div class="col grow">
        <span class="ja" lang="ja" style="font-size:19px">すみません、これをください。</span>
        <span class="small muted">Excuse me, this one please · Japanese</span>
      </div>
    </li>
  </ul>
  <button class="btn ghost wide" style="margin-top:12px">{icon('replay', 18)} Review 5 expressions</button>
</section>
</div>
{tabbar('home')}
</div>
"""
    return page(f"U3 Paper & Ink · Home ({theme})", theme, body)

# ---------------------------------------------------------------- LESSON
def compare_sheet(theme):
    return f"""
<aside class="sheet" aria-label="After you speak: compare state">
  <span class="stamp" style="align-self:flex-start">State · after you speak</span>
  <h2>Reveal &amp; compare</h2>
  <p class="note">Shown in the same slot as the prompt once the learner has spoken (or chose to reveal). No score, no percentage, no waveform. This is the honest pattern for every track without a validated phoneme evaluator.</p>
  <div class="card flat">
    <span class="eyebrow">What we heard</span>
    <p class="serif" style="font-size:18px;margin-top:6px">« Atay b n3na3, 3afak »</p>
    <span class="tiny faint">Transcription only. It can be wrong; it is not pronunciation feedback.</span>
    <hr class="rule" style="margin:12px 0">
    <span class="eyebrow">Model answer · Nadia</span>
    <p class="ar rtl" lang="ar-MA" style="font-size:22px;margin-top:4px">أتاي بالنعناع، عافاك</p>
    <p class="small muted">Atay b n3na3, 3afak — Un thé à la menthe, s’il vous plaît</p>
    <div class="row" style="margin-top:12px;gap:8px">
      <span class="chip on">{icon('play', 16)} Play mine</span>
      <span class="chip">{icon('volume', 16)} Play model</span>
      <span class="chip">{icon('slow', 16)} Slow</span>
    </div>
  </div>
  <div class="banner" role="status">{icon('info', 20)}<div class="small" style="line-height:1.4"><b>Detailed phoneme assessment not available</b> for Moroccan Darija yet. Compare by ear: listen to yours, then the model, and try once more if you like.</div></div>
  <div class="row" style="gap:8px"><span class="btn ghost grow">{icon('replay', 18)} Try again</span><span class="btn primary grow">Next {icon('chevronRight', 18)}</span></div>
  <p class="note">If a validated evaluator exists for a track, this same card gains a word-level list (“rhythm”, “stress”, “vowel length”) with text labels, never colour alone.</p>
</aside>"""

def lesson(theme):
    body = f"""
<div class="phone" role="region" aria-label="Lesson: listen, anticipate, speak">
{grain(theme)}
<div class="screen" style="padding-bottom:12px">
{status_bar()}
<header class="row between" style="margin-top:2px">
  <button class="iconbtn" aria-label="Back to mission" style="border-color:transparent;background:transparent">{icon('chevronLeft', 24)}</button>
  <div class="col" style="align-items:center;gap:5px">
    <span class="small"><span class="muted">Mission ·</span> <b class="serif" style="font-size:16px">Order a coffee</b></span>
    <span class="trail" aria-label="Step 2 of 5"><i class="done"></i><i class="now"></i><i></i><i></i><i></i></span>
  </div>
  <span class="mono muted" style="width:44px;text-align:right">2 / 5</span>
</header>

<section style="margin-top:14px;position:relative">
  <div class="taped">{tape()}{tape('br')}{scene('cafe', theme)}</div>
  <div class="portrait" style="position:absolute;left:14px;bottom:-26px">{character('ary-cafe-staff-nadia', 'talking')}</div>
  <span class="state pulse" style="position:absolute;right:12px;bottom:-14px"><span class="dot"></span>Nadia is speaking</span>
</section>

<section class="card" style="margin-top:36px;padding:12px 16px">
  <span class="eyebrow">Nadia · Darija</span>
  <p class="ar rtl" lang="ar-MA" style="margin-top:6px">شنو بغيتي تشرب؟</p>
  <p class="small muted">Chnou bghiti tchreb?</p>
  <div class="row" style="margin-top:12px;gap:8px">
    <span class="chip">{icon('replay', 16)} Replay</span>
    <span class="chip">{icon('slow', 16)} Slow</span>
    <span class="chip">{icon('translate', 16)} Translate?</span>
  </div>
</section>

<section style="margin-top:12px;text-align:center">
  <h2 lang="fr" style="font-size:23px;display:inline-block">Comment répondriez-vous ?</h2>
  {hand_underline(w="180px").replace('class="hand-ul"', 'class="hand-ul" style="margin:2px auto 0;width:180px"')}
  <p class="small muted" lang="fr" style="margin-top:6px">Formulez votre réponse à voix haute avant de voir le modèle.</p>
</section>

<section class="mic-wrap" style="margin-top:14px">
  <button class="mic" aria-label="Hold or tap to speak">{doodle_circle()}<span class="core">{icon('mic', 36)}</span></button>
  <span class="small" lang="fr"><b>Appuyez</b> pour parler · maintenir facultatif</span>
</section>

<section class="row" style="margin-top:10px;gap:10px">
  <span class="btn ghost grow" lang="fr">{icon('hint', 18)} Un indice</span>
  <span class="btn grow" lang="fr">{icon('transcript', 18)} Révéler &amp; comparer</span>
</section>
<button class="btn text small" lang="fr" style="margin:4px auto 0;display:flex;color:var(--ink2)">Aide par mot {icon('chevronRight', 14)}</button>
</div>
</div>
{compare_sheet(theme)}
"""
    return page(f"U3 Paper & Ink · Lesson ({theme})", theme, body)

# ---------------------------------------------------------------- CONVERSATION
def state_sheet(theme):
    rows = [
        ('<span class="state pulse"><span class="dot"></span>Youssef is speaking</span>', "Portrait in `talking`, dot pulses. Mic stays enabled: tapping interrupts."),
        ('<span class="state"><span class="dot" style="background:var(--ink)"></span>Your turn</span>', "Portrait in `listening`. Mic ring draws in (420 ms). No timer."),
        ('<span class="state"><span class="dots3"><i></i><i></i><i></i></span>Thinking…</span>', "Three ink dots step (not a waveform). Learner can still tap mic."),
        ('<span class="state reconnect"><span class="dot off"></span>Reconnecting · attempt 2</span>', "Dashed warn border. Mic disabled, last turn kept, Leave always active."),
        ('<span class="state reconnect"><span class="dot off"></span>Microphone permission needed</span>', "Replaces mic label with a settings link; conversation can continue in text/listen mode."),
    ]
    items = "".join(f'<li class="col" style="gap:6px;align-items:flex-start">{a}<span class="note">{b}</span></li>' for a, b in rows)
    return f"""
<aside class="sheet" aria-label="Speech-state indicator variants">
  <span class="stamp" style="align-self:flex-start">Speech states</span>
  <h2>One pill, five honest states</h2>
  <p class="note">The indicator never shows an animated waveform. Motion is a single dot or three stepping dots, and only while audio is really playing or a request is really in flight.</p>
  <ul style="list-style:none;display:flex;flex-direction:column;gap:16px">{items}</ul>
  <hr class="rule">
  <p class="note"><b>Light file</b> shows the “speaking” state; <b>dark file</b> shows the “reconnecting” state so both are visible at phone size.</p>
</aside>"""

def conversation(theme):
    reconnecting = theme == "dark"
    expr = "neutral" if reconnecting else "talking"
    if reconnecting:
        state_pill = '<span class="state reconnect"><span class="dot off"></span>Reconnecting · attempt 2</span>'
        banner = f'''<div class="banner" role="status" aria-live="polite" style="margin-top:12px">{icon('warning', 20)}<div class="small" style="line-height:1.4"><b>Connection dropped.</b> Reconnecting (attempt 2 of 5). Your last answer is saved; Youssef will pick up where you left off. You can leave at any time.</div></div>'''
        mic_cls, mic_label = "mic disabled", "Microphone paused while reconnecting"
        mic_caption = '<span class="small muted">Mic paused · nothing is being recorded</span>'
    else:
        state_pill = '<span class="state pulse"><span class="dot"></span>Youssef is speaking</span>'
        banner = ""
        mic_cls, mic_label = "mic", "Tap to answer, or to interrupt"
        mic_caption = '<span class="small"><b>Tap</b> to answer · tap while he talks to interrupt</span>'

    body = f"""
<div class="phone" role="region" aria-label="Live conversation with Youssef">
{grain(theme)}
<div class="screen" style="padding-bottom:28px">
{status_bar()}
<header class="row between" style="margin-top:2px">
  <div class="col" style="gap:2px">
    <span class="eyebrow">Live conversation</span>
    <h2 style="font-size:19px;white-space:nowrap">Youssef <span class="muted" style="font-weight:400">· your neighbour</span></h2>
  </div>
  <div class="row" style="gap:8px">
    <span class="mono muted" style="white-space:nowrap">turn 6</span>
    <button class="btn text" style="color:var(--ink);padding:0 4px">{icon('close', 16)} Leave</button>
  </div>
</header>
{banner}
<section style="margin-top:14px;position:relative">
  <div class="taped" style="height:224px">{tape()}{tape('r')}{scene('street', theme).replace('<svg ', '<svg style="height:224px;width:100%" preserveAspectRatio="xMidYMax slice" ', 1)}
    <div style="position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(to top,var(--paper),transparent);"></div>
    <div style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:168px;height:168px;border-radius:50%;border:2px solid var(--ink);background:var(--card);overflow:hidden;box-shadow:4px 4px 0 var(--accent)">{character('ary-neighbour-youssef', expr)}</div>
  </div>
  <div style="display:flex;justify-content:center;margin-top:-16px;position:relative;z-index:3">{state_pill}</div>
</section>

<section class="transcript" style="margin-top:14px" aria-label="Transcript">
  <div>
    <div class="who">Youssef · Darija</div>
    <p class="ar rtl" lang="ar-MA" style="font-size:22px">فين غادي دابا؟</p>
    <p class="small muted">Fin ghadi daba? <span class="faint">· Where are you going now?</span></p>
  </div>
  <div style="opacity:.8">
    <div class="who">You</div>
    <p class="small">Ghadi l souq, bghit nchri khoubz.</p>
  </div>
</section>

<section class="mic-wrap" style="margin-top:14px">
  <button class="{mic_cls}" aria-label="{mic_label}" {'aria-disabled="true"' if reconnecting else ''}>{doodle_circle()}<span class="core">{icon('micOff' if reconnecting else 'mic', 36)}</span></button>
  {mic_caption}
</section>

<section class="row" style="margin-top:12px;justify-content:space-between;padding:0 6px">
  <span class="tab" style="flex:0 0 auto">{icon('replay', 22)}<span>Repeat</span></span>
  <span class="tab" style="flex:0 0 auto">{icon('slow', 22)}<span>Slow</span></span>
  <span class="tab" style="flex:0 0 auto">{icon('hint', 22)}<span>Hint</span></span>
  <span class="tab" style="flex:0 0 auto">{icon('translate', 22)}<span>Translate</span></span>
  <span class="tab active" style="flex:0 0 auto">{icon('transcript', 22)}<span>Transcript</span>{hand_underline()}</span>
</section>
<p class="tiny faint" style="text-align:center;margin-top:10px" lang="fr">Les indices sont en français · Youssef parle darija</p>
</div>
</div>
{state_sheet(theme)}
"""
    return page(f"U3 Paper & Ink · Conversation ({theme})", theme, body)

# ---------------------------------------------------------------- TOKENS
def tokens_page():
    def sw(theme, key):
        return THEMES[theme][key]
    pairs = [
        ("ink on paper", "ink", "paper"), ("ink on card", "ink", "card"), ("ink2 on paper", "ink2", "paper"),
        ("ink3 on paper (decorative only)", "ink3", "paper"), ("accent on paper", "accent", "paper"), ("accent on card", "accent", "card"),
        ("accent-ink on accent (button text)", "accentInk", "accent"), ("paper on ink (primary button)", "paper", "ink"),
        ("success on paper", "success", "paper"), ("danger on paper", "danger", "paper"), ("warn on paper", "warn", "paper"),
        ("hairline vs paper (non-text, ≥1.5 target)", "hairline", "paper"),
    ]
    def table(theme):
        rows = []
        for label, fg, bg in pairs:
            c = contrast(sw(theme, fg), sw(theme, bg))
            grade = "AAA" if c >= 7 else "AA" if c >= 4.5 else "AA-large/UI" if c >= 3 else "fail"
            rows.append(f'<tr><td><span class="sw" style="background:{sw(theme,bg)};color:{sw(theme,fg)}">Aa</span>{label}</td>'
                        f'<td class="mono">{sw(theme,fg)} / {sw(theme,bg)}</td><td class="mono">{c:.2f} : 1</td><td>{grade}</td></tr>')
        return "".join(rows)
    def swatches(theme):
        keys = ["paper", "card", "ink", "ink2", "ink3", "hairline", "accent", "accentInk", "accentSoft", "success", "danger", "warn"]
        return "".join(f'<div class="swatch"><i style="background:{sw(theme,k)}"></i><b>{k}</b><span class="mono">{sw(theme,k)}</span></div>' for k in keys)

    extra = """
.doc{width:min(1080px,100%);display:flex;flex-direction:column;gap:28px}
.doc section{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-l);padding:22px 24px;box-shadow:var(--lift)}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}
.swatch{display:flex;flex-direction:column;gap:4px;font-size:13px}
.swatch i{display:block;height:48px;border-radius:8px;border:1px solid var(--hairline)}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
td,th{text-align:left;padding:8px 6px;border-bottom:1px dashed var(--hairline);vertical-align:middle}
th{font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.sw{display:inline-flex;width:34px;height:26px;align-items:center;justify-content:center;border:1px solid var(--hairline);border-radius:6px;margin-right:10px;font:700 13px var(--serif)}
.dark-wrap{--backdrop:#090908;--paper:#151410;--card:#1F1D18;--ink:#F0EADD;--ink2:#A9A295;--ink3:#7D776B;--hairline:#3A362E;--accent:#8DA4FF;--accent-ink:#0E1A4D;--accent-soft:#232A45;--success:#6FD39A;--danger:#FF8A80;--warn:#F2C14E;background:var(--paper);color:var(--ink);border-radius:var(--r-m);padding:16px;margin-top:12px}
.type-row{display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:baseline;padding:10px 0;border-bottom:1px dashed var(--hairline)}
.radii{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}
.radii div{width:110px;height:70px;border:1.5px solid var(--ink);display:flex;align-items:flex-end;padding:8px;font-size:12px}
.elev{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}
.elev div{width:160px;height:90px;border-radius:var(--r-m);background:var(--card);padding:10px;font-size:12px;border:1px solid var(--hairline)}
"""
    t = THEMES["light"]
    body = f"""
<main class="doc">
  <header class="row between" style="align-items:flex-end">
    <div><span class="eyebrow">LangQuest · UI direction U3</span><h1 style="margin-top:6px">Paper &amp; Ink — tokens</h1>{hand_underline(w="220px")}</div>
    <span class="stamp">rev 1 · 2026-10-19</span>
  </header>

  <section>
    <h2>Palette</h2>
    <p class="small muted" style="margin-top:4px">Near-white warm paper, one ink, one bright accent (cobalt, “ballpoint on a postcard”). Semantic colours exist for states but never carry meaning alone — every state also has a label and an icon.</p>
    <h3 style="margin-top:16px">Light</h3>
    <div class="swatches">{swatches('light')}</div>
    <table><thead><tr><th>Pair</th><th>fg / bg</th><th>Ratio</th><th>WCAG</th></tr></thead><tbody>{table('light')}</tbody></table>
    <div class="dark-wrap">
      <h3>Dark (“night paper”)</h3>
      <div class="swatches">{swatches('dark')}</div>
      <table><thead><tr><th>Pair</th><th>fg / bg</th><th>Ratio</th><th>WCAG</th></tr></thead><tbody>{table('dark')}</tbody></table>
    </div>
    <p class="tiny faint" style="margin-top:10px">Ratios computed with the WCAG 2.x relative-luminance formula in build.py. ink3 is for decorative captions only (never for required information).</p>
  </section>

  <section>
    <h2>Type scale</h2>
    <p class="small muted" style="margin-top:4px">Two system families: a serif for titles (ui-serif / New York / Georgia / Noto Serif) and the platform sans for everything else. Mono for stamps and timestamps. No bundled fonts. All sizes scale with the OS text size; the serif is never used below 16 px.</p>
    <div class="type-row"><span class="mono muted">display · serif 600 · 30/33</span><span class="serif" style="font-size:30px;line-height:1.1">Welcome back</span></div>
    <div class="type-row"><span class="mono muted">title · serif 600 · 24/28</span><span class="serif" style="font-size:24px">Moroccan Darija</span></div>
    <div class="type-row"><span class="mono muted">heading · serif 600 · 22/25</span><span class="serif" style="font-size:22px">Buy breakfast at the counter</span></div>
    <div class="type-row"><span class="mono muted">subhead · serif 600 · 17/20</span><span class="serif" style="font-size:17px">Spoken today</span></div>
    <div class="type-row"><span class="mono muted">body · sans 400 · 15/22</span><span style="font-size:15px;line-height:1.45">Formulez votre réponse à voix haute avant de voir le modèle.</span></div>
    <div class="type-row"><span class="mono muted">small · sans 400 · 13/18</span><span class="small">Counts real speaking turns. Not a fluency score.</span></div>
    <div class="type-row"><span class="mono muted">eyebrow · sans 600 · 12 · +12% tracking</span><span class="eyebrow">Your next real conversation</span></div>
    <div class="type-row"><span class="mono muted">stamp · mono 700 · 11 · +14%</span><span class="stamp" style="transform:none">Sun 19 Oct</span></div>
    <div class="type-row"><span class="mono muted">target script · Arabic 26/39 (RTL)</span><span class="ar rtl" lang="ar-MA">شنو بغيتي تشرب؟</span></div>
    <div class="type-row"><span class="mono muted">target script · Japanese 19/29</span><span class="ja" lang="ja" style="font-size:19px">すみません、これをください。</span></div>
    <div class="type-row"><span class="mono muted">target script · Hangul 19/29</span><span lang="ko" style="font-size:19px;line-height:1.5">실례합니다, 이거 주세요.</span></div>
  </section>

  <section>
    <h2>Radii, lines and elevation</h2>
    <div class="radii">
      <div style="border-radius:var(--r-s)">6 · stamps, covers</div>
      <div style="border-radius:var(--r-m)">12 · cards</div>
      <div style="border-radius:var(--r-l)">18 · sheets</div>
      <div style="border-radius:var(--r-pill)">999 · buttons, chips, pills</div>
      <div style="border-radius:4px">4 · taped photos</div>
    </div>
    <p class="small muted" style="margin-top:14px">Lines: 1 px hairline (dividers, quiet cards), 1.5 px ink (emphasis: taped frames, tab bar top, chips when on), 2 px ink for portrait frames. Dashed = provisional / pending / network. Solid = settled.</p>
    <div class="elev">
      <div style="box-shadow:none">0 · flat paper<br><span class="muted">in-flow content</span></div>
      <div style="box-shadow:var(--lift)">1 · lift<br><span class="muted">cards: 1px hairline + soft 18px blur, low alpha</span></div>
      <div style="box-shadow:3px 3px 0 var(--accent);border-color:var(--ink)">2 · press<br><span class="muted">hard accent offset: primary, mic, portrait</span></div>
      <div style="box-shadow:0 24px 40px -20px rgba(0,0,0,.45)">3 · sheet<br><span class="muted">modals/bottom sheets only</span></div>
    </div>
    <p class="small muted" style="margin-top:12px">Paper grain is a single inline feTurbulence layer at 5–7 % over the whole screen (multiply in light, screen in dark). On low-end Android it is rendered once to a cached bitmap, never per-frame.</p>
  </section>

  <section>
    <h2>Motion</h2>
    <table><thead><tr><th>What animates</th><th>Duration</th><th>Easing</th><th>Notes / engine</th></tr></thead><tbody>
      <tr><td>Hand underline draws in under a new heading</td><td>420 ms</td><td>ease-ink (.2,.8,.2,1)</td><td>stroke-dashoffset; Reanimated on RN. Once per screen mount.</td></tr>
      <tr><td>Primary button press: offset shadow collapses 3→1 px, button moves 2 px</td><td>140 ms</td><td>ease-ink</td><td>Reanimated; haptic light on release</td></tr>
      <tr><td>Mic doodle ring “draws” when it becomes the learner’s turn</td><td>420 ms</td><td>ease-ink</td><td>Lottie (vector ring); static ring if reduced motion</td></tr>
      <tr><td>Speech-state dot pulse</td><td>1.2 s loop</td><td>ease-ink</td><td>Only while audio is actually playing. Reanimated.</td></tr>
      <tr><td>Thinking: three dots step</td><td>900 ms loop</td><td>steps(3)</td><td>Only while a request is in flight; never a waveform</td></tr>
      <tr><td>Card enter (home sections)</td><td>220 ms, 40 ms stagger</td><td>ease-settle (.34,1.3,.64,1)</td><td>opacity + 8 px translate; max 4 items</td></tr>
      <tr><td>Stamp “thump” on daily goal reached</td><td>260 ms</td><td>ease-settle</td><td>scale 1.15→1 + 3° rotation; Reanimated; haptic medium</td></tr>
      <tr><td>Mascot idle/blink, reaction, celebrate</td><td>per mascot guide</td><td>—</td><td>Rive state machine (states = mascot contract). One instance per screen.</td></tr>
      <tr><td>Page transitions</td><td>220 ms</td><td>ease-ink</td><td>Cross-fade + 12 px slide; the tab bar does not animate</td></tr>
    </tbody></table>
    <p class="small muted" style="margin-top:12px"><b>Reduced motion</b>: every loop stops, draw-ins become instant, transitions become 120 ms cross-fades; the speech state is then conveyed by the label and icon alone (already present). Nothing above ever blocks recording or playback.</p>
  </section>
</main>
"""
    return page("U3 Paper & Ink · Tokens", "light", body, extra)

# ---------------------------------------------------------------- README
def readme():
    L, D = THEMES["light"], THEMES["dark"]
    def r(theme, fg, bg):
        return f"{contrast(THEMES[theme][fg], THEMES[theme][bg]):.2f}:1"
    return f"""# U3 — Paper & Ink

UI direction **U3** for LangQuest. Status: concept for owner approval, not production UI.
Everything in this folder is generated by `build.py` (pure Python stdlib, no installs). Each HTML file is
self-contained: inline CSS, inline SVG, system fonts only, no external requests.

## Concept

**“A travel journal you speak into.”** Near-white warm paper, one black ink, one bright accent (cobalt — the
ballpoint you write postcards with), and hand-drawn marks: a wobbly underline under the thing that matters,
a dashed rubber stamp for dates and states, strips of tape holding scene “photos” on the page, a pen-circled
microphone. Titles are set in the system serif (New York / Georgia / Noto Serif) so screens read like editorial
pages rather than dashboards; everything functional is in the platform sans. There is no second colour
competing with the content: the course’s script, the character’s face and the scene art are the colour.

## Personality and rationale

Playful editorial, not gamified. The journal metaphor matches a *conversation-first* product: every mission is
an entry, every spoken turn is a line written down, reviews are the pages you flip back to. Paper also solves a
product-honesty problem elegantly — on paper nothing glows, nothing fills up, nothing shows a fake waveform;
progress is tally marks on a ruled line, a state is a stamp with words on it. The direction makes the 30 target
scripts the hero: large Arabic, Japanese and Hangul set on calm paper look like the real thing, not like a
toy. For adults it feels premium; the doodles and stamps keep it light for beginners.

## What the files show

| File | What it is |
| --- | --- |
| `home.html`, `home-dark.html` | Home / today (the phone scrolls; the due-reviews card with the script samples is below the fold): mascot slot (baseline `welcome` state inlined), date stamp, course header (Moroccan Darija, instructions in French) with an edit affordance, next-mission card as a taped scene photo with a single “Start speaking” CTA, daily speaking meter (tally marks, labelled “not a fluency score”), continue-audio row, due reviews **with an Arabic (RTL) and a Japanese sample**, 5-tab bar. |
| `lesson.html`, `lesson-dark.html` | Listen → anticipate → speak: taped café scene with Nadia’s portrait and a speech-state pill, character line in Arabic script + transliteration, Replay / Slow / Translate?, the prompt in **French** (the course’s instruction language) with a hand underline, large pen-circled mic, “Un indice” / “Révéler & comparer”, word help collapsed. Beside the phone, the **after-you-speak compare card** with the honest “detailed phoneme assessment not available” pattern: transcript + model answer + play buttons, no score. |
| `conversation.html` | Live AI conversation: street scene fading into paper, large Youssef portrait with a hard accent shadow, speech-state pill (“Youssef is speaking”), transcript on, single primary mic (tap to answer or interrupt), Repeat / Slow / Hint / Translate / Transcript row, Leave at the top. Beside it, the five speech-state variants. |
| `conversation-dark.html` | Same screen in the **reconnecting** state: dashed warn banner (“attempt 2 of 5, your last answer is saved”), mic drawn dashed and disabled with “nothing is being recorded”, portrait static, Leave still active. |
| `tokens.html` | Palette for both themes with hex and computed WCAG contrast ratios, type scale (incl. Arabic, Japanese, Hangul samples), radii, line weights, elevation, paper-grain note, motion table. |
| `build.py` | Generator; re-run with `python3 -I build.py` from this folder. |
| `README.md` | This file. |

UI chrome is in English (the learner’s UI locale); the lesson prompts/hints are in French because that is the
course’s instruction language — this is the real product behaviour (UI locale ≠ course source language), not a
mix-up. The Darija lines are plausible mockup copy and need native review before any reuse.

## Strengths

- **Genuinely different** from the baseline and from the category: no saturated gradient cards, no mascot-driven
  colour, no progress rings. It cannot be mistaken for Duolingo, Babbel, Memrise or Drops.
- **Honesty is built into the visual language.** Stamps carry words, meters are tally marks, speech states are
  labelled pills; there is nowhere for a fake score or waveform to hide.
- **Scripts look great on it.** Warm paper + one ink gives Arabic, CJK and Devanagari maximum legibility; the
  serif/sans pairing degrades gracefully to Noto on Android.
- **Cheap to build and fast on low-end Android**: flat colours, one cached grain bitmap, hairlines instead of
  shadows, one accent. Most “illustration” is CSS/SVG strokes.
- **Dark mode is a real theme, not an inversion**: “night paper” (#151410) with cream ink and a lighter cobalt,
  all pairs ≥ 4.5:1 (see table).
- Contrast: ink/paper {r('light','ink','paper')} light, {r('dark','ink','paper')} dark; accent/paper
  {r('light','accent','paper')} light, {r('dark','accent','paper')} dark; button text on accent {r('light','accentInk','accent')}.

## Risks

- **Can read as “quiet” or “serious”** if the doodles are under-used; needs a disciplined decoration budget
  (one underline, one stamp, one doodle per screen) so it stays playful without becoming scrapbook clutter.
- **The baseline mascot (teal body, orange ribbon) is the loudest colour on the page.** For fairness it is
  inlined unchanged here; if U3 is chosen, the mascot should get an ink-outline rendition (ink lines, paper
  body, cobalt ribbon) or the accent should move toward the ribbon orange — decide together with the mascot pick.
- **Hand-drawn marks must stay vector and must not be “cute” at the expense of a11y**: the underline and ring
  are decoration; every state also has a text label and an icon, and the tab underline is paired with the
  active colour and `aria-current`.
- **Paper grain** on OLED dark looks grey if overdone; capped at 5 % and must be tested on real devices.
- **Serif at small sizes** is unreadable; the token rule “serif never below 16 px” must be enforced in the
  component library.
- One accent means semantic colours (success/danger/warn) must be visibly *different in shape* too — hence
  dashed borders for pending/network states and icons on all banners.

## Accessibility notes

- All text pairs meet WCAG AA (most AAA); `ink3` is restricted to decorative captions. Ratios are computed,
  not estimated, in `build.py` and shown in `tokens.html`.
- **RTL / Arabic**: Arabic runs use `dir="rtl"`, `lang="ar-MA"` and an Arabic-first font stack at 22–26 px with
  1.5 line-height; shown in `home.html` (due review), `lesson.html` (character line + model answer) and
  `conversation.html` (transcript). Layout mirroring for an RTL *UI locale* is a logical-properties job
  (start/end), with the mascot mirrored whole per the mascot guide.
- **CJK**: Japanese sample in `home.html` and `tokens.html` (plus Hangul in tokens) at 19 px / 1.5. The serif
  stack includes Hiragino Mincho / Noto Serif CJK so titles stay serif in Japanese.
- Tap targets ≥ 44 px (icon buttons, chips are 36 px high but ≥ 44 px wide with 8 px spacing; the mic is 112 px).
- Meaning never by colour alone: states are pill + label + icon; reviews/progress have text equivalents; the
  daily meter has an `aria-label` with the real counts.
- Reduced motion: all loops stop; draw-ins are instant; state pills keep their labels.
- Large text / French expansion: cards are height-free; headings wrap; the tab bar labels are 11 px semibold
  and truncate rather than overflow.

## Motion plan

- **Rive**: the mascot only (one state machine driven by the 17 contract states; one instance per screen,
  none in lists). Static SVG fallback is the existing export.
- **Lottie**: the pen-circled mic ring draw-in and the “stamp thump” on goal reached — small vector clips, ≤ 420 ms.
- **Reanimated**: everything structural — underline draw-in on mount, button press (offset shadow collapses),
  speech-state dot pulse / thinking steps, card enter stagger, page transitions. Durations and easings are
  listed in `tokens.html` (140 / 220 / 420 ms; `ease-ink` (.2,.8,.2,1) and `ease-settle` (.34,1.3,.64,1)).
- Nothing animates while nothing is happening: the pulse runs only during real playback, the dots only during
  a real request, and the reconnecting state has **no** motion at all.

## How it scales

- 30 courses: the direction has no per-course colour, so every course looks like the same journal; course
  identity comes from the script, the scene art and the cast. Covers can be “stamps” (one accent, one glyph).
- Tablet: the same page metaphor becomes a two-page spread (mission on the left, transcript on the right).
- Marketing/web: paper + ink + cobalt + serif transfers directly to a landing page and store screenshots.
- Admin CMS: unaffected; this is a mobile/web presentation layer over the existing tokens contract.

## Provenance

Original work created in code for LangQuest. Hand-drawn underlines, stamps, tape, doodles (arrow, asterisk, cup),
the pen ring and the tally meter are drawn in `build.py`. Mascot, character, scene and icon artwork are the
repository’s existing `assets/` SVGs inlined unchanged (icons recoloured to `currentColor`). No CC0 / stock /
AI-generated images and no font files were used.

## File list

- `build.py`
- `conversation-dark.html`
- `conversation.html`
- `home-dark.html`
- `home.html`
- `lesson-dark.html`
- `lesson.html`
- `README.md`
- `tokens.html`
"""

# ---------------------------------------------------------------- main
def main():
    outputs = {
        "home.html": home("light"), "home-dark.html": home("dark"),
        "lesson.html": lesson("light"), "lesson-dark.html": lesson("dark"),
        "conversation.html": conversation("light"), "conversation-dark.html": conversation("dark"),
        "tokens.html": tokens_page(), "README.md": readme(),
    }
    for name, content in outputs.items():
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            f.write(content)
        print(f"{name:24s} {len(content.encode('utf-8')) / 1024:7.1f} KB")
    for theme in THEMES:
        for fg, bg in [("ink", "paper"), ("ink2", "paper"), ("accent", "paper"), ("accentInk", "accent"), ("success", "paper"), ("danger", "paper"), ("warn", "paper")]:
            print(f"  {theme:5s} {fg:9s}/{bg:7s} {contrast(THEMES[theme][fg], THEMES[theme][bg]):.2f}")

if __name__ == "__main__":
    main()
