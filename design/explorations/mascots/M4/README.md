# M4 — "Nimbo", the cloud-blob traveller

Mascot exploration **M4** for LangQuest. Original vector work, drawn in code for this exploration; no traced,
licensed, stock or AI-generated source, no CC0 packs used anywhere in this folder. Status: concept for owner
review, not production. Nothing outside `design/explorations/mascots/M4/` was touched.

## Name proposal

**Nimbo** (from *nimbus*). Two syllables, pronounceable in all 30 course languages, no clash with the
provisional orbit-creature name. Alternates if "Nimbo" is unavailable: **Cumulo** or **Wisp**. "Puff" was
considered and rejected as too generic. The name is a working label only and is never baked into artwork.

## Concept and personality (≤120 words)

A small cloud that got curious about the ground and walked down to meet people. Nimbo is a *traveller*:
the hand-knitted scarf, trailing behind like a tail, says it has been somewhere cold and is on its way
somewhere warm. It is soft, patient and a little shy, which suits a guide for nervous speakers: it never
towers over the learner, it hovers at their shoulder. Its feelings show in its weather. A puff rises to
wave hello, bulges into an ear cup to listen, floats off as little speech-puffs when it talks, flattens
and lets one raindrop fall when a try does not land, and lets the sun peek out from behind it when the
learner succeeds. Plush-toy proportions: no neck, no arms, stubby legs in matching knitted boots.

## Why it is genuinely different from the baseline

| | Baseline orbit-creature | M4 Nimbo |
| --- | --- | --- |
| Body | hovering teal pebble, limbs | grounded white cloud on stubby legs |
| Signature | asymmetric orange ribbon tail | knitted red scarf band + trailing scarf end |
| Emotion channel | arms, brows, props | the cloud puffs themselves reshape (rain, sun, speech-puffs) |
| Material feel | glossy vector | matte plush / felt, knit texture |
| Palette family | teal / orange | lavender-white / cranberry / cream |

## Silhouette and anatomy

- 100-unit model space. Body is a union of three puffs (left, top, right) on a rounded base, 54 wide × 46
  tall, wider than tall. No separate head: the face sits on the body.
- Eyes: solid dark beads 3.5 × 4.1 with a single highlight, 18 units apart on the 44 line.
- Scarf band at 57–64.5 with chevron knit stitches; scarf end exits on the **right** and acts as the
  expressive tail (`lift` −1…1). Mirror the whole figure for RTL, never the scarf alone.
- Two cloud-stub legs with knitted boots in the scarf colour (same red, same stitch), so the figure has
  exactly two accent elements that read as one material.
- Outline 2.4 units everywhere (≈ 6 px at 256 px); props 1.6–2.2. Grayscale ladder: knit > body > shade >
  scarf > outline, verified on the model sheet's desaturated row.

## State vocabulary (all in `states/`, 256 × 256, transparent)

| State | How it reads without a caption |
| --- | --- |
| `neutral` | relaxed small smile, scarf resting |
| `welcome` | a puff rises and waves, grin, sparkles, scarf lifted |
| `listening` | left puff bulges into an ear cup, eyes turn to the incoming sound arcs |
| `speaking` | open "ah" mouth, three speech-puffs drift up and away |
| `thinking` | top puff shifts, eyes up at a thought-cloud with three dots |
| `celebrate` | sun peeks from behind the cloud, happy eyes, scarf flying, confetti, bounce |
| `try_again` | puffs flatten a little, worried brows but still smiling, one raindrop, scarf droops |
| `offline` | muted palette, scarf pulled up over the mouth (cold), signal arcs crossed out |

The spec's full 17-state contract (happy, curious, encouraging, achievement, quiet_audio, sleep,
connection_error, success, gentle_hint) maps onto the same kit: sleep = puffs sag + eyes closed + scarf
wrapped; quiet_audio = scarf band lifted over the ear puffs like ear-muffs; success = sun peek without
confetti; gentle_hint = one puff lifts a small sparkle; connection_error = two half-clouds drifting apart.

## Strengths

- Instantly readable silhouette at 24 px: a bumpy top, a dark band, two feet, a tail. Verified in
  `icon-24.svg` and on the model sheet at 24 / 40 / 64 px and in grayscale.
- Emotion is carried by shape (rain, sun, speech-puffs), not by colour, so it passes the "never encode
  meaning by colour alone" rule and reads across cultures: weather metaphors are near-universal.
- Weather states give animators cheap, charming motion (puffs morphing, a drop falling, a sun rising) that
  does not need limbs or complex rigging.
- Plush, low-contrast body stays calm on busy scene art and in dark mode; the single red accent (scarf +
  boots) keeps it recognisable at a glance.
- Zero resemblance to owls, birds, or any language-app mascot; no face-on-a-flag, no costume.

## Risks

- **Crowded category.** Cute cloud characters exist in stickers and weather apps; distinctiveness rests on
  the *knitted scarf + boots + weather-as-emotion* combination. A trademark search on the final design
  is needed before launch.
- **Rain can read as sadness.** `try_again` must keep the soft smile and a single drop; two or more drops or
  a flat mouth tips into "crying", which the spec forbids. Keep the rule in the style guide.
- **Low contrast body on white screens.** The lavender-white body relies on its outline; on pure white
  surfaces it must keep the 2.4-unit outline and should sit on a tinted card or soft shadow.
- **Scarf is a cold-weather cue.** For tropical course settings it is still fine as a traveller's garment,
  but the scarf should never gain national patterns, team colours or lettering.
- **No arms.** Pointing at UI (gentle_hint) must be done with a lifted puff or a scarf-end flick; this is a
  deliberate limitation and should be tested with real hint placements.

## How it scales

| Size | Treatment |
| --- | --- |
| 24–40 dp icon | `icon-24.svg`: single cloud path, band, short tail, two boots, two dot eyes; outline 1.3/24 |
| 64–96 dp companion | full states with stitches dropped below 48 dp (the band becomes a plain red band) |
| 160–240 dp hero | full states as drawn |
| ≥ 320 dp celebration | full states plus larger confetti field; sun may rise further behind the cloud |

Dark theme: `dark-variant.svg` swaps the token set (lighter body, mid-indigo outline `#6E66AE` ≥ 3:1
against `#17152B`); the red and cream stay warm. Offline/error use the muted token set in `palette.svg`.

## Animation ideas (Rive / Lottie)

- **idle** — the three puffs breathe out of phase (±2 % scale, 3.2 s loop); the scarf end sways ±4° at
  the fringe; the body bobs 1 unit. Legs stay planted so the figure feels grounded.
- **blink** — both bead eyes squash to a line for 90 ms every 3–5 s; occasionally one eye only (a wink)
  when the state is `welcome` or `celebrate`.
- **react** (learner turn received) — a quick 200 ms puff-up of the left ear puff, eyes track toward the
  mic, scarf lifts 0.2; settles back in 300 ms. Never loops; never implies audio when none is captured.
- **celebrate** — anticipation squash (120 ms), two bounces (the boots leave the ground), the sun slides
  up from behind the top puff with rays rotating 10°, scarf whips to `lift 1`, confetti bursts outward
  and fades; total ≤ 1.2 s, then returns to `neutral`.
- **try_again** — top puff flattens, a single drop forms at the lower-left and falls with a tiny bounce,
  scarf drifts down; ≤ 700 ms and ends on the soft smile (no loop).
- **thinking** — thought dots pulse in sequence while waiting; the top puff rocks 2°.
- **speaking** — mouth cycles between `talk` and `small`; speech-puffs emit every 400 ms and dissolve.
- **offline** — scarf band rises over the mouth (300 ms), signal arcs draw in and the slash wipes across.

All clips have static equivalents (these SVGs), respect reduced-motion, and never block speak/listen.

## Files

```
design/explorations/mascots/M4/
├── README.md              this document
├── model-sheet.svg        front, three-quarter, side views + proportions, scale and grayscale checks, expression kit (1280 × 700)
├── icon-24.svg            simplified silhouette-safe icon (24 × 24)
├── dark-variant.svg       neutral state on the dark token set with a #17152B backdrop (256 × 256)
├── palette.svg            light / dark / muted swatches with hex values (760 × 736)
└── states/
    ├── neutral.svg        256 × 256, transparent
    ├── welcome.svg
    ├── listening.svg
    ├── speaking.svg
    ├── thinking.svg
    ├── celebrate.svg
    ├── try_again.svg
    └── offline.svg
```

Every SVG is standalone XML (`xmlns`, `viewBox`), self-contained (no external references, no fonts
embedded; the two sheets use `system-ui` for annotations only), and under 70 KB. State and icon files contain
no text other than the accessible `<title>`.

## Provenance

Original work created for this exploration. Geometry was authored procedurally so every state shares one
anatomy; the generator is a throwaway script and is not part of the repository. No third-party assets.
