# ADR-004 — Versioned course and audio manifests

**Status:** accepted (2026-10-14) · **Scope:** `packages/media`, `apps/api`, `apps/mobile`, `apps/admin`

## Context
Course structure (chapters → missions → steps → asset refs) and audio collections are shared by every learner and
change only when editors publish. Mobile must not query Postgres per render and must work offline.

## Decision
- The API builds compact JSON manifests per `(courseTrackId, sourceLanguageCode, version)` and per audio collection,
  with a content checksum; non-personal manifests are edge-cached (Cache API + `Cache-Control`) and invalidated by the
  `manifest.invalidated` event on publish/unpublish.
- Manifests reference assets by id; signed playback URLs are fetched lazily per asset and renewed before expiry.
- Mobile stores manifests in SQLite, diffing by version/checksum; download packs are built from manifests.
- Changing an enrollment's source language only swaps the overlay layer (`sourceLanguageCode`), never the target layer.

## Consequences
- Static browsing costs ~0 DB reads; publishing is explicit and auditable; offline packs are deterministic.
