# Mobile audio runtime QA (expo-audio, ADR-001)

Status legend: ✅ verified · ⏳ not yet run (needs a development build on a device/simulator) · ❌ failed

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
| Recorder metering for hands-free VAD in Speak tab | ⏳ | ⏳ |

If any item fails on expo-audio, the engine interface (`AudioEngine.ts`) is the swap point for `react-native-track-player` (ADR-001).
