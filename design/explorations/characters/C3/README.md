# C3 — Ink & Fill ("Carnet")

Character art style exploration for LangQuest. Code: `C3`. Style seed: hand-drawn ink-and-fill — confident
variable-width ink outlines, flat fills, small imperfections, warm editorial feel.

All artwork here is original, drawn in code by the generator in this folder. No traced, licensed, stock,
CC0 (Open Peeps / Open Doodles / unDraw) or AI-generated material was used anywhere, including as decoration.

## Concept and personality

"Carnet" is a travel sketchbook: the people you meet are drawn quickly and warmly by someone sitting across the
table from them. Every line is a **ribbon** — a filled shape whose width follows pen pressure, heavier on the
shadow side and under the chin, tapering at the ends — never a uniform stroke. Fills are flat and sit slightly
off-register from the ink (+1.6 / +1.3 units on a 256 canvas), like a two-pass print, and each shape carries one
hard-edged shadow and at most three hatch lines. Ink is warm near-black (`#2A2320`), never pure black; paper is
warm cream. The result is intimate and adult rather than game-cute: it says "real people, real places, you are a
guest here", which matches a conversation-first app where the cast are native-speaker interlocutors, not
collectibles. Because the drawing language tolerates irregularity, a cast of 30 courses × several characters can
grow without every portrait having to be geometrically identical — the imperfection *is* the consistency.

## What is in the drawings

- **Nadia** (Casablanca café, 30s): tied-back curls under a wide ochre fabric band, hoop earrings, teal tee and
  an oat bib apron. Accent: ochre.
- **Kenji** (Tokyo neighbour, 60s): short grey hair, round thin-rimmed glasses, camel cardigan over a white
  collared shirt, smile lines and crow's feet drawn as hairlines. Accent: dusk blue (lapel/stud tone).
- **Lucía** (Madrid coworker, 20s): side-parted wavy chestnut hair to the shoulders, dusk-blue blazer over a cream
  top, small terracotta studs. Accent: terracotta.
- Four states each, readable without captions: `neutral` (relaxed), `greeting` (closed happy eyes, wide smile,
  raised open palm), `talking` (open mouth with tongue, raised brows, low open-palm gesture), `listening`
  (−9° head tilt, one brow up, closed smile, hand cupped at the ear).
- `scene-cafe.svg`: Nadia half-body behind a wooden counter, talking, one hand resting on the counter beside a
  mint-tea glass. Behind her: a sunlit window, a muted eight-point-star tile band (an original geometric lattice,
  not a reproduction of any specific zellige panel), a shelf with tea glasses and a teapot, a small abstract
  picture, a glass dome of pastries and an espresso machine. The environment uses a lighter pen (60 % width,
  72 % opacity, paper-tinted fills) so the character always wins over the room. The wall area right of centre
  (x ≈ 330–560, y ≈ 40–230 of 640×360) is kept plain for dialogue overlays.
- `style-sheet.svg`: line-weight scale, three-step shading rule, palette with grayscale strip, do/don't, and a
  96 / 48 / 24 px + desaturated scale check. This is a spec document and uses system-font labels; the portraits
  and the scene contain no text (only `<title>` for assistive tech).

## Strengths

- Genuinely different drawing language from the baseline (uniform 1.6 stroke, clean vector) and from the big
  language apps — no rounded-sticker look, no gradients, no glossy highlights.
- Expressions are carried by brows + mouth + tilt + one hand, so they survive grayscale and the 24 px check
  (see style sheet §F): hair mass, skin, one accent and the garment stay four distinct values.
- Warm, adult, editorial tone suits an app that promises real conversation with real-feeling locals; it also
  photographs well next to real café / street photography if scenes ever mix media.
- Forgiving of production variance: a slightly different hand (or a later generated batch) still reads as the
  same family because wobble, misregistration and tapering are the family traits.
- Cheap to extend: the rig is parametric (skin, hair shape, garment, accessory, age marks) with a shared
  expression table; each new character is ≈ 60 lines of parameters, and all nine spec expressions come for free.

## Risks

- **Density on small phones.** Ribbons add geometry (45–65 KB per portrait SVG). Fine for a 96 dp companion;
  for 24–40 dp tab badges export WebP/PNG, or regenerate with `ink=1.6` and drop hatching (documented in §F).
- **Hard shadows can read as marks on skin** (a sideburn, a scar) if the shadow tone is too dark or too narrow.
  Rule: face shadow at 85 % lightness, 8 units wide, following the contour; never a free-floating patch.
- **Hand drawing is the weakest part of any parametric rig.** The open-palm hand here is acceptable for avatars;
  full-body scenes will want a small hand library (rest, hold cup, point, wave) drawn once and reused.
- **Tone mismatch with a very cute mascot** — see pairing notes below. If the chosen mascot is glossy and
  dimensional, it will sit on these pages like a sticker; that can be a feature (the guide is "not from here")
  but it has to be decided, not left to chance.
- Cultural review is still required per course (clothing, café props, hair). The style makes that review easier
  because every element is a named, editable shape, but it does not replace it.

## How it pairs with the mascot options M1–M5

The mascot folders were being produced in parallel with this one, so their final concepts were not available to
read; the rules below are written per archetype and should be re-checked against each README once they exist.

| If the winning mascot is… | Pairing | What to change |
|---|---|---|
| **Flat / geometric vector** (hard shapes, no outline) | Good, with one bridge | Re-ink it with the C3 pen at silhouette weight (3.0–4.4) and give it the paper-tint misregistration; keep its shapes. |
| **Soft dimensional, gradient-lit** (the "premium game" look) | Clash unless deliberate | Either (a) flatten it to two tones + one hard shadow and ink it, or (b) keep it glossy and make that the rule: the guide is the only un-inked object on screen, always on its own paper-white badge. Pick one; mixing per screen will look like a bug. |
| **Hand-drawn / doodle creature** | Strongest match, but risk of blending into the cast | Give the mascot a *different pen*: a near-uniform 2.6 stroke, no misregistration, one flat colour. Same paper, different hand — the learner must never confuse guide and interlocutor. |
| **Abstract / typographic / symbol mascot** (speech mark, orbit, blob) | Good | Ink the outline only; let its brand colour be the single saturated element on the page. C3's cast palette is muted on purpose, so a saturated guide pops without competing. |
| **The current orbit-creature baseline** (teal body, orange ribbon tail) | Works after re-inking | Body outline at 4.0, tail as one tapered ribbon (it already *is* a ribbon shape), drop the belly gradient and glossy eye highlight for a paper glint. |

General rule: on any screen the mascot and a character never share the same ink weight *and* the same colour
treatment — one of the two must differ, so roles stay legible at a glance.

## Production cost and scalability (30 courses)

- **Rig, not drawings.** `gen_c3.py` builds every file from parameters: `CAST` (per-character skin, hair, garment,
  accent, head proportions, seed) and `EXPR` (per-state eyes, brows, mouth, tilt, hand, gaze). A new character is
  roughly 60 lines (one hair block, one garment block, one accessory); the spec's nine expressions are a table
  edit. Estimated 30 courses × 3–4 lead characters ≈ 100 characters: ~1–2 person-days of parameter work per 10
  characters once hair/garment blocks are reused, plus cultural review.
- **Deterministic imperfection.** Wobble and misregistration are seeded per feature, so a face is identical
  across its expressions and across regenerations; diffs stay reviewable in git.
- **Scenes** follow the same two-pen rule (character pen / environment pen). The café here is ≈ 125 KB as SVG;
  for production, scenes should ship as WebP (expected 40–80 KB at 2×) with the SVG kept as the editable source.
- **Export sizes:** portraits 44–67 KB SVG; all files < 200 KB; no fonts, filters or external references in
  production art (the style sheet uses one internal `feColorMatrix` only for its grayscale demo).
- **Dark mode:** swap paper (`#F6EFE3`) for a deep warm grey (`#2B2623`), ink for a warm off-white, keep fills;
  the misregistration still reads. Not generated here; it is a palette table change in the generator.
- **Animation / lip sync:** mouth states are separate closed shapes on a fixed anchor, so swapping `small` →
  `open` → `grin` works as a three-frame lip sync without redrawing anything else.

## File list

```
design/explorations/C3/
├── README.md
├── gen_c3.py                     # editable source: regenerates every SVG below (python3, stdlib only)
├── style-sheet.svg               # 1280×1090 spec sheet (system-font labels)
├── scene-cafe.svg                # 640×360 vignette, Nadia at the counter
└── portraits/                    # 256×256 circle-cropped avatars
    ├── nadia-neutral.svg
    ├── nadia-greeting.svg
    ├── nadia-talking.svg
    ├── nadia-listening.svg
    ├── kenji-neutral.svg
    ├── kenji-greeting.svg
    ├── kenji-talking.svg
    ├── kenji-listening.svg
    ├── lucia-neutral.svg
    ├── lucia-greeting.svg
    ├── lucia-talking.svg
    └── lucia-listening.svg
```

Regenerate with `python3 design/explorations/C3/gen_c3.py` (writes into its own folder only).

## Provenance

Original work created in code for this exploration. No reference to, tracing of, or resemblance to Duolingo,
Babbel, Memrise, Drops or any existing mascot or brand; no real-person likeness; no flags, national or
religious costume; no text baked into artwork. No third-party assets of any licence were used.
