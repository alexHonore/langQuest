# LangQuest mascot style guide — Melo, the chameleon

Status: v2 (style version `langquest-art-v1`, mascot design **M3**, owner decision 2026-10-19).
Supersedes the v1 orbit-creature guide. Source of truth for the mascot's look, behaviour and usage.
The geometry lives in code (`packages/ui/src/art/mascot.ts` + `packages/ui/src/art/mascot/*`);
static exports are in `assets/mascot/`. Rigging: `docs/design/mascot-rive-spec.md`.

"Melo" (from cha**mel**e**o**n) is a working name — not a trademark claim, never baked into artwork,
never hard-coded in UI copy. Screens refer to the mascot through localized `mascot.*` strings only.
A trademark and cross-language connotation check is required before the name appears in copy.

---

## 1. Concept and personality

A round, unhurried **chameleon** who adapts instead of judging. Chameleons change to fit where they
are — the visual metaphor for learning any language from any instruction language. Two big eyes on
gentle turrets swivel independently: one on you, one on the idea. The spiral tail is its voice when it
is not talking: it waves hello, hooks into a question when thinking, shoots up when you nail a phrase,
droops when the network is gone. Its body colour drifts with the situation and the course while the
saffron crest and bands stay fixed — always the same friend wearing the local light.

Personality (spec §10.2A): **curious, encouraging, witty, respectful, energetic, never judgmental**.
Warm, patient, a little goofy; never scary, never reptilian (no scales, teeth, claws, long tongue).

Rules that follow:

- Cheers effort and progress, not streaks. Never guilts, shames or implies the learner "let it down".
- Never fakes evaluation: no scores, no waveforms, no "fluent". `success` / `try_again` only react to
  _real_ evaluator output; `listening` / `speaking` only appear while the audio engine really is.
- Stays small and still during a live dialogue; never crosses a scene's central overlay band.
- Its instructional speech follows the enrolment's **source language**; it never provides
  target-dialect pronunciation samples (those come from reviewed native audio).
- Not an owl, a bird, a franchise look-alike, or an anthropomorphic ethnic/national caricature.

## 2. Silhouette

Readable in flat grayscale at 24 dp. Signature features, in priority order (keep when simplifying):

1. **Pear body** — the head _is_ the body (no neck): 50 u wide at the head, 54 u at the hips, crown y 18 → ground y 88.
2. **Eye turrets** — two Ø 22 u domes on the eye axis (y 42) bulging past the head edge.
3. **Crest (casque)** — soft saffron dome 28 u wide × 9 u tall on the crown; never pointed.
4. **Spiral tail** — tapered 9 → 2.4 u, inward spiral Ø ≈ 20 u, attached lower-right (73, 77).
5. Stubby two-lobed mitten limbs; two accent bands + dots on the flanks.

```
          ,-´¯`-.            ← crest
      (o)|      |(o)         ← eye turrets on the head edge
         |  \_/  |           ← wide low mouth (y 60)
         |  (__) |     @     ← belly; spiral tail lower-right
          ''   ''            ← mitten feet on the ground line
```

Mirror the **whole figure** for RTL layouts; never mirror the tail alone.

## 3. Anatomy and proportions (100 × 100 viewBox)

| Part    | Geometry                                                                    | Notes                                                                            |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Body    | `BODY_FRONT` pear path, outline 2.2 u                                       | lower shade crescent (40 %), belly ellipse (50, 72) 15 × 10                      |
| Crest   | `CREST_FRONT` dome (36–64, apex y ≈ 11)                                     | crest colour, never tinted                                                       |
| Turrets | centres (33, 42) / (67, 42), r 11 (scale 1.06–1.1 for the leading eye)      | ring in `bodyShade`; eye white r 8; pupil r 4.2; highlight r 1.5                 |
| Gaze    | pupil offset = gaze × 3.2 u per axis, gaze ∈ [−1, 1]                        | **independent per eye** (`gazeL` / `gazeR`)                                      |
| Lids    | chord from the eye top, closure 0..1 (`soft` 0.2, `half` 0.45)              | body-shade colour; blink = closure 1 (full disc)                                 |
| Mouth   | centred (50, 60), 24 u span for `smile`                                     | shapes: smile, small, tiny, grin, open, o, line, wavy                            |
| Cheeks  | (35, 56) and (65, 56), 4 × 2.4, 80 %                                        | affectionate states only                                                         |
| Arms    | shoulders (26, 63) / (74, 63), stroke 4.8 (outline 7.6), mitten lobes r 2.6 | poses: down, up, wave, ear, chin, point, clasp, thumbs, hug/tucked, out, gesture |
| Feet    | (39, 87) and (61, 87), two lobes each                                       | planted on the ground line; omitted at icon detail                               |
| Tail    | `TailSpec` (attach, start direction, optional lead, spiral R/turns/dir)     | per-state gesture; `tailCurl` 0..1 tightens the spiral                           |
| Bands   | two 3.4 u crest-colour strokes on the flanks + two dots                     | brand anchor, never tinted                                                       |

Pivots: tilt about (50, 60); breath/bounce about the ground centre (50, 88) so the feet stay planted.
Props float outside the tilt group (top-right by default; `lightbulb` top-left, `soundIn` left,
`soundOut` right, `headphones` band behind the crest + cups at the sides).

Detail levels:

- **full** (≥ 40 dp): everything above.
- **icon** (< 40 dp): drop arms, feet, bands, cheeks, highlight and the turret inner ring; outline 3 u;
  props stay but simplify (1 sparkle, 4 confetti, 2 z's, no bulb rays). Crest + turrets + tail + prop carry
  the meaning.

## 4. Expression vocabulary (17 contract states)

Each state is a `MascotPose` (`MASCOT_POSES`): eyes/gaze/lids **per eye**, mouth, arms, tail spec, tilt,
cheeks, prop. Every state differs by pose and/or prop — never by colour alone — and reads without a
caption across cultures (no culture-specific gestures).

| State              | Eyes (L / R)                                  | Mouth     | Arms             | Tail                       | Prop                    | Tint (light)          | Reads as             |
| ------------------ | --------------------------------------------- | --------- | ---------------- | -------------------------- | ----------------------- | --------------------- | -------------------- |
| `neutral`          | open, centred                                 | smile     | down             | relaxed spiral             | —                       | leaf `#6DC071`        | relaxed, available   |
| `welcome`          | wide                                          | grin      | wave (right up)  | lifted hook, tilt −4°      | 3 sparkles              | spring green          | hello                |
| `happy`            | happy arcs                                    | grin      | out              | lifted spiral              | —                       | lime leaf             | pleased              |
| `curious`          | open / **wide, up-right, 1.1×**               | small "o" | down             | question hook, tilt −8°    | sparkles                | mint                  | interested           |
| `listening`        | both to the left, left eye 1.08×              | small     | hand to "ear"    | tight spiral, tilt 7°      | incoming arcs (left)    | **sea teal**          | I'm listening to you |
| `speaking`         | open, centred                                 | open      | gesture          | loose outward curl         | outgoing arcs (right)   | fresh green           | mascot is talking    |
| `thinking`         | left soft-lidded / **right up-right**         | small "o" | hand on chin     | question hook, tilt 3°     | thought bubbles         | **lavender**          | working on it        |
| `encouraging`      | open / **happy (wink)**                       | grin      | thumbs-up        | lifted hook, tilt −3°      | sparkles                | chartreuse            | you've got this      |
| `try_again`        | soft-lidded (0.22)                            | small     | hands clasped    | low spiral, tilt 4°        | replay arrow            | **soft coral**        | gentle, no shame     |
| `celebrate`        | happy arcs                                    | grin      | both up          | unfurled upright, tilt −3° | confetti + stars        | saffron lime          | big win              |
| `achievement`      | wide, up                                      | grin      | both up          | upright hook               | star medal with ribbons | warm gold-green       | reveal               |
| `quiet_audio`      | half-lidded (0.4), down                       | small     | down             | relaxed spiral             | headphones              | calm sky              | audio / listen mode  |
| `sleep`            | closed                                        | tiny      | hug              | drooping, tilt 6°          | ascending z's           | **dusk blue**         | resting              |
| `offline`          | open, looking down                            | line      | down             | drooping                   | cloud with slash        | **grey-green, muted** | no network           |
| `connection_error` | diverging (L up-right / R down-left)          | wavy      | out              | drooping, tilt −3°         | broken link + spark     | **grey-green, muted** | connection problem   |
| `success`          | happy arcs                                    | smile     | thumbs-up        | upright hook               | check badge             | **bright leaf**       | confirmed            |
| `gentle_hint`      | **left up-left 1.06×** / right up-left softer | small     | pointing up-left | curl, tilt −5°             | lightbulb               | soft yellow-green     | here's a nudge       |

Independent eyes are the chameleon trait: listening = both eyes swivel to the sound; thinking = eyes
diverge; curious / gentle_hint = one eye leads.

## 5. Chameleon colour

Melo **changes colour with the situation**. `mascotTint({ state, courseFamily?, trackId?, theme? })`
returns the `body`, `bodyShade`, `belly` and `crest` tokens for one render; `MascotSvg`,
`mascotSvgString` and the Lottie generator accept `tint` / `trackId` / `courseFamily` and default to the
state's tint. Everything is token-driven; screens never hard-code a colour.

Two dials are blended:

1. **State tint** (`MASCOT_STATE_TINTS`) — the hue of the situation (table above). Base = leaf green,
   hue 123°, saturation 0.40.
2. **Course-family tint** (`courseFamilyTint(trackId)`) — the M3 hue dial: an abstract offset per family
   (`germanic` 0°, `romance` −18°, `east-asian` −40°, `west-asian` +20°, `slavic-hellenic` +42°,
   `indic` +54°, `african` +66°). `COURSE_TRACK_FAMILIES` maps the 30 tracks; unknown ids fall back to
   offset 0. Families are abstract groupings and never echo a flag; the mapping is a product decision
   kept in one table so it can be swapped without touching any screen.

`hue = stateHue + familyOffset × familyWeight`. Mood states (neutral, welcome, happy …) take the family
offset in full; signal states (listening, thinking, sleep, try_again, offline …) take 0.2–0.4 of it so
their hue stays recognisable in every course.

Rules:

- **Hue never encodes an evaluation result.** `success` and `celebrate` read by pose + prop first
  (thumbs-up + check badge, arms up + confetti); their tint is a mood. Tests force one tint across all
  states and require the silhouettes to stay distinct.
- The **crest, bands, outline, eyes and props never shift** (muted only in the two network states), so the
  silhouette stays the brand anchor and the figure is still Melo in grayscale.
- Body vs outline contrast ≥ 3:1 in both themes for every state (tested); shade < body < belly in
  luminance, always.
- Don't tint by hand: no per-screen hue overrides, no "red for errors". Add a situation to
  `MASCOT_STATE_TINTS` instead.

Palette tokens (`MASCOT_PALETTE`, `packages/ui/src/art/palette.ts`):

| Token                          | Light                                              | Dark                               | Use                                                      |
| ------------------------------ | -------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `body` / `bodyShade` / `belly` | `#6DC071` / `#45A149` / belly hsl(103, 45 %, 94 %) | hsl(123, 40 %, 62 %) / 48 % / 92 % | **base** tint only — replaced per render by `mascotTint` |
| `crest` / `crestShade`         | `#F2A93B` / `#D98C1F`                              | `#FFBC4F` / `#E09A2E`              | casque, bands, stars, badge, bulb (`accent` alias)       |
| `outline`                      | `#243B2A`                                          | `#0E1A12`                          | all outlines                                             |
| `pupil`                        | `#1F2A2E`                                          | `#0F1A20`                          | pupils, grin interior (`mouth` alias)                    |
| `eyeWhite` / `highlight`       | `#FFFFFF`                                          | `#F4F7F2` / `#FFFFFF`              | eyes, highlights                                         |
| `cheek`                        | `#FFB08A`                                          | `#FF9E8A`                          | blush (fades to belly when muted)                        |
| `tongue`                       | `#F07C8A`                                          | `#FF8E9B`                          | grin / open mouth                                        |
| `prop` / `propFill`            | `#243B2A` / `#FFFFFF`                              | `#E8F1EA` / `#1C2B20`              | prop strokes / fills                                     |
| `danger`                       | `#E0565B`                                          | `#FF7A7E`                          | slash, spark, medal ribbons                              |
| `muted` / `mutedFill`          | `#9AA3A8` / `#E8EDEF`                              | `#8C9792` / `#46524F`              | crest + props in offline / error                         |
| `sleepy`                       | `#8F9FD6`                                          | `#A9B6E8`                          | z-strokes                                                |
| `confettiSky` / `confettiPink` | `#5FB3D9` / `#F07C8A`                              | `#7CC8EA` / `#FF8E9B`              | confetti secondaries                                     |

`ribbon` / `ribbonShade` / `limb` / `mouth` remain as deprecated aliases for v1 consumers.

## 6. Motion

Animations are optional, short and skippable; a static export exists for every state.

| Clip (`MascotAnimation`) | What it is                                                                                            | Duration | Lottie file (`assets/mascot/lottie/`) |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- |
| `idle` / `blink`         | breath (1.02 / 0.985 about the feet), tail ±2.5°, blink L then R 60 ms apart, one-eye scan every ~7 s | 4 s loop | `idle.json`                           |
| `reaction`               | eyes converge on the mic point, squash 0.96, tail wave                                                | ≤ 400 ms | `reaction.json`                       |
| `anticipation`           | lean forward, eyes wide before the learner speaks                                                     | ≤ 600 ms | (Rive)                                |
| `celebrate_bounce`       | crouch → two bounces, tail unfurls, confetti burst from the crest                                     | ≤ 1.2 s  | `celebrate_bounce.json`               |
| `achievement_reveal`     | star medal scales in                                                                                  | ≤ 900 ms | (Rive)                                |
| `thinking`               | question-hook tail curls/uncurls, right eye drifts, bubbles pulse 0.9–1.1                             | 3 s loop | `thinking.json`                       |
| `error_recovery`         | ±2 u shake → settle into `try_again`                                                                  | ≤ 700 ms | (Rive)                                |

The clips are generated from the same geometry (`pnpm --filter @langquest/ui lottie`): bodymovin v5 shape
layers only, no images/fonts/precomps, 256 × 256 @ 30 fps; each `*.frame0.svg` beside a clip is the pose
rebuilt from the Lottie data. The in-code renderer exposes `blink` (0..1), `breath` (−1..1), `gaze` /
`gazeL` / `gazeR`, `tailCurl` (0..1) and `headTilt` (°) as parameters; `MascotSvg` runs the idle loop only
when `animate` is true and `reducedMotion` is false.

Rules: `reducedMotion` disables **everything** (including the idle loop and the Lottie clips → static state
SVG); "mascot off" removes the mascot entirely and the flow still works (spec A33). Animations never
block recording or playback; at most one animated mascot per screen (none inside list items).

## 7. Size variants

| Variant   | Size       | Detail | Typical use                                       |
| --------- | ---------- | ------ | ------------------------------------------------- |
| icon      | 24–40 dp   | icon   | tab badges, inline status (`assets/mascot/icon/`) |
| companion | 64–96 dp   | full   | lesson header, speak screen corner                |
| medium    | 160–240 dp | full   | onboarding hero, empty states                     |
| large     | ≥ 320 dp   | full   | full-screen celebration (confetti)                |

Never scale below 20 dp. Keep ≥ 8 dp clear space around the figure (tail and props extend beyond the body).

## 8. Allowed gestures and do-not rules

Allowed: wave, thumbs up, hand to ear, hand on chin, pointing at a hint, both arms up, clasped hands,
hug, open gesture; tail wave / hook / lift / droop.

Do not:

- draw scales, teeth, claws, a long tongue, a visible neck, ears, fur, wings or a beak;
- draw the eyes without their turret ring (reads as a frog with goggles), point the crest, or make the
  turret ring a contrasting frame;
- add a second tail, mirror the tail alone, or attach it anywhere but lower-right;
- tint by hand or use colour as the only cue for a state; use red for "wrong";
- dress it in national, religious or ethnic costume, uniforms, or flags;
- bake text, numerals or logos into the artwork (`<title>` is the only text, for assistive tech);
- use it to show a score, a waveform, a timer, or anything implying listening when no audio is captured;
- show it crying, angry, mocking or disappointed; the sad-adjacent states are `try_again` (soft) and the
  two network states (muted, concerned);
- pair it with paywall / credit / subscription copy — none exists in this product;
- place it over the central overlay zone of a scene during a live conversation.

## 9. Branding usage

- The mascot is the product's visual guide, not the logo. Use `neutral` or `welcome` (base tint) in
  marketing. The word "chameleon" may need to stay out of marketing copy in some locales.
- Light palette on light backgrounds, dark palette on dark backgrounds; the Night Market (U2) dark
  canvas uses the dark palette. Outline vs background ≥ 3:1.

## 10. Asset naming

| Asset          | Path (under `assets/`)                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| state, light   | `mascot/<state>.svg` (`neutral`, `welcome`, …, `gentle_hint`), 256 px         |
| state, dark    | `mascot/dark/<state>.svg`                                                     |
| icon detail    | `mascot/icon/<state>.svg`, `mascot/icon/dark/<state>.svg` (24 px)             |
| rigging master | `mascot/master-rive.svg` (layered, ids = `MASCOT_PART_IDS` + shape libraries) |
| Lottie clips   | `mascot/lottie/<clip>.json` + `<clip>.frame0.svg`                             |
| manifest       | `art-manifest.json` (`ART_MANIFEST` from `@langquest/ui`)                     |

Regenerate: `pnpm --filter @langquest/ui export-art -- --only mascot` (static + icons + master) and
`pnpm --filter @langquest/ui lottie` (clips). Source geometry: `packages/ui/src/art/mascot/geometry.ts`;
model sheet in data form: `MASCOT_POSES`; colour: `packages/ui/src/art/mascot/tint.ts`.
DB linkage: `MascotAssetPackSchema` (`@langquest/contracts`).

## 11. Accessibility labels

`MASCOT_ACCESSIBILITY_LABELS` (English source) → i18n keys `mascot.a11yState.<state>` in
`@langquest/locales` (`mascotLabelKey(state)`); speech-bubble copy uses `mascot.state.<state>`
(`mascotSpeechKey`) and is never used as a label.

| State            | English label                         |
| ---------------- | ------------------------------------- |
| neutral          | Mascot, relaxed                       |
| welcome          | Mascot waving hello                   |
| happy            | Mascot smiling                        |
| curious          | Mascot looking curious                |
| listening        | Mascot listening to you               |
| speaking         | Mascot speaking                       |
| thinking         | Mascot thinking                       |
| encouraging      | Mascot cheering you on                |
| try_again        | Mascot inviting you to try again      |
| celebrate        | Mascot celebrating                    |
| achievement      | Mascot presenting an achievement      |
| quiet_audio      | Mascot wearing headphones, audio mode |
| sleep            | Mascot resting                        |
| offline          | Mascot, offline                       |
| connection_error | Mascot, connection problem            |
| success          | Mascot, success                       |
| gentle_hint      | Mascot offering a hint                |

Labels describe the state, never the colour (the tint is decorative). Every `MascotSvg` is `accessible`
with `accessibilityRole="image"`; decorative repeats of the same state on one screen pass
`accessibilityLabel=""` only when a neighbouring text carries the meaning.

## 12. Provenance

Original work created in code for LangQuest (`design/explorations/mascots/M3/generator.js` →
`packages/ui/src/art/mascot/*`); no traced, stock, CC0, licensed or AI-generated source. Content origin
for the `visual_assets` rows is `in_code_vector`. No fonts are embedded.

---

### Appendix — sibling asset families (same style version)

- **Characters** (`assets/characters/<id>/<expression>.svg`): original roster characters, parametric
  portraits, 9 expressions each; bound to one variety and `reviewStatus: review_needed` until native review.
- **Scenes** (`assets/scenes/<id>.svg`, `-evening`, `dark/`): 12 layered 16:9 environments with a clear
  centre band for overlays; alt text in `SCENES[].altText`.
- **Covers** (`assets/covers/<trackId>.svg`): 30 abstract palette + motif covers; the UI renders the name.
- **Icons** (`assets/icons/<name>.svg`): 37 stroke icons on a 24 grid.
