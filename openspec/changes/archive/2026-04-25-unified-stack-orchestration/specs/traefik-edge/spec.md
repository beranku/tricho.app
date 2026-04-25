## ADDED Requirements

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

## MODIFIED Requirements

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
