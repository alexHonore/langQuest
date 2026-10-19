# UX observations from the live walkthrough (2026-10-19, web targets)

Captured while driving the mobile web build (Expo) and the admin (Next.js) against the local stack. Items for the polish pass:

1. Onboarding → sign-up: the track chosen during onboarding (Arabic (Moroccan) from French) did not appear as an enrollment on Home after account creation; Home showed the honest empty state instead. Verify that the onboarding state is replayed into `POST /v1/me/enrollments` after sign-up (may also have been a mis-click during the walkthrough).
2. Web dev warning on every screen: `Received \`true\` for a non-boolean attribute \`accessible\`` from `packages/ui/src/art/native.tsx` `<Svg accessible>`; on web use `role="img"` + `aria-label` instead.
3. Web dev warning: `<h1> cannot contain a nested <...>` on catalog/course screens (heading contains a block element).
4. Catalog card mixes languages in the French UI: "Not yet reviewed by native speakers" is untranslated; coverage badge text "Prévu à partir du" is truncated.
5. Visual plainness: screens are functional and accessible but flat (no motion, Expo default icon/splash still in place) — addressed by the approved design direction + polish pass.
6. Web cold load of /missions throws `this.validatePath is not a function` from `apps/mobile/src/features/audio/expo-fs-adapter.ts:21` (`new Directory(Paths.document, 'audio-packs')`): expo-file-system's `Directory` is native-only; the download FS adapter must be created lazily and replaced by a no-op/IndexedDB adapter on web.
7. After an editor sets a course × source coverage status to `partial` (admin → Languages / Locales), the mobile Missions tab still shows "Non disponible": check the availability rule (partial must show the pathway with a draft disclosure) and the manifest/coverage cache invalidation on the client.

## Resolution log (2026-10-19, evening)
- 1 (onboarding → enrollment replay): fixed — onboarding selection is replayed into `POST /v1/me/enrollments` after sign-up/sign-in (apps/mobile, unit-tested).
- 2 (`accessible` on web `<svg>`): fixed in packages/ui/src/art/native.tsx (platform-safe accessibility props).
- 3 (nested `<h1>`): fixed — AppShell header container no longer carries a heading role.
- 4 (untranslated coverage copy): fixed — keys added to en/fr catalogs; the catalog status wording ("Not offered") still needs a native French review.
- 5 (visual plainness): pending the owner's design choice (design/explorations).
- 6 (web `Directory` crash in expo-fs-adapter): fixed — the adapter is lazy and returns an "unsupported" implementation on web.
- 7 (Missions tab after coverage change): superseded by the capability snapshot (CONVENTIONS §8); missions appear when the pair is `partial`/`complete` with published, localized missions, and the 60 s capability cache is invalidated on publish.
