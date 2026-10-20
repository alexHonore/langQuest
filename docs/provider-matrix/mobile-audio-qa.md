# Mobile audio runtime QA (expo-audio, ADR-001)

Status legend: ✅ verified · ⏳ not yet run (needs a development build on a device/simulator) · ❌ failed · — not runnable yet (blocker named)

Verified in this build (web export + unit tests only; no device run was possible in the build environment):

| Item | Status | Evidence |
|---|---|---|
| Engine state machine (play/pause/seek/rate/queue/sleep timer) | ✅ | `apps/mobile/src/audio/*.test.ts` |
| Signed URL renewal before expiry and on 403 mid-stream, resume at position | ✅ (logic) | `apps/mobile/src/audio/url-renewal*.test.ts` |
| Download index + checksum mismatch handling + Wi-Fi gating | ✅ (logic) | `apps/mobile/src/features/audio/*download*.test.ts` |
| Listening-progress outbox idempotency | ✅ (logic) | `apps/mobile/src/features/audio/*progress*.test.ts` |
| Web bundle builds | ✅ | `npx expo export --platform web` |

Device QA still to run (spec §13 Phase 3 acceptance) — each needs a dev build (`eas build --profile development`) and real media (R2 must be enabled first):

| Item | iOS | Android |
|---|---|---|
| 60-minute original track plays to completion | ⏳ | ⏳ |
| Seek to 45:00 and resume accurately | ⏳ | ⏳ |
| Lock-screen / notification controls (play, pause, ±15 s) | ⏳ | ⏳ |
| Background playback continues after app is backgrounded | ⏳ | ⏳ |
| Headphone disconnect pauses; reconnect resumes | ⏳ | ⏳ |
| Phone-call interruption pauses and resumes | ⏳ | ⏳ |
| Playback rate 0.75× / 1.25× keeps pitch | ⏳ | ⏳ |
| Download → airplane mode → offline playback | ⏳ | ⏳ |
| Expired signed URL mid-playback renews without audible gap | ⏳ | ⏳ |
| Resume on second device with minimal position loss | ⏳ | ⏳ |
| Recorder metering for hands-free VAD in Speak tab | ✅ simulator (iPhone 17, iOS 27.0): `getStatus().metering` −31.8…−37.3 dBFS ambient, 200 ms samples | ⏳ |

If any item fails on expo-audio, the engine interface (`AudioEngine.ts`) is the swap point for `react-native-track-player` (ADR-001).

## iOS simulator pass — 2026-10-20 (`docs/evidence/device-qa-2026-10-19.md`)

First development build (Expo SDK 57.0.29, iPhone 17 simulator, iOS 27.0). Only recording-side items could be exercised:
R2 is not enabled and no audio collection is published, so every playback row above stays ⏳ (nothing to play).

| Item | iOS (simulator) | Notes |
|---|---|---|
| App launches with the expo-audio native module | ✅ after the UIScene fix | iOS 27 crashed at launch without a scene manifest (`apps/mobile/plugins/with-ios-scene-lifecycle.js`) |
| Microphone permission prompt (in context, on first mic press) | ✅ | "Allow “LangQuest” to access your microphone?" — usage text comes from the expo-audio plugin string |
| Permission denied → typed alternative, mic shown as unavailable | ✅ | a hold that lifts on the alert lands on "Don't Allow"; recover via Settings only |
| Push-to-talk recording → m4a → `/v1/speech/pronunciation-assess` | ✅ | 2.8 s and 12.7 s clips; Whisper large-v3 via OpenRouter, 1–3 s round trip |
| Recorder metering | ✅ | see row above |
| No numeric score without an acoustic assessor | ✅ | `assessmentMode: reference-comparison`, `numericScore: null` |
| Non-speech handled honestly | ❌ | Whisper hallucinates on ambient noise; evaluator answers "understood" / "partially understood" (server-side gate needed) |
| Clip player (TTS) in conversation | — | text-only conversation was run (brief); voice mode not exercised |
| Background / lock screen / interruptions / downloads / URL renewal | — | blocked by R2 + no published audio |
