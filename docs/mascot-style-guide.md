# LangQuest mascot style guide — the orbit-creature ("Orbi", provisional name)

Status: v1 (style version `langquest-art-v1`). Source of truth for the mascot's look, behaviour and
usage. The geometry itself lives in code at `packages/ui/src/art/mascot.ts`; static exports are in
`assets/mascot/` (light) and `assets/mascot/dark/`. This guide satisfies spec §10.2A deliverable 1.

The name "Orbi" is a working name only — it is not a trademark claim and must not appear baked into
artwork. UI copy refers to the mascot through localized strings (`mascot.*` keys), never a hard-coded name.

---

## 1. Concept and personality

A small floating **orbit-creature**: a soft rounded body that hovers, two large expressive eyes, tiny
limbs, and one **asymmetric ribbon tail** that trails from the lower-right of the body like a comet's
wake. It is a _guide to real speaking_, not a reward mechanic.

Personality (spec §10.2A): **curious, encouraging, witty, respectful, energetic, never judgmental**.

Rules that follow from the personality:

- It cheers effort and progress, not streaks. It never guilts, shames or implies the learner "let it down".
- It never fakes evaluation: the mascot does not score pronunciation, show waveforms, or claim a
  learner is "fluent". Feedback states (`success`, `try_again`) are reactions to _real_ evaluator output.
- It never interrupts a live dialogue unnecessarily; during conversations it stays small and still.
- Its instructional speech follows the enrollment's **source language** (e.g. French when learning
  Darija from French). It never provides target-dialect pronunciation samples — those come from
  reviewed native audio.
- It is not an owl, a bird, an animal mascot of any kind, or an anthropomorphic ethnic/national caricature.

## 2. Silhouette

The silhouette must be recognisable in flat grayscale at 24 dp:

```
        ,--------.
       /  o    o  \        ← rounded pebble body (wider than tall)
      |     __     |
       \__________/  ~~~~⌒ ← single ribbon tail sweeping out to the lower-right, tapered, with a curl
         ''    ''          ← two tiny foot nubs
```

Signature features, in priority order (keep them when simplifying):

1. Pebble body — a horizontally squashed superellipse, top slightly flatter than bottom (`pebble(50,56,26,24,0.92,1)`).
2. Ribbon tail — attached at (70,66), three tapered segments (9 → 5.5 → 3.2 units) ending in a hook.
   The tail is **always on the right**; mirroring the whole figure for RTL layouts is allowed, flipping the tail alone is not.
3. Eyes — two large round eyes with dark pupils and one highlight each.
4. Limbs — two short arms with round hands, two foot nubs. Never long fingers, never claws.

## 3. Anatomy and proportions (100 × 100 viewBox)

| Part   | Geometry                                                  | Notes                                                                   |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Body   | centre (50, 56), rx 26, ry 24                             | 2.2-unit outline, lower shade crescent, belly ellipse (50, 65) 14 × 9.5 |
| Eyes   | centres (41, 50) and (59, 50), r 6.6 (wide 7.4, soft 6.2) | pupil r 3.3, highlight r 1.1 at (−1.1, −1.2) from pupil                 |
| Brows  | 8 units wide, 9.5 units above eye centre                  | omitted at icon detail level                                            |
| Mouth  | centred (50, 63.5)                                        | see expression vocabulary                                               |
| Cheeks | (35.5, 58) and (64.5, 58), 4 × 2.4, 80 % opacity          | happy/affectionate states only                                          |
| Arms   | shoulders (27, 60) and (73, 60), stroke 4.6, hand r 3.6   | outline pass 7.2                                                        |
| Feet   | (42, 79) and (58, 79), 4.2 × 2.6                          | omitted at icon detail level                                            |
| Tail   | start (70, 66); end ≈ (93, 62 − 24·lift)                  | `lift` ∈ [−1, 1], `curl` ∈ [0, 1]                                       |

Head-to-body ratio: the mascot _is_ its body; there is no separate head. Props float beside the body
(top-right quadrant by default; `lightbulb` top-left, `soundIn` left, `soundOut` right, `headphones` over the body).

Detail levels:

- **full** (≥ 40 dp): everything above.
- **icon** (< 40 dp): drop brows, highlight, foot nubs, cheeks and the smallest confetti/sparkles; thicken
  outlines by 0.4 units. Props stay because they carry meaning (offline, error, hint).

## 4. Expression vocabulary (17 contract states)

Each state is a `MascotPose` (eyes, gaze, brows, mouth, arms, tail lift/curl, tilt, cheeks, prop).
Expressions must read without captions and across cultures — no culture-specific gestures.

| State              | Eyes                             | Mouth               | Arms                | Tail                 | Prop                        | Reads as                           |
| ------------------ | -------------------------------- | ------------------- | ------------------- | -------------------- | --------------------------- | ---------------------------------- |
| `neutral`          | open                             | small smile         | down                | lift 0.1             | —                           | relaxed, available                 |
| `welcome`          | open, raised brows               | grin                | wave (right up)     | lifted 0.6, tilt −4° | sparkles                    | hello                              |
| `happy`            | happy arcs                       | grin + tongue       | out                 | lifted 0.5           | —                           | pleased                            |
| `curious`          | wide, gaze up-right, one brow up | small "o"           | down                | 0.3, tilt −9°        | sparkle                     | interested                         |
| `listening`        | open, gaze left                  | small closed smile  | right hand to "ear" | 0.2, tilt 5°         | incoming sound arcs (left)  | I'm listening to you               |
| `speaking`         | open                             | open mouth + tongue | out                 | −0.1                 | outgoing sound arcs (right) | mascot is talking                  |
| `thinking`         | half-lidded, gaze up-right       | flat line           | hand on chin        | 0, tilt 3°           | thought bubbles             | working on it                      |
| `encouraging`      | wink + raised brows              | grin                | thumbs-up arm       | 0.7                  | sparkles                    | you've got this                    |
| `try_again`        | soft, worried brows              | small smile         | hands clasped       | 0.1, tilt 4°         | replay arrow                | gentle, no shame                   |
| `celebrate`        | happy arcs                       | grin                | both up             | 1.0, curl 1.0        | confetti + stars            | big win                            |
| `achievement`      | wide, raised brows               | grin                | both up             | 0.9                  | star medal with ribbon      | reveal                             |
| `quiet_audio`      | half-lidded                      | small smile         | down                | −0.2                 | headphones over body        | audio/listen mode                  |
| `sleep`            | closed                           | tiny                | tucked              | −0.8, tilt 6°        | ascending z-strokes         | resting                            |
| `offline`          | open, worried brows, gaze down   | flat                | down                | −0.5                 | cloud with slash            | no network (muted palette)         |
| `connection_error` | open, worried, gaze up-right     | wavy                | out                 | −0.3, tilt −3°       | broken chain link + spark   | connection problem (muted palette) |
| `success`          | happy arcs                       | smile               | thumbs-up arm       | 0.6                  | check badge                 | confirmed                          |
| `gentle_hint`      | open, one brow up, gaze up-left  | small smile         | pointing up-left    | 0.3, tilt −5°        | lightbulb with rays         | here's a nudge                     |

Eye shapes: `open`, `wide`, `happy` (upward arc), `closed` (downward arc), `half` (lid covers 45 %),
`soft` (lid covers 20 %). Mouths: `smile`, `small`, `tiny`, `grin`, `open`, `o`, `line`, `wavy`.
Arms: `down`, `up`, `out`, `wave`, `ear`, `chin`, `point`, `clasp`, `thumbs`, `tucked`.

## 5. Palette

Semantic tokens from `MASCOT_PALETTE` in `packages/ui/src/art/palette.ts`. Never hard-code hex in components.

| Token                 | Light                 | Dark                  | Use                         |
| --------------------- | --------------------- | --------------------- | --------------------------- |
| `body`                | `#49C5B1`             | `#5FD6C3`             | body fill                   |
| `bodyShade`           | `#2FA896`             | `#3DB8A4`             | lower crescent, limbs       |
| `belly`               | `#F4FBF8`             | `#E6F7F3`             | belly                       |
| `ribbon`              | `#FF8F6B`             | `#FF9D7C`             | tail                        |
| `ribbonShade`         | `#E5704E`             | `#E87C5A`             | tail shading                |
| `outline`             | `#1E3A3A`             | `#0F1F22`             | all outlines                |
| `pupil` / `mouth`     | `#1E2A33`             | `#0F1A20`             | eyes, mouth                 |
| `cheek`               | `#FFB3A0`             | `#FF9E8A`             | blush                       |
| `accent`              | `#FFC94D`             | `#FFD46A`             | stars, badge, bulb          |
| `danger`              | `#E0565B`             | `#FF7A7E`             | slash, spark (error states) |
| `muted` / `mutedFill` | `#7F8E96` / `#E3E9EC` | `#9AA8B0` / `#2A373C` | offline / error body        |
| `sleepy`              | `#8F9FD6`             | `#A9B6E8`             | z-strokes                   |
| `prop` / `propFill`   | `#1E3A3A` / `#FFFFFF` | `#E8F1F2` / `#1C2B2F` | prop strokes/fills          |

Grayscale check: body (mid), ribbon (lighter), outline (darkest) must stay three distinct values.
Meaning is never carried by colour alone — every state also differs in pose and/or prop.

## 6. Motion

Animations are optional, short and skippable. Static equivalents exist for every state (the exports).

| Clip (`MascotAnimation`) | What it is                                                 | Duration           |
| ------------------------ | ---------------------------------------------------------- | ------------------ |
| `idle` / `blink`         | breathing (±2 % x / ∓1.5 % y scale) and a blink every ~4 s | continuous, subtle |
| `reaction`               | small bounce + tail lift when a learner turn is received   | ≤ 400 ms           |
| `anticipation`           | lean forward, eyes wide before the learner speaks          | ≤ 600 ms           |
| `celebrate_bounce`       | two bounces with confetti                                  | ≤ 1.2 s            |
| `achievement_reveal`     | star medal scales in                                       | ≤ 900 ms           |
| `thinking`               | thought bubbles pulse                                      | loop while waiting |
| `error_recovery`         | shake → neutral settle                                     | ≤ 700 ms           |

Rules: `reducedMotion` disables **everything** (including the idle loop); "mascot off" removes the mascot
entirely and the flow still works (spec A33). Animations never block recording or playback, and no more than
one animated mascot instance per screen (none inside list items).

The in-code renderer exposes `blink` (0..1) and `breath` (−1..1) phases; `MascotSvg` runs the idle loop only
when `animate` is true and `reducedMotion` is false.

## 7. Size variants

| Variant   | Size       | Detail | Typical use                        |
| --------- | ---------- | ------ | ---------------------------------- |
| icon      | 24–40 dp   | icon   | tab badges, inline status          |
| companion | 64–96 dp   | full   | lesson header, speak screen corner |
| medium    | 160–240 dp | full   | onboarding hero, empty states      |
| large     | ≥ 320 dp   | full   | full-screen celebration            |

Never scale below 20 dp. Keep ≥ 8 dp clear space around the figure (the tail and props extend beyond the body).

## 8. Allowed gestures and do-not rules

Allowed: wave, thumbs up, hand to ear, hand on chin, pointing at a hint, both arms up, clasped hands, tucked arms.

Do not:

- add a beak, wings, feathers, ears, fur, teeth, fangs or a visible neck;
- draw a second tail, mirror only the tail, or detach the tail from the lower-right of the body;
- dress the mascot in national, religious or ethnic costume, uniforms, or flags;
- bake any text, numerals or logos into the artwork (`<title>` is the only text, for assistive tech);
- use it to show a score, a waveform, a timer, or anything implying it is listening when no audio is being captured;
- show it crying, angry, mocking, or disappointed; the sad-adjacent states are `try_again` (soft) and the
  two network states (muted, concerned);
- pair it with paywall/credit/subscription copy — none exists in this product;
- place it over the central overlay zone of a scene during a live conversation.

## 9. Branding usage

- The mascot is the product's visual guide, not the logo. Use the `neutral` or `welcome` state in marketing.
- Light palette on light backgrounds, dark palette on dark backgrounds; never place the light-palette export on `#000`.
- Minimum contrast: outline vs background ≥ 3:1.

## 10. Asset naming

| Asset        | Path (under `assets/`)                                        |
| ------------ | ------------------------------------------------------------- |
| state, light | `mascot/<state>.svg` (`neutral`, `welcome`, …, `gentle_hint`) |
| state, dark  | `mascot/dark/<state>.svg`                                     |
| manifest     | `art-manifest.json` (`ART_MANIFEST` from `@langquest/ui`)     |

Regenerate with `pnpm --filter @langquest/ui export-art` (pure Node; writes 281 files for the full art set).
Source geometry: `packages/ui/src/art/mascot.ts` (`MASCOT_POSES` is the model sheet in data form).
DB linkage: `MascotAssetPackSchema` (`@langquest/contracts`) maps states/animations to `visual_assets` rows.

## 11. Accessibility labels

`MASCOT_ACCESSIBILITY_LABELS` (English source) → i18n keys `mascot.state.<state>` in `@langquest/locales`.

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

Every `MascotSvg` instance is `accessible` with `accessibilityRole="image"`; decorative repeats of the same
state on one screen should pass `accessibilityLabel=""` only when a neighbouring text carries the meaning.

## 12. Provenance

Original work created in code for LangQuest; no traced, licensed or AI-generated source. Content origin for
the `visual_assets` rows is `in_code_vector`. No fonts are embedded.

---

### Appendix — sibling asset families (same style version)

- **Characters** (`assets/characters/<id>/<expression>.svg`): 16 original roster characters, parametric
  portraits, 9 expressions each, contemporary clothing, no real-person likeness. Each is bound to one
  variety (`CHARACTER_ROSTER[].varietyId`) and `reviewStatus: review_needed` until native review.
- **Scenes** (`assets/scenes/<id>.svg`, `-evening`, `dark/`): 12 layered 16:9 environments with a clear
  centre band (x 48–112 of 160) for overlays; alt text in `SCENES[].altText`.
- **Covers** (`assets/covers/<trackId>.svg`): 30 abstract palette + motif covers; the UI renders the name.
- **Icons** (`assets/icons/<name>.svg`): 37 stroke icons on a 24 grid.
