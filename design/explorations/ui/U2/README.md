# U2 — "Night Market" (UI direction exploration)

**Concept name:** Night Market
**Code:** U2
**Status:** exploration for owner approval — nothing here is wired into the app.

## Personality and rationale

Night Market treats every lesson like stepping into a lively evening souk: a deep indigo canvas lit by
three "lantern" accents — magenta, amber and cyan — soft-blurred behind glassy, translucent cards.
Energy comes from light, not from clutter: glow is rationed to exactly two things, the **speech state**
(who is talking, whether the mic is open) and the **one primary action** on a screen. Everything else is
quiet glass, so a speak-first product reads as "a conversation happening under lights" rather than a
dashboard. It is dark-first because people practise speaking at night, in bed, on transit — and because
the glow language only works against a dark canvas; the light variant is derived from the same tokens
(canvas/text inverted, accent *text* tokens darkened, accent *fills* kept) so both themes share one identity.

## What the mockups show

- `home.html` / `home-dark.html` — Home/today: mascot slot (welcome state in a glowing glass puck),
  course + instruction-language header with an **Edit** affordance and enrolled-course chips, the
  next-mission card (market scene with scrim), daily speaking meter (minutes, streak secondary),
  continue-audio row with the course cover, due reviews, 5-tab glass bar.
  Contains the **Arabic (RTL)** samples (due-review chips) and the **CJK** sample (日本語 course chip).
- `lesson.html` / `lesson-dark.html` — listen → anticipate → speak: scene art area with the character
  portrait (speech-glow) and the mascot companion (listening state) in a glass puck; character line in
  Arabic script with transliteration; Replay / Slow / Translate; the French-language prompt (instruction
  language of this enrolment); the honest "we heard … / detailed phoneme assessment isn't available for
  Darija yet" panel (no score); the 88 px mic; Hint (Indice) and Reveal model; word help hidden.
- `conversation.html` / `conversation-dark.html` — live AI character conversation: portrait over the
  café scene with the magenta speech ring, speech-state pill, transcript (toggleable), single primary mic
  (cyan = open), Repeat / Slow / Hint / Translate, Leave + Transcript in the top bar. A second, smaller
  phone shows the same screen in the **honest reconnecting state** (glow off, mic disabled, banner with
  the mascot's `connection_error` state, attempt counter, Leave). A gallery lists the four indicator states.
- `tokens.html` — palette with hex and **computed** contrast ratios (dark and light), type scale with
  Arabic and CJK samples, radii, spacing, elevation levels, motion durations/easings and what animates.

All art is inlined from `/assets` (mascot, Nadia, market + café scenes, icons, the Moroccan Arabic cover)
so the comparison with other directions is about the UI, not the illustrations. No CC0 or third-party
assets are used anywhere in U2.

## Accessibility notes

- **Contrast (computed):** dark — text1/bg0 17.9:1, magentaText/bg0 8.3:1, cyanText/bg0 13.5:1, amberText/bg0 12.6:1; light — text1/bg0 16.1:1, magentaText/bg0 6.1:1, cyanText/bg0 5.5:1, amberText/bg0 6.2:1. Accent *fill* tokens are measured against the
  3:1 non-text threshold and are never used for text; text on a fill uses the paired *ink* token. Glass is
  composited over the canvas before measuring; a scrim is mandatory under glass that sits on scene art.
- **Colour is never the only cue:** speech states change LED colour *and* pill text *and* portrait pose;
  progress segments differ by length and glow; the reconnect state disables the mic and shows a banner.
- **RTL / Arabic:** Arabic strings are `dir`-isolated (`unicode-bidi: isolate`), get +15 % size and
  extra line-height, are never letter-spaced; the character line is right-aligned while the chrome stays
  in the UI language. Full RTL mirroring of the layout is expected when the *interface* language is RTL
  (chips, tab order, back chevron, mascot tail mirrored as a whole — never the tail alone).
- **CJK:** line-height ≥ 1.5, weight capped at 700, no tracking (see tokens type scale).
- **Touch targets:** every control ≥ 44 × 44; mic 84–88 px; hold-to-talk has a tap-to-toggle alternative.
- **Font scaling:** body 15 minimum; at 200 % cards reflow vertically and tab labels may hide (icons keep labels for assistive tech).
- **Reduced motion:** glows become static rings, lantern drift freezes, mascot idle stops; durations collapse
  to 0 except 120 ms colour changes kept for state clarity. "Mascot off" removes the puck; layout still works.
- **Honesty:** no waveform anywhere; the speech ring only breathes while the audio engine reports activity;
  ASR transcript is labelled as recognised text; no pronunciation score is shown.

## Motion plan

| Layer | Tool | Owns |
|---|---|---|
| Mascot | **Rive** (one instance per screen max, never in lists) | idle/blink, listening lean, reaction bounce, connection_error shake → settle; state machine driven by the real speech state |
| Celebrations | **Lottie** | confetti / achievement reveal (≤ 1.2 s, skippable, static fallback = `celebrate.svg`) |
| UI | **react-native-reanimated** | speech glow (shared value from the audio engine's activity), mic press spring (damping 14 / stiffness 180), card entrance (translateY 12 → 0, 200 ms, ease-standard), tab cross-fade, banner slide (320 ms), lantern drift (22–31 s, disabled on low-end / reduced motion) |

Nothing on the UI layer blocks recording or playback; all animations are interruptible.

## Strengths

- Distinctive and premium at a glance; nothing like the flat-green/flat-blue competitor set.
- Glow carries real meaning (speech state, primary action), which makes the speak-first loop legible from across the room.
- Dark-first suits the actual moments people practise speaking (evening, transit) and saves OLED battery.
- Token-driven: the light variant is derived, not redrawn, so theming stays cheap.

## Risks

- **Glass cost on low-end Android:** backdrop blur is expensive; plan a `glassFallback` (solid `bg2` cards, no blur) toggled by a device-tier flag.
- **Light variant is the weaker sibling:** glow and lanterns lose impact on a pale canvas; it is correct and AA but less "night market". Owner should decide whether light is a first-class theme or a system-setting fallback.
- **Saturated accents can tire the eye** in long transcripts; the rule "accent text tokens only, fills never for text" must be enforced in the component library.
- **Scenes and the baseline mascot were drawn for a warm, daylight palette**; they sit well under the scrim but a final art pass should push scene night versions toward the lantern hues.
- Glow + blur layering needs careful z-order so the mascot never crosses the central overlay band of a scene during a live conversation.

## How it scales

- Tokens map 1:1 onto the spec's theme-token system (semantic colours, type, radii, spacing, elevation levels 0–3, motion durations/easings) and onto the component list in §10.2C (`SpeechStateIndicator`, `SpeakButton`, `MissionCard`, `SceneArtwork`…).
- Elevation is expressed as glass levels + one glow level, so new surfaces (sheets, toasts, pronunciation coach) pick a level rather than inventing shadows.
- Tablet: the phone column becomes a 2-column grid (mission + progress left, audio + reviews right); the conversation keeps the portrait centred with transcript docked right.
- Course identity (cover art dominant colour) can tint the lanterns per course without touching text tokens, so each of the 30 tracks feels its own while staying AA.

## File list

- `conversation-dark.html`
- `conversation.html`
- `home-dark.html`
- `home.html`
- `lesson-dark.html`
- `lesson.html`
- `tokens.html`
- `README.md`
