#!/bin/sh
# Starts the web app's static server (see the repository's root Dockerfile).
#
# First it writes /srv/config.json, which the app reads at start-up to find the learner's account backend: the
# Supabase URL and anon (publishable) key — both client-safe by design — and the API base URL. Nothing secret is ever
# read here. LQ_* variables win; otherwise the Supabase values the Infra Tayoo hosted app injects for browsers
# (NEXT_PUBLIC_SUPABASE_*) are used. With any value missing the app stays offline-only, as before.
set -eu

json_string() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

supabase_url="${LQ_SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
anon_key="${LQ_SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
api_base_url="${LQ_API_BASE_URL:-}"

if ! printf '{"supabaseUrl":%s,"supabaseAnonKey":%s,"apiBaseUrl":%s}\n' \
  "$(json_string "$supabase_url")" "$(json_string "$anon_key")" "$(json_string "$api_base_url")" > /srv/config.json; then
  echo "entrypoint: could not write /srv/config.json; the app stays offline-only" >&2
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
