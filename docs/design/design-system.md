# LangQuest design system — "Night Market" (U2) + Melo (M3) + clay cast (C2)

Status: production tokens and components, implementing the owner decisions of 2026-10-19
(mascot **M3 "Melo"** the chameleon, characters **C2** soft dimensional clay, UI **U2 "Night
Market"**, much less text on screen). Source of truth is code: `packages/ui/src/tokens/**`,
`packages/ui/src/theme/**`, `packages/ui/src/components/**`. This page explains the tokens, the
course × lesson lantern accents, the text-density rule and — because the owner may change the
UI/UX direction again — exactly what to edit where to swap a direction without touching screens.

Explorations the decisions came from: `design/explorations/ui/U2/` (tokens.html, mockups, README),
`design/explorations/mascots/M3/`, `design/explorations/characters/C2/`.

---

## 1. Principles

1. **Dark-first.** The dark palette is the reference; light is derived (canvas/text inverted,
   accent _text_ tokens darkened, accent _fills_ kept close); two high-contrast palettes push the
   same hues to AAA. When the OS scheme is unknown the theme is dark.
2. **Light carries meaning, not clutter.** Glow (elevation 3) is reserved for exactly two things:
   the **speech state** and the **one primary action** on a screen. Everything else is quiet glass.
3. **Lanterns follow the course and the lesson.** Three blurred background blobs, the primary
   action fill and the glow ring are derived from each track's cover palette and modulated by the
   mission / step / lesson type. Text tokens never change with the course.
4. **Calm by default.** `density: 'calm'` is the default: one heading, at most one helper line,
   one primary action; explanations live behind an `InfoAffordance` (ⓘ) sheet.
5. **Honesty rules unchanged.** No waveform, no fabricated score, speech glow only while the audio
   engine reports activity, nothing disabled as a placeholder (CONVENTIONS §8).
6. **Never hard-code colours in screens.** Components read `useTheme()` only; the whole direction
   is swappable by editing the token files listed in §8.

---

## 2. Colour tokens (`packages/ui/src/tokens/color.ts`)

Four palettes: `dark` (reference), `light`, `highContrastDark`, `highContrastLight`. Semantic names only.

| Group             | Tokens                                                                                                                                 | Rule                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Canvas & surfaces | `background` (bg0), `surface` (bg1), `elevated` (bg2), `surfaceMuted`, `glass.{fill,fillStrong,border,borderStrong,solid,solidStrong}` | glass fills are rgba over the canvas; `solid*` is the opaque fallback tier                   |
| Text              | `textPrimary`, `textSecondary`, `textMuted`                                                                                            | AA (4.5:1) on every surface and on both solid glass tiers                                    |
| Accent fills      | `accent` (magenta), `amber`, `cyan` + inks `onAccent`, `onAmber`, `onCyan`                                                             | **never text**; ≥ 3:1 vs surfaces, ink ≥ 4.5:1 on the fill                                   |
| Accent text       | `accentText`, `amberText`, `cyanText`                                                                                                  | the only accent colours allowed for text                                                     |
| Status            | `success/Soft`, `warning/Soft`, `error/Soft`, `info/Soft`                                                                              | warning = amber text, info = cyan text                                                       |
| Speech            | `speech.{listening,speaking,thinking,reconnecting,error}`                                                                              | mic open = cyan, character = magenta, thinking = lavender; all AA as text, mutually distinct |
| Glow / lanterns   | `lantern: [magenta, cyan, amber]`, `celebrationA/B/C`                                                                                  | default lanterns; per-course accents override                                                |
| Chrome            | `border`, `borderStrong`, `focusRing`, `overlay`, `sceneScrim`, `onScrim`                                                              | scrim is mandatory under glass that sits on scene art; text on a scrim uses `onScrim` (AA)   |

Dark values (U2 tokens.html): bg0 `#0B0913`, bg1 `#130F21`, bg2 `#1C1730`, glass solid `#1A1821`,
text `#F5F2FB / #BDB6D0 / #9A93B1`, magenta `#FF4FA3` (text `#FF7CBB`), amber `#FFB547` (text
`#FFC46A`), cyan `#3EE1E8` (text `#5FE9EF`), success `#45E0A6`, danger `#FF8A96`.
Light: bg0 `#F6F3FB`, bg1 `#FFFFFF`, bg2 `#FCFBFE`, text `#1A1430 / #534B6C / #675F82`, magenta
`#D1177C` (text `#B0106A`), amber `#C96F00` (text `#8A4B00`), cyan `#0B7A82` (text `#0A6E77`).

Every pair above is verified by `tokens.test.ts` (contrast AA for every text token on every
surface in all four palettes, 3:1 for fills, 4.5:1 for inks, AAA for high-contrast primary text).

### Using colours in components

```tsx
const theme = useTheme();
theme.colors.textPrimary              // text
theme.accents.primary / .onPrimary    // THE primary action fill + ink (course-tinted, AA-tuned)
theme.accents.primaryText             // the course accent as text
toneColor(theme, 'accent')            // same thing through ThemedText tone="accent"
theme.colors.speech.listening         // mic-open cyan
```

`ThemedText tone="accent"` and `Button variant="primary"` already follow the course accent.

---

## 3. Lantern accents per course and per lesson (`packages/ui/src/tokens/accent.ts`)

```ts
courseAccent(trackId, scheme); // → { lantern: [c1,c2,c3], hues, primary, primaryStrong,
//     primarySoft, onPrimary, primaryText, ring, tinted }
lessonAccent(missionType | stepType | lessonType);
// → { hueShift, lead, glowIntensity, glowTarget }
resolveAccents(trackId, lessonKey, { scheme, lanterns });
// → courseAccent ⊕ lesson: lantern (lead first, hue-shifted),
//    lanternOpacity, glowIntensity, glowTarget
```

- **Course:** the three lantern hues are the track's cover `hue`, its motif `hue2` and a derived
  counterpoint (`hue + 150 + 12·variant`), read from `COVER_RECIPES` in `art/covers.ts`. The
  primary fill, its ink, the accent-as-text and the tinted "soft" background are **tuned by
  lightness search** until they meet AA on canvas, surface and card and 4.5:1 ink on the fill, in
  dark and light. `accent.test.ts` asserts this for all 30 tracks and that the 30 lantern sets are
  distinct.
- **Lesson:** every `MissionType`, `MissionStepType` and `LessonType` has an entry in
  `LESSON_ACCENTS`: speaking-first screens lead with the course hue and glow fully; listening steps
  are cooler (−24…−40°) and calmer (0.35–0.5); story / situational missions lean warm (+18…+30°);
  reviews are quiet. Unknown keys are neutral.
- **High contrast:** the fixed palette accent is kept (AAA), lanterns are off, glow intensity 0.
- **Learner / device:** `lanterns: false` turns the blobs off; `lowEndDevice` disables drift and
  blur (solid tier).

The mascot's chameleon tint is owned by the art module (`art/mascot/tint.ts`): state hue ×
course-family hue dial. The theme exposes it as `theme.mascotTint(state)` /
`useMascotTint(state)` so screens never compute colours.

---

## 4. Theme (`packages/ui/src/theme/`)

`ThemeProvider` props = `ThemePreferences`:

| Pref                                                               | Default                        | Effect                                                                  |
| ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| `scheme` / `systemScheme`                                          | `'system'` → dark when unknown | palette                                                                 |
| `highContrast`                                                     | false                          | HC palettes, no lanterns, no glow, solid glass                          |
| `reducedMotion` / `systemReducedMotion`                            | system                         | durations 0 except 120 ms colour change; static rings; no drift         |
| `courseTrackId`                                                    | null                           | lanterns + primary + mascot family                                      |
| `lessonType`                                                       | null                           | lantern modulation + glow intensity (`LessonAccentScope` for a subtree) |
| `density`                                                          | `'calm'`                       | text budget (see §6)                                                    |
| `glassFallback`                                                    | `'auto'` (= `lowEndDevice      |                                                                         | highContrast`) | solid surfaces, no blur |
| `lowEndDevice`                                                     | false                          | solid glass + lantern drift off                                         |
| `lanterns`                                                         | true                           | background blobs                                                        |
| `mascotEnabled`, `textScale`, `rtl`, `nativeRtl`, `hapticsEnabled` | unchanged                      |                                                                         |

Resolved `Theme` additions: `accents`, `courseTrackId`, `lessonType`, `density`, `textBudget`,
`glassFallback`, `glass(level)`, `glow(color?, intensity?)`, `lanterns {colors, opacity, driftMs,
enabled, blur}`, `mascotTint(state)`. Hooks: `useTheme`, `useAccents`, `useDensity`,
`useMascotTint`; `ThemeOverride` and `LessonAccentScope` for subtrees.

Wiring in the app (mobile `_layout.tsx`): pass `courseTrackId` from the active enrollment and
wrap lesson / conversation screens in `<LessonAccentScope lessonType={mission.type}>`. The
`AppShell` draws the `Lanterns` automatically when `theme.lanterns.enabled`.

---

## 5. Surfaces, glass, glow, motion (`packages/ui/src/tokens/layout.ts`)

- **Radii:** sm 10 · md 16 · lg 22 (cards) · xl 28 (tab bar, sheets) · pill.
- **Spacing:** 4 / 8 / 12 / 16 / 20 / 24 / 32; phone gutter 16; touch ≥ 44; mic 88 (lesson) / 84 (conversation).
- **Glass levels** (`glassStyle`, `theme.glass(level)`): 0 canvas · 1 card (white 6 % dark / 66 %
  light, 1 px border, blur 20) · 2 strong (11 % / 86 %, blur 24; tab bar, pills, sheets). The
  `blur` number is for the host (expo-blur / CSS `backdrop-filter`); RN draws the rgba fill alone.
  On the fallback tier the fill is `glass.solid*` and blur is 0.
- **Glow** (`glowStyle`, `theme.glow()`): 5 px ring @ 28 % + 34 px bloom @ 55 %, scaled by the
  lesson's `glowIntensity`; `boxShadow` for web, `shadow*`/`elevation` for RN. Used by
  `SpeechStateIndicator` (GlowDot), `CharacterPortrait` ring, `SpeakButton`, `Button glow`,
  `Surface glow`, `MissionCard` hero.
- **Motion:** fast 120 · base 200 · slow 320 · glowPulse 1600 (loop, only while audio is active) ·
  lantern drift 22 / 27 / 31 s alternate · card enter 200 (translateY 12 → 0) · banner 320.
  Springs: `press` damping 14 · stiffness 180 · mass 1 (mic press scale .94 → 1, card tap, mascot
  bounce). Easings: standard `(.2,.8,.2,1)`, emphasized `(.3,0,0,1)`. Reduced motion: everything 0
  except `colorChange` 120 ms; glows static; drift off. Low-end: drift off, blur off.
- **Typography:** U2 scale — display 34/800, title 26/800, heading 20/800, subhead 17/700, body 15
  (minimum), label 13/600, caption 12, eyebrow 12/700 +0.8 uppercase. Arabic +15 % size, +line
  height, never letter-spaced; CJK line-height ≥ 1.5, weight capped at 700, no tracking.

---

## 6. Text density ("information pollution")

`theme.density` is `'calm'` by default; every component also accepts a `density` prop that wins.
`TEXT_BUDGET`: 1 heading, ≤ 1 helper line, 1 primary action, ≤ 6 words per bullet, ≤ 2 words per badge.

| Component                                        | calm (default)                                                                                                                                                      | full                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `MissionCard`                                    | title + duration (+ status chip only when not "ready"); objective, focus, skills, consequence behind the **Details** chevron (`defaultExpanded`, `onToggleDetails`) | everything inline               |
| `AudioPlayer`                                    | icons with accessibility labels; subtitle, chapter and attribution behind ⓘ; no captions                                                                            | labelled buttons + captions     |
| `PronunciationFeedback`                          | one line (intelligibility) + primary action; meaning, mode, notes, word scores, retry segment, transcript, replay buttons in the ⓘ detail sheet                     | inline                          |
| `CoverageBadge`                                  | icon + 2 words (`COVERAGE_SHORT_LABELS`); description / review note behind ⓘ when `verbose`                                                                         | chip + lines                    |
| `CapabilityDisclaimer` (new, in `@langquest/ui`) | heading + bullets ≤ 6 words (`CAPABILITY_LABELS.short`, keyed by the contract enum); long lines + status behind ⓘ                                                   | long lines + severity chips     |
| `SpeechStateIndicator`                           | glow ring + one word (`SPEECH_STATE_SHORT_LABELS`); `detail` only announced                                                                                         | long label + detail             |
| `CharacterPortrait`                              | name + one-word status; no subtitle                                                                                                                                 | name, subtitle, status          |
| `EmptyState`                                     | title + one action; description behind ⓘ, no secondary action                                                                                                       | title, description, two actions |
| `HintSheet`                                      | progressive: next hint is the single primary action; other commands behind **More**; model-answer reveal after the last hint                                        | all commands                    |
| `SpeakButton`                                    | no mode-switch text (`showModeSwitch` still works)                                                                                                                  | mode switch shown               |
| `LessonProgress`                                 | step counter only; phase label announced                                                                                                                            | phase caption shown             |
| `InfoAffordance` (new)                           | small ⓘ (44 dp target) opening a glass sheet with `text` (string or bullet list) and/or children                                                                    | —                               |

Short copy lives in `components/labels.ts` (`CALM_LABELS` for Details / Hide details / More /
Less — passed as `calmLabels`, separate from the per-component sets so apps that build those sets
exhaustively keep compiling — plus `SPEECH_STATE_SHORT_LABELS`, `COVERAGE_SHORT_LABELS`,
`CAPABILITY_LABELS`, `INFO_LABELS`).

All long strings stay in the accessibility labels, so screen readers lose nothing. Catalog keys
added for the short copy (en/fr, es/ru for `common` and `enrollment`): `common.{info,details,
hideDetails,more,less,moreInformation}`, `speak.stateShort.*`, `catalog.coverageShort.*`,
`enrollment.disclaimer.{shortTitle,shortAllAvailable,short.*}`, `missions.{details,hideDetails}`,
`audio.player.details`, `pronunciation.feedback.details`, `lesson.{hintMore,hintLess}`.

`density.test.tsx` renders each component in both densities (react-dom static markup over a
react-native stand-in) and asserts the calm variant shows no helper text unless requested.

---

## 7. Component colour contract (what may glow, what may be tinted)

- Primary action: `Button variant="primary"` (course `accents.primary`/`onPrimary`); add `glow`
  only on the one primary action of the screen. `SpeakButton` glows by default (it _is_ the primary
  action of speaking screens) and turns cyan while the mic is open.
- Speech state: `SpeechStateIndicator`, `CharacterPortrait` ring, `GlowDot`. Glow breathes only
  while `SPEECH_STATE_HAS_AUDIO[state]`.
- Secondary actions: `Button variant="secondary"` = glass level 1; `ghost` = text in the course
  accent text colour.
- Surfaces: `Surface variant="glass" | "glassStrong"` for cards / sheets / tab bar; `elevated`,
  `surface`, `muted`, `accentSoft` stay opaque.
- Lanterns: `Lanterns` (drawn by `AppShell`); decorative, hidden from assistive tech.
- Icons: `art/native.tsx` icons with no `color` prop paint themselves with the active theme's
  `textPrimary` (a hook-backed default, so they follow the scheme and the high-contrast palettes);
  `InlineIcon` resolves a tone instead. Never a hard-coded hex as the default.
- Text over scene art / cover scrims uses `tone="onScrim"` (`CourseCover` title), never a literal
  white.
- Never: colour as the only cue (every state has text + icon or pose), accent fills as text,
  glass over scene art without `sceneScrim`.

---

## 8. Swapping the direction later — what to change where

The owner may change UI/UX choices. Everything is token-driven; screens and components read
`useTheme()` only, so a new direction is a token edit, not a screen rewrite.

| Want to change                                       | Edit                                                                                                                                      | Nothing else changes because                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Palette (another direction, e.g. U1/U3)              | `tokens/color.ts` — the four `*_COLORS` objects; keep the token names                                                                     | `tokens.test.ts` re-verifies AA/AAA; components use names only |
| Light as first-class vs fallback                     | `theme/resolve.ts` — the `systemScheme ?? 'dark'` default                                                                                 |                                                                |
| Glass vs opaque cards                                | `layout.ts` `glassStyle` / `GLASS_BLUR`, or set `glassFallback: true` app-wide                                                            | `Surface variant="glass"` reads `theme.glass()`                |
| Glow look (ring width, bloom) or where it is allowed | `layout.ts` `GLOW`; §7 contract                                                                                                           | `theme.glow()` is the single recipe                            |
| Lanterns off / different blobs                       | `ThemePreferences.lanterns`, `components/Lanterns.tsx` `BLOBS`, `LANTERN_DRIFT_MS`                                                        | `AppShell` only mounts `Lanterns`                              |
| How a course tints the UI                            | `tokens/accent.ts` `courseAccent` (`lanternColors`, lightness targets); the hue source is `art/covers.ts` `COVER_RECIPES`                 | AA is re-tuned automatically; `accent.test.ts` guards it       |
| How a lesson modulates the glow                      | `tokens/accent.ts` `LESSON_ACCENTS`                                                                                                       |                                                                |
| Mascot tint per situation / family                   | `art/mascot/tint.ts` (`MASCOT_STATE_TINTS`, course families)                                                                              | theme delegates                                                |
| Type scale / fonts                                   | `tokens/typography.ts` `TYPE_ROLES`, `SCRIPT_TYPOGRAPHY`                                                                                  | `ThemedText` resolves roles                                    |
| Radii / spacing / motion / springs                   | `tokens/layout.ts`                                                                                                                        |                                                                |
| Text budget (more or less text)                      | `ThemePreferences.density` default in `theme/resolve.ts`; per-component `density` prop; short labels in `components/labels.ts` + catalogs | components branch on `density` only                            |
| Characters / scenes / covers art                     | `art/**` (C2 clay cast, scenes, cover recipes)                                                                                            | tokens read cover hues; UI never bakes text into art           |

Checklist for a direction swap: (1) edit tokens, (2) `pnpm --filter @langquest/ui test` (contrast,
accents, density), (3) `pnpm --filter @langquest/ui typecheck`, (4) screenshots of home, lesson and
conversation in dark, light and high contrast with a course selected, (5) update this page.

---

## 9. Accessibility checks that run in CI (`packages/ui`)

- `tokens.test.ts`: AA for every text token on every surface (and both solid glass tiers and the
  muted surface) in all four palettes; fills 3:1 + inks 4.5:1; speech states AA and distinct; HC
  primary text AAA; reduced-motion zeroing (120 ms colour change kept); glass fallback; glow
  recipe; CJK weight cap; Arabic tracking and size.
- `accent.test.ts`: 30 distinct lantern sets; AA for `primaryText` and 4.5:1 inks for every track
  in all four palettes; every mission / step / lesson type has a modulation; HC keeps the fixed accent.
- `theme.test.ts`: dark-first defaults, calm density, accents / glass / glow / lanterns exposure,
  low-end and high-contrast behaviour, mascot tint.
- `density.test.tsx`: calm renders no helper text unless requested; full renders it; accessible
  names are preserved; honesty by omission (no number for reference comparison).
