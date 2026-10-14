# ADR-002 — Realtime voice architecture

**Status:** accepted (2026-10-14) · **Scope:** `packages/ai`, `apps/api`, `apps/mobile`

## Context
Low-latency spoken conversation is a hard product requirement (spec §8.6). OpenRouter is the preferred text router and
also exposes speech endpoints (`/api/v1/audio/transcriptions`, `/api/v1/audio/speech`) with many STT/TTS models.
True full-duplex providers need their own short-lived session tokens and vary in dialect coverage.

## Decision
- Define `RealtimeConversationProvider` (spec §8.2) with capability checks (`supports(locale, interruptible)`).
- Ship **`PipelineRealtimeProvider`** first: learner audio (push-to-talk or VAD-segmented) → STT adapter (OpenRouter
  transcriptions, per-locale model) → `CharacterAgent` (OpenRouter chat, streaming) → TTS adapter (OpenRouter speech,
  per-locale voice) streamed back; barge-in cancels TTS and in-flight generation via cancellation tokens. The evaluator
  runs asynchronously after each checkpoint on a cheaper model.
- Keep a `DuplexProviderStub` that reports `supports() = false` until a duplex provider is configured and benchmarked;
  the API hands out short-lived purpose-limited tickets only, never provider keys.
- Capability-aware fallback never crosses a variety boundary (no MSA for Darija, no Mandarin for Cantonese).

## Consequences
- Works today with existing credentials; latency is measured (time-to-first-audio) and recorded in telemetry.
- A duplex provider can be added behind the same interface when its dialect quality is verified.
