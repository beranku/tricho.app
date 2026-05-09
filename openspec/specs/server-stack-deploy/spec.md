# server-stack-deploy Specification

## Purpose

Defines how the server-side runtime (CouchDB + `tricho-auth` per environment, behind a single shared edge Traefik) is deployed to the bootstrapped host. Per-environment isolation via `COMPOSE_PROJECT_NAME`, GitHub Environment-gated production with required reviewer, three-gate Definition of Done (compose `--wait`, external HTTPS smoke, JWT data-path probe), atomic rollback via `/opt/tricho/IMAGE_TAG.current`, and the project-wide zero-knowledge invariants enforced server-side. Source files: `infrastructure/server/edge/compose.yml`, `infrastructure/server/sync/compose.yml`, `infrastructure/server/sync/up.sh`, `infrastructure/server/sync/down.sh`, `infrastructure/server/sync/smoke.sh`, `.github/workflows/deploy-server.yml`.

## Requirements

### Requirement: Shared edge Traefik runs as its own compose project

The deploy host MUST run a single Traefik instance scoped to its own Docker Compose project named `tricho-edge`, defined by `infrastructure/server/edge/compose.yml`. This project MUST own ports `:80` and `:443`. It MUST create the Docker network `tricho-edge` declared as `external: true, attachable: true` so per-environment stacks can attach without re-creating it. ACME state MUST be persisted via a directory bind mount from the host path `/srv/tricho/edge/acme` (mode `0700`, owned by Traefik's container UID) — NOT a Docker named volume, NOT a single-file bind, so an accidental volume prune or stack rebuild cannot destroy issued certificates. The edge project's lifecycle MUST be independent of any sync stack: `infrastructure/server/sync/{up,down}.sh` MUST NOT touch `tricho-edge` containers or its ACME state.

#### Scenario: Bringing a sync stack down does not affect the edge

- **GIVEN** the edge stack and `tricho-sync-prod` both running
- **WHEN** the operator runs `infrastructure/server/sync/down.sh prod`
- **THEN** `docker compose -p tricho-sync-prod ps` returns no rows
- **AND** `docker compose -p tricho-edge ps` still reports the Traefik container as running
- **AND** `https://sync.dev.tricho.app/` (the other env) still serves traffic with a valid certificate

#### Scenario: ACME store survives a Traefik image bump

- **GIVEN** the edge stack running with valid Let's Encrypt certificates for `sync.tricho.app` and `sync.dev.tricho.app`
- **WHEN** the operator updates the Traefik image tag and re-`up`s the edge project
- **THEN** the certificates are NOT re-issued
- **AND** the certificate file under `/srv/tricho/edge/acme/` is unchanged in mtime
- **AND** Let's Encrypt rate-limit counters are not consumed

### Requirement: Per-environment stack lifecycle uses `COMPOSE_PROJECT_NAME` for isolation

Each environment runs as its own Compose project: `tricho-sync-prod` for the production stack, `tricho-sync-dev` for the development stack. The deploy script MUST set `COMPOSE_PROJECT_NAME=tricho-sync-${ENV}` before invoking `docker compose`. The shared `infrastructure/server/sync/compose.yml` MUST NOT pin any `name:` field on its volumes or networks — the project name prefix is the sole isolation mechanism. Each environment MUST attach its `tricho-auth` service to BOTH the `tricho-edge` external network AND a project-private network for `tricho-auth ↔ couchdb` traffic; CouchDB MUST attach ONLY to the project-private network and MUST NOT be reachable from `tricho-edge`.

#### Scenario: Cross-env data isolation

- **GIVEN** both `tricho-sync-prod` and `tricho-sync-dev` running
- **WHEN** the operator inspects `/srv/tricho/prod/couchdb/data` and `/srv/tricho/dev/couchdb/data`
- **THEN** the two paths are distinct directory trees with no shared inodes
- **AND** `docker volume ls --filter label=com.docker.compose.project=tricho-sync-prod` and the dev equivalent return disjoint volume sets
- **AND** removing one project (`docker compose -p tricho-sync-dev down -v`) does not delete any file under `/srv/tricho/prod/`

#### Scenario: CouchDB is not reachable from the edge network

- **GIVEN** the prod stack running
- **WHEN** an attacker on a separate container attached to the `tricho-edge` network attempts `curl http://couchdb:5984/_up`
- **THEN** the request fails with DNS or connection error
- **AND** the only route to CouchDB is through `tricho-auth` (which validates JWT + entitlement first)

#### Scenario: Pinning a `name:` is rejected by review

- **GIVEN** a proposed change to `infrastructure/server/sync/compose.yml` that adds `name: tricho_couchdb_data` to a volume
- **WHEN** the change is reviewed
- **THEN** the reviewer rejects it with a reference to this requirement
- **AND** the spec test `infrastructure-lint` flags the offending file

### Requirement: Server-side stack hosts CouchDB and tricho-auth only — no PWA

The `tricho-sync-<env>` Compose stack MUST contain exactly two application services: `couchdb` (built from `infrastructure/couchdb/Dockerfile`) and `tricho-auth` (built from `infrastructure/couchdb/tricho-auth/Dockerfile`). The PWA static server (Caddy) and the PWA dev container MUST NOT appear in this stack. The Traefik routing rules emitted by this stack MUST NOT match `Host(\`<env>.tricho.app\`)` or any path catch-all that would expose the apex/dev hostnames; routing is restricted to the sync hostnames `sync.tricho.app` / `sync.dev.tricho.app`.

#### Scenario: Server returns 404 for the apex hostname

- **GIVEN** the prod stack running and DNS for `tricho.app` accidentally pointed at the deploy host
- **WHEN** an external client requests `GET https://tricho.app/`
- **THEN** Traefik returns 404 (no matching router) — NOT a PWA shell — because the server's routers match only `sync.tricho.app`

#### Scenario: No Caddy or PWA container in the stack

- **GIVEN** `tricho-sync-prod` running
- **WHEN** the operator runs `docker compose -p tricho-sync-prod ps --format '{{.Name}}'`
- **THEN** the output names exactly two containers (CouchDB, tricho-auth)
- **AND** neither name contains `pwa` nor `caddy`

### Requirement: Deploy workflow gates production with a GitHub Environment + reviewer

The deploy workflow MUST use GitHub Environments to gate the production stack. The environment named `production` MUST require at least one reviewer (the operator) and MUST have `deployment_branch_policy.protected_branches = true` so only `main` can deploy to production. Production deploys MUST be triggered by `workflow_dispatch` only — there MUST NOT be a `push` trigger that auto-deploys to production. The dev environment MUST be triggered by `push` to the `dev` branch AND by `workflow_dispatch`; the dev environment MUST NOT require a reviewer (auto-deploy on push). All deploy job invocations MUST set `concurrency: { group: deploy-${env}-${runner_label}, cancel-in-progress: false }` so two near-simultaneous deploys queue rather than overwrite each other.

#### Scenario: Push to main does not deploy to production

- **GIVEN** the deploy workflow file as committed
- **WHEN** any commit is pushed to `main`
- **THEN** the deploy workflow does not auto-trigger for production
- **AND** the only paths to a production deploy are operator-run `workflow_dispatch` invocations

#### Scenario: Push to dev triggers an auto-deploy

- **GIVEN** the deploy workflow file as committed
- **WHEN** a commit lands on `dev`
- **THEN** the deploy workflow runs with `ENVIRONMENT=dev`
- **AND** the dev environment's protection rules permit the run without a reviewer

#### Scenario: Production deploy from a non-main branch is rejected

- **GIVEN** an operator dispatching `deploy-server.yml` with `ENVIRONMENT=prod` from a feature branch
- **WHEN** the workflow attempts to enter the `production` environment
- **THEN** the run fails with the GitHub-emitted "branch not in protected_branches" error
- **AND** no deploy step runs on the host

#### Scenario: Concurrent deploys queue, never cancel

- **GIVEN** a deploy run already in progress for `tricho-sync-prod`
- **WHEN** a second deploy is dispatched for the same env + runner
- **THEN** the second run waits for the first to complete
- **AND** the first run is NOT cancelled mid-step

### Requirement: Deploy step's Definition of Done has three gates

A deploy step MUST be considered successful only when ALL of the following hold:

1. `docker compose -p tricho-sync-${ENV} -f infrastructure/server/sync/compose.yml up -d --wait --wait-timeout 60` exits 0 (every service's `healthcheck:` reports healthy within 60 s).
2. An external HTTPS smoke probe `curl -fsS https://sync.<env>.tricho.app/auth/health` returns HTTP 200, and the response includes a header `X-Build-Sha:` whose value matches the deploying SHA.
3. An external authenticated data-path probe — a `curl` with a test JWT to `https://sync.<env>.tricho.app/auth/_session` (or equivalent) — returns the expected JSON shape.

If any gate fails, the deploy step MUST roll back to the previously-successful SHA cached in `/opt/tricho/IMAGE_TAG.current` and re-`up`. Only after all three gates pass MUST the script overwrite `IMAGE_TAG.current` with the new SHA.

#### Scenario: Healthcheck flake without working DoD probe is caught

- **GIVEN** a deploy where `tricho-auth` reports `healthy` but Traefik's router for `/auth/*` is misconfigured
- **WHEN** the external smoke probe runs
- **THEN** the smoke step receives a 404 or 502
- **AND** the deploy script rolls back to the previous SHA without overwriting `IMAGE_TAG.current`
- **AND** the workflow run reports failure with the failed gate named

#### Scenario: Successful deploy advances the rollback marker

- **GIVEN** all three DoD gates pass for SHA `def456…`
- **WHEN** the deploy step finishes
- **THEN** `/opt/tricho/IMAGE_TAG.current` contains exactly the string `def456…`
- **AND** the previous content is no longer at that path (it survives only in workflow run logs and Git history)

#### Scenario: Rollback succeeds with the cached SHA

- **GIVEN** a failed deploy of SHA `bad789…` and `IMAGE_TAG.current` previously holding `good456…`
- **WHEN** the rollback step runs
- **THEN** the stack comes back up using image tag `sha-good456…`
- **AND** the external smoke probe returns 200
- **AND** the workflow run is marked failure (the deploy of `bad789` did not succeed) but the stack is in its prior-known-good state

### Requirement: Server-side runtime preserves zero-knowledge invariants

The server-side stack MUST preserve the project-wide zero-knowledge invariants. Specifically:

- The host MUST NOT log decrypted payload bodies, document IDs in the clear beyond what `tricho-auth` already records (the OAuth `sub` is not a payload), or any keystore unlock material.
- No service in the stack SHALL implement a route that accepts plaintext payloads and re-encrypts them server-side.
- No service in the stack SHALL implement a "recover from cloud" or "reset passphrase" endpoint. Lost passphrase remains, by design, a path that requires the user-side Recovery Secret or an encrypted backup file.
- The deploy host MUST NOT store any user-side DEK, KEK, Recovery Secret, or passphrase, in any form, ever.

#### Scenario: Server lacks a decrypt path

- **GIVEN** the deployed server stack
- **WHEN** an external client (with valid JWT) requests any route on `tricho-auth` other than the documented health/session/refresh routes
- **THEN** the response is 404
- **AND** no route shape `POST /decrypt`, `POST /recover`, or similar exists

#### Scenario: No keystore unlock material on disk

- **GIVEN** a deploy host that has been running for any length of time
- **WHEN** the operator searches `/srv/tricho/`, `/var/log/`, container logs (`docker logs`), and the runner workspace for the substrings `recovery_secret`, `passphrase`, `dek`, `kek`, `wrappedDek`
- **THEN** no match is found
- **AND** if any future change introduces such a match, this scenario regresses and the change is rejected
