# M2 — "Glim", the lantern-spirit

Exploration code: **M2**. Status: concept for owner approval, not production art.
Everything in this folder is original vector work drawn in code for LangQuest. No traced, stock, CC0 or
AI-generated sources were used; no fonts are embedded (the model sheet and palette use `system-ui` for
documentation labels only; production state artwork carries no text).

## Name proposal

**Glim** (working name). An old English word for a small light or candle; short, pronounceable in French and
English, no trademark intent. Alternates: **Fanal** (French, a ship's lantern), **Lumo**.

## Personality (≤120 words)

Glim is a small floating lantern-spirit. Its body is a translucent shell with a drop of warm light inside;
the light is its mood. It brightens when something is understood, dims to an ember while it thinks, and goes
out only when the network does. Two soft petal-fins are its ears: at rest they sit sideways, they perk
straight up when it is listening, droop gently when it invites another try, and fold flat when it is offline.
A tiny spark always trails from its base toward the lower-left, a quiet reminder that it is moving with you.
Glim is attentive, warm, patient and a little dreamy. It never judges, never scores, never guilts; it simply
lights up when you speak.

## Why it is genuinely different from the baseline

| Baseline orbit-creature (teal, ribbon tail) | M2 lantern-spirit |
| --- | --- |
| Opaque pebble body, limbs, gestures carry meaning | Translucent shell, **no limbs**; meaning carried by light level, fin angle and the spark |
| Cool teal + orange accent | Warm luminous apricot/amber + cool teal reserved for props |
| Tail on the lower-right | Spark trail from the base to the lower-left; lantern rim and crown loop give the silhouette |
| Emotion = pose + prop | Emotion = **light** (off / dim / rest / bright / blaze) + fin-ears + face |

## Anatomy (256 × 256 state canvas)

- Shell: 132 w × 146 h rounded lantern body, 5-unit outline, 78 % fill opacity with a glass highlight.
- Crown: small cap (28 × 14) and a loop ring (r 7). Base: rim bar 64 × 18 in the fin-shade colour.
- Light drop: 50 × 68 teardrop at 0.67 h, radial gradient; five light levels (see model sheet).
- Fin-ears: 60-unit rounded petals rooted at 0.43 h; rotation range −48° (folded) to +74° (perked).
- Eyes: r 12, 40 apart, at 0.43 h; shapes open / wide / soft / half / happy / closed.
- Line weights: outline 5, fins 4.5, face 4, props 5. Nothing thinner than 2.2 units at 256.

## State vocabulary (readable without captions)

| State | Light | Fins | Face | Extra |
| --- | --- | --- | --- | --- |
| neutral | rest | sideways | open eyes, smile | spark |
| welcome | bright | up, 34–40° | raised brows, grin, cheeks | sparkles, double spark, short rays |
| listening | rest | **perked 58–66°, larger**, lean toward sound | gaze toward sound, closed small smile | incoming teal arcs (left) |
| speaking | bright | attentive 22° | open mouth | outgoing teal arcs (right), rays |
| thinking | dim + drifting embers | one up, one down | half-lidded, gaze up-right, one brow, flat mouth | thought bubbles (top-right) |
| celebrate | blaze | fully up 74° | happy arcs, grin, cheeks | 12 rays, confetti, bounce (−10 y) |
| try_again | rest | drooped −18/−22° | soft eyes, worried brows, small smile | replay arrow; **spark loops back on itself** |
| offline | off (grey ember) | folded −48° | gaze down, flat mouth | muted palette, no-signal arcs with slash, spark falls as a grey speck |

Grayscale check (verified with rendered grey PNGs): outline (darkest) → fins/rim (mid) → shell (light) →
light drop (lightest centre) remain four distinct values; the fin angle and spark shape change per state, so no
state relies on colour alone.

## Strengths

- A strong, ownable metaphor for the product: **light = understanding**. The core level maps directly to
  real product states (thinking/fetching = dim, success = bright) without faking evaluation.
- The fins are an honest "I am listening" signal and look nothing like an owl, a bird or any existing mascot.
- Silhouette survives 24 px: rim + crown loop + two petals + spark are all ≥ 1.5 px at that size.
- Dark mode is where it shines: the glow does real work on dark backgrounds (`dark-variant.svg`).
- No limbs means far fewer rig bones; most animation is scale/opacity/rotation, cheap on low-end Android.

## Risks

- A rounded shell with a warm core can drift toward "egg" or "light bulb" if the rim, cap and loop are
  dropped; keep all three in every variant (the first draft without them read as a fried egg).
- The light drop sits under the eyes; if it is raised it starts to read as a nose. Keep its tip below the eye line.
- Fewer gestures than a limbed mascot: pointing at a hint or a thumbs-up must be expressed with tilt, fins
  and props instead. `gentle_hint`, `encouraging` and `achievement` need a prop vocabulary (bulb, check,
  medal) to be designed before adopting.
- Warm palette is close to "sunset/holiday" tones; the UI should keep neutrals cool so the mascot stays the
  warmest thing on screen.
- The translucency uses opacity; on very busy scene art the body can lose contrast. Place over a soft plate or
  use the dark-variant halo.

## How it scales

| Size | Treatment |
| --- | --- |
| 24–40 dp | `icon-24.svg`: no gradient, eyes as dots, no highlight, fins and spark enlarged |
| 64–96 dp | state files as-is; brows and embers already ≥ 2 px |
| 160+ dp | state files; add idle glow pulse |
| RTL | mirror the whole figure (spark then trails lower-right); never mirror only the fins |

## Animation ideas (Rive / Lottie)

- **idle**: the light drop breathes (scale 0.96–1.04, 3.2 s ease-in-out) with the halo opacity following; the
  spark drifts ±2 px; the whole body floats ±3 px on a slower 5 s cycle. Reduced motion: static.
- **blink**: both eyes close for 90 ms every 3–6 s; one fin flicks 6° on every third blink.
- **react (learner turn received)**: fins snap up to 60° in 120 ms then settle to 30° over 300 ms; light steps
  rest → bright for 400 ms; a small ring pulses outward from the shell once. ≤ 500 ms.
- **thinking loop**: light dims to 1, three embers drift upward inside the shell on a 1.6 s loop; one fin
  rocks slowly. Stops the instant a result arrives.
- **celebrate**: light goes to blaze, 12 rays scale from 0 to 1 with a 40 ms stagger, two bounces (−10 px,
  −5 px), confetti falls 600 ms, spark splits into two. Total ≤ 1.2 s, skippable.
- **try_again**: fins droop over 200 ms, the spark trail curls into its loop and the loop rotates once (the
  "let's go round again" cue), light stays at rest so nothing reads as failure.
- **offline / recovery**: light fades to the grey ember over 300 ms and fins fold; on reconnect the ember
  re-ignites from the centre outward (200 ms) before the fins rise.

All clips are optional, never block recording or playback, and have a static equivalent in `states/`.

## File list

```
design/explorations/mascots/M2/
├── README.md
├── model-sheet.svg        1200×760, front / three-quarter / side / proportions, fin and light vocabularies
├── icon-24.svg            24×24 silhouette-safe icon
├── dark-variant.svg       neutral state on the dark palette (with dark plate)
├── palette.svg            swatches with hex values, light + dark differences
└── states/
    ├── neutral.svg        256×256, transparent
    ├── welcome.svg
    ├── listening.svg
    ├── speaking.svg
    ├── thinking.svg
    ├── celebrate.svg
    ├── try_again.svg
    └── offline.svg
```

All SVGs are standalone (xmlns + viewBox, gradients and clip paths inline, no external references) and under
25 KB each. Generated from a single parametric script so geometry and line weights are identical across states.
