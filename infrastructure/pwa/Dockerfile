# Multi-stage Dockerfile for the TrichoApp PWA.
#
# Targets:
#   dev      Astro/Vite dev server on :4321 with HMR. Bind-mounted source in dev.
#   builder  Intermediate — runs `npm run build` to produce /app/dist.
#   prod     Caddy serving the built bundle at :80 behind Traefik.
#
# Build context is the repo root (`.`) so the Dockerfile can see package.json,
# src/, public/, astro.config.mjs, and the Caddyfile under infrastructure/pwa/.
# Use `.dockerignore` at repo root to keep node_modules / dist / .git out of
# the context.

# ── Shared dependency layer ─────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Dev: astro dev server (used by the `dev` profile) ───────────────────────
FROM deps AS dev
COPY . .
EXPOSE 4321
CMD ["npx", "astro", "dev", "--host", "0.0.0.0", "--port", "4321"]

# ── Build: produce dist/ ────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npm run build

# ── Prod: Caddy-served static bundle (used by `prod` and `ci` profiles) ─────
FROM caddy:2-alpine AS prod
COPY --from=builder /app/dist /srv
COPY infrastructure/pwa/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
