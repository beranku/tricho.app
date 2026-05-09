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

All requests under `/auth/*` MUST be routed to the `tricho-auth` service on its internal port (4545). For the **single-host stack-orchestration topology** (the `dev`, `prod`, `ci` profiles of the root `compose.yml`), `/` and everything else MUST fall through to the PWA static route. For the **server-deploy topology** (`tricho-sync-<env>` running on a dedicated host with PWA hosted on Cloudflare Pages), there MUST NOT be any PWA fall-through — unmatched paths MUST return 404 from Traefik so an accidentally-pointed DNS record cannot serve a stale or absent SPA shell from the sync host.

#### Scenario: `/auth/health` reaches tricho-auth (both topologies)

- **GIVEN** the full Traefik stack up in either topology
- **WHEN** an external client requests `GET /auth/health` on the appropriate hostname
- **THEN** the response is the JSON emitted by tricho-auth (`{"ok":true}`)

#### Scenario: Unmatched path serves the PWA — single-host topology only

- **GIVEN** the single-host stack-orchestration profile (root `compose.yml` `dev`/`prod`/`ci`)
- **WHEN** a request `GET /anywhere-not-auth-or-couchdb` arrives at the configured `APP_HOST`
- **THEN** the PWA static server answers, returning the SPA shell

#### Scenario: Unmatched path returns 404 — server-deploy topology

- **GIVEN** a `tricho-sync-<env>` stack on the deploy host with `Host(\`sync.<env>.tricho.app\`)` routers
- **WHEN** a request `GET /not-auth-not-userdb-not-replicator` arrives at the sync host
- **THEN** Traefik returns 404
- **AND** no PWA content is served from the sync host

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

### Requirement: Same origin for PWA + CouchDB + auth — single-host topology

For the **single-host stack-orchestration topology** (dev / prod / ci profiles of the root `compose.yml`), the PWA, `/auth/*`, and `/userdb-*` MUST all live under a single hostname so the browser treats them as same-origin. Cross-origin deployments are disallowed in this topology. This requirement DOES NOT apply to the server-deploy topology (`tricho-sync-<env>`); see "Cross-origin sync hostnames" below for that topology's contract.

#### Scenario: One hostname, three services (single-host topology)

- **GIVEN** the production compose stack running under the single-host topology
- **WHEN** the PWA fetches `/userdb-abcd.../doc` and `/auth/refresh`
- **THEN** neither call is cross-origin
- **AND** no CORS preflight is needed

### Requirement: Cross-origin sync hostnames in the server-deploy topology

In the **server-deploy topology**, the PWA is hosted on Cloudflare Pages (`https://tricho.app` for production, `https://dev.tricho.app` for development), and the sync stack is hosted on a dedicated server under `https://sync.tricho.app` and `https://sync.dev.tricho.app` respectively. These are same registrable site (`tricho.app`), different origin. The edge Traefik on the deploy host MUST set, on every `tricho-auth`-served response:

- `Access-Control-Allow-Origin: <exact paired PWA origin>` (e.g., `https://tricho.app` for `sync.tricho.app`; never `*`)
- `Access-Control-Allow-Credentials: true`
- `Vary: Origin`
- `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` enumerating only the methods and headers `tricho-auth` actually accepts

Cookies set by `tricho-auth` MUST use `Domain=tricho.app` (registrable apex), `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Lax` so they survive cross-origin top-level navigation between the PWA host and the sync host while still defending against cross-site request forgery from third-party sites.

#### Scenario: CORS preflight from the paired PWA origin succeeds

- **GIVEN** the prod sync stack running with paired origin `https://tricho.app`
- **WHEN** the PWA makes a credentialed `fetch` to `https://sync.tricho.app/auth/refresh` and the browser issues an `OPTIONS` preflight
- **THEN** Traefik returns 204
- **AND** the response includes `Access-Control-Allow-Origin: https://tricho.app` (exact match)
- **AND** `Access-Control-Allow-Credentials: true` is present
- **AND** `Vary: Origin` is present

#### Scenario: CORS request from a different origin is rejected

- **GIVEN** the prod sync stack with paired origin `https://tricho.app`
- **WHEN** a script on `https://malicious.example.com/` makes a credentialed `fetch` to `https://sync.tricho.app/auth/refresh`
- **THEN** the response does NOT include `Access-Control-Allow-Origin: https://malicious.example.com`
- **AND** the browser blocks the response from being read by the attacker page
- **AND** `tricho-auth`'s response also fails authorization independently because the JWT cookie is not sent (cross-site `fetch` does not include `SameSite=Lax` cookies)

#### Scenario: Cookie scope reaches the sync host on top-level navigation

- **GIVEN** a logged-in user with a `tricho-auth` cookie set with `Domain=tricho.app; SameSite=Lax`
- **WHEN** the user navigates from `https://tricho.app/app/...` to a same-tab redirect to `https://sync.tricho.app/auth/...`
- **THEN** the cookie is sent with the navigation request
- **AND** `tricho-auth` validates the JWT and proceeds

#### Scenario: Cookie does not leak to a different registrable site

- **GIVEN** the same cookie scope
- **WHEN** the user visits `https://tricho-fake.com/`
- **THEN** the cookie is NOT sent
- **AND** the cookie is NOT sent on cross-site `fetch` from any origin outside `*.tricho.app`

### Requirement: Server-deploy edge restricts CouchDB routes to the sync host

The Traefik routers in the server-deploy topology MUST match `Host(\`sync.<env>.tricho.app\`)` exclusively for both the `couch` router and the `auth` router. The routers MUST NOT match the apex (`tricho.app`) or the env-prefix (`dev.tricho.app`) hostnames — those are owned by Cloudflare Pages. If DNS for `tricho.app` is accidentally pointed at the deploy host, Traefik MUST return 404 for that hostname.

#### Scenario: Apex hostname returns 404 from the sync host

- **GIVEN** the prod sync stack and a misconfiguration where `tricho.app` resolves to the deploy host's IP
- **WHEN** an external client requests `GET https://tricho.app/auth/health`
- **THEN** Traefik returns 404 (no router matches)
- **AND** the response is NOT a `tricho-auth` payload
- **AND** no userdb data is exposed

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
