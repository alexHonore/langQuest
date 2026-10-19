# C4 — Bold Minimal ("poster cut-outs")

Character art style exploration **C4** for LangQuest. Status: concept for owner approval, not production art.
Everything in this folder is original vector work drawn in code (`generator.js`, plain Node, no dependencies).
No traced, stock, CC0 or AI-generated sources were used anywhere; no fonts are embedded (sheet labels use system fonts
and are annotations, not artwork). No text, numerals or logos are baked into any portrait or scene.

## Concept

Large simplified shapes, no outlines, **two-tone faces** (one light tone + one shade tone split by a single curved plane,
light from the upper-left), ink-only facial features (brows, eyes, mouth), and **exactly one gradient per character**: the
backing disc behind the head. Hair is one bold silhouette (a cap plus circle bumps for Nadia's curls, one swept path for
Lucía, a short cap for Kenji). Clothing is two flat tones plus a lighter plane; the job is shown with one prop (apron,
cardigan, blazer), never a costume. Environments follow the same rule: flat two-tone objects, one gradient halo, geometric
accents (the counter's tile band) instead of texture.

## Personality / rationale

C4 is the contemporary, slightly abstract option: it feels like editorial poster art rather than a cartoon, which suits
adults and keeps the cast dignified. Because every face is built from the same few shapes, expressions are carried by pose
(head tilt), brow angle, eye shape and mouth shape alone, so the four conversation states read instantly even at tab-bar
size. The one-gradient rule gives each character a colour identity (terracotta→saffron for Nadia, teal→sage for Kenji,
plum→coral for Lucía) without any gradient touching skin, which keeps grayscale separation and dark-mode behaviour
predictable.

## Strengths

- Extremely legible at small sizes: at 24 px the disc, hair silhouette, skin plane and ink mouth still separate (see
  `style-sheet.svg` §4, colour and grayscale). Nothing thinner than 3 px on the 256 grid.
- Five distinct grayscale values per avatar (ink < hair < skin shade < skin light < paper); meaning never relies on hue.
- Tiny files: portraits are 2.7–3.8 KB each; the scene is 10 KB. Rendering cost is a handful of filled paths, no filters,
  no masks beyond one circle clip — trivial for low-end Android and for React Native SVG.
- Easy to animate: head tilt, brow, mouth and hand are separate groups; lip-sync is a mouth-shape swap. Rive/Lottie
  conversion is straightforward because there are no strokes on the figure and no gradients on moving parts.
- Expressions are cross-cultural (tilt, brow, smile, open palm); no culture-specific gestures.
- Distinct from the current baseline and from C1–C3: no outlines, no soft lighting, no ink texture.

## Risks

- **Faces can read as "corporate flat" if props and hair are not individualised.** Mitigation: each new character gets a
  signature hair silhouette, one prop and its own gradient pair; the sheet forbids generic hair caps for everyone.
- The right-side shade plane is a strong graphic device; on very dark skin tones the two-tone split needs a lighter light
  tone to keep a ≥ 1.4:1 value step. The skin pairs must be chosen per character (not derived by darkening).
- Fewer features means less nuance for subtle states (confusion, surprise). The spec requires nine expressions: these are
  achievable (brow asymmetry, "o" mouth, wide eyes) but must be designed deliberately on the sheet, not improvised.
- A disc gradient behind every avatar needs care in list rows: many gradients side by side can look loud. Use the neutral
  cream disc variant for dense lists and the gradient disc for the live-conversation screen and the cast gallery.
- Glasses, earrings and the hair tie are the thinnest marks (3–4 px on 256); at 24 px they become hints, which is
  acceptable but should be checked on each new character.

## How it pairs with the mascot options

- **M1 — refined orbit-creature:** good fit. M1 is outlined; C4 is not. The contrast actually helps: the mascot reads as
  "the guide" (drawn), the cast as "the world" (cut-out). Use M1's outline colour = C4 ink (`#1F1D2B`) to tie them.
- **M2 — lantern-spirit:** strongest pairing. M2's glow is itself a single gradient, so the "one gradient per figure"
  rule applies to both; the warm core colours sit well next to C4's discs. Risk: two glowing elements on one screen
  compete; keep the mascot small on conversation screens (already a spec rule).
- **M3 — Melo the chameleon:** workable but the hue-shift body plus C4's per-character gradient discs can clash in
  the cast gallery. Pair by giving the mascot the cream disc and reserving gradients for people.
- **M4 — cloud-blob traveller:** good tonal fit (soft, flat), but M4's scarf tail is the only "line" element; keep its
  width ≥ the C4 brow weight so the two systems share one stroke scale.
- **M5 — Plio, folded paper:** best stylistic match. Faceted flat planes are the same language as C4's shade plane;
  treat Plio's crease lines as C4 ink and Plio reads as part of the same poster. This is the pairing I would
  recommend if C4 is chosen.

## Production cost and scalability for 30 courses

- A new lead character costs roughly 1–2 hours in this style: pick skin pair, hair silhouette, garment tones, prop and
  gradient pair, then the four (or nine) states come from the shared pose system for free. The whole roster of ~16
  current characters would take two to three working days; 30 courses × 2–3 leads is one to two weeks of
  vector work, not months.
- Scenes are cheaper than in C2/C3 because there is no lighting pass: a scene is 10–20 flat objects with one halo.
- Everything is parametric (the generator already exposes skin, hair, garment, gradient and pose), so colour-blind
  checks, dark-mode variants and the cream-disc list variant are a script run, not a redraw.
- The style survives raster export at every spec size (24–40 dp icon, 64–96 dp companion, 160–240 dp hero).

## Hard-rule compliance

Original work; no owls/birds; no resemblance to any existing language-app mascot or brand; no national flags, no
ethnic or national caricature; contemporary casual clothing (tee + apron, shirt + cardigan, top + blazer); no
real-person likeness; readable in grayscale and at 24 px; no baked-in text; system fonts only on sheets; no CC0/open
assets used at all.

## Files

```
README.md
generator.js                      source of every SVG below (node generator.js)
style-sheet.svg                   1280×1400 — construction, line weights, shading rule, palette, expressions, scale/grayscale check, do/don't
preview-grid.svg                  cast × state comparison grid (12 avatars)
scene-cafe.svg                    640×360 — Nadia at the café counter, matching environment treatment
portraits/nadia-neutral.svg       256×256 circle-cropped avatar
portraits/nadia-greeting.svg
portraits/nadia-talking.svg
portraits/nadia-listening.svg
portraits/kenji-neutral.svg
portraits/kenji-greeting.svg
portraits/kenji-talking.svg
portraits/kenji-listening.svg
portraits/lucia-neutral.svg
portraits/lucia-greeting.svg
portraits/lucia-talking.svg
portraits/lucia-listening.svg
```

All SVGs are standalone (xmlns + viewBox, self-contained, no external references) and under 125 KB each.
