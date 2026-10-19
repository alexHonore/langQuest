# Upcoming / hidden features (developer-facing)

Per the "visible means usable" rule (docs/CONVENTIONS.md §8), these features exist in code but are hidden from learners
until their unlock condition is met. The enrollment wizard discloses the relevant items per course × instruction language.

| Feature | Where it lives | Hidden when | Unlock condition |
|---|---|---|---|
| Audio library tab, player, downloads | apps/mobile/src/features/audio | the enrollment's course has no published audio collections, or media storage (R2) is not configured | admin publishes a rights-verified collection for that course; R2 enabled + secrets set |
| Mission pathway / story map | apps/mobile/src/features/missions | the course × source has no published missions | `seed-curriculum --apply` + editorial publish, or content factory drafts approved |
| Live AI conversation | apps/mobile/src/features/conversation | no published characters for the course variety, or AI text route disabled | characters seeded (migration 130) + `ai_model_profiles` enabled |
| Numeric pronunciation score | apps/mobile pronunciation coach | the variety has no acoustic assessor (Azure locales list) | `AZURE_SPEECH_KEY/REGION` set and the locale is supported (ADR-006) |
| Offline download pack | apps/mobile/src/features/audio/downloads | R2 not configured | R2 enabled |
| Full-duplex realtime voice | packages/ai realtime | always (DuplexProviderStub) | a benchmarked duplex provider is configured (ADR-002) |
| Partial interface languages (es, ru) | packages/locales | catalog completeness < 100% | catalogs completed and reviewed |
| Account export / deletion | apps/mobile account screen | never hidden (always usable) | — |

_This file is maintained by the polish pass; the enrollment wizard reads the live capability snapshot from the API, not this file._
