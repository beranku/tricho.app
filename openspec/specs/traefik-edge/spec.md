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
The stack MUST be expressible via the Traefik compose overlay (`infrastructure/traefik/docker-compose.yml`) that `include`s the base CouchDB compose — so local-dev developers can run CouchDB + tricho-auth without Traefik, and production adds the edge declaratively.

#### Scenario: Local dev without Traefik
- GIVEN a developer running only `infrastructure/couchdb/docker-compose.yml`
- WHEN they hit `http://localhost:5984/_up`
- THEN CouchDB responds (dev-only direct port binding)
