# M5 — "Plio", the folded-paper guide

**Code:** M5 · **Name proposal:** *Plio* (from French *pli*, a fold; alternates: *Pleat*, *Tuck*). Working name only, never baked into artwork.

## Concept

A small creature folded from a single sheet of indigo paper. Its body is a six-sided faceted pod lit from the top-left; a cream **face window** sits in the front, and the **visor flap** above it folds up or down to reveal and shade the expression. The flap *is* the brow: lifted high for surprise and welcome, half-closed for thinking, low for gentle moments, closed when the app is offline or resting. A **paper-plane dart** folded from tangerine paper is tucked at the right hip and always points where the learner should go next: up for "keep going", ahead for the next step, flat while waiting, down toward the mic when it is the learner's turn. Two folded tabs serve as arms. Nothing is round except the eyes and smile, which keeps it clearly apart from the current orbit-creature and from every soft-blob or bird mascot on the market.

## Personality (≤120 words)

Plio is a tidy, quietly witty companion: precise but never cold. It leans in when you speak, unfolds a little when you try something new, and never pretends to judge your accent. Its default mood is calm readiness; its joy is crisp and brief (a lift of the visor, a flick of the dart, a scatter of paper confetti). When something fails it does not droop into pity, it simply tilts, shows a soft wavy mouth and points the dart back toward the retry. It respects your attention: small, still and out of the way during live conversations, bigger only when there is something to celebrate. Curious, encouraging, respectful, energetic, never judgmental.

## Strengths

- **Genuinely different silhouette** from the baseline (hexagonal pod + dart fin vs. pebble + ribbon) and from competitor mascots (no bird, no blob, no face-on-a-circle).
- **One expressive mechanic that is also the brand story**: the fold reveals and hides the face; "unfolding" maps naturally to opening up and speaking in a new language.
- **Directional dart = UI affordance**: the tail can honestly point at the next action (mic, next card, retry) without any text.
- **Scales cleanly**: flat facets and straight edges survive 24 px; the icon uses three fills and no creases and still reads as the same character.
- **Grayscale-safe**: cream face, mid-value body, light dart and dark ink stay four distinct values; every state also differs in pose/prop, never colour alone.
- **Cheap to animate**: everything is polygons with few control points; Rive bones on flap, dart and tabs cover most states.
- **Culturally neutral**: no costume, no gesture with regional meaning, no flag colours; origami is a craft idea, not a national reference, and the forms are original (not a traditional model).

## Risks

- **Warmth ceiling**: hard edges can read "corporate" or "geometric logo" if the eyes/mouth are drawn too small; keep the face window large and the smile generous. Softer mouth shapes already offset this; test with learners.
- **Dark mode**: the ink outline nearly disappears on `#141A33`; the silhouette then relies on facet-vs-background contrast (≥ 3:1 is met by the facets, not by the outline). If a product rule requires an outline contrast of 3:1, add a 1-unit light rim in the dark variant.
- **Side view**: the dart sits on the creature's left flank, so a true profile from that side overlaps body and fin. Prefer front and three-quarter views in UI; profile is for turnarounds only.
- **Fold logic vs. physics**: the visor shows its outer (blue) face when lifted; nobody will audit the origami, but an animator should keep the flap rotating on one hinge so it never looks like a hat.
- **Half-closed flap** (thinking) crops the eyes; at 24 px this state should use the "flat line mouth + ascending notes" cue rather than the lid crop.
- **Name**: "Plio" needs a trademark search before use.

## How it scales

| Size | Treatment |
|---|---|
| 24–40 dp | `icon-24.svg`: hexagon in three fills, face window, brim band, two eye blocks, one mouth bar, solid dart. No creases, no arms. |
| 64–96 dp | Full figure, drop crease lines and highlight squares. Props (arcs, notes, replay) stay because they carry meaning. |
| 160–240 dp | Full figure as in `states/`. |
| ≥ 320 dp | Full figure; confetti and sparkles can be scattered further out; add subtle paper-grain only if the UI tokens allow texture. |

Silhouette priority when simplifying: 1) hexagonal pod, 2) dart fin at the right hip, 3) cream face window, 4) brim band, 5) arm tabs.

## Animation ideas (Rive / Lottie)

- **idle**: slow 2 % breathing scale on the body; the dart drifts ±3° like a plane in a draft; visor rises 1 unit on the inhale. Loop 4 s. Off under reduced motion.
- **blink**: eye pills squash to 1-unit creases for 90 ms every 3–5 s; occasionally a single eye (wink) in `encouraging`.
- **react** (learner turn received): body hops 3 units, visor pops up to 0.9 then settles at 0.5, dart snaps from −15° to +22° (points to the mic) in 250 ms with a paper "flick" ease-out.
- **listening**: incoming arcs fade in one by one in sync with real mic activity only; left tab lifts; body turns −0.3.
- **thinking**: flap lowers to half, three paper notes rise and rotate 8° each, 1.2 s loop while waiting.
- **celebrate**: two bounces; on the second, visor slams fully up, eyes switch to happy chevrons, dart points −55° and confetti scraps (triangles/rects) burst from behind the body and tumble on their own axes. ≤ 1.2 s, skippable.
- **try_again**: 3° tilt, wavy mouth, replay arrow draws itself (stroke trim 0→1) then holds; no shake, no sad eyes.
- **offline**: visor folds down to closed in 300 ms, palette desaturates, cloud-with-slash fades in; reverse on reconnect.
- **unfold reveal** (onboarding only): the whole figure folds out from a flat diamond (scale-y 0 → 1 per facet, staggered 60 ms), ending on `welcome`.

## Palette (see `palette.svg`)

Body facets `#8D9CFF / #6B7CF5 / #5566E0 / #3E4CC2`, brim `#A9B4FF`, closed flap `#5F70EC`, face cream `#FFF3DF` (shade `#F1E0C3`), ink `#1C2142`, dart `#FF9D4D / #E8742B`, cheek `#FFB1A0`, accents `#FFD45C`, `#52D1B2`, danger `#F0605C`. Muted set for offline/error; dark set with lighter facets, cream `#F8EDDA`, outline `#0B0E26` on `#141A33`.

## Provenance and rules

All geometry is original vector work generated in code for this exploration; no traced, licensed, AI-generated or CC0 assets were used (no Open Peeps / Open Doodles / unDraw in this folder). No text is baked into any state, icon or dark-variant artwork (`<title>` only). The model sheet and palette sheet carry labels in system fonts (`-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`); no font files are embedded or referenced. No flags, national or ethnic references, real-person likeness, owl or bird features.

## Files

```
design/explorations/mascots/M5/
├── README.md
├── model-sheet.svg          front, three-quarter, side + proportions, fold mechanism, dart directions, grayscale/size ladder (1180×760)
├── icon-24.svg              simplified silhouette-safe icon (24×24)
├── dark-variant.svg         neutral state on the dark palette, on a #141A33 card (256×256)
├── palette.svg              swatches with hex values (light, muted, dark)
└── states/                  each 256×256, viewBox 0 0 100 100, transparent background
    ├── neutral.svg
    ├── welcome.svg
    ├── listening.svg
    ├── speaking.svg
    ├── thinking.svg
    ├── celebrate.svg
    ├── try_again.svg
    └── offline.svg
```
