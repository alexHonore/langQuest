# C1 — Geometric flat (refined baseline)

Character art-style exploration **C1** for LangQuest. Status: concept for owner approval, not production art.
Everything in this folder is original vector work drawn in code (`generator.py`); no traced, stock, CC0 or
AI-generated source was used, no fonts are embedded, and the only text anywhere is the `<title>` on each file
(assistive tech) plus the annotations on `style-sheet.svg`, which are documentation, not artwork.

## Concept name

**"Cut paper, warm light"** — flat colour shapes assembled like cut card, with one flat shade per material and
no outlines. It is the baseline's geometric DNA (crisp circles, pebbles and wedges) carried through properly:
the current portraits outline every shape with a 1.6 px ink line, use white-sclera cartoon eyes and a single
peach skin; C1 removes the lines, makes edges by colour contrast, moves to solid eyes with one highlight, and
rebuilds proportions, hair and clothing so three people in one frame are immediately three different people.

## Personality and rationale

C1 wants the cast to feel like friendly, grounded adults you would actually meet at a counter, next door, or
across a desk — not cartoon kids and not stock-vector "corporate people". The look is calm and premium because
there is nothing extra on the page: a face is a skin shape, one shade crescent, two solid eyes, two brow strokes,
a mouth, and the hair silhouette does most of the characterisation. Warmth comes from the palette (a seven-step
warm skin ramp with matched blush, terracotta / teal / olive / mustard garments, sand and sage backgrounds)
rather than from rendering. Because every character is built from the same rules and the same parametric head,
the cast reads as one family across 30 courses while hair, clothing, age cues (glasses, receding hair, smile
lines) and accessories (hoops, studs, headband, necklace) carry individuality. It is also the style that is
cheapest to animate (eyes, brows, mouth and head tilt are independent flat parts) and the one that survives
best at 24 px and in grayscale — see block 6 of the style sheet.

## What the files show

| Character | Age / role | Read in silhouette by |
| --- | --- | --- |
| Nadia | 30s, café staff, Casablanca (Darija) | curly hair mass with half-up knot, mustard headband, gold hoops, terracotta tee + charcoal bib apron |
| Kenji | 60s, neighbour, Tokyo | short grey hair with receding temples, round thin glasses, collared shirt under olive cardigan, smile lines when talking |
| Lucía | 20s, coworker, Madrid | chin-length chestnut bob with blunt bangs, stud earrings, thin necklace, cream blouse under open teal-slate blazer |

Four states each (`neutral`, `greeting`, `talking`, `listening`), same crop, same head position, so the
style can be compared pose-for-pose with C2–C5:

- **neutral** — relaxed, closed smile.
- **greeting** — raised brows, open smile, 5° tilt, waving hand enters bottom-right.
- **talking** — open rounded mouth, slight tilt, open palm enters bottom-left (gesture for "my turn").
- **listening** — 7° tilt toward the learner, one brow up, eyes narrowed and gaze shifted, small closed smile.
  No hand, so the learner's mic control is never competed with.

`scene-cafe.svg` puts Nadia (greeting) behind a counter in the matching environment treatment: the same
flat-with-one-shade rule, warm cream wall, an arched window with pale rooftops and a palm, an abstract
geometric tile band (contemporary décor, no national motif), pendant lamps, a pastry dome and an espresso
machine. The right third above the counter is deliberately sparse so transcript / hint overlays can sit there.

## Style rules (summary of `style-sheet.svg`)

1. **No outlines on fills.** Edges come from luminance contrast; touching materials must differ by ≥ 0.12
   relative luminance (checked in the generator: skin / hair / garment / background are printed on each run).
2. **One flat shade per material**, light from top-left: base colour mixed 18 % toward `#3B2A2A` (never black).
   Shade lives on the right jaw (a clipped crescent), under the fringe, under the chin (neck band), inside ears,
   and on the right side of hair and garments.
3. **Line only where a fill cannot carry the shape:** brows (4 px, hair-shade colour), closed mouth (3 px ink),
   glasses (2.6 px, thicken to 4 px under 48 px). Values are at 256 px and scale with the asset.
4. **Solid eyes + one highlight**, no white sclera. The highlight moves to show gaze.
5. **Proportions:** head centre at (128, 112) in the 256 frame, eyes on the centre line, mouth at +27, ears at +4,
   torso top at head-bottom + 12. Face width/height/chin/jaw are per-character parameters.
6. **Backgrounds:** flat tint plus one offset disc in a sibling tint; dark-mode variants are the same shapes
   over darker tints with the skin ramp unchanged.

## Strengths

- **Scale-proof.** Every head is still identifiable at 24 px (hair mass, apron, glasses, bob) and in grayscale;
  there is no thin line to vanish.
- **Cheapest style to produce and animate.** Each portrait is ~3–5 KB of SVG; eyes, brows, mouth, head tilt
  and hands are independent parts, so lightweight lip-sync and blinking are a matter of swapping a few paths.
- **Coherent family at volume.** One parametric head + a library of hair, garment and accessory parts yields
  a consistent cast without a painter in the loop; new characters are parameter sets, not drawings.
- **Honest continuity with what exists.** The current `assets/characters` and `assets/scenes` can migrate
  by removing strokes and adding one shade — nothing has to be thrown away.
- **Warm and adult.** Larger, better-placed features and muted-warm garments avoid the "kids' app" reading
  without going corporate.

## Risks

- **Can look generic.** Flat-geometric people are a crowded genre; the distinctiveness must come from the
  hair/garment silhouettes and the warm palette, and from the mascot. Review against competitor styles before
  committing. (Nothing here is traced or derived from any brand; the risk is convergence, not copying.)
- **Low emotional range at small sizes.** With no sclera and no line work, subtle expressions (confusion,
  surprise) rely on brows, head tilt and mouth; the full 9-state spec set will need a few extra parts
  (hand to chin, raised shoulders) to stay readable.
- **Cultural texture is shallow by design.** Flat shapes carry contemporary clothing well but little
  environmental detail; scenes stay "clean" rather than "rich". If the owner wants dense, lived-in locales,
  C2 (soft dimensional) or a textured style will serve better.
- **Shade placement is a rule, not a judgement call.** That is a strength for production but means lighting
  never changes per scene (no evening key light on faces); evening scenes are done by tinting backgrounds only.

## How it pairs with each mascot option

| Mascot | Pairing | Notes |
| --- | --- | --- |
| **M1 — refined orbit-creature** | Good, with one adjustment | M1 keeps a 2.6 px silhouette line; C1 has none. Either give M1 a "no-line" variant for in-scene use, or add a 2 px *silhouette-only* outline to C1 portraits (the generator can do this as a flag). Palettes already agree (teal / orange / warm ink). |
| **M2 — lantern-spirit** | Strong contrast pairing | A glowing, translucent mascot against matte, opaque people makes the guide obviously "not a person", which the spec wants. Keep the halo as the *only* soft gradient on screen; C1's flatness is what lets it glow. |
| **M3 — Melo, the chameleon** | Natural fit | M3 is also built from flat rounded shapes; its hue-shift mechanic sits cleanly on C1's fixed warm palette because the people never change hue. Check that Melo's leaf green and Kenji's olive cardigan never share a screen without a tint change. |
| **M4 — cloud-blob traveller** | Closest stylistic match | Soft pale lilac blob with a scarf tail, flat-filled: it reads as the same "cut paper" world as C1. Risk is that both are so soft the UI needs stronger accent colour (use the terracotta / teal tokens for CTAs). |
| **M5 — Plio, folded paper** | Thematic match, tonal tension | Faceted body + fold creases echo C1's geometric construction, but Plio is crisp and angular while the people are round. Works if Plio's creases stay at 45 % opacity and its facets use the same one-shade rule; avoid placing Plio's hard edges directly over a C1 face. |

## Production cost and scalability (30 courses)

- **Per course:** typically 3–5 recurring characters × 9 expressions + lip-sync mouths. With the parametric
  generator a new character is ~40 lines of parameters (skin step, hair style, garment, accessories, face
  proportions); expressions are shared. Estimate **1–2 hours of art direction per character** (choosing parts,
  checking cultural review notes) once a part library of ~12 hair styles, ~15 garments and ~10 accessories
  exists — roughly **two weeks** of designer time for the library, then days, not months, for the full roster.
- **Scenes:** the environment rule set (flat + one shade, sparse overlay zone) keeps a scene at **0.5–1 day**
  each; 12 scene types × day/evening/dark variants are tint swaps, not redraws.
- **Weight:** portraits 3–6 KB, scenes ~15 KB as SVG; rasterised at 2× they stay under 20 KB WebP. No
  gradients or filters means no rendering surprises on low-end Android.
- **Review:** flat parts are easy to swap after native cultural review (a garment or accessory change is a
  parameter edit), which matters for `review_needed` characters across 30 varieties.
- **Animation:** blink, mouth shapes, brow lift, head tilt and hand entries are already separate groups in
  the SVG structure; a Lottie/Rive port is mechanical.

## Files

```
design/explorations/C1/
├── README.md
├── generator.py                  # parametric source; `python3 -I generator.py` rewrites every SVG below
├── style-sheet.svg               # line weight, shading, proportions, palette, do/don't, 24 px + grayscale test
├── scene-cafe.svg                # 640×360 vignette: Nadia at the Casablanca café counter
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

All SVGs are standalone XML (`xmlns`, `viewBox`), self-contained (no external references, fonts, images or
scripts), validated with `xmllint`, and under 90 KB each. Third-party assets used: none.
