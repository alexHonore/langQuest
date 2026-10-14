# ADR-005 — Async processing queue

**Status:** accepted (2026-10-14) · **Scope:** `apps/jobs`, `apps/api`, `packages/db`

## Context
Transcoding, transcription, alignment, metadata inference and imports are CPU/IO heavy and must not run in a Worker.
Cloudflare Queues require the Workers Paid plan; the account currently runs on the free plan.

## Decision
- `processing_jobs` in Postgres is the system of record. Default backend `JOBS_BACKEND=postgres`: the Node job runner
  claims work with `claim_processing_job()` (FOR UPDATE SKIP LOCKED), heart-beats, retries with backoff and marks
  `review_needed` on repeated failure. It runs on demand (CLI/cron/container), not 24/7.
- Optional backend `cloudflare_queues`: the Worker enqueues the job id; a queue consumer invokes the same handler.
  Enabled only when the account has Workers Paid; code paths share one handler registry.
- FFmpeg runs in the Node runner (never in Workers). Results are written to R2 with hashed keys and reconciled in DB.

## Consequences
- Zero fixed cost by default; exactly-once semantics come from DB claims + idempotent handlers (job id + content hash).
