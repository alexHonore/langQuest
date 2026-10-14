# ADR-001 — Mobile audio runtime

**Status:** accepted (2026-10-14) · **Scope:** `apps/mobile`

## Context
The learner app needs foreground/background playback of long MP3 lessons with lock-screen controls, rate changes,
seek/resume, interruptions (calls, Bluetooth), simultaneous microphone capture for speaking drills, and offline files.
Expo SDK 57 ships `expo-audio` (replacement for the deprecated `expo-av`) with native background playback,
lock-screen (Now Playing / MediaSession) metadata, playback rate with pitch correction, and a recorder API.

## Decision
- Use **`expo-audio`** as the single audio runtime (player + recorder). Enable `UIBackgroundModes: audio` on iOS and
  the foreground-service permission on Android through the config plugin.
- Wrap it behind `apps/mobile/src/audio/AudioEngine.ts` (play/pause/seek/rate/queue/sleep-timer/now-playing) and
  `Recorder.ts` (permissions, levels, push-to-talk and hands-free VAD hooks) so a different native SDK
  (e.g. `react-native-track-player`) can be swapped if QA finds gaps (tracked in `docs/provider-matrix/mobile-audio-qa.md`).
- Downloads via `expo-file-system` with a SQLite index (`expo-sqlite`), checksums from the manifest, and resumable transfers.

## Consequences
- One dependency for playback+recording; no Expo config-plugin forks. Background playback QA on both platforms is a
  Phase 3 acceptance gate (60-minute track, seek at 45 min, headphone reconnection, expired-URL renewal).
- If `expo-audio` fails a QA item, the engine interface stays and the implementation swaps.
