# LangQuest learner app (Flutter) as a web app: built from apps/mobile_flutter, served as static files by Caddy.
# This is what the Infra Tayoo hosted app runs. In a wide browser window the app is shown at phone size.
#
#   docker build -t langquest-web .
#   docker run --rm -p 8080:3000 langquest-web          # then open http://localhost:8080
#
# The app works offline on its bundled content and keeps progress in the browser. It reads no variables: none of the
# hosted app's variables (or secrets) are used by the build or end up in the files served.

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

FROM caddy:2.11-alpine
COPY apps/mobile_flutter/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/build/web /srv
EXPOSE 3000
