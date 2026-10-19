# LangQuest Studio (`apps/admin`)

Private administrator CMS for LangQuest — Next.js 16 App Router, Tailwind v4, React 19.

## Run

```bash
cp apps/admin/.env.example apps/admin/.env.local   # Supabase URL + anon key, API base URL
pnpm dev:admin                                       # http://localhost:3000
pnpm --filter @langquest/admin typecheck
pnpm --filter @langquest/admin test                  # vitest (lib: api client, upload engine, hashing, i18n)
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

## Honest states

Nothing is simulated: when the API is unreachable, analytics/model discovery/publishing show an
explicit "API unreachable" notice; cost today needs the admin role; the model test harness
reports "unavailable" unless the admin host has a server-only `OPENROUTER_API_KEY`; the
transcript editor draws a time ruler, not a fake waveform; job cancel is shown disabled with the
reason (no JWT-accessible cancel RPC); when the deployment has no media storage (R2 not enabled)
the visual-asset upload shows the API's `capability_unsupported` message verbatim and disables the
picker; stored visual assets have no preview (no signed URL route for them yet), only metadata.
