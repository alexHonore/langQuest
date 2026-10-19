# UX observations from the live walkthrough (2026-10-19, web targets)

Captured while driving the mobile web build (Expo) and the admin (Next.js) against the local stack. Items for the polish pass:

1. Onboarding → sign-up: the track chosen during onboarding (Arabic (Moroccan) from French) did not appear as an enrollment on Home after account creation; Home showed the honest empty state instead. Verify that the onboarding state is replayed into `POST /v1/me/enrollments` after sign-up (may also have been a mis-click during the walkthrough).
2. Web dev warning on every screen: `Received \`true\` for a non-boolean attribute \`accessible\`` from `packages/ui/src/art/native.tsx` `<Svg accessible>`; on web use `role="img"` + `aria-label` instead.
3. Web dev warning: `<h1> cannot contain a nested <...>` on catalog/course screens (heading contains a block element).
4. Catalog card mixes languages in the French UI: "Not yet reviewed by native speakers" is untranslated; coverage badge text "Prévu à partir du" is truncated.
5. Visual plainness: screens are functional and accessible but flat (no motion, Expo default icon/splash still in place) — addressed by the approved design direction + polish pass.
6. Web cold load of /missions throws `this.validatePath is not a function` from `apps/mobile/src/features/audio/expo-fs-adapter.ts:21` (`new Directory(Paths.document, 'audio-packs')`): expo-file-system's `Directory` is native-only; the download FS adapter must be created lazily and replaced by a no-op/IndexedDB adapter on web.
7. After an editor sets a course × source coverage status to `partial` (admin → Languages / Locales), the mobile Missions tab still shows "Non disponible": check the availability rule (partial must show the pathway with a draft disclosure) and the manifest/coverage cache invalidation on the client.
