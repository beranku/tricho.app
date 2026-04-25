## ADDED Requirements

### Requirement: Single root compose file with profiles
The repository MUST define exactly one root `compose.yml` that declares every runtime service (PWA, `tricho-auth`, CouchDB, Traefik, mock OIDC) and uses Docker Compose `profiles:` (`dev`, `prod`, `ci`) to select which subset runs in a given environment. Secondary compose files (if kept) MUST be `include:`'d from the root file — never invoked directly by the Makefile or documented as the primary entry point.

#### Scenario: `make dev` brings up the full dev topology
- GIVEN a clean checkout with `secrets/*.sops.yaml` decryptable
- WHEN the developer runs `make dev`
- THEN `docker compose --profile dev up -d` is invoked
- AND PWA dev container, tricho-auth, CouchDB and Traefik all reach `healthy` within 90 seconds
- AND `curl -k https://tricho.localhost/` returns the Astro dev HTML
- AND `curl -k https://tricho.localhost/auth/health` returns `{"ok":true}`

#### Scenario: `make prod-local` runs the production topology on the laptop
- GIVEN the developer has an age key that decrypts `secrets/prod.sops.yaml`
- WHEN they run `SOPS_PROFILE=prod make prod-local`
- THEN the stack comes up with the `prod` profile (no dev PWA, no mock OIDC, Caddy serves the built `dist/`)
- AND the only difference from a real production host is `APP_HOST` and the TLS resolver

### Requirement: Makefile is the primary developer entry point
The repository MUST ship a root `Makefile` exposing at minimum the targets `dev`, `prod-local`, `ci`, `down`, `logs`, `e2e`, `secrets-edit`, `secrets-rotate-age`, and `help`. Each target MUST be idempotent (safe to re-run) and MUST fail loudly when required prerequisites (Docker daemon running, age private key present, SOPS installed) are missing.

#### Scenario: Missing age key fails loudly
- GIVEN a developer with no age private key
- WHEN they run `make dev`
- THEN the target exits non-zero before starting any container
- AND the stderr message names the missing file path and links to the setup section of the root `README.md`

#### Scenario: `make help` enumerates targets
- GIVEN any checkout
- WHEN the developer runs `make help`
- THEN the output lists every public target with a one-line description

### Requirement: Healthcheck-gated startup order
Every runtime service MUST declare a Docker healthcheck, and `depends_on:` MUST use `condition: service_healthy` so consumers never observe a half-initialized dependency. `tricho-auth` MUST wait on CouchDB; Traefik MUST wait on `tricho-auth` and CouchDB; Playwright's CI runner MUST wait on Traefik.

#### Scenario: tricho-auth never races CouchDB
- GIVEN a cold `docker compose --profile dev up`
- WHEN the Compose engine starts services
- THEN the `tricho-auth` container does not enter the `running` state until CouchDB's `/_up` returns 200
- AND `tricho-auth` logs show zero "connection refused" retries against CouchDB

### Requirement: Layered environment configuration
Configuration MUST resolve in this precedence (lowest to highest): committed `.env` defaults → decrypted `secrets/<profile>.sops.yaml` → ad-hoc shell exports. The committed `.env` MUST contain only non-sensitive defaults (ports, hostnames, tier toggles). No secret may appear in plain text in a committed file outside of SOPS.

#### Scenario: Committed defaults make `make dev` work offline
- GIVEN a developer on a fresh laptop with the age private key and SOPS installed
- WHEN they clone and run `make dev`
- THEN no prompt asks for port numbers, container names or hostnames
- AND the stack starts using the defaults from the committed `.env`

#### Scenario: Prod overrides are not embedded in the compose file
- GIVEN the root `compose.yml`
- WHEN grep'ed for production-only values (ACME email, real `APP_HOST`, OAuth client IDs)
- THEN no such value appears as a literal
- AND every production override is sourced from an env var with a safe dev default

### Requirement: PWA dev container is fronted by Traefik in dev profile
The `dev` profile MUST include a container running `astro dev` (Node base image, source volume mounted) that is routed by Traefik at `/` on the dev hostname. The Vite HMR websocket MUST traverse Traefik without manual configuration by the developer.

#### Scenario: HMR survives a code edit
- GIVEN `make dev` is running
- WHEN the developer edits `src/pages/index.astro`
- THEN the browser open at `https://tricho.localhost/` re-renders without a full reload
- AND the browser devtools show a successful `101 Switching Protocols` for the Vite HMR websocket through Traefik

#### Scenario: Same-origin by default
- GIVEN the browser at `https://tricho.localhost/`
- WHEN the PWA issues `fetch('/auth/health')` and `fetch('/userdb-<hex>/doc')`
- THEN neither request is cross-origin
- AND neither triggers a CORS preflight

### Requirement: Profiles must not leak between environments
The `ci` profile MUST include a mock OIDC provider; the `dev` and `prod` profiles MUST NOT. The `prod` profile MUST NOT include the PWA dev container or the mock OIDC service. Compose MUST refuse to start if an incompatible profile combination is requested.

#### Scenario: Mock OIDC is absent from prod
- GIVEN `docker compose --profile prod config`
- WHEN its service list is inspected
- THEN neither `mock-oidc` nor `pwa-dev` appears
- AND only `traefik`, `couchdb`, `tricho-auth`, and `pwa` (Caddy) are present
