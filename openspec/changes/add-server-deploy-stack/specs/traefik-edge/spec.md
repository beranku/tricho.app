## MODIFIED Requirements

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

### Requirement: Same origin for PWA + CouchDB + auth — single-host topology

For the **single-host stack-orchestration topology** (dev / prod / ci profiles of the root `compose.yml`), the PWA, `/auth/*`, and `/userdb-*` MUST all live under a single hostname so the browser treats them as same-origin. Cross-origin deployments are disallowed in this topology. This requirement DOES NOT apply to the server-deploy topology (`tricho-sync-<env>`); see "Cross-origin sync hostnames" below for that topology's contract.

#### Scenario: One hostname, three services (single-host topology)

- **GIVEN** the production compose stack running under the single-host topology
- **WHEN** the PWA fetches `/userdb-abcd.../doc` and `/auth/refresh`
- **THEN** neither call is cross-origin
- **AND** no CORS preflight is needed

## ADDED Requirements

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
