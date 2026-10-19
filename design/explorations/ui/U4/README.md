# U4 · Soft Clay — UI direction exploration

Status: exploration for owner approval. Nothing outside `design/explorations/ui/U4/` was touched; nothing is wired into the app.

## Concept

**Soft Clay** treats every surface as a small, softly lit clay tile: pastel fills, chunky 28 px corners, a 2 px inner highlight on top and a 4 px inner shadow on the bottom edge so cards and buttons look physically pressable, plus a short bouncy spring when they are pressed. Pastels (peach, mint, lilac, butter, sky) carry *meaning by role*: peach = speak/primary action, mint = progress and "character is speaking", lilac = course/review, butter = mascot/warnings, sky = audio. One deep coral tone exists for the single most important control on every screen (the microphone / Speak tab) so the eye always finds it first.

Personality / rationale: cozy, toy-like and game-ish without being childish — the depth comes from edges, not from glossy highlights or cartoon outlines, so it still reads as a premium adult product. The tactile language fits a speak-first app: the mic feels like a button you physically press, the progress meter is a groove that fills, and feedback cards are tiles that pop in. It is deliberately far from the flat/outlined, saturated-green look that dominates the category.

## What is in the mockups

| File | Screen | Notes |
|---|---|---|
| `home.html` / `home-dark.html` | Home / today | mascot slot (butter tile, `welcome` state), course + instruction-language header with pencil edit affordance, next-mission card over the café scene, honest "minutes actually spoken" meter, continue-audio row, due reviews (Arabic chips, RTL), 5-tab bar with raised Speak tab. |
| `lesson.html` / `lesson-dark.html` | Listen → anticipate → speak | café scene + Nadia portrait (`talking`), "Nadia is speaking" chip with bars only because audio is playing, **Darija line in Arabic script (RTL) + romanisation**, replay / slow / translate, French anticipation prompt (course taught in French), large 112 px mic with hint and reveal on either side, last-attempt card using the honest *"Detailed phoneme assessment isn’t available … no score is shown because none was measured"* pattern. |
| `conversation.html` / `conversation-dark.html` | Live AI character conversation | Ka-yan (Cantonese) portrait over the teahouse/restaurant scene, speech-state chip, **CJK transcript (Traditional Chinese + Jyutping)**, single deep-coral mic, repeat / slow / hint / translate around it, transcript toggle + leave below, mascot small and still in a corner, centre band of the scene kept clear. |
| `conversation-reconnecting.html` / `-dark.html` | Same screen, honest reconnecting state | "Reconnecting · attempt 2 of 5" chip, mic visibly disabled and desaturated, banner explaining that the last answer is saved/queued and that nothing is being recorded, retry / continue-offline actions, queued transcript row marked "not sent yet". No fake waveform, no spinner pretending to be progress. |
| `tokens.html` | Tokens | light + dark palettes with computed WCAG contrast ratios, type scale, script samples (Arabic, Traditional Chinese, Japanese, Korean, Devanagari, French expansion), radii, elevation recipe, motion table with live press/pulse demo. |

All art inside the mockups is the repository baseline (`assets/mascot`, `assets/characters`, `assets/scenes`) inlined verbatim as placeholders so this direction can be compared with the others on equal footing. No CC0 / Open Peeps / unDraw / Open Doodles material is used anywhere in this folder. Mockup copy is UI copy only; no text is baked into artwork. Fonts: `ui-rounded` → SF Pro Rounded / Segoe UI / Roboto system fallbacks; scripts fall back to the OS Arabic / CJK / Devanagari fonts.

## Strengths

- Depth is carried by **edges** (inner highlight + inner shadow), so it survives grayscale, low-end screens and 24 px icons; the shadow recipe is 3 box-shadows, cheap on Android.
- A single rule — dark ink on pastel, white only on deep coral — keeps contrast predictable: ink on peach 9.9:1, white on deep coral 4.5:1 (light); ink on bg 12.7:1 light / 14.7:1 dark; pastel ink on dark-mode peach 7.5:1. See `tokens.html` for every pair.
- The tactile mic is the most prominent object on every speaking screen; secondary controls are deliberately smaller, lighter tiles.
- Pastel roles double as a wayfinding system (mint = progress, sky = audio, lilac = review) without relying on colour alone — every chip also has an icon or label.
- Cozy + game-like matches the "premium interactive language adventure" brief while leaving room for the mascot and scene art to be the colourful elements.

## Risks

- **Taste risk:** pastel clay can tip into "kids app" if saturation creeps up or corners get bigger. Guardrails: never exceed the five pastels, keep ink dark, keep corners at 28/22/16, no glossy specular highlights on UI (only on the mascot/characters if that art direction is chosen).
- **Dark mode is harder** for a light-first clay system: pastels must be desaturated and the inner highlight dropped to 10 % white, otherwise buttons glow. The dark mockups show the intended result but need a device check on OLED.
- **Inner shadows on React Native:** `box-shadow` inset is not native; the recipe is implemented as a 2-layer view (highlight border-top + shadow border-bottom) or a 9-slice PNG. Documented in the motion/implementation plan below.
- **Spring overshoot** must be disabled for meters, timers and anything that conveys a quantity; only presses and pop-ins spring.
- Pastel chips with dark text are high-contrast but **tertiary text (`ink3`) sits at ~3–3.5:1** — restricted to 11 px bold uppercase labels that always sit next to a higher-contrast element, and bumped to `ink2` under the OS high-contrast setting.

## How it scales

- **Tokens first:** 5 pastels + ink scale + 1 deep tone + 3 semantic colours; 4 radii; 4 elevation levels; 3 durations + 2 easings. Everything in the mockups is built from those, so the system fits in a single `theme.ts`.
- **Component mapping (spec §10.2C):** `MissionCard` = xl clay card with media inset; `SpeakButton` = deep coral lvl-3 tile; `SpeechStateIndicator` = chip (mint speaking / lilac listening / butter reconnecting / quiet idle); `LessonProgress` = pressed-in meter; `HintSheet` = lvl-3 sheet with 28 px top corners; `CharacterPortrait` = circle with a 3–5 px card-coloured rim; `Mascot` sits on a butter tile at 84 px on Home and floats free at 40–56 px on speaking screens.
- **30 courses:** nothing in the chrome encodes a language or a flag; course identity comes from the cover art and the course chip (two-letter code + name). RTL flips the layout; the tab bar and mic stay centred.
- **Tablets:** cards cap at 560 px and sit in a two-column grid; the clay recipe does not change.
- **Phone small (≤ 360 px):** mic drops to 96 px, secondary controls to 48 px; copy already fits French expansion at 390 px with margin.

## Accessibility notes

- Tap targets ≥ 44 pt (icon buttons 44, secondary controls 52, mic 92–112).
- Every state is conveyed by icon + label + colour; speech bars animate only when audio is playing and are `aria-hidden`, the chip text carries the meaning via `aria-live`.
- RTL: Arabic lines use `dir="rtl"` and right alignment inside LTR UI (course taught in French); when the *UI* language is Arabic the whole layout mirrors, including the mascot (whole figure, per the mascot guide).
- Script heights: Arabic 1.5, CJK 1.45, Devanagari 1.6 line-height; samples in `tokens.html`, live Arabic in `lesson.html` / `home.html`, live Traditional Chinese in `conversation.html`.
- Text scaling to 200 %: cards grow; the only ellipsis is the course name in the header, whose full value is in the accessibility label.
- Reduced motion: all loops off, springs → 120 ms ease, scale → opacity; mascot uses static exports. High contrast: `ink3` → `ink2`, pastel gradients → flat fills, inner shadows → 1 px borders.
- Colour-blind safety: progress is mint *and* a number; reconnecting is butter *and* an icon *and* copy; no red/green-only states.

## Motion plan

| Layer | Tool | What it animates |
|---|---|---|
| Mascot | **Rive** (state machine: idle/blink, listening, speaking, thinking, celebrate, error_recovery) | one instance per screen, inputs driven by real speech state; static SVG fallback and reduced-motion off switch |
| Celebrations / achievement reveal | **Lottie** | confetti and medal reveal, ≤ 1.2 s, skippable, never inside lists |
| UI (press, pop-in, settle, sheets, meter fill, mic ring) | **react-native-reanimated** | spring `{damping 14, stiffness 220}` for press/pop; `withTiming 420 ms` for settle and meters; mic ring radius bound to the real input level, no animation when no audio |
| Speech-state chip | reanimated | bars loop only while `characterAudioPlaying === true`; chip crossfades between states in 240 ms |

## Files
- `home.html`
- `lesson.html`
- `conversation.html`
- `conversation-reconnecting.html`
- `home-dark.html`
- `lesson-dark.html`
- `conversation-dark.html`
- `conversation-reconnecting-dark.html`
- `tokens.html`
- `README.md`

Generator used to produce the HTML lives outside the repository (scratchpad); every file here is static and self-contained.
