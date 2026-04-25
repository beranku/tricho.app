# traefik-edge Specification

## Purpose

The Traefik reverse proxy sits in front of CouchDB, `tricho-auth`, and the PWA static server (Caddy), providing TLS termination, single-origin routing, and shared security headers. Same-origin routing matters because it collapses the CORS and SameSite-cookie problems you'd otherwise inherit from having three services.

Source files: `infrastructure/traefik/docker-compose.yml`, `infrastructure/traefik/dynamic/middlewares.yml`, `infrastructure/traefik/Caddyfile`, `infrastructure/traefik/README.md`.

## Requirements

### Requirement: Only three public path prefixes
External traffic MUST reach CouchDB only via `/_replicator` and `/userdb-<hex>`. All other CouchDB admin paths (e.g. `/_config`, `/_all_dbs`, `/_session`) MUST NOT be routed publicly.

#### Scenario: Admin path is not reachable
- GIVEN the Traefik stack running in production
- WHEN an external client requests `GET /_all_dbs`
- THEN Traefik returns a 404 or routes to the PWA catch-all (not CouchDB)

### Requirement: `/auth/*` goes to tricho-auth
All requests under `/auth/*` MUST be routed to the `tricho-auth` service on its internal port (4545). `/` and everything else MUST fall through to the PWA static route.

#### Scenario: `/auth/health` reaches tricho-auth
- GIVEN the full Traefik stack up
- WHEN an external client requests `GET /auth/health`
- THEN the response is the JSON emitted by tricho-auth (`{"ok":true}`)

#### Scenario: unmatched path serves the PWA
- GIVEN a request for `GET /anywhere-not-auth-or-couchdb`
- WHEN Traefik routes it
- THEN the PWA static server answers, returning the SPA shell

### Requirement: TLS via Let's Encrypt
TLS certs MUST be acquired and renewed via Let's Encrypt's HTTP-01 challenge on the `web` entrypoint; HTTP MUST redirect to HTTPS.

#### Scenario: HTTP → HTTPS redirect
- GIVEN a production deployment with ACME configured
- WHEN a client requests `http://<host>/`
- THEN Traefik returns a 3xx redirect to `https://<host>/`

### Requirement: Security headers applied to every route
The `tricho-security` file-middleware MUST be attached to every router (`couch`, `auth`, `pwa`). Headers: `Strict-Transport-Security` (with `preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Content-Security-Policy` that keeps `default-src 'self'` with `frame-ancestors 'none'`.

#### Scenario: Response headers
- GIVEN any external response served through Traefik
- WHEN its headers are inspected
- THEN HSTS, CSP, and frame options are present and set as above

### Requirement: Same origin for PWA + CouchDB + auth
The PWA, `/auth/*`, and `/userdb-*` MUST all live under a single hostname so the browser treats them as same-origin. Cross-origin deployments are disallowed by configuration.

#### Scenario: One hostname, three services
- GIVEN the production compose stack
- WHEN the PWA fetches `/userdb-abcd.../doc` and `/auth/refresh`
- THEN neither call is cross-origin
- AND no CORS preflight is needed

### Requirement: Docker Compose layering
The stack MUST be expressible via a single root `compose.yml` whose `profiles:` select `dev`, `prod`, or `ci`. The previous "base CouchDB compose + Traefik overlay" structure is replaced; the base compose is either `include:`'d from the root file or inlined. Local-dev developers MUST still be able to hit CouchDB directly for debugging (e.g. `docker compose exec couchdb curl -s http://localhost:5984/_up`), but direct host-port bindings (`5984`, `4545`) MUST be gated behind the `dev` profile — prod and ci MUST NOT publish them on the host.

#### Scenario: Dev exposes debug ports
- GIVEN `dev` profile up
- WHEN the developer runs `curl -sf http://localhost:5984/_up`
- THEN CouchDB responds 200

#### Scenario: Prod does not expose debug ports
- GIVEN `prod` profile running on a production host
- WHEN any attacker outside the Docker network scans `5984` and `4545` on the host
- THEN the ports are closed (or firewalled) — only 80/443 via Traefik are open

### Requirement: Dev and CI profile variants
Traefik MUST expose three profile configurations behind the same routing contract:
- `prod`: Let's Encrypt via HTTP-01 on the real `APP_HOST`.
- `dev`: HTTP on `:80` bound to `tricho.localhost` **or** HTTPS with a developer-managed local CA (e.g. `mkcert`), configurable via env var.
- `ci`: HTTPS on `tricho.test` with a repo-committed (non-secret) self-signed certificate that the Playwright browser context trusts.

Across profiles, the three public path invariants (`/auth/*`, `/userdb-<hex>`, `/_replicator`) MUST remain identical. Only the TLS provider, hostname, and upstream identity of `/` (PWA dev container vs Caddy+dist) vary.

#### Scenario: Routing contract survives all three profiles
- GIVEN the stack running under any of `dev`, `ci`, or `prod`
- WHEN a client requests `/auth/health`, `/userdb-<hex>/`, `/_replicator`, and `/`
- THEN each request lands on the same service it would have in every other profile
- AND `/_all_dbs`, `/_config`, `/_session` remain unreachable externally

### Requirement: Vite HMR websocket upgrade is routed transparently
The `dev` profile MUST route `/` to the PWA dev container and MUST allow websocket upgrade on the same route so Vite's HMR connection succeeds without client-side configuration.

#### Scenario: HMR websocket upgrade succeeds through Traefik
- GIVEN `dev` profile up with a browser open at `https://tricho.localhost/`
- WHEN the Vite client opens its HMR websocket
- THEN Traefik returns `101 Switching Protocols`
- AND subsequent code edits trigger a partial reload in the open browser
