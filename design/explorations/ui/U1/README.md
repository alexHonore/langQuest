# U1 — "Warm Editorial"

UI direction exploration for LangQuest. Code `U1`. Seed: *refined baseline* — warm cream surfaces, deep teal and coral accents, generous type, soft shadows, 20 px cards; calm and premium.

Open any `.html` file directly in a browser; every file is self-contained (inline CSS, inline SVG, system fonts, no network).

## Concept and rationale

Warm Editorial treats the app like a well-set magazine rather than a game console: cream paper (`#F6F0E6`) instead of white, a serif display face for the few lines that carry meaning (the greeting, the mission title, the character's line in the target language), and a quiet system sans for everything the learner reads fast. Deep teal is the one colour that means "you can act on this" (buttons, mic, tabs, links); coral is reserved for warmth and progress (ribbon, play, streak, speaking indicator) and is never asked to carry small white text. Elevation is soft and ink-tinted in light mode and becomes a 1 px hairline plus a lighter surface in dark mode, where shadows would be invisible. The mascot keeps its baseline look (teal body, orange ribbon) and the UI is tuned around it: the ribbon's coral and the body's teal are the two accents, so the creature never looks pasted on. The direction is deliberately premium-calm so that a 40-year-old adult learner is as comfortable here as a student; the delight comes from the character art, the mascot and the motion, not from saturated chrome.

## File list (exact)

| File | What it shows |
|---|---|
| `home.html` | Home / Today, light. Mascot slot (welcome state, 64 dp companion), course + instruction-language header with **Change** affordance, next-mission card with inline café scene, speaking-minutes meter, continue-audio row, due-reviews row, "other courses" chips (Arabic RTL, Japanese, Korean text samples), 5-tab bar. |
| `home-dark.html` | Same screen, dark tokens, dark mascot and dark scene exports. |
| `lesson.html` | Listen → anticipate → speak, light. Scene stage with character portrait and honest "Marta is speaking" state, target line in serif, Replay / Slow / Translate, prompt with mascot (encouraging), 88 dp mic, Need a hint / Reveal & compare, and the **honest pronunciation pattern**: "Detailed phoneme assessment is not available for this course yet" — no score, no bar. |
| `lesson-dark.html` | Same, dark. |
| `conversation.html` | Live AI conversation, light. Two 390×844 frames in one page: (A) *your turn* — portrait over scene, "Marta is listening" pill, transcript card, Repeat / Slow / Hint / Translate, single primary mic with live rings, Leave and Transcript toggle in the header; (B) *honest reconnecting state* — spinner pill, warning banner "Connection lost — retrying (2 of 5)", secondary controls dimmed, mic **disabled** with "nothing is being recorded", no fake waveform. |
| `conversation-dark.html` | Same two frames, dark. |
| `tokens.html` | Light and dark palettes with hex and computed WCAG contrast ratios, type scale, radii/spacing/elevation, motion table, multiscript type specimen (Arabic RTL, Japanese, Korean, Devanagari, French expansion). |
| `build.py` | Generator (Python 3 standard library). Reads `/assets/{mascot,scenes,characters,icons}` and writes the seven HTML files. Re-run after editing tokens. |
| `README.md` | This file. |

Assets inlined from the repository (placeholders, unchanged): `assets/mascot/welcome.svg`, `assets/mascot/encouraging.svg` (+ `dark/` variants), `assets/scenes/cafe.svg`, `assets/scenes/cafe-evening.svg`, `assets/scenes/dark/cafe.svg`, `assets/characters/es-es-coworker-marta/{talking,listening,neutral}.svg`, `assets/icons/*.svg` (recoloured to `currentColor`). Two tiny glyphs the icon set lacks (person, bell, wifi) are drawn in `build.py`. **No CC0 / third-party artwork** (Open Peeps, Open Doodles, unDraw) is used anywhere in this direction.

## Tokens (summary)

Light: bg `#F6F0E6`, surface `#FFFCF7`, sunken `#EFE6D8`, line `#E2D7C6`, ink `#182A2C` / `#46595C` / `#5E7174`, teal `#0E6E68` (tint `#D7ECE8`), coral `#EC6A48` (text form `#B8432A`, tint `#FBE3DA`, text-on-coral `#182A2C`), success `#2F7A55`, warn `#9A6A12`, danger `#B6362C`.

Dark: bg `#121819`, surface `#1B2224`, sunken `#242E30`, line `#2F3B3E`, ink `#F2ECE2` / `#B9C4C3` / `#86979A`, teal `#63CDBF` (text-on-teal `#0D1F1E`, tint `#1E3A38`), coral `#F59172` (tint `#3A2A24`, text-on-coral `#0D1F1E`), success `#6FCB9A`, warn `#E2B85A`, danger `#F08A80`.

Radii 20 / 16 / 14 / 12 / pill. Spacing 4-pt, gutter 20, card padding 16. Elevation 0 sunken · 1 card · 2 floating. Type: serif display 34/28/22 (+ 26 for the target-language line), sans 17/15/13/11.

All contrast ratios in `tokens.html` are computed from the hex values at build time (see `contrast()` in `build.py`); none are estimated. Every text/background pairing used in the mockups is ≥ 4.5:1 (AA) and primary text is ≥ 13:1. The only sub-AA pairing — white on coral (3.1:1 light) — is documented as **not allowed** and never used.

## Accessibility notes

- **Text size**: all sizes are relative to the platform text-size setting; layouts use flex columns so a 200 % scale wraps instead of truncating (the one `ellipsis` is the audio title, which has a full label on the player screen).
- **RTL / Arabic**: `home.html` shows an Arabic course chip with `dir="rtl"`; `tokens.html` shows a full Darija line. In the app, the whole layout mirrors under RTL (leading edge = right): back chevron, step dots, tab order, the mission card's play button. Per the mascot guide, the mascot may be mirrored whole but its ribbon is never flipped alone. Uppercase "micro" eyebrows are a Latin-only rule and are skipped for Arabic, CJK and Devanagari.
- **CJK / Devanagari**: body line-height 24 at 17 px leaves room for full-width glyphs and Devanagari ascenders; the serif display face is used for Latin/Cyrillic only — other scripts fall through to the system sans so nothing renders in a fallback serif of uneven weight.
- **French expansion**: buttons are min-width, not fixed-width; "Reveal & compare" already wraps to two lines in English at 390 px to prove the pattern. `tokens.html` carries a French sample.
- **Colour is never the only signal**: speech states combine a text label, a coloured dot and (only while audio is really flowing) motion; the reconnecting state has an icon, a label and a banner; progress meters carry numbers.
- **Touch targets**: ≥ 44 × 44; primary mic 88; secondary pills ≥ 36 high with 8 px gaps (acceptable for secondary, flagged under risks).
- **Reduced motion**: `prefers-reduced-motion` stops the mic rings, speaking bars and spinner and removes transitions; the mascot idle loop is paused on its neutral frame.
- **Screen readers**: every inline SVG carries an `aria-label` (mascot state, character + expression, scene alt text) or `aria-hidden` for icons; the mic has a state-specific label; the reconnecting banner is `role="status" aria-live="polite"`.
- **Honesty**: no numeric pronunciation score anywhere; the lesson shows the "detailed phoneme assessment not available" pattern; the conversation's mic is disabled and labelled "nothing is being recorded" while reconnecting; the speaking indicator only animates when character audio plays.

## Motion plan (roles)

| Layer | Tool | Responsibility |
|---|---|---|
| Mascot | **Rive** (state machine) — Lottie static fallback | One instance per screen max. Inputs: `state` (17 contract states), `breath`, `blink`, `reducedMotion`. Idle breathing ±2 %, blink every ~4 s, `reaction` ≤ 400 ms, `anticipation` ≤ 600 ms, `celebrate_bounce` ≤ 1.2 s. Never inside list items; off entirely when the learner disables the mascot. |
| Celebration / achievement reveal | **Lottie** (pre-rendered, skippable) | Chapter complete, achievement medal (≤ 900 ms). Plays once, static poster frame available. |
| UI transitions | **react-native-reanimated** | Press scale (.98, 120 ms standard), hint sheet (320 ms emphasized), translate/hint reveal (200 ms), tab underline, meter fill (600 ms emphasized), mission card → lesson shared element (art area expands into the stage). |
| Live audio indicators | reanimated, driven by real signals | Mic rings run only while capture is open (bound to the recorder's `isRecording`); speaking bars only while the TTS/stream player reports `playing`; spinner only in `reconnecting`. No decorative waveforms. |
| Reduced motion | all layers | Rive paused on neutral, Lottie shows poster, reanimated durations → 0, loops stop. |

Durations/easings are tokens (`--dur-fast 120`, `--dur-base 200`, `--dur-slow 320`, `--dur-reveal 600`; `ease-standard (.2,0,0,1)`, `ease-emphasized (.3,0,0,1)`, `ease-exit (.4,0,1,1)`), listed with what each one animates in `tokens.html`.

## Strengths

- Calm, adult, premium: reads as a tool you would use for months, not a toy — fits "polished enough for adults" without losing warmth.
- The serif display gives the target-language line real presence; the sentence the learner must answer is the most beautiful thing on the screen.
- Two accents only, both borrowed from the mascot, so mascot + UI feel like one system in light and dark.
- Dark mode is a genuine design (hairline elevation, cream ink, lifted teal/coral) rather than an inversion; contrast is higher in dark than in light.
- Honest states (reconnecting, no-assessment) are designed as first-class, not error afterthoughts.

## Risks

- **Serif availability on Android**: `serif` maps to Noto Serif on most devices but OEM skins vary; the display face may look slightly heavier or lighter across devices. Mitigation: ship weights via `fontFamily: 'serif'` + `fontWeight` only, verify on a low-end Samsung/Xiaomi, or fall back to sans display on Android if inconsistent.
- **Cream + soft shadows on cheap LCDs**: the light elevation (6–8 % ink shadows) can vanish on low-contrast panels, flattening cards. Mitigation: add the 1 px `line` ring to cards under a "high contrast" setting (already how dark mode works).
- **Coral discipline**: coral fails AA for small white text; a developer who puts white text on a coral button breaks the system. Guard it with a lint on the `onCoral` token.
- **Density**: Home is full at 390×844; at 200 % text or on 360 px-wide Android the "other courses" row and due-reviews card must scroll. Acceptable (Home scrolls), but the mission card must stay above the fold.
- **Secondary pill height (36)** is below the 44 dp platform minimum; raise to 40–44 in implementation at the cost of ~16 px vertical space, or keep 36 with 8 px hit-slop.
- **Calm may read as "quiet"**: compared with gamier directions, celebration moments rely on Rive/Lottie and the mascot; if those are cut, this direction has less built-in energy. The streak chip is intentionally small; if the owner wants engagement cues more visible, that is a different direction.
- **Content remains placeholder**: Marta's portrait and the café scene are the current parametric assets; a final illustration style (C-series explorations) will change how much visual weight the stage needs.

## How it scales

- Tokens are two flat dictionaries (`LIGHT`, `DARK` in `build.py`) with semantic names that map 1:1 onto the `packages/ui` theme-token system required by spec §10.2A; the component CSS only references tokens.
- Components shown map onto the required library: `AppShell` (status + tab bar), `Mascot` slot, `MissionCard`, `LessonProgress` (step dots), `AudioPlayer` row, `SpeakButton` (mic, 3 states), `SpeechStateIndicator` (pill), `HintSheet` (quiet buttons), `PronunciationFeedback` (sunken card, honest variant), `CharacterPortrait` + `SceneArtwork` (stage), `LanguagePairPicker` entry (course header with Change).
- Tablet: cards keep 20 px radius and max-width 560, two-column Home (mission + today on the left, audio + reviews on the right); the stage grows to 16:9 at full width.
- Other courses swap only content: Arabic text flows RTL inside the same components; scene/character assets are per-course, the chrome is not.
