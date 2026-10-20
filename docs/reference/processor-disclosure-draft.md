# Third-party processor disclosure: DRAFT for counsel review

> **DRAFT. Not legal advice and not learner-facing.** This is an engineering inventory of the third parties the
> LangQuest code actually calls, what learner data each one receives on those code paths, and what each provider's
> own published policy says about region and retention. It is an input for counsel (traceability **R-11-11**:
> "counsel consulted before broad release") and for the learner-facing disclosure (R-11-05). Policy facts were read
> on **2026-10-20** from the URLs cited. "To confirm" means the fact could not be verified from an official source on
> that date. Nothing marked that way should be published as fact.
>
> **Still needed:** a learner-facing disclosure screen (or privacy-notice section) listing these processors, regions
> and retention. The mobile app is owned by another work session, so no screen was built here; see §6.

Written 2026-10-20 from the repository at that date. Requirement R-11-05: "Provider disclosure: third-party AI
processors, data regions and actual retention policies".

## 1. Method

- **Code search**:
  - `packages/ai` (OpenRouter client, reasoner, speech adapters, voice registry, default model profiles);
  - `apps/api` (routes and services);
  - `apps/jobs`;
  - `packages/telemetry` (sinks);
  - `apps/mobile/package.json`;
  - every hard-coded external URL in `apps/*/src`, `packages/*/src` and `scripts/src`.
- **Models actually routed**:
  - `DEFAULT_PROFILES` in `packages/ai/src/profiles.ts`. All 12 `ai_model_profiles` rows on the local stack are
    `enabled = false`, so the package defaults are what runs.
  - The TTS voice registry in `packages/ai/src/speech/voices.ts`.
- **Upstream observed**: a read-only query of `ai_requests.redacted_log->>'provider'` on the local stack
  (2026-10-19/20). This is the provider OpenRouter selected for each text call.
- **Policies**: the providers' official pages, linked in each row with the date read.

## 2. Summary

| # | Processor | Role | Status today | Learner data received (code paths) | Data region (provider policy) | Retention (provider policy) |
|---|---|---|---|---|---|---|
| 1 | **OpenRouter, Inc.** | AI gateway for every LLM, STT and TTS call | Active (live key in local env; Worker secret not set in production) | Learner speech audio, learner utterance text, conversation context, a pseudonymous learner id (§3.1) | Personal data may be transferred to its US servers and to other countries outside the EEA/UK ([privacy policy](https://openrouter.ai/privacy), "Last Updated: August 31, 2026", read 2026-10-20). Optional EU or US in-region routing on Business/Enterprise plans ([privacy and logging](https://openrouter.ai/docs/features/privacy-and-logging)). | "OpenRouter does not store your prompts or responses, unless you opt in"; request metadata (token counts, latency) is stored ([data collection](https://openrouter.ai/docs/guides/privacy/data-collection), read 2026-10-20). Fixed retention periods for account data and logs: to confirm (none stated). |
| 2 | **Upstream model providers chosen by OpenRouter** | Inference | Active through #1 | Whatever OpenRouter forwards for the task (§3.2) | Per provider (§3.2) | Per provider (§3.2) |
| 3 | **Supabase** | Postgres database and Auth | Local Docker only; hosted project not created (B-SUPABASE) | Everything the app stores about a learner (§3.3) | Project region is chosen at creation and determines where primary project data is stored ([regions](https://supabase.com/docs/guides/platform/regions), read 2026-10-20). Region not yet chosen. | Supabase acts "primarily as a processor" for customer data under its DPA ([privacy](https://supabase.com/privacy), read 2026-10-20). Retention is what LangQuest configures (§4). Post-deletion retention: to confirm in the DPA. |
| 4 | **Cloudflare** | Workers (API runtime and logs); R2 (media), KV and Queues optional | Worker deployed but unconfigured; R2 not enabled (B-R2); KV not created; Queues unused | All API traffic including client IP; structured logs with learner text redacted; opt-in learner recordings and TTS cache in R2 once enabled (§3.4) | Workers run on Cloudflare's network. R2 bucket location is automatic or set by hint ("best effort") unless an `eu` or `us` jurisdiction is chosen at creation, which "guarantee[s] objects in a bucket are stored within a specific jurisdiction" ([R2 data location](https://developers.cloudflare.com/r2/reference/data-location/), read 2026-10-20). | Workers Logs: 3 days (Free) and 7 days (Paid) ([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), read 2026-10-20). R2 objects persist until LangQuest deletes them. Cloudflare's own retention of request metadata: to confirm. |
| 5 | **Microsoft Azure AI Speech** | Phoneme-level pronunciation assessment | **Not configured** (no `AZURE_SPEECH_KEY`, B-AZURE). Code path exists. | 16 kHz PCM WAV of the learner's attempt plus the reference text (§3.5) | The region of the Speech resource (`AZURE_SPEECH_REGION`; endpoint `https://<region>.stt.speech.microsoft.com`) | "When doing real-time speech to text, fast transcription, pronunciation assessment, and speech translation, Microsoft does not retain or store the data provided by customers" ([Speech to text data, privacy, and security](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security), ms.date 2026-03-31, read 2026-10-20) |

**Not processors today:** they are present in code or configuration, but no learner data reaches them.

| Service | Why it receives no learner data |
|---|---|
| Resend | `RESEND_API_KEY` is "not wired yet" (`.env.example`). The planned use is Supabase Auth SMTP, which would send the learner's e-mail address and auth e-mails. `createResendAlertTransport` exists for operator alerts but no app constructs it. |
| PostHog | `PostHogSink` (default host `https://eu.i.posthog.com`) exists in `packages/telemetry/src/sinks.ts`, but no app constructs it. |
| Sentry | Listed in `.env.example`; no SDK is installed. |
| Expo push | `expo-notifications` is used only to request permission (`apps/mobile/src/app/account/notifications.tsx`). No push token is sent and no server calls Expo's push service. |
| Expo EAS Build, App Store, Google Play | Build and distribution only. No API path sends learner data to them; store-side analytics are outside this inventory (to confirm with counsel). |
| Cloudflare API (`api.cloudflare.com`) | Used only by the optional Queues pull consumer (`apps/jobs/src/queue/cloudflare-queues.ts`), with job ids, no learner content. Not enabled. |

## 3. Detail per processor

### 3.1 OpenRouter (gateway)

**Code:**

- `packages/ai/src/openrouter/client.ts` (`https://openrouter.ai/api/v1`, endpoints `/chat/completions`,
  `/audio/transcriptions`, `/audio/speech`);
- `packages/ai/src/reasoner.ts`;
- `apps/api/src/services/ai.ts`;
- routes `apps/api/src/routes/speech/{speech,conversation}.ts` and `routes/learner/missions.ts` (meaning assessment);
- `apps/jobs` (transcription, content generation, metadata inference) and `scripts` (content factory).

**Learner data sent:**

| Code path | Sent to OpenRouter |
|---|---|
| `POST /v1/speech/transcribe`, conversation turns with audio | The learner's recorded audio clip (base64 JSON or multipart) and the target locale |
| Conversation turn: character agent (`packages/ai/src/prompts/builders.ts`, `character.turn`) | The learner's utterance text ("Learner just said"), the character's previous line, a running conversation summary, relationship memory, mission scene and objectives, target variety, source language and learner level. The builder adds no learner name or e-mail. |
| Evaluator and summariser (`packages/ai/src/conversation/*`) | Learner turns for structured observations and the session summary |
| Mission evaluation / meaning assessment (`packages/ai/src/semantic/meaning.ts`) | The learner's answer text and the expected intent |
| `POST /v1/speech/synthesize`, character voice | Character text only (no learner content) |
| `POST /v1/speech/pronunciation-assess` (reference-comparison mode) | The learner's clip for STT against a published reference |

**Identifiers:** the reasoner sends `user: <pseudonym>`, where the pseudonym is
`pseudonymizeLearnerId(userId, LEARNER_PSEUDONYM_SALT)` (`apps/api/src/services/ai.ts`; `packages/telemetry/src/privacy.ts`).
This is an HMAC-derived pseudonym, never an e-mail. Log lines redact learner text (`redactChatRequest`).

**Zero data retention.** The client supports OpenRouter routing preferences (`provider`, for example
`{ zdr: true }`, `client.ts`), but **no caller sets them today**. OpenRouter documents that `zdr: true` routes "only
to endpoints that have a Zero Data Retention policy", and that the same can be enforced account-wide in privacy
settings ([ZDR](https://openrouter.ai/docs/guides/features/zdr), read 2026-10-20). Whether the LangQuest OpenRouter
account has ZDR or "no training" enabled: **to confirm** (owner dashboard).

### 3.2 Upstream model providers (selected by OpenRouter per request)

OpenRouter forwards the request to a provider hosting the requested model, and may fall back between providers. The
upstream is therefore decided per request, not by LangQuest. For text tasks the chosen upstream is recorded in
`ai_requests.redacted_log->>'provider'`. Speech calls do not record it.

| Model id (`packages/ai/src/profiles.ts`, `speech/voices.ts`) | Tasks | Upstream observed (local ledger 2026-10-19/20) | Upstream policy (region, retention) |
|---|---|---|---|
| `anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5` | character dialogue, learner evaluation, scene planning, source explanation, meaning assessment, language-quality check, content generation | **`Azure`** (5 rows with an upstream recorded; 6 earlier rows have none) | Anthropic itself, when it is the upstream: "we automatically delete inputs and outputs on our backend within 30 days of receipt or generation". Exceptions: longer-retention services, agreements, Usage Policy enforcement (flagged content "for up to 2 years") and law ([Anthropic privacy center](https://privacy.claude.com/en/articles/7996866-how-long-does-anthropic-store-my-organizations-data), updated 2026-07-01, read 2026-10-20). **When the upstream is Microsoft Azure, as observed: Azure's terms for hosted Claude models apply. Region and retention to confirm.** |
| `google/gemini-3.8-flash`, `google/gemini-3.5-flash-lite`, `google/gemini-3.5-transcribe`, `google/gemini-3.8-flash-lite-tts` | dialogue and evaluation fallbacks, meaning assessment, language-quality check, STT, TTS | `Google` (1 row) | Gemini API paid services: Google "doesn't use your prompts … or responses to improve our products"; it "logs prompts and responses for a limited period of time, solely for detecting and preventing violations"; data "may be stored transiently or cached in any country in which Google or its agents maintain facilities" ([Gemini API terms](https://ai.google.dev/gemini-api/terms), last modified 2026-04-28, read 2026-10-20). Whether OpenRouter's "Google" upstream is AI Studio or Vertex AI: to confirm. The length of the abuse-logging period: to confirm. |
| `deepseek/deepseek-v4.1-flash` | fallback for dialogue, evaluation, meaning, scene planning, explanation | not observed | Depends on which host OpenRouter picks. If DeepSeek itself: its privacy policy says "we directly collect, process and store your Personal Data in People's Republic of China" and keeps inputs "for as long as you have an account" ([DeepSeek privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html), last updated 2026-02-10, read 2026-10-20). That is the consumer policy; the API terms are to confirm. **Counsel flag: possible transfer of learner text to the PRC on fallback.** |
| `openai/whisper-large-v3` | STT, transcription alignment | not recorded (speech) | Inference host chosen by OpenRouter: **to confirm**. OpenAI's API policy applies only if OpenAI is the host. |
| `elevenlabs/scribe-v2`, `elevenlabs/eleven-flash-v2.5`, `elevenlabs/eleven-v3` | STT and alignment fallbacks, TTS | not recorded | ElevenLabs' privacy policy says personal information "will be transferred to the United States for storage". It does not cover data processed through business customers, whose contracts govern ([ElevenLabs privacy policy](https://elevenlabs.io/privacy-policy), updated 2026-10-09, read 2026-10-20). Through OpenRouter, the OpenRouter–ElevenLabs terms apply: to confirm. Training on API inputs under those terms: to confirm. |
| `microsoft/mai-voice-2.1-flash` | TTS | not recorded | Host and retention: to confirm |
| `hexgrad/kokoro-82m` | TTS (open-weights model) | not recorded | Inference host chosen by OpenRouter: to confirm |

**Learner audio crosses this boundary.** STT models receive learner speech. Voice recordings may be personal or
biometric data. Microsoft's Speech documentation explicitly assigns notice and consent duties for biometric data to
the customer. Counsel to advise.

### 3.3 Supabase (database and Auth)

**Code:** `packages/db`, `apps/api` (RLS-forwarded JWT plus a service client), `apps/jobs`, `apps/admin`.
**Data held (by table; see `docs/reference/database-diagram.md`):**

- Auth: e-mail and password hash (`auth.users`).
- Account: profile, settings and locale (`profiles`, `account_settings`).
- Learning: enrollments, mastery, reviews, mission attempts and progress, XP, streaks, daily metrics, sync events.
- Conversations: `conversation_sessions` with summaries; `conversation_turns` with learner text, `expires_at` set from
  `speech_retention`.
- Evaluator observations (`learning_observations`).
- Audio: library progress, bookmarks, download manifests.
- `media_assets` rows for opt-in recordings; the bytes go to R2, not Supabase Storage.
- Feedback and moderation incidents.
- `ai_requests`: learner `user_id`, model, cost and a redacted log.
- `audit_logs`: `ip_hash`, a hash of the client key, never the raw IP (`apps/api/src/services/context.ts`).

**Region:** not chosen yet. The project has not been created. Choose it with counsel: Supabase recommends a
specific AWS region rather than a general region grouping when there are data-residency requirements
([regions](https://supabase.com/docs/guides/platform/regions)).

### 3.4 Cloudflare

| Service | Learner data | Code |
|---|---|---|
| Workers (API) | Every request: the bearer token (verified, then forwarded to Supabase), bodies including learner audio clips, and the client IP. The app derives `clientKey = sha256(ip \| anon-key prefix)` for rate limiting; the raw IP is not stored by LangQuest. | `apps/api/src/app.ts` |
| Workers Logs (`[observability] enabled = true`) | Structured log lines with learner text redacted; invocation metadata | `apps/api/wrangler.toml`, `middleware/logging.ts` |
| R2 (`MEDIA`, S3 credentials); not enabled | Opt-in learner recordings (`opt_in_30_days`, `opt_in_until_deleted`; `apps/api/src/routes/speech/speech.ts`), TTS cache, course media | `apps/api/src/services/r2.ts`, `apps/jobs/src/r2.ts` |
| KV (`RATE_LIMIT`, `IDEMPOTENCY`); not created | Rate-limit buckets keyed by hashed client key or user id. **The idempotency cache stores replayed response bodies**, which can contain learner data, for its TTL. | `apps/api/src/middleware/{rate-limit,idempotency}.ts` |

### 3.5 Microsoft Azure AI Speech (not configured)

`packages/ai/src/speech/pronunciation.ts` refuses non-WAV input ("Azure scripted assessment requires 16 kHz PCM WAV
input"). It also refuses any locale whose variety differs from the target. When configured it receives the
learner's attempt audio and the reference text. It is enabled only when both `AZURE_SPEECH_KEY` and
`AZURE_SPEECH_REGION` are set (`apps/api/src/lib/course-capabilities.ts`).

## 4. LangQuest's own retention (what the code sets)

| Data | Rule in code | Enforced? |
|---|---|---|
| Conversation turns (text) | `expires_at` = 24 h by default, 30 days for `opt_in_30_days`, never for `opt_in_until_deleted` (trigger `set_conversation_turn_retention`, `070_rls.sql`) | `expires_at` is set. **No purge job deleting expired turns was found** in `apps/jobs` or the migrations (gap; to confirm). |
| Learner recordings | Kept only for `opt_in_30_days` or `opt_in_until_deleted` and only when media storage exists (`retainRecording`, `speech.ts`). `none` and `session` are never stored. | Storage gating yes; 30-day deletion job: **not found** (gap) |
| `RETENTION_POLICY` constants (`packages/telemetry/src/privacy.ts`) | Telemetry events 90 days; daily metrics 730; `ai_requests` 180; learner audio 30; transcripts 365; crash reports 90; audit logs 1825 | Constants only. **No scheduled purge uses them** (gap) |
| Account deletion | `DELETE /v1/me` → `delete_account` RPC deletes the learner's rows and anonymises retained ledgers (cost, audit, safety); the auth user is deleted or banned and anonymised (`apps/api/src/routes/learner/account.ts`) | Yes |
| Export | `GET /v1/me/export` (profile, enrollments, progress, summaries; raw recordings referenced by id) | Yes |

## 5. Open items for counsel (R-11-11)

1. **Cross-border transfers:** US (OpenRouter, ElevenLabs, likely Supabase and Cloudflare defaults), "any country"
   (Google), and the **PRC if the DeepSeek fallback is served by DeepSeek**. Decide whether to drop the DeepSeek
   fallback or to enforce ZDR/no-training routing (`provider: { zdr: true }` is supported by the client but unused).
2. **Voice data:** learner speech goes to STT upstreams through OpenRouter. Decide whether it is biometric data in the
   target jurisdictions, and what consent is needed.
3. **Children:** a search of `apps/mobile/src`, `apps/api/src` and `packages/contracts/src` found no age gate or
   date-of-birth field. `docs/runbooks/mobile-release.md` lists the age-rating and youth-account decision as open.
   Counsel to advise before broad release (R-11-11 names children's voices).
4. **DPAs and sub-processor lists** to execute or review: OpenRouter, Supabase, Cloudflare, plus the upstreams that
   OpenRouter's terms make sub-processors.
5. **Retention promises vs. enforcement:** §4 lists constants with no purge job. Do not publish retention periods
   until the jobs exist.
6. **Account settings to confirm on the dashboards** (owner): OpenRouter privacy settings (prompt logging off,
   training opt-out, ZDR); Supabase region; R2 jurisdiction at bucket creation (immutable afterwards).

## 6. Learner-facing disclosure: still to build

Not built in this change: `apps/mobile` is owned by another session, and learner-facing designs need owner approval
first (`docs/HANDOFF.md` §4). The screen or privacy-notice section needs:

- a plain list of the processors in §2 rows 1–5 (and the upstream families in §3.2), what each receives and why;
- regions and retention **only where §2 and §3 cite a verified source**; "to confirm" items stay out until confirmed;
- the learner's own controls: speech retention choice (`privacy_options.store_speech_recordings`: `none`, `session`,
  `opt_in_30_days`, `opt_in_until_deleted`), export (`GET /v1/me/export`) and deletion (`DELETE /v1/me`);
- the honesty rules: no numeric pronunciation score without an acoustic assessor (ADR-006); no paywall.

The store-listing prerequisites already call for "the §11 provider disclosure (third-party AI processors, regions,
retention)" (`docs/runbooks/mobile-release.md` §4).
