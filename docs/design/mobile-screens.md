# Learner app screens — Night Market (U2) · Melo (M3) · clay cast (C2)

Status: implemented in `apps/mobile` (owner decisions of 2026-10-19). Companion to
`docs/design/design-system.md` (tokens, theme, components), `docs/design/mascot-rive-spec.md` (the Rive
rig) and `docs/design/character-casting.md` (roles ↔ lesson situations). Source of truth is code:
`apps/mobile/src/components/Melo.tsx`, `apps/mobile/src/components/CourseAccentScope.tsx`, the screens
under `apps/mobile/src/app/**`.

The owner may change the UI/UX direction again: every screen reads colours, glass, glow and motion from
`useTheme()` only; the direction is swapped by editing tokens in `packages/ui` (design-system.md §8),
never by touching a screen.

---

## 1. Theme wiring

| Where                                                         | What                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/Providers.tsx`                                    | `ThemeProvider` gets the learner prefs plus `density="calm"`, `lanterns={prefs.lanternsEnabled}`, `lowEndDevice={LOW_END_DEVICE}` and `glassFallback="auto"`. Dark-first: when the OS scheme is unknown the theme is dark; the light variant is derived from the same tokens.                 |
| `components/CourseAccentScope.tsx`                            | Mounted inside `ServicesProvider`: wraps the whole app in `LessonAccentScope courseTrackId={activeEnrollment.courseTrackId}`. The lanterns, the primary action, the speech ring and the mascot family follow the active course from here.                                                      |
| `lib/device-tier.ts`                                          | `LOW_END_DEVICE` (Android < 3 GB or model year < 2019): solid glass tier, lantern drift off. Reported through `track.appStart`.                                                                                                                                                                |
| `app/(tabs)/_layout.tsx`                                      | Tab bar = `theme.glass(2)`; active tint = `accents.primaryText` (an accent _text_ token, never a fill).                                                                                                                                                                                         |
| `mission/[id]`, `conversation`, `pronunciation`, `review`, `audio/lesson/[id]` | Wrapped in `LessonAccentScope` with the mission type → the current **step type** (lesson), `character_conversation`, `pronunciation_drill`, `review_recall`, `listening_comprehension`. The lantern hues and the glow intensity change with the lesson, the summary uses `feedback_retry`. |
| `state/prefs.ts`                                              | New device-local pref `lanternsEnabled` (Accessibility → "Background lantern glow"; forced off in high contrast by the theme).                                                                                                                                                                 |

Lantern colours: course cover hue → `courseAccent(trackId)` (3 lanterns + primary + ring), modulated by
`lessonAccent(key)` (hue shift, lead lantern, glow intensity). Screens never compute colours.

## 2. Text budget ("information pollution")

Every learner screen now follows the calm density of the theme: **one heading, at most one helper line,
one primary action (glowing)**, explanations behind an `InfoAffordance` (ⓘ) sheet, icons with
accessibility labels instead of labelled buttons for secondary commands. Nothing was removed from the
accessibility tree: every explanation that left the screen is in a sheet or an `accessibilityLabel`.

| Screen                     | Heading / helper / primary                                                                                                          | Moved behind ⓘ or dropped                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                       | greeting · Melo's line · next mission card (or Quick speak)                                                                        | "Your next real conversation" heading, switch-course button (header edit icon remains; a hidden copy keeps the e2e id), XP note + no-fluency claim, coverage detail + fallback hint      |
| Catalog                    | title · search · one card per track (cover, name, native sample, coverage chip)                                                    | subtitle, variety/locale caption, mission counts, scoring support (now on the track screen's ⓘ)                                                                                         |
| Enrollment wizard          | track name · variety line · instruction language · chips · short disclaimer card · "Learn X from Y" (glow)                          | assumptions, tonal note, shared assets, scripts, regional hint, "edit later" note → ⓘ "About this course"; disclaimer intro/status/long lines → ⓘ on the card                           |
| Enrollment editor          | track name · instruction language card · includes card · chips · remove                                                            | both hint lines, fallback hint, archive/delete explanation → header ⓘ                                                                                                                   |
| Missions                   | "Your pathway" · map (list toggle as icon) · cast portraits per card                                                                | "scenes are illustrative" + "chapter locked" → header ⓘ                                                                                                                                |
| Lesson                     | step row (progress + ⓘ + close) · scene with the character · phrase card (icons: replay, slow, translate, transcript, hint) · mic   | instruction, anticipate hint, text-alternative note, draft disclosure → step ⓘ; summary objectives/skills/reviews/confidence/mastery → summary ⓘ; typed-answer explanation → ⓘ          |
| Conversation               | state word · portrait with speech ring · transcript · mic · icon commands                                                            | instruction-language note, synthetic voice detail, interrupt hint, end hint → header ⓘ; "End conversation" button merged into the close icon; summary details → ⓘ                       |
| Pronunciation              | title · phrase card (play / slow / mine icons) · Melo + state word · mic                                                             | honesty note, assessor capability, accent note, tips, synthetic reference → header ⓘ                                                                                                   |
| Review                     | title · scenario · prompt card · mic · ratings                                                                                       | "speaking optional" note → header ⓘ                                                                                                                                                   |
| Progress                   | title · overview card (one line + chips) · one row per skill (descriptor + mastery chip + uncertainty bar)                           | XP explainer, no-fluency claim, uncertainty hint, mastery definitions → header ⓘ; per-skill evidence/uncertainty/CEFR → bar `accessibilityLabel`; empty badges section hidden            |
| Account                    | title · profile card · languages · courses (edit icons) · sections · sign-out                                                       | default-language hint, screen-reader note, free note → header ⓘ                                                                                                                       |
| Accessibility              | Melo preview · one row per setting (lanterns switch added)                                                                          | no-timers + screen-reader notes → header ⓘ; redundant hints dropped                                                                                                                    |
| Notifications / Privacy    | one row per setting                                                                                                                 | opt-in note, timezone, retention/analytics/AI hints → header ⓘ                                                                                                                         |
| Characters (list / detail) | name · role · place (+ regional fit chip, synthetic badge) · talk (glow)                                                             | variety chip, personality, voice notes, alt text, synthetic detail → ⓘ                                                                                                                 |
| Speak tab                  | Melo + Quick speak (glow) + coach · mic-mode chip · cast strip                                                                       | instruction-language note, mode-switch hint → header ⓘ                                                                                                                                |
| Audio library / player     | one metadata line per collection; player + chapter controls + transcript + bookmarks                                                | descriptions, attributions, speakers, tags, "original audio", background note, practice note → ⓘ                                                                                        |
| Onboarding                 | hero (Melo) + promise + one line; language / target / confirm / warm-up each with one heading and the primary action (glow)          | free/privacy notes, UI-language hints, filter caption, assumptions/scripts/regional hints, mic-just-in-time note → ⓘ; transliteration dropped from the target grid                        |

Short copy lives in the catalogs (`common.{details,hideDetails,more,less,moreInformation,about}`,
`speak.stateShort.*`, `enrollment.disclaimer.short.*`, new `*.about*` sheet titles) — en/fr complete,
es/ru partial as before (`coverage.json` regenerated).

## 3. Melo, the chameleon (`components/Melo.tsx`)

`Melo` replaces the shared `Mascot` everywhere the learner app showed the guide (Home, Speak, lesson,
pronunciation, review, onboarding welcome / warm-up, accessibility preview, summaries). `EmptyState`
keeps its own internal mascot (state-tinted by the art module).

- **Situational colour.** `useMascotTint(state)` blends the state hue (listening = sea teal, thinking =
  lavender, try_again = coral, offline = grey-green…) with the course family of `theme.courseTrackId`.
  Screens pick the state from the real moment only: lesson `recording → listening`, `processing →
  thinking`, reference playing → `quiet_audio`, compare → `success` / `try_again`; review `curious →
  encouraging`; summaries `celebrate`. Nothing listens to the audio engine (honesty rule).
- **Idle life.** A react-native-reanimated breath (scale about the feet pivot `MASCOT_PIVOT.breath`, 4 s,
  UI thread) plus timed blinks (close 70 ms · hold 40 ms · open 110 ms every ~4.2 s, three cheap
  re-renders). Both are off under `theme.reducedMotion`, when the learner hid the mascot
  (`theme.mascotEnabled` → only the speech line stays) and below the companion size (80 dp).
- **Celebrations.** `clip="celebrate_bounce"` plays the Lottie clip from `assets/mascot/lottie` through
  `lottie-react-native` (`mascot/MeloLottie.native.tsx`), recolouring the `body` / `bands` layers with
  the chameleon tint; on web (`MeloLottie.tsx`) the clip resolves to the static pose immediately. Under
  reduced motion the static pose is shown. Clips are generated by `pnpm --filter @langquest/ui lottie`.
- **Rive (feature flag).** `EXPO_PUBLIC_MASCOT_RIVE=1` + a bundled rig (`mascot/rive-source.ts`:
  `MELO_RIVE_SOURCE` native, `MELO_RIVE_WEB_SRC` web) render the figure with `rive-react-native` /
  `@rive-app/react-canvas` (`mascot/MeloRive.native.tsx`, `mascot/MeloRive.tsx`), driving the `state`,
  `courseFamily` and `reducedMotion` inputs of the `Melo` state machine (mascot-rive-spec §1). Without a
  rig — the current state, nothing is committed under `assets/mascot/rive/` — the runtime is never
  mounted and Melo is the SVG. `metro.config.js` registers `.riv` as an asset extension. The Rive
  runtime is a native module: after enabling it the app needs a development build (`npx expo run:ios`
  / `eas build --profile development`), not Expo Go.
- **Accessibility.** The figure carries `common.a11y.mascotImage` with the `mascot.a11yState.<state>`
  label in every renderer (SVG, Lottie, Rive).

## 4. App icon, splash, adaptive icons

`apps/mobile/scripts/generate-app-icons.ts` (run with `npx tsx apps/mobile/scripts/generate-app-icons.ts`)
renders Melo with headless Chrome from `@langquest/ui/art/web` on the Night Market canvas
(`DARK_COLORS.background`, lanterns from `DARK_COLORS.lantern`) and writes `assets/images/icon.png`
(1024), `splash-icon.png` (512, transparent), `android-icon-foreground.png` (512, transparent),
`android-icon-background.png` (512), `android-icon-monochrome.png` (432, white silhouette) and
`favicon.png` (48). `app.json` points iOS, Android and web at these files; the splash and adaptive
background colour is the canvas token value (`#0B0913`, regenerate when the token changes). The Expo
template images and the `expo.icon` composer folder were removed.

## 5. Characters (C2) on learner screens

- Mission/lesson: the mission's first `characters[]` entry is drawn as a `CharacterPortrait` (72 dp,
  speech-state ring, expression from the speech state) over the scene scrim, resolved to its portrait
  key through the course cast (`useCast` → `findCastCharacter`). The synthetic-voice badge stays.
- Mission cards (Home, Missions list): `features/characters/MissionCast.tsx` draws the manifest
  `characterIds` as a row of 28–32 dp **flat** portraits (`detail: 'flat'`, the ≤ 48 px LOD) with one
  accessible label; a mission without a cast simply has no row.
- Conversation: 96 dp portrait with the magenta speech ring; Characters list 72 dp; detail 160 dp
  (`density="full"` keeps the subtitle) + 56 dp expression strip.
- Roles ↔ situations are resolved server-side (`charactersForIntent`); the app only renders what the
  manifest carries.

## 6. Haptics (`lib/haptics.ts`, gated by `prefs.hapticsEnabled`)

Added on: mission card / pathway open, next step, compare verdict (success vs select), character turn
received in a conversation, starting a conversation (Home, Speak, character detail), enrollment created
or edited. Existing: mic start/stop, review rating, celebrations, bookmarks.

## 7. Verification (2026-10-19)

`npx tsc --noEmit` clean · `npx expo lint` clean · `vitest` 28 files / 168 tests (2 new for
`missionCast`) · `npx expo export --platform web` and `--platform ios` bundle · locales 94 tests with the
regenerated `coverage.json`. Not verified on a device: Lottie playback and haptics on hardware, the Rive
path (no rig yet), the low-end tier heuristic on real Android devices.
