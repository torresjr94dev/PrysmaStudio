# syntax=docker/dockerfile:1.7
# Construye la PWA y la sirve con Caddy (TLS automático, cabeceras de seguridad, proxy al servidor).
FROM node:26-trixie-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends brotli \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.3.4
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
# Los parches de pnpm (pnpm-workspace.yaml → patchedDependencies) son parte de la instalación.
COPY patches patches
RUN pnpm install --frozen-lockfile
COPY packages/engine packages/engine
COPY apps/web apps/web
ARG VITE_SOURCE_URL
ARG VITE_SITE_URL
ENV VITE_SOURCE_URL=${VITE_SOURCE_URL} VITE_SITE_URL=${VITE_SITE_URL}
RUN pnpm --filter @prysmastudio/web build
# Precompresión: el WASM pasa de 10 MB a ~3.6 MB en brotli sin gastar CPU por petición.
RUN find apps/web/dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.wasm' -o -name '*.svg' -o -name '*.webmanifest' \) \
      -exec brotli --keep --best {} \; -exec gzip --keep --best {} \;

FROM caddy:2.11.7
COPY --from=build /src/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
