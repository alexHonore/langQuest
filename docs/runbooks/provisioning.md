# Provisioning runbook — what is live, what needs an owner action

_Last verified 2026-10-14 against the credentials supplied with the build brief._

| Provider | State found | Action needed (owner) | Cost note |
|---|---|---|---|
| **OpenRouter** | Key valid, $50/month key budget, 462 models incl. 26 STT + 35 TTS | none | pay-per-use; spend dashboard in admin |
| **Cloudflare account** | Global API key works (`wrangler whoami` OK); account id `b3db6259fa4bcfd65fa7c16d348ffcb3`; workers.dev subdomain `langquest-nsh` created by the build | Prefer a **scoped API token** (Workers Scripts:Edit, R2:Edit, Queues:Edit) for CI instead of the Global key | Workers free plan OK for the API |
| **Cloudflare R2** | **Not enabled** (`10042 Please enable R2 through the Cloudflare Dashboard`) | Dashboard → R2 → Enable (requires a payment method on the account). Then create buckets `langquest-media` (private) and `langquest-public`, and an R2 API token → put `R2_ACCESS_KEY_ID/SECRET/ENDPOINT` in Worker secrets and `.env` | R2 free tier 10 GB-month, then $0.015/GB-month; no egress fees; ops billed |
| **Cloudflare Queues** | Endpoint reachable, none created | Optional. Requires Workers Paid ($5/mo). Default job backend is Postgres polling (`JOBS_BACKEND=postgres`) | optional cost |
| **Supabase** | Org `alex Org` already has 2 active free projects (MAA, Tayoo's Project). Creating `langquest` was refused: _"maximum limits for the number of active free projects (2 project limit)"_ | Either (a) pause/delete one existing project you no longer need, or (b) upgrade the org to Pro, then run `pnpm supabase link --project-ref <ref>` and `pnpm supabase db push`. Until then the full stack runs locally with Docker (`pnpm supabase start`) | Pro is $25/mo — **not done by the build** |
| **Resend** | Key valid, domain `alexhonore.com` verified | Optional: configure Supabase Auth SMTP to use Resend for branded emails | free tier |
| **Azure Speech (pronunciation)** | no credentials | Optional for phoneme-level scoring on supported locales; set `AZURE_SPEECH_KEY/REGION` | pay-per-use |
| **Gemini / AWS / Twilio / VOIP.ms / n8n / Hostinger** | credentials present but not required by the spec | unused by LangQuest; keep out of the app | — |

## Deploy order once R2 + Supabase are available
1. `pnpm supabase link --project-ref <ref> && pnpm supabase db push` (migrations + catalog seed).
2. `cd apps/api && npx wrangler secret put SUPABASE_URL …` for every secret in `apps/api/wrangler.toml` `[vars]`/secrets list; `npx wrangler deploy`.
3. `cd apps/admin && vercel deploy` (or any Node host); set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`.
4. `cd apps/mobile && eas build` with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`.
5. Run `apps/jobs` on demand (`pnpm dev:jobs`) wherever ffmpeg is available.
