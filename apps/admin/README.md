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
  (`src/lib/api.ts`: `ROUTES`, request/response schemas, envelope + error codes). A small set of
  writes the contracts do not expose yet goes through local adapter routes under
  `app/api/admin/**` (`src/lib/local-api/*`): they run under the signed-in user's own Supabase
  session, so RLS stays the security boundary and the admin never holds a service-role key.
- **Reads** for lists use direct Supabase queries with explicit column lists
  (`src/lib/queries/*`), gated by the `staff_select` / `admin_select` policies.
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
reason (no JWT-accessible cancel RPC).
