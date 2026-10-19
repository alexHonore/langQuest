# C2 · Soft dimensional ("clay / plush") — character art style exploration

Status: exploration for owner approval. Nothing here is wired into the app; nothing outside this folder was touched.

## Concept

Characters are built as if they were small, softly lit clay or plush figures photographed in a studio: rounded, slightly inflated forms, a warm key light from the upper-left, a cool rim light tracing the lower-right edges, a small specular on the forehead and nose, and soft contact shadows wherever something rests on something else. There are **no outlines at all**; every shape separates from its neighbour by value (hair / skin / clothing / background disc are always four distinct tones). Facial features are the only "drawn" elements: short rounded strokes in a darker skin tone, glossy bead eyes with two highlights, a button nose, sculpted lips.

Personality / rationale: the look is friendly, tactile and premium — closer to a modern animated short or a well-made toy than to a flat sticker set. It makes the AI conversation partners feel physically present and approachable (important for a speak-first app where the learner needs to feel safe talking to a "person"), it ages well for adults, and it photographs well in marketing. It deliberately reads nothing like the flat, outlined, saturated look that dominates the language-app category, which also keeps it well clear of any existing brand's trade dress.

The three cast members are rendered with the same recipe so the owner can compare across style options:

| Character | Signature silhouette | Palette |
|---|---|---|
| **Nadia** (café staff, Casablanca, 30s) | high curly bun with teal scrunchie, hairline curls, gold hoops, henley + terracotta bib apron | warm tan skin, near-black hair, sage + terracotta, warm peach disc |
| **Kenji** (neighbour, Tokyo, 60s) | short silver side-parted hair, round dark-framed glasses, smile lines, shawl-collar cardigan over a white shirt | light skin, silver hair, mustard + cream, sage disc |
| **Lucía** (coworker, Madrid, 20s) | long wavy chestnut hair with side-swept fringe, stud earrings, blazer lapels over a cream top | light-olive skin, chestnut hair, dusty blue + cream, lavender disc |

All clothing is contemporary and everyday; no costumes, flags, landmarks, text or logos anywhere. No real-person likeness.

## Expression set (4 of the 9 required states)

- **neutral** — closed soft smile, brows at rest.
- **greeting** — brows up, eyes wider, open smile with teeth, one hand raised in a wave, head tilted away from the hand.
- **talking** — open rounded mouth with tongue, brows slightly up, head tilted the other way, eyes a touch lowered.
- **listening** — head tilted ~9°, one brow slightly raised, eyes turned toward the speaker, small closed smile.

Every state changes brows + mouth + head tilt (never colour), so they read in grayscale and at 24 px. The remaining states (surprise, confusion, friendly success, follow-up question, lip-sync mouths) are additional mouth/brow/pose parameters on the same rig.

## Strengths

- Premium, warm, tactile; adults do not feel talked down to.
- Expression rig is parametric (brows, eyes, gaze, mouth, tilt, hand), so new states are cheap once a character exists.
- Strong silhouettes: bun / glasses / wavy hair survive the 24 px grayscale check (see style sheet, panel 6).
- Environment treatment is the same recipe (every object is a shaded rounded form), so scenes and characters sit in one world without a separate "background style".
- No filters in product art (only gradients, clip paths and opacity) — renders identically in browsers and react-native-svg; portraits are 11–13 KB each.

## Risks

- **Rendering cost.** Every shape is fill + clipped rim stroke; a portrait is ~60 gradient-filled elements, a scene ~250. Fine for one portrait per screen, but not for long lists of animated instances — list thumbnails should be rasterised (WebP) at build time.
- **Lip-sync / animation.** Clay-style mouths animate well as swapped shapes but badly as morphs; plan 4–6 mouth shapes, not continuous morphing.
- **Consistency across many artists / AI generators.** The look depends on one light direction and exact stop positions; the style sheet must be enforced with the shared `ramp()`/`clay()` helpers, not reproduced by hand.
- **Dark mode.** Pale discs and the cool rim need their own variant (deeper disc ramp, rim at ~80 %); skin ramps stay as is. Not produced in this exploration.
- **Flatness of hair.** Big smooth hair masses can look like helmets at large sizes; the fix (a second darker lobe or a few strand highlights) adds elements.

## How it pairs with mascot options M1–M5

This exploration was produced in parallel with the mascot explorations, so the pairings below are stated as rules rather than as judgements of files I have seen:

- **A soft-bodied / rounded mascot** (any option whose body is a single inflated form — the orbit-creature baseline is one) pairs best: give it the exact same recipe (focal radial, cool rim, specular, contact shadow) and it becomes a sibling of the cast rather than a sticker on top of them.
- **A flat, outlined or geometric mascot** will clash on the same screen; either re-render it with the C2 recipe (cheap, it is a parameter change) or keep it strictly to UI chrome (tab icon, toasts) where it never sits next to a portrait.
- **A very textured or illustrative mascot** (painterly, hand-drawn line) will make the clean clay cast look like UI icons. Avoid pairing.
- **Scale rule for any option:** the mascot must keep a 2-value silhouette at 24 px exactly as the cast does; C2 heads are tested at 24 and 16 px in `style-sheet.svg`.
- **Colour rule for any option:** the cast uses muted, desaturated garment colours (sage, terracotta, mustard, dusty blue) so a mascot with one saturated signature colour (teal, orange) will read as the "guide" without competing.

## Production cost and scalability (30 courses)

- One character = one parametric definition (skin/hair/garment ramps + hair paths + outfit paths + accessories), roughly 120 lines in the generator, reusing the shared face, body, hand and expression code. A new character takes about half a day of art direction once the rig is approved; all nine expression states come for free from the rig.
- At 2–4 characters per course, 30 courses = 60–120 characters ≈ 30–60 artist-days for the cast, plus cultural/dialect review per course (the spec requires it; clothing and accessories are the main review surface).
- Scenes: each environment object is a shaded rounded form from a small prop library (cups, jars, plants, furniture); a new scene is 1–2 days. Day/evening variants are a wall ramp + lamp glow change.
- Output: SVG master → optimised SVG for live portraits, WebP rasters for lists and covers. Portraits ~12 KB, scene ~35 KB, no fonts, no external references.
- AI image generation (if ever enabled) can follow the written recipe in the style sheet as a prompt, but the vector rig is the source of truth for continuity.

## Files

```
README.md
style-sheet.svg                      1200×890, documentation sheet (system-font labels only)
scene-cafe.svg                       640×360, Nadia behind the counter of a bright Casablanca café
portraits/nadia-neutral.svg          256×256 circle-cropped avatar
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

All SVGs are standalone (xmlns + viewBox), self-contained, under 120 KB, validated with xmllint. Product art (portraits, scene) uses gradients, clip paths and opacity only; the style sheet additionally uses one `feColorMatrix` filter purely for its grayscale check.

## Provenance

Everything in this folder is original vector artwork generated from a parametric script written for this exploration. No CC0 / Open Peeps / Open Doodles / unDraw assets were used anywhere, and no competitor artwork was referenced.
