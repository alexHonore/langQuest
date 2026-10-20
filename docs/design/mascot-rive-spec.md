# Melo — Rive state machine and rig specification

Status: v1 for the production mascot (style version `langquest-art-v1`, mascot M3 "Melo").
Companion to `docs/mascot-style-guide.md`. The rig is built from the layered master
`assets/mascot/master-rive.svg`, which is generated from the same code that renders the mascot in
the app (`packages/ui/src/art/mascot.ts` → `mascotMasterSvgString()`), so the rig, the static exports,
the Lottie clips and the React Native renderer never drift apart.

The Rive file is an **optional enhancement**. Every state has a static export (`assets/mascot/<state>.svg`)
and the app must keep working with the static art alone (spec A33, `reducedMotion`, "mascot off").

---

## 1. Inputs (state machine "Melo")

| Input            | Type          | Range / values                                                         | Driven by                                                    |
| ---------------- | ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `state`          | number (enum) | index into `MASCOT_STATE_VALUES` (0 = neutral … 16 = gentle_hint)      | the screen's real mascot state (never a guess)               |
| `blink`          | trigger       | —                                                                      | app timer (every ~4 s while idle) or a learner-turn event    |
| `breath`         | number        | −1..1                                                                  | app timer (4 s sine) or left to the idle animation           |
| `listeningLevel` | number        | 0..1                                                                   | audio engine **input** activity (0 when the mic is closed)   |
| `speakingLevel`  | number        | 0..1                                                                   | audio engine **output** activity (0 when nothing is playing) |
| `courseFamily`   | number (enum) | index into `COURSE_FAMILY_IDS` (0 = germanic … 6 = african), −1 = none | the enrolment's course track (`courseFamilyTint(trackId)`)   |
| `reducedMotion`  | boolean       | —                                                                      | OS / app preference; freezes every timeline on its first key |

Honesty rules: `listeningLevel` and `speakingLevel` are the only inputs that may make the mascot look
like it hears or talks, and they must come from the audio engine's real activity. The state machine never
infers them from `state`. No input encodes a score.

## 2. Layers (states of the machine)

One layer per concern so they blend instead of fighting:

1. **Pose** — a blend-state keyed by `state`: each of the 17 poses is an animation holding the pose
   values (eye gaze L/R, lids L/R, eye scale L/R, mouth shape index, arm shape index, tail curl, tilt,
   cheeks, prop index). Transitions: 160 ms cross-blend; to/from `sleep`, `offline`, `connection_error`
   240 ms; `celebrate` / `achievement` enter through the **Reaction** layer first.
2. **Breath** — looping 4 s scale 1.02 / 0.985 about the ground pivot (50, 88); tail curl ±2.5 ° out of
   phase. Paused when `state` ∈ {offline, connection_error} (slower 6 s loop) and when `reducedMotion`.
3. **Blink** — `blink` trigger plays `lidL` then `lidR` 60 ms apart: close 70 ms, hold 40 ms, open 110 ms.
   Every 5th blink plays only one eye. Lids start from the pose's rest closure (0 / 0.2 / 0.45).
4. **Scan** — every ~7 s one eye drifts 2 units (gaze +0.6) for 1 s and snaps back. Disabled while
   `listeningLevel > 0` (both eyes stay on the learner) and in `sleep`.
5. **Reaction** — one-shots: `reaction` (eyes converge to the mic point, squash 0.96 y, tail lifts 10 u,
   ≤ 400 ms), `celebrate_bounce` (anticipation crouch 90 ms → two ease-out bounces → confetti burst from
   the crest, ≤ 1.2 s, skippable), `achievement_reveal` (medal scales in 0 → 1.1 → 1, ≤ 900 ms),
   `error_recovery` (3-frame ±2 u shake → settle into `try_again`, ≤ 700 ms).
6. **Audio** — `listeningLevel` scales the incoming sound arcs (prop `soundIn`) 0.8 → 1.1 and nudges
   both pupils toward the mic point by `0.4 × level`; `speakingLevel` opens the mouth (`open` shape
   scale 0.85 → 1.1) and scales the outgoing arcs. At 0 both are at rest, so the mascot never looks
   like it is listening or speaking when nothing is happening.
7. **Colour** — `courseFamily` and `state` drive the body tint (see §4). Rive solo colour tracks on
   `body`, `bodyShade`, `belly` only; crest, outline, eyes and props are never animated in colour.

## 3. Bones and shapes (mapped to `MASCOT_PART_IDS`)

The master SVG has one `<g id="…">` per part in paint order; import it into Rive, then rig as follows.

| Part id (`<g id>`)           | Rive object                         | Bones / notes                                                                                                                                                                               |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tail`                       | shape bound to **tail chain**       | 6-bone chain from the attach point (73, 77). Spiral curl is a procedural weight on bones 3–6 (`tailCurl` 0..1 = pose curl × bone rotation); gestures rotate bone 1 (wave ±16 °, lift −14 °) |
| `crest`                      | shape, child of **head**            | static; confetti burst emitter origin at (50, 10)                                                                                                                                           |
| `feet`                       | shape, child of **root**            | planted; never scales with breath (breath pivot is the ground)                                                                                                                              |
| `body`                       | shape, child of **body root**       | breath scale, tilt rotation about (50, 60)                                                                                                                                                  |
| `bands`                      | shape, child of **body root**       | static (brand anchor), crest colour                                                                                                                                                         |
| `armL` / `armR`              | 2-segment bones + mitten shape      | shoulder (26, 63) / (74, 63); arm _poses_ are shape swaps from `library-arms` (ids `armL-<pose>`, `armR-<pose>`), eased 160 ms by solo switch + bone blend                                  |
| `cheeks`                     | shape, child of body root           | opacity 0/0.8 per pose                                                                                                                                                                      |
| `mouth`                      | solo group                          | shape swap from `library-mouths` (`mouth-<kind>`); `speakingLevel` scales `mouth-open`                                                                                                      |
| `turretL` / `turretR`        | shape, child of **turret L/R bone** | eye scale per pose (1 / 1.06 / 1.08 / 1.1); turret bones at (33, 42) and (67, 42)                                                                                                           |
| `pupilL` / `pupilR`          | shape, child of turret bone         | translate ±3.2 u × gaze; highlight travels with the pupil                                                                                                                                   |
| `lidL` / `lidR`              | shape, child of turret bone         | full disc at opacity 0 in the master; rig as **vertical scale from the eye top** (0 → 1 = open → shut), exactly as the Lottie clips do                                                      |
| `propsBehind` / `propsFront` | solo group                          | one child per prop from `library-props` (`prop-<kind>`); `prop-headphones` has band (behind) + cups (front)                                                                                 |

Root hierarchy: `root` (canvas scale) → `figure` (tilt pivot 50, 60) → `breath` (scale pivot 50, 88) →
body root, turrets, arms, tail chain. Props live under `root`, not under `figure`, so they never tilt.

## 4. Chameleon colour in Rive

Rive cannot evaluate `mascotTint()`; bake the table instead:

- Export `mascotTintTable(theme, trackId)` for each course family (`COURSE_FAMILY_IDS`) and theme →
  7 × 2 × 17 body/bodyShade/belly triples (`packages/ui` → `mascotTintTable`).
- In Rive, create one colour keyframe set per `(theme, courseFamily)` on the **Colour** layer; `state`
  selects the keyframe, transitions are 240 ms colour tweens.
- Offline / connection_error use the muted triple **and** swap `bands` to the muted crest colour.
- Never animate `outline`, `pupil`, `eyeWhite`, `crest` (other than muted), or props.

Rule from the style guide: hue is mood, not evaluation. `success`/`celebrate` must read from pose + prop
with the colour track disabled.

## 5. Export instructions

1. Regenerate the master: `pnpm --filter @langquest/ui export-art -- --only mascot` writes
   `assets/mascot/master-rive.svg` (512 px, viewBox 0 0 100 100, light palette) with the ids above.
   For a dark-palette reference, call `mascotMasterSvgString('dark')` from a script; colours are
   re-applied from the baked tint table in Rive anyway.
2. In Rive: _File → Import_ the SVG. Keep "Preserve groups" on so each `<g id>` becomes a named group.
   Delete nothing; set `library-*` groups to hidden solos.
3. Rig bones per §3; name the state machine `Melo`; name inputs exactly as in §1.
4. Verify against the Lottie clips in `assets/mascot/lottie/` (`idle`, `reaction`, `celebrate_bounce`,
   `thinking`): same timings, same pivots. The `*.frame0.svg` next to each clip is the pose at frame 0.
5. Export `melo.riv` to `assets/mascot/rive/` (not committed yet) and register it in the mascot asset pack
   (`MascotAssetPackSchema.animations`) with `static alternatives` = the state SVGs.
6. Accessibility: the Rive view gets the same `accessibilityLabel` as `MascotSvg`
   (`mascotLabelKey(state)`), and is replaced by `MascotSvg` when `reducedMotion` is on.

## 6. Acceptance

- Each of the 17 `state` values shows the matching pose within 240 ms of input change.
- `blink`, `reaction`, `celebrate_bounce`, `thinking` match the Lottie clips frame-for-frame at 30 fps
  (±1 frame).
- With `listeningLevel = speakingLevel = 0` nothing suggests audio activity.
- Setting `reducedMotion` freezes all layers on their first keyframe (static pose).
- Colour track off: every state still distinguishable in grayscale.
