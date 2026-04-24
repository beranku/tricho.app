## Why

Today TrichoApp's moving parts — Astro/React PWA, `tricho-auth`, CouchDB 3, Traefik, Caddy — boot from three different spots: `npm run dev` on the host, `infrastructure/couchdb/docker-compose.yml` for the database, and an overlay compose for Traefik in prod. Two things fall out of this: (1) the dev origin (`localhost:4321`) never matches the prod origin (`https://tricho.app`), so CORS, SameSite cookies and the Apple OAuth POST callback can't be exercised locally; (2) first-time CouchDB startup still requires a human to paste a JWT public key into `local.ini`. Neither local dev nor CI can bring the whole integrated stack up and talk to itself the way prod does, so no end-to-end test has ever run against a real CouchDB + tricho-auth + Traefik chain.

We want a single "one-command" orchestration that works the same on a laptop, in CI, and in production — with only env vars and secrets changing between environments.

## What Changes

- Introduce a **root `compose.yml`** with `profiles:` (`dev` / `prod` / `ci`) as the single source of truth for the service topology. The existing `infrastructure/couchdb/docker-compose.yml` and `infrastructure/traefik/docker-compose.yml` become thin includes or are collapsed into it.
- Containerize the **PWA dev server** (Astro/Vite) and route it through Traefik in the `dev` profile so `/`, `/auth/*`, `/userdb-*` are all same-origin from the first minute of development. HMR websocket is proxied through Traefik.
- Add a top-level **`Makefile`** exposing `make dev`, `make prod-local`, `make ci`, `make e2e`, `make secrets-edit`, `make secrets-rotate-age`. Everything the developer needs maps to one target.
- **BREAKING** for operators: secrets migrate from plain `.env` to **SOPS + age**. Repo carries `secrets/*.sops.yaml` encrypted at rest; age private keys live in `~/.config/sops/age/keys.txt` locally and in a `SOPS_AGE_KEY` GitHub Actions secret in CI. `make up` decrypts to an in-memory fifo / tmpfs mount before compose starts; container runtime consumes them as Docker Compose `secrets:` (file-mounted under `/run/secrets/*`), never as plain env vars for long-lived material (OAuth client secrets, JWT private key, CouchDB admin password).
- Automate the **CouchDB JWT public-key handoff**: `tricho-auth` writes `jwt-public.pem` to a shared named volume at boot; CouchDB runs a short entrypoint that templates `[jwt_keys]` into `/opt/couchdb/etc/local.d/jwt.ini` before `couchdb` starts. First-run friction drops to zero and key rotation becomes a restart.
- Add a **mock OIDC provider** container (`ci` profile only) that emits valid RS256 id_tokens for Google/Apple-shaped subjects, so the full OAuth callback + device-registration + JWT-issue path is testable without hitting real providers.
- Add a **Playwright E2E harness** (`tests/e2e/`) and a **`.github/workflows/e2e.yml`** workflow that runs the `ci` profile on a GitHub-hosted runner, waits on healthchecks, executes the suite against the single Traefik origin (self-signed cert trusted by the browser context), and uploads traces on failure.
- Document the layered env model in root `README.md`: `.env` (non-secret defaults, committed) → `secrets/*.sops.yaml` (encrypted, committed) → host-specific overrides (ignored). Production differs only in which age key decrypts the secrets and which `.env` file is active.

## Capabilities

### New Capabilities
- `stack-orchestration`: Single root compose + profile definitions + Makefile covering dev/prod/ci, layered env files, healthcheck-gated startup order, and the PWA dev container fronted by Traefik with working HMR.
- `secrets-management`: SOPS + age at rest, Docker Compose `secrets:` at runtime, documented rotation procedure, and a documented split between committed encrypted secrets, local age private keys, and the `SOPS_AGE_KEY` GitHub Actions secret.
- `jwt-key-bootstrap`: Automated JWT keypair lifecycle — tricho-auth generates or loads a keypair, publishes the public key to a named volume, and CouchDB consumes it via an entrypoint shim so `[jwt_keys]` is never hand-edited.
- `e2e-testing`: Containerized Playwright suite plus a `ci` compose profile with a mock OIDC provider, executed by a new GitHub Actions workflow. Covers OAuth → device registration → JWT issue → CouchDB sync, all through the Traefik edge.

### Modified Capabilities
- `traefik-edge`: Gains `dev` and `ci` profile variants — dev uses HTTP-only or a self-signed mkcert root; ci uses a self-signed cert and a hosts-file override to `tricho.test`; prod keeps Let's Encrypt. Router set grows to include the PWA dev service (with websocket upgrade rule for Vite HMR) in the `dev` profile. The three public-path invariant (`/auth/*`, `/userdb-*`, `/_replicator`) stays intact across all profiles.

## Impact

- **Zero-knowledge invariants**: unchanged. No new service learns plaintext, DEK, or recovery secret. Mock OIDC is CI-only and never reached by prod traffic. JWT private key moves from an env var / dev-dir into a Docker secret file — strictly safer.
- **Code / infra touched**:
  - New: root `compose.yml`, `Makefile`, `.sops.yaml`, `secrets/*.sops.yaml` templates, `infrastructure/pwa/Dockerfile` (multi-stage dev + prod), `infrastructure/couchdb/entrypoint.sh`, `infrastructure/mock-oidc/` (CI), `tests/e2e/` + Playwright config, `.github/workflows/e2e.yml`.
  - Modified: `infrastructure/couchdb/docker-compose.yml`, `infrastructure/couchdb/local.ini` (drops manual key paste instructions), `infrastructure/couchdb/tricho-auth/server.mjs` (write pubkey to shared volume), `infrastructure/traefik/docker-compose.yml` (folds into root compose), `infrastructure/traefik/dynamic/middlewares.yml` (permits websocket upgrade for PWA dev), `.github/workflows/deploy.yml` (unchanged behavior, but may be re-sequenced behind `e2e.yml`), `README.md`, `package.json` (adds `@playwright/test` devDep), `.env.example` files.
  - Removed / obsoleted: ad-hoc "copy the public key to local.ini" README passage; direct `npm run dev` as the documented primary flow (still works, but no longer the recommended path).
- **Dependencies**: adds SOPS and age as operator tooling (documented install paths for macOS + Linux); Playwright browsers cached in CI; Dex or a custom tiny Node mock for OIDC (decision deferred to design).
- **Rollback**: the new root compose + Makefile layer on top of the existing files. Reverting this change means `git revert` the new files, restore the older compose files, and stop using `make`. Secrets rollback is non-trivial once age keys are distributed — treat the SOPS migration as a one-way door and stage it via a rotation plan.
- **Threat-model delta**: Before → long-lived secrets (CouchDB admin password, OAuth client secret) sat in host `.env` files, readable by any process on the box, and the JWT private key lived on disk under `/tmp/tricho-auth-keys` unencrypted. After → encrypted at rest in the repo via SOPS+age; at runtime mounted as `/run/secrets/*` files readable only by the service's container user. An attacker with repo read access gains nothing without the age private key; an attacker on a dev laptop still gets the age key (same blast radius as a stolen laptop before), so this hardens prod/CI without meaningfully changing the local threat model.
