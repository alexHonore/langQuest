# LangQuest learner app (Flutter) as a web app: built from apps/mobile_flutter, served as static files by Caddy.
# This is what the Infra Tayoo hosted app runs. In a wide browser window the app is shown at phone size.
#
#   docker build -t langquest-web .
#   docker run --rm -p 8080:8080 langquest-web          # then open http://localhost:8080
#
# The app works offline on its bundled content and keeps progress in the browser. /config.json publishes only the account
# backend's client-safe settings (Supabase URL and anon key, API URL), filled by Caddy from the environment
# (apps/mobile_flutter/deploy/Caddyfile); no other variable or secret of the host is read or served.

FROM debian:trixie-slim AS build

# Flutter 3.47.7 (apps/mobile_flutter/.metadata), checked against the commit of its release tag. A shallow clone is
# a fraction of the release archive's 1.6 GB; the engine version is pinned in the tagged tree.
ARG FLUTTER_VERSION=3.47.7
ARG FLUTTER_COMMIT=abaf9c523780a608bd46686fd5e53740a07077f8

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "$FLUTTER_VERSION" https://github.com/flutter/flutter.git /opt/flutter \
 && test "$(git -C /opt/flutter rev-parse HEAD)" = "$FLUTTER_COMMIT"

ENV PATH="/opt/flutter/bin:$PATH" PUB_CACHE=/opt/pub-cache CI=true FLUTTER_SUPPRESS_ANALYTICS=true
RUN flutter config --no-analytics --no-cli-animations \
 && flutter precache --web \
 && flutter --version

WORKDIR /src
# Dependencies first, so a code-only change reuses this layer.
COPY apps/mobile_flutter/pubspec.yaml apps/mobile_flutter/pubspec.lock ./
RUN flutter pub get --enforce-lockfile
COPY apps/mobile_flutter/ ./
# --no-web-resources-cdn: CanvasKit is served from this host, not fetched from a Google CDN.
RUN flutter build web --release --no-web-resources-cdn --no-wasm-dry-run
# The web engine downloads every font in the manifest at start-up: drop the icon package's unused weight variants
# (about 1.4 MB of a first visit). The tool refuses if the app ever imports one of their libraries.
RUN dart tool/prune_web_fonts.dart build/web

FROM caddy:2.11-alpine
COPY apps/mobile_flutter/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/build/web /srv
COPY apps/mobile_flutter/deploy/config.json /srv/config.json
# The Infra Tayoo hosted app health-checks 0.0.0.0:8080 and sets no PORT.
EXPOSE 8080
