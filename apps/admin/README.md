# LangQuest Studio (`apps/admin`)

Private administrator CMS for LangQuest — Next.js 16 App Router, Tailwind v4, React 19.

## Run

```bash
cp apps/admin/.env.example apps/admin/.env.local   # Supabase URL + anon key, API base URL
pnpm dev:admin                                       # http://localhost:3000
pnpm --filter @langquest/admin typecheck
pnpm --filter @langquest/admin test                  # vitest (lib: api client, upload engine, hashing, i18n, setup status, roles)
pnpm --filter @langquest/admin build
pnpm --filter @langquest/admin test:e2e              # Playwright (login redirect always; role gate + uploads need test accounts)
```

Staff accounts are ordinary Supabase Auth users with a row in `public.user_roles`
(`super_admin | admin | content_editor | language_reviewer | support_readonly`). Learners are
refused at `/login?reason=norole`.

## Architecture

- **Auth**: `@supabase/ssr` cookies; `proxy.ts` refreshes the session and performs the optimistic
  staff gate; every layout/page re-checks with `requireStaff()` / `requireSection()`
  (`src/lib/auth/session.ts`). Sections ↔ roles live in `src/lib/auth/roles.ts`.
- **Writes** go to the LangQuest API through the typed client built from `@langquest/contracts`
  (`src/lib/api.ts`: `ROUTES`, request/response schemas, envelope + error codes): uploads,
  labels, processing, content publish / unpublish / request-review, speakers, library structure
  (collections → chapters → lessons, full-permutation reorders, lesson-asset attach / detach),
  content rights (create / patch / revoke-in-one-transaction), visual assets (upload-initiate →
  register → assign / replace / unassign) and the AI asset-suggestion queue (decide / bulk-decide /
  generate). Create / reorder / revoke calls carry an `Idempotency-Key`. A small set of writes the
  contracts do not expose yet goes through local adapter routes under `app/api/admin/**`
  (`src/lib/local-api/*`: coverage editorial status, transcript segments, role grants, revision
  rollback, job retry, model probes, editorial approve / reject of drafts): they run under the
  signed-in user's own Supabase session, so RLS stays the security boundary and the admin never
  holds a service-role key.
- **Reads** for lists use direct Supabase queries with explicit column lists
  (`src/lib/queries/*`), gated by the `staff_select` / `admin_select` policies.
- **Visual assets** (`/visual-assets`, §10.2A): image-only multipart upload through the same
  engine bound to `adminVisualAssetUploadInitiate` (`src/lib/upload/use-image-upload.ts`), then
  `adminVisualAssetRegister` with type, per-language alt text (`en` required), focal point
  (click / drag on the local preview), normalised crop, origin, license; assignment to course /
  audio covers, mission scenes, character portraits (`src/lib/visual/slots.ts` mirrors the API slot
  map); replacement stores new bytes under a NEW immutable key and moves assignments. The
  suggestion queue (`/asset-suggestions`, §7.4) shows proposal vs current value and confidence as
  reported; `applied` from the API is the only signal that a lesson changed.
- **Uploads** (`src/lib/upload/*`): folder traversal, chunked SHA-256 in a Web Worker pool,
  idempotent initiate → presigned multipart PUT (XHR, progress) → complete (checksum) → verify;
  pause/cancel/retry, IndexedDB persistence + resume by re-selecting the file, local and remote
  duplicate detection by content hash, ID3 preview via `music-metadata`. R2 bucket CORS must
  expose the `ETag` header.
- **i18n**: `@langquest/locales` (`admin.*` namespace) + `src/lib/i18n/extra.ts` (`admin.ui.*`),
  en + fr complete, cookie locale switch.
- **Art**: previews use the in-code SVG string renderers from `@langquest/ui` through the
  `@art/*` path alias (the package root re-exports React Native renderers, which cannot be
  bundled for the web).

## Honest states ("visible means usable", CONVENTIONS §8)

Nothing is simulated and nothing is greyed out. The studio layout observes the deployment once per
request (`src/lib/setup/status.ts`: public `/healthz` + `/v1/courses`, the public env and the admin
host's optional probe key — no new API route, no secret values) and hands the non-secret result to
every page (`useDeployment()` / `useSetupStatus()` in `src/lib/setup/context.tsx`):

- **Setup** (`/setup`, admins; first sidebar item while anything is unconfigured) is the one place
  that lists what is configured, the exact next step for what is not (Supabase local/hosted, API,
  R2 media storage, OpenRouter, Azure speech, Resend SMTP — the last one is "verify by hand" since
  the Studio cannot observe it) and which controls are hidden meanwhile. Settings shows the same
  live provider rows.
- Controls whose backing capability is missing are **not rendered**: the Uploads page becomes the
  Setup card without media storage; audio/image previews, the transcript play/seek buttons and
  visual-asset upload / replace do not exist without R2; "Generate" (content factory, AI
  suggestions), Benchmark, the Enable checkbox and smoke-tested saves do not exist without an AI
  route on the API; the AI test harness exists only with a server-side `OPENROUTER_API_KEY` on the
  admin host; rollback exists only for revisions with a snapshot; there is no job cancel button
  (no JWT-accessible cancel RPC).
- Empty lists are never an empty table: `DataTable` renders the primary action (e.g. "New rights
  record") with a one-line hint instead.
- **Languages** shows the course × instruction-language capability matrix read from the public
  coverage endpoint: exactly the disclaimer learners get before enrolling and which tabs the app
  renders afterwards (60 s public cache).
- When the API is unreachable, analytics/model discovery/publishing still show an explicit "API
  unreachable" notice; cost today needs the admin role; the transcript editor draws a time ruler,
  not a fake waveform; stored visual assets have no preview (no signed URL route for them yet).
