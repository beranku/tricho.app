# Multi-stage Dockerfile for the TrichoApp PWA.
#
# Targets:
#   dev      Astro/Vite dev server on :4321 with HMR. Bind-mounted source in dev.
#   builder  Intermediate — runs `npm run build` to produce /app/dist.
#   prod     Caddy serving the built bundle at :80 behind Traefik.
#
# Build context is the repo root (`.`) so the Dockerfile can see app/package.json,
# app/src/, app/public/, app/astro.config.mjs, and the Caddyfile under
# infrastructure/pwa/. Use `.dockerignore` at repo root to keep node_modules /
# dist / .git out of the context.
#
# After marketing-site-and-pwa-split: PWA sources moved from repo root into
# app/ — paths below reflect that. The marketing site (web/) and the merge
# pipeline (scripts/merge-dist.mjs) ship via Cloudflare Pages, not this image;
# this Dockerfile remains for the local docker compose stack used by e2e and
# stack-orchestration.

# ── Shared dependency layer ─────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# bash + curl are required by the npm `prebuild` hook
# (`bash scripts/fetch-fonts.sh` downloads woff2 files via curl). The
# node:22-alpine base ships with /bin/sh and wget only, so install both.
RUN apk add --no-cache bash curl
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Dev: astro dev server (used by the `dev` profile) ───────────────────────
FROM deps AS dev
COPY app/ .
EXPOSE 4321
CMD ["npx", "astro", "dev", "--host", "0.0.0.0", "--port", "4321"]

# ── Build: produce dist/ ────────────────────────────────────────────────────
FROM deps AS builder
# Empty PUBLIC_AUTH_PROXY_URL means "same origin" (the PWA reaches
# tricho-auth via Traefik on the same host as the PWA). Without this,
# the bundled fallback `http://localhost:4545` is hard-coded into the
# build, which the page CSP blocks at runtime.
ARG PUBLIC_AUTH_PROXY_URL=""
ENV PUBLIC_AUTH_PROXY_URL=${PUBLIC_AUTH_PROXY_URL}
ARG PUBLIC_BILLING_ENABLED="true"
ENV PUBLIC_BILLING_ENABLED=${PUBLIC_BILLING_ENABLED}
COPY app/ .
RUN npm run build

# ── Prod: Caddy-served static bundle (used by `prod` and `ci` profiles) ─────
FROM caddy:2-alpine AS prod
COPY --from=builder /app/dist /srv
COPY infrastructure/pwa/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
