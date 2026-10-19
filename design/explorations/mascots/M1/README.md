# M1 — refined orbit-creature (baseline option)

**Concept name:** *Ollo* (proposal). It echoes greetings across the course catalogue — hello, hola, olá, allô, hallo — without being any one of them, it is two syllables in every script, and it has no beak-and-wing baggage. Alternates if the trademark search fails: *Tilo*, *Kiwo*. All are working names only: no name is baked into any artwork, and UI copy keeps using localized `mascot.*` keys.

## Personality (≤120 words)

Ollo is a small floating companion with a comet's tail: it is always *just arriving* next to you. It is curious before it is clever, so it listens with its whole body (lean, hand to ear, eyes on you) and reacts to what you actually said rather than to a score. It cheers effort loudly and briefly, then gets out of the way of the conversation. It is never embarrassed on your behalf: a wrong turn gets a soft look and a "go again" arrow, never a sigh. Off the network it does not sulk, it just goes quiet and grey. Witty by posture and timing, not by text.

## Rationale — what "its best version" means here

The baseline silhouette (rounded floating body, two big eyes, tiny limbs, one asymmetric ribbon tail on the right) is kept exactly so that anything already built around it still fits. Everything *inside* that silhouette was pushed:

| Area | Baseline | M1 |
| --- | --- | --- |
| Line weight | mixed 1.6 / 1.8 / 2.2 / 7.2 strokes | two weights only: **2.6 silhouette**, **2.0 interior** (100-unit space) |
| Ribbon tail | three stroked tube segments with a hook | a **filled, twisted, tapering ribbon**: top face coral, one visible twist at 55 % of its length, lighter underside, pointed curl. Reads as cloth/comet wake rather than a worm |
| Eyes | round, pupil + one highlight | **taller ovals (15 × 16.4)**, iris ring + pupil + two highlights; six lid shapes (`open · wide · happy · half · soft · closed`) drawn analytically (no clip paths) |
| Brows | one arc | five shapes (`relaxed · raised · one-up · worried · low`), worried = inner ends up (concern, never anger) |
| Mouths | smile / grin / o / line | eight (`smile · small · tiny · grin + tongue · open + tongue · o · line · wavy`) |
| Body | symmetric pebble | pebble whose top is 16 % flatter than the bottom and **leans 1.4 units away from the tail**, which gives a sense of travel even when static; soft top-left highlight, lower shade crescent, belly |
| Grounding | none | a faint **hover shadow** under the body so it reads as floating, not pasted |
| Hands | mitten circles | same mittens, but every arm pose now has a dedicated gesture (`down · up · out · wave · ear · chin · clasp · tucked · point · thumbs`) |
| Props | — | redrawn on the 2.0 weight with a shared accent colour, placed off the body so the face stays clear |

Each of the eight required states differs in *at least three* channels (eyes, brows, mouth, arms, tail lift/curl, tilt, prop), so no state depends on colour or captions.

## Strengths

- **Continuity.** Same silhouette, same tail-on-the-right rule, same 17-state vocabulary as the existing style guide; it can replace `packages/ui/src/art/mascot.ts` output without changing any layout or contract.
- **Reads at every size.** The 24 px icon keeps body, eyes and an orange ribbon; the 40 px full state still shows pose and prop; grayscale keeps four distinct values (outline 0.03 → body 0.38 → ribbon 0.47 → belly 0.95 relative luminance, see `palette.svg`).
- **Expression range without new anatomy.** Six lids × five brows × eight mouths × ten arms × continuous tail lift/curl × tilt covers the full contract list and leaves room for story moments.
- **Clean for motion.** Every part is a separate shape with a stable pivot (body centre 50,55; tail root 71,62; shoulders 25/75,61), so Rive bones or Lottie layers map one-to-one.
- **Fully original and reproducible.** Pure vector, generated from pose data in `generate.js`; no traced, licensed, CC0 or AI-generated source, no embedded fonts.

## Risks

- **Familiarity.** A teal blob with big eyes is a crowded genre; the ribbon tail is the only strong differentiator, so it must stay visible in every crop (keep ≥ 8 dp clear space on the right, mirror the whole figure for RTL, never crop the tail).
- **Teal + coral is close to several consumer-app palettes.** It is not a trade-dress copy of anything, but if the owner wants more distance, body hue is the one knob that changes everything (the generator takes a palette object).
- **Hover shadow on busy backgrounds.** The shadow is 13 % opacity; drop it over scene art (the generator has `noShadow`).
- **Tail at full lift (celebrate) grows the bounding box upward** by ~30 units; layouts that reserve a square must allow for it or use `lift ≤ 0.6`.
- Muted (offline) ribbon loses the warm accent on purpose; if a product decision prefers colour in error states, use `mutedRibbon` tokens closer to the coral.

## How it scales

| Size | What is kept |
| --- | --- |
| 24 dp (`icon-24.svg`) | body, two eyes (no iris ring, no brows), mouth, one filled ribbon; 1 px strokes on a 24 grid |
| 40–64 dp | full figure; props stay because they carry meaning |
| 96–240 dp | full figure with highlights, iris rings, both eye highlights |
| ≥ 320 dp | same shapes, nothing extra needed (no texture, no gradients) |

Dark mode swaps tokens only (`dark-variant.svg`): a lighter body, a darker outline for ≥ 3:1 contrast on `#0F1D21`, inverted prop fill/stroke.

## Animation ideas (Rive / Lottie)

| Clip | What moves | Timing |
| --- | --- | --- |
| **idle** | body breathes (scale ±2 % x, ∓1.5 % y about 50,55); tail ribbon runs a slow sine along its length (lift ±0.08) so the twist travels; hover shadow scales inversely with body height; feet stay put | 2.4 s loop, ease-in-out |
| **blink** | eyelid (the analytic lid path) sweeps `open → closed → open`; every 3–5 s randomized; occasional double blink; brows dip 0.5 unit | 120 ms down, 160 ms up |
| **react** (learner turn received) | tail lift 0.15 → 0.7 → 0.25 with overshoot; body squashes 4 % then stretches; eyes `open → wide → open`; gaze snaps toward the mic/left; small bounce on the hover shadow | ≤ 400 ms |
| **celebrate** | two bounces (y −8 then −5 units), arms `down → up` with 1-frame anticipation, tail to lift 1 / curl 1 with a whip, mouth `smile → grin`, confetti spawns from behind the body and falls with drag; cheeks fade in | ≤ 1.2 s, then settle to `happy` |
| thinking | thought bubbles pulse in sequence, gaze drifts up-right, one brow eases up | loop while waiting |
| try_again | replay arrow rotates one turn, hands clasp, brows go `worried → relaxed` as the arrow finishes (the recovery *is* the message) | ≤ 700 ms |
| offline | tail droops to −0.55 on a long ease, palette crossfades to muted, cloud-slash fades in last | ≤ 900 ms |

Rules carried over: `reducedMotion` disables everything including idle; never more than one animated instance per screen; static exports exist for every state; animation never blocks mic or playback.

## Palette (light)

body `#35B8A5` · bodyShade `#1F9484` · bodyLight `#9BE8DA` · belly `#F2FBF8` · ribbon `#FF9E72` · ribbonUnder `#FFC6A8` · ribbonShade `#D9623A` · outline `#1B3338` · iris `#2A5A63` · pupil/mouth `#121E24` · tongue `#FF8D8D` · cheek `#FFB4A2` · accent `#FFC94D` · danger `#E0565B` · muted `#8A979E` / `#DEE5E8` / ribbon `#B9C3C8`. Dark values and the grayscale ladder are in `palette.svg`.

## Provenance and rules check

- Original vector work drawn in code for LangQuest. No CC0 / Open Peeps / Open Doodles / unDraw assets were used anywhere in this folder. No AI image generation. No fonts embedded; the two reference sheets use the system font stack (`-apple-system, Segoe UI, Roboto, Helvetica, Arial`).
- No text in any production state or the icon (only `<title>` for assistive tech). Text appears only on `model-sheet.svg` and `palette.svg`, which are reference sheets.
- No owl/bird/animal features, no flags, no costume, no real-person likeness. Tail always on the right.
- Every SVG is standalone XML with `xmlns` and `viewBox`, has no external references (`href`, `url()`), and is under 150 KB.

## File list

```
design/explorations/mascots/M1/
├── README.md
├── generate.js            editable master: pose data + renderer, `node generate.js` rewrites every SVG below
├── model-sheet.svg        front / three-quarter / side, proportions, eye-brow-mouth-arm-tail vocabulary, size check (1280×760)
├── icon-24.svg            simplified silhouette-safe icon (24×24)
├── dark-variant.svg       neutral state, dark palette on #0F1D21 (256×256)
├── palette.svg            light / dark / grayscale swatches with hex values and luminance
└── states/                256×256, transparent background
    ├── neutral.svg
    ├── welcome.svg
    ├── listening.svg
    ├── speaking.svg
    ├── thinking.svg
    ├── celebrate.svg
    ├── try_again.svg
    └── offline.svg
```
