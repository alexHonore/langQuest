# M3 — "Melo", the chubby chameleon

Mascot exploration **M3** for LangQuest. Status: concept for owner approval, not production art.
Everything in this folder is original vector work drawn in code (`generator.js`); no traced, stock,
CC0 or AI-generated source was used, and no fonts are embedded (sheets use system fonts for labels only).

## Name proposal

- **Melo** (primary) — from cha*MEL*e*O*n; short, soft, pronounceable in all 30 course languages, no flag or nation attached.
- Alternates: **Chamo** (also "buddy" in Venezuelan Spanish), **Pico**.
- All are working names. A trademark and cross-language connotation check is required before any name is used in UI copy
  (UI must keep using localized `mascot.*` strings, never a baked-in name).

## Personality (≤120 words)

Melo is a round, unhurried chameleon who adapts instead of judging. Chameleons change to fit where they are — the
visual metaphor for learning any language from any instruction language. Its two big eyes sit on gentle turrets and
swivel independently: one on you, one on the idea, so curiosity and attention read instantly. Its spiral tail is its
voice when it is not talking — it waves hello, hooks into a question when thinking, shoots up when you nail a phrase,
droops when the network is gone. Its body hue drifts subtly with the course family while the saffron crest and bands
stay fixed, so it is always the same friend wearing the local light. Warm, patient, a little goofy, never scary,
never reptilian.

## Concept rationale

- **Adaptation = learning.** The hue-shift mechanic is built into the design (see `palette.svg`, "body hue dial"):
  body/bodyShade rotate ±40–66° around leaf green; accent, outline, belly and props never change, so the brand anchor
  is the silhouette (pear body + crest + bulging eye turrets + spiral tail), not a colour.
- **Independent eyes** are a chameleon trait nobody else in the category owns, and they carry three states for free
  (listening = both eyes swivel to the sound; thinking = eyes diverge; curious = one eye leads).
- **The tail is a gesture limb**, so expressive poses need no long arms, hands with fingers, or props in most states.
- Front-facing, sits on the ground (not floating), no neck, no teeth, no claws — reads as a plush toy, not a lizard.

## Strengths

- Unique silhouette: readable at 24 px in flat grayscale (eye bulges + crest + spiral are all visible in `icon-24.svg`).
- Eight states read without captions; each differs by pose and/or prop, never by colour alone.
- Three-value grayscale discipline (outline < bodyShade < body < accent < belly) verified on the palette sheet.
- Very small files (states 4.7–6.2 KB) and simple shapes: cheap to animate in Rive/Lottie, cheap to render on low-end Android.
- No owl, bird, flag, costume, national or ethnic reference; nothing in common with existing language-app mascots.

## Risks

- **"Frog with goggles" misread.** The turret rings can read as glasses or as a frog at a glance. Mitigation: keep the
  turret ring tone close to the body (not a contrasting frame), keep the crest visible, and never draw the eyes without
  the turret ring.
- **Reptile aversion** in some audiences. The design avoids scales, teeth, claws and a long tongue, but the word
  "chameleon" itself may need to stay out of marketing copy in some locales. Tongue appears only as a small inner-mouth
  shape in `speaking`/`celebrate`.
- **Hue shifting could confuse state meaning** if the product also uses colour for feedback. Rule: tints are per
  course/family, never per feedback state; `offline` is the only desaturated palette.
- **Dark theme**: the deep-green outline sits near dark backgrounds; the dark palette uses `#0E1A12` outline on
  `#121A14` and relies on the lighter body to carry the shape (contrast of body vs background ≥ 3:1).
- Green is a common "success" colour; the celebrate/success states must rely on pose + confetti, which they do.

## How it scales

| Size | What survives |
| --- | --- |
| 24–40 px (`icon-24.svg`) | body, crest, two eye turrets with pupils, spiral tail; no arms, feet, bands, cheeks |
| 64–96 px (companion) | full figure, props, bands; outline stays 2.2 u |
| 160–240 px (hero) | full figure; add soft highlight and belly shade |
| ≥ 320 px (celebration) | full figure + confetti layer |

Mirror the **whole figure** for RTL layouts (tail then sits lower-left); never mirror the tail alone. Keep ≥ 8 dp clear
space around the tail and props. Course-family tints are applied only to `body` and `bodyShade` tokens.

## Animation ideas (Rive / Lottie)

- **idle** — 4 s breathing loop (scale 1.02/0.985), tail spiral tightens and loosens 2–3° out of phase with the breath;
  every ~7 s one eye drifts 2 u then snaps back (chameleon scan). Reduced-motion: static `neutral`.
- **blink** — eyelids are the `lid` chord shape: close over 70 ms, hold 40 ms, open 110 ms; the two eyes blink 60 ms
  apart so it feels alive, never mechanical. Occasionally only one eye blinks.
- **react** (learner turn received) — both eyes converge on the mic point (gaze toward bottom-centre) in 120 ms, small
  squash (0.96 y) and the tail tip lifts 10 u; settle to `listening` or `speaking` in ≤ 400 ms.
- **celebrate** — anticipation crouch (90 ms), two bounces (ease-out, 300 ms each), arms up on the first bounce, tail
  unfurls from spiral to the upright hook on the second, confetti burst from the crest; total ≤ 1.2 s, skippable.
- **thinking loop** — tail slowly curls/uncurls the question hook; thought bubbles scale 0.9–1.1 in sequence.
- **error recovery** — 3-frame horizontal shake (±2 u) then settle into `try_again`; hands clasp last.
- Rive bones: body root, crest, L/R turret (each with pupil child), L/R arm (2 segments + mitten), tail as 6-bone
  chain (spiral is a procedural curl on the chain). Mouth and lids are shape swaps, not morphs.

## Hard-rule compliance

- Original work; no reference to any existing mascot or brand; no owl/bird; no flags, costumes or likeness.
- No baked-in text in any state or icon; only the model and palette sheets carry labels, in system fonts.
- Every SVG is standalone XML (`xmlns`, `viewBox`, `<title>`), no external references, all < 80 KB.
- No CC0/open assets used anywhere in this folder.

## Files

```
design/explorations/mascots/M3/
├── README.md
├── generator.js            # source of all geometry (Node, no deps); run to regenerate the folder
├── model-sheet.svg         # front, three-quarter, side + proportions, size ladder, grayscale, state strip (1200×700)
├── icon-24.svg             # 24×24 simplified silhouette-safe version
├── dark-variant.svg        # neutral state on the dark palette, with a dark background swatch
├── palette.svg             # light/dark tokens with hex, body-hue dial, grayscale check (860×640)
└── states/                 # each 256×256, viewBox 0 0 100 100, transparent background
    ├── neutral.svg
    ├── welcome.svg
    ├── listening.svg
    ├── speaking.svg
    ├── thinking.svg
    ├── celebrate.svg
    ├── try_again.svg
    └── offline.svg
```
