# LangQuest HTTP API reference (OpenAPI 3.1)

`openapi.json` in this folder describes every route the Worker in `apps/api` serves. It is **generated**. Do not edit
it by hand.

## Regenerate

From the repo root:

```sh
pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts           # writes docs/api/openapi.json
pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts --check   # exit 1 if the file is stale (CI-style)
pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts --dry-run # build and report, write nothing
```

The generator needs no network, no database and no secrets. It reads source files only.

Regenerate after any change to:

- `ROUTES` in `packages/contracts/src/api/common.ts` (a new, renamed or re-classed route);
- a request or response Zod schema in `packages/contracts/src/api/*.ts` or `packages/contracts/src/manifest.ts`;
- a handler's `define('<key>', { role, auth, rate, idempotent })` options under `apps/api/src/routes/**`;
- `ROLE_SETS` (`apps/api/src/middleware/auth.ts`) or `RATE_POLICIES` (`apps/api/src/middleware/rate-limit.ts`).

`scripts/src/generate-openapi.test.ts` fails when `openapi.json` is stale. It also fails when a `ROUTES` key has no
entry in the route-to-schema table, when a path parameter has no validator, and when the table disagrees with a
handler: the schemas it parses, the 2xx statuses it answers with, or a role guard it adds on top of the route gate.

Verify with:

```sh
LANGQUEST_SKIP_LOCAL_STACK=1 pnpm --filter @langquest/scripts exec vitest run src/generate-openapi.test.ts
```

## How the document is built

| Piece | Source |
|---|---|
| Operations (method, path, `operationId` = route key, contract auth class) | `ROUTES`. There is one operation per entry, plus `GET /` and `GET /healthz`, which `apps/api/src/app.ts` registers outside `ROUTES`. |
| Request body, query parameters, success payload | `ROUTE_SCHEMAS` in `scripts/src/generate-openapi.ts`, which names the contracts schema each handler parses and returns. `ROUTES` carries no schemas: the pairing lives in the handlers, and this table was read off them. Where a handler widens or bounds a contract schema locally, the operation's description says so. |
| Success statuses | `ROUTE_SCHEMAS.success` (default 200). The test compares it with the status literals of every `respondOk(...)` and `new Response(...)` in the handler. Alternate statuses (replays, dry runs) are explained in the operation's description. |
| Handler role guards | `ROUTE_SCHEMAS.requiredRoles`, for a handler that narrows its route gate (`adminUserRoleGrant` and `adminUserRoleRevoke` are `super_admin` only behind the `admin` gate). The test compares it with the handler's `roles.includes('<role>')) throw problem.forbidden` guards. |
| Path parameters | `id`, `assetId`, `lessonId` and `userId` are UUIDs, `trackId` is a course track id, `task` is an AI task name and `role` is a staff role, matching the handlers' `parseParams` schemas. |
| Admin role set, auth override, rate-limit class, `Idempotency-Key` layer | Scanned from each handler's `define()` options. Role-set members come from `ROLE_SETS`, bucket sizes from `RATE_POLICIES`. |
| Components | Every Zod schema that `@langquest/contracts` exports, converted with Zod v4 `z.toJSONSchema` (draft 2020-12, the OpenAPI 3.1 dialect). Unreachable components are pruned. A request schema whose input view differs from its output view (because of defaults or coercion) gets a separate `<Name>Input` component when both views are used. |

A route that exists in `ROUTES` but not in the table still gets an operation: from the schema names its handler
parses (`x-langquest-schema-source: "handler-scan"`), or with a generic envelope (`"none"`). The test fails until the
route is added to `ROUTE_SCHEMAS`, so the checked-in document has every operation from the table.

The output is deterministic: keys are sorted recursively, there are no timestamps, and `info.version` is the
`@langquest/contracts` package version.

### Vendor extensions on each operation

| Extension | Meaning |
|---|---|
| `x-langquest-route-key` | The `ROUTES` key (`null` for `/` and `/healthz`) |
| `x-langquest-auth` | The contract auth class: `public`, `learner` or `admin` |
| `x-langquest-effective-auth` | Present only when the handler overrides the class. `authSessionRefresh` is `public` because the refresh token is the credential. |
| `x-langquest-role-set`, `x-langquest-roles` | Admin routes: the route gate's role set (`staff` by default) and the roles that can call the operation |
| `x-langquest-gate-roles` | Present only when the handler narrows the gate (`requiredRoles`): the gate's own roles. `x-langquest-roles` then lists the handler's narrower set. |
| `x-langquest-rate-class` | The abuse-control bucket. It applies after the per-client `ingress` bucket. These are operator guards, never learner quotas. |
| `x-langquest-handler` | The handler module under `apps/api/src/routes` |
| `x-langquest-schema-source` | `table`, `handler-scan` or `none` |

### Conventions the document encodes

- **Envelope.** Every JSON response is `{ ok: true, data }` or `{ ok: false, error: { code, message, details?, traceId? } }`
  (CONVENTIONS §3). The HTTP status mirrors `API_ERROR_HTTP_STATUS`.
- **Fail-closed configuration.** With missing or invalid Worker secrets, every path answers `503 provider_unavailable`
  "API is not configured yet" with `Retry-After: 300` (`apps/api/src/index.ts`). This is the `NotConfigured` response.
- **Authentication.** `bearerAuth` is the Supabase access token. The Worker verifies it and forwards it so that RLS applies.
- **Media stream.** `GET /v1/media/stream/{assetId}` is not JWT-authenticated. It takes the short-lived HMAC token `t`
  minted by `POST /v1/audio/assets/{id}/playback-url`, returns raw bytes (200/206) and answers 501
  `capability_unsupported` while R2 is not bound.

## View it

The file is plain OpenAPI 3.1 JSON, so any 3.1-capable viewer works. None is a dependency of this repo, so nothing
below is installed for you:

- Paste or upload the file into <https://editor.swagger.io> (Swagger Editor supports 3.1).
- Use your editor's OpenAPI preview (for example the VS Code "OpenAPI (Swagger) Editor" extension).
- Query it with `jq`, for example list the admin operations and their role sets:

  ```sh
  jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[] | select(.value["x-langquest-auth"]=="admin") | "\(.key|ascii_upcase) \($p) \(.value["x-langquest-role-set"])"' docs/api/openapi.json
  ```

## Limits (honest list)

- Success statuses are cross-checked only where the handler states them as literals. Where the status is computed
  elsewhere (`adminUploadInitiate`, `adminVisualAssetUploadInitiate`, `mediaStream`), the test only requires an
  explicit `ROUTE_SCHEMAS.success`. A 304 (`courseManifest` with a matching `If-None-Match`) is described, not listed.
- Role checks that apply only to some requests (verifying a rights grant, changing a visual asset's review status,
  another editor's upload session) appear neither in `requiredRoles` nor in the operation's role list.
- Response headers such as `ETag`, `Retry-After` or `Content-Disposition` appear only in operation descriptions, not
  as header objects.
- Error responses list the classes every route can hit (401/403/422/429/503 plus `default`), not every per-handler
  code (404, 409, 412, 451, 501).
