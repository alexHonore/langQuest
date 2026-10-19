#!/usr/bin/env python3
"""Generator for the U1 "Warm Editorial" UI exploration.

Reads the existing LangQuest assets (mascot, scene, character, icons) from ../../../../assets,
inlines them, and writes self-contained phone-size HTML mockups next to this script.
Pure standard library; run with:  python3 build.py
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "assets"))

# ----------------------------------------------------------------------------- tokens
LIGHT = dict(
    bg="#F6F0E6", surface="#FFFCF7", surface2="#EFE6D8", ink="#182A2C", ink2="#46595C",
    ink3="#5E7174", line="#E2D7C6", teal="#0E6E68", tealInk="#FFFFFF", tealSoft="#D7ECE8",
    coral="#EC6A48", coralText="#B8432A", coralSoft="#FBE3DA", onCoral="#182A2C", success="#2F7A55",
    warn="#9A6A12", danger="#B6362C", shadow="24,42,44", frame="#D8D0C3",
)
DARK = dict(
    bg="#121819", surface="#1B2224", surface2="#242E30", ink="#F2ECE2", ink2="#B9C4C3",
    ink3="#86979A", line="#2F3B3E", teal="#63CDBF", tealInk="#0D1F1E", tealSoft="#1E3A38",
    coral="#F59172", coralText="#F59172", coralSoft="#3A2A24", onCoral="#0D1F1E", success="#6FCB9A",
    warn="#E2B85A", danger="#F08A80", shadow="0,0,0", frame="#070A0B",
)


def lum(h):
    h = h.lstrip("#")
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ----------------------------------------------------------------------------- assets
def read(path):
    with open(os.path.join(ASSETS, path), "r", encoding="utf-8") as f:
        return f.read()


def inline_svg(path, cls="", label=None):
    """Inline an asset SVG: drop fixed width/height, keep viewBox; label for a11y."""
    s = read(path)
    s = re.sub(r'\s(width|height)="\d+"', "", s, count=2)
    s = re.sub(r"<title>.*?</title>", "", s, count=1)
    if label is None:
        m = re.search(r'aria-label="([^"]*)"', s)
        label = m.group(1) if m else ""
    s = re.sub(r'\saria-label="[^"]*"', "", s, count=1)
    s = s.replace("<svg ", f'<svg class="{cls}" aria-label="{label}" ', 1)
    return s


def icon(name, size=22):
    s = read(f"icons/{name}.svg")
    s = re.sub(r'\s(width|height)="\d+"', "", s, count=2)
    s = re.sub(r"<title>.*?</title>", "", s, count=1)
    s = re.sub(r'\s(role|aria-label)="[^"]*"', "", s)
    s = s.replace('stroke="#1E3A3A"', 'stroke="currentColor"').replace('fill="#1E3A3A"', 'fill="currentColor"')
    s = s.replace("<svg ", f'<svg class="ic" width="{size}" height="{size}" aria-hidden="true" focusable="false" ', 1)
    return s


# A couple of small glyphs the icon set does not have (drawn here, 24-grid, stroke 2).
def glyph(name, size=22):
    paths = {
        "person": '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        "chevronDown": '<path d="M6 9l6 6 6-6"/>',
        "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
        "wifi": '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
        "signalOff": '<path d="M2 2l20 20"/><path d="M5 11a7 7 0 0 0 7 7"/><path d="M12 3a3 3 0 0 1 3 3v6"/>',
    }
    return (f'<svg class="ic" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>')


# ----------------------------------------------------------------------------- css
def css_vars(t):
    return "\n".join(f"  --{k}: {v};" for k, v in t.items())


BASE_CSS = f"""
:root {{
{css_vars(LIGHT)}
  --font-display: ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif;
  --font-text: -apple-system, system-ui, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif;
  --r-card: 20px; --r-inner: 14px; --r-chip: 12px; --r-btn: 16px; --r-pill: 999px;
  --sh-1: 0 1px 2px rgba(var(--shadow),.06), 0 8px 24px rgba(var(--shadow),.08);
  --sh-2: 0 2px 6px rgba(var(--shadow),.08), 0 16px 40px rgba(var(--shadow),.14);
  --dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 320ms; --dur-reveal: 600ms;
  --ease-standard: cubic-bezier(.2,0,0,1); --ease-emphasized: cubic-bezier(.3,0,0,1); --ease-exit: cubic-bezier(.4,0,1,1);
}}
:root[data-theme="dark"] {{
{css_vars(DARK)}
  --sh-1: 0 0 0 1px var(--line), 0 8px 24px rgba(0,0,0,.35);
  --sh-2: 0 0 0 1px var(--line), 0 16px 40px rgba(0,0,0,.5);
}}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; }}
body {{ background: var(--frame); color: var(--ink); font-family: var(--font-text); -webkit-font-smoothing: antialiased;
  display: flex; flex-wrap: wrap; gap: 32px; justify-content: center; align-items: flex-start; padding: 32px 16px; min-height: 100vh; }}
.frame-label {{ width: 390px; font: 500 13px/18px var(--font-text); color: var(--ink2); margin: 0 0 8px; letter-spacing: .01em; }}
.phone {{ width: 390px; height: 844px; border-radius: 44px; overflow: hidden; position: relative; background: var(--bg); color: var(--ink);
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 30px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; }}
.status {{ height: 50px; padding: 14px 28px 0; display: flex; justify-content: space-between; align-items: center; font: 600 15px/20px var(--font-text); }}
.status .right {{ display: flex; gap: 6px; align-items: center; }}
.screen {{ flex: 1; display: flex; flex-direction: column; overflow: hidden; }}
.scroll {{ flex: 1; overflow: hidden; padding: 0 20px; }}
.ic {{ display: inline-block; vertical-align: middle; flex: none; }}

/* type */
.display {{ font: 600 34px/40px var(--font-display); letter-spacing: -.01em; }}
.t1 {{ font: 600 28px/34px var(--font-display); letter-spacing: -.01em; }}
.t2 {{ font: 600 22px/28px var(--font-display); }}
.headline {{ font: 600 17px/22px var(--font-text); }}
.body {{ font: 400 17px/24px var(--font-text); }}
.body-s {{ font: 400 15px/20px var(--font-text); }}
.caption {{ font: 500 13px/18px var(--font-text); color: var(--ink2); }}
.micro {{ font: 600 11px/14px var(--font-text); letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); }}
.muted {{ color: var(--ink2); }}

/* surfaces */
.card {{ background: var(--surface); border-radius: var(--r-card); box-shadow: var(--sh-1); padding: 16px; }}
.card.sunken {{ background: var(--surface2); box-shadow: none; }}
.row {{ display: flex; align-items: center; gap: 12px; }}
.between {{ justify-content: space-between; }}
.stack {{ display: flex; flex-direction: column; gap: 12px; }}

/* buttons */
.btn {{ display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: var(--r-btn);
  font: 600 16px/20px var(--font-text); padding: 14px 18px; min-height: 48px; cursor: default; transition: transform var(--dur-fast) var(--ease-standard); }}
.btn.primary {{ background: var(--teal); color: var(--tealInk); }}
.btn.secondary {{ background: var(--surface); color: var(--teal); box-shadow: inset 0 0 0 1.5px var(--line); }}
.btn.quiet {{ background: transparent; color: var(--teal); padding: 10px 12px; min-height: 40px; }}
.btn.small {{ font-size: 14px; padding: 8px 12px; min-height: 36px; border-radius: 12px; }}
.btn:active {{ transform: scale(.98); }}
.chip {{ display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: var(--r-chip); background: var(--surface2); color: var(--ink2); font: 500 13px/18px var(--font-text); }}
.chip.teal {{ background: var(--tealSoft); color: var(--teal); }}
.chip.coral {{ background: var(--coralSoft); color: var(--coralText); }}
.pill {{ border-radius: var(--r-pill); }}
.iconbtn {{ width: 44px; height: 44px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--line); color: var(--ink); }}
.iconbtn.ghost {{ background: transparent; box-shadow: none; }}

/* meters */
.meter {{ height: 10px; border-radius: 999px; background: var(--surface2); overflow: hidden; }}
.meter > i {{ display: block; height: 100%; border-radius: 999px; background: var(--teal); transition: width var(--dur-reveal) var(--ease-emphasized); }}
.meter.coral > i {{ background: var(--coral); }}

/* tab bar */
.tabbar {{ height: 84px; padding: 8px 8px 24px; background: var(--surface); border-top: 1px solid var(--line); display: flex; justify-content: space-around; align-items: flex-start; }}
.tab {{ display: flex; flex-direction: column; align-items: center; gap: 3px; width: 64px; padding-top: 6px; color: var(--ink3); font: 600 11px/14px var(--font-text); }}
.tab.on {{ color: var(--teal); }}
.tab.on .dot {{ width: 20px; height: 3px; border-radius: 2px; background: var(--teal); margin-top: 2px; }}

/* mic */
.mic-wrap {{ display: flex; flex-direction: column; align-items: center; gap: 10px; }}
.mic {{ width: 88px; height: 88px; border-radius: 50%; background: var(--teal); color: var(--tealInk); display: flex; align-items: center; justify-content: center; position: relative; box-shadow: var(--sh-2); }}
.mic.live::before, .mic.live::after {{ content: ""; position: absolute; inset: -8px; border-radius: 50%; border: 2px solid var(--teal); opacity: .5; animation: ring 1.6s var(--ease-standard) infinite; }}
.mic.live::after {{ animation-delay: .8s; }}
.mic.disabled {{ background: var(--surface2); color: var(--ink3); box-shadow: none; }}
@keyframes ring {{ from {{ transform: scale(1); opacity: .5; }} to {{ transform: scale(1.5); opacity: 0; }} }}
@media (prefers-reduced-motion: reduce) {{ .mic.live::before, .mic.live::after {{ animation: none; opacity: .35; }} .meter > i, .btn {{ transition: none; }} }}

/* status pill for speech state */
.state {{ display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px 8px 10px; border-radius: 999px; background: var(--surface); box-shadow: var(--sh-1); font: 600 14px/18px var(--font-text); color: var(--ink); }}
.state .led {{ width: 10px; height: 10px; border-radius: 50%; background: var(--ink3); }}
.state.listening .led {{ background: var(--teal); }}
.state.speaking .led {{ background: var(--coral); }}
.state.warn .led {{ background: var(--warn); }}
.bars {{ display: inline-flex; gap: 2px; align-items: flex-end; height: 14px; }}
.bars i {{ width: 3px; background: var(--coral); border-radius: 2px; height: 6px; animation: bar .9s ease-in-out infinite alternate; }}
.bars i:nth-child(2) {{ height: 12px; animation-delay: .15s; }} .bars i:nth-child(3) {{ height: 9px; animation-delay: .3s; }} .bars i:nth-child(4) {{ height: 13px; animation-delay: .45s; }}
@keyframes bar {{ from {{ transform: scaleY(.4); }} to {{ transform: scaleY(1); }} }}
@media (prefers-reduced-motion: reduce) {{ .bars i {{ animation: none; }} }}
"""


def status_bar():
    return f"""<div class="status"><span>9:41</span><span class="right">{glyph('wifi', 16)}<svg class="ic" width="26" height="12" viewBox="0 0 26 12" aria-hidden="true"><rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor"/><rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor"/><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor"/></svg></span></div>"""


def page(title, theme, body_html, extra_css="", desc=""):
    attr = ' data-theme="dark"' if theme == "dark" else ""
    return f"""<!doctype html>
<html lang="en"{attr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="{'dark' if theme == 'dark' else 'light'}">
<meta name="description" content="{desc}">
<title>{title}</title>
<!-- U1 Warm Editorial — LangQuest UI exploration. Self-contained: inline CSS, inline SVG from /assets (mascot, scene, character, icons), system fonts only.
     No third-party or CC0 artwork is used in this mockup. -->
<style>{BASE_CSS}{extra_css}</style>
</head>
<body>
{body_html}
</body>
</html>
"""


# ----------------------------------------------------------------------------- HOME
def home(theme):
    dark = theme == "dark"
    mascot = inline_svg(("mascot/dark/welcome.svg" if dark else "mascot/welcome.svg"), "mascot", "Mascot waving hello")
    scene = inline_svg(("scenes/dark/cafe.svg" if dark else "scenes/cafe.svg"), "scene")
    css = """
.hero { padding: 2px 20px 0; display: flex; align-items: center; gap: 12px; }
.hero .mascot { width: 64px; height: 64px; flex: none; }
.ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.course { margin: 6px 20px 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.course .pairing { display: flex; flex-direction: column; gap: 2px; }
.mission { padding: 0; overflow: hidden; }
.mission .art { height: 144px; position: relative; background: var(--surface2); }
.mission .art .scene { width: 100%; height: 100%; display: block; object-fit: cover; }
.mission .art .tag { position: absolute; top: 12px; left: 12px; }
.mission .meta { padding: 10px 16px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.play { width: 56px; height: 56px; border-radius: 18px; background: var(--coral); color: var(--onCoral); display: flex; align-items: center; justify-content: center; flex: none; box-shadow: var(--sh-1); }
.cover { width: 48px; height: 48px; border-radius: 12px; flex: none; overflow: hidden; }
.cover svg { width: 48px; height: 48px; display: block; }
.courses { display: flex; gap: 8px; overflow: hidden; padding: 2px 0 0; }
.courses .chip { white-space: nowrap; }
.section { margin: 18px 0 8px; display: flex; justify-content: space-between; align-items: baseline; }
"""
    body = f"""
<div>
<p class="frame-label">U1 Warm Editorial · Home / Today · {'dark' if dark else 'light'}</p>
<div class="phone">
  {status_bar()}
  <div class="screen">
    <div class="hero">
      {mascot}
      <div>
        <div class="micro">Sunday · Today</div>
        <div class="t1">Welcome back</div>
      </div>
      <div style="margin-left:auto" class="iconbtn ghost" role="button" aria-label="Notifications">{glyph('bell')}</div>
    </div>

    <div class="course">
      <div class="pairing">
        <div class="headline">Spanish (Spain)</div>
        <div class="caption">Taught in English · beginner</div>
      </div>
      <button class="btn secondary small" aria-label="Change course or instruction language">{icon('edit', 16)} Change</button>
    </div>

    <div class="scroll stack" style="gap:10px">
      <div>
        <div class="micro" style="margin-bottom:6px">Your next real conversation</div>
        <div class="card mission">
          <div class="art">
            {scene}
            <span class="chip teal tag">Mission 2 of 5</span>
          </div>
          <div class="meta">
            <div>
              <div class="t2">Order a coffee</div>
              <div class="caption">7 min · speaking first · with Marta</div>
            </div>
            <div class="play" role="button" aria-label="Start mission: Order a coffee">{icon('play', 26)}</div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:12px 16px 14px">
        <div class="row between" style="margin-bottom:8px"><span class="headline">Speaking today</span><span class="caption">4 of 10 min</span></div>
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="10" aria-valuenow="4" aria-label="Minutes spoken today"><i style="width:40%"></i></div>
        <div class="row between" style="margin-top:8px">
          <span class="caption">3 turns spoken aloud</span>
          <span class="chip coral">{icon('flame', 14)} 6-day streak</span>
        </div>
      </div>

      <div class="card row" style="padding:10px 12px">
        <div class="cover" aria-hidden="true"><svg viewBox="0 0 56 56" width="56" height="56"><rect width="56" height="56" fill="{'#2A3D3F' if dark else '#D7ECE8'}"/><circle cx="20" cy="36" r="14" fill="{'#63CDBF' if dark else '#0E6E68'}"/><circle cx="38" cy="20" r="9" fill="{'#F59172' if dark else '#EC6A48'}"/></svg></div>
        <div style="flex:1;min-width:0">
          <div class="micro">Continue listening</div>
          <div class="headline ellipsis">Café conversations · Chapter 3</div>
          <div class="row" style="gap:8px;margin-top:6px"><div class="meter" style="height:6px;flex:1"><i style="width:60%"></i></div><span class="caption" style="white-space:nowrap">12:40 / 21:05</span></div>
        </div>
        <div class="iconbtn" role="button" aria-label="Resume audio">{icon('play', 20)}</div>
      </div>

      <div class="card row between" style="padding:10px 12px">
        <div class="row">
          <span class="chip teal" style="width:44px;height:44px;justify-content:center;border-radius:14px;font-size:17px">5</span>
          <div><div class="micro">Due for review</div><div class="headline">Expressions to say again</div><div class="caption">About 3 minutes</div></div>
        </div>
        {icon('chevronRight', 20)}
      </div>

      <div>
        <div class="micro" style="margin-bottom:6px">Your other courses</div>
        <div class="courses" aria-label="Other enrolled courses">
          <span class="chip" lang="ar" dir="rtl">الدارجة المغربية · من الفرنسية</span>
          <span class="chip" lang="ja">日本語 · 英語で</span>
          <span class="chip" lang="ko">한국어</span>
        </div>
      </div>
    </div>

    <nav class="tabbar" aria-label="Main">
      <div class="tab on">{icon('home')}<span>Home</span><i class="dot"></i></div>
      <div class="tab">{icon('missions')}<span>Missions</span></div>
      <div class="tab">{icon('audio')}<span>Audio</span></div>
      <div class="tab">{icon('speak')}<span>Speak</span></div>
      <div class="tab">{glyph('person')}<span>Me</span></div>
    </nav>
  </div>
</div>
</div>
"""
    return page("Warm Editorial Home", theme, body, css, "LangQuest U1 Warm Editorial — Home/Today mockup")


# ----------------------------------------------------------------------------- LESSON
def lesson(theme):
    dark = theme == "dark"
    scene = inline_svg(("scenes/dark/cafe.svg" if dark else "scenes/cafe.svg"), "scene")
    portrait = inline_svg("characters/es-es-coworker-marta/talking.svg", "portrait", "Marta, talking")
    mascot = inline_svg(("mascot/dark/encouraging.svg" if dark else "mascot/encouraging.svg"), "mascot", "Mascot cheering you on")
    css = """
.topbar { display: flex; align-items: center; gap: 8px; padding: 4px 16px 8px; }
.steps { display: flex; gap: 4px; margin-left: auto; }
.steps i { width: 18px; height: 4px; border-radius: 2px; background: var(--line); }
.steps i.done { background: var(--teal); } .steps i.now { background: var(--coral); }
.stage { margin: 0 20px; border-radius: var(--r-card); overflow: hidden; position: relative; height: 196px; background: var(--surface2); box-shadow: var(--sh-1); }
.stage .scene { width: 100%; height: 100%; display: block; }
.stage .portrait { position: absolute; left: 14px; bottom: 12px; width: 96px; height: 96px; filter: drop-shadow(0 6px 12px rgba(0,0,0,.18)); }
.line { margin: 14px 20px 0; }
.line .target { font: 500 26px/32px var(--font-display); }
.line .who { margin-top: 4px; }
.ctrls { display: flex; gap: 8px; margin: 12px 20px 0; }
.ctrls .btn { flex: 1; }
.prompt { margin: 14px 20px 0; display: flex; align-items: center; gap: 10px; }
.prompt .mascot { width: 56px; height: 56px; flex: none; }
.micarea { margin: 12px 0 0; }
.aux { display: flex; gap: 8px; margin: 12px 20px 0; }
.aux .btn { flex: 1; }
.feedback { margin: 12px 20px 0; padding: 12px 14px; }
.feedback .heard { font: 500 16px/22px var(--font-display); margin: 2px 0 6px; }
.note { display: flex; gap: 8px; align-items: flex-start; color: var(--ink2); font: 400 13px/18px var(--font-text); }
.note .ic { color: var(--warn); margin-top: 1px; }
"""
    body = f"""
<div>
<p class="frame-label">U1 Warm Editorial · Lesson: listen → anticipate → speak · {'dark' if dark else 'light'}</p>
<div class="phone">
  {status_bar()}
  <div class="screen">
    <div class="topbar">
      <div class="iconbtn ghost" role="button" aria-label="Back">{icon('chevronLeft')}</div>
      <div><div class="micro">Mission</div><div class="headline">Order a coffee</div></div>
      <div class="steps" aria-label="Step 2 of 5"><i class="done"></i><i class="now"></i><i></i><i></i><i></i></div>
    </div>

    <div class="stage">
      {scene}
      {portrait}
      <span class="state speaking" style="position:absolute;right:12px;top:12px"><span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Marta is speaking</span>
    </div>

    <div class="line">
      <div class="target" lang="es">¿Qué desea tomar?</div>
      <div class="who caption">Marta · coworker · Spanish (Spain)</div>
    </div>

    <div class="ctrls">
      <button class="btn secondary small">{icon('replay', 18)} Replay</button>
      <button class="btn secondary small">{icon('slow', 18)} Slow</button>
      <button class="btn secondary small">{icon('translate', 18)} Translate</button>
    </div>

    <div class="prompt">
      {mascot}
      <div><div class="t2">How would you answer?</div><div class="caption">Say it out loud before you see a model answer.</div></div>
    </div>

    <div class="mic-wrap micarea">
      <div class="mic" role="button" aria-label="Start recording your answer">{icon('mic', 40)}</div>
      <div class="caption">Tap to speak · hold for push-to-talk</div>
    </div>

    <div class="aux">
      <button class="btn quiet">{icon('hint', 18)} Need a hint</button>
      <button class="btn quiet">{icon('transcript', 18)} Reveal &amp; compare</button>
    </div>

    <div class="card sunken feedback">
      <div class="micro">Your last try · 1 of 3</div>
      <div class="heard" lang="es">“Un café con leche, por favor.”</div>
      <div class="note">{icon('info', 16)}<span>Detailed phoneme assessment is not available for this course yet. Compare with Marta's model line by ear, or replay yours.</span></div>
    </div>
  </div>
</div>
</div>
"""
    return page("Warm Editorial Lesson", theme, body, css, "LangQuest U1 Warm Editorial — lesson mockup")


# ----------------------------------------------------------------------------- CONVERSATION
def conversation(theme):
    dark = theme == "dark"
    scene = inline_svg(("scenes/dark/cafe.svg" if dark else "scenes/cafe-evening.svg"), "scene")
    listening = inline_svg("characters/es-es-coworker-marta/listening.svg", "portrait", "Marta, listening")
    neutral = inline_svg("characters/es-es-coworker-marta/neutral.svg", "portrait", "Marta, waiting")
    css = """
.topbar { display: flex; align-items: center; gap: 8px; padding: 4px 16px 8px; }
.topbar .title { flex: 1; text-align: center; }
.stage { margin: 0 20px; border-radius: var(--r-card); overflow: hidden; position: relative; height: 332px; background: var(--surface2); box-shadow: var(--sh-1); }
.stage .scene { position: absolute; inset: 0; width: 100%; height: 100%; }
.stage::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.28), rgba(0,0,0,0) 55%); }
.stage .portrait { position: absolute; left: 50%; top: 48px; width: 196px; height: 196px; transform: translateX(-50%); filter: drop-shadow(0 10px 20px rgba(0,0,0,.25)); z-index: 1; }
.stage .state { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 2; white-space: nowrap; }
.transcript { margin: 12px 20px 0; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; max-height: 164px; overflow: hidden; }
.turn { display: flex; gap: 10px; align-items: flex-start; }
.turn .who { width: 44px; flex: none; font: 600 11px/18px var(--font-text); color: var(--ink3); letter-spacing: .04em; text-transform: uppercase; }
.turn .txt { font: 400 15px/20px var(--font-text); }
.turn.them .txt { font: 500 16px/22px var(--font-display); }
.turn.you .txt { color: var(--ink2); }
.secondary-row { display: flex; gap: 8px; margin: 12px 20px 0; }
.secondary-row .btn { flex: 1; padding-left: 8px; padding-right: 8px; }
.micarea { margin: 18px 0 0; }
.banner { margin: 12px 20px 0; padding: 12px 14px; border-radius: var(--r-inner); background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--warn); display: flex; gap: 10px; align-items: flex-start; }
.banner .ic { color: var(--warn); flex: none; margin-top: 2px; }
.banner b { display: block; font: 600 15px/20px var(--font-text); }
.banner span { font: 400 13px/18px var(--font-text); color: var(--ink2); }
.spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--warn); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
"""

    def frame(label, portrait, state_html, turns_html, mic_html, banner_html, secondary_disabled=False):
        dis = ' style="opacity:.55"' if secondary_disabled else ""
        return f"""
<div>
<p class="frame-label">{label}</p>
<div class="phone">
  {status_bar()}
  <div class="screen">
    <div class="topbar">
      <button class="btn quiet small" aria-label="Leave conversation">{icon('close', 18)} Leave</button>
      <div class="title"><div class="headline">Marta</div><div class="caption">Coworker · Spanish (Spain)</div></div>
      <button class="btn quiet small" aria-pressed="true" aria-label="Transcript on">{icon('transcript', 18)} On</button>
    </div>

    <div class="stage">
      {scene}
      {portrait}
      {state_html}
    </div>

    <div class="card transcript" aria-label="Transcript">
      {turns_html}
    </div>

    {banner_html}

    <div class="secondary-row"{dis}>
      <button class="btn secondary small">{icon('replay', 18)} Repeat</button>
      <button class="btn secondary small">{icon('slow', 18)} Slow</button>
      <button class="btn secondary small">{icon('hint', 18)} Hint</button>
      <button class="btn secondary small">{icon('translate', 18)} Translate</button>
    </div>

    <div class="mic-wrap micarea">
      {mic_html}
    </div>
  </div>
</div>
</div>
"""

    turns_live = """
      <div class="turn them"><span class="who">Marta</span><span class="txt" lang="es">Hola, ¿tomamos algo antes de la reunión?</span></div>
      <div class="turn you"><span class="who">You</span><span class="txt" lang="es">Sí, un café con leche, por favor.</span></div>
      <div class="turn them"><span class="who">Marta</span><span class="txt" lang="es">Perfecto. ¿Con azúcar o sin azúcar?</span></div>
    """
    mic_live = f"""
      <div class="mic live" role="button" aria-label="Microphone active, your turn. Tap to finish."> {icon('mic', 40)}</div>
      <div class="caption">Your turn · mic is open · tap when done</div>
    """
    state_live = '<span class="state listening"><span class="led"></span>Marta is listening</span>'

    turns_recon = """
      <div class="turn them"><span class="who">Marta</span><span class="txt" lang="es">Sí, un café con leche, por favor.</span></div>
      <div class="turn them"><span class="who">Marta</span><span class="txt" lang="es">Perfecto. ¿Con azúcar o sin azúcar?</span></div>
      <div class="turn you"><span class="who">You</span><span class="txt muted">(your last reply is saved and will be sent when the connection returns)</span></div>
    """
    mic_recon = f"""
      <div class="mic disabled" aria-disabled="true" aria-label="Microphone paused while reconnecting">{icon('micOff', 40)}</div>
      <div class="caption">Mic paused · nothing is being recorded</div>
    """
    state_recon = '<span class="state warn"><span class="spin" aria-hidden="true"></span>Reconnecting…</span>'
    banner_recon = f"""
    <div class="banner" role="status" aria-live="polite">
      {icon('offline', 20)}
      <div><b>Connection lost — retrying (2 of 5)</b><span>Marta's last line is kept above. If this fails you can leave and resume the mission later; nothing you said is scored while offline.</span></div>
    </div>
    """

    body = (frame(f"U1 Warm Editorial · Live conversation · {'dark' if dark else 'light'} · your turn",
                  listening, state_live, turns_live, mic_live, "")
            + frame(f"U1 Warm Editorial · Live conversation · {'dark' if dark else 'light'} · honest reconnecting state",
                    neutral, state_recon, turns_recon, mic_recon, banner_recon, secondary_disabled=True))
    return page("Warm Editorial Conversation", theme, body, css, "LangQuest U1 Warm Editorial — live conversation mockup")


# ----------------------------------------------------------------------------- TOKENS
def tokens():
    def swatch_rows(t, bg_key):
        rows = []
        pairs = [
            ("ink", "Primary text", bg_key), ("ink2", "Secondary text", bg_key), ("ink3", "Muted / captions", bg_key),
            ("teal", "Teal accent (text, icons, primary fill)", bg_key), ("coralText", "Coral as text/icon", bg_key),
            ("success", "Success", bg_key), ("warn", "Warning", bg_key), ("danger", "Danger", bg_key),
        ]
        for k, label, bg in pairs:
            r = contrast(t[k], t[bg])
            grade = "AAA" if r >= 7 else "AA" if r >= 4.5 else "AA large" if r >= 3 else "fail"
            rows.append(f'<tr><td><i class="sw" style="background:{t[k]}"></i><code>{t[k]}</code></td><td>{label}</td><td>on <code>{t[bg]}</code></td><td class="num">{r:.2f}:1</td><td><span class="grade {grade.split()[0].lower()}">{grade}</span></td></tr>')
        # fills
        fills = [("tealInk", "teal", "Text on teal button"), ("onCoral", "coral", "onCoral (dark ink) on coral fill — the only text allowed on coral"), ("teal", "tealSoft", "Teal on teal tint"), ("coralText", "coralSoft", "Coral text on coral tint")]
        for fg, bg, label in fills:
            r = contrast(t[fg], t[bg])
            grade = "AAA" if r >= 7 else "AA" if r >= 4.5 else "AA large" if r >= 3 else "fail"
            rows.append(f'<tr><td><i class="sw" style="background:{t[bg]};color:{t[fg]}">Aa</i><code>{t[fg]}</code></td><td>{label}</td><td>on <code>{t[bg]}</code></td><td class="num">{r:.2f}:1</td><td><span class="grade {grade.split()[0].lower()}">{grade}</span></td></tr>')
        return "\n".join(rows)

    def palette_block(name, t, theme_attr):
        swatches = "".join(
            f'<div class="pal"><i style="background:{t[k]}"></i><b>{k}</b><code>{t[k]}</code></div>'
            for k in ["bg", "surface", "surface2", "line", "ink", "ink2", "ink3", "teal", "tealSoft", "coral", "onCoral", "coralText", "coralSoft", "success", "warn", "danger"])
        return f"""
<section class="theme" {theme_attr}>
  <h2>{name}</h2>
  <div class="pals">{swatches}</div>
  <table><thead><tr><th>Colour</th><th>Role</th><th>Against</th><th>Ratio</th><th>WCAG</th></tr></thead><tbody>
  {swatch_rows(t, 'surface')}
  <tr><td><i class="sw" style="background:{t['ink']}"></i><code>{t['ink']}</code></td><td>Primary text</td><td>on page <code>{t['bg']}</code></td><td class="num">{contrast(t['ink'], t['bg']):.2f}:1</td><td><span class="grade aaa">AAA</span></td></tr>
  <tr><td><i class="sw" style="background:{t['ink3']}"></i><code>{t['ink3']}</code></td><td>Muted text</td><td>on page <code>{t['bg']}</code></td><td class="num">{contrast(t['ink3'], t['bg']):.2f}:1</td><td><span class="grade {'aa' if contrast(t['ink3'], t['bg']) >= 4.5 else 'aa'}">{'AA' if contrast(t['ink3'], t['bg']) >= 4.5 else 'AA large'}</span></td></tr>
  <tr><td><i class="sw" style="background:{t['coral']};color:#fff">Aa</i><code>#FFFFFF</code></td><td>White text on coral fill (NOT allowed for small text)</td><td>on <code>{t['coral']}</code></td><td class="num">{contrast('#FFFFFF', t['coral']):.2f}:1</td><td><span class="grade {'aa' if contrast('#FFFFFF', t['coral']) >= 4.5 else 'fail'}">{'AA' if contrast('#FFFFFF', t['coral']) >= 4.5 else ('AA large' if contrast('#FFFFFF', t['coral']) >= 3 else 'fail')}</span></td></tr>
  </tbody></table>
  <div class="specimen card">
    <div class="display">Order a coffee</div>
    <div class="t1">Welcome back</div>
    <div class="t2">How would you answer?</div>
    <div class="headline">Headline 17/22 semibold</div>
    <div class="body">Body 17/24 — Say it out loud before you see a model answer. Marta is a coworker in Madrid who likes her coffee with milk.</div>
    <div class="body-s">Body-S 15/20 — secondary reading size used in transcripts and lists.</div>
    <div class="caption">Caption 13/18 medium — timings, who is speaking, hints.</div>
    <div class="micro">Micro 11/14 · uppercase labels</div>
    <hr>
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary">Start speaking</button><button class="btn secondary">Replay</button><button class="btn quiet">Need a hint</button><span class="chip teal">Mission 2 of 5</span><span class="chip coral">6-day streak</span><span class="chip">Beginner</span></div>
    <hr>
    <div class="micro" style="margin-bottom:8px">Scripts — same tokens, no font change (system fallbacks)</div>
    <div class="body" lang="ar" dir="rtl">شنو بغيتي تشرب؟ — Arabic (Darija), RTL: layout mirrors, tail of the mascot does not.</div>
    <div class="body" lang="ja">何をお飲みになりますか？ — Japanese: line-height 24 holds full-width glyphs.</div>
    <div class="body" lang="ko">무엇을 드시겠어요? — Korean Hangul at 17/24.</div>
    <div class="body" lang="hi">आप क्या पीना चाहेंगे? — Devanagari: taller ascenders, still inside 24px.</div>
    <div class="body" lang="fr">Continuer la leçon audio — French runs ~20–30% longer than English; buttons wrap, never truncate.</div>
  </div>
</section>
"""

    css = """
body { display: block; max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font: 600 34px/40px var(--font-display); margin: 0 0 4px; }
h2 { font: 600 24px/30px var(--font-display); margin: 0 0 14px; }
h3 { font: 600 17px/22px var(--font-text); margin: 24px 0 8px; }
.lede { color: var(--ink2); margin: 0 0 28px; max-width: 70ch; }
.themes { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 900px) { .themes { grid-template-columns: 1fr; } }
.theme { background: var(--bg); color: var(--ink); border-radius: var(--r-card); padding: 20px; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.pals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.pal { font: 500 11px/14px var(--font-text); }
.pal i { display: block; height: 40px; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); margin-bottom: 4px; }
.pal b { display: block; color: var(--ink); }
.pal code { color: var(--ink3); }
table { width: 100%; border-collapse: collapse; font: 400 13px/18px var(--font-text); margin-bottom: 14px; }
th { text-align: left; font-weight: 600; color: var(--ink2); padding: 6px 4px; border-bottom: 1px solid var(--line); }
td { padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
td.num { font-variant-numeric: tabular-nums; font-weight: 600; }
.sw { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 22px; border-radius: 6px; vertical-align: middle; margin-right: 6px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); font: 600 11px/1 var(--font-text); }
.grade { font: 600 11px/14px var(--font-text); padding: 2px 6px; border-radius: 6px; background: var(--surface2); }
.grade.aaa, .grade.aa { color: var(--success); } .grade.fail { color: var(--danger); }
.specimen { display: flex; flex-direction: column; gap: 6px; }
.specimen hr { border: 0; border-top: 1px solid var(--line); margin: 8px 0; width: 100%; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.tile { background: var(--surface); border-radius: var(--r-card); padding: 16px; box-shadow: var(--sh-1); }
.radii { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.radii div { width: 72px; height: 56px; background: var(--tealSoft); border: 2px solid var(--teal); display: flex; align-items: flex-end; justify-content: center; font: 600 11px/14px var(--font-text); color: var(--teal); padding-bottom: 4px; }
.elev { display: flex; gap: 20px; flex-wrap: wrap; }
.elev div { width: 150px; height: 90px; border-radius: var(--r-card); background: var(--surface); display: flex; align-items: center; justify-content: center; font: 600 12px/16px var(--font-text); color: var(--ink2); }
.motion td:first-child { font-weight: 600; white-space: nowrap; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
"""
    body = f"""
<h1>U1 · Warm Editorial — tokens</h1>
<p class="lede body">Cream paper surfaces, deep teal for every actionable thing, coral kept for warmth and progress (never for small white text). Serif display for the editorial voice, system sans for everything that must be read fast. Contrast ratios below are computed from the hex values (WCAG 2.x relative luminance), not estimated.</p>

<div class="themes">
{palette_block("Light", LIGHT, "")}
{palette_block("Dark", DARK, 'data-theme="dark"')}
</div>

<h3>Type scale</h3>
<div class="tile">
<table><thead><tr><th>Token</th><th>Face</th><th>Size / line</th><th>Weight</th><th>Use</th></tr></thead><tbody>
<tr><td>display</td><td>ui-serif (New York / Noto Serif)</td><td>34 / 40, −1%</td><td>600</td><td>Onboarding hero, celebration</td></tr>
<tr><td>title-1</td><td>ui-serif</td><td>28 / 34, −1%</td><td>600</td><td>Screen greeting</td></tr>
<tr><td>title-2</td><td>ui-serif</td><td>22 / 28</td><td>600</td><td>Card titles, prompts</td></tr>
<tr><td>target-line</td><td>ui-serif</td><td>26 / 32</td><td>500</td><td>Character line in the target language (lesson); 16 / 22 in transcript</td></tr>
<tr><td>headline</td><td>system sans</td><td>17 / 22</td><td>600</td><td>Row titles, tab-less headers</td></tr>
<tr><td>body</td><td>system sans</td><td>17 / 24</td><td>400</td><td>Reading text, hints</td></tr>
<tr><td>body-s</td><td>system sans</td><td>15 / 20</td><td>400</td><td>Transcript, lists</td></tr>
<tr><td>caption</td><td>system sans</td><td>13 / 18</td><td>500</td><td>Meta, timings</td></tr>
<tr><td>micro</td><td>system sans</td><td>11 / 14, +6% tracking, uppercase</td><td>600</td><td>Section eyebrows (Latin only; never uppercase Arabic/CJK — the rule is skipped for those scripts)</td></tr>
</tbody></table>
<p class="caption">All sizes scale with the platform text-size setting (Dynamic Type / fontScale) up to 200%. Serif display is <code>fontFamily: 'serif'</code> on Android (Noto Serif) and <code>systemFont design .serif</code> (New York) on iOS; no font files are bundled. Arabic, CJK and Devanagari fall through to the system sans; the serif is used for Latin and Cyrillic display only.</p>
</div>

<h3>Radii, spacing, elevation</h3>
<div class="grid">
  <div class="tile"><div class="micro" style="margin-bottom:8px">Radii</div>
    <div class="radii"><div style="border-radius:20px">card 20</div><div style="border-radius:16px">button 16</div><div style="border-radius:14px">inner 14</div><div style="border-radius:12px">chip 12</div><div style="border-radius:999px">pill</div></div>
    <p class="caption">Phone frame 44. Nested radius = outer − padding (20 − 6 = 14).</p></div>
  <div class="tile"><div class="micro" style="margin-bottom:8px">Spacing</div>
    <p class="body-s">4-pt base. Page gutter 20. Card padding 16 (12–14 for compact rows). Section gap 18. Stack gap 12. Minimum tap target 44 × 44; primary mic 88.</p></div>
  <div class="tile" style="grid-column: 1 / -1"><div class="micro" style="margin-bottom:8px">Elevation</div>
    <div class="elev"><div style="box-shadow:none;background:var(--surface2)">0 · sunken</div><div style="box-shadow:var(--sh-1)">1 · card</div><div style="box-shadow:var(--sh-2)">2 · floating (mic, play)</div><div style="box-shadow:inset 0 0 0 1.5px var(--line)">outline · secondary</div></div>
    <p class="caption">Light: two-layer soft shadows tinted with ink (24,42,44). Dark: shadows are nearly invisible on #121819, so elevation becomes a 1px <code>line</code> ring plus a slightly lighter surface; the shadow is kept only for the floating tier.</p></div>
</div>

<h3>Motion</h3>
<div class="tile">
<table class="motion"><thead><tr><th>Token</th><th>Value</th><th>What animates</th></tr></thead><tbody>
<tr><td>dur-fast · 120 ms</td><td>ease-standard (.2,0,0,1)</td><td>Press feedback: buttons and cards scale to .98; chip toggles.</td></tr>
<tr><td>dur-base · 200 ms</td><td>ease-standard</td><td>Translate/hint reveal (height + fade), tab switch underline, state-pill text swap.</td></tr>
<tr><td>dur-slow · 320 ms</td><td>ease-emphasized (.3,0,0,1)</td><td>Hint sheet slides up, mission card → lesson shared-element (art area expands).</td></tr>
<tr><td>dur-reveal · 600 ms</td><td>ease-emphasized</td><td>Speaking-minutes meter fills on Home load; review count badge counts up.</td></tr>
<tr><td>exit</td><td>ease-exit (.4,0,1,1), 160 ms</td><td>Anything leaving the screen (sheet dismiss, banner clear).</td></tr>
<tr><td>mic ring</td><td>1.6 s loop, 2 rings offset 0.8 s</td><td>Only while audio capture is really open. Never on a disabled mic, never while reconnecting.</td></tr>
<tr><td>speaking bars</td><td>0.9 s alternate loop</td><td>Only while character TTS audio is actually playing; replaced by a static dot when the character is "thinking" or waiting.</td></tr>
<tr><td>reduced motion</td><td>—</td><td>All loops stop (rings and bars become static), transitions become instant, mascot idle loop off (Rive/Lottie paused on its neutral frame).</td></tr>
</tbody></table>
</div>
"""
    return page("Warm Editorial Tokens", "light", body, css, "LangQuest U1 Warm Editorial — design tokens")


# ----------------------------------------------------------------------------- write
def main():
    out = {
        "home.html": home("light"), "home-dark.html": home("dark"),
        "lesson.html": lesson("light"), "lesson-dark.html": lesson("dark"),
        "conversation.html": conversation("light"), "conversation-dark.html": conversation("dark"),
        "tokens.html": tokens(),
    }
    for name, html in out.items():
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            f.write(html)
        print(f"wrote {name} ({len(html.encode('utf-8')) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
